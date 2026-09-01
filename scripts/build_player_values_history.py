#!/usr/bin/env python3
"""Backfill data.js player_values for past seasons so the VOR draft grader can
analyze every draft on how it looked that preseason (Sleeper's season-projection
+ ADP snapshot for that year). Keeps the existing current-year block untouched.

    python3 scripts/build_player_values_history.py            # 2020-2025
    python3 scripts/build_player_values_history.py 2022 2023   # specific years

Reuses build_player_values() and inject_section() so the numbers and the file
surgery match the rest of the pipeline.
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from build_data import build_player_values          # noqa: E402
from refresh_transactions import inject_section      # noqa: E402

DEFAULT_YEARS = ["2020", "2021", "2022", "2023", "2024", "2025"]


def main():
    years = sys.argv[1:] or DEFAULT_YEARS
    path = os.path.join(ROOT, "data.js")
    content = open(path, encoding="utf-8").read()
    obj = json.loads(content[content.index("{"): content.rindex("}") + 1])
    pv = obj.get("player_values") or {}

    for y in years:
        vals = build_player_values(y)
        if vals:
            pv[y] = vals
            print(f"  {y}: {len(vals)} players")
        else:
            print(f"  {y}: no projections, skipped")

    # Stable key order (newest first) so the diff is readable.
    ordered = {y: pv[y] for y in sorted(pv, reverse=True)}
    new_json = json.dumps(ordered, indent=1)
    new_content, changed = inject_section(content, "player_values", new_json)
    if not changed:
        print("player_values unchanged"); return
    open(path, "w", encoding="utf-8").write(new_content)
    print(f"player_values now covers: {', '.join(sorted(ordered, reverse=True))}")


if __name__ == "__main__":
    main()
