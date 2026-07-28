import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fact Finder HQ",
  description:
    "Review headquarters for the Freakonomics Radio almanac — blind swipe review, browse, overlap stats, and a fact of the day.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

const nav = [
  { href: "/review", label: "Review" },
  { href: "/browse", label: "Browse" },
  { href: "/chat", label: "Chat" },
  { href: "/stats", label: "Stats" },
  { href: "/today", label: "Today" },
  { href: "/admin", label: "Team" },
];

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <header className="sticky top-0 z-40 border-b border-hair bg-[color-mix(in_srgb,var(--ground)_86%,transparent)] backdrop-blur-md">
          <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3 sm:px-6">
            <Link href="/" className="flex min-w-0 items-baseline gap-2 no-underline">
              <span className="font-serif text-lg font-bold tracking-tight text-ink">
                Fact&nbsp;Finder
              </span>
              <span className="eyebrow hidden sm:inline">HQ</span>
            </Link>
            <nav className="ml-auto flex items-center gap-1">
              {nav.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-lg px-2.5 py-1.5 text-sm text-muted no-underline hover:bg-surface-2 hover:text-ink sm:px-3"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-4 sm:px-6">{children}</main>
      </body>
    </html>
  );
}
