import { NextRequest, NextResponse } from "next/server";
import {
  fetchAll,
  getReviewerByToken,
  getSupabase,
  isConfigured,
} from "@/lib/supabase";
import {
  ChatTurn,
  fixedTextStream,
  isAnthropicConfigured,
  streamClaudeText,
} from "@/lib/claude";
import { handleRouteError, jsonError } from "@/lib/api";
import type { ChatMeta, ChatMode, ChatSource } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The grounded chat endpoint, three modes:
 *
 *  - archive:  question -> Postgres FTS over `passages` -> Claude answers
 *              from those passages only, with inline citations.
 *  - entries:  question (+ optional entry_type / show filters) -> a capped,
 *              category-diverse sample of `entries` -> Claude curates/ranks.
 *  - episode:  every passage of one episode, in order -> chat about it.
 *
 * POST body: { token, mode, messages: [{role, content}...],
 *              entry_type?, show?, episode_id? }
 * Response: one JSON line (ChatMeta) + "\n" + streamed answer text.
 *
 * GET is a tiny helper for the /chat page: token + config check, and
 * episode metadata lookup (?episode=<id>).
 */

const MAX_HISTORY_MESSAGES = 16; // ~8 turns
const ARCHIVE_MATCHES = 12;
const ENTRY_SAMPLE = 200;
const ENTRY_FETCH = 1000;
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
      show?: string;
      episode_id?: string;
    } | null;
    if (!body) return jsonError(400, "invalid_json");

    const mode = body.mode as ChatMode;
    if (mode !== "archive" && mode !== "entries" && mode !== "episode")
      return jsonError(400, "invalid_mode");

    const history = normalizeHistory(body.messages);
    if (!history) return jsonError(400, "invalid_messages");
    const question = history[history.length - 1].content;

    const sb = getSupabase();
    const reviewer = await getReviewerByToken(sb, body.token);
    if (!reviewer) return jsonError(401, "invalid_token");

    let system: string;
    const meta: ChatMeta = { mode, sources: [] };
    let emptyRetrievalMessage: string | null = null;

    if (mode === "archive") {
      const rows = await searchPassages(sb, question);
      meta.sources = dedupeSources(rows);
      if (rows.length === 0) {
        emptyRetrievalMessage =
          "The archive search didn’t surface any transcript passages for that question, so I can’t answer it from the archive. Try rephrasing with different keywords (speaker names, topics, or memorable phrases often work well).";
        system = "";
      } else {
        system = archiveSystemPrompt(rows);
      }
    } else if (mode === "entries") {
      const { sample, total } = await sampleEntries(
        sb,
        body.entry_type,
        body.show
      );
      meta.candidate_count = sample.length;
      if (sample.length === 0) {
        emptyRetrievalMessage =
          "No almanac entries match those filters, so there’s nothing for me to curate from. Try loosening the type or show filter.";
        system = "";
      } else {
        system = entriesSystemPrompt(sample, total, body.entry_type, body.show);
      }
    } else {
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
      meta.episode = toSource(rows[0]);
      meta.sources = [meta.episode];
      system = episodeSystemPrompt(rows);
    }

    const answer = emptyRetrievalMessage
      ? fixedTextStream(emptyRetrievalMessage)
      : streamClaudeText({ system, messages: history, maxTokens: 1500 });

    // Body = one JSON meta line, then the streamed answer text.
    const encoder = new TextEncoder();
    const metaBytes = encoder.encode(JSON.stringify(meta) + "\n");
    const reader = answer.getReader();
    const bodyStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(metaBytes);
      },
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) controller.close();
        else controller.enqueue(value);
      },
      cancel(reason) {
        void reader.cancel(reason);
      },
    });

    return new Response(bodyStream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    return handleRouteError(err);
  }
}

// ---------------------------------------------------------------------------
// Retrieval
// ---------------------------------------------------------------------------

/**
 * Ranked FTS via the `search_passages` SQL function (websearch_to_tsquery +
 * ts_rank, see supabase/schema.sql). Falls back to an unranked PostgREST
 * `fts=wfts(...)` filter if the function hasn't been created yet.
 */
async function searchPassages(
  sb: ReturnType<typeof getSupabase>,
  question: string
): Promise<PassageRow[]> {
  const rpc = await sb.rpc("search_passages", {
    query: question,
    match_count: ARCHIVE_MATCHES,
  });
  if (!rpc.error) return (rpc.data ?? []) as PassageRow[];

  const fallback = await sb
    .from("passages")
    .select(PASSAGE_COLS)
    .textSearch("fts", question, { type: "websearch", config: "english" })
    .limit(ARCHIVE_MATCHES);
  if (fallback.error) throw new Error(fallback.error.message);
  return (fallback.data ?? []) as PassageRow[];
}

/**
 * Up to ENTRY_SAMPLE entries matching the filters, spread round-robin across
 * categories so one giant category can't crowd out the rest.
 */
async function sampleEntries(
  sb: ReturnType<typeof getSupabase>,
  entryType?: string,
  show?: string
): Promise<{ sample: EntryRow[]; total: number }> {
  let query = sb
    .from("entries")
    .select(
      "id,headword,entry_type,category,claim,quote,speaker,episode_title,episode_show,episode_id,episode_date,episode_url",
      { count: "exact" }
    )
    .order("id")
    .limit(ENTRY_FETCH);
  if (entryType) query = query.eq("entry_type", entryType);
  if (show) query = query.eq("episode_show", show);
  const { data, error, count } = await query;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as EntryRow[];

  if (rows.length <= ENTRY_SAMPLE)
    return { sample: rows, total: count ?? rows.length };

  const byCategory = new Map<string, EntryRow[]>();
  for (const row of rows) {
    const key = row.category ?? "(uncategorized)";
    const bucket = byCategory.get(key);
    if (bucket) bucket.push(row);
    else byCategory.set(key, [row]);
  }
  const buckets = Array.from(byCategory.values());
  const sample: EntryRow[] = [];
  for (let i = 0; sample.length < ENTRY_SAMPLE; i++) {
    let added = false;
    for (const bucket of buckets) {
      if (i < bucket.length && sample.length < ENTRY_SAMPLE) {
        sample.push(bucket[i]);
        added = true;
      }
    }
    if (!added) break;
  }
  return { sample, total: count ?? rows.length };
}

// ---------------------------------------------------------------------------
// System prompts — grounded-only, citations required.
// ---------------------------------------------------------------------------

const HOUSE_RULES = `You are part of Fact Finder HQ, the internal tool Stephen Dubner's team uses to mine the Freakonomics Radio archive for an almanac book. Your users are the book's editors. Write plain conversational text — no markdown headings or tables; short hyphen lists are fine. Keep answers focused and quote short phrases verbatim when it helps.`;

function archiveSystemPrompt(rows: PassageRow[]): string {
  const passages = rows
    .map((p, i) => {
      const who = p.speaker && p.speaker.trim() ? p.speaker : "Narration";
      return `[${i + 1}] "${p.episode_title ?? "Unknown episode"}" (${p.show ?? "Unknown show"}, ${p.date ?? "n.d."}) — ${who}:\n${p.content ?? ""}`;
    })
    .join("\n\n");

  return `${HOUSE_RULES}

MODE: Archive search. The user's question was run through full-text search over ~1,600 episode transcripts; the numbered passages below are the ONLY evidence you have.

Strict grounding rules:
- Answer ONLY from the passages below. Never use outside knowledge or memory, even about Freakonomics episodes — if it isn't in a passage, it doesn't exist for you.
- Cite as you go, inline, naming the episode title and speaker — e.g.: ("The Cobra Effect" — Stephen Dubner).
- If the passages don't genuinely answer the question, say the archive search didn't surface anything relevant and suggest a rephrased search. Do not guess, do not pad.
- The passages are search snippets, not full transcripts — don't assume anything beyond what they say.

TRANSCRIPT PASSAGES:
${passages}`;
}

function entriesSystemPrompt(
  sample: EntryRow[],
  total: number,
  entryType?: string,
  show?: string
): string {
  const lines = sample
    .map((e) => {
      const bits = [
        `- ${e.headword} [${e.entry_type}${e.category ? ` / ${e.category}` : ""}]`,
      ];
      if (e.claim) bits.push(`  claim: ${e.claim}`);
      if (e.quote)
        bits.push(
          `  quote: "${e.quote.length > 220 ? e.quote.slice(0, 220) + "…" : e.quote}"${e.speaker ? ` — ${e.speaker}` : ""}`
        );
      bits.push(
        `  episode: "${e.episode_title ?? "Unknown"}" (${e.episode_show ?? ""}, ${e.episode_date ?? ""})`
      );
      return bits.join("\n");
    })
    .join("\n");

  const filterNote = [
    entryType ? `entry_type=${entryType}` : null,
    show ? `show=${show}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return `${HOUSE_RULES}

MODE: Entries editor. You curate, rank, and select from the almanac candidate entries listed below — a sample of ${sample.length} entries${
    total > sample.length ? ` (of ${total} matching the filters, capped for context; the sample is spread across categories)` : ""
  }${filterNote ? ` with filters ${filterNote}` : ""}.

Strict grounding rules:
- Work ONLY with the entries listed below. Never invent an entry, claim, quote, or episode.
- Refer to entries by their headword and cite the episode title in parentheses after each pick — e.g.: Cobra effect ("The Cobra Effect").
- When asked for "the best N", pick and rank from the list with a one-line reason each; if the list has fewer strong matches than requested, deliver fewer and say why.
- If asked for something the sample can't support, say so plainly (mention it's a capped sample if relevant).

CANDIDATE ENTRIES:
${lines}`;
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
