# Fact Finder HQ

The review headquarters for the Freakonomics Radio almanac. Three reviewers —
Theo, Zack, and Stephen — independently assess candidate entries with a swipe
deck, browse the pool as a web spreadsheet, and compare **overlap** (entries
kept by more than one reviewer) after the fact.

**The one rule:** reviews are blind. Nothing in the review flow ever shows
another reviewer's decisions — "two separate assessments." Overlap only
appears on the Stats page, as aggregates.

## Stack

- Next.js 14 (App Router, TypeScript, Tailwind) — mobile-first
- Supabase Postgres (server-side only, via the service-role key)
- No other runtime dependencies; swipe gestures are plain pointer events

## Setup

### 1. Supabase

1. Create a Supabase project (Pro plan recommended for the 10k-entry pool +
   the upcoming transcript-passage index).
2. In the SQL editor, paste and run [`supabase/schema.sql`](supabase/schema.sql)
   once. It creates `entries`, `reviewers` (pre-seeded with the three tokens
   below), `decisions`, `settings`, and `passages`, with RLS on everywhere
   (service-role-only — the anon key can do nothing).

### 2. Environment

Copy `.env.example` to `.env.local` and fill in from Supabase → Settings → API:

```
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service role key>
```

The service-role key is used **only** in API routes and server components.
Never prefix it with `NEXT_PUBLIC_`. For the `/chat` page, also set:

```
ANTHROPIC_API_KEY=<anthropic api key>
```

It too is server-side only (used by `/api/chat`). Without it, `/chat` shows a
friendly setup notice; everything else keeps working.

### 3. Seed entries

```bash
cd app
npm install
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run seed
# or with an explicit file:
node scripts/seed.mjs ../data/prototype/fact_finder_entries.json
```

Idempotent — rows upsert on `id` (`<episode.id>-<slugified-headword>`), so
re-running with the full 10,000-entry JSON later just adds/updates rows and
never touches decisions.

### 3b. Seed transcript passages (for /chat)

The `/chat` page searches the `passages` table (~144k speaker-labeled
transcript passages). Two steps, run from the **repo root** on a machine that
can reach Supabase:

```bash
# 1. Regenerate the passage export (needs raw/*.xml in the repo)
python3 scripts/parse_wxr.py && python3 scripts/export_passages.py
# -> data/passages.jsonl (~95 MB, git-ignored)

# 2. Load it into Supabase (chunks of 1,000, with progress output)
cd app
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  node scripts/seed-passages.mjs --truncate
```

`--truncate` clears the table first (the table has a serial PK, so re-running
without it would duplicate rows). A custom JSONL path can be passed as the
last argument.

If you ran `supabase/schema.sql` before the chat feature landed, re-run the
`search_passages` function block from it (it's `create or replace` — the whole
file is also safe to re-run) so archive chat gets ranked full-text search.

### 4. Run locally

```bash
npm run dev   # http://localhost:3000
```

### 5. Deploy to Vercel

1. Push this repo to GitHub.
2. Vercel → New Project → import the repo → set **Root Directory** to `app/`.
3. Add `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `ANTHROPIC_API_KEY`
   as environment variables (server-side; they are not exposed to the
   browser).
4. Deploy.

## Reviewer links

Access is by private link — the token identifies the reviewer and is
remembered by the device (localStorage) after the first visit:

| Reviewer | Link                            |
| -------- | ------------------------------- |
| Theo     | `/review?r=theo-3de9b622`       |
| Zack     | `/review?r=zack-f8d088fe`       |
| Stephen  | `/review?r=stephen-a37c359d`    |

Rotate a token by updating its row in `reviewers` and sending a fresh link.

## Pages

- **/review** — the blind swipe deck. Swipe right / 👍 / `→` = keep; swipe
  left / 👎 / `←` = reject. Undo takes back the last call. Progress shows
  "N of total". The queue is whatever this reviewer hasn't decided in round 1.
- **/browse** — cards or a sortable table with search + filters (type, show,
  freshness, my-decision status) and a **Download CSV** of the current
  filtered rows. Shows only *your own* decisions.
- **/stats** — per-reviewer progress and keep rate, plus the overlap report
  (entries with ≥2 round-1 decisions: kept-by-all / kept-by-some /
  rejected-by-all), filterable by type.
- **/today** — Fact of the Day: a deterministic UTC-date-seeded pick from
  entries kept by at least one reviewer (falls back to the whole pool until
  reviewing starts).
- **/chat** — grounded chat over the archive (reviewer link required), with
  three modes: **Archive** (full-text search over all transcript passages;
  answers cite episode + speaker and come only from retrieved passages),
  **Entries** (the AI editor — curated/ranked lists from the entry pool, with
  type + show filters), and **Episode** (chat about a single episode's full
  transcript — open it via the "💬 chat about this episode" link on any
  entry card). Uses Claude (`claude-opus-5`) server-side with streaming;
  requires `ANTHROPIC_API_KEY` and a seeded `passages` table.

## Settings

`settings.assignment_mode` controls the queue:

- `'all'` (default, per Stephen) — every reviewer sees every entry.
- `'split'` — each entry is deterministically hashed (FNV-1a of the entry id,
  mod the reviewer count, reviewers ordered by id) to exactly one reviewer.

Change it in the Supabase table editor; no redeploy needed.

## Rounds

`decisions.round` defaults to 1 (the big pass). The later 1,500 → 300
shortlist pass will use `round = 2` — the API already accepts a `round`
parameter, so the shortlist UI can reuse the same endpoints.
