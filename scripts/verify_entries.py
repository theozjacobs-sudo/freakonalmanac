#!/usr/bin/env python3
"""Grounding check: every entry's quote must appear verbatim in its source transcript.
Normalizes smart quotes/dashes/whitespace so real matches aren't lost to unicode."""
import json, re, glob, sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent

def norm(s):
    s=s.replace("’","'").replace("‘","'").replace("“",'"').replace("”",'"')
    s=s.replace("—","-").replace("–","-").replace("…","...")
    s=re.sub(r"\s+"," ",s)
    return s.strip().lower()

# index episode transcripts by id
tx={}
for f in glob.glob(str(ROOT/"data/episodes/**/*.json"), recursive=True):
    r=json.load(open(f))
    tx[r["id"]]=norm(r["transcript"])

entries=json.load(open(ROOT/"data/prototype/entries.json"))
ok=bad=0
for e in entries:
    eid=e["episode"]["id"]
    found = eid in tx and norm(e["quote"]) in tx[eid]
    e["verified_quote_in_transcript"]=found
    flag="✅" if found else "❌ NOT FOUND"
    if found: ok+=1
    else: bad+=1
    print(f'{flag}  [{e["headword"]}]  ← {e["episode"]["show"]}')
json.dump(entries, open(ROOT/"data/prototype/entries.json","w"), ensure_ascii=False, indent=2)
print(f"\nGrounded: {ok}/{ok+bad}   Unverified: {bad}")
sys.exit(1 if bad else 0)
