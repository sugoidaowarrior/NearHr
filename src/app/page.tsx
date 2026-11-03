import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";

const features = [
  {
    title: "Google sign in",
    body: "Your private smart account is created the moment you log in. No seed phrases, no passphrases, nothing to set up.",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="5" width="18" height="14" rx="3" />
        <path d="M8 12l2.5 2.5L16 9" />
      </svg>
    ),
  },
  {
    title: "NEAR and USDC payroll",
    body: "Import a CSV, validate it, and send a run to up to 50 employees in native NEAR or USDC.e.",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
        <path d="M9 8h6M9 12h6" />
      </svg>
    ),
  },
  {
    title: "Privacy in three levels",
    body: "Pick transparent, shielded or compliant per payment. Stealth addresses from SIP Protocol.",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />
        <path d="M9 12l2 2 4-4" />
      </svg>
    ),
  },
  {
    title: "Employer audit",
    body: "A viewing key lets your auditor verify every payout. Encrypted email backup is optional, never compulsory.",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="11" cy="11" r="6" />
        <path d="M20 20l-4.5-4.5M8 11h6M11 8v6" />
      </svg>
    ),
  },
  {
    title: "Swap on mainnet",
    body: "Move between NEAR and USDC.e at a live Ref Finance rate, executed straight from your wallet.",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M7 8h13l-3-3M17 16H4l3 3" />
      </svg>
    ),
  },
  {
    title: "Payday reminders",
    body: "Set a pay day and NearHr tracks who is due, flags overdue runs, and nudges your team by email.",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.7 21a2 2 0 0 1-3.4 0" />
      </svg>
    ),
  },
];

const stats = [
  ["50", "people per payroll run"],
  ["3", "privacy levels"],
  ["2", "assets · NEAR and USDC.e"],
  ["100%", "on NEAR mainnet"],
];

const steps = [
  ["Import", "Drop a CSV of your team or add people one by one. Wallet and salary, per person."],
  ["Validate", "NearHr checks every wallet, amount and privacy level before anything touches the chain."],
  ["Pay out", "One batch sends up to 50 payments in NEAR or USDC.e, and the ledger records each one."],
];

export default function Home() {
  return (
    <main className="min-h-screen overflow-x-clip">
      {/* nav */}
      <header className="landing-nav">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-gradient-to-br from-[#4d65ff] to-[#0082f3] text-sm font-extrabold text-white">
            N
          </span>
          <span className="text-[15px] font-bold tracking-tight">NearHr</span>
        </Link>
        <nav className="flex items-center gap-6">
          <Link href="#system" className="nav-link hidden sm:inline-block">
            System
          </Link>
          <Link href="#how" className="nav-link hidden sm:inline-block">
            How it pays
          </Link>
          <Link href="#privacy" className="nav-link hidden sm:inline-block">
            Privacy
          </Link>
          <Link href="/login" className="nav-link">
            Sign in
          </Link>
          <ThemeToggle compact />
          <Link href="/api/auth/google/start" className="btn btn-primary btn-sm">
            Get started
          </Link>
        </nav>
      </header>

      {/* hero */}
      <section className="landing-hero">
        <span className="landing-kicker">Private payroll on NEAR Protocol</span>
        <h1 className="mx-auto mt-4 max-w-4xl font-[var(--font-display)] text-[clamp(44px,7vw,84px)] font-bold leading-[0.98] tracking-[-0.04em]">
          <span className="mask-line display">
            <span className="mask-d2">Pay your team.</span>
          </span>
          <span className="mask-line display">
            <span className="mask-d3 display-grad">Keep it private.</span>
          </span>
        </h1>
        <p className="landing-lead mx-auto max-w-2xl">
          Salaries and bonuses in NEAR or USDC.e with privacy in three levels. Sign in with
          Google and your private wallet is created automatically. Pay up to 50 people per
          run, no seed phrases, nothing to set up.
        </p>
        <div className="fade-up d4 mt-9 flex flex-wrap items-center justify-center gap-4">
          <Link href="/api/auth/google/start" className="btn btn-primary">
            Open your wallet
          </Link>
          <Link href="/login" className="btn btn-ghost">
            I have an account
          </Link>
        </div>
        <div className="fade-up d5 mt-14">
          <img src="/img/hero-payment.svg" alt="Payroll payout flow from employer to team" className="hero-art" />
        </div>
      </section>

      {/* stat band */}
      <section className="stat-band">
        <div className="row">
          {stats.map(([n, cap]) => (
            <div key={cap}>
              <div className="num display-grad">{n}</div>
              <div className="cap">{cap}</div>
            </div>
          ))}
        </div>
      </section>

      {/* system */}
      <section id="system" className="landing-section">
        <div className="landing-kicker">The system</div>
        <h2 className="landing-h2">Everything a payroll run needs, in one place.</h2>
        <div className="feature-grid">
          {features.map((f) => (
            <div key={f.title} className="feature-card">
              <div className="feature-ico">{f.icon}</div>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* how it pays */}
      <section id="how" className="landing-section">
        <div className="split">
          <div>
            <div className="landing-kicker">How it pays</div>
            <h2 className="landing-h2">From a spreadsheet to the chain in three steps.</h2>
            <div className="mt-8 flex flex-col gap-5">
              {steps.map(([t, b], i) => (
                <div key={t} className="flex gap-4">
                  <div className="grid h-9 w-9 flex-none place-items-center rounded-[10px] border border-[rgba(77,101,255,0.4)] bg-[rgba(77,101,255,0.12)] font-bold text-[#8fa0ff]">
                    {i + 1}
                  </div>
                  <div>
                    <div className="text-[16px] font-bold tracking-tight">{t}</div>
                    <p className="mt-1 text-[13.5px] leading-relaxed text-[var(--color-muted)]">{b}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <img src="/img/flow.svg" alt="Payroll in three steps: import, validate, payout" className="art" />
          </div>
        </div>
      </section>

      {/* privacy levels */}
      <section id="privacy" className="landing-section">
        <div className="landing-kicker">Privacy, in levels</div>
        <h2 className="landing-h2">Choose how private each payday is.</h2>
        <div className="feature-grid mt-10">
          {[
            ["01", "Transparent", "Standard onchain payout to each employee account. Cheap, instant, fully public."],
            ["02", "Shielded", "Each payment lands in a one time stealth account. Only the recipient can claim it."],
            ["03", "Compliant", "Shielded, plus a viewing key lets your auditor verify every payment without exposing who got paid."],
          ].map(([n, title, body]) => (
            <div key={title} className="feature-card">
              <div className="flex items-center justify-between">
                <span className="mono text-xs text-[var(--color-faint)]">LEVEL {n}</span>
                <span className="pill pill-green">{title.toUpperCase()}</span>
              </div>
              <h3 className="mt-4 text-[22px]">{title}</h3>
              <p className="mt-3 text-[13.5px] leading-relaxed text-[var(--color-muted)]">{body}</p>
            </div>
          ))}
        </div>
        <div className="split mt-20">
          <div>
            <img src="/img/ledger.svg" alt="Payout ledger with recent payroll entries" className="art" />
          </div>
          <div>
            <div className="landing-kicker">The ledger</div>
            <h2 className="landing-h2">Every payout, recorded and auditable.</h2>
            <p className="landing-lead">
              The dashboard keeps a running ledger of each run and each payment, with status,
              asset and a link back to the onchain transaction. Your auditor gets a viewing
              key; your team stays private.
            </p>
          </div>
        </div>
        <div className="split mt-20">
          <div>
            <div className="landing-kicker">The team</div>
            <h2 className="landing-h2">Know who is paid, and who is due.</h2>
            <p className="landing-lead">
              A directory of your people with wallet, salary, pay day and last paid amount.
              Set reminders and NearHr flags anyone still waiting on their pay.
            </p>
          </div>
          <div>
            <img src="/img/team.svg" alt="Employee directory with privacy levels" className="art" />
          </div>
        </div>
      </section>

      {/* cta */}
      <section className="landing-section">
        <div className="landing-cta">
          <div className="landing-kicker">Mainnet ready</div>
          <h2 className="mx-auto mt-3 max-w-2xl font-[var(--font-display)] text-[clamp(30px,4vw,52px)] font-bold leading-tight tracking-[-0.03em]">
            Start paying your team on NEAR today.
          </h2>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link href="/api/auth/google/start" className="btn btn-primary">
              Open your wallet
            </Link>
            <Link href="/login" className="btn btn-ghost !border-white/25 !text-white hover:!border-white/60 hover:!bg-white/10 hover:!text-white">
              Sign in
            </Link>
          </div>
        </div>
      </section>

      {/* footer */}
      <footer className="landing-footer">
        <div className="flex items-center gap-2.5">
          <span className="grid h-7 w-7 place-items-center rounded-[9px] bg-gradient-to-br from-[#4d65ff] to-[#0082f3] text-xs font-extrabold text-white">
            N
          </span>
          <span className="font-bold text-[var(--color-ink)]">NearHr</span>
        </div>
        <span>NEAR Protocol · SIP stealth addresses · custodial smart accounts</span>
        <span>© 2026 NearHr</span>
      </footer>
    </main>
  );
}
