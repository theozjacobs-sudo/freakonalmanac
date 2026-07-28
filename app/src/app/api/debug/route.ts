import { NextRequest, NextResponse } from "next/server";
import { getReviewerByToken, getSupabase, isConfigured } from "@/lib/supabase";
import { isAnthropicConfigured } from "@/lib/claude";
import { jsonError } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Self-diagnosis endpoint — admin only.
 *
 * GET /api/debug?token=<admin token>
 *
 * Reports, from inside the live deployment: which deployment/commit is
 * serving, whether env vars are present (sanitized), whether Supabase is
 * reachable, table row counts, and whether passage search (both the ranked
 * RPC and the fallback) actually returns rows for a known-good query.
 * Everything the sandbox can't check from outside, in one URL.
 */

const TEST_QUERY = "surge pricing";

function last4(v: string | undefined): string | null {
  return v && v.length >= 4 ? `…${v.slice(-4)}` : null;
}

function hostOf(v: string | undefined): string | null {
  if (!v) return null;
  try {
    return new URL(v).host;
  } catch {
    return `unparseable (${v.length} chars — check for stray quotes/spaces)`;
  }
}

export async function GET(req: NextRequest) {
  const report: Record<string, unknown> = {
    time: new Date().toISOString(),
    deployment: {
      vercel_env: process.env.VERCEL_ENV ?? null,
      serving_url: process.env.VERCEL_URL ?? null,
      branch: process.env.VERCEL_GIT_COMMIT_REF ?? null,
      commit: (process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 7) || null,
      commit_message: process.env.VERCEL_GIT_COMMIT_MESSAGE ?? null,
    },
    env: {
      supabase_url_host: hostOf(process.env.SUPABASE_URL),
      supabase_key_present: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      supabase_key_last4: last4(process.env.SUPABASE_SERVICE_ROLE_KEY),
      supabase_key_looks_quoted:
        /^["'“”‘’]|["'“”‘’]$/.test(process.env.SUPABASE_SERVICE_ROLE_KEY ?? "") ||
        /^["'“”‘’]|["'“”‘’]$/.test(process.env.SUPABASE_URL ?? ""),
      anthropic_key_present: isAnthropicConfigured(),
    },
  };

  if (!isConfigured()) {
    report.verdict =
      "Supabase env vars are missing on THIS deployment — set them in Vercel and redeploy.";
    return NextResponse.json(report);
  }

  const sb = getSupabase();
  const me = await getReviewerByToken(sb, req.nextUrl.searchParams.get("token"));
  if (!me) return jsonError(401, "invalid_token");
  if (!me.is_admin) return jsonError(403, "admin_only");

  async function count(table: string): Promise<number | string> {
    const { count, error } = await sb
      .from(table)
      .select("*", { count: "exact", head: true });
    return error ? `ERROR: ${error.message}` : (count ?? 0);
  }

  const [entries, passages, reviewers, decisions] = await Promise.all([
    count("entries"),
    count("passages"),
    count("reviewers"),
    count("decisions"),
  ]);
  report.tables = { entries, passages, reviewers, decisions };

  const { data: modeRow } = await sb
    .from("settings")
    .select("value")
    .eq("key", "assignment_mode")
    .maybeSingle();
  report.assignment_mode = modeRow?.value ?? "(missing — defaults to all)";

  const rpc = await sb.rpc("search_passages", {
    query: TEST_QUERY,
    match_count: 12,
  });
  const fallback = await sb
    .from("passages")
    .select("id")
    .textSearch("fts", TEST_QUERY, { type: "websearch", config: "english" })
    .limit(12);
  report.search = {
    test_query: TEST_QUERY,
    ranked_rpc: rpc.error ? `ERROR: ${rpc.error.message}` : `${rpc.data?.length ?? 0} rows`,
    fallback_fts: fallback.error
      ? `ERROR: ${fallback.error.message}`
      : `${fallback.data?.length ?? 0} rows`,
  };

  const rpcRows = rpc.error ? 0 : (rpc.data?.length ?? 0);
  const fbRows = fallback.error ? 0 : (fallback.data?.length ?? 0);
  report.verdict =
    typeof passages === "number" && passages === 0
      ? "passages table is EMPTY on the database this deployment points at — re-run seed-passages.mjs."
      : rpcRows > 0 || fbRows > 0
        ? "Everything works from this deployment. If chat still says 'no passages', the browser is loading a DIFFERENT (older) deployment — use the canonical domain."
        : "Passages exist but search returns nothing — run the latest supabase/schema.sql (fts column + search_passages function).";

  return NextResponse.json(report);
}
