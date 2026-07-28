#!/usr/bin/env node
/**
 * Seed transcript passages into the Supabase `passages` table.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/seed-passages.mjs [--truncate] [path/to/passages.jsonl]
 *
 * Default input: ../data/passages.jsonl (relative to app/), produced by
 * `python3 scripts/parse_wxr.py && python3 scripts/export_passages.py` at the
 * repo root. Inserts in chunks of 1,000 with progress output.
 *
 * `--truncate` deletes every existing row first, which makes a re-run
 * idempotent-ish (the table has a serial PK, so plain re-runs would
 * duplicate rows). Recommended whenever you re-export the JSONL.
 */
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const truncate = args.includes("--truncate");
const pathArg = args.find((a) => a !== "--truncate");

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const inputPath = resolve(appDir, pathArg ?? "../data/passages.jsonl");

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error(
    "Missing SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY in the environment."
  );
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });

if (truncate) {
  console.log("Truncating passages table…");
  // .neq on the serial PK matches every row (delete() requires a filter).
  const { error } = await sb.from("passages").delete().neq("id", 0);
  if (error) {
    console.error(`Truncate failed: ${error.message}`);
    process.exit(1);
  }
}

const CHUNK = 1000;
let batch = [];
let inserted = 0;
let lineNo = 0;
const started = Date.now();

async function flush() {
  if (batch.length === 0) return;
  const rows = batch;
  batch = [];
  const { error } = await sb.from("passages").insert(rows);
  if (error) {
    console.error(
      `Insert failed after ${inserted.toLocaleString()} rows: ${error.message}`
    );
    process.exit(1);
  }
  inserted += rows.length;
  const secs = ((Date.now() - started) / 1000).toFixed(0);
  console.log(`  inserted ${inserted.toLocaleString()} passages (${secs}s)`);
}

const rl = createInterface({
  input: createReadStream(inputPath, "utf8"),
  crlfDelay: Infinity,
});

for await (const line of rl) {
  lineNo += 1;
  const trimmed = line.trim();
  if (!trimmed) continue;
  let p;
  try {
    p = JSON.parse(trimmed);
  } catch {
    console.warn(`  skipping malformed JSON on line ${lineNo}`);
    continue;
  }
  batch.push({
    episode_id: p.episode_id ?? null,
    speaker: p.speaker ?? null,
    content: p.content ?? null,
    episode_title: p.episode_title ?? null,
    show: p.show ?? null,
    date: p.date ?? null,
    url: p.url ?? null,
  });
  if (batch.length >= CHUNK) await flush();
}
await flush();

console.log(
  `Done: ${inserted.toLocaleString()} passages inserted from ${inputPath}`
);
