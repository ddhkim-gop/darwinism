#!/usr/bin/env python3
"""Generate square cover art for each podcast episode, built around the players
the episode is actually about.

  python3 scripts/build_podcast_art.py

Art uses an ACTION frame, not a headshot: the poster image of that player's own
highlight clip from assets/highlights/*.json -- so the cover is a photo of the
play the episode is actually talking about. Frames are cached under
assets/podcasts/art/.cache/ and composited into a static PNG, so the published
page makes no third-party image request.

Add an episode to EPISODES, naming the player whose highlight should front it.
"""
import os, subprocess, sys, urllib.request

OUT   = "assets/podcasts/art"
CACHE = os.path.join(OUT, ".cache")
SIZE  = 640
HIGHLIGHTS = "assets/highlights/*.json"
# The CDN rejects urllib's default agent with a 403. A plain browser string is
# enough; it deliberately carries nothing identifying about this machine.
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36")
CHROME = ("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          "/Applications/Chromium.app/Contents/MacOS/Chromium")

# slug, label, accent, hero player, clip match.
# The clip is PINNED by a phrase from its text rather than taken as the most
# recent: highlight feeds refresh, and most broadcast posters are wide pre-snap
# frames that turn to green mush at 92px. These two are tight on the player.
EPISODES = [
    ("2026-01-the-grades-are-in",        "01", "#5a5be6", "Josh Allen",    "bulldozes"),
    ("2026-02-week-one-is-in-the-books", "02", "#3ecf8e", "Ashton Jeanty", "walks into the endzone"),
    ("2026-03-decided-by-inches",        "03", "#f6ad55", "CeeDee Lamb",   "Dak Prescott finds CeeDee Lamb"),
]


def action_frame(player, match=None):
    """Poster frame of the player's highlight clip, cached locally.

    `match` pins a specific clip by a phrase in its text; without it the most
    recent clip wins, which makes the cover art change under you on refresh.
    """
    import glob, json
    best = None
    for f in glob.glob(HIGHLIGHTS):
        for t in json.load(open(f)).get("tweets", []):
            if t.get("player") != player or not t.get("poster"):
                continue
            if match and match.lower() not in (t.get("text") or "").lower():
                continue
            if best is None or (t.get("date") or "") > (best.get("date") or ""):
                best = t
    if not best:
        print(f"    ! no highlight poster for {player}", file=sys.stderr)
        return None, None
    os.makedirs(CACHE, exist_ok=True)
    p = os.path.join(CACHE, player.replace(" ", "_").replace(".", "") + ".jpg")
    if not os.path.exists(p):
        try:
            req = urllib.request.Request(best["poster"], headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=30) as r, open(p, "wb") as f:
                f.write(r.read())
        except Exception as e:
            print(f"    ! {player}: {e}", file=sys.stderr)
            return None, None
    return "file://" + os.path.abspath(p), best.get("text", "")


def svg(label, accent, player, match):
    """One action frame, full-bleed.

    Renders at 92px in the episode table, so it is composed for a thumbnail: a
    single frame reads at that size where a montage turns to mush. The source is
    16x9, so it is scaled to cover the square and pushed right, keeping the
    centred play button off the subject.
    """
    src, _ = action_frame(player, match)
    # Source is 16:9. Scale to cover the square, then push right so the centred
    # play button lands on background rather than across the subject.
    iw = SIZE * 1.62
    ih = iw * 9 / 16
    img = (f'<image href="{src}" x="{-SIZE*0.28:.0f}" y="{(SIZE-ih)/2:.0f}" '
           f'width="{iw:.0f}" height="{ih:.0f}" preserveAspectRatio="xMidYMid slice"/>') if src else ""
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{SIZE}" height="{SIZE}" viewBox="0 0 {SIZE} {SIZE}">
  <defs>
    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0.35" stop-color="#0e1014" stop-opacity="0"/>
      <stop offset="0.74" stop-color="#0e1014" stop-opacity="0.74"/>
      <stop offset="1" stop-color="#0e1014" stop-opacity="0.97"/>
    </linearGradient>
    <linearGradient id="tint" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="{accent}" stop-opacity="0.26"/>
      <stop offset="0.65" stop-color="{accent}" stop-opacity="0.04"/>
    </linearGradient>
  </defs>
  <rect width="{SIZE}" height="{SIZE}" fill="#14161c"/>
  {img}
  <rect width="{SIZE}" height="{SIZE}" fill="url(#tint)"/>
  <rect width="{SIZE}" height="{SIZE}" fill="url(#fade)"/>
  <rect x="0" y="0" width="{SIZE}" height="10" fill="{accent}"/>
  <text x="34" y="{SIZE-42}" font-family="DM Mono, Menlo, monospace"
        font-size="46" fill="#ffffff" letter-spacing="6">EP {label}</text>
</svg>'''


def chrome():
    for c in CHROME:
        if os.path.exists(c):
            return c
    sys.exit("no Chrome/Chromium found for rasterising")


def main():
    os.makedirs(OUT, exist_ok=True)
    binary = chrome()
    for slug, label, accent, player, match in EPISODES:
        s = os.path.join(OUT, slug + ".svg")
        p = os.path.join(OUT, slug + ".png")
        with open(s, "w") as f:
            f.write(svg(label, accent, player, match))
        subprocess.run([binary, "--headless", "--disable-gpu", "--no-sandbox",
                        "--allow-file-access-from-files",
                        f"--screenshot={os.path.abspath(p)}",
                        f"--window-size={SIZE},{SIZE}",
                        "file://" + os.path.abspath(s)],
                       check=True, capture_output=True)
        os.remove(s)
        print(f"  {p}  {os.path.getsize(p)//1024} KB")


if __name__ == "__main__":
    main()
