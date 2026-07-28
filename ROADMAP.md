# Fact Finder — Roadmap & deferred work

Things we've explicitly decided to do later. When one ships, move it to the
bottom under "Done".

## 1. Chat v3: semantic search (pgvector + embeddings) — "option 2"

Chosen as the follow-up to the agentic chat rewrite (which is option 1, now
built). Do this if/when the agentic chat still hits "the archive didn't
surface anything" on questions phrased differently from how people talked on
the show (paraphrases, synonyms the keyword engine can't bridge).

What it involves:
- Enable the `vector` (pgvector) extension in Supabase; add an
  `embedding vector(1024)` column to `passages` + an HNSW index.
- One-time embedding run over all 143,709 passages via the Voyage AI API
  (Anthropic's recommended embeddings partner, model `voyage-3.5` or newer)
  — a `scripts/embed-passages.mjs` seeder run from a laptop like the other
  seeders. Rough cost: a few dollars.
- Add a `match_passages(query_embedding, count)` SQL function; the chat's
  `search_archive` tool then blends keyword FTS + vector similarity
  (reciprocal-rank fusion) so both exact names and fuzzy paraphrases hit.
- Needs a `VOYAGE_API_KEY` env var on Vercel (embedding the *question* at
  query time).

## 2. Merge / canonicalization pass (Fable 5)

Collapse the 14,537 raw entries into canonical A–Z headwords: merge
duplicates across episodes into one entry with multi-episode citations, and
generate Diderot-style `see_also` cross-references (Stephen asked for these
explicitly). Deliberately deferred until after the first human swipe cut so
we don't spend model budget canonicalizing entries that get rejected.

## 3. Round-2 shortlist pass (~1,500 → ~300)

The APIs and `decisions` table already accept `round = 2`. When round 1 is
done, build the round-2 deck from round-1 keeps (plus AI/overlap signal) and
point the swipe UI at it.

## 4. Theme clustering

AI-proposed candidate chapter themes over the kept entries (chapters are
emergent, not A–Z). Post-curation, low priority.

## 5. Verify queue

Every kept `figure` older than ~4 years lands in a fact-check list — feeds
the show's real research workflow. The `freshness` field already flags them
(`check`); this is just a filtered view + workflow.

## 6. Housekeeping

- Two episodes never extracted cleanly (post IDs 111992, 141694) — optional
  one-off retry.
- Rotate the Anthropic API key (it was pasted in a chat once) and keep it
  only in Vercel + local env.
- Rotate the Supabase secret key once the tool is stable.

---

## Done

- Agentic archive chat ("option 1"): Claude drives `search_archive` itself —
  multi-search, typo-tolerant, conversation-aware. (2026-07-28)
