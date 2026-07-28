import Anthropic from "@anthropic-ai/sdk";

/**
 * Server-side Anthropic access only — same rules as lib/supabase.ts: the API
 * key must never reach the client, and the client is created lazily inside
 * request handlers so `next build` succeeds with no env vars set.
 */

export const CLAUDE_MODEL = "claude-opus-5";

export class AnthropicConfigError extends Error {
  constructor() {
    super("Anthropic is not configured (ANTHROPIC_API_KEY)");
    this.name = "AnthropicConfigError";
  }
}

export function isAnthropicConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

let cached: Anthropic | null = null;

function getAnthropic(): Anthropic {
  if (!isAnthropicConfigured()) throw new AnthropicConfigError();
  if (!cached) cached = new Anthropic();
  return cached;
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

/**
 * The core ask-Claude helper: stream a grounded answer as a web
 * ReadableStream of UTF-8 text bytes. `system` carries the per-mode
 * grounding rules plus the retrieved context; `messages` is the (capped)
 * conversation history ending with the user's question.
 */
export function streamClaudeText(opts: {
  system: string;
  messages: ChatTurn[];
  maxTokens?: number;
}): ReadableStream<Uint8Array> {
  const client = getAnthropic();
  const stream = client.messages.stream({
    model: CLAUDE_MODEL,
    max_tokens: opts.maxTokens ?? 1500,
    // Thinking is on by default on claude-opus-5 and counts against
    // max_tokens; low effort keeps the budget for the visible answer.
    output_config: { effort: "low" },
    system: opts.system,
    messages: opts.messages.map((m) => ({ role: m.role, content: m.content })),
  });

  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      stream.on("text", (text) => controller.enqueue(encoder.encode(text)));
      stream.on("end", () => controller.close());
      stream.on("error", (err) => controller.error(err));
    },
    cancel() {
      stream.abort();
    },
  });
}

/** A constant "answer" streamed without calling Claude (e.g. empty retrieval). */
export function fixedTextStream(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}
