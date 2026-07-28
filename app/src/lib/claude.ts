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
 * Stream a plain (tool-less) Claude answer, delivering text chunks to a
 * callback. Used by chat modes whose grounding context fits in the system
 * prompt (entries, episode).
 */
export async function streamClaudeText(opts: {
  system: string;
  messages: ChatTurn[];
  maxTokens?: number;
  onText: (text: string) => void;
}): Promise<void> {
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
  stream.on("text", (t) => opts.onText(t));
  await stream.finalMessage();
}

// ---------------------------------------------------------------------------
// Agentic loop: Claude drives tools itself, streaming the final answer.
// ---------------------------------------------------------------------------

export interface AgentTool {
  name: string;
  description: string;
  input_schema: Anthropic.Tool.InputSchema;
  /** Execute the tool; the returned string becomes the tool_result. */
  run: (input: Record<string, unknown>) => Promise<string>;
}

/**
 * Run a tool-use conversation loop: Claude may call the given tools as many
 * times as it likes (up to maxToolRounds round-trips), then answers. Text is
 * streamed to onText as it's generated; each tool call is announced through
 * onToolCall before it executes. After maxToolRounds, tool use is switched
 * off so the model must answer with what it has.
 */
export async function runAgenticChat(opts: {
  system: string;
  messages: ChatTurn[];
  tools: AgentTool[];
  maxToolRounds?: number;
  maxTokens?: number;
  onText: (text: string) => void;
  onToolCall?: (name: string, input: Record<string, unknown>) => void;
}): Promise<void> {
  const client = getAnthropic();
  const maxToolRounds = opts.maxToolRounds ?? 6;
  const apiTools: Anthropic.Tool[] = opts.tools.map(
    ({ name, description, input_schema }) => ({ name, description, input_schema })
  );
  const convo: Anthropic.MessageParam[] = opts.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));
  let emittedText = false;

  for (let round = 0; ; round++) {
    let textThisRound = false;
    const stream = client.messages.stream({
      model: CLAUDE_MODEL,
      max_tokens: opts.maxTokens ?? 2000,
      output_config: { effort: "low" },
      system: opts.system,
      messages: convo,
      tools: apiTools,
      tool_choice: round >= maxToolRounds ? { type: "none" } : { type: "auto" },
    });
    stream.on("text", (t) => {
      // Rare preamble text in a tool round still reaches the user; keep a
      // blank line between text from different rounds.
      if (!textThisRound && emittedText) opts.onText("\n\n");
      textThisRound = true;
      emittedText = true;
      opts.onText(t);
    });

    const final = await stream.finalMessage();
    const toolUses = final.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );
    if (final.stop_reason !== "tool_use" || toolUses.length === 0) return;

    // Thinking blocks must be preserved verbatim for the follow-up request.
    convo.push({
      role: "assistant",
      content: final.content as Anthropic.MessageParam["content"],
    });

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      const input = (tu.input ?? {}) as Record<string, unknown>;
      opts.onToolCall?.(tu.name, input);
      const tool = opts.tools.find((t) => t.name === tu.name);
      let out: string;
      try {
        out = tool ? await tool.run(input) : `Unknown tool: ${tu.name}`;
      } catch (err) {
        out = `Tool error: ${err instanceof Error ? err.message : String(err)}`;
      }
      results.push({ type: "tool_result", tool_use_id: tu.id, content: out });
    }
    convo.push({ role: "user", content: results });
  }
}
