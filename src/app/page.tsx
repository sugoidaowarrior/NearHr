import Link from "next/link";
import { GridLines } from "@/components/GridLines";

const levels = [
  {
    n: "01",
    tag: "LEVEL 0",
    title: "Transparent",
    body: "Standard onchain payout to each employee's NEAR account. Cheap, instant, fully public.",
  },
  {
    n: "02",
    tag: "LEVEL 1",
    title: "Shielded",
    body: "Each payment lands in a one time stealth account (SIP Protocol). Only the recipient can claim it.",
  },
  {
    n: "03",
    tag: "LEVEL 2",
    title: "Compliant",
    body: "Shielded, plus a viewing key lets your auditor verify every payment without exposing who got paid.",
  },
];

const features = [
  {
    n: "01",
    title: "Google sign in",
    body: "Your private smart account is created the moment you log in. No seed phrases, no passphrases, nothing to set up.",
  },
  {
    n: "02",
    title: "NEAR + USDC payroll",
    body: "Import a CSV, validate it, and send a run to up to 50 employees in native NEAR or USDC.",
  },
  {
    n: "03",
    title: "Privacy in three levels",
    body: "Pick transparent, shielded or compliant per payment. Stealth addresses from SIP Protocol.",
  },
  {
    n: "04",
    title: "Employer audit",
    body: "A viewing key for your auditor verifies every payout. Encrypted email backup is optional, never compulsory.",
  },
];

export default function Home() {
  return (
    <main className="min-h-screen overflow-x-clip">
      <GridLines />

      {/* giant cropped word, mix-blend difference */}
      <div className="display-word" aria-hidden style={{ top: "16vh" }}>
        <span>NEARHR</span>
      </div>

      {/* nav */}
      <header className="page-above">
        <div className="mx-auto max-w-6xl px-5 py-6 sm:px-8">
          <div className="flex items-center justify-between border-b border-[var(--color-rule)] pb-5">
            <Link href="/" className="mono text-[13px] font-semibold tracking-tight">
              NEARHR<span className="text-[var(--color-accent)]">®</span>
            </Link>
            <nav className="flex items-center gap-5">
              <Link href="/login" className="sweep-link micro hidden font-medium sm:inline-block">
                Sign in <u />
              </Link>
              <Link href="/api/auth/google/start" className="btn btn-primary btn-sm">
                Get started
              </Link>
            </nav>
          </div>
        </div>
      </header>

      {/* hero, grid aligned */}
      <section className="page-above mx-auto max-w-6xl px-5 pt-16 sm:px-8 sm:pt-28">
        <div className="grid grid-cols-2 gap-5 md:grid-cols-12">
          <div className="col-span-2 md:col-span-8">
            <p className="mask-line eyebrow">
              <span className="mask-d1">Private payroll on NEAR Protocol</span>
            </p>
            <h1 className="mt-8">
              <span className="mask-line display">
                <span className="mask-d2">Pay your team.</span>
              </span>
              <span className="mask-line display">
                <span className="mask-d3 display-accent">Keep it private.</span>
              </span>
            </h1>
            <p className="fade-up d3 mt-10 max-w-xl text-[15px] leading-relaxed text-[var(--color-muted)]">
              Salaries and bonuses in NEAR or USDC, with privacy in three levels. Sign in
              with Google and your private wallet is created automatically. Pay up to 50
              people per run. No seed phrases. Nothing to set up.
            </p>
            <div className="fade-up d4 mt-10 flex flex-wrap items-center gap-4">
              <Link href="/api/auth/google/start" className="btn btn-primary">
                Open your wallet
              </Link>
              <Link href="/login" className="btn btn-ghost">
                I have an account
              </Link>
            </div>
          </div>
          <div className="col-span-2 hidden md:col-span-4 md:block">
            <div className="mt-24 flex h-full flex-col justify-end border-l border-[var(--color-rule)] pl-6">
              <div className="mono text-[11px] text-[var(--color-faint)]">
                SEASON 01
                <br />
                MINT 2026
                <br />
                NEAR PROTOCOL
              </div>
              <div className="mono mt-6 text-[11px] text-[var(--color-faint)]">
                50 EMPLOYEES PER RUN
                <br />
                3 PRIVACY LEVELS
                <br />
                2 ASSETS · NEAR / USDC
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* interlude band */}
      <section className="page-above band-ink mt-24 py-16 sm:mt-36 sm:py-24">
        <div className="mx-auto max-w-6xl px-5 sm:px-8">
          <div className="grid grid-cols-2 gap-6 md:grid-cols-12">
            <div className="col-span-2 md:col-span-8">
              <span className="interlude-word" aria-hidden>
                {"NEARHR".split("").map((ch, i) => (
                  <span key={i} className="letter" style={{ animationDelay: `${0.15 + i * 0.05}s` }}>
                    {ch}
                  </span>
                ))}
              </span>
              <p className="mt-8 max-w-md text-[14px] leading-relaxed text-[rgba(246,247,243,0.72)]">
                A payroll ledger built like a grid: every run, every payout, every
                employee, placed on a 12 column composition you can audit at a glance.
              </p>
            </div>
            <div className="col-span-2 hidden flex-col justify-end md:col-span-4 md:flex">
              <div className="mono text-right text-[11px] text-[rgba(246,247,243,0.55)]">
                01 / COMPOSITION
                <br />
                12 COLUMNS
                <br />
                HAIRLINE RULES
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* features, entry rows */}
      <section className="page-above mx-auto max-w-6xl px-5 py-24 sm:px-8 sm:py-36">
        <div className="mb-12 flex items-end justify-between">
          <h2 className="section-title">
            <span className="mono text-[var(--color-faint)]">A.</span> The system
          </h2>
          <span className="mono micro hidden text-[var(--color-faint)] sm:block">04 ENTRIES</span>
        </div>
        <div className="entry-group grid md:grid-cols-2 md:gap-x-12">
          {features.map((f) => (
            <div key={f.n} className="entry grid grid-cols-12 gap-3">
              <div className="col-span-2 md:col-span-1">
                <span className="entry-n">{f.n}</span>
              </div>
              <div className="col-span-10 md:col-span-4">
                <div className="text-[17px] font-semibold tracking-tight">{f.title}</div>
              </div>
              <div className="col-span-12 text-[13.5px] leading-relaxed text-[var(--color-muted)] md:col-span-6">
                {f.body}
              </div>
              <div className="col-span-12 entry-sweep md:col-span-1" />
            </div>
          ))}
        </div>
      </section>

      {/* privacy levels */}
      <section className="page-above band-ground py-24 sm:py-36">
        <div className="mx-auto max-w-6xl px-5 sm:px-8">
          <div className="mb-12 flex items-end justify-between">
            <h2 className="section-title">
              <span className="mono text-[var(--color-faint)]">B.</span> Privacy, in levels
            </h2>
            <span className="mono micro hidden text-[var(--color-faint)] sm:block">
              PER PAYMENT
            </span>
          </div>
          <div className="grid md:grid-cols-3">
            {levels.map((c, i) => (
              <div
                key={c.n}
                className={`card-2 glass-hover p-7 ${i < 2 ? "md:border-r" : ""}`}
              >
                <div className="flex items-center justify-between">
                  <span className="entry-n">{c.n}</span>
                  <span className="pill pill-green">{c.tag}</span>
                </div>
                <div className="mt-14 text-[28px] font-semibold uppercase tracking-tight">
                  {c.title}
                </div>
                <p className="mt-4 text-[13.5px] leading-relaxed text-[var(--color-muted)]">
                  {c.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* wallet preview */}
      <section className="page-above mx-auto max-w-6xl px-5 py-24 sm:px-8 sm:py-36">
        <div className="mb-12 flex items-end justify-between">
          <h2 className="section-title">
            <span className="mono text-[var(--color-faint)]">C.</span> Your account
          </h2>
          <span className="mono micro hidden text-[var(--color-faint)] sm:block">
            AUTO PROVISIONED
          </span>
        </div>
        <div className="hero-card">
          <div className="grid md:grid-cols-12">
            <div className="p-7 md:col-span-7 md:border-r md:border-[var(--color-rule)] md:p-10">
              <div className="eyebrow">Available balance</div>
              <div className="mt-4 text-[56px] font-semibold leading-none tracking-tight">
                0.00
                <span className="ml-3 text-[22px] text-[var(--color-faint)]">NEAR</span>
              </div>
              <div className="mt-2 text-[15px] text-[var(--color-muted)]">
                0.00 USDC
              </div>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <span className="mono border border-[var(--color-rule)] bg-white px-3 py-2 text-[12px] text-[var(--color-muted)]">
                  your 64 character NEAR address appears here
                </span>
                <span className="pill pill-green">created on first sign in</span>
              </div>
            </div>
            <div className="p-7 md:col-span-5 md:p-10">
              <div className="flex items-center gap-6">
                {["N", "$"].map((t, i) => (
                  <div key={t} className="flex items-center gap-3">
                    <div
                      className={`coin h-11 w-11 text-[15px] ${i === 0 ? "coin-lime" : "coin-blue"}`}
                    >
                      {t}
                    </div>
                    <div className="mono micro text-[var(--color-muted)]">
                      {i === 0 ? "NEAR" : "USDC"}
                      <br />
                      NATIVE · NEP141
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-10 grid grid-cols-3 gap-0 border border-[var(--color-rule)]">
                {[
                  ["50", "people per run"],
                  ["3", "privacy levels"],
                  ["2", "assets"],
                ].map(([n, l], i) => (
                  <div
                    key={l}
                    className={`p-4 text-center ${i < 2 ? "border-r border-[var(--color-rule)]" : ""}`}
                  >
                    <div className="text-[26px] font-semibold">{n}</div>
                    <div className="mt-1 text-[10.5px] uppercase tracking-widest text-[var(--color-faint)]">
                      {l}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* cta */}
      <section className="page-above mx-auto max-w-6xl px-5 pb-28 sm:px-8">
        <div className="grid md:grid-cols-12">
          <div className="col-span-12 md:col-span-10 md:col-start-2">
            <span className="mask-line display">
              <span className="mask-d1">Start paying</span>
            </span>
            <span className="mask-line display">
              <span className="mask-d2">in the green.</span>
            </span>
            <div className="fade-up d4 mt-10 flex flex-wrap gap-4">
              <Link href="/api/auth/google/start" className="btn btn-primary">
                Open your wallet
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* footer */}
      <footer className="page-above border-t border-[var(--color-rule)]">
        <div className="mx-auto max-w-6xl px-5 py-10 sm:px-8">
          <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
            <div>
              <div className="mono text-[13px] font-semibold">
                NEARHR<span className="text-[var(--color-accent)]">®</span>
              </div>
              <div className="micro mt-3 text-[var(--color-faint)]">
                NEAR Protocol · SIP stealth addresses · custodial smart accounts
                <br />
                Deep ZK privacy rides NEAR Intents, a rail with past compliance
                pauses. This build uses onchain stealth accounts instead.
              </div>
            </div>
            <div className="mono micro text-[var(--color-faint)]">
              DESIGN IN THE GRID
              <br />© 2026 NEARHR
            </div>
          </div>
        </div>
      </footer>
    </main>
  );
}
