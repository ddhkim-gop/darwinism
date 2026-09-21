#!/usr/bin/env python3
"""Check, from the clip's own pixels, that it shows the player it claims to.

The expensive step in this pipeline has always been a person watching every
candidate to answer one question: is the named player actually in this footage?
Across earlier passes that was 143 clips watched to keep 26, and six of the
rejects were footage of an entirely different player than the caption named.

A broadcast answers the question itself. It burns the ball-carrier's surname
onto a nameplate, his number onto the jersey, and both teams onto the score
bug, and macOS reads all of it on-device. So this pass reads each clip and
records what it saw:

    match       his name appeared in the frames
    team-only   a team appeared but his name did not - plausible, unproven
    other-name  a different rostered player's name appeared and his did not.
                Read this as ambiguity, not contradiction: on a touchdown the
                graphic often names the passer, so a Saints clip of Juwan
                Johnson legitimately shows Tyler Shough
    no-text     nothing legible; a camp clip with no graphics, usually

A first pass here counted team codes and called any clip with five or more a
studio round-up. That was wrong, and the tokens said so: the extra codes are a
scrolling score ticker, which is ordinary furniture on a CBS broadcast of a
single play. The same tokens also showed why the name check was missing - a
nameplate reads "DERRICK" and clips to "HEN", so matching the full surname
alone found neither. Both names are matched now, and a token of four or more
characters counts as a hit if either name starts with it.

**These are evidence, not verdicts.** `highlights_reviewed.json` still holds
the decisions, and nothing here writes into it. A `match` corroborates a keep;
an `other-name` is a flag to go and look. Treating OCR as the judge would trade a
careful reviewer for a confident one - the nameplate names whoever the director
chose to caption, which on a touchdown is often the passer, not the catcher.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import ocr  # noqa: E402
import scoreboard  # noqa: E402

REPO = HERE.parent
FEEDS = REPO / "assets" / "highlights"
OUT = HERE / "highlights_ocr.json"

# Surnames this short collide with score-bug text ("RICE" is fine, "LEE" is not
# once a frame renders "LEFT"). Matched as whole tokens only, and skipped below
# this length rather than guessed at.
MIN_SURNAME = 4


SUFFIXES = {"JR", "SR", "II", "III", "IV", "V"}


def name_parts(full_name: str) -> list[str]:
    """Both names, uppercased, suffixes dropped.

    Both because a broadcast nameplate is inconsistent about which it shows -
    "DERRICK" on one graphic, "HENRY" on the next - and matching only the
    surname missed clips whose first name was right there in the frame.
    """
    parts = [p.upper() for p in re.split(r"[^A-Za-z']+", full_name or "") if p]
    while parts and parts[-1].rstrip(".") in SUFFIXES:
        parts.pop()
    return [p for p in parts if len(p) >= MIN_SURNAME]


def surname(full_name: str) -> str:
    parts = name_parts(full_name)
    return parts[-1] if parts else ""


def names_in(full_name: str, tokens: set[str]) -> list[str]:
    """Which of this player's names the frames show.

    Prefix rather than equality: the nameplate is clipped by the frame edge as
    often as not, so "HEN" for Henry and "STROU" for Stroud are hits, while a
    three-character fragment is too weak to count either way.
    """
    hits = []
    for part in name_parts(full_name):
        if part in tokens:
            hits.append(part)
            continue
        if any(len(t) >= MIN_SURNAME and part.startswith(t) for t in tokens):
            hits.append(part)
    return hits


def fetch(url: str, dest: Path) -> bool:
    r = subprocess.run(["curl", "-s", "-L", "--max-time", "120", url,
                        "-o", str(dest)], capture_output=True)
    return r.returncode == 0 and dest.exists() and dest.stat().st_size > 10_000


def inspect(video: str, player: str, roster: set[str], fps: float = 1.0) -> dict:
    """OCR one clip and say what it shows about the claimed player."""
    want = surname(player)
    with tempfile.TemporaryDirectory() as tmp:
        paths = ocr.frames(video, tmp, fps=fps)
        tokens = ocr.words(paths)
        frames_read = len(paths)
        # The score bug lives in the bottom quarter. Reading team codes from
        # the whole frame instead picked up studio walls and tickers, which is
        # how a single Derrick Henry run came back naming fourteen teams.
        bug = ocr.words(ocr.frames(video, tmp, fps=fps,
                                   crop="crop=iw:ih*0.25:0:ih*0.75"))

    everywhere = sorted(t for t in tokens if t in scoreboard.TEAM_CODES)
    teams = sorted(t for t in bug if t in scoreboard.TEAM_CODES)
    seen_names = names_in(player, tokens)
    others = sorted({p for p in roster
                     if surname(p) and surname(p) != want and names_in(p, tokens)})

    if seen_names:
        verdict = "match"
    elif others:
        verdict = "other-name"
    elif teams:
        verdict = "team-only"
    elif not tokens:
        verdict = "no-text"
    else:
        verdict = "no-name"

    return {"verdict": verdict, "looked_for": name_parts(player),
            "names_seen": seen_names, "teams": teams,
            "teams_anywhere": everywhere, "other_players_seen": others,
            "frames": frames_read, "tokens": sorted(tokens)[:60]}


def entries() -> list[dict]:
    out = []
    for path in sorted(FEEDS.glob("*.json")):
        feed = json.loads(path.read_text())
        for t in feed.get("tweets") or []:
            if t.get("video"):
                out.append({"url": t["url"], "video": t["video"],
                            "player": t.get("player", ""), "owner": path.stem})
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--limit", type=int, default=0, help="stop after N clips")
    ap.add_argument("--fps", type=float, default=1.0)
    ap.add_argument("--redo", action="store_true", help="re-read cached clips")
    a = ap.parse_args()

    seen = json.loads(OUT.read_text()) if OUT.exists() else {}
    todo = entries()
    roster = {e["player"] for e in todo if e["player"]}

    done = 0
    for e in todo:
        if e["url"] in seen and not a.redo:
            continue
        if a.limit and done >= a.limit:
            break
        with tempfile.TemporaryDirectory() as tmp:
            clip = Path(tmp) / "clip.mp4"
            if not fetch(e["video"], clip):
                print(f"  ! could not fetch {e['player']}", file=sys.stderr)
                continue
            rec = inspect(str(clip), e["player"], roster, fps=a.fps)
        rec["player"] = e["player"]
        rec["owner"] = e["owner"]
        seen[e["url"]] = rec
        done += 1
        print(f"  {rec['verdict']:10} {e['player']:24} "
              f"teams={','.join(rec['teams']) or '-':10} frames={rec['frames']}",
              flush=True)

    OUT.write_text(json.dumps(seen, indent=1, sort_keys=True) + "\n")
    tally: dict[str, int] = {}
    for rec in seen.values():
        tally[rec["verdict"]] = tally.get(rec["verdict"], 0) + 1
    print(f"\n{done} read this run, {len(seen)} on file: "
          + ", ".join(f"{k} {v}" for k, v in sorted(tally.items())))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
