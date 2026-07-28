import type { Entry } from "@/lib/types";
import {
  ConfigError,
  fetchAll,
  getSupabase,
  isConfigured,
} from "@/lib/supabase";
import SetupNotice from "@/components/SetupNotice";
import { FreshnessPill, TypePill } from "@/components/pills";

export const metadata = { title: "Fact of the Day — Fact Finder HQ" };
export const dynamic = "force-dynamic";

/**
 * Deterministic, UTC-date-seeded pick: everyone who visits today sees the
 * same fact. Pool = entries kept by >= 1 reviewer in round 1; before any
 * reviewing has happened, all entries.
 */

function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

async function pickToday(): Promise<{ entry: Entry | null; fromKept: boolean }> {
  const sb = getSupabase();

  const keptIds = Array.from(
    new Set(
      (
        await fetchAll<{ entry_id: string }>((from, to) =>
          sb
            .from("decisions")
            .select("entry_id")
            .eq("round", 1)
            .eq("decision", "keep")
            .order("id")
            .range(from, to)
        )
      ).map((r) => r.entry_id)
    )
  ).sort();

  let pool = keptIds;
  let fromKept = true;
  if (pool.length === 0) {
    fromKept = false;
    pool = (
      await fetchAll<{ id: string }>((from, to) =>
        sb.from("entries").select("id").order("id").range(from, to)
      )
    ).map((r) => r.id);
  }
  if (pool.length === 0) return { entry: null, fromKept: false };

  const utcDate = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  const id = pool[hashSeed(`fact-of-the-day:${utcDate}`) % pool.length];

  const { data, error } = await sb.from("entries").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return { entry: (data as Entry) ?? null, fromKept };
}

export default async function TodayPage() {
  if (!isConfigured()) return <SetupNotice />;

  let entry: Entry | null = null;
  let fromKept = false;
  try {
    ({ entry, fromKept } = await pickToday());
  } catch (err) {
    if (err instanceof ConfigError) return <SetupNotice />;
    return (
      <p className="my-24 text-center text-sm text-muted">
        Couldn&rsquo;t reach the almanac — try reloading.
      </p>
    );
  }

  const dateLabel = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });

  if (!entry) {
    return (
      <div className="mx-auto my-24 max-w-lg text-center">
        <p className="eyebrow">Fact of the Day</p>
        <p className="mt-3 text-muted">
          The almanac is empty — seed the entries and come back tomorrow.
        </p>
      </div>
    );
  }

  return (
    <article className="mx-auto max-w-3xl py-10 sm:py-16">
      <header className="text-center">
        <p className="eyebrow">Fact of the Day</p>
        <p className="mt-1 font-mono text-xs tabular-nums text-faint">{dateLabel}</p>
      </header>

      <div className="mt-8 text-center sm:mt-12">
        <div className="flex items-center justify-center gap-3">
          <TypePill type={entry.entry_type} />
          {entry.category && (
            <span className="text-xs uppercase tracking-[0.08em] text-faint">
              {entry.category}
            </span>
          )}
        </div>
        <h1 className="mt-4 font-serif text-5xl font-bold leading-[1.02] tracking-tight text-ink sm:text-7xl">
          {entry.headword}
        </h1>
        {entry.claim && (
          <p className="mx-auto mt-6 max-w-[46ch] text-xl leading-relaxed text-ink sm:text-2xl">
            {entry.claim}
          </p>
        )}
      </div>

      {entry.quote && (
        <figure className="mx-auto mt-10 max-w-2xl">
          <blockquote className="m-0 border-l-[3px] border-accent pl-5 font-serif text-lg italic leading-relaxed text-muted sm:text-xl">
            &ldquo;{entry.quote}&rdquo;
          </blockquote>
          {entry.speaker && (
            <figcaption className="mt-3 pl-5 font-mono text-sm text-faint">
              — {entry.speaker}
            </figcaption>
          )}
        </figure>
      )}

      <footer className="mt-12 border-t border-hair-2 pt-6 text-center">
        <p className="text-sm text-muted">
          {entry.episode_show && <span>{entry.episode_show} &middot; </span>}
          {entry.episode_url ? (
            <a
              href={entry.episode_url}
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-ink no-underline hover:text-accent"
            >
              {entry.episode_title ?? "Episode"}
              <span className="ml-1 text-accent opacity-60">↗</span>
            </a>
          ) : (
            <span className="font-semibold text-ink">{entry.episode_title}</span>
          )}
          {entry.episode_date && (
            <span className="ml-2 font-mono text-xs tabular-nums text-faint">
              {entry.episode_date}
            </span>
          )}
        </p>
        <div className="mt-3 flex items-center justify-center gap-3">
          <FreshnessPill freshness={entry.freshness} title={entry.freshness_note} />
          {!fromKept && (
            <span className="font-mono text-[0.68rem] uppercase tracking-[0.1em] text-faint">
              from the full pool — nothing kept yet
            </span>
          )}
        </div>
      </footer>
    </article>
  );
}
