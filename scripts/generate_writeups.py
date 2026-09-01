#!/usr/bin/env python3
"""Regenerate the roster-context draft write-ups with Claude.

Reads the computed brief (data/{year}/draft_context.json) + the curated news
(draft_news.json) and asks Claude to author a per-team write-up that reasons about
roster construction — handcuffs behind aging/injury-prone keepers, high-ceiling
bench darts, positional need, and the news that ADP hasn't caught up to — grounded
in the exact VOR / slot-delta / keeper numbers the brief provides.

Requires ANTHROPIC_API_KEY. Writes data/{year}/draft_writeups.json, which draft.js
renders in place of the deterministic recap() template.

    python3 scripts/generate_writeups.py 2026
"""
import json, os, sys, re
import anthropic

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
YEAR = sys.argv[1] if len(sys.argv) > 1 else "2026"

SYSTEM = """You are a sharp, concise fantasy-football draft analyst for a 12-team \
half-PPR keeper league. You write one short write-up per team (about 4-6 sentences) \
that reasons about ROSTER CONSTRUCTION, not just raw value:

- Explain WHY picks were made in context: a running back drafted to back up the \
team's own aging or injury-prone keeper is smart insurance (a handcuff), not a \
wasted reach. Late-round low-projection picks on young/rookie players are \
high-ceiling dart throws, not misses.
- Use the football knowledge you have — injury history, suspensions, boom/bust \
archetypes, depth-chart roles — on top of the numbers in the brief.
- Weave in the exact numbers the brief gives you (projected points, VOR, how many \
slots past/ahead of the keeper-adjusted board a pick went) and any news items.
- Ground every claim in the brief; do not invent picks, keepers, or stats that \
aren't there. Bold player names with <strong>…</strong>. Output HTML fragments \
(no markdown).

Return ONLY a JSON object mapping each team's owner name to its write-up string. \
No prose, no code fences."""


def load(p, default):
    return json.load(open(p)) if os.path.exists(p) else default


def main():
    ctx = load(os.path.join(ROOT, "data", YEAR, "draft_context.json"), None)
    if not ctx:
        sys.exit(f"no draft_context.json for {YEAR} — run build_draft_context.py first")
    news = load(os.path.join(ROOT, "data", YEAR, "draft_news.json"), {"items": []})

    user = (f"Draft year: {YEAR}. Replacement levels: {json.dumps(ctx.get('replacement', {}))}.\n"
            f"Curated news items: {json.dumps(news.get('items', []))}\n\n"
            f"Per-team briefs (keepers, picks with vor/slot_delta/news, handcuffs, "
            f"risky_keepers, positional_need, upside_darts):\n"
            f"{json.dumps(ctx.get('teams', {}))}\n\n"
            f"Write the per-team write-ups now. Return the JSON object only.")

    client = anthropic.Anthropic()
    with client.messages.stream(
        model="claude-opus-5",
        max_tokens=16000,
        thinking={"type": "adaptive"},
        system=SYSTEM,
        messages=[{"role": "user", "content": user}],
    ) as stream:
        msg = stream.get_final_message()

    text = "".join(b.text for b in msg.content if b.type == "text").strip()
    # Robustly extract the JSON object.
    obj = json.loads(text[text.index("{"): text.rindex("}") + 1])

    out = {
        "updated": news.get("updated"),
        "note": "LLM-authored via scripts/generate_writeups.py from draft_context.json + draft_news.json.",
        "teams": obj,
    }
    outp = os.path.join(ROOT, "data", YEAR, "draft_writeups.json")
    with open(outp, "w") as f:
        json.dump(out, f, indent=1, ensure_ascii=False)
    print(f"{YEAR}: wrote {len(obj)} write-ups -> {outp}")


if __name__ == "__main__":
    main()
