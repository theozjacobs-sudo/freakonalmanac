"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { ChatEvent, ChatMode, ChatSource } from "@/lib/types";
import { resolveToken } from "@/lib/token";
import NoTokenNotice from "@/components/NoTokenNotice";
import MarkdownLite from "@/components/MarkdownLite";

/**
 * Grounded chat over the archive, in three modes:
 *  - Archive:  full-text search over every transcript passage, answers
 *              grounded in (and citing) the retrieved passages.
 *  - Entries:  the AI editor — curates/ranks almanac entries, with optional
 *              type + show filters.
 *  - Episode:  chat about one episode (opened from an entry card's
 *              "chat about this episode" link).
 *
 * The POST /api/chat response is NDJSON (one ChatEvent per line): search
 * activity, streamed answer text, and cited episodes — rendered as they
 * arrive.
 */

const ENTRY_TYPES = ["concept", "figure", "fact", "person", "place", "story"];
const SHOWS = [
  "Freakonomics Radio",
  "No Stupid Questions",
  "People I (Mostly) Admire",
  "The Economics of Everyday Things",
  "Freakonomics, M.D.",
  "The Freakonomics Radio Book Club",
  "Off Leash",
  "Sudhir Breaks the Internet",
];

const MODES: { id: ChatMode; label: string; hint: string }[] = [
  {
    id: "archive",
    label: "Archive",
    hint: "Ask the transcripts — answers come only from retrieved passages.",
  },
  {
    id: "entries",
    label: "Entries",
    hint: "The AI editor — curated, ranked lists from the entry pool.",
  },
  {
    id: "episode",
    label: "Episode",
    hint: "Chat about one episode. Open it from an entry card's 💬 link.",
  },
];

const PLACEHOLDERS: Record<ChatMode, string> = {
  archive: "e.g. What have guests said about surge pricing?",
  entries: "e.g. Give me your 25 best animal stories",
  episode: "Ask anything about this episode…",
};

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  sources?: ChatSource[];
  searches?: string[];
  error?: boolean;
}

type Phase =
  | "loading"
  | "no-token"
  | "bad-token"
  | "unconfigured"
  | "error"
  | "ready";

export default function ChatClient() {
  const searchParams = useSearchParams();
  const [token, setToken] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [missing, setMissing] = useState<string[]>([]);
  const [mode, setMode] = useState<ChatMode>("archive");
  const [episodeId, setEpisodeId] = useState<string | null>(null);
  const [episode, setEpisode] = useState<ChatSource | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [entryTypeF, setEntryTypeF] = useState("all");
  const [showF, setShowF] = useState("all");

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // ---- bootstrap: token + mode from URL, then ping the API ---------------
  useEffect(() => {
    const t = resolveToken(searchParams);
    setToken(t);
    if (!t) {
      setPhase("no-token");
      return;
    }
    const urlMode = searchParams.get("mode");
    const urlEpisode = searchParams.get("episode");
    const startMode: ChatMode =
      urlMode === "episode" && urlEpisode
        ? "episode"
        : urlMode === "entries"
          ? "entries"
          : "archive";
    setMode(startMode);
    setEpisodeId(urlEpisode);

    const qs = new URLSearchParams({ r: t });
    if (urlEpisode) qs.set("episode", urlEpisode);
    fetch(`/api/chat?${qs.toString()}`, { cache: "no-store" })
      .then(async (res) => {
        if (res.status === 503) {
          const data = await res.json().catch(() => null);
          setMissing((data?.missing as string[]) ?? []);
          setPhase("unconfigured");
          return;
        }
        if (res.status === 401) {
          setPhase("bad-token");
          return;
        }
        if (!res.ok) throw new Error(`chat ping failed (${res.status})`);
        const data = await res.json();
        if (data.episode) setEpisode(data.episode as ChatSource);
        setPhase("ready");
      })
      .catch(() => setPhase("error"));
  }, [searchParams]);

  // Keep the newest message in view while streaming.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const switchMode = (m: ChatMode) => {
    if (m === mode || streaming) return;
    setMode(m);
    setMessages([]); // different grounding — start a fresh thread
  };

  // ---- sending ------------------------------------------------------------
  const send = useCallback(async () => {
    const question = input.trim();
    if (!question || !token || streaming) return;
    if (mode === "episode" && !episodeId) return;

    const history = [...messages, { role: "user" as const, content: question }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setInput("");
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    const patchLast = (patch: Partial<ChatMessage>) =>
      setMessages((cur) => {
        const next = cur.slice();
        next[next.length - 1] = { ...next[next.length - 1], ...patch };
        return next;
      });

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          token,
          mode,
          messages: history.map(({ role, content }) => ({ role, content })),
          entry_type: mode === "entries" && entryTypeF !== "all" ? entryTypeF : undefined,
          show: mode === "entries" && showF !== "all" ? showF : undefined,
          episode_id: mode === "episode" ? episodeId : undefined,
        }),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => null);
        if (res.status === 503) {
          setMissing((data?.missing as string[]) ?? []);
          setPhase("unconfigured");
          return;
        }
        if (res.status === 401) {
          setPhase("bad-token");
          return;
        }
        throw new Error((data?.error as string) ?? `chat failed (${res.status})`);
      }

      // NDJSON: one ChatEvent per line, rendered as it arrives.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let text = "";
      let failed = false;
      const searches: string[] = [];

      const handle = (ev: ChatEvent) => {
        if (ev.type === "delta") {
          text += ev.text;
          patchLast({ content: text });
        } else if (ev.type === "search") {
          searches.push(ev.query);
          patchLast({ searches: [...searches] });
        } else if (ev.type === "sources") {
          patchLast({ sources: ev.sources });
        } else if (ev.type === "error") {
          failed = true;
          patchLast({
            content:
              text ||
              "Something went wrong talking to the archive. Give it another try in a moment.",
            error: true,
          });
        }
      };

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (line) handle(JSON.parse(line) as ChatEvent);
        }
      }
      const tail = (buffer + decoder.decode()).trim();
      if (tail) handle(JSON.parse(tail) as ChatEvent);

      if (!text.trim() && !failed) {
        patchLast({
          content: "(No answer came back — try asking again.)",
          error: true,
        });
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        patchLast({
          content:
            "Something went wrong talking to the archive. Give it another try in a moment.",
          error: true,
        });
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }, [input, token, streaming, mode, episodeId, messages, entryTypeF, showF]);

  // ---- render --------------------------------------------------------------
  if (phase === "no-token") return <NoTokenNotice />;
  if (phase === "bad-token") return <NoTokenNotice invalid />;
  if (phase === "unconfigured")
    return (
      <div className="mx-auto my-16 max-w-lg rounded-2xl border border-hair bg-surface p-6 shadow-card">
        <p className="eyebrow">Setup needed</p>
        <h2 className="mt-1 font-serif text-2xl font-bold text-ink">
          Chat isn&rsquo;t configured yet
        </h2>
        <p className="mt-2 text-sm text-muted">
          The chat needs {missing.length > 0 ? "these environment variables" : "its environment"} set
          on the server{missing.length > 0 ? ":" : "."}
        </p>
        {missing.length > 0 && (
          <ul className="mt-2 list-disc pl-5 text-sm text-muted">
            {missing.map((m) => (
              <li key={m}>
                <code className="font-mono text-[0.85em]">{m}</code>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-sm text-muted">
          See <code className="font-mono text-[0.85em]">app/README.md</code> — and make sure the
          passages table has been seeded with{" "}
          <code className="font-mono text-[0.85em]">scripts/seed-passages.mjs</code>.
        </p>
      </div>
    );
  if (phase === "error")
    return (
      <p className="my-24 text-center text-sm text-muted">
        Couldn&rsquo;t reach the chat API — try reloading.
      </p>
    );
  if (phase === "loading")
    return (
      <p className="my-24 text-center font-mono text-sm text-faint">
        Opening the archive…
      </p>
    );

  const activeHint = MODES.find((m) => m.id === mode)?.hint ?? "";

  return (
    <div className="flex flex-col py-5 sm:py-8" style={{ minHeight: "calc(100dvh - 120px)" }}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-serif text-3xl font-bold tracking-tight text-ink">Chat</h1>
        <p className="eyebrow">Grounded in the archive</p>
      </div>

      {/* mode pills */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-hair bg-surface-2 p-0.5">
          {MODES.map((m) => {
            const disabled = m.id === "episode" && !episodeId;
            return (
              <button
                key={m.id}
                onClick={() => switchMode(m.id)}
                disabled={disabled || streaming}
                aria-pressed={mode === m.id}
                title={disabled ? "Open an episode chat from an entry card's 💬 link" : m.hint}
                className={`rounded-md px-3 py-1.5 text-sm ${
                  mode === m.id
                    ? "bg-accent font-semibold text-[var(--seg-on-fg)]"
                    : "text-muted hover:text-ink disabled:opacity-40"
                }`}
              >
                {m.label}
              </button>
            );
          })}
        </div>

        {mode === "entries" && (
          <>
            <select
              value={entryTypeF}
              onChange={(e) => setEntryTypeF(e.target.value)}
              className="rounded-lg border border-hair bg-surface px-2.5 py-1.5 text-sm text-ink"
              aria-label="Filter entries by type"
            >
              <option value="all">All types</option>
              {ENTRY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <select
              value={showF}
              onChange={(e) => setShowF(e.target.value)}
              className="rounded-lg border border-hair bg-surface px-2.5 py-1.5 text-sm text-ink"
              aria-label="Filter entries by show"
            >
              <option value="all">All shows</option>
              {SHOWS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </>
        )}
      </div>

      {/* episode header */}
      {mode === "episode" && episode && (
        <div className="mt-3 rounded-xl border border-hair bg-surface-2 px-4 py-3">
          <p className="eyebrow">Chatting about</p>
          <p className="mt-0.5 text-sm text-ink">
            {episode.url ? (
              <a
                href={episode.url}
                target="_blank"
                rel="noreferrer"
                className="font-serif text-base font-bold text-ink no-underline hover:text-accent"
              >
                {episode.episode_title ?? "Episode"}
                <span className="ml-1 text-accent opacity-60">↗</span>
              </a>
            ) : (
              <span className="font-serif text-base font-bold">
                {episode.episode_title ?? "Episode"}
              </span>
            )}
            {episode.show && <span className="ml-2 text-muted">{episode.show}</span>}
            {episode.date && (
              <span className="ml-2 font-mono text-xs tabular-nums text-faint">
                {episode.date}
              </span>
            )}
          </p>
        </div>
      )}

      {/* transcript */}
      <div
        ref={scrollRef}
        className="mt-4 flex-1 space-y-4 overflow-y-auto rounded-2xl border border-hair bg-surface p-4 shadow-card sm:p-5"
      >
        {messages.length === 0 ? (
          <div className="flex h-full min-h-[200px] flex-col items-center justify-center text-center">
            <p className="text-3xl">💬</p>
            <p className="mt-2 max-w-sm text-sm text-muted">{activeHint}</p>
            <p className="mt-1 max-w-sm font-mono text-xs text-faint">
              Answers come only from the transcripts — never from model memory.
            </p>
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
              <div
                className={
                  m.role === "user"
                    ? "max-w-[85%] rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-sm text-[var(--seg-on-fg)]"
                    : "max-w-[92%] rounded-2xl rounded-bl-md border border-hair-2 bg-surface-2 px-4 py-2.5 text-sm text-ink"
                }
              >
                {m.role === "assistant" && m.searches && m.searches.length > 0 && (
                  <div className="mb-2 space-y-0.5">
                    {m.searches.map((q, k) => (
                      <p key={k} className="m-0 font-mono text-xs text-faint">
                        🔍{" "}
                        {streaming && i === messages.length - 1 && k === m.searches!.length - 1 && !m.content
                          ? `searching: ${q}…`
                          : q}
                      </p>
                    ))}
                  </div>
                )}
                {m.role === "assistant" && !m.error ? (
                  <div>
                    <MarkdownLite text={m.content} />
                    {streaming && i === messages.length - 1 && (
                      <span className="ml-1 inline-block animate-pulse text-accent">▌</span>
                    )}
                  </div>
                ) : (
                  <p className={`m-0 whitespace-pre-wrap ${m.error ? "text-alert" : ""}`}>
                    {m.content}
                  </p>
                )}
                {m.role === "assistant" && m.sources && m.sources.length > 0 && (
                  <div className="mt-3 border-t border-hair-2 pt-2">
                    <p className="eyebrow">Episodes</p>
                    <ul className="mt-1 space-y-0.5">
                      {m.sources.map((s, j) => (
                        <li key={`${s.episode_id ?? j}`} className="text-xs text-muted">
                          {s.url ? (
                            <a
                              href={s.url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-accent no-underline hover:underline"
                            >
                              {s.episode_title ?? "Episode"} ↗
                            </a>
                          ) : (
                            <span>{s.episode_title ?? "Episode"}</span>
                          )}
                          {s.show && <span className="ml-1.5 text-faint">{s.show}</span>}
                          {s.date && (
                            <span className="ml-1.5 font-mono tabular-nums text-faint">
                              {s.date}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* composer */}
      <form
        className="mt-3 flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={2}
          placeholder={PLACEHOLDERS[mode]}
          aria-label="Message"
          className="min-h-[52px] flex-1 resize-y rounded-xl border border-hair bg-surface px-3.5 py-2.5 text-sm text-ink placeholder:text-faint"
        />
        <button
          type="submit"
          disabled={streaming || !input.trim() || (mode === "episode" && !episodeId)}
          className="rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-[var(--seg-on-fg)] transition-opacity disabled:opacity-40"
        >
          {streaming ? "…" : "Send"}
        </button>
      </form>
      <p className="mt-2 text-center font-mono text-[0.7rem] uppercase tracking-[0.12em] text-faint">
        Enter to send · Shift+Enter for a new line
      </p>
    </div>
  );
}
