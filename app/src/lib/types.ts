export type EntryType =
  | "concept"
  | "figure"
  | "fact"
  | "person"
  | "place"
  | "story";

export type Freshness = "current" | "aging" | "check" | "evergreen" | "durable";

export type Decision = "keep" | "reject";

export interface Entry {
  id: string;
  headword: string;
  entry_type: EntryType;
  category: string | null;
  claim: string | null;
  quote: string | null;
  speaker: string | null;
  episode_title: string | null;
  episode_show: string | null;
  episode_id: string | null;
  episode_date: string | null;
  episode_url: string | null;
  age_years: number | null;
  freshness: Freshness | null;
  freshness_note: string | null;
  verified_quote_in_transcript: boolean;
}

export interface BrowseEntry extends Entry {
  my_decision: Decision | null;
}

export interface QueueResponse {
  reviewer: { id: number; name: string };
  assignment_mode: "all" | "split";
  total: number;
  done: number;
  entries: Entry[];
}

export interface ReviewerStats {
  id: number;
  name: string;
  total: number;
  done: number;
  keeps: number;
  rejects: number;
  keep_rate: number; // 0..1 of decided
}

export type OverlapVerdict = "kept_by_all" | "kept_by_some" | "rejected_by_all";

export interface OverlapCounts {
  compared: number; // entries with >= 2 round-1 decisions
  kept_by_all: number;
  kept_by_some: number;
  rejected_by_all: number;
}

export type ChatMode = "archive" | "entries" | "episode";

/** One episode referenced by a chat answer (or the episode being discussed). */
export interface ChatSource {
  episode_id: string | null;
  episode_title: string | null;
  show: string | null;
  date: string | null;
  url: string | null;
}

/**
 * The /api/chat POST response body is NDJSON: one ChatEvent per line.
 *  - meta:    first line — mode + (episode mode) the episode being discussed
 *  - search:  the agent ran an archive search with this query
 *  - delta:   a chunk of the streamed answer text
 *  - sources: episodes the answer drew on (sent when known — end of stream
 *             for archive mode, up front for episode mode)
 *  - error:   something failed mid-stream
 */
export type ChatEvent =
  | { type: "meta"; mode: ChatMode; episode?: ChatSource; candidate_count?: number }
  | { type: "search"; query: string }
  | { type: "delta"; text: string }
  | { type: "sources"; sources: ChatSource[] }
  | { type: "error"; message: string };

export interface StatsResponse {
  total_entries: number;
  reviewers: ReviewerStats[];
  overlap: {
    overall: OverlapCounts;
    by_type: Record<string, OverlapCounts>;
    kept_by_all_entries: {
      id: string;
      headword: string;
      entry_type: EntryType;
    }[];
  };
}
