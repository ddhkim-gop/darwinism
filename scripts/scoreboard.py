#!/usr/bin/env python3
"""Date a highlight clip from the scoreboard burned into its broadcast.

A clip's own pixels carry a verifiable fact: the score bug names both teams and
the score. That tuple resolves to exactly one NFL game almost always, and
nflverse publishes every game with its season and week. So instead of guessing
"this looks like last season" from uniforms, the scoreboard is looked up.

    $ python3 scripts/scoreboard.py DAL PHI 20 24
    2025 week 1  DAL 20 @ PHI 24  (2025-09-04)  -> archive

Reading the bug is automatic now. macOS ships Vision, so `scripts/ocr.py` pulls
the burned-in text off sampled frames on-device, and `--auto CLIP` goes from a
video file to a verdict without anyone looking at anything:

    $ python3 scripts/scoreboard.py --auto clip.mp4
    read DAL @ NYG  ->  2026 week 2  DAL @ NYG  (2026-09-14)  -> current-week

Only the two team codes are read, not the score. Codes come out at confidence
1.00 against a 32-entry whitelist; scores do not, because the bug renders them
in a tight box where a clipped digit turns 19 into "NU". That costs nothing:
a mid-game score matches no final anyway, so matchup-against-slate was already
the signal carrying the weight here. `--strip` still exists for the cases the
reader wants to check by eye.
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

GAMES_URL = "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv"
CACHE = Path(__file__).resolve().parent / ".games_cache.csv"
CACHE_TTL_HOURS = 12
SLEEPER_STATE = "https://api.sleeper.app/v1/state/nfl"

# nflverse uses current abbreviations; broadcasts and older rows use others.
ALIASES = {
    "WSH": "WAS", "WFT": "WAS", "OAK": "LV", "LVR": "LV", "SD": "LAC",
    "SDG": "LAC", "STL": "LA", "LAR": "LA", "RAM": "LA", "ARZ": "ARI",
    "BLT": "BAL", "CLV": "CLE", "HST": "HOU", "JAC": "JAX", "TAM": "TB",
    "KAN": "KC", "NWE": "NE", "NOR": "NO", "GNB": "GB", "SFO": "SF",
}


def team(code: str) -> str:
    c = (code or "").strip().upper()
    return ALIASES.get(c, c)


def _fresh_cache() -> bool:
    if not CACHE.exists():
        return False
    age = time.time() - CACHE.stat().st_mtime
    return age < CACHE_TTL_HOURS * 3600


def games() -> list[dict]:
    """Every NFL game with season, week and final score. Cached on a TTL."""
    if not _fresh_cache():
        try:
            req = urllib.request.Request(GAMES_URL,
                                         headers={"User-Agent": "highlights-builder"})
            with urllib.request.urlopen(req, timeout=45) as r:
                CACHE.write_bytes(r.read())
        except Exception as e:
            if not CACHE.exists():
                print(f"  ! could not fetch schedule and no cache: {e}",
                      file=sys.stderr)
                return []
            print(f"  ! schedule fetch failed, using cache: {e}", file=sys.stderr)
    with CACHE.open(newline="") as fh:
        return list(csv.DictReader(fh))


def slate(season: int, week: int) -> list[dict]:
    """Every matchup scheduled in one season-week."""
    return [g for g in games()
            if g.get("season") == str(season) and g.get("week") == str(week)]


def on_slate(away: str, home: str, season: int, week: int) -> dict | None:
    """Is this matchup played in that season-week? Order-insensitive."""
    a, h = team(away), team(home)
    for g in slate(season, week):
        if {team(g["away_team"]), team(g["home_team"])} == {a, h}:
            return {"season": season, "week": week,
                    "away": team(g["away_team"]), "home": team(g["home_team"]),
                    "away_score": g.get("away_score") or "",
                    "home_score": g.get("home_score") or "",
                    "gameday": g.get("gameday", "")}
    return None


def resolve(away: str, home: str, away_score, home_score) -> list[dict]:
    """Games whose FINAL score equals this scoreboard.

    Only useful when the bug was captured at the end of a game. A mid-game
    score matches nothing, which is why matchup-against-slate below carries
    the real weight."""
    a, h = team(away), team(home)
    want = {str(away_score).strip(), str(home_score).strip()}
    out = []
    for g in games():
        gа, gh = team(g.get("away_team", "")), team(g.get("home_team", ""))
        if {gа, gh} != {a, h}:
            continue
        got = {(g.get("away_score") or "").strip(),
               (g.get("home_score") or "").strip()}
        if "" in got:
            continue                      # not played yet
        if got != want:
            continue
        out.append({"season": int(g["season"]), "week": int(g["week"]),
                    "away": gа, "home": gh,
                    "away_score": g["away_score"], "home_score": g["home_score"],
                    "gameday": g.get("gameday", "")})
    return out


def state() -> dict:
    req = urllib.request.Request(SLEEPER_STATE,
                                 headers={"User-Agent": "highlights-builder"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode())


def verdict(away: str, home: str, away_score, home_score,
            st: dict | None = None) -> tuple[str, dict | None]:
    """One of current-week / earlier-week / archive / unknown, plus the game.

    Two signals, strongest first:

    1. An exact final-score match pins the game outright. Only fires when the
       bug was read near the end of a game.
    2. Otherwise the matchup is checked against the current week's slate. A
       matchup recurs every season, so being *on* this week's slate is strong
       but not proof; being *absent* from it is proof the clip is not from
       this week, which is the direction this filter needs.

    'unknown' is never treated as current - an unreadable or unmatched
    scoreboard is a reason to leave a clip out, not to trust it.
    """
    st = st or state()
    season, week = int(st.get("season") or 0), int(st.get("week") or 0)

    hits = resolve(away, home, away_score, home_score)
    if hits:
        hits.sort(key=lambda g: (g["season"], g["week"]), reverse=True)
        g = hits[0]
        if g["season"] != season:
            return "archive", g
        return ("current-week" if g["week"] == week else "earlier-week"), g

    g = on_slate(away, home, season, week)
    if g:
        # scheduled this week; a mid-game score must not exceed the final
        try:
            if g["away_score"] and g["home_score"]:
                mid = (int(str(away_score)), int(str(home_score)))
                fin = (int(g["away_score"]), int(g["home_score"]))
                if mid[0] > fin[0] or mid[1] > fin[1]:
                    return "archive", g       # too high to be this game
        except ValueError:
            pass
        return "current-week", g

    for w in range(1, 23):
        if w == week:
            continue
        g = on_slate(away, home, season, w)
        if g:
            return "earlier-week", g
    return "unknown", None


# The 32 current codes, as nflverse spells them. A whitelist rather than a
# regex because a broadcast burns plenty of other three-letter text into the
# frame - SNF, TNF, network bugs - and "NFL" is not a team.
TEAM_CODES = {
    "ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE", "DAL", "DEN",
    "DET", "GB", "HOU", "IND", "JAX", "KC", "LA", "LAC", "LV", "MIA",
    "MIN", "NE", "NO", "NYG", "NYJ", "PHI", "PIT", "SEA", "SF", "TB",
    "TEN", "WAS",
}


def read_matchup(video: str, fps: float = 1.0) -> tuple[str | None, str | None, dict]:
    """Which two teams the score bug names, read off the clip itself.

    Returns (left, right, detail). Order is by position on screen - the bug
    lists the away team first on every network - but it is not trusted:
    `resolve_clip` checks the pair against the slate order-insensitively,
    because a clip cropped to the bug's right half can invert them.
    """
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import tempfile
    import ocr

    counts: dict[str, int] = {}
    positions: dict[str, list[float]] = {}
    with tempfile.TemporaryDirectory() as tmp:
        # Only the bottom fifth: the bug lives there, and cropping keeps a
        # player's nameplate from being mistaken for a team code.
        paths = ocr.frames(video, tmp, fps=fps,
                           crop="crop=iw:ih*0.25:0:ih*0.75")
        for rows in ocr.boxes(paths).values():
            for row in rows:
                for tok in re.split(r"[^A-Z0-9]+", row["text"].upper()):
                    if tok in TEAM_CODES:
                        counts[tok] = counts.get(tok, 0) + 1
                        positions.setdefault(tok, []).append(row["x"])

    ranked = sorted(counts, key=lambda t: -counts[t])[:2]
    detail = {"counts": counts, "frames": len(paths)}
    if len(ranked) < 2:
        return (ranked[0] if ranked else None), None, detail
    left, right = sorted(ranked, key=lambda t: sum(positions[t]) / len(positions[t]))
    return left, right, detail


def resolve_clip(video: str, st: dict | None = None,
                 fps: float = 1.0) -> tuple[str, dict | None, dict]:
    """A clip file in, a current-week / earlier-week / archive verdict out."""
    left, right, detail = read_matchup(video, fps=fps)
    if not left or not right:
        return "unknown", None, detail
    st = st or state()
    season, week = int(st.get("season") or 0), int(st.get("week") or 0)

    g = on_slate(left, right, season, week)
    if g:
        return "current-week", g, detail
    for w in range(1, 23):
        if w == week:
            continue
        g = on_slate(left, right, season, w)
        if g:
            return "earlier-week", g, detail
    for older in range(season - 1, season - 6, -1):
        for w in range(1, 23):
            g = on_slate(left, right, older, w)
            if g:
                return "archive", g, detail
    return "unknown", None, detail


def strip(video: str, out_dir: str, n: int = 6) -> list[str]:
    """Pull the bottom band of the frame, where the score bug sits, as JPEGs."""
    d = Path(out_dir)
    d.mkdir(parents=True, exist_ok=True)
    dur = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", video], capture_output=True, text=True).stdout.strip()
    try:
        total = float(dur)
    except ValueError:
        total = 10.0
    paths = []
    for i in range(1, n + 1):
        t = total * i / (n + 1)
        p = d / f"bug_{i:02d}.jpg"
        subprocess.run(
            ["ffmpeg", "-v", "error", "-ss", f"{t:.2f}", "-i", video,
             "-frames:v", "1",
             "-vf", "crop=iw:ih*0.22:0:ih*0.78,scale=900:-2", str(p), "-y"],
            check=False)
        if p.exists():
            paths.append(str(p))
    return paths


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("away", nargs="?"); ap.add_argument("home", nargs="?")
    ap.add_argument("away_score", nargs="?"); ap.add_argument("home_score", nargs="?")
    ap.add_argument("--auto", metavar="VIDEO",
                    help="read the matchup off this clip and date it")
    ap.add_argument("--fps", type=float, default=1.0,
                    help="frames per second to sample for --auto (default 1)")
    ap.add_argument("--strip", metavar="VIDEO",
                    help="extract score-bug frames from this clip and exit")
    ap.add_argument("--out-dir", default="score_bug")
    a = ap.parse_args()

    if a.auto:
        v, g, detail = resolve_clip(a.auto, fps=a.fps)
        seen = ", ".join(f"{k}x{n}" for k, n in
                         sorted(detail["counts"].items(), key=lambda kv: -kv[1]))
        print(f"read from {detail['frames']} frames: {seen or 'no team code'}")
        if g:
            print(f"  {g['season']} week {g['week']}  {g['away']} @ {g['home']}"
                  f"  ({g['gameday']})  -> {v}")
        else:
            print(f"  no game matches  -> {v}")
        return 0
    if a.strip:
        for p in strip(a.strip, a.out_dir):
            print(p)
        return 0
    if not all([a.away, a.home, a.away_score, a.home_score]):
        ap.error("give AWAY HOME AWAY_SCORE HOME_SCORE, or --strip VIDEO")
    v, g = verdict(a.away, a.home, a.away_score, a.home_score)
    if g:
        print(f"{g['season']} week {g['week']}  {g['away']} {g['away_score']} @ "
              f"{g['home']} {g['home_score']}  ({g['gameday']})  -> {v}")
    else:
        print(f"no game matches {team(a.away)} {a.away_score} / "
              f"{team(a.home)} {a.home_score}  -> {v}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
