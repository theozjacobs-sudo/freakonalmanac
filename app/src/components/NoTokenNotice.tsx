export default function NoTokenNotice({ invalid }: { invalid?: boolean }) {
  return (
    <div className="mx-auto my-16 max-w-lg rounded-2xl border border-hair bg-surface p-6 text-center shadow-card">
      <p className="eyebrow">Reviewer link needed</p>
      <h2 className="mt-1 font-serif text-2xl font-bold text-ink">
        {invalid ? "That link doesn’t look right" : "Who’s reviewing?"}
      </h2>
      <p className="mt-3 text-sm text-muted">
        {invalid
          ? "The reviewer code in your link wasn’t recognized. It may have been mistyped or changed."
          : "This page needs your personal reviewer link — it ends with something like "}
        {!invalid && (
          <code className="font-mono text-[0.85em]">?r=yourname-a1b2c3d4</code>
        )}
        {!invalid && "."}
      </p>
      <p className="mt-3 text-sm text-muted">
        <b className="font-semibold text-ink">Ask Theo for your link</b> and open it
        once — this device will remember you afterwards.
      </p>
    </div>
  );
}
