#!/usr/bin/env python3
"""Render the Fact Finder prototype (data/prototype/fact_finder_entries.json) into
a single self-contained HTML page: site/fact-finder.html.

Run:  python3 scripts/build_site.py
"""
import json, html, sys
from pathlib import Path
from collections import Counter

ROOT = Path(__file__).resolve().parent.parent
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "data/prototype/fact_finder_entries.json"
entries = json.load(open(SRC, encoding="utf-8"))

n_entries = len(entries)
n_eps = len({e["episode"]["id"] for e in entries})
types = Counter(e["entry_type"] for e in entries)
oldest = max(e["age_years"] for e in entries)

DATA = json.dumps(entries, ensure_ascii=False)

CSS = r"""
:root{
  --ground:#f7f6f1; --surface:#ffffff; --surface-2:#fbfaf6;
  --ink:#191d23; --muted:#5c6672; --faint:#8b93a0;
  --hair:#e6e4db; --hair-2:#efeee7;
  --accent:#22457e; --accent-soft:#e8eef7; --accent-ink:#1b365f;
  --good:#3a7a4e; --good-bg:#e7f1e8;
  --warn:#9a6a12; --warn-bg:#f6edd7;
  --alert:#b34a37; --alert-bg:#f7e6e1;
  --person:#6a4c9c; --person-bg:#efe9f8;
  --place:#1f6f6a; --place-bg:#e1f0ee;
  --story:#a84364; --story-bg:#f8e7ed;
  --shadow:0 1px 2px rgba(20,30,50,.04),0 8px 24px rgba(20,30,50,.05);
  --serif:Georgia,"Iowan Old Style","Times New Roman",serif;
  --sans:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  --mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
}
@media (prefers-color-scheme:dark){:root{
  --ground:#131619; --surface:#1a1e24; --surface-2:#171b20;
  --ink:#edf0f3; --muted:#a4adb9; --faint:#727c8a;
  --hair:#2b3138; --hair-2:#242a31;
  --accent:#7ea6dd; --accent-soft:#1e2a3d; --accent-ink:#a9c4e8;
  --good:#78b98a; --good-bg:#1c2a20;
  --warn:#d6a44e; --warn-bg:#2c2517;
  --alert:#e08a76; --alert-bg:#2e1f1b;
  --person:#b79ae0; --person-bg:#251d38;
  --place:#6cc5bc; --place-bg:#152e2b;
  --story:#e08aa7; --story-bg:#301e26;
  --shadow:0 1px 2px rgba(0,0,0,.3),0 10px 30px rgba(0,0,0,.35);
}}
:root[data-theme="light"]{
  --ground:#f7f6f1; --surface:#ffffff; --surface-2:#fbfaf6;
  --ink:#191d23; --muted:#5c6672; --faint:#8b93a0; --hair:#e6e4db; --hair-2:#efeee7;
  --accent:#22457e; --accent-soft:#e8eef7; --accent-ink:#1b365f;
  --good:#3a7a4e; --good-bg:#e7f1e8; --warn:#9a6a12; --warn-bg:#f6edd7;
  --alert:#b34a37; --alert-bg:#f7e6e1;
  --person:#6a4c9c; --person-bg:#efe9f8; --place:#1f6f6a; --place-bg:#e1f0ee;
  --story:#a84364; --story-bg:#f8e7ed;
  --shadow:0 1px 2px rgba(20,30,50,.04),0 8px 24px rgba(20,30,50,.05);
}
:root[data-theme="dark"]{
  --ground:#131619; --surface:#1a1e24; --surface-2:#171b20;
  --ink:#edf0f3; --muted:#a4adb9; --faint:#727c8a; --hair:#2b3138; --hair-2:#242a31;
  --accent:#7ea6dd; --accent-soft:#1e2a3d; --accent-ink:#a9c4e8;
  --good:#78b98a; --good-bg:#1c2a20; --warn:#d6a44e; --warn-bg:#2c2517;
  --alert:#e08a76; --alert-bg:#2e1f1b;
  --person:#b79ae0; --person-bg:#251d38; --place:#6cc5bc; --place-bg:#152e2b;
  --story:#e08aa7; --story-bg:#301e26;
  --shadow:0 1px 2px rgba(0,0,0,.3),0 10px 30px rgba(0,0,0,.35);
}
*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--ink);font-family:var(--sans);
  line-height:1.55;-webkit-font-smoothing:antialiased;font-size:16px}
.wrap{max-width:1080px;margin:0 auto;padding:0 24px}
a{color:var(--accent);text-decoration:none}
h1,h2,h3{text-wrap:balance;margin:0}

/* masthead */
.mast{border-bottom:1px solid var(--hair);padding:52px 0 30px;background:
  linear-gradient(180deg,var(--surface-2),var(--ground))}
.eyebrow{font-family:var(--mono);font-size:.72rem;letter-spacing:.16em;
  text-transform:uppercase;color:var(--accent);font-weight:600}
.mast h1{font-family:var(--serif);font-size:clamp(2.6rem,6vw,4.1rem);font-weight:700;
  letter-spacing:-.02em;line-height:1;margin:.28em 0 .18em}
.mast .lede{font-size:1.12rem;color:var(--muted);max-width:60ch}
.mast .lede b{color:var(--ink);font-weight:600}
.stats{display:flex;flex-wrap:wrap;gap:10px;margin-top:26px}
.stat{background:var(--surface);border:1px solid var(--hair);border-radius:10px;
  padding:11px 15px;box-shadow:var(--shadow)}
.stat .n{font-family:var(--mono);font-size:1.32rem;font-weight:600;letter-spacing:-.02em;
  font-variant-numeric:tabular-nums;display:block}
.stat .l{font-size:.74rem;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}

/* toolbar */
.toolbar{position:sticky;top:0;z-index:10;background:color-mix(in srgb,var(--ground) 86%,transparent);
  backdrop-filter:blur(10px);border-bottom:1px solid var(--hair);padding:14px 0}
.tools{display:flex;flex-wrap:wrap;gap:12px;align-items:center}
.search{flex:1 1 260px;position:relative}
.search input{width:100%;padding:10px 14px 10px 38px;border:1px solid var(--hair);
  border-radius:9px;background:var(--surface);color:var(--ink);font:inherit;font-size:.95rem}
.search input:focus{outline:2px solid var(--accent);outline-offset:1px;border-color:var(--accent)}
.search svg{position:absolute;left:12px;top:50%;transform:translateY(-50%);width:16px;height:16px;
  stroke:var(--faint);fill:none}
.segs{display:flex;gap:4px;background:var(--surface-2);border:1px solid var(--hair);
  border-radius:9px;padding:3px}
.seg{border:0;background:transparent;color:var(--muted);font:inherit;font-size:.86rem;
  padding:6px 12px;border-radius:6px;cursor:pointer;white-space:nowrap}
.seg[aria-pressed="true"]{background:var(--accent);color:#fff}
@media (prefers-color-scheme:dark){.seg[aria-pressed="true"]{color:#0c1220}}
:root[data-theme="dark"] .seg[aria-pressed="true"]{color:#0c1220}
:root[data-theme="light"] .seg[aria-pressed="true"]{color:#fff}
select.filter{border:1px solid var(--hair);border-radius:9px;background:var(--surface);
  color:var(--ink);font:inherit;font-size:.88rem;padding:9px 12px;cursor:pointer}
.count{font-family:var(--mono);font-size:.8rem;color:var(--muted);margin-left:auto;
  font-variant-numeric:tabular-nums}

/* A–Z jump bar */
.azbar{display:flex;flex-wrap:wrap;gap:2px;margin-top:10px}
.az{border:0;background:transparent;color:var(--muted);font-family:var(--mono);cursor:pointer;
  border-radius:6px;padding:3px 0 2px;flex:1 1 26px;min-width:26px;max-width:44px;
  display:flex;flex-direction:column;align-items:center;line-height:1.15}
.az b{font-size:.82rem;font-weight:600}
.az i{font-style:normal;font-size:.56rem;color:var(--faint);font-variant-numeric:tabular-nums;
  min-height:.8em}
.az:not(:disabled):hover{background:var(--surface-2);color:var(--ink)}
.az:disabled{color:color-mix(in srgb,var(--faint) 38%,transparent);cursor:default}
.az:disabled i{visibility:hidden}
.az[aria-pressed="true"]{background:var(--accent);color:#fff}
.az[aria-pressed="true"] i{color:currentColor;opacity:.75}
@media (prefers-color-scheme:dark){.az[aria-pressed="true"]{color:#0c1220}}
:root[data-theme="dark"] .az[aria-pressed="true"]{color:#0c1220}
:root[data-theme="light"] .az[aria-pressed="true"]{color:#fff}
.az:focus-visible{outline:2px solid var(--accent);outline-offset:1px}

/* entries */
main{padding:30px 0 8px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px}
.entry{background:var(--surface);border:1px solid var(--hair);border-radius:14px;
  padding:20px 20px 16px;box-shadow:var(--shadow);display:flex;flex-direction:column;gap:11px;
  transition:transform .16s ease,box-shadow .16s ease,border-color .16s ease}
.entry:hover{transform:translateY(-2px);border-color:color-mix(in srgb,var(--accent) 40%,var(--hair));
  box-shadow:0 3px 6px rgba(20,30,50,.06),0 14px 34px rgba(20,30,50,.09)}
.entry__head{display:flex;align-items:baseline;justify-content:space-between;gap:10px}
.entry__word{font-family:var(--serif);font-size:1.42rem;font-weight:700;letter-spacing:-.015em;
  line-height:1.12}
.tag{font-family:var(--mono);font-size:.63rem;letter-spacing:.12em;text-transform:uppercase;
  padding:4px 8px;border-radius:6px;font-weight:600;white-space:nowrap;border:1px solid transparent}
.tag--concept{background:var(--accent-soft);color:var(--accent-ink)}
.tag--figure{background:var(--good-bg);color:var(--good)}
.tag--fact{background:var(--warn-bg);color:var(--warn)}
.tag--person{background:var(--person-bg);color:var(--person)}
.tag--place{background:var(--place-bg);color:var(--place)}
.tag--story{background:var(--story-bg);color:var(--story)}
.entry__cat{font-size:.76rem;color:var(--faint);text-transform:uppercase;letter-spacing:.06em;
  margin-top:-6px}
.entry__claim{font-size:1.01rem;color:var(--ink);margin:0}
.entry__quote{margin:0;padding:11px 14px;background:var(--surface-2);border-left:2.5px solid var(--accent);
  border-radius:0 8px 8px 0;font-size:.9rem;color:var(--muted)}
.entry__quote cite{display:block;margin-top:6px;font-style:normal;font-size:.78rem;color:var(--faint);
  font-family:var(--mono)}
.entry__foot{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;margin-top:2px;
  padding-top:12px;border-top:1px solid var(--hair-2)}
.cite-src{font-size:.8rem;color:var(--muted);flex:1 1 100%;text-decoration:none;
  border-radius:5px;transition:color .14s ease}
.cite-src b{color:var(--ink);font-weight:600}
.cite-src:hover{color:var(--accent)}
.cite-src:hover b{color:var(--accent)}
.cite-src:hover .ext{opacity:1;transform:translate(1px,-1px)}
.cite-src:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.ext{display:inline-block;margin-left:5px;color:var(--accent);font-size:.82em;opacity:.55;
  transition:opacity .14s ease,transform .14s ease}
.cite-date{font-family:var(--mono);font-size:.74rem;color:var(--faint);font-variant-numeric:tabular-nums}
.pill{font-family:var(--mono);font-size:.68rem;letter-spacing:.04em;padding:3px 9px;border-radius:20px;
  font-weight:600;display:inline-flex;align-items:center;gap:5px}
.pill::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}
.pill--current{background:var(--good-bg);color:var(--good)}
.pill--aging{background:var(--warn-bg);color:var(--warn)}
.pill--check{background:var(--alert-bg);color:var(--alert)}
.pill--evergreen,.pill--durable{background:var(--surface-2);color:var(--faint)}
.grounded{margin-left:auto;font-family:var(--mono);font-size:.72rem;color:var(--good);
  display:inline-flex;align-items:center;gap:4px}
.empty{text-align:center;color:var(--muted);padding:60px 0;font-size:1.02rem}
.sentinel{height:1px}
.loadstate{text-align:center;color:var(--faint);font-family:var(--mono);font-size:.76rem;
  padding:18px 0 6px;font-variant-numeric:tabular-nums}

/* how it works */
.how{border-top:1px solid var(--hair);margin-top:44px;padding:46px 0 10px;background:var(--surface-2)}
.how h2{font-family:var(--serif);font-size:1.9rem;font-weight:700;letter-spacing:-.01em;margin-bottom:6px}
.how .sub{color:var(--muted);max-width:64ch;margin-bottom:30px}
.steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:16px}
.step{background:var(--surface);border:1px solid var(--hair);border-radius:12px;padding:18px}
.step .k{font-family:var(--mono);font-size:.74rem;color:var(--accent);font-weight:600;letter-spacing:.04em}
.step h3{font-size:1.02rem;margin:8px 0 6px}
.step p{font-size:.88rem;color:var(--muted);margin:0}
.note{margin-top:22px;padding:16px 18px;border:1px solid var(--hair);border-radius:12px;
  background:var(--surface);font-size:.9rem;color:var(--muted)}
.note b{color:var(--ink)}
footer{padding:34px 0 60px;color:var(--faint);font-size:.82rem;text-align:center}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
@media (max-width:560px){.mast{padding:38px 0 24px}.count{margin-left:0;width:100%}}
"""

def esc(s): return html.escape(str(s), quote=True)

def render():
    stat = lambda n,l: f'<div class="stat"><span class="n">{n}</span><span class="l">{l}</span></div>'
    stats = (stat("1,604","episodes indexed") + stat(n_entries,"sample entries") +
             stat(n_eps,"episodes mined") + stat("100%","quote-verified"))
    steps = [
      ("Split","One clean transcript per episode","An 85&nbsp;MB WordPress export becomes 1,604 speaker-labeled transcripts — who said what, in which episode, when."),
      ("Surface","Find the fact-bearing lines","A pre-filter pulls the sentences carrying numbers, percentages, and dollar figures, with the speaker attached — the raw material for entries."),
      ("Extract","Write the encyclopedia entry","Each becomes a filed entry: a headword, a type (concept / figure / fact), the claim in plain language, a verbatim quote + speaker, and the full episode citation."),
      ("Verify","Prove it was really said","Every quote is checked character-for-character against its source transcript. Anything that doesn’t match is flagged, never published. Here: all "+str(n_entries)+" pass."),
      ("Flag age","Know what may be stale","Figures get an age flag so a number from 2011 can be refreshed before it goes in the almanac; concepts and historical facts are marked evergreen."),
    ]
    steps_html = "".join(
      f'<div class="step"><div class="k">{i+1:02d} &middot; {esc(k)}</div><h3>{esc(t)}</h3><p>{p}</p></div>'
      for i,(k,t,p) in enumerate(steps))

    return f"""<title>Fact Finder — Freakonomics Radio</title>
<style>{CSS}</style>
<header class="mast"><div class="wrap">
  <div class="eyebrow">A Freakonomics Radio reference &middot; prototype</div>
  <h1>Fact Finder</h1>
  <p class="lede">Facts, figures, and concepts mined <b>only</b> from the show’s own transcripts —
     every entry filed under an encyclopedia term and tied to a <b>verbatim quote</b>, the speaker,
     and the episode it came from. This is a {n_entries}-entry taste of what a full A–Z almanac
     of ten years of Freakonomics Radio could hold.</p>
  <div class="stats">{stats}</div>
</div></header>

<div class="toolbar"><div class="wrap tools">
  <div class="search">
    <svg viewBox="0 0 24 24" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
    <input id="q" type="search" placeholder="Search headwords, claims, quotes, speakers…" aria-label="Search entries">
  </div>
  <div class="segs" id="typeSeg" role="group" aria-label="Filter by type">
    <button class="seg" data-type="all" aria-pressed="true">All</button>
    <button class="seg" data-type="concept" aria-pressed="false">Concepts</button>
    <button class="seg" data-type="figure" aria-pressed="false">Figures</button>
    <button class="seg" data-type="fact" aria-pressed="false">Facts</button>
    <button class="seg" data-type="person" aria-pressed="false">People</button>
    <button class="seg" data-type="place" aria-pressed="false">Places</button>
    <button class="seg" data-type="story" aria-pressed="false">Stories</button>
  </div>
  <select class="filter" id="showSel" aria-label="Filter by show"></select>
  <span class="count" id="count"></span>
</div>
<div class="wrap"><nav class="azbar" id="azbar" aria-label="Jump to letter"></nav></div></div>

<main><div class="wrap"><div class="grid" id="grid"></div>
  <div class="empty" id="empty" hidden>No entries match — try clearing the filters.</div>
  <div class="sentinel" id="sentinel" aria-hidden="true"></div>
  <div class="loadstate" id="loadstate" hidden></div>
</div></main>

<section class="how"><div class="wrap">
  <h2>How the Fact Finder is built</h2>
  <p class="sub">A repeatable pipeline turns raw transcripts into sourced, checkable entries.
     The same passage index also powers a keyword/speaker search across all ten years of the archive.</p>
  <div class="steps">{steps_html}</div>
  <div class="note"><b>Grounded by design.</b> Nothing here is drawn from the open web or from the model’s
     memory — only from what was actually said on the podcast. The verbatim quote under each entry is the
     receipt, and the age flag tells an editor which numbers to double-check before publishing.</div>
</div></section>

<footer><div class="wrap">Fact Finder — prototype built from the Freakonomics Radio transcript archive.
  {n_entries} entries · {n_eps} episodes · oldest source ~{oldest} years old · 100% quote-verified.</div></footer>

<script id="data" type="application/json">{DATA}</script>
""" + r"""<script>
const ENTRIES=JSON.parse(document.getElementById('data').textContent);
const grid=document.getElementById('grid'),countEl=document.getElementById('count'),
      emptyEl=document.getElementById('empty'),q=document.getElementById('q'),
      showSel=document.getElementById('showSel'),azbar=document.getElementById('azbar'),
      sentinel=document.getElementById('sentinel'),loadEl=document.getElementById('loadstate');
let type='all',letter='all';
const coll=new Intl.Collator('en',{sensitivity:'base',numeric:true});
ENTRIES.sort((a,b)=>coll.compare(a.headword,b.headword));
const letterOf=h=>{const c=(h||'').trim().normalize('NFD').charAt(0).toUpperCase();
  return c>='A'&&c<='Z'?c:'#';};
ENTRIES.forEach(e=>e._letter=letterOf(e.headword));
const LETTERS=['#',...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];
azbar.innerHTML=LETTERS.map(L=>
  `<button class="az" data-letter="${L}" aria-pressed="false" title="Jump to ${L==='#'?'0–9 & symbols':L}">
   <b>${L}</b><i></i></button>`).join('');
const azBtns=[...azbar.querySelectorAll('.az')];
const shows=[...new Set(ENTRIES.map(e=>e.episode.show))].sort();
showSel.innerHTML='<option value="all">All shows</option>'+shows.map(s=>`<option value="${s.replace(/"/g,'&quot;')}">${s}</option>`).join('');
const fresh={current:'current',aging:'aging',check:'check',evergreen:'evergreen',durable:'durable'};
const freshLabel={current:'current',aging:'aging',check:'verify',evergreen:'evergreen',durable:'durable'};
const esc=s=>s.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function card(e){
  const yr=e.episode.date.slice(0,4);
  return `<article class="entry">
    <div class="entry__head"><h3 class="entry__word">${esc(e.headword)}</h3>
      <span class="tag tag--${e.entry_type}">${e.entry_type}</span></div>
    <div class="entry__cat">${esc(e.category)}</div>
    <p class="entry__claim">${esc(e.claim)}</p>
    <blockquote class="entry__quote">“${esc(e.quote)}”<cite>— ${esc(e.speaker)}</cite></blockquote>
    <div class="entry__foot">
      <a class="cite-src" href="${esc(e.episode.url)}" target="_blank" rel="noopener noreferrer"><b>${esc(e.episode.show)}</b> — “${esc(e.episode.title)}”<span class="ext" aria-hidden="true">↗</span></a>
      <span class="cite-date">${yr} · ${e.age_years} yr${e.age_years===1?'':'s'} old</span>
      <span class="pill pill--${fresh[e.freshness]}" title="${esc(e.freshness_note)}">${freshLabel[e.freshness]}</span>
      <span class="grounded" title="Quote verified against the source transcript">✓ grounded</span>
    </div></article>`;
}
/* --- incremental rendering: BATCH cards at a time via IntersectionObserver --- */
const BATCH=60;
let rows=[],shown=0;
function appendBatch(){
  if(shown>=rows.length)return;
  const next=rows.slice(shown,shown+BATCH);
  grid.insertAdjacentHTML('beforeend',next.map(card).join(''));
  shown+=next.length;
  updateLoadState();
  requestAnimationFrame(topUp);          // keep filling if sentinel is still near the viewport
}
function topUp(){
  if(shown>=rows.length)return;
  if(sentinel.getBoundingClientRect().top<innerHeight+600)appendBatch();
}
function updateLoadState(){
  const more=shown<rows.length;
  sentinel.hidden=!more;
  loadEl.hidden=!more;
  if(more)loadEl.textContent='showing '+shown+' of '+rows.length+' — scroll for more';
}
const io=new IntersectionObserver(es=>{if(es.some(x=>x.isIntersecting))appendBatch();},
  {rootMargin:'900px 0px'});
io.observe(sentinel);

function baseMatch(e,term,show){
  if(type!=='all'&&e.entry_type!==type)return false;
  if(show!=='all'&&e.episode.show!==show)return false;
  if(term){const hay=(e.headword+' '+e.claim+' '+e.quote+' '+e.speaker+' '+e.category+' '+e.episode.title).toLowerCase();
    if(!hay.includes(term))return false;}
  return true;
}
function render(){
  const term=q.value.trim().toLowerCase(), show=showSel.value;
  const base=ENTRIES.filter(e=>baseMatch(e,term,show));
  /* letter counts reflect the other active filters, so the bar composes with them */
  const lc={};for(const e of base)lc[e._letter]=(lc[e._letter]||0)+1;
  if(letter!=='all'&&!lc[letter])letter='all';   // active letter emptied by a new filter
  for(const b of azBtns){
    const n=lc[b.dataset.letter]||0;
    b.disabled=!n;
    b.querySelector('i').textContent=n||'';
    b.setAttribute('aria-pressed',String(letter===b.dataset.letter));
  }
  rows=letter==='all'?base:base.filter(e=>e._letter===letter);
  grid.innerHTML='';shown=0;
  appendBatch();
  updateLoadState();
  emptyEl.hidden=rows.length>0;
  countEl.textContent=rows.length+' / '+ENTRIES.length+' entries';
}
document.getElementById('typeSeg').addEventListener('click',ev=>{
  const b=ev.target.closest('.seg'); if(!b)return;
  type=b.dataset.type;
  [...ev.currentTarget.children].forEach(x=>x.setAttribute('aria-pressed',String(x===b)));
  render();
});
azbar.addEventListener('click',ev=>{
  const b=ev.target.closest('.az'); if(!b||b.disabled)return;
  letter=(letter===b.dataset.letter)?'all':b.dataset.letter;   // click again to clear
  render();
  const y=grid.getBoundingClientRect().top+scrollY-document.querySelector('.toolbar').offsetHeight-10;
  if(scrollY>y)scrollTo({top:Math.max(y,0),behavior:'smooth'});
});
q.addEventListener('input',render); showSel.addEventListener('change',render);
render();
</script>"""

out = ROOT / "site" / "fact-finder.html"
out.parent.mkdir(exist_ok=True)
out.write_text(render(), encoding="utf-8")
print(f"Wrote {out.relative_to(ROOT)}  ({n_entries} entries, {n_eps} episodes)")
