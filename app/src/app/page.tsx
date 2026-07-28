import Link from "next/link";

const cards = [
  {
    href: "/review",
    title: "Review",
    desc: "The swipe deck. Keep or reject, one entry at a time — blind, no peeking at anyone else's calls.",
    k: "01",
  },
  {
    href: "/browse",
    title: "Browse",
    desc: "Every entry as cards or a sortable table — search, filter, and download the current view as CSV.",
    k: "02",
  },
  {
    href: "/stats",
    title: "Stats",
    desc: "Progress per reviewer, keep rates, and the overlap report: what did we independently agree on?",
    k: "03",
  },
  {
    href: "/today",
    title: "Fact of the Day",
    desc: "One kept entry, chosen by the calendar. A daily taste of the almanac.",
    k: "04",
  },
];

export default function Home() {
  return (
    <div className="py-10 sm:py-16">
      <p className="eyebrow">A Freakonomics Radio reference &middot; review HQ</p>
      <h1 className="mt-2 font-serif text-4xl font-bold leading-none tracking-tight text-ink sm:text-6xl">
        Fact Finder HQ
      </h1>
      <p className="mt-4 max-w-[60ch] text-lg text-muted">
        Ten years of transcripts, mined into almanac entries — every one tied to
        a verbatim quote, a speaker, and an episode. This is where the
        candidates get judged: <b className="font-semibold text-ink">two separate assessments</b>,
        then we compare the overlap.
      </p>

      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        {cards.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="group rounded-2xl border border-hair bg-surface p-5 no-underline shadow-card transition-transform hover:-translate-y-0.5"
          >
            <span className="eyebrow">{c.k}</span>
            <h2 className="mt-1 font-serif text-2xl font-bold text-ink group-hover:text-accent">
              {c.title}
            </h2>
            <p className="mt-1.5 text-sm text-muted">{c.desc}</p>
          </Link>
        ))}
      </div>

      <p className="mt-10 text-sm text-faint">
        Reviewing? Open your personal link (it looks like{" "}
        <code className="font-mono text-[0.85em]">/review?r=yourname-XXXXXXXX</code>) —
        ask Theo if you don&rsquo;t have one.
      </p>
    </div>
  );
}
