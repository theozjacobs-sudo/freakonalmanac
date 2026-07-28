import { NextRequest, NextResponse } from "next/server";
import { getSupabase, isConfigured } from "@/lib/supabase";
import { isAnthropicConfigured } from "@/lib/claude";
import { jsonError } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Self-diagnosis endpoint — admin only (falls back to any valid reviewer
 * token when the is_admin column doesn't exist yet, since that missing
 * column is itself one of the findings this endpoint exists to report).
 *
 * GET /api/debug?token=<token>
 *
 * Never throws: every check lands in the report, and any unexpected crash
 * still returns the partial report as JSON instead of a bare 500 page.
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
  const problems: string[] = [];

  try {
    if (!isConfigured()) {
      report.verdict =
        "Supabase env vars are missing on THIS deployment — set them in Vercel and redeploy.";
      return NextResponse.json(report);
    }

    const sb = getSupabase();

    // Token gate. select("*") so a missing is_admin column can't crash us.
    const token = req.nextUrl.searchParams.get("token");
    if (!token) return jsonError(401, "invalid_token");
    const who = await sb.from("reviewers").select("*").eq("token", token).maybeSingle();
    if (who.error) {
      problems.push(`reviewers table unreadable: ${who.error.message}`);
      report.problems = problems;
      report.verdict = "Cannot read the reviewers table — check schema.sql was run.";
      return NextResponse.json(report);
    }
    if (!who.data) return jsonError(401, "invalid_token");
    const hasAdminCol = "is_admin" in who.data;
    if (hasAdminCol && !who.data.is_admin) return jsonError(403, "admin_only");
    if (!hasAdminCol) {
      problems.push(
        "reviewers.is_admin column MISSING — the latest schema.sql (split-mode block) has NOT been run. Review/queue APIs will fail until it is."
      );
    }
    if (!("in_pool" in who.data)) {
      problems.push(
        "reviewers.in_pool column MISSING — the latest schema.sql has NOT been run; split mode can't work."
      );
    }

    async function count(table: string): Promise<number | string> {
      try {
        const { count, error } = await sb
          .from(table)
          .select("*", { count: "exact", head: true });
        return error ? `ERROR: ${error.message}` : (count ?? 0);
      } catch (e) {
        return `ERROR: ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    const [entries, passages, reviewers, decisions] = await Promise.all([
      count("entries"),
      count("passages"),
      count("reviewers"),
      count("decisions"),
    ]);
    report.tables = { entries, passages, reviewers, decisions };

    const ai = await sb.from("reviewers").select("id").like("token", "claude-ai-%");
    report.ai_reviewer_present = ai.error ? `ERROR: ${ai.error.message}` : (ai.data?.length ?? 0) > 0;

    const modeRow = await sb
      .from("settings")
      .select("value")
      .eq("key", "assignment_mode")
      .maybeSingle();
    report.assignment_mode = modeRow.error
      ? `ERROR: ${modeRow.error.message}`
      : (modeRow.data?.value ?? "(missing — defaults to all)");

    const rpc = await sb.rpc("search_passages", { query: TEST_QUERY, match_count: 12 });
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

    if (typeof passages === "number" && passages === 0) {
      problems.push(
        "passages table is EMPTY on the database this deployment points at — re-run seed-passages.mjs."
      );
    } else if (
      (rpc.error || (rpc.data?.length ?? 0) === 0) &&
      (fallback.error || (fallback.data?.length ?? 0) === 0)
    ) {
      problems.push(
        "Passages exist but search returns nothing — run the latest supabase/schema.sql (fts column + search_passages function)."
      );
    }

    report.problems = problems;
    report.verdict =
      problems.length === 0
        ? "Everything works from this deployment. If the app still misbehaves in your browser, you're loading a DIFFERENT (older) deployment — use the canonical domain."
        : `${problems.length} problem(s) found — see 'problems'.`;
    return NextResponse.json(report);
  } catch (err) {
    report.problems = problems;
    report.crash = err instanceof Error ? err.message : String(err);
    report.verdict = "Diagnosis crashed partway — see 'crash' and the partial report above.";
    return NextResponse.json(report, { status: 500 });
  }
}
