#!/usr/bin/env python3
"""Surface likely fact/figure sentences from an episode to pre-filter extraction.

Splits the transcript into sentences, keeps those bearing numbers, %, $, or
quantifier words, and tags each with the nearest preceding speaker label.

Usage:  python3 scripts/fact_candidates.py <episode.json> [--all]
"""
import json, re, sys
from pathlib import Path

NUM = re.compile(r"\b\d|\bpercent\b|\bmillion\b|\bbillion\b|\btrillion\b|\$|%|"
                 r"\btimes more\b|\bhalf\b|\bthird\b|\bquarter\b|\bdouble\b|\bper cent\b", re.I)
SPEAKER = re.compile(r"^([A-Z][A-Za-z.'\- ]{1,40}?):\s")

def sentences(text):
    speaker = ""
    for para in re.split(r"\n\s*\n", text):
        para = para.strip()
        m = SPEAKER.match(para)
        if m:
            speaker = m.group(1).strip()
            para = para[m.end():]
        # naive sentence split
        for s in re.split(r"(?<=[.!?])\s+(?=[A-Z0-9“\"'])", para):
            s = s.strip()
            if s:
                yield speaker, s

def main():
    path = Path(sys.argv[1])
    show_all = "--all" in sys.argv
    r = json.load(open(path, encoding="utf-8"))
    print(f'### {r["title"]}  ({r["show"]}, {r["date"][:10]})\n')
    for speaker, s in sentences(r["transcript"]):
        if show_all or NUM.search(s):
            who = f"[{speaker}] " if speaker else "[narration] "
            print(f"{who}{s}")

if __name__ == "__main__":
    main()
