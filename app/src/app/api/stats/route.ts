import { NextResponse } from "next/server";
import {
  assignedReviewerIndex,
  fetchAll,
  getAssignmentMode,
  getSupabase,
} from "@/lib/supabase";
import { handleRouteError } from "@/lib/api";
import type {
  Decision,
  EntryType,
  OverlapCounts,
  ReviewerStats,
  StatsResponse,
} from "@/lib/types";

export const dynamic = "force-dynamic";

function emptyCounts(): OverlapCounts {
  return { compared: 0, kept_by_all: 0, kept_by_some: 0, rejected_by_all: 0 };
}

/**
 * GET /api/stats
 *
 * Aggregate progress + the overlap report (round 1). This is the one place
 * decisions are compared across reviewers — as aggregates, after the fact,
 * exactly the "how much do we agree?" payoff metric. The review flow itself
 * stays blind.
 */
export async function GET() {
  try {
    const sb = getSupabase();

    const [entryRows, reviewerRows, decisionRows, mode] = await Promise.all([
      fetchAll<{ id: string; entry_type: EntryType; headword: string }>((from, to) =>
        sb.from("entries").select("id,entry_type,headword").order("id").range(from, to)
      ),
      sb
        .from("reviewers")
        .select("id,name")
        .order("id")
        .then(({ data, error }) => {
          if (error) throw new Error(error.message);
          return (data ?? []) as { id: number; name: string }[];
        }),
      fetchAll<{ entry_id: string; reviewer_id: number; decision: Decision }>(
        (from, to) =>
          sb
            .from("decisions")
            .select("entry_id,reviewer_id,decision")
            .eq("round", 1)
            .order("id")
            .range(from, to)
      ),
      getAssignmentMode(sb),
    ]);

    const entryById = new Map(entryRows.map((e) => [e.id, e]));

    // Per-reviewer progress.
    const perReviewer = new Map<number, { done: number; keeps: number }>();
    for (const r of reviewerRows) perReviewer.set(r.id, { done: 0, keeps: 0 });
    for (const d of decisionRows) {
      const agg = perReviewer.get(d.reviewer_id);
      if (!agg || !entryById.has(d.entry_id)) continue;
      agg.done += 1;
      if (d.decision === "keep") agg.keeps += 1;
    }

    const reviewers: ReviewerStats[] = reviewerRows.map((r, idx) => {
      const agg = perReviewer.get(r.id) ?? { done: 0, keeps: 0 };
      const total =
        mode === "split"
          ? entryRows.filter(
              (e) => assignedReviewerIndex(e.id, reviewerRows.length) === idx
            ).length
          : entryRows.length;
      return {
        id: r.id,
        name: r.name,
        total,
        done: agg.done,
        keeps: agg.keeps,
        rejects: agg.done - agg.keeps,
        keep_rate: agg.done > 0 ? agg.keeps / agg.done : 0,
      };
    });

    // Overlap: entries with >= 2 round-1 decisions.
    const byEntry = new Map<string, Decision[]>();
    for (const d of decisionRows) {
      if (!entryById.has(d.entry_id)) continue;
      const list = byEntry.get(d.entry_id);
      if (list) list.push(d.decision);
      else byEntry.set(d.entry_id, [d.decision]);
    }

    const overall = emptyCounts();
    const byType: Record<string, OverlapCounts> = {};
    const keptByAll: StatsResponse["overlap"]["kept_by_all_entries"] = [];

    for (const [entryId, ds] of byEntry) {
      if (ds.length < 2) continue;
      const entry = entryById.get(entryId)!;
      const counts = (byType[entry.entry_type] ??= emptyCounts());
      const keeps = ds.filter((d) => d === "keep").length;
      const verdict =
        keeps === ds.length
          ? "kept_by_all"
          : keeps > 0
            ? "kept_by_some"
            : "rejected_by_all";
      for (const c of [overall, counts]) {
        c.compared += 1;
        c[verdict] += 1;
      }
      if (verdict === "kept_by_all") {
        keptByAll.push({
          id: entry.id,
          headword: entry.headword,
          entry_type: entry.entry_type,
        });
      }
    }

    keptByAll.sort((a, b) => a.headword.localeCompare(b.headword));

    const body: StatsResponse = {
      total_entries: entryRows.length,
      reviewers,
      overlap: {
        overall,
        by_type: byType,
        kept_by_all_entries: keptByAll.slice(0, 500),
      },
    };
    return NextResponse.json(body);
  } catch (err) {
    return handleRouteError(err);
  }
}
