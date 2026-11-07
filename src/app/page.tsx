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
    body: "Import a CSV, validate it, and send a run to up to 50 employees in native NEAR or USDC. Every payout is a real onchain transfer.",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
        <path d="M9 8h6M9 12h6" />
      </svg>
    ),
  },
  {
    title: "Crypto invoices",
    body: "Bill a client in NEAR or USDC and send them a pay link. They pay in the exact token you chose, straight from their own wallet.",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="4" y="3" width="16" height="18" rx="2" />
        <path d="M8 7h8M8 11h8M8 15h5" />
      </svg>
    ),
  },
  {
    title: "Wallet popup pay",
    body: "Meteor and HERE open right from the pay page. The client signs, approves, and the chain confirms the exact amount before the invoice closes.",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="2" y="6" width="20" height="13" rx="3" />
        <path d="M2 10h20" />
        <circle cx="17" cy="14" r="1.4" />
      </svg>
    ),
  },
  {
    title: "Trustless settlement",
    body: "The server reads the chain, not the client. An invoice only flips to paid once your vault is provably credited the exact amount.",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" />
        <path d="M9 12l2 2 4-4" />
      </svg>
    ),
  },
  {
    title: "PDF payroll statement",
    body: "Pick a date range and download a signed PDF of every payroll run and settled invoice, each with its NEAR transaction for your auditor.",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6M9 13h6M9 17h4" />
      </svg>
    ),
  },
];

const stats = [
  ["50", "people per payroll run"],
  ["1", "onchain receipt per payment"],
  ["2", "assets on every invoice · NEAR or USDC"],
  ["100%", "settled on NEAR"],
  ["PDF", "payroll statement, on demand"],
];

const steps = [
  ["Import", "Drop a CSV of your team or add people one by one. Wallet and salary, per person."],
  ["Validate", "NearHr checks every wallet and amount before anything touches the chain."],
  ["Pay out", "One batch sends up to 50 payments in NEAR or USDC, and the ledger records each one."],
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
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/img/nearhr-logo-crop.png" alt="NearHr" className="h-8 w-auto rounded-lg object-contain" />
        </Link>
        <nav className="flex items-center gap-6">
          <Link href="#system" className="nav-link hidden sm:inline-block">
            System
          </Link>
          <Link href="#payroll" className="nav-link hidden sm:inline-block">
            Payroll
          </Link>
          <Link href="#invoices" className="nav-link hidden sm:inline-block">
            Invoices
          </Link>
          <Link href="/docs" className="nav-link hidden sm:inline-block">
            Docs
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
        <span className="landing-kicker">HR and payroll on NEAR Protocol</span>
        <h1 className="mx-auto mt-4 max-w-4xl font-[var(--font-display)] text-[clamp(44px,7vw,84px)] font-bold leading-[0.98] tracking-[-0.04em]">
          <span className="mask-line display">
            <span className="mask-d2">Pay your team</span>
          </span>
          <span className="mask-line display">
            <span className="mask-d3 display-grad">and get paid onchain.</span>
          </span>
        </h1>
        <p className="landing-lead mx-auto max-w-2xl">
          NearHr is a real money app for the people who run payroll and the freelancers who wait for it.
          Pay your team in NEAR or USDC, bill your clients in the token of your choice, and keep every
          receipt on NEAR. HR and payroll, made easy.
        </p>
        <div className="fade-up d4 mt-9 flex flex-wrap items-center justify-center gap-4">
          <Link href="/api/auth/google/start" className="btn btn-primary">
            Open the app
          </Link>
          <Link href="/docs" className="btn btn-ghost">
            Read the docs
          </Link>
        </div>
        <div className="hero-photo fade-up d5">
          <img src="/img/hr-dashboard.svg" alt="NearHr dashboard: next payroll, total salary in Naira, salary history chart and recent payouts" />
          <div className="chip c1">
            <span className="chip-dot ok" />
            <div>
              <b>Payday executed</b>
              <span>50 people · NEAR + USDC</span>
            </div>
          </div>
          <div className="chip c2">
            <div>
              <b>Invoice settled</b>
              <span>paid in USDC on NEAR</span>
            </div>
            <span className="chip-badge">✓</span>
          </div>
          <div className="chip c3">
            <span className="chip-ico">✓</span>
            <div>
              <b>₦12,480,000 sent</b>
              <span>50 receipts recorded</span>
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

      {/* payroll */}
      <section id="payroll" className="landing-section">
        <div className="mx-auto max-w-3xl text-center">
          <div className="landing-kicker">Employee payroll</div>
          <h2 className="landing-h2">Payroll tools that bend, not break.</h2>
          <p className="landing-lead mx-auto">
            No matter your use case or internal process, NearHr delivers a fulfilling pay to your
            people on time, with an automated payslip and a receipt on NEAR for every run.
          </p>
        </div>
        <CheckList
          rows={[
            ["Multi currency pay", "Run payroll in Naira, dollars or stablecoins and settle in NEAR or USDC at a live rate."],
            ["Custom schedules", "Monthly, weekly or one off bonuses. Set the cadence that fits your operations."],
            ["CSV import and export", "Bring your roster in as a spreadsheet and take your ledger out as CSV, any time."],
          ]}
        />
        <img src="/img/hr-payslip.svg" className="mock" alt="Automated payslip for Ada Okoye: base salary and bonus in NEAR, net paid in Naira, receipt on NEAR" />
      </section>

      {/* invoices */}
      <section id="invoices" className="landing-section">
        <div className="mx-auto max-w-3xl text-center">
          <div className="landing-kicker">Getting paid</div>
          <h2 className="landing-h2">You bill, your client pays, the chain settles it.</h2>
          <p className="landing-lead mx-auto">
            Create an invoice in NEAR or USDC and send the link. Your client opens it in any browser,
            pays from their own Meteor or HERE wallet, and the money lands in your NEAR vault. The
            invoice only closes when the chain proves your vault received the exact amount.
          </p>
        </div>
        <div className="feature-grid mt-10">
          {[
            ["01", "Pick the token", "You choose whether the client pays in NEAR or USDC when you create the invoice. They pay in exactly that token."],
            ["02", "They pay in a popup", "One button opens their wallet, they approve the transfer, and no seed phrase or password ever touches the page."],
            ["03", "Confirmed on chain", "NearHr reads the transaction from the chain. Your vault credited the exact amount, so the invoice marks itself paid."],
          ].map(([n, title, body]) => (
            <div key={title} className="feature-card">
              <div className="flex items-center justify-between">
                <span className="mono text-xs text-[var(--color-faint)]">STEP {n}</span>
                <span className="pill pill-green">{title.toUpperCase()}</span>
              </div>
              <h3 className="mt-4 text-[22px]">{title}</h3>
              <p className="mt-3 text-[13.5px] leading-relaxed text-[var(--color-muted)]">{body}</p>
            </div>
          ))}
        </div>
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

      {/* transparency */}
      <section id="transparency" className="landing-section">
        <div className="mx-auto max-w-3xl text-center">
          <div className="landing-kicker">Transparency, by default</div>
          <h2 className="landing-h2">Every payday, verifiable on chain.</h2>
        </div>
        <div className="feature-grid mt-10">
          {[
            ["01", "Real accounts", "Each payment goes straight to a real NEAR account. The wallet, the amount and the receipt are all public on the explorer."],
            ["02", "Public receipts", "Every payout leaves a transaction anyone can inspect. No hidden wallets, no claim steps, no second phase."],
            ["03", "Auditable runs", "A full onchain record per run, and a PDF statement on demand. Your auditor verifies the whole payroll from the ledger."],
          ].map(([n, title, body]) => (
            <div key={title} className="feature-card">
              <div className="flex items-center justify-between">
                <span className="mono text-xs text-[var(--color-faint)]">STEP {n}</span>
                <span className="pill pill-green">{title.toUpperCase()}</span>
              </div>
              <h3 className="mt-4 text-[22px]">{title}</h3>
              <p className="mt-3 text-[13.5px] leading-relaxed text-[var(--color-muted)]">{body}</p>
            </div>
          ))}
        </div>
        <div className="mx-auto mt-16 max-w-3xl text-center">
          <div className="landing-kicker">The ledger</div>
          <h2 className="landing-h2">Every payout, recorded and verifiable.</h2>
          <p className="landing-lead mx-auto">
            The dashboard keeps a running ledger of each run and each payment, with status, asset
            and a link back to the onchain transaction. Anyone can follow the money on NEAR.
          </p>
        </div>
        <img src="/img/ledger.svg" className="mock" alt="Payout ledger with recent payroll entries" />
      </section>

      {/* cta */}
      <section className="landing-section">
        <div className="landing-cta">
          <div className="landing-kicker">Running on NEAR</div>
          <h2 className="mx-auto mt-3 max-w-2xl font-[var(--font-display)] text-[clamp(30px,4vw,52px)] font-bold leading-tight tracking-[-0.03em]">
            Start paying your team on NEAR today.
          </h2>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link href="/api/auth/google/start" className="btn btn-primary">
              Open your account
            </Link>
            <Link href="/docs" className="btn btn-ghost landing-cta-ghost">
              Read the docs
            </Link>
          </div>
        </div>
      </section>

      {/* footer */}
      <footer className="landing-footer">
        <div className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/img/nearhr-logo-crop.png" alt="NearHr" className="h-7 w-auto rounded-lg object-contain" />
        </div>
        <span>NEAR Protocol · onchain receipts · custodial smart accounts</span>
        <span>© 2026 NearHr</span>
      </footer>
    </main>
  );
}
