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
Never prefix it with `NEXT_PUBLIC_`. `ANTHROPIC_API_KEY` is a placeholder for
the upcoming "chat with the archive" feature; leave it empty for now.

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

### 4. Run locally

```bash
npm run dev   # http://localhost:3000
```

### 5. Deploy to Vercel

1. Push this repo to GitHub.
2. Vercel → New Project → import the repo → set **Root Directory** to `app/`.
3. Add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` as environment
   variables (server-side; they are not exposed to the browser).
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
