#!/usr/bin/env python3
"""Backfill data.js `keepers` for past seasons so the VOR draft grader values
each team's full roster (drafted picks + off-board keepers), not just the picks.

Past seasons ARE keeper leagues — e.g. in 2022 ddhk kept Adams/Evans/Kelce off
the board. Without this, renderCurrentDraftGrades treats those drafts as
keeperless and understates rosters. Seasons with no off-board keepers that year
(2020 startup, and 2025) correctly resolve to {}. Companion to
build_player_values_history.py; keeps the current-year block untouched.

    python3 scripts/build_keepers_history.py            # 2021-2025 (2020 has no prior)
    python3 scripts/build_keepers_history.py 2022 2023   # specific years

Reuses build_keepers() + inject_section() so the logic and file surgery match the
rest of the pipeline. Uses a light league loader (skips matchups, which
build_keepers doesn't need) so it finishes quickly.
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import build_data as B                               # noqa: E402
from refresh_transactions import inject_section       # noqa: E402

ALL_YEARS = ["2020", "2021", "2022", "2023", "2024", "2025", "2026"]


def light_load(year):
    """Only what build_keepers needs: rosters, rid_name, draft_picks, txns_raw."""
    lid = B.LEAGUES[year]
    rosters = B.fetch(f"https://api.sleeper.app/v1/league/{lid}/rosters") or []
    users = B.fetch(f"https://api.sleeper.app/v1/league/{lid}/users") or []
    uid = {u["user_id"]: u.get("display_name", "Unknown") for u in users}
    rid = {r["roster_id"]: uid.get(r.get("owner_id"), "Unknown") for r in rosters}
    drafts = B.fetch(f"https://api.sleeper.app/v1/league/{lid}/drafts") or []
    dp = B.fetch(f"https://api.sleeper.app/v1/draft/{drafts[0]['draft_id']}/picks") if drafts else []
    txns = {}
    for wk in range(0, 19):
        t = B.fetch(f"https://api.sleeper.app/v1/league/{lid}/transactions/{wk}")
        if t:
            txns[wk] = t
    return {"rosters": rosters, "rid_name": rid, "draft_picks": dp or [], "txns_raw": txns}


def main():
    years = sys.argv[1:] or ["2021", "2022", "2023", "2024", "2025"]
    players = B.load_players()

    path = os.path.join(ROOT, "data.js")
    content = open(path, encoding="utf-8").read()
    obj = json.loads(content[content.index("{"): content.rindex("}") + 1])
    keepers = obj.get("keepers") or {}

    for y in years:
        i = ALL_YEARS.index(y)
        cur = light_load(y)
        prev = light_load(ALL_YEARS[i - 1]) if i > 0 else None
        keepers[y] = B.build_keepers(cur, prev, players) if prev else {}
        print(f"  {y}: keepers={sum(len(v) for v in keepers[y].values())}")

    ordered = {y: keepers[y] for y in sorted(keepers, reverse=True)}
    new_content, changed = inject_section(content, "keepers", json.dumps(ordered, indent=1))
    if not changed:
        print("keepers unchanged"); return
    open(path, "w", encoding="utf-8").write(new_content)
    print(f"keepers now covers: {', '.join(sorted(ordered, reverse=True))}")


if __name__ == "__main__":
    main()
