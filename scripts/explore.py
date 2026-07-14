#!/usr/bin/env python3
"""Search the Freakonomics transcript archive (BM25 over speaker-labeled passages).

Examples:
  python3 scripts/explore.py "prediction markets"
  python3 scripts/explore.py "dopamine" --show "No Stupid Questions" --top 8
  python3 scripts/explore.py "minimum wage" --speaker LEVITT
  python3 scripts/explore.py "sunk cost" --json > hits.json

Build the index first:  python3 scripts/build_index.py
"""
import json, re, pickle, math, argparse, sys
from pathlib import Path
from collections import Counter, defaultdict

ROOT = Path(__file__).resolve().parent.parent
IDX = ROOT / "data" / "search_index.pkl"
TOKEN_RE = re.compile(r"[a-z0-9]+")

def tokenize(t):
    return [w for w in TOKEN_RE.findall(t.lower()) if len(w) > 1]

def bm25(index, query_toks, k1=1.5, b=0.75):
    scores = defaultdict(float)
    N, avgdl, dl, idf = index["N"], index["avgdl"], index["doc_len"], index["idf"]
    for tok in query_toks:
        if tok not in index["postings"]:
            continue
        w = idf.get(tok, 0.0)
        for doc_idx, tf in index["postings"][tok]:
            denom = tf + k1 * (1 - b + b * dl[doc_idx] / avgdl)
            scores[doc_idx] += w * (tf * (k1 + 1)) / denom
    return scores

def snippet(text, query_toks, width=240):
    low = text.lower()
    pos = min((low.find(t) for t in query_toks if low.find(t) >= 0), default=-1)
    if pos < 0:
        return text[:width] + ("…" if len(text) > width else "")
    start = max(0, pos - width // 3)
    end = min(len(text), start + width)
    s = text[start:end]
    return ("…" if start else "") + s + ("…" if end < len(text) else "")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("query")
    ap.add_argument("--show", default=None, help="filter by show name (substring)")
    ap.add_argument("--speaker", default=None, help="filter by speaker (substring, case-insensitive)")
    ap.add_argument("--top", type=int, default=10)
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    if not IDX.exists():
        sys.exit("No index found. Run: python3 scripts/build_index.py")
    index = pickle.load(open(IDX, "rb"))
    qtoks = tokenize(args.query)
    if not qtoks:
        sys.exit("Empty query.")

    scores = bm25(index, qtoks)
    docs = index["docs"]
    ranked = sorted(scores.items(), key=lambda x: -x[1])

    results = []
    for doc_idx, score in ranked:
        d = docs[doc_idx]
        if args.show and args.show.lower() not in d["show"].lower():
            continue
        if args.speaker and args.speaker.lower() not in d["speaker"].lower():
            continue
        results.append((score, d))
        if len(results) >= args.top:
            break

    if args.json:
        print(json.dumps([{**d, "score": round(s, 3),
                           "snippet": snippet(d["text"], qtoks)} for s, d in results],
                         ensure_ascii=False, indent=2))
        return

    # count episodes touched (across all matches, not just top)
    eps = {docs[i]["ep_id"] for i, _ in ranked}
    print(f'\n🔎  "{args.query}"  —  {len(ranked):,} passages across {len(eps):,} episodes\n')
    for i, (score, d) in enumerate(results, 1):
        who = f'{d["speaker"]}: ' if d["speaker"] else ""
        print(f'{i:2}. [{score:5.1f}] {d["show"]} — "{d["title"]}" ({d["date"]})')
        print(f'    {who}{snippet(d["text"], qtoks)}')
        print(f'    {d["url"]}\n')

if __name__ == "__main__":
    main()
