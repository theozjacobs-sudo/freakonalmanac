import { NextRequest, NextResponse } from "next/server";
import {
  assignedReviewerIndex,
  fetchAll,
  getAssignmentMode,
  getReviewerByToken,
  getSupabase,
} from "@/lib/supabase";
import { handleRouteError, jsonError } from "@/lib/api";
import type { Entry, QueueResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/queue?r=<token>&limit=20
 *
 * Returns the next batch of entries this reviewer has not yet decided in
 * round 1, plus progress counts. BLIND by design: nothing in this payload
 * reflects any other reviewer's decisions.
 */
export async function GET(req: NextRequest) {
  try {
    const sb = getSupabase();
    const token = req.nextUrl.searchParams.get("r");
    const limit = Math.min(
      Math.max(parseInt(req.nextUrl.searchParams.get("limit") ?? "20", 10) || 20, 1),
      50
    );

    const reviewer = await getReviewerByToken(sb, token);
    if (!reviewer) return jsonError(401, "invalid_token");

    const mode = await getAssignmentMode(sb);

    // All entry ids, ordered — cheap even at 10k rows (ids only).
    const allIds = (
      await fetchAll<{ id: string }>((from, to) =>
        sb.from("entries").select("id").order("id").range(from, to)
      )
    ).map((r) => r.id);

    // Scope for this reviewer.
    let scopeIds = allIds;
    if (mode === "split") {
      const { data: reviewers, error } = await sb
        .from("reviewers")
        .select("id")
        .order("id");
      if (error) throw new Error(error.message);
      const myIndex = (reviewers ?? []).findIndex((r) => r.id === reviewer.id);
      const n = (reviewers ?? []).length;
      scopeIds = allIds.filter((id) => assignedReviewerIndex(id, n) === myIndex);
    }

    // This reviewer's own round-1 decisions (never anyone else's).
    const decided = new Set(
      (
        await fetchAll<{ entry_id: string }>((from, to) =>
          sb
            .from("decisions")
            .select("entry_id")
            .eq("reviewer_id", reviewer.id)
            .eq("round", 1)
            .order("id")
            .range(from, to)
        )
      ).map((r) => r.entry_id)
    );

    const doneInScope = scopeIds.filter((id) => decided.has(id)).length;
    const nextIds = scopeIds.filter((id) => !decided.has(id)).slice(0, limit);

    let entries: Entry[] = [];
    if (nextIds.length > 0) {
      const { data, error } = await sb
        .from("entries")
        .select("*")
        .in("id", nextIds)
        .order("id");
      if (error) throw new Error(error.message);
      entries = (data ?? []) as Entry[];
    }

    const body: QueueResponse = {
      reviewer: { id: reviewer.id, name: reviewer.name },
      assignment_mode: mode,
      total: scopeIds.length,
      done: doneInScope,
      entries,
    };
    return NextResponse.json(body);
  } catch (err) {
    return handleRouteError(err);
  }
}
