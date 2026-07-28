-- Fact Finder HQ — one-shot schema for the Supabase SQL editor.
-- Safe to run once on a fresh project. The app talks to Supabase exclusively
-- through the server-side service role; RLS is enabled everywhere so the anon
-- key (if it ever leaks into a client) can read/write nothing.

-- ---------------------------------------------------------------------------
-- entries: one row per almanac candidate.
-- id = <episode.id>-<slugified-headword>, e.g. '111907-168-hours'
-- ---------------------------------------------------------------------------
create table if not exists entries (
  id                           text primary key,
  headword                     text not null,
  entry_type                   text not null check (entry_type in ('concept','figure','fact','person','place','story')),
  category                     text,
  claim                        text,
  quote                        text,
  speaker                      text,
  episode_title                text,
  episode_show                 text,
  episode_id                   text,
  episode_date                 text,
  episode_url                  text,
  age_years                    integer,
  freshness                    text check (freshness in ('current','aging','check','evergreen','durable')),
  freshness_note               text,
  verified_quote_in_transcript boolean not null default false,
  created_at                   timestamptz not null default now()
);

create index if not exists entries_entry_type_idx on entries (entry_type);

-- ---------------------------------------------------------------------------
-- reviewers: the three humans. Token is the whole auth story (private links).
-- ---------------------------------------------------------------------------
create table if not exists reviewers (
  id       serial primary key,
  name     text not null,
  token    text not null unique,
  is_admin boolean not null default false,
  in_pool  boolean not null default true
);

-- Migrations for databases created before these columns existed (safe to re-run).
alter table reviewers add column if not exists is_admin boolean not null default false;
alter table reviewers add column if not exists in_pool boolean not null default true;

insert into reviewers (name, token) values
  ('Theo',    'theo-3de9b622'),
  ('Zack',    'zack-f8d088fe'),
  ('Stephen', 'stephen-a37c359d'),
  ('Claude (AI)', 'claude-ai-401af5bf')
on conflict (token) do nothing;

-- Stephen and the AI account review everything but stay out of the split
-- pool, so 'split' mode divides the deck between Theo and Zack only.
update reviewers set in_pool = false where token in ('stephen-a37c359d', 'claude-ai-401af5bf');

update reviewers set is_admin = true where token = 'theo-3de9b622';

-- ---------------------------------------------------------------------------
-- decisions: one keep/reject per (entry, reviewer, round).
-- Round 1 = the big 10,000-entry pass. Round 2 = the later 1,500 -> 300
-- shortlist pass. Reviews are blind: the app never shows one reviewer
-- another reviewer's rows from this table during review.
-- ---------------------------------------------------------------------------
create table if not exists decisions (
  id          bigserial primary key,
  entry_id    text not null references entries (id) on delete cascade,
  reviewer_id integer not null references reviewers (id) on delete cascade,
  decision    text not null check (decision in ('keep','reject')),
  round       integer not null default 1,
  decided_at  timestamptz not null default now(),
  unique (entry_id, reviewer_id, round)
);

create index if not exists decisions_reviewer_id_idx on decisions (reviewer_id);

-- ---------------------------------------------------------------------------
-- settings: tiny key/value store for app behavior.
-- assignment_mode: 'all'   = every reviewer sees every entry (Stephen's
--                            default — two independent assessments)
--                  'split' = each entry is hashed to exactly one reviewer
-- ---------------------------------------------------------------------------
create table if not exists settings (
  key   text primary key,
  value text
);

insert into settings (key, value) values ('assignment_mode', 'all')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- passages: full-transcript passage index for the future "chat with the
-- archive" feature. Left empty for now; a later pipeline fills it.
-- ---------------------------------------------------------------------------
create table if not exists passages (
  id            serial primary key,
  episode_id    text,
  speaker       text,
  content       text,
  episode_title text,
  show          text,
  date          text,
  url           text,
  fts           tsvector generated always as (to_tsvector('english', coalesce(content, ''))) stored
);

create index if not exists passages_fts_idx on passages using gin (fts);

-- Ranked full-text search over passages for /chat (archive mode).
-- websearch_to_tsquery handles raw user questions safely; results are the
-- top `match_count` passages by ts_rank. Safe to re-run (create or replace).
create or replace function search_passages(query text, match_count int default 12)
returns table (
  id            int,
  episode_id    text,
  speaker       text,
  content       text,
  episode_title text,
  "show"        text,
  "date"        text,
  url           text,
  rank          real
)
language sql
stable
as $$
  select p.id, p.episode_id, p.speaker, p.content, p.episode_title,
         p.show, p.date, p.url,
         ts_rank(p.fts, websearch_to_tsquery('english', query)) as rank
  from passages p
  where p.fts @@ websearch_to_tsquery('english', query)
  order by rank desc
  limit least(greatest(match_count, 1), 50);
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security: on for every table, with service-role-only policies.
-- The Next.js app uses the service role key server-side, which bypasses RLS;
-- these explicit policies just make the intent auditable. No anon access.
-- ---------------------------------------------------------------------------
alter table entries   enable row level security;
alter table reviewers enable row level security;
alter table decisions enable row level security;
alter table settings  enable row level security;
alter table passages  enable row level security;

drop policy if exists "service role only" on entries;
create policy "service role only" on entries
  for all to service_role using (true) with check (true);

drop policy if exists "service role only" on reviewers;
create policy "service role only" on reviewers
  for all to service_role using (true) with check (true);

drop policy if exists "service role only" on decisions;
create policy "service role only" on decisions
  for all to service_role using (true) with check (true);

drop policy if exists "service role only" on settings;
create policy "service role only" on settings
  for all to service_role using (true) with check (true);

drop policy if exists "service role only" on passages;
create policy "service role only" on passages
  for all to service_role using (true) with check (true);
