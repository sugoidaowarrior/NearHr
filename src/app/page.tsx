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

function CheckList({ rows }: { rows: [string, string][] }) {
  return (
    <div className="check-grid">
      {rows.map(([t, b]) => (
        <div key={t} className="check-item">
          <span className="check-dot" />
          <div>
            <div className="text-[15px] font-bold tracking-tight">{t}</div>
            <p className="mt-1 text-[13.5px] leading-relaxed text-[var(--color-muted)]">{b}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

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
          <Link href="#borders" className="nav-link hidden sm:inline-block">
            Across borders
          </Link>
          <Link href="#payroll" className="nav-link hidden sm:inline-block">
            Payroll
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
        <span className="landing-kicker">HR and Payroll on NEAR Protocol</span>
        <h1 className="mx-auto mt-4 max-w-4xl font-[var(--font-display)] text-[clamp(44px,7vw,84px)] font-bold leading-[0.98] tracking-[-0.04em]">
          <span className="mask-line display">
            <span className="mask-d2">Pay your team</span>
          </span>
          <span className="mask-line display">
            <span className="mask-d3 display-grad">across borders.</span>
          </span>
        </h1>
        <p className="landing-lead mx-auto max-w-2xl">
          We make HR and payroll work across borders. Streamline your payroll tasks and workflows
          to manage your local and global team, run payroll on time in multiple currencies, and
          keep every receipt on NEAR mainnet. HR and payroll, made easy.
        </p>
        <div className="fade-up d4 mt-9 flex flex-wrap items-center justify-center gap-4">
          <Link href="/api/auth/google/start" className="btn btn-primary">
            Book a demo
          </Link>
          <Link href="/login" className="btn btn-ghost">
            I have an account
          </Link>
        </div>
        <div className="hero-photo fade-up d5">
          <img src="/img/hr-dashboard.svg" alt="NearHr dashboard: next payroll, total salary in Naira, salary history chart and recent payouts" />
          <div className="chip c1">
            <span className="chip-dot ok" />
            <div>
              <b>Payday executed</b>
              <span>50 people · NEAR + USDC.e</span>
            </div>
          </div>
          <div className="chip c2">
            <div>
              <b>Privacy level</b>
              <span>shielded · SIP stealth</span>
            </div>
            <span className="chip-badge">3</span>
          </div>
          <div className="chip c3">
            <span className="chip-ico">✓</span>
            <div>
              <b>₦12,480,000 sent</b>
              <span>receipt on NEAR mainnet</span>
            </div>
          </div>
        </div>
      </section>

      {/* trusted band */}
      <section className="trusted-band">
        <span>Lagos</span><span>London</span><span>Austin</span><span>Nairobi</span><span>Berlin</span><span>Tokyo</span><span>Sydney</span>
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

      {/* across borders */}
      <section id="borders" className="landing-section">
        <div className="mx-auto max-w-3xl text-center">
          <div className="landing-kicker">Putting your business ahead</div>
          <h2 className="landing-h2">One payroll run, every time zone.</h2>
          <p className="landing-lead mx-auto">
            Streamline your HR and payroll tasks and workflows to efficiently manage your local
            and global team. Run payroll on time in multiple currencies, convert at a live rate,
            and settle in NEAR or USDC.e. It is HR and payroll made easy, wherever your business
            takes you.
          </p>
        </div>
        <img src="/img/hr-global.svg" className="mock" alt="Global payroll map: payments flowing from Lagos to teams in Austin, London, Nairobi, Berlin, Tokyo and Sydney" />
      </section>

      {/* employee payroll */}
      <section id="payroll" className="landing-section">
        <div className="mx-auto max-w-3xl text-center">
          <div className="landing-kicker">Employee payroll</div>
          <h2 className="landing-h2">Payroll tools that bend, not break.</h2>
          <p className="landing-lead mx-auto">
            No matter your use case or internal process, NearHr delivers a fulfilling pay to your
            people on time, with an automated payslip and a receipt on NEAR mainnet for every run.
          </p>
        </div>
        <CheckList
          rows={[
            ["Multi currency pay", "Run payroll in Naira, dollars or stablecoins and settle in NEAR or USDC.e at a live rate."],
            ["Custom schedules", "Monthly, weekly or one off bonuses. Set the cadence that fits your operations."],
            ["Split payroll", "Send part of a salary to one account and the rest elsewhere, with no transfer fees."],
          ]}
        />
        <img src="/img/hr-payslip.svg" className="mock" alt="Automated payslip for Ada Okoye: base salary and bonus in NEAR, net paid in Naira, receipt on NEAR mainnet" />
      </section>

      {/* people first */}
      <section className="landing-section">
        <div className="mx-auto max-w-3xl text-center">
          <div className="landing-kicker">Employee benefits</div>
          <h2 className="landing-h2">Put your people front and center.</h2>
          <p className="landing-lead mx-auto">
            It takes more than a salary. NearHr keeps your team directory, pay day and last paid
            amount in one place, and reminds you when someone is still waiting on their pay.
          </p>
        </div>
        <CheckList
          rows={[
            ["Team directory", "Every person with wallet, salary, pay day and privacy level at a glance."],
            ["Pay day reminders", "Set the date once and NearHr flags anyone still unpaid after the run."],
            ["Audit viewing key", "Share a read only key so an auditor verifies payouts without exposing funds."],
          ]}
        />
        <img src="/img/hr-directory.svg" className="mock" alt="Team directory: eight people as tiles with privacy rings, filter pills and an audit viewing key panel" />
      </section>

      {/* how it pays */}
      <section id="how" className="landing-section">
        <div className="mx-auto max-w-3xl text-center">
          <div className="landing-kicker">How it pays</div>
          <h2 className="landing-h2">From a spreadsheet to the chain in three steps.</h2>
        </div>
        <div className="step-grid">
          {steps.map(([t, b], i) => (
            <div key={t} className="step-card">
              <div className="step-num">{i + 1}</div>
              <div className="text-[16px] font-bold tracking-tight">{t}</div>
              <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--color-muted)]">{b}</p>
            </div>
          ))}
        </div>
        <img src="/img/flow.svg" className="mock" alt="Payroll in three steps: import, validate, payout" />
      </section>

      {/* privacy levels */}
      <section id="privacy" className="landing-section">
        <div className="mx-auto max-w-3xl text-center">
          <div className="landing-kicker">Privacy, in levels</div>
          <h2 className="landing-h2">Choose how private each payday is.</h2>
        </div>
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
        <div className="mx-auto mt-16 max-w-3xl text-center">
          <div className="landing-kicker">The ledger</div>
          <h2 className="landing-h2">Every payout, recorded and auditable.</h2>
          <p className="landing-lead mx-auto">
            The dashboard keeps a running ledger of each run and each payment, with status, asset
            and a link back to the onchain transaction. Your auditor gets a viewing key; your team
            stays private.
          </p>
        </div>
        <img src="/img/ledger.svg" className="mock" alt="Payout ledger with recent payroll entries" />
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
