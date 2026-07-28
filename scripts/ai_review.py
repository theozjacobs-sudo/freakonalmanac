#!/usr/bin/env python3
"""AI reviewer pass: score every Fact Finder entry keep/reject like a picky editor.

Batches entries ~40 per request through the Anthropic Batch API and asks for a
keep/reject verdict, a 0-10 score, and a one-line reason per entry, applying
Stephen's editorial bar (B+ minimum; surprising, quotable, crazy-fun; hard
numbers welcome; would it make a great almanac entry?).

Output: data/ai_review.json — [{id, keep, score, reason}]
Seed into the app afterwards with: node app/scripts/seed-ai-decisions.mjs

Usage:
  export ANTHROPIC_API_KEY=sk-ant-...
  python3 scripts/ai_review.py [--model claude-opus-5] [--limit N]
Idempotent: entry ids already present in the output are skipped unless --force.
"""
import json, argparse, sys, time, re, unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENTRIES = ROOT / "data" / "entries" / "generated.json"
OUT = ROOT / "data" / "ai_review.json"
GROUP = 40

SYSTEM = """You are the AI reviewer for "Fact Finder" — candidate entries for a Freakonomics almanac book. Judge each entry like a very picky magazine editor.

THE BAR (from the author): nothing lower than a B+ makes the first cut. Keep an entry only if it would genuinely delight in a book: surprising, quotable, crazy-fun, or a hard number that reframes something. The sense of wonder matters more than importance. Reject filler, generic definitions, dry stats without a twist, inside-baseball production trivia, and anything that needs the episode's context to land.

For each entry, return: its id, keep (true/false), score (0-10, where 8 = B+), and a one-line reason. Aim to keep roughly the best 15-25% — be genuinely selective."""

SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "verdicts": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "id": {"type": "string"},
                    "keep": {"type": "boolean"},
                    "score": {"type": "integer"},
                    "reason": {"type": "string"},
                },
                "required": ["id", "keep", "score", "reason"],
            },
        }
    },
    "required": ["verdicts"],
}


def slugify(s):
    # Mirrors app/scripts/seed.mjs exactly — ids must match byte-for-byte.
    s = unicodedata.normalize("NFKD", s.lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-")[:80]


def entry_uid(e):
    # Must match app/scripts/seed.mjs id scheme: <episode.id>-<slugified headword>
    return f'{e["episode"]["id"]}-{slugify(e["headword"])}'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="claude-opus-5")
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    import anthropic
    from anthropic.types.message_create_params import MessageCreateParamsNonStreaming
    from anthropic.types.messages.batch_create_params import Request

    client = anthropic.Anthropic()

    entries = json.load(open(ENTRIES, encoding="utf-8"))
    existing = json.load(open(OUT)) if OUT.exists() and not args.force else []
    done = {v["id"] for v in existing}

    todo = []
    seen_uid = set()
    for e in entries:
        uid = entry_uid(e)
        if uid in done or uid in seen_uid:
            continue  # skip already-scored and dupe uids (seed.mjs is last-one-wins)
        seen_uid.add(uid)
        todo.append((uid, e))
    if args.limit:
        todo = todo[: args.limit]
    if not todo:
        print("Nothing to do.")
        return
    print(f"Scoring {len(todo):,} entries with {args.model} in groups of {GROUP}…")

    def render(uid, e):
        return (
            f'id: {uid}\n'
            f'headword: {e["headword"]}  [{e["entry_type"]} / {e["category"]}]\n'
            f'claim: {e["claim"]}\n'
            f'quote: "{e["quote"]}" — {e["speaker"]}\n'
            f'episode: {e["episode"]["show"]} — {e["episode"]["title"]} ({e["episode"]["date"]})'
        )

    groups = [todo[i : i + GROUP] for i in range(0, len(todo), GROUP)]
    requests = [
        Request(
            custom_id=f"g{gi}",
            params=MessageCreateParamsNonStreaming(
                model=args.model,
                max_tokens=8000,
                system=[{"type": "text", "text": SYSTEM, "cache_control": {"type": "ephemeral"}}],
                output_config={"format": {"type": "json_schema", "schema": SCHEMA}},
                messages=[{
                    "role": "user",
                    "content": "Judge these entries:\n\n" + "\n\n---\n\n".join(render(u, e) for u, e in g),
                }],
            ),
        )
        for gi, g in enumerate(groups)
    ]

    batch = client.messages.batches.create(requests=requests)
    print(f"Batch {batch.id} submitted ({len(requests)} groups); polling…")
    while True:
        b = client.messages.batches.retrieve(batch.id)
        if b.processing_status == "ended":
            break
        print(f"  {b.processing_status}: {b.request_counts.processing} processing", flush=True)
        time.sleep(30)

    valid_ids = {u for u, _ in todo}
    verdicts, bad = list(existing), 0
    for res in client.messages.batches.results(batch.id):
        if res.result.type != "succeeded":
            print(f"  ! {res.custom_id}: {res.result.type}")
            continue
        text = next((blk.text for blk in res.result.message.content if blk.type == "text"), "{}")
        try:
            for v in json.loads(text).get("verdicts", []):
                if v["id"] in valid_ids:
                    v["score"] = max(0, min(10, int(v["score"])))
                    verdicts.append(v)
                else:
                    bad += 1
        except (json.JSONDecodeError, KeyError, ValueError):
            print(f"  ! {res.custom_id}: bad JSON")

    json.dump(verdicts, open(OUT, "w"), ensure_ascii=False, indent=1)
    kept = sum(1 for v in verdicts if v["keep"])
    print(f"\n{len(verdicts):,} verdicts ({kept:,} keep = {kept/len(verdicts):.0%}); "
          f"{bad} unknown-id verdicts dropped.")
    print(f"-> {OUT.relative_to(ROOT)}")
    print("Seed into the app: node app/scripts/seed-ai-decisions.mjs")


if __name__ == "__main__":
    main()
