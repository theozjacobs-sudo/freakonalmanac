import { ReactNode } from "react";

/**
 * Tiny markdown renderer for chat bubbles: **bold**, *italic*, `code`,
 * hyphen/numbered lists, and paragraphs. Deliberately no headings, tables,
 * links, or raw HTML — and no dangerouslySetInnerHTML. Tolerant of
 * half-streamed text (unclosed markers render literally until closed).
 */

type Block =
  | { kind: "p"; text: string }
  | { kind: "ul" | "ol"; items: string[] };

function splitBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { kind: "ul" | "ol"; items: string[] } | null = null;

  const flushPara = () => {
    const t = para.join("\n").trim();
    if (t) blocks.push({ kind: "p", text: t });
    para = [];
  };
  const flushList = () => {
    if (list && list.items.length > 0) blocks.push(list);
    list = null;
  };

  for (const line of text.split("\n")) {
    const ul = /^\s*[-•*]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (ul || ol) {
      flushPara();
      const kind = ul ? "ul" : "ol";
      if (!list || list.kind !== kind) {
        flushList();
        list = { kind, items: [] };
      }
      list.items.push((ul ?? ol)![1]);
    } else if (line.trim() === "") {
      flushPara();
      flushList();
    } else if (list) {
      // Continuation of the previous list item (wrapped line).
      list.items[list.items.length - 1] += " " + line.trim();
    } else {
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return blocks;
}

function inline(s: string): ReactNode[] {
  const parts = s.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**") && p.length > 4)
      return <strong key={i}>{p.slice(2, -2)}</strong>;
    if (p.startsWith("`") && p.endsWith("`") && p.length > 2)
      return (
        <code key={i} className="rounded bg-black/10 px-1 font-mono text-[0.85em]">
          {p.slice(1, -1)}
        </code>
      );
    if (p.startsWith("*") && p.endsWith("*") && p.length > 2)
      return <em key={i}>{p.slice(1, -1)}</em>;
    return p;
  });
}

export default function MarkdownLite({ text }: { text: string }) {
  const blocks = splitBlocks(text);
  return (
    <>
      {blocks.map((b, i) =>
        b.kind === "p" ? (
          <p key={i} className={`whitespace-pre-wrap ${i === 0 ? "mt-0" : "mt-2"} mb-0`}>
            {inline(b.text)}
          </p>
        ) : b.kind === "ul" ? (
          <ul key={i} className={`${i === 0 ? "mt-0" : "mt-2"} mb-0 list-disc space-y-1 pl-5`}>
            {b.items.map((it, j) => (
              <li key={j}>{inline(it)}</li>
            ))}
          </ul>
        ) : (
          <ol key={i} className={`${i === 0 ? "mt-0" : "mt-2"} mb-0 list-decimal space-y-1 pl-5`}>
            {b.items.map((it, j) => (
              <li key={j}>{inline(it)}</li>
            ))}
          </ol>
        )
      )}
    </>
  );
}
