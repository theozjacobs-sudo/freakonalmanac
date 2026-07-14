#!/usr/bin/env python3
"""Build a BM25 search index over speaker-labeled passages from every episode.

Splits each transcript into passages (paragraph / speaker turn), tokenizes, and
writes an inverted index + passage metadata to data/search_index.pkl (git-ignored,
regenerable). Pure standard library — no external dependencies.

Run:  python3 scripts/build_index.py
"""
import json, re, glob, pickle, math
from pathlib import Path
from collections import defaultdict, Counter

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "search_index.pkl"

STOP = set("""a an the and or but if then else of to in on at by for with about as is are was
were be been being this that these those it its from into over under again further i you he
she they we them his her their our your my me us do does did doing have has had having not no
so than too very can will just up out down off only own same s t d ll m re ve o""".split())

TOKEN_RE = re.compile(r"[a-z0-9]+")
SPEAKER_RE = re.compile(r"^([A-Z][A-Za-z.'\- ]{1,40}?):\s")

def tokenize(text):
    return [w for w in TOKEN_RE.findall(text.lower()) if len(w) > 1 and w not in STOP]

def passages(transcript):
    """Yield (speaker, text) per paragraph; speaker '' for narration."""
    for para in re.split(r"\n\s*\n", transcript):
        para = para.strip()
        if len(para) < 40:      # skip section breaks / tiny fragments
            continue
        m = SPEAKER_RE.match(para)
        if m:
            speaker = m.group(1).strip()
            para = para[m.end():].strip()   # strip "SPEAKER: " prefix from stored text
        else:
            speaker = ""
        if len(para) < 20:
            continue
        yield speaker, para

def main():
    docs = []            # list of passage metadata + tokens
    postings = defaultdict(list)  # token -> list of (doc_idx, tf)
    df = Counter()
    doc_len = []

    files = sorted(glob.glob(str(ROOT / "data/episodes/**/*.json"), recursive=True))
    for f in files:
        r = json.load(open(f, encoding="utf-8"))
        for speaker, text in passages(r["transcript"]):
            toks = tokenize(text)
            if not toks:
                continue
            idx = len(docs)
            docs.append({
                "ep_id": r["id"], "show": r["show"], "title": r["title"],
                "date": r["date"][:10], "url": r["url"],
                "speaker": speaker, "text": text,
            })
            doc_len.append(len(toks))
            tf = Counter(toks)
            for tok, c in tf.items():
                postings[tok].append((idx, c))
                df[tok] += 1

    N = len(docs)
    avgdl = sum(doc_len) / N if N else 0
    idf = {tok: math.log(1 + (N - d + 0.5) / (d + 0.5)) for tok, d in df.items()}

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, "wb") as fh:
        pickle.dump({"docs": docs, "postings": dict(postings), "idf": idf,
                     "doc_len": doc_len, "avgdl": avgdl, "N": N}, fh)
    print(f"Indexed {N:,} passages from {len(files):,} episodes -> {OUT.relative_to(ROOT)}")
    print(f"Vocabulary: {len(idf):,} terms | avg passage length: {avgdl:.0f} tokens")

if __name__ == "__main__":
    main()
