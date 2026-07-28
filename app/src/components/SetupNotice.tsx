export default function SetupNotice() {
  return (
    <div className="mx-auto my-16 max-w-lg rounded-2xl border border-hair bg-surface p-6 shadow-card">
      <p className="eyebrow">Setup needed</p>
      <h2 className="mt-1 font-serif text-2xl font-bold text-ink">
        Supabase isn&rsquo;t connected yet
      </h2>
      <p className="mt-2 text-sm text-muted">
        The app can&rsquo;t reach its database. Set{" "}
        <code className="font-mono text-[0.85em]">SUPABASE_URL</code> and{" "}
        <code className="font-mono text-[0.85em]">SUPABASE_SERVICE_ROLE_KEY</code>{" "}
        in the environment (see <code className="font-mono text-[0.85em]">app/README.md</code>:
        run <code className="font-mono text-[0.85em]">supabase/schema.sql</code>, seed the
        entries, then restart / redeploy).
      </p>
    </div>
  );
}
