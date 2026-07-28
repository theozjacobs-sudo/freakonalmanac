#!/usr/bin/env node
/**
 * Seed (upsert) Fact Finder entries into Supabase.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed.mjs [path/to/entries.json]
 *
 * Default input: ../data/prototype/fact_finder_entries.json (relative to app/).
 * Idempotent: rows are upserted on their id (<episode.id>-<slugified-headword>),
 * so re-running with a bigger JSON just adds/updates entries. Decisions are
 * never touched.
 */
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const inputPath = resolve(
  appDir,
  process.argv[2] ?? "../data/prototype/fact_finder_entries.json"
);

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error(
    "Missing SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY in the environment."
  );
  process.exit(1);
}

function slugify(s) {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

const raw = JSON.parse(await readFile(inputPath, "utf8"));
if (!Array.isArray(raw)) {
  console.error(`Expected a JSON array of entries in ${inputPath}`);
  process.exit(1);
}

const rows = raw.map((e) => ({
  id: `${e.episode?.id ?? "unknown"}-${slugify(e.headword ?? "")}`,
  headword: e.headword,
  entry_type: e.entry_type,
  category: e.category ?? null,
  claim: e.claim ?? null,
  quote: e.quote ?? null,
  speaker: e.speaker ?? null,
  episode_title: e.episode?.title ?? null,
  episode_show: e.episode?.show ?? null,
  episode_id: e.episode?.id ?? null,
  episode_date: e.episode?.date ?? null,
  episode_url: e.episode?.url ?? null,
  age_years: e.age_years ?? null,
  freshness: e.freshness ?? null,
  freshness_note: e.freshness_note ?? null,
  verified_quote_in_transcript: Boolean(e.verified_quote_in_transcript),
}));

// Guard against duplicate ids inside one input file (same headword twice in
// one episode) — last one wins, with a warning.
const byId = new Map();
for (const row of rows) {
  if (byId.has(row.id)) console.warn(`duplicate id in input, keeping last: ${row.id}`);
  byId.set(row.id, row);
}
const unique = [...byId.values()];

const sb = createClient(url, key, { auth: { persistSession: false } });

const BATCH = 500;
let upserted = 0;
for (let i = 0; i < unique.length; i += BATCH) {
  const batch = unique.slice(i, i + BATCH);
  const { error } = await sb.from("entries").upsert(batch, { onConflict: "id" });
  if (error) {
    console.error(`Upsert failed at batch ${i / BATCH + 1}: ${error.message}`);
    process.exit(1);
  }
  upserted += batch.length;
  console.log(`  upserted ${upserted}/${unique.length}`);
}

console.log(`Done: ${unique.length} entries upserted from ${inputPath}`);
