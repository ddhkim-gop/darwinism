#!/usr/bin/env python3
"""Build assets/highlights/<team>.json from a pool of candidate X post URLs.

Discovery cannot be automated: X has no public search API, and yt-dlp has no
timeline or search extractor for it. So a human (or Claude driving a logged-in
browser) collects candidate post URLs into a pool file; everything after that
is automatic.

For each URL the script reads X's public oembed endpoint - no auth, no key -
to get the post text, author and date. It then matches the text against every
team's Sleeper roster and writes one feed per team, so a single pool fans out
across all 12 teams instead of being curated twelve times.

Usage:
    python3 scripts/build_highlights.py pool.txt              # all teams
    python3 scripts/build_highlights.py pool.txt --team ddhk   # one team
    python3 scripts/build_highlights.py pool.txt --dry-run
"""
from __future__ import annotations

import argparse
import html
import json
import re
import shutil
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
OUT_DIR = REPO / "assets" / "highlights"
LEAGUE_ID = "1373230564454191104"          # Darwinism 2026
SLEEPER = "https://api.sleeper.app/v1"
OEMBED = "https://publish.twitter.com/oembed"
MAX_PER_TEAM = 12

# Team defences are excluded: their "name" is a city or franchise, so any post
# mentioning the place matches. That produced 11 entries like a Vikings tweet
# filed under "Minnesota Vikings DEF" - a location match, not a highlight.
EXCLUDE_POSITIONS = {"DEF", "DST", "D/ST"}

# A "highlight" should be footage, not a take about a player. oembed cannot tell
# a video post from a text or photo one - pic.twitter.com appears for both - so
# yt-dlp is asked whether the post carries a playable video. Results are cached
# because the check costs a network round trip per post.
VIDEO_CACHE = REPO / "scripts" / ".highlights_video_cache.json"

# The text gate below reads captions; it cannot watch the footage. Verdicts
# from actually watching a post live here and outrank it in both directions.
REVIEWED = REPO / "scripts" / "highlights_reviewed.json"

# Surnames common enough that a bare match is meaningless - these need the
# first name too, or "Cook" pulls in every post about a coach named Cook.
AMBIGUOUS = {
    "cook", "brown", "smith", "johnson", "williams", "jones", "davis", "wilson",
    "moore", "hill", "bell", "young", "carter", "allen", "robinson", "white",
    "harris", "walker", "mitchell", "warren", "love", "james", "murray", "kirk",
    "black", "thomas", "taylor", "scott", "green", "king", "wright", "lloyd",
    "pitts", "cousins", "jackson", "adams", "evans", "collins", "reed", "hall",
}


# A post can carry video and name a player without ever showing him. These
# are the shapes that kept slipping through: a college betting prop, a fantasy
# rankings graphic, a transaction report. Each embeds video of someone.
REJECT_PATTERNS = [
    (r"\b(ncaaf|cfb|college\s*football|ncaa)\b", "college football"),
    (r"""\b(prop|props|parlay|bet|bets|betting|odds|sportsbook|
           fanduel|draftkings|underdog|\d+u|units?)\b
        | \b(over|under)\s*\d
        | (?<![\w.])[-+]\d{3}(?![\w.])""", "betting"),
    # Fantasy advice of any shape. The feed shows football, not roster takes.
    (r"""\b(ranking|rankings|tiers?|start\s*/?\s*sit|waiver|sleepers?|
           mock\s+draft|draft\s+(guide|kit|board|steal)|adp|
           top\s+\d+|best\s+ball|dynasty|redraft|
           fantasy|lineup|roster\s+(spot|crunch)|stash|
           buy\s+low|sell\s+high|breakout|bust|value|target[s]?\s+him|
           who\s+(should|would)\s+you|take\s+the\s+over)\b""",
     "fantasy advice/list"),
    # Podcasts, radio, shows and interviews. All of these embed video of a
    # person talking about football, which is not a highlight.
    (r"""\b(podcast|pod|episode|ep\.?\s*\d|full\s+episode|
           radio|show|segment|livestream|live\s+stream|
           interview|interviews|sits?\s+down|joins?\s+(us|the|on)|
           talks?\s+(about|to)|spoke|speaks|discuss(es|ing)?|
           react(s|ion|ing)?|explains?|breaks?\s+down|
           press\s+conference|presser|told\s+reporters|media\s+availability|
           on\s+how|on\s+his|on\s+what|on\s+why|asked\s+about|
           subscribe|listen|watch\s+the\s+full|clip\s+from|
           presented\s+by|via\s+@\w+\s*$)\b""", "podcast/interview/show"),
    (r"""\b(injur\w+|questionable|doubtful|ruled\s+out|placed\s+on\s+ir|
           activated|contract|extension|restructure|holdout|
           signs?|signed|waived|released|cut|suspended|fined|
           traded|acquires?|acquired|banged\s+up)\b""", "news/transaction"),
]

# Accounts whose video is essentially never a highlight: fantasy-advice shops,
# podcast feeds, news breakers whose clips are TV hits, and repost aggregators.
# A specific post from one of these can still be admitted by hand through
# highlights_reviewed.json, which outranks this list.
EXCLUDE_AUTHORS = {
    "fantasypros", "fantasyfocus", "mattharmon_byb", "ffphinest",
    "afantasyformula", "underdognfl", "balls_out_bets", "propkitchen",
    "rapsheet", "jfowlerespn", "schultz_report", "nfl_dovkleiman",
    "mysportsupdate", "dawhitehousepod", "nfl_talk_sports",
    "chisportstracks", "thescorechicago", "lostalkspats",
}

HIGHLIGHT_CUES = r"""\b(
    touchdown|tds?|score[sd]?|scoring|end\s*zone|six
  | catch|catches|caught|grab|grabs|snag|reception|hands
  | one[-\s]?hand|toe[-\s]?tap|contested|sideline|over\s+the\s+shoulder
  | juke[sd]?|hurdle[sd]?|stiff[-\s]?arm|spin|truck(ed|s)?|broke[n]?\s+tackle
  | route|releases?|footwork|separation|beat
  | deep\s+ball|dime|bomb|dot|throw[sn]?|pass|dart|launch
  | rush|run|runs|carry|carries|burst|explode[sd]?|speed
  | sack[s]?|pressure|interception|int|pick[-\s]?six|forced\s+fumble|tackle
  | highlight[s]?|reel|film|footage|clip|rep[s]?|drill[s]?
  | camp|practice|ota|preseason|scrimmage|joint\s+practice
  | wow|nasty|filthy|absurd|insane|cooking|cooked|smooth
)\b"""


def get_json(url: str, timeout: int = 30):
    req = urllib.request.Request(url, headers={"User-Agent": "highlights-builder"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


def rosters() -> dict[str, list[dict]]:
    """owner display name -> list of {name, position, team} for that roster."""
    users = {u["user_id"]: (u.get("display_name") or u.get("username") or "Unknown")
             for u in get_json(f"{SLEEPER}/league/{LEAGUE_ID}/users")}
    players = get_json(f"{SLEEPER}/players/nfl")
    out: dict[str, list[dict]] = {}
    for r in get_json(f"{SLEEPER}/league/{LEAGUE_ID}/rosters"):
        owner = users.get(r.get("owner_id"), f"team {r['roster_id']}")
        roster = []
        for pid in (r.get("players") or []):
            p = players.get(str(pid)) or {}
            name = (p.get("full_name")
                    or f"{p.get('first_name','')} {p.get('last_name','')}".strip())
            if not name:
                continue
            position = p.get("position") or ""
            if position.upper() in EXCLUDE_POSITIONS:
                continue
            roster.append({"name": name, "position": position,
                           "team": p.get("team") or "FA"})
        out[owner] = roster
    return out


def _load_reviewed() -> tuple[dict, dict]:
    if not REVIEWED.exists():
        return {}, {}
    try:
        d = json.loads(REVIEWED.read_text())
    except ValueError:
        print(f"  ! {REVIEWED.name} is not valid JSON; ignoring", file=sys.stderr)
        return {}, {}
    return d.get("keep") or {}, d.get("reject") or {}


def _load_video_cache() -> dict:
    if VIDEO_CACHE.exists():
        try:
            return json.loads(VIDEO_CACHE.read_text())
        except ValueError:
            return {}
    return {}


def has_video(url: str, cache: dict) -> bool:
    if url in cache:
        return bool(cache[url])
    if not shutil.which("yt-dlp"):
        print("  ! yt-dlp not found; cannot verify video. Install it or pass "
              "--any-post.", file=sys.stderr)
        cache[url] = False
        return False
    try:
        r = subprocess.run(
            ["yt-dlp", "-q", "--no-warnings", "--skip-download",
             "--socket-timeout", "20", "--print", "%(duration)s", url],
            capture_output=True, text=True, timeout=90, stdin=subprocess.DEVNULL)
        first = (r.stdout or "").strip().splitlines()
        ok = bool(first) and re.fullmatch(r"[0-9.]+", first[0].strip()) is not None
    except Exception:
        ok = False
    cache[url] = ok
    return ok


def oembed(url: str) -> dict | None:
    q = urllib.parse.urlencode({"url": url, "dnt": "true", "omit_script": "true"})
    try:
        data = get_json(f"{OEMBED}?{q}")
    except Exception as e:
        print(f"  ! oembed failed for {url}: {e}", file=sys.stderr)
        return None
    raw = data.get("html") or ""
    # strip tags and unescape so name matching runs on plain prose
    text = html.unescape(re.sub(r"<[^>]+>", " ", raw))
    text = re.sub(r"https?://\S+", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    # oembed puts the date in the trailing attribution line, spelled out in
    # full ("September 4, 2026"). An earlier \w{3} pattern never matched it.
    date = ""
    m = re.search(r"(January|February|March|April|May|June|July|August|September|"
                  r"October|November|December)\s+(\d{1,2}),\s+(\d{4})", text)
    if m:
        try:
            date = datetime.strptime(" ".join(m.groups()), "%B %d %Y").strftime("%Y-%m-%d")
        except ValueError:
            date = ""
    if not date:
        m = re.search(r"\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+"
                      r"(\d{1,2}),\s+(\d{4})", text)
        if m:
            try:
                date = datetime.strptime(" ".join(m.groups()), "%b %d %Y").strftime("%Y-%m-%d")
            except ValueError:
                date = ""
    return {"url": data.get("url") or url,
            "author": data.get("author_name") or "",
            "author_url": data.get("author_url") or "",
            "text": text, "date": date}


def _word(term: str) -> str:
    """A whole-word pattern for a name part. Without the boundaries, "Tate"
    matched the "tate" inside "statement" and filed a college betting prop
    under Carnell Tate."""
    return r"\b" + re.escape(term) + r"\b"


def mentions(text: str, player_name: str) -> bool:
    """Does this post name the player? Conservative on common surnames."""
    t = text.lower()
    parts = [p for p in re.split(r"\s+", player_name.lower()) if p]
    if not parts:
        return False
    first, last = parts[0], parts[-1]
    # drop suffixes so "Kyle Pitts Sr." still matches on "Pitts"
    if last in {"jr.", "sr.", "ii", "iii", "iv", "v"} and len(parts) > 2:
        last = parts[-2]
    if re.search(_word(player_name.lower()), t):
        return True
    if not re.search(_word(last), t):
        return False
    if last in AMBIGUOUS:
        return bool(re.search(_word(first), t)
                    or re.search(re.escape(f"{first[0]}. {last}"), t))
    return True


def is_highlight(text: str, player_name: str, roster_union: set[str]) -> tuple[bool, str]:
    """Does this post show a play by this player, or merely name him?

    Carrying video is not enough. A betting prop, a rankings graphic and a
    news roundup all embed video and all name players they never show. Three
    gates, all of which must pass. This reads the post's own words - it cannot
    see the footage - so it is a precision filter, not a proof.
    """
    t = text.lower()

    for pattern, why in REJECT_PATTERNS:
        if re.search(pattern, t, re.VERBOSE):
            return False, why

    # A post naming several players is a list or a slate, not one player's play.
    named = {n for n in roster_union if re.search(_word(n.split()[-1].lower()), t)}
    if len(named) >= 3:
        return False, f"names {len(named)} players (list)"

    # The play itself has to be described. Without a cue the post is a caption
    # about a player, not footage of one.
    if not re.search(HIGHLIGHT_CUES, t, re.VERBOSE):
        return False, "no play described"

    return True, ""


def build(pool: list[str], only_team: str | None, dry_run: bool,
          video_only: bool = True, highlights_only: bool = True) -> int:
    print(f"resolving {len(pool)} candidate posts via oembed"
          f"{' (video posts only)' if video_only else ''}…")
    cache = _load_video_cache()
    approved, refused = _load_reviewed()
    resolved, skipped, vetoed, by_author = [], 0, 0, 0
    for url in pool:
        if url in refused:
            vetoed += 1
            continue
        # An approved post was watched, so the video question is already settled.
        if video_only and url not in approved and not has_video(url, cache):
            skipped += 1
            continue
        info = oembed(url)
        if info:
            handle = info["author_url"].rsplit("/", 1)[-1].lower()
            if highlights_only and url not in approved and handle in EXCLUDE_AUTHORS:
                by_author += 1
                continue
            resolved.append(info)
            print(f"  ok  {info['date'] or '????-??-??'}  @{info['author_url'].rsplit('/',1)[-1]}"
                  f"  {info['text'][:58]}")
        time.sleep(0.4)          # be polite to a public endpoint
    if video_only:
        VIDEO_CACHE.write_text(json.dumps(cache, indent=1, sort_keys=True) + "\n")
        print(f"\nskipped {skipped} posts with no video")
    if vetoed:
        print(f"dropped {vetoed} posts rejected on review (watched, showed no play)")
    if by_author:
        print(f"dropped {by_author} posts from advice/podcast/news accounts")
    if not resolved:
        print("no posts resolved; nothing written", file=sys.stderr)
        return 1

    teams = rosters()
    print(f"\nmatching against {len(teams)} rosters…")
    roster_union = {p["name"] for roster in teams.values() for p in roster}
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    written = 0
    rejects: dict[str, str] = {}
    for owner, roster in sorted(teams.items()):
        slug = re.sub(r"[^a-z0-9]+", "-", owner.lower()).strip("-")
        if only_team and slug != only_team.lower():
            continue
        hits = []
        for post in resolved:
            for p in roster:
                if not mentions(post["text"], p["name"]):
                    continue
                if post["url"] in approved:
                    ok, why = True, ""      # watched and confirmed
                elif not highlights_only:
                    ok, why = True, ""
                else:
                    ok, why = is_highlight(post["text"], p["name"], roster_union)
                if not ok:
                    rejects[post["url"]] = f"{p['name']}: {why}"
                    break
                hits.append({"url": post["url"], "player": p["name"],
                             "meta": f"{p['position']} · {p['team']}",
                             "date": post["date"], "author": post["author"],
                             "verified": post["url"] in approved})
                break            # one post is filed under one player
        hits.sort(key=lambda h: h["date"] or "0000-00-00", reverse=True)
        hits = hits[:MAX_PER_TEAM]
        feed = {"team": owner,
                "updated": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                "note": "Curated: X has no public search API, so posts are "
                        "collected by hand and matched to rosters by this script.",
                "tweets": hits}
        players = len({h["player"] for h in hits})
        print(f"  {slug:<22} {len(hits):>2} posts  {players:>2} players")
        if not dry_run:
            (OUT_DIR / f"{slug}.json").write_text(json.dumps(feed, indent=2) + "\n")
            written += 1
    if rejects:
        print(f"\nrejected {len(rejects)} posts that named a player but showed "
              f"no play by him:")
        for url, why in sorted(rejects.items(), key=lambda kv: kv[1]):
            print(f"  - {why:<44} {url}")
    print(f"\n{'dry run - nothing written' if dry_run else f'wrote {written} feeds to {OUT_DIR}'}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pool", help="file of candidate X post URLs, one per line")
    ap.add_argument("--team", help="only rebuild this team's feed (slug)")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--any-post", action="store_true",
                    help="keep text-only posts too (default: video posts only)")
    ap.add_argument("--any-mention", action="store_true",
                    help="keep posts that merely name the player (default: the "
                         "post must describe a play by him)")
    a = ap.parse_args()
    urls = [l.strip() for l in Path(a.pool).read_text().splitlines()
            if l.strip() and not l.startswith("#")]
    return build(urls, a.team, a.dry_run, video_only=not a.any_post,
                 highlights_only=not a.any_mention)


if __name__ == "__main__":
    raise SystemExit(main())
