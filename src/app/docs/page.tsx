import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";

const sections = [
  { id: "overview", label: "Overview" },
  { id: "payroll", label: "Employee payroll" },
  { id: "invoices", label: "Invoices" },
  { id: "pay", label: "How an invoice is paid" },
  { id: "walletless", label: "Paying without a wallet" },
  { id: "verification", label: "Verification rules" },
  { id: "refunds", label: "Refunds" },
  { id: "statement", label: "PDF statement" },
  { id: "csv", label: "CSV export" },
  { id: "api", label: "API reference" },
  { id: "security", label: "Security model" },
];

function H({ id, n, title, sub }: { id: string; n: string; title: string; sub: string }) {
  return (
    <div id={id} style={{ scrollMarginTop: 90 }}>
      <div className="mono" style={{ fontSize: 11, color: "var(--color-faint)" }}>{n}</div>
      <h2 className="landing-h2" style={{ marginBottom: 6 }}>{title}</h2>
      <p className="landing-lead" style={{ fontSize: 15, marginBottom: 18 }}>{sub}</p>
    </div>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: 14, lineHeight: 1.65, color: "var(--color-muted)", margin: "0 0 14px" }}>{children}</p>;
}

function Code({ children }: { children: string }) {
  return (
    <code style={{ fontFamily: "var(--font-geist-mono, monospace)", fontSize: 12, background: "var(--color-bg-2)", border: "1px solid var(--color-rule)", borderRadius: 6, padding: "1px 6px" }}>
      {children}
    </code>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ border: "1px solid var(--color-rule)", borderRadius: 12, padding: "14px 16px", marginBottom: 14, background: "var(--color-bg-2)" }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 13.5, lineHeight: 1.6, color: "var(--color-muted)" }}>{children}</div>
    </div>
  );
}

function ApiRow({ m, p, what }: { m: string; p: string; what: string }) {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "baseline", padding: "9px 0", borderBottom: "1px solid var(--color-rule)" }}>
      <span className="mono" style={{ fontSize: 11, width: 52, color: "var(--color-accent)", flexShrink: 0 }}>{m}</span>
      <code className="mono" style={{ fontSize: 12, flexShrink: 0 }}>{p}</code>
      <span style={{ fontSize: 13, color: "var(--color-muted)" }}>{what}</span>
    </div>
  );
}

export default function DocsPage() {
  return (
    <main className="min-h-screen overflow-x-clip">
      <header className="landing-nav">
        <Link href="/" className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/img/nearhr-logo-crop.png" alt="NearHr" className="h-8 w-auto rounded-lg object-contain" />
        </Link>
        <nav className="flex items-center gap-6">
          <Link href="/" className="nav-link hidden sm:inline-block">Home</Link>
          <Link href="#api" className="nav-link hidden sm:inline-block">API</Link>
          <Link href="/dashboard" className="nav-link">Open app</Link>
          <ThemeToggle compact />
        </nav>
      </header>

      <section className="landing-section" style={{ paddingTop: 40 }}>
        <div className="landing-kicker">Documentation</div>
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: "clamp(34px,5vw,56px)", fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1.05, margin: "6px 0 10px" }}>
          How NearHr works
        </h1>
        <p className="landing-lead" style={{ marginBottom: 36 }}>
          Everything the app does, in plain words: how payroll runs, how invoices settle, and how
          the chain proves each payment before it counts.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "200px minmax(0, 1fr)", gap: 40, alignItems: "start" }}>
          {/* sidebar */}
          <aside style={{ position: "sticky", top: 84, display: "flex", flexDirection: "column", gap: 2 }}>
            {sections.map((s, i) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                style={{
                  fontSize: 13,
                  padding: "6px 10px",
                  borderRadius: 8,
                  color: i === 0 ? "var(--color-ink)" : "var(--color-muted)",
                  fontWeight: i === 0 ? 700 : 500,
                  textDecoration: "none",
                  background: i === 0 ? "var(--color-bg-2)" : "transparent",
                }}
              >
                {s.label}
              </a>
            ))}
          </aside>

          {/* content */}
          <div style={{ maxWidth: 720 }}>
            <H id="overview" n="01" title="Overview" sub="NearHr is a real money app for payroll and invoicing on NEAR." />
            <P>
              You sign in with Google and NearHr opens a private smart account for you on NEAR: no
              seed phrases, no passphrases, nothing to set up. That account is your vault. Payroll
              runs leave from it, and invoice payments land in it. Every payment is a real onchain
              transfer with a public receipt, and a running ledger in the app ties each entry back
              to its transaction.
            </P>
            <P>
              Money moves in two directions: you pay your team (NEAR or USDC, up to 50 people per
              run), and your clients pay you (NEAR or USDC, per invoice, straight from their wallet
              or a NearHr provisioned payment account).
            </P>

            <H id="payroll" n="02" title="Employee payroll" sub="Import a roster, validate, and send the run to the chain." />
            <P>
              Add people one by one or import a CSV: name, email, wallet, salary and frequency.
              Before a run is sent, NearHr validates every wallet and amount so a bad row can never
              burn a transaction. One batch then pays up to 50 people in native NEAR or USDC, and
              each payout is recorded in the ledger with its status, asset and onchain reference.
            </P>
            <Block title="CSV format">
              The columns are <Code>email</Code>, <Code>name</Code>, <Code>amount</Code>,{" "}
              <Code>near_account</Code> (optional), <Code>asset</Code> (optional, NEAR or USDC),{" "}
              <Code>frequency</Code> (optional). Rows with a malformed amount or wallet are reported
              before anything is sent.
            </Block>

            <H id="invoices" n="03" title="Invoices" sub="Bill a client a total in NEAR or USDC, with a short narration. No line items." />
            <P>
              When you create an invoice you pick the token: NEAR or USDC. The invoice is a single
              amount plus a narration (what the work is for) and a due date. Each invoice gets a
              short public link, for example <Code>/i/k7m3qf</Code>, that you can send by email or
              chat. The client opens it in any browser, no account required.
            </P>
            <Block title="The client chooses the token, not you">
              The payer always pays in the exact token the invoice was created with. A USDC invoice
              is paid in USDC, a NEAR invoice in NEAR. There is no conversion step and no choice at
              checkout.
            </Block>

            <H id="pay" n="04" title="How an invoice is paid" sub="Two options at checkout: your own wallet, or a NearHr payment account." />
            <P>
              <b style={{ color: "var(--color-ink)" }}>Option 1, I have a NEAR wallet.</b> One button
              opens the customer&apos;s wallet (Meteor or HERE). They approve the exact transfer and
              the money goes straight to your vault: a plain NEAR transfer, or an{" "}
              <Code>ft_transfer</Code> call on the USDC token contract for USDC invoices.
            </P>
            <P>
              <b style={{ color: "var(--color-ink)" }}>Option 2, I don&apos;t have a NEAR wallet.</b> The
              customer signs in with Google and NearHr provisions a payment account for them. They
              fund it, approve the payment, and NearHr sends it from that account on their behalf.
              The full flow is in the next section.
            </P>
            <P>
              There is also a manual path: if the customer already sent the payment some other way,
              they can paste the transaction hash and NearHr checks it against the chain.
            </P>

            <H id="walletless" n="05" title="Paying without a wallet" sub="Email is only the sign in method. It does not contain money and does not automatically fund the account." />
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
              {[
                "The customer opens the invoice link.",
                "They select “I don’t have a NEAR wallet”.",
                "They sign in with Google. NearHr provisions a NEAR account for them, backed by a key NearHr holds encrypted (the same custodial model as your own vault).",
                "The page shows the new account address, the invoice amount, and the account balance (0 when fresh).",
                "The customer funds the account with a little NEAR from the built in NEAR faucet on the docs page, or USDC from any funded NEAR account. A card or bank onramp is a separate future integration; email login does not convert fiat into crypto.",
                "They review and press pay. NearHr sends the exact invoice amount from their account to your vault.",
                "The same onchain verification as the wallet path runs: success status, correct token, exact amount, correct recipient.",
                "Only then does the invoice flip to paid.",
              ].map((s, i) => (
                <div key={i} style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
                  <span className="mono" style={{ fontSize: 11, color: "var(--color-accent)", flexShrink: 0 }}>{String(i + 1).padStart(2, "0")}</span>
                  <span style={{ fontSize: 13.5, lineHeight: 1.6, color: "var(--color-muted)" }}>{s}</span>
                </div>
              ))}
            </div>

            <H id="verification" n="06" title="Verification rules" sub="The server reads the chain, not the client." />
            <P>
              An invoice is never marked paid just because the customer returns to the page. The
              server takes the customer&apos;s signed transaction (or a pasted hash), reads the real
              onchain outcome, and requires all of the following before the invoice settles:
            </P>
            <Block title="All of these must hold">
              The transaction executed successfully. The token matches the invoice asset. The amount
              matches the invoice to the base unit. The recipient is your vault. The sender is the
              account that claimed it. A duplicate or overpayment can never book the invoice twice:
              the ledger entry is written exactly once, on the first paid transition.
            </Block>

            <H id="refunds" n="07" title="Refunds" sub="Give the money back on chain, not in a spreadsheet." />
            <P>
              A paid invoice carries a <b style={{ color: "var(--color-ink)" }}>Refund</b> button.
              Pressing it sends the exact billed amount back to the paying account from your vault,
              in the invoice&apos;s token. The refund transaction is recorded on the invoice with
              its own hash, the invoice flips to <b style={{ color: "var(--color-ink)" }}>refunded</b>,
              and it can be paid again: a walletless payer keeps their payment account, so they
              can re pay immediately once the dispute is settled. The refund also appears as an
              outflow in the PDF statement and as a row in the CSV export, so the money trail stays
              complete in both directions.
            </P>

            <H id="statement" n="08" title="PDF statement" sub="A payroll statement for your auditor, on demand." />
            <P>
              Pick a date range in the dashboard and NearHr generates a PDF of every payroll run,
              settled invoice, manual send and refund in that window: dates, people or clients,
              amounts, assets, status and the onchain transaction for each entry. Anyone with the
              PDF can verify the whole statement against the public ledger.
            </P>

            <H id="csv" n="09" title="CSV export" sub="Your ledger, as a spreadsheet." />
            <P>
              Every invoice exports to CSV with its asset, amount, status, payer account, transaction
              reference, refund transaction, timestamps and the explorer link. Combine that with the
              PDF statement and you keep the full money trail outside the app.
            </P>

            <H id="api" n="10" title="API reference" sub="The routes the app and integrations talk to." />
            <div style={{ marginBottom: 18 }}>
              <ApiRow m="GET" p="/api/invoices" what="your invoices, newest first" />
              <ApiRow m="POST" p="/api/invoices" what="create an invoice (client, amount, asset NEAR or USDC, due date, note)" />
              <ApiRow m="POST" p="/api/invoices/[id]" what="actions on one invoice: void it, or refund a paid one on chain" />
              <ApiRow m="GET" p="/api/invoices/csv" what="export your invoices as CSV, refunds included" />
              <ApiRow m="GET" p="/api/invoices/slug/:slug" what="public pay details for a link (amount, asset, vault, balance)" />
              <ApiRow m="POST" p="/api/invoices/slug/:slug" what="claim a payment: signed tx or pasted hash, verified onchain" />
              <ApiRow m="GET" p="/api/statement?from=&to=" what="PDF payroll statement for a date range" />
              <ApiRow m="GET" p="/api/payer/account" what="walletless payer: provision + show the customer account and balance" />
              <ApiRow m="POST" p="/api/payer/pay" what="walletless payer: send from the customer account, verify onchain" />
            </div>

            <H id="security" n="11" title="Security model" sub="Custodial by design, honest about it." />
            <P>
              Your vault key is encrypted with a server derived key before it is stored. That is a
              custodial model: NearHr can move funds from your vault, and it is built for the
              hackathon MVP, not for holding a treasury. Email is never a money source: signing in
              with Google provisions accounts and sessions, and nothing in the login flow moves
              funds. All payment claims are verified against the chain before they count, so a
              compromised or lying client page cannot mark an invoice paid.
            </P>
          </div>
        </div>
      </section>

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
