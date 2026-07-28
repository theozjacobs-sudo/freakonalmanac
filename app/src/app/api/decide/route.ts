import { NextRequest, NextResponse } from "next/server";
import { getReviewerByToken, getSupabase } from "@/lib/supabase";
import { handleRouteError, jsonError } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * POST /api/decide
 * { token, entry_id, decision: 'keep' | 'reject', round? = 1 }
 *
 * Idempotent upsert on (entry_id, reviewer_id, round): re-deciding the same
 * entry simply overwrites the earlier decision.
 */
export async function POST(req: NextRequest) {
  try {
    const sb = getSupabase();
    const body = await req.json().catch(() => null);
    if (!body) return jsonError(400, "bad_json");

    const { token, entry_id, decision } = body as {
      token?: string;
      entry_id?: string;
      decision?: string;
    };
    const round = Number.isInteger(body.round) ? (body.round as number) : 1;

    if (!entry_id || typeof entry_id !== "string") return jsonError(400, "missing_entry_id");
    if (decision !== "keep" && decision !== "reject") return jsonError(400, "bad_decision");
    if (round < 1 || round > 10) return jsonError(400, "bad_round");

    const reviewer = await getReviewerByToken(sb, token);
    if (!reviewer) return jsonError(401, "invalid_token");

    const { error } = await sb.from("decisions").upsert(
      {
        entry_id,
        reviewer_id: reviewer.id,
        decision,
        round,
        decided_at: new Date().toISOString(),
      },
      { onConflict: "entry_id,reviewer_id,round" }
    );
    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
