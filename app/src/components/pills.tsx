import type { Decision, EntryType, Freshness } from "@/lib/types";

export function TypePill({ type }: { type: EntryType }) {
  return <span className={`tag tag--${type}`}>{type}</span>;
}

export function FreshnessPill({
  freshness,
  title,
}: {
  freshness: Freshness | null;
  title?: string | null;
}) {
  if (!freshness) return null;
  return (
    <span className={`pill pill--${freshness}`} title={title ?? undefined}>
      {freshness}
    </span>
  );
}

export function DecisionChip({ decision }: { decision: Decision | null }) {
  const cls =
    decision === "keep"
      ? "chip-keep"
      : decision === "reject"
        ? "chip-reject"
        : "chip-none";
  return (
    <span
      className={`${cls} inline-block rounded-md px-2 py-0.5 font-mono text-[0.63rem] font-semibold uppercase tracking-[0.12em]`}
    >
      {decision ?? "—"}
    </span>
  );
}
