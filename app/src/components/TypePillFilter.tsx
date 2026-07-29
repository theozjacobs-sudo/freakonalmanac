"use client";

import { ENTRY_TYPES } from "@/lib/filters";

/**
 * Multi-select entry-type filter as a row of toggle pills. Empty selection
 * means "all types" everywhere it's used.
 */
export default function TypePillFilter({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const toggle = (t: string) =>
    onChange(
      selected.includes(t) ? selected.filter((x) => x !== t) : [...selected, t]
    );

  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by entry type">
      {ENTRY_TYPES.map((t) => {
        const on = selected.includes(t);
        return (
          <button
            key={t}
            type="button"
            onClick={() => toggle(t)}
            aria-pressed={on}
            className={`rounded-full border px-2.5 py-1 font-mono text-[0.7rem] lowercase tracking-wide transition-colors ${
              on
                ? "border-accent bg-accent font-semibold text-[var(--seg-on-fg)]"
                : "border-hair bg-surface text-muted hover:border-accent hover:text-ink"
            }`}
          >
            {t}
          </button>
        );
      })}
    </div>
  );
}
