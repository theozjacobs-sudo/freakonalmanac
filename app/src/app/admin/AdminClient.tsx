"use client";

import { useEffect, useState } from "react";
import { resolveToken } from "@/lib/token";
import SetupNotice from "@/components/SetupNotice";

interface ReviewerRow {
  id: number;
  name: string;
  token: string;
  is_admin: boolean;
}

/** Admin-only team page: see everyone's links, add a new reviewer. */
export default function AdminClient() {
  const [token, setToken] = useState<string | null>(null);
  const [rows, setRows] = useState<ReviewerRow[]>([]);
  const [phase, setPhase] = useState<
    "loading" | "unconfigured" | "forbidden" | "error" | "ready"
  >("loading");
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
    const t = resolveToken(new URLSearchParams(window.location.search));
    setToken(t);
    if (!t) {
      setPhase("forbidden");
      return;
    }
    fetch(`/api/reviewers?token=${encodeURIComponent(t)}`, { cache: "no-store" })
      .then(async (res) => {
        if (res.status === 503) return setPhase("unconfigured");
        if (res.status === 401 || res.status === 403) return setPhase("forbidden");
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { reviewers: ReviewerRow[] };
        setRows(data.reviewers);
        setPhase("ready");
      })
      .catch(() => setPhase("error"));
  }, []);

  async function addReviewer(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !name.trim() || adding) return;
    setAdding(true);
    try {
      const res = await fetch("/api/reviewers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, name: name.trim() }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { reviewer: ReviewerRow };
      setRows((r) => [...r, data.reviewer]);
      setName("");
    } catch {
      alert("Couldn't add reviewer — try again.");
    } finally {
      setAdding(false);
    }
  }

  function copy(link: string) {
    navigator.clipboard?.writeText(link).then(() => {
      setCopied(link);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  if (phase === "loading") return <p className="p-8 text-muted">Loading…</p>;
  if (phase === "unconfigured") return <SetupNotice />;
  if (phase === "forbidden")
    return (
      <div className="mx-auto max-w-lg p-8">
        <h1 className="font-serif text-3xl font-bold">Team</h1>
        <p className="mt-3 text-muted">
          This page is for the project admin. Open it with your admin link
          (Theo — that&apos;s your usual <code>?r=…</code> link).
        </p>
      </div>
    );
  if (phase === "error")
    return <p className="p-8 text-muted">Something went wrong — refresh to retry.</p>;

  return (
    <div className="mx-auto max-w-3xl p-6 sm:p-8">
      <h1 className="font-serif text-4xl font-bold">Team</h1>
      <p className="mt-2 text-muted">
        Everyone below can review, browse, and chat. Send each person their
        review link — one click and their browser remembers them.
      </p>

      <div className="mt-8 space-y-3">
        {rows.map((r) => {
          const link = `${origin}/review?r=${r.token}`;
          return (
            <div
              key={r.id}
              className="flex flex-col gap-2 rounded-xl border border-hair bg-surface p-4 sm:flex-row sm:items-center"
            >
              <div className="min-w-0 flex-1">
                <div className="font-serif text-lg font-bold">
                  {r.name}
                  {r.is_admin && (
                    <span className="ml-2 align-middle font-mono text-[0.65rem] uppercase tracking-wider text-accent">
                      admin
                    </span>
                  )}
                </div>
                <div className="truncate font-mono text-xs text-muted">{link}</div>
              </div>
              <button
                onClick={() => copy(link)}
                className="shrink-0 rounded-lg border border-hair bg-surface-2 px-4 py-2 font-mono text-xs hover:border-accent"
              >
                {copied === link ? "Copied ✓" : "Copy link"}
              </button>
            </div>
          );
        })}
      </div>

      <form onSubmit={addReviewer} className="mt-8 flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New reviewer's name (e.g. Ellen)"
          className="flex-1 rounded-lg border border-hair bg-surface px-4 py-2.5"
          maxLength={60}
        />
        <button
          type="submit"
          disabled={adding || !name.trim()}
          className="rounded-lg bg-accent px-5 py-2.5 font-semibold text-white disabled:opacity-50"
        >
          {adding ? "Adding…" : "Add"}
        </button>
      </form>
      <p className="mt-2 text-xs text-muted">
        Note: in blind-review mode every reviewer sees all {""}entries — a new
        person starts with the full deck.
      </p>
    </div>
  );
}
