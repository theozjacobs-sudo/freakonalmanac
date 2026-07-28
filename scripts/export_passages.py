#!/usr/bin/env python3
"""Export speaker-labeled transcript passages to data/passages.jsonl.

Splits every episode's transcript into passages using the same
speaker/paragraph logic as scripts/build_index.py, and writes one JSON
object per line ready for app/scripts/seed-passages.mjs to load into the
Supabase `passages` table:

  {episode_id, speaker, content, episode_title, show, date, url}

Regenerable (data/passages.jsonl is git-ignored). Pure standard library.

Run:  python3 scripts/parse_wxr.py && python3 scripts/export_passages.py
"""
import glob
import json
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "passages.jsonl"

# Same passage/speaker splitting as scripts/build_index.py — keep in sync.
SPEAKER_RE = re.compile(r"^([A-Z][A-Za-z.'\- ]{1,40}?):\s")
MIN_CHARS = 40


def passages(transcript):
    """Yield (speaker, text) per paragraph; speaker '' for narration."""
    for para in re.split(r"\n\s*\n", transcript):
        para = para.strip()
        if len(para) < MIN_CHARS:  # skip section breaks / tiny fragments
            continue
        m = SPEAKER_RE.match(para)
        if m:
            speaker = m.group(1).strip()
            para = para[m.end():].strip()  # strip "SPEAKER: " prefix
        else:
            speaker = ""
        if len(para) < 20:
            continue
        yield speaker, para


def main():
    files = sorted(glob.glob(str(ROOT / "data/episodes/**/*.json"), recursive=True))
    if not files:
        raise SystemExit(
            "No episode JSON found under data/episodes/ — run "
            "`python3 scripts/parse_wxr.py` first."
        )

    n_passages = 0
    per_show = Counter()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        for f in files:
            r = json.load(open(f, encoding="utf-8"))
            for speaker, text in passages(r["transcript"]):
                row = {
                    "episode_id": r["id"],
                    "speaker": speaker,
                    "content": text,
                    "episode_title": r["title"],
                    "show": r["show"],
                    "date": r["date"][:10],
                    "url": r["url"],
                }
                fh.write(json.dumps(row, ensure_ascii=False) + "\n")
                n_passages += 1
                per_show[r["show"]] += 1

    size_mb = OUT.stat().st_size / 1_000_000
    print(f"Wrote {n_passages:,} passages from {len(files):,} episodes "
          f"-> {OUT.relative_to(ROOT)} ({size_mb:.1f} MB)")
    for show, n in per_show.most_common():
        print(f"  {show:35} {n:,}")


if __name__ == "__main__":
    main()
