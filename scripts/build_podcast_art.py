#!/usr/bin/env python3
"""Generate square cover art for each podcast episode.

  python3 scripts/build_podcast_art.py

One SVG per episode, rasterised to PNG via headless Chrome. The art is
deliberately generative rather than illustrative: a seeded field of bars whose
heights come from the episode slug, so every episode is visually distinct but
unmistakably the same series. Palette is the site's own tokens.

Episodes are declared in EPISODES below -- keep in step with podcasts.js.
"""
import hashlib, os, subprocess, sys

OUT = "assets/podcasts/art"
SIZE = 640
CHROME = ("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          "/Applications/Chromium.app/Contents/MacOS/Chromium")

# slug, episode label, accent pair (from style.css tokens)
EPISODES = [
    ("2026-01-the-grades-are-in",     "01", "#5a5be6", "#e74c82"),
    ("2026-02-week-one-is-in-the-books", "02", "#3ecf8e", "#4299e1"),
]


def bars(seed, n=14):
    """Deterministic bar heights in [0.18, 1.0] derived from the slug."""
    h = hashlib.sha256(seed.encode()).digest()
    return [0.18 + (h[i % len(h)] / 255.0) * 0.82 for i in range(n)]


def svg(slug, label, c1, c2):
    hs = bars(slug)
    n = len(hs)
    gap, pad = 6, 54
    bw = (SIZE - pad * 2 - gap * (n - 1)) / n
    rects = []
    for i, v in enumerate(hs):
        bh = v * (SIZE - pad * 2) * 0.62
        x = pad + i * (bw + gap)
        y = SIZE - pad - bh
        t = i / (n - 1)
        rects.append(
            f'<rect x="{x:.1f}" y="{y:.1f}" width="{bw:.1f}" height="{bh:.1f}" '
            f'rx="{bw/2:.1f}" fill="url(#g)" opacity="{0.35 + 0.65*t:.2f}"/>')
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{SIZE}" height="{SIZE}" viewBox="0 0 {SIZE} {SIZE}">
  <defs>
    <linearGradient id="g" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0" stop-color="{c1}"/><stop offset="1" stop-color="{c2}"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.3" cy="0.25" r="0.9">
      <stop offset="0" stop-color="{c1}" stop-opacity="0.30"/>
      <stop offset="1" stop-color="{c1}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="{SIZE}" height="{SIZE}" fill="#14161c"/>
  <rect width="{SIZE}" height="{SIZE}" fill="url(#glow)"/>
  {''.join(rects)}
  <text x="{pad}" y="{pad + 46}" font-family="DM Sans, Helvetica, Arial, sans-serif"
        font-size="46" font-weight="700" fill="#f0f1f3" letter-spacing="-1">DARWINISM</text>
  <text x="{pad}" y="{pad + 86}" font-family="DM Mono, Menlo, monospace"
        font-size="26" fill="{c1}" letter-spacing="3">EP {label}</text>
</svg>'''


def chrome():
    for c in CHROME:
        if os.path.exists(c):
            return c
    sys.exit("no Chrome/Chromium found for rasterising")


def main():
    os.makedirs(OUT, exist_ok=True)
    binary = chrome()
    for slug, label, c1, c2 in EPISODES:
        s = os.path.join(OUT, slug + ".svg")
        p = os.path.join(OUT, slug + ".png")
        with open(s, "w") as f:
            f.write(svg(slug, label, c1, c2))
        subprocess.run([binary, "--headless", "--disable-gpu", "--no-sandbox",
                        f"--screenshot={os.path.abspath(p)}",
                        f"--window-size={SIZE},{SIZE}", "--default-background-color=00000000",
                        "file://" + os.path.abspath(s)],
                       check=True, capture_output=True)
        os.remove(s)                       # PNG is the shipped asset; SVG is scaffolding
        print(f"  {p}  {os.path.getsize(p)//1024} KB")


if __name__ == "__main__":
    main()
