#!/usr/bin/env python3
"""Parse the Freakonomics WordPress WXR export into clean per-episode JSON.

Output:
  data/episodes/<show-slug>/<postid>-<title-slug>.json   one file per episode w/ transcript
  data/index.json                                          compact manifest of all episodes
"""
import re, os, json, html, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "raw" / "freakonomics.WordPress.2026-06-08.xml"
EP_DIR = ROOT / "data" / "episodes"

def cdata(s):
    m = re.search(r"<!\[CDATA\[(.*?)\]\]>", s, re.S)
    return m.group(1) if m else (s or "")

def field(item, tag):
    m = re.search(rf"<{tag}>(.*?)</{tag}>", item, re.S)
    return cdata(m.group(1)).strip() if m else ""

META_RE = re.compile(
    r"<wp:meta_key>\s*<!\[CDATA\[(.*?)\]\]>\s*</wp:meta_key>\s*"
    r"<wp:meta_value>\s*<!\[CDATA\[(.*?)\]\]>\s*</wp:meta_value>", re.S)

def metas(item):
    d = {}
    for k, v in META_RE.findall(item):
        d.setdefault(k, v)  # first wins
    return d

def slugify(s, maxlen=60):
    s = re.sub(r"<[^>]+>", "", s)
    s = html.unescape(s).lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s[:maxlen] or "untitled"

def clean_transcript(h):
    """HTML transcript -> readable text, preserving speaker labels and paragraph breaks."""
    if not h: return ""
    t = h
    t = re.sub(r"(?i)</(p|blockquote|div|li|h[1-6])>", "\n\n", t)
    t = re.sub(r"(?i)<br\s*/?>", "\n", t)
    t = re.sub(r"<[^>]+>", "", t)          # strip remaining tags (em/strong/a/etc.)
    t = html.unescape(t)
    t = re.sub(r"[ \t]+", " ", t)
    t = re.sub(r"\n\s*\n\s*\n+", "\n\n", t)
    return t.strip()

def main():
    data = RAW.read_text(encoding="utf-8")
    items = re.findall(r"<item>.*?</item>", data, re.S)
    index = []
    written = 0
    for it in items:
        if "<wp:post_type><![CDATA[podcast]]></wp:post_type>" not in it:
            continue
        status = field(it, "wp:status")
        m = metas(it)
        transcript = clean_transcript(m.get("_podcast_transcript", ""))
        if not transcript.strip():
            continue  # only episodes that actually have a transcript
        title = re.sub(r"<[^>]+>", "", field(it, "title")).strip()
        ser = re.search(r'<category domain="series"[^>]*><!\[CDATA\[(.*?)\]\]></category>', it)
        show = ser.group(1) if ser else "Unknown"
        pid = field(it, "wp:post_id")
        post_date = m.get("_wkd_old_post_id", "")  # placeholder; real date below
        date = field(it, "wp:post_date")
        rec = {
            "id": pid,
            "title": title,
            "show": show,
            "season": m.get("_podcast_season_num", ""),
            "episode": m.get("_podcast_episode_num", ""),
            "date": date,
            "status": status,
            "url": field(it, "link"),
            "byline": clean_transcript(m.get("_podcast_extra_byline", "")),
            "show_notes": clean_transcript(re.search(r"<content:encoded>(.*?)</content:encoded>", it, re.S).group(1) if re.search(r"<content:encoded>(.*?)</content:encoded>", it, re.S) else ""),
            "sources_raw": clean_transcript(m.get("_podcast_sources", "")),
            "resources_raw": clean_transcript(m.get("_podcast_resources", "")),
            "transcript": transcript,
            "transcript_chars": len(transcript),
        }
        show_slug = slugify(show, 40)
        out = EP_DIR / show_slug / f"{pid}-{slugify(title)}.json"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(rec, ensure_ascii=False, indent=2), encoding="utf-8")
        written += 1
        index.append({k: rec[k] for k in ("id","title","show","season","episode","date","status","url","transcript_chars")}
                      | {"path": str(out.relative_to(ROOT))})
    index.sort(key=lambda r: (r["show"], r["date"]))
    (ROOT / "data" / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {written} episode files")
    print(f"Index: {len(index)} entries -> data/index.json")
    # quick summary by show
    from collections import Counter
    c = Counter(r["show"] for r in index)
    for show, n in c.most_common():
        print(f"  {show:35} {n}")

if __name__ == "__main__":
    main()
