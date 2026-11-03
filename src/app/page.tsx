import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      <header className="border-b border-zinc-800">
        <div className="mx-auto max-w-5xl px-6 py-5 flex items-center justify-between">
          <div className="text-lg font-semibold tracking-tight">
            Hush<span className="text-emerald-400">Pay</span>
            <span className="ml-3 text-xs font-normal text-zinc-500">private payroll on NEAR</span>
          </div>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/dashboard" className="text-zinc-400 hover:text-zinc-200">Payroll runs</Link>
            <Link
              href="/api/auth/google/start"
              className="rounded-lg bg-emerald-500 px-4 py-1.5 font-medium text-zinc-950 hover:bg-emerald-400"
            >
              Sign in with Google
            </Link>
          </nav>
        </div>
      </header>

      <section className="mx-auto max-w-5xl px-6 py-20">
        <h1 className="text-5xl font-bold tracking-tight leading-tight">
          Payroll that stays <span className="text-emerald-400">private</span>.
          <br />
          Your people, your terms.
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-zinc-400">
          HushPay pays salaries and bonuses on NEAR Protocol with optional privacy, in three
          levels. Log in with Google, back up with a second email, and pay up to 50 people per
          run — in NEAR or USDC.
        </p>
        <div className="mt-8 flex gap-4">
          <Link
            href="/api/auth/google/start"
            className="rounded-lg bg-emerald-500 px-6 py-3 font-medium text-zinc-950 hover:bg-emerald-400"
          >
            Get started
          </Link>
          <Link href="/dashboard" className="rounded-lg border border-zinc-700 px-6 py-3 text-zinc-300 hover:border-zinc-500">
            See a payroll run
          </Link>
        </div>

        <div className="mt-16 grid gap-6 md:grid-cols-3">
          {[
            {
              title: "Transparent",
              body: "Standard on-chain payout to each employee's NEAR account. Cheap, instant, fully public.",
              tag: "level 0",
            },
            {
              title: "Shielded",
              body: "Each payment lands in a one-time stealth account (SIP Protocol). The recipient can't be linked to the employee — only they can claim it.",
              tag: "level 1",
            },
            {
              title: "Compliant",
              body: "Shielded, plus a viewing key lets your auditor verify every payment was made — without exposing who got paid.",
              tag: "level 2",
            },
          ].map((c) => (
            <div key={c.title} className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6">
              <div className="text-xs uppercase tracking-wider text-emerald-400">{c.tag}</div>
              <div className="mt-2 font-semibold text-lg">{c.title}</div>
              <p className="mt-2 text-sm text-zinc-400">{c.body}</p>
            </div>
          ))}
        </div>

        <div className="mt-12 rounded-2xl border border-amber-900/50 bg-amber-950/20 p-5 text-sm text-amber-200/80">
          <strong className="text-amber-200">Honest risk note.</strong> The deeper privacy upgrade
          (full ZK shielded pool) routes through NEAR Intents — a centralized rail whose
          compliance layer has paused funds before (July &amp; October 2026). MVP uses
          on-chain stealth accounts, so your funds are never held by a third party — but
          privacy is weaker (sender is visible). Read the README before going live.
        </div>
      </section>

      <footer className="border-t border-zinc-800 py-8 text-center text-xs text-zinc-600">
        HushPay MVP · NEAR Protocol · SIP stealth addresses · custodial smart accounts
      </footer>
    </main>
  );
}
