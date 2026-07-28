"use client";

import { useEffect, useMemo, useState } from "react";
import type { StatsResponse } from "@/lib/types";
import SetupNotice from "@/components/SetupNotice";
import { TypePill } from "@/components/pills";

const ENTRY_TYPES = ["concept", "figure", "fact", "person", "place", "story"];

function pct(n: number, d: number): string {
  return d > 0 ? `${Math.round((n / d) * 100)}%` : "—";
}

export default function StatsClient() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [phase, setPhase] = useState<"loading" | "unconfigured" | "error" | "ready">(
    "loading"
  );
  const [typeF, setTypeF] = useState("all");

  useEffect(() => {
    fetch("/api/stats", { cache: "no-store" })
      .then(async (res) => {
        if (res.status === 503) {
          setPhase("unconfigured");
          return;
        }
        if (!res.ok) throw new Error(`stats failed (${res.status})`);
        setStats((await res.json()) as StatsResponse);
        setPhase("ready");
      })
      .catch(() => setPhase("error"));
  }, []);

  const overlap = useMemo(() => {
    if (!stats) return null;
    return typeF === "all"
      ? stats.overlap.overall
      : (stats.overlap.by_type[typeF] ?? {
          compared: 0,
          kept_by_all: 0,
          kept_by_some: 0,
          rejected_by_all: 0,
        });
  }, [stats, typeF]);

  const keptByAllShown = useMemo(() => {
    if (!stats) return [];
    return typeF === "all"
      ? stats.overlap.kept_by_all_entries
      : stats.overlap.kept_by_all_entries.filter((e) => e.entry_type === typeF);
  }, [stats, typeF]);

  if (phase === "unconfigured") return <SetupNotice />;
  if (phase === "error")
    return (
      <p className="my-24 text-center text-sm text-muted">
        Couldn&rsquo;t load stats — try reloading.
      </p>
    );
  if (phase === "loading" || !stats || !overlap)
    return (
      <p className="my-24 text-center font-mono text-sm text-faint">
        Counting the votes…
      </p>
    );

  return (
    <div className="py-5 sm:py-8">
      <h1 className="font-serif text-3xl font-bold tracking-tight text-ink">Stats</h1>
      <p className="mt-1 text-sm text-muted">
        {stats.total_entries.toLocaleString()} entries in the pool &middot; round 1
      </p>

      {/* per-reviewer progress */}
      <h2 className="eyebrow mt-8">Reviewer progress</h2>
      <div className="mt-3 grid gap-4 sm:grid-cols-3">
        {stats.reviewers.map((r) => {
          const progress = r.total > 0 ? r.done / r.total : 0;
          return (
            <div
              key={r.id}
              className="rounded-2xl border border-hair bg-surface p-5 shadow-card"
            >
              <div className="flex items-baseline justify-between">
                <h3 className="font-serif text-xl font-bold text-ink">{r.name}</h3>
                <span className="font-mono text-xs tabular-nums text-muted">
                  {pct(r.done, r.total)}
                </span>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-hair-2">
                <div
                  className="h-full rounded-full bg-accent"
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </div>
              <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
                <div>
                  <dt className="font-mono text-[0.62rem] uppercase tracking-[0.1em] text-faint">
                    Done
                  </dt>
                  <dd className="m-0 font-mono text-lg font-semibold tabular-nums text-ink">
                    {r.done.toLocaleString()}
                  </dd>
                </div>
                <div>
                  <dt className="font-mono text-[0.62rem] uppercase tracking-[0.1em] text-faint">
                    Kept
                  </dt>
                  <dd className="m-0 font-mono text-lg font-semibold tabular-nums text-good">
                    {r.keeps.toLocaleString()}
                  </dd>
                </div>
                <div>
                  <dt className="font-mono text-[0.62rem] uppercase tracking-[0.1em] text-faint">
                    Keep rate
                  </dt>
                  <dd className="m-0 font-mono text-lg font-semibold tabular-nums text-ink">
                    {r.done > 0 ? `${Math.round(r.keep_rate * 100)}%` : "—"}
                  </dd>
                </div>
              </dl>
            </div>
          );
        })}
      </div>

      {/* overlap report */}
      <div className="mt-10 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="eyebrow">Overlap report</h2>
          <p className="mt-1 text-sm text-muted">
            Entries independently assessed by at least two reviewers — the payoff
            metric.
          </p>
        </div>
        <select
          value={typeF}
          onChange={(e) => setTypeF(e.target.value)}
          className="rounded-lg border border-hair bg-surface px-2.5 py-2 text-sm text-ink"
          aria-label="Filter overlap by type"
        >
          <option value="all">All types</option>
          {ENTRY_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>

      {overlap.compared === 0 ? (
        <div className="mt-4 rounded-2xl border border-hair bg-surface p-8 text-center shadow-card">
          <p className="text-sm text-muted">
            No overlap yet — it appears once two reviewers have both decided the
            same entry.
          </p>
        </div>
      ) : (
        <>
          <div className="mt-4 grid gap-4 sm:grid-cols-4">
            <div className="rounded-2xl border border-hair bg-surface p-5 shadow-card">
              <p className="font-mono text-2xl font-semibold tabular-nums text-ink">
                {overlap.compared.toLocaleString()}
              </p>
              <p className="text-xs uppercase tracking-[0.08em] text-muted">
                Compared (≥2 votes)
              </p>
            </div>
            <div className="rounded-2xl border border-hair bg-surface p-5 shadow-card">
              <p className="font-mono text-2xl font-semibold tabular-nums text-good">
                {overlap.kept_by_all.toLocaleString()}
              </p>
              <p className="text-xs uppercase tracking-[0.08em] text-muted">
                Kept by all <span className="text-faint">({pct(overlap.kept_by_all, overlap.compared)})</span>
              </p>
            </div>
            <div className="rounded-2xl border border-hair bg-surface p-5 shadow-card">
              <p className="font-mono text-2xl font-semibold tabular-nums text-warn">
                {overlap.kept_by_some.toLocaleString()}
              </p>
              <p className="text-xs uppercase tracking-[0.08em] text-muted">
                Kept by some <span className="text-faint">({pct(overlap.kept_by_some, overlap.compared)})</span>
              </p>
            </div>
            <div className="rounded-2xl border border-hair bg-surface p-5 shadow-card">
              <p className="font-mono text-2xl font-semibold tabular-nums text-alert">
                {overlap.rejected_by_all.toLocaleString()}
              </p>
              <p className="text-xs uppercase tracking-[0.08em] text-muted">
                Rejected by all <span className="text-faint">({pct(overlap.rejected_by_all, overlap.compared)})</span>
              </p>
            </div>
          </div>

          {/* agreement bar */}
          <div className="mt-4 flex h-3 overflow-hidden rounded-full border border-hair">
            <div
              className="h-full"
              style={{
                background: "var(--good)",
                width: pct(overlap.kept_by_all, overlap.compared),
              }}
              title={`Kept by all: ${overlap.kept_by_all}`}
            />
            <div
              className="h-full"
              style={{
                background: "var(--warn)",
                width: pct(overlap.kept_by_some, overlap.compared),
              }}
              title={`Kept by some: ${overlap.kept_by_some}`}
            />
            <div
              className="h-full flex-1"
              style={{ background: "var(--alert)" }}
              title={`Rejected by all: ${overlap.rejected_by_all}`}
            />
          </div>

          {keptByAllShown.length > 0 && (
            <div className="mt-8">
              <h3 className="eyebrow">Unanimous keeps</h3>
              <ul className="mt-3 grid list-none gap-1.5 p-0 sm:grid-cols-2">
                {keptByAllShown.map((e) => (
                  <li
                    key={e.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-hair-2 bg-surface px-3 py-2"
                  >
                    <span className="font-serif font-bold text-ink">{e.headword}</span>
                    <TypePill type={e.entry_type} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
