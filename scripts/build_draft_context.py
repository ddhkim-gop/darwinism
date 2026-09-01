#!/usr/bin/env python3
"""Build a per-team structural brief for the write-up engine.

The narrative engine (LLM) needs more than stats+news — it needs roster-construction
context: which picks are handcuffs to the team's own keepers, how old / injury-prone
those keepers are, where the team is thin or stacked, and which late picks are
upside darts. This script computes everything our data supports and writes it to
data/{year}/draft_context.json. A curated LLM pass then turns each brief into a
write-up in data/{year}/draft_writeups.json (rendered by draft.js in place of the
deterministic template recap()).

Mirrors the VOR / keeper-adjusted-board / news math in draft.js so the numbers a
write-up cites match the badges on screen. Runs entirely off data.js — no network.
"""
import json, os, sys, re
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
YEAR = sys.argv[1] if len(sys.argv) > 1 else "2026"

STARTER_SLOTS = {"QB": 1, "RB": 2, "WR": 3, "TE": 1, "K": 1, "DEF": 1}
FLEX_POS = {"RB", "WR", "TE"}
REPLACEMENT_RANK = {"QB": 13, "RB": 31, "WR": 43, "TE": 14, "K": 13, "DEF": 13}
# Age past which a back/receiver's floor is a real concern (fantasy aging curves).
AGE_RISK = {"RB": 28, "WR": 30, "TE": 30, "QB": 34}


def load_static():
    txt = open(os.path.join(ROOT, "data.js"), encoding="utf-8").read()
    return json.loads(txt[txt.index("{"): txt.rindex("}") + 1])


def base_pos(p):
    p = (p or "").split("/")[0].upper()
    return "DEF" if p in ("DST", "D/ST") else p


def age_from(birth):
    if not birth:
        return None
    y, m, d = map(int, birth.split("-"))
    # Fixed reference (season kickoff) — no Date.now() so results are stable.
    ry, rm, rd = 2026, 9, 1
    return round(ry - y - ((rm, rd) < (m, d)), 1)


def norm(s):
    return re.sub(r"[^a-z]", "", (s or "").lower())


def main():
    obj = load_static()
    picks_all = (obj.get("draft") or {}).get(YEAR) or []
    keepers = (obj.get("keepers") or {}).get(YEAR) or {}
    values = (obj.get("player_values") or {}).get(YEAR) or {}
    nmap = obj.get("player_name_map") or {}
    pcache = json.load(open(os.path.join(ROOT, "scripts", "players_cache.json")))["players"]
    news = {}
    npath = os.path.join(ROOT, "data", YEAR, "draft_news.json")
    if os.path.exists(npath):
        for i in json.load(open(npath)).get("items", []):
            news[norm(i["player"])] = i

    val = lambda pid: values.get(str(pid), {})
    meta = lambda pid: pcache.get(str(pid), {})

    # ── Build pool (picks + keepers) with proj/vor ──────────────────────────────
    pool = []
    for p in picks_all:
        pid = nmap.get(p["player"])
        pool.append({"id": pid, "name": p["player"], "pos": base_pos(p["position"]),
                     "nfl": p.get("team"), "owner": p["picked_by"], "pick_no": p["pick_no"],
                     "round": p["round"], "keeper": False,
                     "proj": val(pid).get("proj", 0) or 0, "adp": val(pid).get("adp"),
                     "age": age_from(p.get("birth_date") or meta(pid).get("birth_date")),
                     "exp": meta(pid).get("years_exp"),
                     "inj": meta(pid).get("injury_status")})
    for owner, ks in keepers.items():
        for k in ks:
            pid = k["player_id"]
            pool.append({"id": pid, "name": k["name"], "pos": base_pos(k["position"]),
                         "nfl": k.get("team"), "owner": owner, "pick_no": 0, "round": 0,
                         "keeper": True, "proj": val(pid).get("proj", 0) or 0,
                         "adp": val(pid).get("adp"),
                         "age": age_from(k.get("birth_date") or meta(pid).get("birth_date")),
                         "exp": k.get("years_exp"), "inj": meta(pid).get("injury_status")})

    # Replacement level + VOR
    by_pos = defaultdict(list)
    for x in pool:
        by_pos[x["pos"]].append(x)
    repl = {}
    for pos, arr in by_pos.items():
        arr.sort(key=lambda x: -x["proj"])
        idx = min((REPLACEMENT_RANK.get(pos, 13)) - 1, len(arr) - 1)
        repl[pos] = arr[idx]["proj"] if arr else 0
    for x in pool:
        x["vor"] = 0 if x["pos"] in ("K", "DEF") else round(max(0, x["proj"] - repl.get(x["pos"], 0)), 1)

    # Keeper-adjusted board + news-adjusted slotDelta
    kept_ids = {str(x["id"]) for x in pool if x["keeper"]}
    adp_board = sorted(((pid, v["adp"]) for pid, v in values.items()
                        if v.get("adp") is not None and pid not in kept_ids),
                       key=lambda t: t[1])
    exp_slot = {pid: i + 1 for i, (pid, _) in enumerate(adp_board)}
    for x in pool:
        if x["keeper"]:
            continue
        es = exp_slot.get(str(x["id"]))
        x["exp_slot"] = es
        x["slot_delta"] = (x["pick_no"] - es) if (es is not None and es <= 260) else None
        n = news.get(norm(x["name"]))
        if n:
            x["news"] = {"rationale": n["rationale"], "verdict": n.get("verdict_override")}
            if n.get("board_shift") is not None and es is not None:
                adj = es + n["board_shift"]
                if adj <= 300:
                    x["slot_delta"] = x["pick_no"] - adj

    # ── Per-team brief ──────────────────────────────────────────────────────────
    teams = {}
    for owner in {x["owner"] for x in pool}:
        ks = sorted([x for x in pool if x["keeper"] and x["owner"] == owner], key=lambda x: -x["proj"])
        ps = sorted([x for x in pool if not x["keeper"] and x["owner"] == owner], key=lambda x: x["pick_no"])
        roster = ks + ps

        # Positional need vs starter slots (from keepers + startable picks)
        counts = defaultdict(int)
        for x in roster:
            if x["pos"] in STARTER_SLOTS:
                counts[x["pos"]] += 1
        need = {pos: STARTER_SLOTS[pos] - counts.get(pos, 0) for pos in STARTER_SLOTS}
        thin = [pos for pos, n in need.items() if n > 0 and pos not in ("K", "DEF")]
        deep = [pos for pos in ("RB", "WR", "TE") if counts.get(pos, 0) >= STARTER_SLOTS[pos] + 3]

        # Handcuffs: a pick that backs up one of THIS team's keepers/picks
        # (same NFL team + same running-position). Flag the starter it insures.
        starters_by_team = {}
        for x in roster:
            if x["pos"] in ("RB",) and x["nfl"]:
                starters_by_team.setdefault((x["nfl"], x["pos"]), []).append(x)
        handcuffs = []
        for p in ps:
            if p["pos"] != "RB" or not p["nfl"]:
                continue
            mates = [m for m in starters_by_team.get((p["nfl"], "RB"), [])
                     if m["name"] != p["name"] and (m["proj"] > p["proj"] or m["keeper"])]
            if mates:
                lead = max(mates, key=lambda m: m["proj"])
                handcuffs.append({"pick": p["name"], "insures": lead["name"],
                                  "lead_keeper": lead["keeper"], "lead_age": lead["age"],
                                  "lead_inj": lead["inj"], "pick_round": p["round"]})

        # Aging / injury-risk keepers (context for why insurance matters)
        risky_keepers = [{"name": k["name"], "pos": k["pos"], "age": k["age"], "inj": k["inj"]}
                         for k in ks if (k["age"] and k["age"] >= AGE_RISK.get(k["pos"], 99)) or k["inj"]]

        # Late-round upside darts: last 4 rounds, low projection but young/rookie
        darts = [{"name": p["name"], "pos": p["pos"], "round": p["round"], "pick_no": p["pick_no"],
                  "age": p["age"], "rookie": (p["exp"] == 0)}
                 for p in ps if p["round"] >= 12 and (p["exp"] == 0 or (p["age"] and p["age"] <= 24))]

        teams[owner] = {
            "owner": owner,
            "keepers": [{"name": k["name"], "pos": k["pos"], "nfl": k["nfl"], "age": k["age"],
                         "proj": round(k["proj"], 1), "inj": k["inj"]} for k in ks],
            "keeper_proj": round(sum(k["proj"] for k in ks), 1),
            "picks": [{"name": p["name"], "pos": p["pos"], "nfl": p["nfl"], "round": p["round"],
                       "pick_no": p["pick_no"], "proj": round(p["proj"], 1), "adp": p["adp"],
                       "vor": p["vor"], "slot_delta": p.get("slot_delta"), "age": p["age"],
                       "rookie": (p["exp"] == 0), "inj": p["inj"], "news": p.get("news")}
                      for p in ps],
            "positional_need": {"thin": thin, "deep": deep},
            "handcuffs": handcuffs,
            "risky_keepers": risky_keepers,
            "upside_darts": darts,
        }

    out = {"year": YEAR, "replacement": {k: round(v, 1) for k, v in repl.items()}, "teams": teams}
    outp = os.path.join(ROOT, "data", YEAR, "draft_context.json")
    with open(outp, "w") as f:
        json.dump(out, f, indent=1)
    hc = sum(len(t["handcuffs"]) for t in teams.values())
    print(f"{YEAR}: {len(teams)} teams, {hc} handcuffs flagged -> {outp}")


if __name__ == "__main__":
    main()
