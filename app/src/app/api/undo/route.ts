import { NextRequest, NextResponse } from "next/server";
import { getReviewerByToken, getSupabase } from "@/lib/supabase";
import { handleRouteError, jsonError } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * POST /api/undo
 * { token, entry_id?, round? = 1 }
 *
 * Deletes this reviewer's decision on entry_id (preferred — the client knows
 * exactly what it wants undone), or, if entry_id is omitted, their most
 * recent round-N decision. Only ever touches the calling reviewer's rows.
 */
export async function POST(req: NextRequest) {
  try {
    const sb = getSupabase();
    const body = await req.json().catch(() => null);
    if (!body) return jsonError(400, "bad_json");

    const { token, entry_id } = body as { token?: string; entry_id?: string };
    const round = Number.isInteger(body.round) ? (body.round as number) : 1;

    const reviewer = await getReviewerByToken(sb, token);
    if (!reviewer) return jsonError(401, "invalid_token");

    let targetEntryId = entry_id ?? null;
    if (!targetEntryId) {
      const { data, error } = await sb
        .from("decisions")
        .select("entry_id")
        .eq("reviewer_id", reviewer.id)
        .eq("round", round)
        .order("decided_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      targetEntryId = data?.entry_id ?? null;
    }
    if (!targetEntryId) return NextResponse.json({ ok: true, undone: null });

    const { error } = await sb
      .from("decisions")
      .delete()
      .eq("reviewer_id", reviewer.id)
      .eq("round", round)
      .eq("entry_id", targetEntryId);
    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true, undone: targetEntryId });
  } catch (err) {
    return handleRouteError(err);
  }
}
