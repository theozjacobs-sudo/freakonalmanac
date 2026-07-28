"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { BrowseEntry } from "@/lib/types";
import { resolveToken } from "@/lib/token";
import EntryCardBody from "@/components/EntryCardBody";
import SetupNotice from "@/components/SetupNotice";
import { DecisionChip, FreshnessPill, TypePill } from "@/components/pills";

/**
 * The project's "web spreadsheet": every entry as cards or a sortable table,
 * with search, filters, and a client-side CSV export of exactly the rows
 * currently shown. The only decision data here is *your own*.
 */

type SortKey =
  | "headword"
  | "entry_type"
  | "category"
  | "episode_show"
  | "episode_date"
  | "freshness"
  | "my_decision";

const ENTRY_TYPES = ["concept", "figure", "fact", "person", "place", "story"];
const FRESHNESS = ["current", "aging", "check", "evergreen", "durable"];

const CSV_COLUMNS: { key: keyof BrowseEntry; label: string }[] = [
  { key: "id", label: "id" },
  { key: "headword", label: "headword" },
  { key: "entry_type", label: "entry_type" },
  { key: "category", label: "category" },
  { key: "claim", label: "claim" },
  { key: "quote", label: "quote" },
  { key: "speaker", label: "speaker" },
  { key: "episode_title", label: "episode_title" },
  { key: "episode_show", label: "episode_show" },
  { key: "episode_id", label: "episode_id" },
  { key: "episode_date", label: "episode_date" },
  { key: "episode_url", label: "episode_url" },
  { key: "age_years", label: "age_years" },
  { key: "freshness", label: "freshness" },
  { key: "freshness_note", label: "freshness_note" },
  { key: "verified_quote_in_transcript", label: "verified_quote_in_transcript" },
  { key: "my_decision", label: "my_decision" },
];

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function BrowseClient() {
  const searchParams = useSearchParams();
  const [entries, setEntries] = useState<BrowseEntry[] | null>(null);
  const [phase, setPhase] = useState<"loading" | "unconfigured" | "error" | "ready">(
    "loading"
  );
  const [view, setView] = useState<"table" | "cards">("table");

  const [q, setQ] = useState("");
  const [typeF, setTypeF] = useState("all");
  const [showF, setShowF] = useState("all");
  const [freshF, setFreshF] = useState("all");
  const [decisionF, setDecisionF] = useState("all");

  const [sortKey, setSortKey] = useState<SortKey>("headword");
  const [sortDir, setSortDir] = useState<1 | -1>(1);

  // ?entry=<id> — a shared permalink: spotlight that entry above the list.
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    setPinnedId(searchParams.get("entry"));
    const token = resolveToken(searchParams);
    const url = token
      ? `/api/entries?r=${encodeURIComponent(token)}`
      : "/api/entries";
    fetch(url, { cache: "no-store" })
      .then(async (res) => {
        if (res.status === 503) {
          setPhase("unconfigured");
          return;
        }
        if (!res.ok) throw new Error(`entries failed (${res.status})`);
        const data = await res.json();
        setEntries(data.entries as BrowseEntry[]);
        setPhase("ready");
      })
      .catch(() => setPhase("error"));
  }, [searchParams]);

  const shows = useMemo(() => {
    const s = new Set<string>();
    for (const e of entries ?? []) if (e.episode_show) s.add(e.episode_show);
    return Array.from(s).sort();
  }, [entries]);

  const filtered = useMemo(() => {
    if (!entries) return [];
    const needle = q.trim().toLowerCase();
    let rows = entries.filter((e) => {
      if (typeF !== "all" && e.entry_type !== typeF) return false;
      if (showF !== "all" && e.episode_show !== showF) return false;
      if (freshF !== "all" && e.freshness !== freshF) return false;
      if (decisionF === "undecided" && e.my_decision !== null) return false;
      if (
        (decisionF === "keep" || decisionF === "reject") &&
        e.my_decision !== decisionF
      )
        return false;
      if (needle) {
        const hay =
          `${e.headword} ${e.category ?? ""} ${e.claim ?? ""} ${e.quote ?? ""} ${e.speaker ?? ""} ${e.episode_title ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    rows = rows.slice().sort((a, b) => {
      const av = (a[sortKey] ?? "") as string;
      const bv = (b[sortKey] ?? "") as string;
      const cmp = String(av).localeCompare(String(bv), undefined, {
        sensitivity: "base",
        numeric: true,
      });
      return cmp !== 0 ? cmp * sortDir : a.headword.localeCompare(b.headword);
    });
    return rows;
  }, [entries, q, typeF, showF, freshF, decisionF, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortKey(key);
      setSortDir(1);
    }
  };

  const pinned = useMemo(
    () => (pinnedId ? (entries ?? []).find((e) => e.id === pinnedId) ?? null : null),
    [entries, pinnedId]
  );

  const copyShareLink = (id: string) => {
    const link = `${window.location.origin}/browse?entry=${encodeURIComponent(id)}`;
    navigator.clipboard?.writeText(link).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    });
  };

  const dismissPinned = () => {
    setPinnedId(null);
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("entry");
      window.history.replaceState(window.history.state, "", url.toString());
    } catch {
      /* cosmetic */
    }
  };

  const downloadCsv = () => {
    const header = CSV_COLUMNS.map((c) => c.label).join(",");
    const lines = filtered.map((e) =>
      CSV_COLUMNS.map((c) => csvCell(e[c.key])).join(",")
    );
    const blob = new Blob(["﻿" + [header, ...lines].join("\r\n")], {
      type: "text/csv;charset=utf-8",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `fact-finder-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (phase === "unconfigured") return <SetupNotice />;
  if (phase === "error")
    return (
      <p className="my-24 text-center text-sm text-muted">
        Couldn&rsquo;t load entries — try reloading.
      </p>
    );
  if (phase === "loading" || !entries)
    return (
      <p className="my-24 text-center font-mono text-sm text-faint">
        Loading entries…
      </p>
    );

  const th = (key: SortKey, label: string, extra = "") => (
    <th
      className={`cursor-pointer select-none whitespace-nowrap border-b border-hair px-3 py-2 text-left font-mono text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-muted hover:text-ink ${extra}`}
      onClick={() => toggleSort(key)}
      aria-sort={
        sortKey === key ? (sortDir === 1 ? "ascending" : "descending") : "none"
      }
    >
      {label}
      {sortKey === key && (
        <span className="ml-1 text-accent">{sortDir === 1 ? "▲" : "▼"}</span>
      )}
    </th>
  );

  const selectCls =
    "rounded-lg border border-hair bg-surface px-2.5 py-2 text-sm text-ink";

  return (
    <div className="py-5 sm:py-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-serif text-3xl font-bold tracking-tight text-ink">
          Browse
        </h1>
        <p className="font-mono text-xs tabular-nums text-muted">
          {filtered.length.toLocaleString()} of {entries.length.toLocaleString()} entries
        </p>
      </div>

      {/* toolbar */}
      <div className="sticky top-[57px] z-30 -mx-4 mt-4 border-b border-hair bg-[color-mix(in_srgb,var(--ground)_88%,transparent)] px-4 py-3 backdrop-blur-md sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search headwords, claims, quotes, speakers…"
            className="min-w-[180px] flex-1 rounded-lg border border-hair bg-surface px-3 py-2 text-sm text-ink placeholder:text-faint"
            aria-label="Search entries"
          />
          <select value={typeF} onChange={(e) => setTypeF(e.target.value)} className={selectCls} aria-label="Filter by type">
            <option value="all">All types</option>
            {ENTRY_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <select value={showF} onChange={(e) => setShowF(e.target.value)} className={selectCls} aria-label="Filter by show">
            <option value="all">All shows</option>
            {shows.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <select value={freshF} onChange={(e) => setFreshF(e.target.value)} className={selectCls} aria-label="Filter by freshness">
            <option value="all">All freshness</option>
            {FRESHNESS.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
          <select value={decisionF} onChange={(e) => setDecisionF(e.target.value)} className={selectCls} aria-label="Filter by my decision">
            <option value="all">Any status</option>
            <option value="keep">My keeps</option>
            <option value="reject">My rejects</option>
            <option value="undecided">Undecided</option>
          </select>

          <div className="ml-auto flex items-center gap-2">
            <div className="flex rounded-lg border border-hair bg-surface-2 p-0.5">
              {(["table", "cards"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  aria-pressed={view === v}
                  className={`rounded-md px-3 py-1.5 text-sm capitalize ${
                    view === v
                      ? "bg-accent font-semibold text-[var(--seg-on-fg)]"
                      : "text-muted hover:text-ink"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
            <button
              onClick={downloadCsv}
              className="rounded-lg border border-hair bg-surface px-3 py-2 font-mono text-xs font-semibold uppercase tracking-[0.08em] text-accent hover:bg-accent-soft"
              title="Download the current filtered rows as CSV"
            >
              ↓ CSV
            </button>
          </div>
        </div>
      </div>

      {/* shared-entry spotlight */}
      {pinned && (
        <div className="relative mt-4 rounded-2xl border-2 border-accent bg-surface p-5 shadow-card">
          <div className="mb-2 flex items-center justify-between">
            <p className="eyebrow">Shared entry</p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => copyShareLink(pinned.id)}
                className="rounded-lg border border-hair bg-surface-2 px-2.5 py-1 font-mono text-xs hover:border-accent"
              >
                {copiedId === pinned.id ? "Copied ✓" : "🔗 Copy link"}
              </button>
              <button
                onClick={dismissPinned}
                aria-label="Dismiss shared entry"
                className="rounded-lg border border-hair bg-surface-2 px-2.5 py-1 font-mono text-xs hover:border-accent"
              >
                ✕
              </button>
            </div>
          </div>
          <EntryCardBody entry={pinned} />
          {pinned.my_decision && (
            <div className="absolute -top-2 right-4">
              <DecisionChip decision={pinned.my_decision} />
            </div>
          )}
        </div>
      )}
      {pinnedId && entries && !pinned && (
        <p className="mt-4 rounded-xl border border-hair bg-surface-2 px-4 py-3 text-sm text-muted">
          The shared entry (<code className="font-mono text-xs">{pinnedId}</code>)
          wasn&rsquo;t found — it may have been removed.
        </p>
      )}

      {filtered.length === 0 ? (
        <p className="py-20 text-center text-muted">
          No entries match — try clearing the filters.
        </p>
      ) : view === "table" ? (
        <div className="mt-4 overflow-x-auto rounded-xl border border-hair bg-surface shadow-card">
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead>
              <tr className="bg-surface-2">
                {th("headword", "Headword")}
                {th("entry_type", "Type")}
                {th("category", "Category")}
                {th("episode_show", "Show")}
                {th("episode_date", "Date")}
                {th("freshness", "Freshness")}
                {th("my_decision", "Mine")}
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.id} className="border-b border-hair-2 last:border-0 hover:bg-surface-2">
                  <td className="px-3 py-2">
                    <span className="font-serif text-[0.95rem] font-bold text-ink">
                      {e.headword}
                    </span>
                    {e.episode_url && (
                      <a
                        href={e.episode_url}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-1.5 text-xs text-accent no-underline opacity-70 hover:opacity-100"
                        title={e.episode_title ?? undefined}
                      >
                        ↗
                      </a>
                    )}
                    <button
                      onClick={() => copyShareLink(e.id)}
                      title="Copy a shareable link to this entry"
                      className="ml-1.5 text-xs opacity-40 hover:opacity-100"
                    >
                      {copiedId === e.id ? "✓" : "🔗"}
                    </button>
                  </td>
                  <td className="px-3 py-2"><TypePill type={e.entry_type} /></td>
                  <td className="max-w-[180px] truncate px-3 py-2 text-muted" title={e.category ?? undefined}>
                    {e.category}
                  </td>
                  <td className="max-w-[180px] truncate px-3 py-2 text-muted" title={e.episode_show ?? undefined}>
                    {e.episode_show}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs tabular-nums text-faint">
                    {e.episode_date}
                  </td>
                  <td className="px-3 py-2">
                    <FreshnessPill freshness={e.freshness} title={e.freshness_note} />
                  </td>
                  <td className="px-3 py-2"><DecisionChip decision={e.my_decision} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {filtered.map((e) => (
            <div
              key={e.id}
              className="relative rounded-2xl border border-hair bg-surface p-5 shadow-card"
            >
              <EntryCardBody entry={e} />
              {e.my_decision && (
                <div className="absolute -top-2 right-4">
                  <DecisionChip decision={e.my_decision} />
                </div>
              )}
              <button
                onClick={() => copyShareLink(e.id)}
                title="Copy a shareable link to this entry"
                className="absolute bottom-3 right-3 text-sm opacity-40 hover:opacity-100"
              >
                {copiedId === e.id ? "✓" : "🔗"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
