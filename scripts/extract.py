#!/usr/bin/env python3
"""Fact Finder extractor — the production pipeline.

Reads per-episode transcripts and asks Claude to extract encyclopedia entries
(concept / figure / fact / person / place / story), each with a VERBATIM quote
+ speaker, using the Batch API (50% cheaper, async) with prompt caching on the
shared instructions. Every returned quote is verified against the source
transcript before it's kept.

Usage:
  export ANTHROPIC_API_KEY=sk-ant-...           # required
  python3 scripts/extract.py --show "Freakonomics Radio" --limit 50
  python3 scripts/extract.py --all                       # every episode with a transcript
  python3 scripts/extract.py --ids 128037 128029 ...     # specific episodes
  python3 scripts/build_site.py data/entries/generated.json   # render the result

Notes:
  - Defaults to claude-opus-5. Pass --model claude-sonnet-5 (or claude-haiku-4-5)
    to trade some quality for lower cost on the full 1,604-episode run.
  - Idempotent: episodes already present in the output file are skipped unless --force.
  - If data/replay_skiplist.json exists (built by scripts/dedupe_replays.py),
    --all / --show selection excludes those replay/duplicate episodes; pass
    --include-replays to process them anyway.
"""
import os, re, json, glob, argparse, sys, time
from pathlib import Path
from datetime import date
from collections import Counter

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "entries" / "generated.json"
SKIPLIST = ROOT / "data" / "replay_skiplist.json"
TODAY = date(2026, 7, 14)

SYSTEM = """You build "Fact Finder" — an A–Z almanac of Freakonomics Radio, drawn ONLY from the show's own transcripts.

From the transcript you are given, extract the strongest encyclopedia-style entries. For each entry return:
- headword: the term this files under, written as an encyclopedia headword (e.g. "Regression to the mean", "CPM (cost per mille)", "Airline Deregulation Act"). Title-case the first word.
- entry_type: exactly one of "concept", "figure", "fact", "person", "place", or "story".
    * figure = a hard number or statistic
    * concept = a named idea, effect, model, or mechanism
    * fact = a concrete historical/definitional fact
    * person = a notable person DISCUSSED in the episode (not merely a guest who happens to be speaking). Headword = their name; claim = who they are / what they did, strictly per the transcript.
    * place = a location with a real story attached (e.g. a Pennsylvania town that's home to America's oldest brewery; a city subway system that changed how newspapers report suicides). Headword = the place name.
    * story = a self-contained, crazy-fun narrative bit — an anecdote or saga, not a stat (e.g. the economics of pet cremation, a reef fish that runs a cleaning business, a company that pays new hires to quit). Give it a punchy encyclopedia-style headword. The editorial voice leans playful and surprising.
- category: a short topical label (e.g. "Health economics", "Behavioral economics", "Media economics").
- claim: the fact stated plainly in 1–2 sentences, in your own words.
- quote: a VERBATIM span copied EXACTLY from the transcript that supports the claim. Copy it character-for-character — do not paraphrase, trim mid-word, or fix punctuation. Keep it under ~50 words; pick the sentence that best carries the fact.
- speaker: who said the quoted line (use the SPEAKER label in the transcript; write "narration" for host narration with no label).

Rules:
- Use ONLY what is in this transcript. Never add outside facts, figures, or context the transcript doesn't contain.
- Lean toward surprising or quotable material and hard numbers, but include a few steady, definitional facts too.
- Include person, place, and story entries when the episode genuinely supports them — a memorable character, a place with a real tale attached, a narrative gem. Don't force one of each type; let the episode decide the mix.
- The quote MUST appear verbatim in the transcript — this is checked programmatically and non-matching entries are discarded.
- Return the 5–9 best entries. Quality over quantity; skip filler.
"""

SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "entries": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "headword": {"type": "string"},
                    "entry_type": {"type": "string", "enum": ["concept", "figure", "fact", "person", "place", "story"]},
                    "category": {"type": "string"},
                    "claim": {"type": "string"},
                    "quote": {"type": "string"},
                    "speaker": {"type": "string"},
                },
                "required": ["headword", "entry_type", "category", "claim", "quote", "speaker"],
            },
        }
    },
    "required": ["entries"],
}

def norm(s):
    for a, b in [("’","'"),("‘","'"),("“",'"'),("”",'"'),
                 ("—","-"),("–","-"),("…","...")]:
        s = s.replace(a, b)
    return re.sub(r"\s+", " ", s).strip().lower()

def freshness(entry_type, age):
    if entry_type == "figure":
        if age >= 4: return "check", f"Figure is ~{age} yrs old — verify before publishing"
        if age >= 2: return "aging", f"Figure is ~{age} yrs old — likely still ok"
        return "current", f"Recent (~{age} yrs) — likely current"
    if entry_type == "concept":
        return "evergreen", "Concept — not time-sensitive"
    if entry_type == "fact":
        return "durable", "Historical fact — stable over time"
    # person / place / story — durable, like facts
    return "durable", f"{entry_type.capitalize()} entry — stable over time"

def load_episodes(args):
    eps = {}
    for f in glob.glob(str(ROOT / "data/episodes/**/*.json"), recursive=True):
        r = json.load(open(f, encoding="utf-8"))
        eps[r["id"]] = r
    if args.ids:
        picked = [eps[i] for i in args.ids if i in eps]
    else:
        picked = [r for r in eps.values() if r.get("transcript", "").strip()]
        if args.show:
            picked = [r for r in picked if args.show.lower() in r["show"].lower()]
        if not args.include_replays and SKIPLIST.exists():
            skip_ids = {e["id"] for e in json.load(open(SKIPLIST, encoding="utf-8"))}
            before = len(picked)
            picked = [r for r in picked if r["id"] not in skip_ids]
            if before != len(picked):
                print(f"Excluding {before - len(picked)} replay/duplicate episodes "
                      f"per {SKIPLIST.relative_to(ROOT)} (use --include-replays to keep them).")
        picked.sort(key=lambda r: r["date"])
        if args.limit:
            picked = picked[: args.limit]
    return picked

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--show", default=None)
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--ids", nargs="*", default=None)
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--model", default="claude-opus-5")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--include-replays", action="store_true",
                    help="Do not exclude episodes listed in data/replay_skiplist.json")
    args = ap.parse_args()
    if not (args.show or args.ids or args.all or args.limit):
        sys.exit("Specify --show / --limit / --ids / --all")

    import anthropic
    from anthropic.types.message_create_params import MessageCreateParamsNonStreaming
    from anthropic.types.messages.batch_create_params import Request
    client = anthropic.Anthropic()  # reads ANTHROPIC_API_KEY

    OUT.parent.mkdir(parents=True, exist_ok=True)
    existing = json.load(open(OUT)) if OUT.exists() else []
    done_ids = {e["episode"]["id"] for e in existing} if not args.force else set()

    episodes = [e for e in load_episodes(args) if e["id"] not in done_ids]
    if not episodes:
        print("Nothing to do (all selected episodes already extracted; use --force to redo).")
        return
    print(f"Extracting {len(episodes)} episodes with {args.model} via Batch API…")

    requests = [
        Request(
            custom_id=ep["id"],
            params=MessageCreateParamsNonStreaming(
                model=args.model,
                max_tokens=4000,
                system=[{"type": "text", "text": SYSTEM, "cache_control": {"type": "ephemeral"}}],
                output_config={"format": {"type": "json_schema", "schema": SCHEMA}},
                messages=[{"role": "user", "content":
                    f'Show: {ep["show"]}\nEpisode: {ep["title"]}\n\nTRANSCRIPT:\n{ep["transcript"]}'}],
            ),
        )
        for ep in episodes
    ]
    batch = client.messages.batches.create(requests=requests)
    print(f"Batch {batch.id} submitted; polling…")
    while True:
        b = client.messages.batches.retrieve(batch.id)
        if b.processing_status == "ended":
            break
        print(f"  {b.processing_status}: {b.request_counts.processing} processing", flush=True)
        time.sleep(30)

    ep_by_id = {e["id"]: e for e in episodes}
    kept, dropped = list(existing), 0
    for res in client.messages.batches.results(batch.id):
        if res.result.type != "succeeded":
            print(f"  ! {res.custom_id}: {res.result.type}")
            continue
        ep = ep_by_id[res.custom_id]
        tx = norm(ep["transcript"])
        yr = int(ep["date"][:4]); age = TODAY.year - yr
        text = next((b.text for b in res.result.message.content if b.type == "text"), "{}")
        try:
            entries = json.loads(text).get("entries", [])
        except json.JSONDecodeError:
            print(f"  ! {res.custom_id}: bad JSON"); continue
        for e in entries:
            if norm(e["quote"]) not in tx:
                dropped += 1; continue   # ungrounded — discard
            flag, note = freshness(e["entry_type"], age)
            kept.append({
                "headword": e["headword"], "entry_type": e["entry_type"], "category": e["category"],
                "claim": e["claim"], "quote": e["quote"], "speaker": e["speaker"],
                "episode": {"title": ep["title"], "show": ep["show"], "id": ep["id"],
                            "date": ep["date"][:10], "url": ep["url"]},
                "age_years": age, "freshness": flag, "freshness_note": note,
                "verified_quote_in_transcript": True,
            })
    kept.sort(key=lambda e: e["headword"].lower())
    json.dump(kept, open(OUT, "w"), ensure_ascii=False, indent=2)
    by_type = Counter(e["entry_type"] for e in kept)
    print(f"\nKept {len(kept)} grounded entries ({dict(by_type)}); dropped {dropped} ungrounded.")
    print(f"-> {OUT.relative_to(ROOT)}")
    print(f"Render: python3 scripts/build_site.py {OUT.relative_to(ROOT)}")

if __name__ == "__main__":
    main()
