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
 # ---- batch 2: 20 more Freakonomics Radio episodes (2010–2026) --------------
 "127903": [
  ("Presidential effect on markets","figure","Political economy",
   "A natural experiment from the 2004 election suggested the stock market values the difference between a Bush and a Kerry presidency at only ~1.5–2%.",
   "It looks like the difference between having a Bush presidency and a Kerry presidency for the value of U.S. stocks was maybe 1 and a half or 2 percent; which is really a pretty small thing.","Justin Wolfers, economist"),
  ("Power not to enforce","concept","Government",
   "A frequently overlooked presidential power: choosing which laws to enforce.",
   "Then a third power, that is often under-reflected-upon, is the power not to enforce laws.","Bernadette Meyler, constitutional scholar"),
  ("Limits of presidential power","concept","Government",
   "Constitutional scholars note that presidents arrive expecting sweeping power and find it heavily constrained.",
   "every president comes into office thinking he’s got the keys to the kingdom only to discover that every door is double locked with a deadbolt.","Bernadette Meyler, constitutional scholar"),
 ],
 "128144": [
  ("Quitting and health","concept","Psychology",
   "Being able to abandon unattainable goals is measurably good for your health.",
   "he and a colleague found that being able to abandon goals that are essentially unattainable is good for your health.","Stephen Dubner (narration)"),
  ("Opportunity cost of pro sports","figure","Labor economics",
   "Ten years on, a minor-league baseball player earns about 40% less than a similar peer who skipped baseball for a regular career.",
   "the person who plays baseball is making about forty percent less on average ten years after they enter the game than the person who decides not to play baseball","Sudhir Venkatesh, sociologist"),
  ("The Offer (Zappos)","fact","Management",
   "Zappos pays new hires $3,000 to quit during training — a filter for commitment; of nearly 2,000 trainees, only about 30 ever took it.",
   "Zappos offers 3,000 dollars to any new hire who wants to walk away from the job.","Stacey Vanek Smith (narration)"),
  ("Baseball draft odds","figure","Sports",
   "Only about 11% of drafted players reach the majors — though nearly all of them expect to.",
   "only 11 percent of the kids who get drafted each year make the majors; but probably close to 100 percent of them think they will.","Stephen Dubner (narration)"),
 ],
 "128094": [
  ("Prize-linked savings","concept","Behavioral finance",
   "A savings product that pairs a bank account with lottery-style prizes, to lure lottery players into building an emergency cushion.",
   "The idea is a new financial product that combines the thrill of the lottery with the goal of  maybe accumulating more than $2,000 in a savings account","Melissa Kearney, economist"),
  ("Lottery rake","figure","Public finance",
   "State lotteries keep as much as 60% of ticket sales (the 'rake'), versus casino slot machines that pay out over 90%.",
   "With state lotteries, the rake can be as high as 60 percent.","Gordon Medenica, NY state lottery director"),
  ("Financial illiteracy","figure","Behavioral finance",
   "On three basic money questions (interest, inflation, risk), only half of 50-plus respondents got the first two right and just a third got all three.",
   "only fifty percent of respondents got both of the first two questions right, and only a third of the people got all three answers right.","Stephen Dubner (narration), citing Annamaria Lusardi"),
 ],
 "128548": [
  ("Résumé name gap","figure","Labor economics",
   "An identical résumé with a white-sounding name gets about 50% more callbacks than one with a Black-sounding name (Bertrand & Mullainathan).",
   "if you send out a  resume with a white-sounding name, it’s about 50 percent more likely to get a callback than an identical resume where all you’ve done is change the name to a black-sounding name.","Latanya Sweeney (narration)"),
  ("Divergence of Black names","fact","Culture",
   "Black and white American baby names were largely shared until they sharply diverged over a roughly seven-year span in the 1970s.",
   "within about a seven-year period in the 1970s, names just completely diverged.","Steve Levitt, economist"),
  ("Names trickle down","concept","Culture",
   "Trendy first names typically start among high-income, educated families and migrate down the income ladder over decades.",
   "start at the top of the income distribution, and over the course of 20, or 30, or 40 years they migrate their way down becoming more and more popular among the less-educated set.","Latanya Sweeney (narration)"),
 ],
 "128253": [
  ("Treaty of Guadalupe Hidalgo","fact","History",
   "Ending the Mexican-American War, Mexico ceded more than half its territory; the U.S. paid $15 million (roughly $400 million today).",
   "The Treaty called for the U.S. to compensate Mexico $15 million for all this property.","Stephen Dubner (narration)"),
  ("German reunification subsidy","figure","Economics",
   "Merging a poorer economy into a richer one is costly: West Germany transferred more than a trillion dollars to the former East Germany.",
   "there was more than a trillion dollars of subsidy from the West Germany to the East Germany when they joined up.","Austan Goolsbee, economist"),
  ("Fiscal transfers between states","concept","Public finance",
   "The U.S. quietly redistributes across states: Mississippi gets ~10% of its GDP back from Washington, while Connecticut pays ~10% more in than it gets.",
   "Mississippi gets about 10 percent of its GDP back from the federal government, more than what it puts in every single year.","Austan Goolsbee, economist"),
 ],
 "118809": [
  ("Homo economicus","concept","Economics",
   "The perfectly rational, self-interested actor still taught in Econ 101 — a model real humans rarely match.",
   "the model of human behavior still taught in economics 101","William Rosalsky (narration)"),
  ("Behavioral economics","concept","Economics",
   "The field that runs the rational-actor model through psychology; its founder hopes it eventually dissolves into economics itself.",
   "I hope that 50 years from now, maybe sooner, the field of behavioral economics will no longer exist, and economics will just be as behavioral as it needs to be.","Richard Thaler, economist"),
  ("Logic of collective action","concept","Political economy",
   "Mancur Olson's 1965 argument applying rational self-interest to politics — and why a purely rational person might not bother to vote.",
   "In 1965, economist Mancur Olson published an influential book called The Logic of Collective Action, which applied the homo economicus model to the political world.","William Rosalsky (narration)"),
 ],
 "118426": [
  ("Payday loan APR","figure","Consumer finance",
   "Payday loans carry annualized rates around 400% — far above even the priciest credit cards.",
   "The interest rates, on an annualized basis, can be in the neighborhood of 400 percent — much, much higher than even the most expensive credit cards.","Stephen Dubner (narration)"),
  ("Cycle of debt","concept","Consumer finance",
   "The industry's revenue leans on repeat borrowers: 75% of payday-loan fees come from people taking more than ten loans a year.",
   "75 percent of the industry’s fees come from borrowers who take out more than ten loans a year.","Stephen Dubner (narration), citing the CFPB"),
  ("Military Lending Act","fact","Policy",
   "A 2006 law capped the interest rate payday lenders can charge active-duty military and their dependents at 36% nationwide.",
   "in 2006 it passed the Military Lending Act, which, among other things, capped the interest rate that payday lenders can charge active personnel and their dependents at 36 percent nationwide.","Jonathan Zinman, economist"),
 ],
 "118094": [
  ("Ticket underpricing","concept","Market design",
   "Concert tickets are chronically priced below what the market will bear, so the gap becomes profit for scalpers rather than the artist.",
   "if an artist sells a ticket for 50 bucks, but the price at which that ticket clears the market is more like 500 bucks, there's $450 of profit that's going somewhere.","Eric Budish, economist"),
  ("Broadway flop rate","figure","Entertainment economics",
   "About 80% of Broadway shows never earn back their original investment.",
   "80 percent of shows do not pay back their original capitalization.","Jeffrey Seller, Broadway producer"),
  ("Ticket bots","fact","Technology",
   "At one point up to 70% of Hamilton's tickets were being bought by automated bots.",
   "up to 70 percent of our tickets were being purchased through automated bots.","Jeffrey Seller, Broadway producer"),
 ],
 "118056": [
  ("Female Fortune 500 CEOs","figure","Business",
   "An all-time high number of women running Fortune 500 firms still meant only 27 of 500 — about 5.4% — as of early 2018.",
   "Out of those 500 companies, there were, as of early 2018, 27 female C.E.O.s.","Stephen Dubner (narration)"),
  ("Glass cliff","concept","Management",
   "Women are more likely to be handed leadership in precarious moments — and once in charge, are disproportionately targeted: the gender effect alone raises activist-targeting likelihood 28%.",
   "the gender effect alone is responsible for a 28 percent increase in the likelihood that a firm experiences targeting from an activist.","Dan Shropshire, management scholar"),
  ("Think manager, think male","concept","Psychology",
   "A bias documented since the 1970s: people default to picturing a man when they picture a leader.",
   "This is a finding that’s been in the literature since the 1970s  and that’s called the “think manager, think male” association.","Michelle Ryan, psychologist"),
 ],
 "118503": [
  ("PASPA (1992)","fact","Law",
   "The 1992 federal law barring states from legalizing sports betting; the Supreme Court struck it down 6–3 in 2018.",
   "The justices voted 6-3 to strike down the 1992 federal law against gambling.","Victor Matheson (narration)"),
  ("Sports betting volume","figure","Economics",
   "Even before broad legalization, as much as $300 billion a year was estimated to be wagered on sports in the U.S.",
   "You might have as much as $300 billion being bet in the United States every year.","Victor Matheson, economist"),
  ("Fantasy winnings concentration","figure","Gambling",
   "Daily-fantasy payouts are extremely top-heavy: one baseball study found over 90% of winnings went to just over 1% of players.",
   "more than 90 percent of the winnings went to just over 1 percent of the players.","Stephen Dubner (narration)"),
 ],
 "112081": [
  ("Ketamine for depression","figure","Neuroscience",
   "A low, sub-anesthetic dose of ketamine can lift depression fast — with the largest effect seen ~72 hours after a single dose in early studies.",
   "In the early studies, actually 72 hours after a single dose was the largest effect on depression.","James Murrough, psychiatrist"),
  ("MDMA","fact","Pharmacology",
   "MDMA was first synthesized by Merck in 1912 — originally as an intermediate toward a drug to stop bleeding.",
   "MDMA was first synthesized by Merck in 1912, and it was originally supposed to be an intermediary compound towards making a drug that stops bleeding.","Rachel Yehuda, neuroscientist"),
  ("LSD","fact","Pharmacology",
   "The first synthetic hallucinogen, LSD, was discovered by Swiss chemist Albert Hofmann in 1938.",
   "The first synthetic hallucinogenic molecule, LSD, was discovered by the Swiss chemist Albert Hofmann in 1938.","Stephen Dubner (narration)"),
 ],
 "111907": [
  ("168 hours","concept","Time management",
   "A leveling fact everyone shares: the week holds the same 168 hours for the accomplished and the ordinary alike.",
   "this life that we lead with 168 hours a week, whether you're a mere mortal or somebody who's really accomplished, you get the same 168 hours.","Angela Duckworth, psychologist"),
  ("Self-efficacy modeling","concept","Psychology",
   "Children's belief in what they can achieve rises from watching a parent persist — self-efficacy is taught by example, not praise.",
   "that is increasing the self-efficacy of the child watching because you've shown what's possible.","Angela Duckworth, psychologist"),
 ],
 "132981": [
  ("Google ad dependence","figure","Media economics",
   "About 81% of Google's revenue comes from advertising on its own properties and in Search.",
   "About 81 percent of Google's revenue comes from advertising on its properties and in Search","Tim Hwang (narration)"),
  ("Search market share","figure","Market structure",
   "Google handles roughly 90% of global online search.",
   "As of today, Google handles about 90 percent of online global search activity.","Stephen Dubner (narration)"),
  ("Default-search payments","fact","Market structure",
   "Google pays Apple an estimated $15 billion a year to remain the default search engine on Safari.",
   "Google pays Apple an estimated $15 billion a year to be the default search engine on Safari.","Sridhar Ramaswamy (narration)"),
  ("Longest-running A/B test","fact","Technology",
   "A 1%-of-users 'no ads' holdout Google coded in 2000 kept running for years — reportedly the longest-running split A/B experiment on the internet.",
   "this is the longest-running split A/B experiment in the history of the internet.","Marissa Mayer, former Google executive"),
 ],
 "133879": [
  ("Government as insurer","concept","Public finance",
   "Most of what the federal government does is insurance — Social Security, Medicare, disaster relief — with defense as a sideline.",
   "The federal government is a giant insurance company with a sideline business in national defense.","Amy Finkelstein, economist (quoting Peter Fisher)"),
  ("Uninsured Americans","figure","Health economics",
   "The Affordable Care Act roughly halved the uninsured share, yet about 30 million Americans still lack health insurance.",
   "there's still 30 million Americans without health insurance.","Amy Finkelstein, economist"),
  ("Adverse selection","figure","Insurance",
   "People who buy life insurance are riskier than they look: over 12 years, those who died were nearly 20% more likely to have bought it than similar survivors.",
   "those who died were nearly 20 percent more likely to have bought life insurance relative to people who remained alive during the period","Amy Finkelstein, economist"),
 ],
 "139830": [
  ("National Origins Act (1924)","fact","History",
   "The 1924 law slashed U.S. immigration from about a million people a year to roughly 50,000 by the 1930s.",
   "By the 1930s, immigration had fallen from a million people a year to 50,000.","Stephen Dubner (narration)"),
  ("Immigrants and patents","figure","Innovation",
   "Immigrants are responsible for 36% of all U.S. patents and are 80% more likely than the native-born to start a business.",
   "Immigrants today are responsible for 36 percent of all patents in the U.S.","Zeke Hernandez, business professor"),
  ("Immigrant fiscal contribution","figure","Public finance",
   "A 2017 National Academies study estimated the net federal tax benefit of each immigrant at about $260,000 over decades.",
   "the net tax benefit of each immigrant, is, like, $260,000.","Stephen Dubner (narration)"),
  ("H-1B lottery","fact","Policy",
   "The skilled-worker H-1B visa is rationed by lottery: 85,000 slots a year against roughly 700,000 applicants.",
   "There are 85,000 slots every year.","Sindhu Mahadevan (narration)"),
 ],
 "142219": [
  ("Foreign ownership of the EPL","fact","Sports economics",
   "When the English Premier League launched in 1992, 21 of 22 teams had UK ownership; today only four of 20 are majority UK-owned.",
   "In 1992, when the English Premier League was launched, 21 of its 22 teams had U.K. ownership.","Rory Smith, sports journalist"),
  ("Sports as GDP strategy","figure","Sports economics",
   "Saudi Arabia is targeting roughly 3% of GDP from its sports economy — part of a Gulf pivot away from oil.",
   "somewhere around three percent of G.D.P. is what Saudi Arabia is looking for its sports economy to grow to.","Simon Chadwick, sports professor"),
  ("IPL streaming record","fact","Media",
   "In 2023 an Indian Premier League cricket match set the world record for the most simultaneous live streams of any event.",
   "in 2023, the world record for the most simultaneous live streams of an event was broken, for an Indian Premier League cricket match.","Simon Chadwick, sports professor"),
 ],
 "143286": [
  ("Drug repurposing","concept","Medicine",
   "Finding new uses for already-approved drugs — which costs roughly 1% of developing a new drug from scratch.",
   "It costs about 1 percent of the cost to develop a new drug, to repurpose a drug and find a new use for an old drug.","David Fajgenbaum, physician-researcher"),
  ("Untreated diseases","figure","Medicine",
   "There are ~18,000 known human diseases, but only about a quarter have an FDA-approved treatment.",
   "There are 18,000 known human diseases — but only about a quarter of them have an F.D.A.-approved treatment.","Grant Stone (narration)"),
  ("Cost of a new drug","figure","Pharmaceutical economics",
   "Developing a new drug costs roughly $1–2 billion and takes 10–15 years.",
   "It costs between $1 and $2 billion and it takes 10 to 15 years to create a new drug.","David Fajgenbaum, physician-researcher"),
  ("Advance market commitment","concept","Innovation policy",
   "A 'pull' funding tool: funders pre-commit to buy a product that doesn't exist yet. A $1.5B pneumococcal-vaccine AMC is credited with saving ~700,000 children.",
   "governments or foundations commit to buying a product that doesn't exist yet.","Christopher Snyder, economist"),
 ],
 "118317": [
  ("Active vs. index funds","figure","Investing",
   "Over a decade, between 71% and 93% of U.S. stock mutual funds either closed or failed to beat their index fund.",
   "between 71 and 93 percent of U.S. stock mutual funds either closed or failed to beat their closest index funds.","Stephen Dubner (narration), citing The Wall Street Journal"),
  ("Fees compound","figure","Investing",
   "A 2% fee vs. 0.04% doesn't look like much yearly, but over 50 years a dollar at 7% grows to ~$32 while a dollar at 5% grows to only ~$10.",
   "over 50 years, believe it or not, a dollar invested at 7 percent grows to around $32 and a dollar invested at five percent grows to about $10.","John Bogle, Vanguard founder"),
  ("Skill vs. luck (Fama-French)","concept","Investing",
   "Studying mutual-fund returns, Fama and French found only the top 2–3% of managers had enough skill to cover their costs.",
   "the top 2 to 3 percent had enough skill to cover their costs.","Kenneth French, economist"),
 ],
 "118765": [
  ("Board games vs. video games","figure","Media economics",
   "Americans spend about $1.6 billion a year on board games and puzzles versus $23.5 billion on video games — nearly $15 on video for every $1 on board games.",
   "Board-game and puzzle sales in the United States bring in about $1.6 billion a year.","Baba Brinkman (narration)"),
  ("Rock-paper-scissors bias","fact","Game theory",
   "People don't play randomly: in one large study, scissors was thrown only 29.6% of the time.",
   "scissors are 29.6 percent of the time, when they have been analyzed.","Tom Whipple, journalist"),
  ("Connect Four combinations","fact","Game theory",
   "Connect Four has about 4.5 trillion possible board combinations — yet the first player can force a win with perfect play.",
   "There are four and half trillion different combinations in Connect Four.","Tom Whipple, journalist"),
 ],
 "143140": [
  ("DSHEA (1994)","fact","Regulation",
   "The 1994 law that lightly regulates supplements; since then the number on the market grew from ~4,000 to 90,000, none with health-agency approval.",
   "since the passage of DSHEA in 1994, the number of supplements on the market has grown from around 4,000 to 90,000","Peter Attia (narration)"),
  ("Supplement label accuracy","figure","Consumer safety",
   "Where pharma versions contained 98–104% of the labeled dose, supplement versions ranged from under 2% to 110% — and a third were contaminated with bacteria.",
   "The supplement versions, meanwhile, ranged from less than two percent to 110 percent of the quantity listed on the label","Pieter Cohen, physician"),
  ("Brain-supplement market","figure","Consumer economics",
   "The brain-supplement segment has doubled over seven years and is projected to double again to roughly $25 billion a year.",
   "it has doubled over the past seven years, and it’s projected to double again in the next seven, to around $25 billion a year.","narration (Prevagen ad segment)"),
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
