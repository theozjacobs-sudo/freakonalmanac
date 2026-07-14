# Freakonalmanac

Building an A–Z almanac of Freakonomics Radio from the show's own transcripts —
grounded **only** in what was actually said on the podcasts, never outside sources.

## The data
Source: `raw/freakonomics.WordPress.2026-06-08.xml` — a WordPress (WXR) export of
freakonomics.com. Contains **2,286 podcast posts; 1,604 have full transcripts**
(~16.4M tokens) across Freakonomics Radio, No Stupid Questions, People I (Mostly)
Admire, The Economics of Everyday Things, Freakonomics M.D., and more.

Transcripts are speaker-attributed and each episode carries the producers' own
`_podcast_sources` / `_podcast_resources` citations.

## Pipeline
1. **Parse** (`scripts/parse_wxr.py`) — split the monolith into one clean JSON per
   episode under `data/episodes/<show>/` (git-ignored; regenerable) plus a compact
   manifest `data/index.json`.
2. **Extract** — read each episode and emit candidate almanac entries: a headword,
   the fact/figure, a **verbatim quote**, the speaker, and full episode citation.
3. **Verify** (`scripts/verify_entries.py`) — grounding check: every quote must
   appear verbatim in its source transcript, or the entry is flagged. This enforces
   the "transcripts only" rule and catches hallucinations automatically.
4. **Consolidate** (planned) — cluster candidates by headword across episodes into
   canonical A–Z entries with multiple citations.

## Status
Prototype: `data/prototype/entries.json` — 11 grounded entries from 2 episodes.

## Regenerate
```bash
python3 scripts/parse_wxr.py      # rebuild data/episodes/ + index.json
python3 scripts/verify_entries.py # re-check grounding
```
