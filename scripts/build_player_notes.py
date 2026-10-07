#!/usr/bin/env python3
"""Compile per-player game notes for a week, for the matchup recaps.

  python3 scripts/build_player_notes.py [--week N] [--year YYYY]

Points alone cannot say what happened in a game, so recaps built from them read
as a list of scores. This pulls the same Sleeper player-news feed the player
card already uses (api.sleeper.com/players/nfl/<id>/news) and keeps, per
starter, the one item describing that week's game:

  line   - the stat line and result ("rushed 19 times for 145 yards and two
           touchdowns in a 45-24 win over New Orleans")
  note   - the analyst sentence, kept only when it mentions an injury
  injury - current status/body part/notes from the players feed

Writes data/<year>/player_notes.json keyed by player_id. Only starters for the
requested week are fetched, and anything already current is skipped, so a rerun
costs almost nothing.

CAVEAT the recaps must respect: the injury block is CURRENT status, not status
during that week's game. Only the `line` and `note` are week-scoped.
"""
from __future__ import annotations
import argparse, json, os, re, sys, time, urllib.request

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
NEWS = "https://api.sleeper.com/players/nfl/{pid}/news?limit=6"
PLAYERS = "https://api.sleeper.app/v1/players/nfl"
INJURY_RE = re.compile(
    r"\b(injur\w*|ankle|hamstring|knee|groin|shoulder|concussion|calf|quad|hip|ribs?|"
    r"foot|toe|wrist|elbow|back|illness|questionable|doubtful|left the game|exited|"
    r"did not return|limited|sidelined|carted)\b", re.I)


def get(url, timeout=40):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def surname(name):
    parts = re.sub(r"\b(Jr\.?|Sr\.?|I{2,}|IV|V)\b", "", name or "").split()
    return parts[-1] if parts else ""


def week_item(items, name, lo, hi):
    """The recap item for THIS player's game inside [lo, hi], newest first.

    Three filters, each earned from wrong output:
      - publish time in the window, or a prior week's recap wins;
      - a non-empty `analysis`, which separates recaps from lookahead pieces
        ("will shoulder his toughest workload", "is in line for more work");
      - the player's surname in the TITLE, not merely the body, or a teammate
        preview leaks in ("AJ Dillon Remains Handcuff to Chuba Hubbard").
    """
    sn = surname(name).lower()
    best = None
    for it in items or []:
        ts = it.get("published")
        if not ts or not (lo <= ts / 1000 <= hi):
            continue
        md = it.get("metadata") or {}
        desc = (md.get("description") or "").strip()
        analysis = (md.get("analysis") or "").strip()
        title = (md.get("title") or "").strip()
        if not desc or not analysis:
            continue
        if sn and sn not in title.lower():
            continue
        if best is None or ts > best[0]:
            best = (ts, desc, analysis, title)
    return (best[1], best[2], best[3]) if best else None


def first_injury_sentence(text):
    for s in re.split(r"(?<=[.!?])\s+", text or ""):
        if INJURY_RE.search(s):
            return s.strip()
    return None


def week_window(year, week):
    """Unix-second bounds for a week's games.

    Week 1 of the 2026 season opened Thu Sep 10; each week runs Thursday to the
    following Wednesday morning, which covers Thursday, Sunday and Monday games
    plus the overnight recap posts.
    """
    import datetime as dt
    opener = dt.datetime(int(year), 9, 10, 0, 0)       # Thu of week 1
    start = opener + dt.timedelta(days=7 * (week - 1))
    end = start + dt.timedelta(days=6, hours=18)
    return start.timestamp(), end.timestamp()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--year", default=None)
    ap.add_argument("--week", type=int, default=None)
    ap.add_argument("--sleep", type=float, default=0.15)
    a = ap.parse_args()

    year = a.year or sorted(d for d in os.listdir("data") if d.isdigit())[-1]
    mpath = f"data/{year}/matchups.json"
    matchups = json.load(open(mpath))
    weeks = [w for w in matchups if matchups[w]]
    week = a.week or max(int(w) for w in weeks)

    # Window for the week's games: Thursday through the following Tuesday,
    # anchored on the newest game line seen in the feed rather than a hardcoded
    # calendar, so a schedule shift cannot silently empty the window.
    lo, hi = week_window(year, week)
    print(f"  window {time.strftime('%Y-%m-%d', time.localtime(lo))}"
          f" .. {time.strftime('%Y-%m-%d', time.localtime(hi))}")

    starters = {}
    for g in matchups[str(week)]:
        for t in g["teams"]:
            for p in t["starters"]:
                starters[p["player_id"]] = p["name"]
    print(f"{year} week {week}: {len(starters)} starters")

    out_path = f"data/{year}/player_notes.json"
    out = {}
    if os.path.exists(out_path):
        prev = json.load(open(out_path))
        if prev.get("week") == week:
            out = prev.get("players", {})

    try:
        players = get(PLAYERS, timeout=180)
    except Exception as e:
        print(f"  players feed failed ({e}); continuing without injury detail", file=sys.stderr)
        players = {}

    fetched = 0
    for pid, name in starters.items():
        rec = out.get(pid, {})
        if "line" not in rec:
            try:
                hit = week_item(get(NEWS.format(pid=pid)), name, lo, hi)
                time.sleep(a.sleep)
                fetched += 1
            except Exception as e:
                print(f"  ! {name}: {e}", file=sys.stderr)
                hit = None
            if hit:
                desc, analysis, title = hit
                rec["line"] = desc
                # Only keep a note that adds something; the injury sentence is
                # often the description itself, and repeating it reads as a bug.
                inj = first_injury_sentence(analysis)
                if not inj:
                    cand = first_injury_sentence(desc)
                    inj = cand if cand and cand != desc else None
                if inj:
                    rec["note"] = inj
        p = players.get(pid) or {}
        if p.get("injury_status"):
            rec["injury"] = {k: p.get("injury_" + k) for k in ("status", "body_part", "notes")
                             if p.get("injury_" + k)}
        rec["name"] = name
        out[pid] = rec

    with open(out_path, "w") as f:
        json.dump({"year": int(year), "week": week, "players": out}, f, indent=1)
    have = sum(1 for r in out.values() if r.get("line"))
    inj = sum(1 for r in out.values() if r.get("injury") or r.get("note"))
    print(f"  wrote {out_path}: {have}/{len(starters)} with a game line, {inj} with injury info ({fetched} fetched)")


if __name__ == "__main__":
    main()
