#!/usr/bin/env python3
"""Build the 'Fact Finder' prototype dataset.

Entries are authored referencing an episode by post-id; episode metadata (title,
date, url) is pulled from the corpus so citations can't drift. For each entry we
compute an age and a freshness flag (figures age; concepts/facts don't), then
verify the quote appears verbatim in the source transcript.

Run:  python3 scripts/build_fact_finder.py
"""
import json, re, glob
from pathlib import Path
from datetime import date

ROOT = Path(__file__).resolve().parent.parent
TODAY = date(2026, 7, 14)

# ---- authored entries, keyed by episode post-id -------------------------------
E = {
 # The Church of "Scionology" (2011)
 "128037": [
  ("Family firm","concept","Business & management",
   "Company profitability typically falls 10–20% after a founder hands the business to an heir.",
   "We see drops between ten and twenty-percent of profitability.","Antoinette Schoar, MIT finance professor"),
  ("Carnegie Conjecture","concept","Business & management",
   "Andrew Carnegie's argument that inheriting a fortune deadens the heir's drive and talent, so tycoons should give wealth away before death.",
   "the inheritance of a fortune for the second generation, the heirs who inherited fortunes in his opinion it deadened their talents","Vikas Mehrotra, University of Alberta finance professor"),
  ("Heritability","concept","Genetics & behavior",
   "The share of variation in a trait attributable to genes: height is ~80–90% heritable, but personality only ~40–50% and IQ ~50–70% — so 'CEO ability' passes down weakly.",
   "the heritability of height is on the order of eighty to ninety-percent","Matt McGue, behavioral geneticist, University of Minnesota"),
  ("Adult adoption (Japan)","fact","Business & culture",
   "Japanese family firms often adopt an adult man (typically 25–30) as heir/CEO; over 98% of Japan's adoptees are grown men, and these adopted-heir firms account for nearly all the outperformance of family successions.",
   "more than ninety-eight percent of the adoptees are males around twenty-five or thirty years old","Vikas Mehrotra"),
  ("Family-controlled companies","fact","Business & economics",
   "About one-third of Fortune 500 companies are family-controlled.",
   "About one-third of the companies in the Fortune 500 are family-controlled.","Stephen Dubner (narration)"),
 ],
 # The Suicide Paradox (2011)
 "128029": [
  ("Werther effect","concept","Psychology & media",
   "A rise in copycat suicides following prominent media coverage of a suicide; after Marilyn Monroe's death, U.S. suicides ran ~10% above normal.",
   "Suicide rates were 10 percent higher than normal.","Sean Cole (narration)"),
  ("Papageno effect","concept","Psychology & media",
   "The inverse of the Werther effect: responsible, careful reporting can reduce suicides. After media guidelines, suicides/attempts on the Viennese subway fell nearly 80%.",
   "the number of suicides and suicide attempts on the Viennese subway decreased by nearly 80%","Thomas Niederkrotenthaler, suicide researcher, Austria"),
  ("Suicide vs. homicide (U.S.)","figure","Public health",
   "Americans die by suicide far more often than by homicide — roughly 36,500 suicides vs. 16,500 homicides in 2009.",
   "there were roughly 36,500 suicides in the U.S. and roughly 16,500 homicides","Steve Levitt, economist"),
  ("Suicide and impulsivity","figure","Public health",
   "Suicide is often impulsive: in one Houston study of attempts, 70% of people acted within an hour of deciding.",
   "in 70 percent of the cases, the time between deciding to commit suicide and taking action was under an hour","David Lester, suicide-studies psychologist"),
 ],
 # How Spotify Saved the Music Industry (2019)
 "112332": [
  ("Streaming royalty rate","figure","Music economics",
   "A single stream pays rights-holders roughly 0.4 cents; Spotify's top 2018 artist Drake earned nearly $33M on 8.2 billion streams.",
   "Assuming a typical streaming royalty rate of 0.4 cents per play, that’s nearly $33 million going to Drake’s camp.","Stephen Dubner (narration)"),
  ("Professional musicians (U.S.)","figure","Music economics",
   "There are roughly 200,000 professional musicians in the U.S., about 0.13% of all workers — a share roughly unchanged since 1970.",
   "there are roughly 200,000 professional musicians in the U.S. today, accounting for 0.13 percent of all U.S. workers","Stephen Dubner (narration), citing Alan Krueger"),
  ("Streaming income inequality","figure","Music economics",
   "Streaming income is highly skewed: an industry survey found just 28% of artists earned any money from streaming in 2018, with a median of $100.",
   "just 28 percent of artists earned money from streaming in 2018, with the median amount just $100","Stephen Dubner (narration), citing Alan Krueger"),
  ("Record labels' Spotify equity","fact","Music business",
   "To license their catalogs, the three major labels (Sony, Universal, Warner) were each reportedly given 4–6% of Spotify's shares — worth billions at its 2018 IPO.",
   "were reportedly each given between 4 and 6 percent of Spotify’s shares","Stephen Dubner (narration)"),
 ],
 # Forget Everything You Know About Your Dog (2020)
 "112069": [
  ("Canine olfaction","figure","Animal science",
   "A dog's nose has on the order of 300 million olfactory cells, versus about 5 million in humans.",
   "that area has hundreds of millions of cells in the dog, 300 million","Alexandra Horowitz, dog-cognition researcher"),
  ("Belyaev fox experiment","concept","Genetics & domestication",
   "A Soviet experiment (begun 1959) that, by breeding only the tamest of an initial 130 foxes, reshaped the animals' genome and appearance within a half-century — a model for how domestication may have worked.",
   "Beginning with 130 foxes, he selectively chose and bred those that were the most “tame,” as he described it","Alexandra Horowitz"),
  ("Dogs in the U.S.","figure","Animal science",
   "Estimates put the U.S. dog population at 77–90 million, with roughly 40–50% of households owning at least one.",
   "there are between 77 and 90 million dogs in the U.S., with roughly 40 to 50 percent of households having at least one","Stephen Dubner (narration)"),
 ],
 # Why Does the Most Monotonous Job in the World Pay $1 Million? (2022)
 "131458": [
  ("Division of labor","concept","Economics",
   "Adam Smith's pin-factory illustration: ten workers each specializing in one step could make 48,000 pins a day — far more than the ~20 each could make alone.",
   "a group of 10 workers in a factory in one day could make 48,000 pins","Stephen Dubner (narration), citing Adam Smith"),
  ("Long snapper","fact","Sports economics",
   "The NFL's most specialized job: veteran long snappers earn about $1.2–1.3 million a year despite being on the field for only a handful of plays.",
   "Most of the veteran snappers, they make around 1.2 or 1.3 million a year.","Kevin Gold, agent"),
  ("Margins in football","figure","Sports",
   "More than a third of NFL regular-season games are decided by three points or fewer — which is why teams pay for reliability in specialists.",
   "More than one third of N.F.L. regular-season games are decided by three points or less.","Stephen Dubner (narration)"),
  ("Roster specialization","figure","Sports economics",
   "A long snapper is on the field for maybe 8 plays a game out of nearly 80 — teams spend a roster spot purely to buy reliability.",
   "the long snapper will be on the field for maybe just eight plays a game, out of an average of nearly 80 total plays","Stephen Dubner (narration)"),
 ],
 # Is Your Plane Ticket Too Expensive — or Too Cheap? (2023)
 "133824": [
  ("Airline Deregulation Act","fact","Economic policy",
   "The 1978 law, signed by Jimmy Carter, that let airlines set their own routes and fares — unleashing competition that drove ticket prices down.",
   "The Airline Deregulation Act was signed into law in 1978 by President Jimmy Carter.","Stephen Dubner (narration)"),
  ("Real airfare decline","figure","Economics",
   "Adjusted for inflation, the average U.S. domestic round-trip ticket now costs less than half what it once did.",
   "The average price today for a domestic round-trip ticket is less than half of what it used to be, once you adjust for inflation.","Ed Bastian, Delta CEO"),
  ("Access to air travel","figure","Economics",
   "Before deregulation only about half of Americans had ever flown; today roughly 90% have.",
   "Before deregulation, only about half of all Americans had ever been on an airplane.","Jon Ryerson, Delta"),
  ("Airline ancillary revenue","figure","Business models",
   "Selling seats is no longer the main event: American Express pays Delta over $5 billion a year for SkyMiles, and the main cabin is only ~40% of revenue.",
   "American Express this year will pay us over $5 billion for access to the SkyMiles that they reward their customers on the card.","Ed Bastian, Delta CEO"),
  ("Airline profitability","fact","Business",
   "Warren Buffett's quip on how brutal airline economics are: 'The best way to make $1 million in the airline business is to start with $1 billion.'",
   "The best way to make $1 million in the airline business is to start with $1 billion.","David Neeleman, airline founder (quoting Warren Buffett)"),
 ],
 # Why Do Your Eyeglasses Cost $1,000? (2024)
 "140408": [
  ("EssilorLuxottica","fact","Market structure",
   "The eyewear giant (from the 2018 Essilor–Luxottica merger) that owns roughly a quarter of the global prescription-eyeglasses market and more than half the lens market.",
   "EssilorLuxottica owns roughly a quarter of the global market in prescription eyeglasses, and more than half the market in lenses.","Cédric Rossi, equity analyst (via narration)"),
  ("Eyewear markup","figure","Consumer economics",
   "Frames reportedly cost about $20 to make at the top end, yet retail for hundreds of dollars.",
   "it tops out at about $20 for the best versions of them, and then you're able to sell them for hundreds of dollars","Tim Wu, legal scholar"),
  ("Average price of glasses","figure","Consumer economics",
   "In the U.S., a pair of simple prescription glasses costs around $350 on average; the global eyewear industry is worth ~$150 billion a year.",
   "a pair of simple prescription glasses costs, on average, around $350","Stephen Dubner (narration)"),
  ("Vertical integration","concept","Market structure",
   "Controlling every stage — manufacturing, supply chain, distribution, retail — which lets a firm shape how an entire industry evolves (and prices).",
   "When you are 100 percent vertically integrated player, you control manufacturing, supply chain, distribution, customer experience","Cédric Rossi (via narration)"),
  ("Market concentration","figure","Economics",
   "In over 75% of U.S. industries, a smaller number of large firms control more of the business than they did 20 years ago.",
   "a smaller number of large companies now control more of the business than they did 20 years ago","Stephen Dubner (narration), citing the White House"),
 ],
 # Sludge, Part 1 (2025)
 "141658": [
  ("Sludge","concept","Behavioral economics",
   "Richard Thaler's term for friction that impedes good decisions — e.g., 30 seconds to subscribe but forever to cancel. The opposite of a helpful 'nudge.'",
   "when it takes 30 seconds to sign up for some subscription service, and then  forever to cancel it","Stephen Dubner (narration), on Richard Thaler's concept"),
  ("Inattention and subscriptions","figure","Behavioral economics",
   "Cancellations quadruple in the month a card expires — implying consumers pay attention to a recurring charge only about a quarter of the time.",
   "We see two percent of people on average canceling per month, in a steady state, and then during the months of expiration, suddenly four times as many people are canceling their product.","Neale Mahoney, economist"),
  ("Drip pricing","fact","Consumer economics",
   "Hidden back-end fees (the concert ticket that jumps from $70 to $110 at checkout) cost U.S. households on the order of $90 billion, ~$650 per household.",
   "I think it’s something like $650 per household.","Neale Mahoney, economist"),
  ("Administrative burden in healthcare","figure","Health policy",
   "Paperwork friction is overwhelming providers: in one survey, 94% of physicians called administrative issues a huge burden.",
   "94 percent of physicians say these administrative issues are a huge burden.","Ben Handel, economist"),
  ("Enshittification","fact","Technology & culture",
   "Cory Doctorow's coinage for the decay of digital platforms; the American Dialect Society named it 2023 word of the year.",
   "In 2023, the American Dialect Society named as its word of the year “enshittification,”","Stephen Dubner (narration)"),
 ],
 # ---- carried over from the first prototype (non-FR), unified schema ----------
 "142263": [
  ("Podcasts (number of)","figure","Media economics",
   "As of 2025 there were more than 6.5 million podcasts, reaching nearly 600 million listeners worldwide.",
   "There are more than 6.5 million of them, and they reach nearly 600 million listeners worldwide.","Zachary Crockett (narration)"),
  ("CPM (cost per mille)","concept","Advertising",
   "Ad pricing per thousand impressions ('M' = Roman numeral 1,000). At a $25 CPM, a 100,000-download episode earns $2,500 per ad; observed podcast CPMs run $5–$100.",
   "CPM stands for \"cost per thousand,\" and Roman numeral M of thousand, so that's where it came from.","Gabe Tartaglia, SiriusXM VP of monetization"),
  ("Pre-roll / mid-roll / post-roll","concept","Advertising",
   "Podcast ad slots by position; pre-roll runs ~20% cheaper than mid-roll, and post-roll is nominal because few listeners reach the end.",
   "Pre-roll is typically about 20 percent cheaper than mid-roll, and then post-roll is, you know, very nominal.","Gabe Tartaglia, SiriusXM"),
 ],
 "133173": [
  ("Healthcare spending concentration","figure","Health economics",
   "In the U.S., just 5% of the population accounts for 50% of annual healthcare spending.",
   "in the U.S., just five percent of the population accounts for 50 percent of annual healthcare spending.","Bapu Jena (host)"),
  ("Super-utilizers","concept","Health economics",
   "Patients with multiple chronic conditions who use hospitals repeatedly; in Camden NJ the single leading utilizer averaged 113 hospital visits a year.",
   "The leading utilizer averaged 113 visits annually.","Bapu Jena (narration)"),
  ("Regression to the mean","concept","Statistics",
   "People selected at an extreme tend to improve on their own — so a program can look effective in before/after data even when a trial shows no effect (as with the Camden hot-spotting RCT).",
   "about 62 percent of both the treatment and the control group reentered the hospital.","Joseph Doyle, MIT economist"),
 ],
}

def load_meta():
    meta = {}
    for f in glob.glob(str(ROOT / "data/episodes/**/*.json"), recursive=True):
        r = json.load(open(f, encoding="utf-8"))
        meta[r["id"]] = r
    return meta

def norm(s):
    for a, b in [("’","'"),("‘","'"),("“",'"'),("”",'"'),("—","-"),("–","-"),("…","...")]:
        s = s.replace(a, b)
    return re.sub(r"\s+", " ", s).strip().lower()

def freshness(entry_type, age):
    if entry_type == "figure":
        if age >= 4: return "check", f"Figure is ~{age} yrs old — verify before publishing"
        if age >= 2: return "aging", f"Figure is ~{age} yrs old — likely still ok"
        return "current", f"Recent (~{age} yrs) — likely current"
    if entry_type == "concept":
        return "evergreen", "Concept — not time-sensitive"
    return "durable", "Historical fact — stable over time"

def main():
    meta = load_meta()
    out, ok, bad = [], 0, 0
    for eid, entries in E.items():
        m = meta[eid]
        tx = norm(m["transcript"])
        yr = int(m["date"][:4]); age = TODAY.year - yr
        for headword, etype, cat, claim, quote, speaker in entries:
            found = norm(quote) in tx
            ok += found; bad += (not found)
            flag, flag_note = freshness(etype, age)
            out.append({
                "headword": headword, "entry_type": etype, "category": cat,
                "claim": claim, "quote": quote, "speaker": speaker,
                "episode": {"title": re.sub(r"<[^>]+>","",m["title"]).strip(),
                            "show": m["show"], "id": eid, "date": m["date"][:10],
                            "url": m["url"]},
                "age_years": age, "freshness": flag, "freshness_note": flag_note,
                "verified_quote_in_transcript": found,
            })
    out.sort(key=lambda e: e["headword"].lower())
    (ROOT / "data/prototype").mkdir(parents=True, exist_ok=True)
    json.dump(out, open(ROOT / "data/prototype/fact_finder_entries.json","w"),
              ensure_ascii=False, indent=2)
    print(f"{len(out)} entries from {len(E)} episodes -> data/prototype/fact_finder_entries.json")
    print(f"Grounded: {ok}/{ok+bad}" + ("" if not bad else f"  ⚠ {bad} UNVERIFIED"))
    for e in out:
        if not e["verified_quote_in_transcript"]:
            print(f'   ❌ [{e["headword"]}] quote not found in {e["episode"]["id"]}')

if __name__ == "__main__":
    main()
