import { createClient, SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase access only. The service-role key must never reach the
 * client, so this module must only ever be imported from API routes and
 * server components.
 *
 * The client is lazily created inside request handlers (not at module load)
 * so `next build` succeeds in environments without Supabase env vars.
 */

export class ConfigError extends Error {
  constructor() {
    super("Supabase is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)");
    this.name = "ConfigError";
  }
}

export function isConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

let cached: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!isConfigured()) throw new ConfigError();
  if (!cached) {
    cached = createClient(
      process.env.SUPABASE_URL as string,
      process.env.SUPABASE_SERVICE_ROLE_KEY as string,
      {
        auth: { persistSession: false },
        global: {
          // Next.js caches server-side fetch() GETs by default, which froze
          // stale Supabase responses (pre-migration schema/settings) in
          // Vercel's data cache. Every DB read must hit the database.
          fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
        },
      }
    );
  }
  return cached;
}

const PAGE = 1000;

/**
 * Fetch every row of a query, paging past PostgREST's per-request cap.
 * `build` must return a fresh, deterministic, ordered query for a range.
 */
export async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }
  return rows;
}

export interface Reviewer {
  id: number;
  name: string;
  token: string;
  is_admin?: boolean;
  in_pool?: boolean;
}

export async function getReviewerByToken(
  sb: SupabaseClient,
  token: string | null | undefined
): Promise<Reviewer | null> {
  if (!token) return null;
  const { data, error } = await sb
    .from("reviewers")
    .select("id,name,token,is_admin")
    .eq("token", token)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Reviewer) ?? null;
}

export async function getAssignmentMode(sb: SupabaseClient): Promise<"all" | "split"> {
  const { data, error } = await sb
    .from("settings")
    .select("value")
    .eq("key", "assignment_mode")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.value === "split" ? "split" : "all";
}

/** FNV-1a 32-bit hash — deterministic, fast, good spread for short ids. */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Deterministic entry -> reviewer assignment for 'split' mode.
 * FNV-1a over the entry id, mod the number of reviewers (ordered by id).
 * Keep in sync with the note in the README if this ever changes.
 */
export function assignedReviewerIndex(entryId: string, reviewerCount: number): number {
  return fnv1a(entryId) % Math.max(reviewerCount, 1);
}
