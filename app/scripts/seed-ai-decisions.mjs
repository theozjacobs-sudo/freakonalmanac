#!/usr/bin/env node
/**
 * Seed the AI reviewer's verdicts (data/ai_review.json, produced by
 * scripts/ai_review.py) into `decisions` as the "Claude (AI)" reviewer.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/seed-ai-decisions.mjs [path/to/ai_review.json]
 *
 * Idempotent: upserts on (entry_id, reviewer_id, round); re-running overwrites.
 * Verdicts whose entry_id doesn't exist in `entries` are skipped with a count.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first.");
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false } });

const inputPath = process.argv[2] ?? "../data/ai_review.json";
const verdicts = JSON.parse(readFileSync(inputPath, "utf8"));
if (!Array.isArray(verdicts)) {
  console.error(`Expected a JSON array of verdicts in ${inputPath}`);
  process.exit(1);
}

// Find the AI reviewer (token starts with claude-ai-).
const { data: reviewers, error: rerr } = await sb
  .from("reviewers")
  .select("id,name,token")
  .like("token", "claude-ai-%");
if (rerr) throw new Error(rerr.message);
if (!reviewers?.length) {
  console.error(
    "No 'Claude (AI)' reviewer found. Run the latest app/supabase/schema.sql first."
  );
  process.exit(1);
}
const ai = reviewers[0];
console.log(`Seeding ${verdicts.length} AI verdicts as ${ai.name} (id ${ai.id})…`);

// Only seed decisions for entries that exist (FK safety).
const known = new Set();
const PAGE = 1000;
for (let from = 0; ; from += PAGE) {
  const { data, error } = await sb
    .from("entries")
    .select("id")
    .order("id")
    .range(from, from + PAGE - 1);
  if (error) throw new Error(error.message);
  (data ?? []).forEach((r) => known.add(r.id));
  if (!data || data.length < PAGE) break;
}

const rows = [];
let skipped = 0;
for (const v of verdicts) {
  if (!known.has(v.id)) {
    skipped++;
    continue;
  }
  rows.push({
    entry_id: v.id,
    reviewer_id: ai.id,
    decision: v.keep ? "keep" : "reject",
    round: 1,
    decided_at: new Date().toISOString(),
  });
}

const BATCH = 500;
let upserted = 0;
for (let i = 0; i < rows.length; i += BATCH) {
  const { error } = await sb
    .from("decisions")
    .upsert(rows.slice(i, i + BATCH), { onConflict: "entry_id,reviewer_id,round" });
  if (error) {
    console.error(`Upsert failed at batch ${i / BATCH + 1}: ${error.message}`);
    process.exit(1);
  }
  upserted += Math.min(BATCH, rows.length - i);
  if (upserted % 2500 < BATCH) console.log(`  upserted ${upserted}/${rows.length}`);
}

const keeps = rows.filter((r) => r.decision === "keep").length;
console.log(
  `Done: ${upserted} AI decisions (${keeps} keep / ${upserted - keeps} reject); ` +
    `${skipped} verdicts skipped (no matching entry).`
);
