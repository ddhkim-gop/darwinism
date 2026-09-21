#!/usr/bin/env python3
"""On-device OCR, via the Vision framework macOS already ships.

An earlier version of this pipeline asserted "this machine has no OCR" and
built everything around a human reading frames. That was wrong: Vision is in
the OS, needs no key, no install and no network, and reads a burned-in score
bug at confidence 1.00. Nothing leaves the machine - which matters here,
because the alternative was uploading broadcast frames to some API.

Swift is the only way in without a dependency, so the helper is compiled once
into `scripts/.ocr-bin` and reused. Compilation takes a few seconds and happens
on first call; if `swiftc` is missing the caller gets a clear error rather than
a silent empty read.
"""
from __future__ import annotations

import re
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
BIN = HERE / ".ocr-bin"
SRC = HERE / "ocr_vision.swift"

# Anything under this is Vision guessing at a blurred jersey mid-motion.
MIN_CONFIDENCE = 0.5


class OCRUnavailable(RuntimeError):
    """Vision could not be reached - no swiftc, not macOS, or build failed."""


def _build() -> Path:
    if BIN.exists() and BIN.stat().st_mtime >= SRC.stat().st_mtime:
        return BIN
    if sys.platform != "darwin":
        raise OCRUnavailable("Vision OCR is macOS-only")
    if not shutil.which("swiftc"):
        raise OCRUnavailable("swiftc not found; install Xcode command line tools")
    r = subprocess.run(["swiftc", "-O", "-o", str(BIN), str(SRC)],
                       capture_output=True, text=True)
    if r.returncode != 0 or not BIN.exists():
        raise OCRUnavailable(f"could not build the OCR helper: {r.stderr[:200]}")
    return BIN


def read(paths: list[str], min_confidence: float = MIN_CONFIDENCE) -> dict[str, list[str]]:
    """image path -> the text lines Vision is confident about, in reading order."""
    if not paths:
        return {}
    out: dict[str, list[str]] = {p: [] for p in paths}
    r = subprocess.run([str(_build()), *paths], capture_output=True, text=True)
    current = None
    for line in r.stdout.splitlines():
        if line.startswith("## "):
            current = line[3:]
            out.setdefault(current, [])
            continue
        if current is None or "\t" not in line:
            continue
        parts = line.split("\t")
        if len(parts) < 2:
            continue
        text, conf = parts[0].strip(), parts[1]
        try:
            if float(conf) >= min_confidence and text:
                out[current].append(text)
        except ValueError:
            continue
    return out


def boxes(paths: list[str], min_confidence: float = MIN_CONFIDENCE) -> dict[str, list[dict]]:
    """Same read, but keeping where on the frame each line sat.

    Pairing a score with its team needs geometry - the bug puts the number to
    the right of the code, and reading the tokens as an unordered bag gives
    "DAL NYG 7 19" with no way to say which is which. Coordinates are Vision's:
    origin bottom-left, normalised to 0-1.
    """
    if not paths:
        return {}
    out: dict[str, list[dict]] = {p: [] for p in paths}
    r = subprocess.run([str(_build()), *paths], capture_output=True, text=True)
    current = None
    for line in r.stdout.splitlines():
        if line.startswith("## "):
            current = line[3:]
            out.setdefault(current, [])
            continue
        parts = line.split("\t")
        if current is None or len(parts) < 3:
            continue
        try:
            conf = float(parts[1])
            x, y, w, h = (float(v) for v in parts[2].split())
        except ValueError:
            continue
        if conf < min_confidence or not parts[0].strip():
            continue
        out[current].append({"text": parts[0].strip(), "conf": conf,
                             "x": x, "y": y, "w": w, "h": h})
    return out


def words(paths: list[str], min_confidence: float = MIN_CONFIDENCE) -> set[str]:
    """Every distinct uppercase token seen across these frames.

    Uppercased and split because a nameplate reads "LAMB", a score bug reads
    "DAL O" when the zero is clipped, and matching wants tokens not lines.
    """
    seen: set[str] = set()
    for lines in read(paths, min_confidence).values():
        for line in lines:
            for tok in re.split(r"[^A-Za-z0-9&:.'-]+", line.upper()):
                if tok:
                    seen.add(tok)
    return seen


def frames(video: str, out_dir: str, fps: float = 1.0, width: int = 1280,
           crop: str | None = None) -> list[str]:
    """Sample a clip to JPEGs for OCR. `crop` is an ffmpeg crop expression."""
    d = Path(out_dir)
    d.mkdir(parents=True, exist_ok=True)
    for old in d.glob("*.jpg"):
        old.unlink()
    vf = f"fps={fps}," + (f"{crop}," if crop else "") + f"scale={width}:-2"
    subprocess.run(["ffmpeg", "-v", "error", "-i", video, "-vf", vf,
                    str(d / "%03d.jpg"), "-y"], check=False)
    return sorted(str(p) for p in d.glob("*.jpg"))


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: ocr.py IMAGE [IMAGE…]   |   ocr.py --video CLIP", file=sys.stderr)
        return 2
    try:
        if sys.argv[1] == "--video":
            import tempfile
            with tempfile.TemporaryDirectory() as tmp:
                paths = frames(sys.argv[2], tmp)
                for tok in sorted(words(paths)):
                    print(tok)
        else:
            for path, lines in read(sys.argv[1:]).items():
                print(f"## {path}")
                print("\n".join(lines))
    except OCRUnavailable as e:
        print(f"OCR unavailable: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
