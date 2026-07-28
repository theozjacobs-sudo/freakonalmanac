"use client";

import type { Entry } from "@/lib/types";
import { FreshnessPill, TypePill } from "./pills";

/**
 * The canonical rendering of a single almanac entry — used by the swipe deck
 * and the browse card grid. Deliberately shows nothing about decisions.
 */
export default function EntryCardBody({
  entry,
  large,
}: {
  entry: Entry;
  large?: boolean;
}) {
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <h2
          className={`font-serif font-bold leading-tight tracking-tight text-ink ${
            large ? "text-[1.7rem] sm:text-4xl" : "text-2xl"
          }`}
        >
          {entry.headword}
        </h2>
        <TypePill type={entry.entry_type} />
      </div>

      {entry.category && (
        <p className="-mt-2 text-xs uppercase tracking-[0.06em] text-faint">
          {entry.category}
        </p>
      )}

      {entry.claim && (
        <p className={`text-ink ${large ? "text-[1.05rem] sm:text-lg" : "text-[0.95rem]"}`}>
          {entry.claim}
        </p>
      )}

      {entry.quote && (
        <blockquote className="m-0 rounded-r-lg border-l-[2.5px] border-accent bg-surface-2 px-3.5 py-2.5 text-sm text-muted">
          &ldquo;{entry.quote}&rdquo;
          {entry.speaker && (
            <cite className="mt-1.5 block font-mono text-xs not-italic text-faint">
              — {entry.speaker}
            </cite>
          )}
        </blockquote>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-hair-2 pt-3">
        <p className="w-full text-sm text-muted">
          {entry.episode_show && <span>{entry.episode_show} &middot; </span>}
          {entry.episode_url ? (
            <a
              href={entry.episode_url}
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-ink no-underline hover:text-accent"
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            >
              {entry.episode_title ?? "Episode"}
              <span className="ml-1 text-accent opacity-60">↗</span>
            </a>
          ) : (
            <span className="font-semibold text-ink">{entry.episode_title}</span>
          )}
        </p>
        {entry.episode_date && (
          <span className="font-mono text-xs tabular-nums text-faint">
            {entry.episode_date}
          </span>
        )}
        <FreshnessPill freshness={entry.freshness} title={entry.freshness_note} />
        {entry.verified_quote_in_transcript && (
          <span className="ml-auto font-mono text-[0.72rem] text-good" title="Quote verified in transcript">
            ✓ verified
          </span>
        )}
      </div>
    </div>
  );
}
