import Link from "next/link";
import { GlassRing } from "@/components/GlassRing";

const levels = [
  {
    tag: "LEVEL 0",
    tagClass: "pill-muted",
    coin: "coin-slate",
    title: "Transparent",
    body: "Standard onchain payout to each employee's NEAR account. Cheap, instant, fully public.",
  },
  {
    tag: "LEVEL 1",
    tagClass: "pill-green",
    coin: "coin-lime",
    title: "Shielded",
    body: "Each payment lands in a one time stealth account (SIP Protocol). Only the recipient can claim it.",
  },
  {
    tag: "LEVEL 2",
    tagClass: "pill-magenta",
    coin: "coin-magenta",
    title: "Compliant",
    body: "Shielded, plus a viewing key lets your auditor verify every payment — without exposing who got paid.",
  },
];

export default function Home() {
  return (
    <main className="min-h-screen overflow-x-clip">
      <div className="aurora" />
      <GlassRing />

      {/* floating coins */}
      <div className="coin-float-layer pointer-events-none fixed inset-0 -z-[0]" aria-hidden>
        <div className="coin coin-lime coin-ring float absolute left-[3%] top-[12%] h-14 w-14 opacity-60">
          N
        </div>
        <div className="coin coin-magenta coin-ring float-slow absolute right-[4%] top-[26%] h-11 w-11 opacity-50">
          U
        </div>
        <div className="coin coin-yellow coin-ring float absolute left-[5%] bottom-[14%] h-9 w-9 opacity-40" style={{ animationDelay: "1.4s" }}>
          ₮
        </div>
        <div className="coin coin-blue coin-ring float-slow absolute right-[6%] bottom-[20%] h-12 w-12 opacity-40" style={{ animationDelay: "0.8s" }}>
          $
        </div>
      </div>

      <header className="relative z-10">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-6">
          <div className="flex items-center gap-3">
            <div className="coin coin-lime coin-ring h-9 w-9 text-sm">N</div>
            <div className="text-lg font-bold tracking-tight">
              Near<span className="text-[var(--accent)]">Hr</span>
            </div>
          </div>
          <nav className="flex items-center gap-3">
            <Link
              href="/api/auth/google/start"
              className="btn btn-ghost hidden !py-2 text-sm sm:inline-flex"
            >
              Sign in
            </Link>
            <Link href="/api/auth/google/start" className="btn btn-primary !py-2 text-sm">
              Get started
            </Link>
          </nav>
        </div>
      </header>

      {/* hero */}
      <section className="relative z-10 mx-auto max-w-5xl px-6 pt-14 pb-20 sm:pt-24">
        <div className="fade-up pill pill-green">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] pulse-dot" />
          Private payroll on NEAR Protocol
        </div>
        <h1 className="fade-up d1 display mt-6">
          Pay your team.
          <br />
          <span className="display-accent">Keep it private.</span>
        </h1>
        <p className="fade-up d2 mt-6 max-w-2xl text-lg leading-relaxed text-[var(--muted)]">
          Salaries and bonuses in NEAR or USDC, with privacy in three levels. Sign in with
          Google and your private wallet is created automatically. Pay up to 50 people per run.
          No seed phrases. No passphrases. Nothing to set up.
        </p>
        <div className="fade-up d3 mt-9 flex flex-wrap items-center gap-4">
          <Link href="/api/auth/google/start" className="btn btn-primary !px-7 !py-3.5 !text-[15px]">
            Open your wallet
          </Link>
          <Link href="/login" className="btn btn-ghost !px-7 !py-3.5 !text-[15px]">
            I have an account
          </Link>
        </div>
        <div className="fade-up d4 mt-10 flex flex-wrap gap-x-8 gap-y-3 text-[13px] text-[var(--muted-2)]">
          <span>✓ Google sign in, wallet in seconds</span>
          <span>✓ NEAR + USDC payouts</span>
          <span>✓ Optional encrypted email backup</span>
        </div>
      </section>

      {/* wallet preview card */}
      <section className="relative z-10 mx-auto max-w-5xl px-6 pb-24">
        <div className="glass hero-card sheen glow fade-up d3 mx-auto max-w-3xl p-8 sm:p-10">
          <div className="relative">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-[13px] font-medium text-[var(--muted)]">
                  Available balance
                </div>
                <div className="mt-1 text-5xl font-bold tracking-tight text-white">
                  0.00
                  <span className="ml-2 text-xl font-semibold text-[var(--muted)]">NEAR</span>
                </div>
                <div className="mt-2 text-sm text-[var(--muted)]">
                  0.00 USDC
                </div>
              </div>
              <div className="coin-stack flex">
                <div className="coin coin-lime coin-ring h-9 w-9 text-xs">N</div>
                <div className="coin coin-blue coin-ring h-9 w-9 text-xs">$</div>
                <div className="coin coin-magenta coin-ring h-9 w-9 text-xs">S</div>
              </div>
            </div>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <span className="mono rounded-xl border border-[var(--line)] bg-black/30 px-3 py-1.5 text-[13px] text-[var(--muted)]">
                your 64 character NEAR address appears here
              </span>
              <span className="pill pill-green">auto created on login</span>
            </div>
            <div className="mt-6 grid grid-cols-3 gap-3 border-t border-[var(--line)] pt-6 text-center">
              {[
                ["50", "people per run"],
                ["3", "privacy levels"],
                ["2", "assets: NEAR · USDC"],
              ].map(([n, l]) => (
                <div key={l}>
                  <div className="text-2xl font-bold text-white">{n}</div>
                  <div className="mt-1 text-[12px] text-[var(--muted-2)]">{l}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* privacy levels */}
      <section className="relative z-10 mx-auto max-w-5xl px-6 pb-24">
        <div className="fade-up flex items-end justify-between">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">
              Privacy, in levels you choose
            </h2>
            <p className="mt-2 text-[var(--muted)]">
              Every payroll run picks its own level, per payment, not per company.
            </p>
          </div>
        </div>
        <div className="mt-8 grid gap-5 md:grid-cols-3">
          {levels.map((c, i) => (
            <div key={c.title} className={`glass glass-hover fade-up d${i + 1} p-6`}>
              <div className="flex items-center justify-between">
                <span className={`pill ${c.tagClass}`}>{c.tag}</span>
                <div className={`coin ${c.coin} coin-ring h-10 w-10 text-sm`}>
                  {c.title[0]}
                </div>
              </div>
              <div className="mt-4 text-xl font-semibold">{c.title}</div>
              <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">{c.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* footer */}
      <footer className="relative z-10 border-t border-[var(--line)] py-8 text-center text-xs text-[var(--muted-2)]">
        NearHr · NEAR Protocol · SIP stealth addresses · custodial smart accounts
        <div className="mt-2">
          <span className="text-amber-300/70">
            Note: deep ZK privacy rides NEAR Intents, a rail with past compliance pauses. The MVP
            uses onchain stealth accounts instead.
          </span>
        </div>
      </footer>
    </main>
  );
}
