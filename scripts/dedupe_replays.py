#!/usr/bin/env python3
"""Flag replay/rebroadcast episodes whose transcripts duplicate an earlier episode.

Freakonomics re-airs shows under titles containing "Replay", "Rebroadcast",
"Encore", "(Update)", etc. Roughly 15-20% of transcripts are near-duplicates of
an earlier episode. This script flags:

  1. Episodes whose title matches the replay regex AND whose transcript is
     >= 0.8 similar to an earlier-dated episode. Similarity is the containment
     ratio: the fraction of the later episode's word shingles already present
     in the earlier transcript — so "Update" episodes with substantial new
     material score below the threshold and are KEPT.
  2. Exact-duplicate transcripts regardless of title (keep the earliest).

Output: data/replay_skiplist.json — [{id, title, date, duplicate_of, similarity}]
scripts/extract.py excludes these IDs from --all / --show selection unless
--include-replays is passed.

Stdlib only. Run scripts/parse_wxr.py first to populate data/episodes/.
"""
import re, json, glob, hashlib, sys
from collections import defaultdict, Counter
from pathlib import Path
from zlib import crc32

ROOT = Path(__file__).resolve().parent.parent
EP_DIR = ROOT / "data" / "episodes"
OUT = ROOT / "data" / "replay_skiplist.json"

REPLAY_RE = re.compile(
    r"\b(replay|rebroadcast|re-broadcast|encore|rerun|re-run|re-release|"
    r"rebroadcasted|update[d]?|revisited)\b", re.I)

SHINGLE = 8        # words per shingle
SAMPLE_MOD = 8     # sample shingle hashes where h % SAMPLE_MOD == 0
THRESHOLD = 0.8    # containment threshold to call something a replay
CANDIDATE_EST = 0.5  # sampled-containment floor to bother verifying exactly


def norm(text):
    """Normalize a transcript: lowercase + collapse all whitespace."""
    return re.sub(r"\s+", " ", text.lower()).strip()


def shingles(text):
    """Full set of crc32-hashed word shingles (stable across runs)."""
    words = text.split()
    if len(words) < SHINGLE:
        return {crc32(text.encode())}
    return {crc32(" ".join(words[i:i + SHINGLE]).encode())
            for i in range(len(words) - SHINGLE + 1)}


def sample_of(text):
    """Deterministic subsample of shingle hashes (h % SAMPLE_MOD == 0).

    Falls back to the full shingle set for very short transcripts so tiny
    episodes still have something to compare.
    """
    all_h = shingles(text)
    sampled = {h for h in all_h if h % SAMPLE_MOD == 0}
    return sampled if len(sampled) >= 20 else all_h


def main():
    files = glob.glob(str(EP_DIR / "**/*.json"), recursive=True)
    if not files:
        sys.exit("No episode files found — run scripts/parse_wxr.py first.")

    episodes = []
    for f in files:
        r = json.load(open(f, encoding="utf-8"))
        t = norm(r.get("transcript", ""))
        if not t:
            continue
        episodes.append({
            "id": r["id"], "title": r["title"], "date": r["date"],
            "text": t, "sha": hashlib.sha1(t.encode()).hexdigest(),
        })
    # Earliest first; id as tiebreaker so ordering is deterministic.
    episodes.sort(key=lambda e: (e["date"], int(e["id"])))
    by_id = {e["id"]: e for e in episodes}

    skiplist, skipped_ids = [], set()

    def mark(ep, original, sim):
        skipped_ids.add(ep["id"])
        skiplist.append({
            "id": ep["id"], "title": ep["title"], "date": ep["date"][:10],
            "duplicate_of": original["id"], "similarity": round(sim, 3),
        })

    # ---- Pass 1: exact-duplicate transcripts (any title; keep the earliest) ----
    by_sha = defaultdict(list)
    for ep in episodes:
        by_sha[ep["sha"]].append(ep)
    for group in by_sha.values():
        for dup in group[1:]:
            mark(dup, group[0], 1.0)
    n_exact = len(skiplist)

    # ---- Pass 2: replay-titled episodes vs earlier episodes (shingle containment) ----
    full_cache = {}

    def full(ep):
        if ep["id"] not in full_cache:
            full_cache[ep["id"]] = shingles(ep["text"])
        return full_cache[ep["id"]]

    samples = {ep["id"]: sample_of(ep["text"]) for ep in episodes}

    index = defaultdict(list)  # sampled shingle hash -> indices of earlier kept episodes
    for i, ep in enumerate(episodes):
        sample = samples[ep["id"]]
        if ep["id"] not in skipped_ids and REPLAY_RE.search(ep["title"]) and sample:
            counts = Counter()
            for h in sample:
                for j in index[h]:
                    counts[j] += 1
            # Estimate containment of THIS episode in each earlier one, then
            # verify the best candidates exactly with full shingle sets.
            cands = sorted(((c / len(sample), j) for j, c in counts.items()
                            if c / len(sample) >= CANDIDATE_EST), reverse=True)[:5]
            best_sim, best_j = 0.0, None
            for _, j in cands:
                mine, theirs = full(ep), full(episodes[j])
                sim = len(mine & theirs) / len(mine)
                if sim > best_sim:
                    best_sim, best_j = sim, j
            if best_j is not None and best_sim >= THRESHOLD:
                mark(ep, episodes[best_j], best_sim)
        if ep["id"] not in skipped_ids:
            for h in sample:
                index[h].append(i)

    skiplist.sort(key=lambda e: (e["date"], int(e["id"])))
    OUT.write_text(json.dumps(skiplist, ensure_ascii=False, indent=2), encoding="utf-8")

    n_near = len(skiplist) - n_exact
    print(f"Episodes with transcripts: {len(episodes)}")
    print(f"Skipped as replays/duplicates: {len(skiplist)} "
          f"({n_exact} exact-duplicate transcripts, {n_near} near-duplicate replays)")
    print(f"Kept: {len(episodes) - len(skiplist)}")
    print(f"-> {OUT.relative_to(ROOT)}")

    print("\nExample skipped pairs:")
    for e in skiplist[:5]:
        orig = by_id[e["duplicate_of"]]
        print(f"  [{e['similarity']:.3f}] {e['date']}  {e['title']!r}")
        print(f"          dup of {orig['date'][:10]}  {orig['title']!r} (id {orig['id']})")


if __name__ == "__main__":
    main()
