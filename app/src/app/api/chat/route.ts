import { NextRequest, NextResponse } from "next/server";
import {
  fetchAll,
  getReviewerByToken,
  getSupabase,
  isConfigured,
} from "@/lib/supabase";
import {
  AgentTool,
  ChatTurn,
  isAnthropicConfigured,
  runAgenticChat,
  streamClaudeText,
} from "@/lib/claude";
import { handleRouteError, jsonError } from "@/lib/api";
import type { ChatEvent, ChatMode, ChatSource } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The grounded chat endpoint, three modes:
 *
 *  - archive:  agentic — Claude drives the search_archive tool itself
 *              (multiple searches, its own queries), then answers from the
 *              retrieved passages only, with inline citations.
 *  - entries:  question (+ optional entry_type / show filters) -> a capped,
 *              category-diverse sample of `entries` -> Claude curates/ranks.
 *  - episode:  every passage of one episode, in order -> chat about it.
 *
 * POST body: { token, mode, messages: [{role, content}...],
 *              entry_type?, show?, episode_id? }
 * Response: NDJSON — one ChatEvent per line (see lib/types.ts).
 *
 * GET is a tiny helper for the /chat page: token + config check, and
 * episode metadata lookup (?episode=<id>).
 */

const MAX_HISTORY_MESSAGES = 16; // ~8 turns
const SEARCH_MATCHES = 8; // per search_archive call
const MAX_SEARCH_ROUNDS = 6;
const ENTRY_MATCHES = 25; // per search_entries call
const ENTRY_PAGE = 40; // per browse_entries call
const MAX_TRANSCRIPT_CHARS = 300_000;
const MAX_QUESTION_CHARS = 4_000;

interface PassageRow {
  id: number;
  episode_id: string | null;
  speaker: string | null;
  content: string | null;
  episode_title: string | null;
  show: string | null;
  date: string | null;
  url: string | null;
}

interface EntryRow {
  id: string;
  headword: string;
  entry_type: string;
  category: string | null;
  claim: string | null;
  quote: string | null;
  speaker: string | null;
  episode_title: string | null;
  episode_show: string | null;
  episode_id: string | null;
  episode_date: string | null;
  episode_url: string | null;
}

const PASSAGE_COLS =
  "id,episode_id,speaker,content,episode_title,show,date,url";

function missingConfig(): string[] {
  const missing: string[] = [];
  if (!isConfigured()) missing.push("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  if (!isAnthropicConfigured()) missing.push("ANTHROPIC_API_KEY");
  return missing;
}

function notConfigured(missing: string[]) {
  return NextResponse.json(
    { error: "not_configured", missing },
    { status: 503 }
  );
}

function toSource(p: PassageRow): ChatSource {
  return {
    episode_id: p.episode_id,
    episode_title: p.episode_title,
    show: p.show,
    date: p.date,
    url: p.url,
  };
}

function dedupeSources(rows: PassageRow[]): ChatSource[] {
  const seen = new Set<string>();
  const out: ChatSource[] = [];
  for (const p of rows) {
    const key = p.episode_id ?? p.episode_title ?? String(p.id);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(toSource(p));
  }
  return out;
}

/** Sanitize + cap the client-sent history: text turns ending on a user turn. */
function normalizeHistory(raw: unknown): ChatTurn[] | null {
  if (!Array.isArray(raw)) return null;
  const turns: ChatTurn[] = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") return null;
    const role = (m as { role?: unknown }).role;
    const content = (m as { content?: unknown }).content;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string")
      return null;
    const text = content.slice(0, MAX_QUESTION_CHARS).trim();
    if (text) turns.push({ role, content: text });
  }
  let capped = turns.slice(-MAX_HISTORY_MESSAGES);
  // The API requires the first message to be a user turn.
  while (capped.length > 0 && capped[0].role === "assistant") {
    capped = capped.slice(1);
  }
  if (capped.length === 0 || capped[capped.length - 1].role !== "user")
    return null;
  return capped;
}

/** Stream ChatEvents as NDJSON; a crash becomes an error event, not a 500. */
function ndjsonResponse(
  run: (emit: (ev: ChatEvent) => void) => Promise<void>
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (ev: ChatEvent) =>
        controller.enqueue(encoder.encode(JSON.stringify(ev) + "\n"));
      try {
        await run(emit);
      } catch (err) {
        console.error("[chat]", err);
        emit({
          type: "error",
          message: err instanceof Error ? err.message : "unknown error",
        });
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}

// ---------------------------------------------------------------------------
// GET — config/token ping + episode metadata for the /chat header.
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  try {
    const missing = missingConfig();
    if (missing.length > 0) return notConfigured(missing);

    const sb = getSupabase();
    const reviewer = await getReviewerByToken(
      sb,
      req.nextUrl.searchParams.get("r")
    );
    if (!reviewer) return jsonError(401, "invalid_token");

    const episodeId = req.nextUrl.searchParams.get("episode");
    let episode: ChatSource | null = null;
    if (episodeId) {
      const { data, error } = await sb
        .from("passages")
        .select(PASSAGE_COLS)
        .eq("episode_id", episodeId)
        .order("id")
        .limit(1);
      if (error) throw new Error(error.message);
      episode = data && data.length > 0 ? toSource(data[0] as PassageRow) : null;
    }

    return NextResponse.json({
      reviewer: { id: reviewer.id, name: reviewer.name },
      episode,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}

// ---------------------------------------------------------------------------
// POST — the chat itself.
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  try {
    const missing = missingConfig();
    if (missing.length > 0) return notConfigured(missing);

    const body = (await req.json().catch(() => null)) as {
      token?: string;
      mode?: string;
      messages?: unknown;
      entry_type?: string;
      entry_types?: unknown;
      show?: string;
      episode_id?: string;
    } | null;
    if (!body) return jsonError(400, "invalid_json");

    const VALID_TYPES = new Set([
      "concept", "figure", "fact", "person", "place", "story",
    ]);
    let pinnedTypes: string[] | null = Array.isArray(body.entry_types)
      ? body.entry_types.map(String).filter((t) => VALID_TYPES.has(t))
      : body.entry_type && VALID_TYPES.has(body.entry_type)
        ? [body.entry_type]
        : null;
    if (pinnedTypes && pinnedTypes.length === 0) pinnedTypes = null;
    const pinnedShow = (body.show ?? "").trim() || null;

    const mode = body.mode as ChatMode;
    if (mode !== "archive" && mode !== "entries" && mode !== "episode")
      return jsonError(400, "invalid_mode");

    const history = normalizeHistory(body.messages);
    if (!history) return jsonError(400, "invalid_messages");

    const sb = getSupabase();
    const reviewer = await getReviewerByToken(sb, body.token);
    if (!reviewer) return jsonError(401, "invalid_token");

    // ---- archive: the agentic mode --------------------------------------
    if (mode === "archive") {
      return ndjsonResponse(async (emit) => {
        emit({ type: "meta", mode });
        const collected: PassageRow[] = [];
        await runAgenticChat({
          system: archiveAgentSystemPrompt(pinnedShow),
          messages: history,
          tools: [makeSearchTool(sb, collected, pinnedShow)],
          maxToolRounds: MAX_SEARCH_ROUNDS,
          onText: (text) => emit({ type: "delta", text }),
          onToolCall: (_name, input) =>
            emit({
              type: "search",
              query: String((input as { query?: unknown }).query ?? ""),
            }),
        });
        emit({ type: "sources", sources: dedupeSources(collected) });
      });
    }

    // ---- entries: the agentic AI editor over the full pool ---------------
    if (mode === "entries") {
      return ndjsonResponse(async (emit) => {
        emit({ type: "meta", mode });
        await runAgenticChat({
          system: entriesAgentSystemPrompt(pinnedTypes, pinnedShow),
          messages: history,
          tools: makeEntryTools(sb, pinnedTypes, pinnedShow),
          maxToolRounds: MAX_SEARCH_ROUNDS,
          maxTokens: 3000,
          onText: (text) => emit({ type: "delta", text }),
          onToolCall: (name, input) =>
            emit({ type: "search", query: describeEntryToolCall(name, input) }),
        });
      });
    }

    // ---- episode: one full transcript in the system prompt ---------------
    const episodeId = (body.episode_id ?? "").trim();
    if (!episodeId) return jsonError(400, "missing_episode");
    const rows = await fetchAll<PassageRow>((from, to) =>
      sb
        .from("passages")
        .select(PASSAGE_COLS)
        .eq("episode_id", episodeId)
        .order("id")
        .range(from, to)
    );
    if (rows.length === 0) return jsonError(404, "episode_not_found");
    const episode = toSource(rows[0]);
    return ndjsonResponse(async (emit) => {
      emit({ type: "meta", mode, episode });
      emit({ type: "sources", sources: [episode] });
      await streamClaudeText({
        system: episodeSystemPrompt(rows),
        messages: history,
        maxTokens: 1500,
        onText: (text) => emit({ type: "delta", text }),
      });
    });
  } catch (err) {
    return handleRouteError(err);
  }
}

// ---------------------------------------------------------------------------
// Retrieval
// ---------------------------------------------------------------------------

/**
 * The agent's search tool. Ranked FTS via the `search_passages` SQL function
 * (websearch_to_tsquery + ts_rank, see supabase/schema.sql), falling back to
 * an unranked PostgREST fts filter if the function doesn't exist. If a
 * strict query matches nothing, an OR-relaxed keyword retry runs before
 * reporting "no matches", so the model wastes fewer rounds on near-misses.
 */
function makeSearchTool(
  sb: ReturnType<typeof getSupabase>,
  collected: PassageRow[],
  pinnedShow: string | null = null
): AgentTool {
  return {
    name: "search_archive",
    description:
      'Full-text search over 143,000 speaker-labeled passages from ~1,600 Freakonomics-network episode transcripts. Terms are ANDed; use OR between alternatives; "quoted phrases" match exactly; -word excludes. Short queries of 2-4 distinctive keywords work best. Returns the top-ranked passages with episode title, show, date, and speaker.',
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Keyword search query (2-4 distinctive words).",
        },
      },
      required: ["query"],
    },
    run: async (input) => {
      const q = String(input.query ?? "").slice(0, 200).trim();
      if (!q) return "Empty query — provide keywords.";

      let rows = await runPassageQuery(sb, q, pinnedShow);
      let note = "";
      if (rows.length === 0) {
        const relaxed = relaxedQuery(q);
        if (relaxed && relaxed !== q) {
          rows = await runPassageQuery(sb, relaxed, pinnedShow);
          if (rows.length > 0)
            note = `(No exact matches for "${q}"; showing OR-relaxed matches for: ${relaxed})\n\n`;
        }
      }
      if (rows.length === 0)
        return `No passages matched "${q}". Try fewer, simpler, or different keywords.`;

      collected.push(...rows);
      return (
        note +
        rows
          .map((p, i) => {
            const who = p.speaker && p.speaker.trim() ? p.speaker : "Narration";
            const content = (p.content ?? "").slice(0, 1200);
            return `[${i + 1}] "${p.episode_title ?? "Unknown episode"}" (${p.show ?? "Unknown show"}, ${p.date ?? "n.d."}) — ${who}:\n${content}`;
          })
          .join("\n\n")
      );
    },
  };
}

async function runPassageQuery(
  sb: ReturnType<typeof getSupabase>,
  query: string,
  show: string | null = null
): Promise<PassageRow[]> {
  // Only pass p_show when set, so the call still resolves against a
  // database that hasn't run the newer schema (2-arg function).
  const args: Record<string, unknown> = { query, match_count: SEARCH_MATCHES };
  if (show) args.p_show = show;
  const rpc = await sb.rpc("search_passages", args);
  if (!rpc.error) return (rpc.data ?? []) as PassageRow[];

  let fallback = sb
    .from("passages")
    .select(PASSAGE_COLS)
    .textSearch("fts", query, { type: "websearch", config: "english" })
    .limit(SEARCH_MATCHES);
  if (show) fallback = fallback.eq("show", show);
  const fb = await fallback;
  if (fb.error) throw new Error(fb.error.message);
  return (fb.data ?? []) as PassageRow[];
}

/** Words that ask the question rather than carry its subject. */
const QUERY_NOISE = new Set([
  "the", "a", "an", "and", "or", "but", "of", "in", "on", "at", "to", "for",
  "with", "about", "bout", "as", "by", "from", "into", "over", "under", "is",
  "are", "was", "were", "be", "been", "being", "do", "does", "did", "done",
  "have", "has", "had", "having", "will", "would", "can", "could", "should",
  "shall", "may", "might", "must", "what", "which", "who", "whom", "whose",
  "when", "where", "why", "how", "this", "that", "these", "those", "there",
  "here", "i", "we", "you", "he", "she", "it", "they", "them", "me", "my",
  "our", "your", "their", "his", "her", "its", "us", "not", "no", "yes",
  "so", "than", "too", "very", "just", "any", "some", "all", "more", "most",
  "other", "please", "tell", "give", "show", "find", "list", "know", "said",
  "say", "says", "talk", "talked", "talking", "discussed", "discuss",
  "mention", "mentioned", "fact", "facts", "things", "stuff", "anything",
  "something", "ever", "episode", "episodes", "podcast", "archive", "guest",
  "guests", "mea",
]);

function relaxedQuery(question: string): string | null {
  const words = question
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !QUERY_NOISE.has(w));
  const uniq = Array.from(new Set(words)).slice(0, 8);
  return uniq.length > 0 ? uniq.join(" or ") : null;
}

// ---------------------------------------------------------------------------
// Entry tools — the AI editor's access to the full 14,537-entry pool.
// ---------------------------------------------------------------------------

const ENTRY_COLS =
  "id,headword,entry_type,category,claim,quote,speaker,episode_title,episode_show,episode_id,episode_date,episode_url";

function formatEntry(e: EntryRow): string {
  const claim = (e.claim ?? "").slice(0, 240);
  const quote = (e.quote ?? "").slice(0, 160);
  const bits = [
    `- ${e.headword} [${e.entry_type}${e.category ? ` / ${e.category}` : ""}]`,
  ];
  if (claim) bits.push(`  claim: ${claim}`);
  if (quote) bits.push(`  quote: "${quote}"${e.speaker ? ` — ${e.speaker}` : ""}`);
  bits.push(
    `  episode: "${e.episode_title ?? "Unknown"}" (${e.episode_show ?? ""}, ${e.episode_date ?? ""})`
  );
  return bits.join("\n");
}

function makeEntryTools(
  sb: ReturnType<typeof getSupabase>,
  pinnedTypes: string[] | null,
  pinnedShow: string | null
): AgentTool[] {
  // Pinned filters win; otherwise the model may narrow by type itself.
  const effectiveTypes = (input: Record<string, unknown>): string[] | null => {
    if (pinnedTypes) return pinnedTypes;
    return input.entry_type ? [String(input.entry_type)] : null;
  };
  const searchTool: AgentTool = {
    name: "search_entries",
    description:
      'Ranked full-text search over all almanac candidate entries (headword, claim, quote, speaker, category). Terms are ANDed; use OR between alternatives; "quoted phrases" match exactly. Short, distinctive keywords work best.',
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Keyword search query." },
        entry_type: {
          type: "string",
          description:
            "Optional filter: concept | figure | fact | person | place | story.",
        },
      },
      required: ["query"],
    },
    run: async (input) => {
      const q = String(input.query ?? "").slice(0, 200).trim();
      if (!q) return "Empty query — provide keywords.";
      const types = effectiveTypes(input);

      const args: Record<string, unknown> = { query: q, match_count: ENTRY_MATCHES };
      if (types) args.p_entry_types = types;
      if (pinnedShow) args.p_show = pinnedShow;
      const rpc = await sb.rpc("search_entries", args);
      let rows: EntryRow[];
      if (!rpc.error) {
        rows = (rpc.data ?? []) as EntryRow[];
      } else {
        // Schema function not created/updated yet — degrade to substring
        // matching via PostgREST, which supports every filter directly.
        const pat = `%${q.replace(/[,()%]/g, " ").trim()}%`;
        let query = sb
          .from("entries")
          .select(ENTRY_COLS)
          .or(
            `headword.ilike.${pat},claim.ilike.${pat},quote.ilike.${pat},category.ilike.${pat}`
          )
          .limit(ENTRY_MATCHES);
        if (types) query = query.in("entry_type", types);
        if (pinnedShow) query = query.eq("episode_show", pinnedShow);
        const fb = await query;
        if (fb.error) throw new Error(fb.error.message);
        rows = (fb.data ?? []) as EntryRow[];
      }
      if (rows.length === 0)
        return `No entries matched "${q}". Try fewer or different keywords, or browse by category.`;
      return rows.map(formatEntry).join("\n");
    },
  };

  const browseTool: AgentTool = {
    name: "browse_entries",
    description:
      "Page through the entry pool with filters. Returns up to 40 entries per call plus the total count; pass offset to get the next page.",
    input_schema: {
      type: "object",
      properties: {
        entry_type: {
          type: "string",
          description:
            "Optional filter: concept | figure | fact | person | place | story.",
        },
        category: {
          type: "string",
          description:
            "Optional category substring filter (see entry_facets for the vocabulary).",
        },
        offset: { type: "integer", description: "Pagination offset (default 0)." },
      },
    },
    run: async (input) => {
      const types = effectiveTypes(input);
      const category = input.category ? String(input.category).slice(0, 80) : null;
      const offset = Math.max(0, Number(input.offset ?? 0) || 0);

      let query = sb
        .from("entries")
        .select(ENTRY_COLS, { count: "exact" })
        .order("id")
        .range(offset, offset + ENTRY_PAGE - 1);
      if (types) query = query.in("entry_type", types);
      if (category)
        query = query.ilike("category", `%${category.replace(/[,()%]/g, " ").trim()}%`);
      if (pinnedShow) query = query.eq("episode_show", pinnedShow);
      const { data, error, count } = await query;
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as EntryRow[];
      if (rows.length === 0) return "No entries match those filters.";
      return (
        `Entries ${offset + 1}–${offset + rows.length} of ${count ?? "?"} matching:\n` +
        rows.map(formatEntry).join("\n")
      );
    },
  };

  const facetsTool: AgentTool = {
    name: "entry_facets",
    description:
      "List every entry type and category in the pool with counts. A cheap first call for 'best N of X' requests — find the right slices, then search or browse them.",
    input_schema: { type: "object", properties: {} },
    run: async () => {
      const rpc = await sb.rpc("entry_facets");
      if (rpc.error)
        return (
          "Facet counts are unavailable (the entry_facets SQL function hasn't been " +
          "created yet — run the latest app/supabase/schema.sql). Use search_entries " +
          "or browse_entries instead."
        );
      const rows = (rpc.data ?? []) as {
        entry_type: string;
        category: string | null;
        n: number;
      }[];
      const lines = rows
        .slice(0, 250)
        .map((r) => `${r.entry_type} / ${r.category ?? "(uncategorized)"}: ${r.n}`);
      if (rows.length > 250) lines.push(`… and ${rows.length - 250} more facets`);
      return lines.join("\n");
    },
  };

  return [searchTool, browseTool, facetsTool];
}

/** Human-readable label for the activity line in the chat UI. */
function describeEntryToolCall(
  name: string,
  input: Record<string, unknown>
): string {
  if (name === "search_entries") return String(input.query ?? "");
  if (name === "entry_facets") return "category overview";
  const bits = [
    input.entry_type ? `type=${input.entry_type}` : null,
    input.category ? `category=${input.category}` : null,
    input.offset ? `from #${input.offset}` : null,
  ].filter(Boolean);
  return `browse ${bits.join(", ") || "all entries"}`;
}

// ---------------------------------------------------------------------------
// System prompts — grounded-only, citations required.
// ---------------------------------------------------------------------------

const HOUSE_RULES = `You are part of Fact Finder HQ, the internal tool Stephen Dubner's team uses to mine the Freakonomics Radio archive for an almanac book. Your users are the book's editors. Write conversational text with light formatting: **bold** for headwords, episode titles, and the numbers that matter; *italics* sparingly for emphasis; hyphen or numbered lists when listing. No markdown headings, tables, or links. Keep answers focused and quote short phrases verbatim when it helps.`;

function archiveAgentSystemPrompt(pinnedShow: string | null = null): string {
  return `${HOUSE_RULES}

MODE: Archive research agent. You answer questions about what has been said across ~1,600 episodes by searching the transcripts yourself with the search_archive tool.${
    pinnedShow
      ? `\n\nThe editor has pinned a show filter: every search is already restricted to "${pinnedShow}" episodes. Mention this scope if it matters to the answer.`
      : ""
  }

How to work:
- ALWAYS search before answering — your memory does not count as evidence.
- Build short keyword queries from the distinctive words of the request, fixing any obvious typos. Run several searches from different angles (synonyms, speaker names, related terms) when the first results are thin or the question has multiple parts. Follow-up questions usually need fresh searches informed by the whole conversation.
- Do not narrate what you're about to do — call the tool directly, then write the answer.
- Ground every claim ONLY in passages returned by your searches. Never use outside knowledge or memory, even about Freakonomics episodes — if it isn't in a retrieved passage, it doesn't exist for you.
- Cite as you go, inline, naming the episode title and speaker — e.g.: ("The Cobra Effect" — Stephen Dubner).
- The passages are search snippets, not full transcripts — don't assume anything beyond what they say.
- If several varied searches surface nothing relevant, say so honestly, mention what you tried, and suggest a sharper question. Never guess, never pad.`;
}

function entriesAgentSystemPrompt(
  pinnedTypes: string[] | null,
  pinnedShow: string | null
): string {
  const pinned = [
    pinnedTypes ? `entry types = ${pinnedTypes.join(" or ")}` : null,
    pinnedShow ? `show = ${pinnedShow}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return `${HOUSE_RULES}

MODE: Entries editor (agentic). You are the AI editor for the almanac's candidate pool — roughly 14,500 entries mined from the transcripts. You explore the pool yourself with tools:
- entry_facets: every entry type and category with counts — a great first call for "best N of X" requests.
- search_entries: ranked full-text search over headwords, claims, quotes, speakers, and categories.
- browse_entries: page through the pool filtered by type / category.

How to work:
- Gather real candidates with the tools before answering; several calls from different angles are encouraged. For "give me your best N X" requests, check entry_facets first to find the right slices, then search/browse them.
- Work ONLY with entries the tools returned. Never invent an entry, claim, quote, or episode. Never use outside knowledge.
- Refer to entries by their headword and cite the episode title in parentheses after each pick — e.g.: Cobra effect ("The Cobra Effect").
- When asked for "the best N", pick and rank with a one-line reason each; if you can't find N strong candidates, deliver fewer and say why.
- Do not narrate tool use — call the tools, then write the answer.
- If the pool genuinely lacks what was asked for, say so plainly after looking.${
    pinned
      ? `\n- The editor has pinned filters for this chat (${pinned}); every tool call is already restricted to them.`
      : ""
  }`;
}

function episodeSystemPrompt(rows: PassageRow[]): string {
  const first = rows[0];
  let transcript = rows
    .map((p) =>
      p.speaker && p.speaker.trim()
        ? `${p.speaker}: ${p.content ?? ""}`
        : (p.content ?? "")
    )
    .join("\n\n");
  let truncated = false;
  if (transcript.length > MAX_TRANSCRIPT_CHARS) {
    transcript = transcript.slice(0, MAX_TRANSCRIPT_CHARS);
    truncated = true;
  }

  return `${HOUSE_RULES}

MODE: Single episode. The user is chatting about one episode; its transcript (as ordered speaker passages) is below${truncated ? " — truncated at the context cap, so the very end may be missing" : ""}.

Episode: "${first.episode_title ?? "Unknown episode"}" (${first.show ?? "Unknown show"}, ${first.date ?? "n.d."})

Strict grounding rules:
- Answer ONLY from this transcript. Never use outside knowledge or memory about the topic, the guests, or other episodes.
- Attribute quotes and claims to the speaker by name.
- If something isn't covered in the transcript, say the episode doesn't address it. Do not guess.

TRANSCRIPT:
${transcript}`;
}
