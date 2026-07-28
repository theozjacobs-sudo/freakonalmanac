import { NextRequest, NextResponse } from "next/server";
import { fetchAll, getReviewerByToken, getSupabase } from "@/lib/supabase";
import { handleRouteError } from "@/lib/api";
import type { BrowseEntry, Decision, Entry } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/entries?r=<token>
 *
 * Full entry list for /browse, annotated with (only) the calling reviewer's
 * own round-1 decision. Search / filter / sort happen client-side so the
 * table and the CSV export always agree. The token is optional — without it
 * the decision column is simply empty.
 */
export async function GET(req: NextRequest) {
  try {
    const sb = getSupabase();
    const token = req.nextUrl.searchParams.get("r");

    const entries = await fetchAll<Entry>((from, to) =>
      sb.from("entries").select("*").order("id").range(from, to)
    );

    const mine = new Map<string, Decision>();
    const reviewer = await getReviewerByToken(sb, token);
    if (reviewer) {
      const rows = await fetchAll<{ entry_id: string; decision: Decision }>(
        (from, to) =>
          sb
            .from("decisions")
            .select("entry_id,decision")
            .eq("reviewer_id", reviewer.id)
            .eq("round", 1)
            .order("id")
            .range(from, to)
      );
      for (const r of rows) mine.set(r.entry_id, r.decision);
    }

    const body: BrowseEntry[] = entries.map((e) => ({
      ...e,
      my_decision: mine.get(e.id) ?? null,
    }));

    return NextResponse.json({
      reviewer: reviewer ? { id: reviewer.id, name: reviewer.name } : null,
      entries: body,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
