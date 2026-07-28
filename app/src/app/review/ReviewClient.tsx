"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { Decision, Entry, QueueResponse } from "@/lib/types";
import { resolveToken } from "@/lib/token";
import EntryCardBody from "@/components/EntryCardBody";
import NoTokenNotice from "@/components/NoTokenNotice";
import SetupNotice from "@/components/SetupNotice";

/**
 * The blind swipe deck.
 *
 * Right / 👍 / ArrowRight = keep. Left / 👎 / ArrowLeft = reject.
 * Decisions are written optimistically; the next card is already mounted
 * underneath the top one. Nothing on this page ever reflects another
 * reviewer's decisions.
 */

const SWIPE_THRESHOLD = 90; // px past which release commits
const FETCH_LOW_WATER = 6; // refill buffer when fewer than this remain
const BATCH = 20;

type Phase = "loading" | "no-token" | "bad-token" | "unconfigured" | "error" | "ready";

interface HistoryItem {
  entry: Entry;
  decision: Decision;
}

export default function ReviewClient() {
  const searchParams = useSearchParams();
  const [token, setToken] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [reviewerName, setReviewerName] = useState<string>("");
  const [queue, setQueue] = useState<Entry[]>([]);
  const [total, setTotal] = useState(0);
  const [done, setDone] = useState(0);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [errorMsg, setErrorMsg] = useState("");

  // Everything the pointer/animation logic needs without re-rendering.
  const [drag, setDrag] = useState({ dx: 0, dy: 0, dragging: false });
  const [flying, setFlying] = useState<{
    entry: Entry;
    dir: 1 | -1;
  } | null>(null);
  const pointerRef = useRef<{ id: number; x: number; y: number } | null>(null);
  const decidedIdsRef = useRef<Set<string>>(new Set());
  const fetchingRef = useRef(false);

  // ---- token bootstrap -----------------------------------------------
  useEffect(() => {
    const t = resolveToken(searchParams);
    setToken(t);
    if (!t) setPhase("no-token");
  }, [searchParams]);

  // ---- queue fetching --------------------------------------------------
  const fetchQueue = useCallback(
    async (tok: string, initial = false) => {
      if (fetchingRef.current) return;
      fetchingRef.current = true;
      try {
        const res = await fetch(
          `/api/queue?r=${encodeURIComponent(tok)}&limit=${BATCH}`,
          { cache: "no-store" }
        );
        if (res.status === 401) {
          setPhase("bad-token");
          return;
        }
        if (res.status === 503) {
          setPhase("unconfigured");
          return;
        }
        if (!res.ok) throw new Error(`queue failed (${res.status})`);
        const data: QueueResponse = await res.json();
        setReviewerName(data.reviewer.name);
        setTotal(data.total);
        if (initial) setDone(data.done);
        setQueue((prev) => {
          const seen = new Set(prev.map((e) => e.id));
          const fresh = data.entries.filter(
            (e) => !seen.has(e.id) && !decidedIdsRef.current.has(e.id)
          );
          return [...prev, ...fresh];
        });
        setPhase("ready");
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : "Something went wrong");
        setPhase("error");
      } finally {
        fetchingRef.current = false;
      }
    },
    []
  );

  useEffect(() => {
    if (token) void fetchQueue(token, true);
  }, [token, fetchQueue]);

  // Refill when running low.
  useEffect(() => {
    if (phase === "ready" && token && queue.length < FETCH_LOW_WATER && done < total) {
      void fetchQueue(token);
    }
  }, [phase, token, queue.length, done, total, fetchQueue]);

  // ---- deciding --------------------------------------------------------
  const commit = useCallback(
    (dir: 1 | -1) => {
      const entry = queue[0];
      if (!entry || !token || flying) return;
      const decision: Decision = dir === 1 ? "keep" : "reject";

      decidedIdsRef.current.add(entry.id);
      setFlying({ entry, dir });
      setQueue((q) => q.slice(1));
      setDone((d) => d + 1);
      setHistory((h) => [...h, { entry, decision }].slice(-50));
      setDrag({ dx: 0, dy: 0, dragging: false });

      // Optimistic write; on failure, quietly roll back the count so the
      // entry resurfaces on the next queue fetch.
      void fetch("/api/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, entry_id: entry.id, decision }),
      })
        .then((res) => {
          if (!res.ok) throw new Error("decide failed");
        })
        .catch(() => {
          decidedIdsRef.current.delete(entry.id);
          setDone((d) => Math.max(0, d - 1));
          setHistory((h) => h.filter((item) => item.entry.id !== entry.id));
        });

      window.setTimeout(() => setFlying(null), 320);
    },
    [queue, token, flying]
  );

  const undo = useCallback(() => {
    const last = history[history.length - 1];
    if (!last || !token) return;
    setHistory((h) => h.slice(0, -1));
    decidedIdsRef.current.delete(last.entry.id);
    setQueue((q) => [last.entry, ...q.filter((e) => e.id !== last.entry.id)]);
    setDone((d) => Math.max(0, d - 1));
    void fetch("/api/undo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, entry_id: last.entry.id }),
    }).catch(() => {
      /* card is back on top either way; a re-decide will overwrite */
    });
  }, [history, token]);

  // ---- keyboard --------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        commit(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        commit(-1);
      } else if ((e.key === "z" || e.key === "Z") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [commit, undo]);

  // ---- pointer / swipe -------------------------------------------------
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (flying) return;
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    pointerRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    setDrag({ dx: 0, dy: 0, dragging: true });
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = pointerRef.current;
    if (!start || start.id !== e.pointerId) return;
    setDrag({
      dx: e.clientX - start.x,
      dy: (e.clientY - start.y) * 0.25,
      dragging: true,
    });
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = pointerRef.current;
    if (!start || start.id !== e.pointerId) return;
    pointerRef.current = null;
    const dx = e.clientX - start.x;
    if (Math.abs(dx) > SWIPE_THRESHOLD) {
      commit(dx > 0 ? 1 : -1);
    } else {
      setDrag({ dx: 0, dy: 0, dragging: false });
    }
  };

  // The browser taking over (e.g. vertical scroll on touch) cancels the
  // gesture — snap back, never commit on a cancel.
  const cancelDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = pointerRef.current;
    if (!start || start.id !== e.pointerId) return;
    pointerRef.current = null;
    setDrag({ dx: 0, dy: 0, dragging: false });
  };

  // ---- render ----------------------------------------------------------
  if (phase === "no-token") return <NoTokenNotice />;
  if (phase === "bad-token") return <NoTokenNotice invalid />;
  if (phase === "unconfigured") return <SetupNotice />;
  if (phase === "error")
    return (
      <div className="mx-auto my-16 max-w-lg rounded-2xl border border-hair bg-surface p-6 text-center shadow-card">
        <h2 className="font-serif text-xl font-bold text-ink">Hmm, that didn&rsquo;t work</h2>
        <p className="mt-2 text-sm text-muted">{errorMsg}</p>
        <button
          onClick={() => window.location.reload()}
          className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white"
        >
          Reload
        </button>
      </div>
    );
  if (phase === "loading")
    return (
      <p className="my-24 text-center font-mono text-sm text-faint">
        Shuffling the deck…
      </p>
    );

  const current = queue[0];
  const next = queue[1];
  const rotation = drag.dx / 20;
  const keepOpacity = Math.min(Math.max(drag.dx - 24, 0) / 100, 1);
  const rejectOpacity = Math.min(Math.max(-drag.dx - 24, 0) / 100, 1);
  const progressPct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="flex flex-col pb-8 pt-4 sm:pt-6">
      {/* progress line */}
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <p className="font-mono text-xs tabular-nums text-muted">
          {done.toLocaleString()} of {total.toLocaleString()}
          <span className="ml-2 text-faint">({progressPct}%)</span>
        </p>
        <p className="eyebrow">{reviewerName}&rsquo;s deck</p>
      </div>
      <div className="mb-4 h-1 overflow-hidden rounded-full bg-hair-2">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-300"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {!current && !flying ? (
        <div className="mx-auto my-16 max-w-md rounded-2xl border border-hair bg-surface p-8 text-center shadow-card">
          <p className="text-3xl">🎉</p>
          <h2 className="mt-2 font-serif text-2xl font-bold text-ink">Deck cleared</h2>
          <p className="mt-2 text-sm text-muted">
            You&rsquo;ve reviewed everything currently assigned to you. New entries
            will show up here as they&rsquo;re mined.
          </p>
        </div>
      ) : (
        <div
          className="relative mx-auto w-full max-w-xl"
          style={{ height: "min(72vh, 640px)" }}
        >
          {/* next card, waiting underneath */}
          {next && (
            <div
              key={next.id}
              className="absolute inset-0 flex flex-col overflow-y-auto rounded-2xl border border-hair bg-surface p-5 shadow-card sm:p-6"
              style={{ transform: "scale(0.97) translateY(8px)" }}
              aria-hidden
            >
              <EntryCardBody entry={next} large />
            </div>
          )}

          {/* card flying out after a decision */}
          {flying && (
            <div
              key={`fly-${flying.entry.id}`}
              className="deck-card deck-card--animating absolute inset-0 z-20 flex flex-col overflow-hidden rounded-2xl border border-hair bg-surface p-5 shadow-card sm:p-6"
              style={{
                transform: `translate(${flying.dir * 130}%, -4%) rotate(${flying.dir * 16}deg)`,
                opacity: 0,
              }}
              aria-hidden
            >
              <EntryCardBody entry={flying.entry} large />
            </div>
          )}

          {/* the live top card */}
          {current && (
            <div
              key={current.id}
              className={`deck-card absolute inset-0 z-10 flex touch-pan-y flex-col overflow-y-auto rounded-2xl border border-hair bg-surface p-5 shadow-card sm:p-6 ${
                drag.dragging ? "" : "deck-card--return"
              }`}
              style={{
                transform: `translate(${drag.dx}px, ${drag.dy}px) rotate(${rotation}deg)`,
                cursor: drag.dragging ? "grabbing" : "grab",
              }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={cancelDrag}
            >
              {/* keep / reject stamps */}
              <div
                className="stamp absolute left-4 top-4 z-20 -rotate-12"
                style={{ opacity: keepOpacity, color: "var(--good)" }}
              >
                Keep
              </div>
              <div
                className="stamp absolute right-4 top-4 z-20 rotate-12"
                style={{ opacity: rejectOpacity, color: "var(--alert)" }}
              >
                Reject
              </div>
              <EntryCardBody entry={current} large />
            </div>
          )}
        </div>
      )}

      {/* controls */}
      <div className="mx-auto mt-5 flex w-full max-w-xl items-center justify-center gap-4">
        <button
          onClick={() => commit(-1)}
          disabled={!current}
          aria-label="Reject (left arrow)"
          className="flex h-16 w-16 items-center justify-center rounded-full border border-hair bg-surface text-2xl shadow-card transition-transform hover:scale-105 active:scale-95 disabled:opacity-40"
        >
          👎
        </button>
        <button
          onClick={undo}
          disabled={history.length === 0}
          className="rounded-full border border-hair bg-surface-2 px-4 py-2 font-mono text-xs uppercase tracking-[0.1em] text-muted transition-colors hover:text-ink disabled:opacity-40"
        >
          ↩ Undo
        </button>
        <button
          onClick={() => commit(1)}
          disabled={!current}
          aria-label="Keep (right arrow)"
          className="flex h-16 w-16 items-center justify-center rounded-full border border-hair bg-surface text-2xl shadow-card transition-transform hover:scale-105 active:scale-95 disabled:opacity-40"
        >
          👍
        </button>
      </div>
      <p className="mt-3 text-center font-mono text-[0.7rem] uppercase tracking-[0.12em] text-faint">
        ← reject &middot; keep →
      </p>
    </div>
  );
}
