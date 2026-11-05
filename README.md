# NearHr

Private payroll on NEAR — a simple, custodial smart-account wallet.
Log in with Google, back up with a second email, and pay up to 50 people per
run in NEAR or USDC, with optional privacy in three levels.

**Status: MVP.** Everything up to the final on-chain signature is built and
tested offline (see [Verified](#verified)). Google OAuth and real NEAR
transfers are wired end-to-end but need your credentials + a funded account
to exercise for the first time.

## What it is

- **Custodial smart account** — one NEAR account per employer, backed by a
  server-held ed25519 master key. No wallet software for employees.
- **Google (Gmail) login** — hand-rolled OAuth2 + PKCE, no NextAuth.
- **Backup** — the encrypted key vault is wrapped in a backup bundle you send
  to a second email. Bundle + passphrase = full recovery.
- **Payroll** — CSV import → validate → preview → run. Max **50 employees**
  per run, in **NEAR or USDC (nep141)**.
- **Optional privacy, three levels** (SIP Protocol NEAR stealth):
  - `transparent` — straight transfer to the employee's NEAR account. Public.
  - `shielded` — each payment funds a one-time stealth implicit account; only
    the employee can claim it. Payer-to-recipient is not linked on-chain.
  - `compliant` — shielded, plus a viewing key so an auditor can verify every
    payment was made without exposing who received it.
- **Private expense audit** — paste a bank statement or upload receipts and a
  model hosted inside a **trusted execution environment on NEAR AI Cloud**
  categorizes the spending and flags what looks unusual. The app proves the
  analysis ran in the TEE before showing a result. [How it is verified](#private-expense-audit-tee-verified).

## Quickstart

```bash
npm install
cp .env.example .env.local   # fill in GOOGLE_CLIENT_ID / _SECRET, NEAR_NETWORK
npm run dev                  # http://localhost:3000
```

Google Cloud Console: create an OAuth client (Web) with authorized redirect
URI `http://localhost:3000/api/auth/google/callback`.

Your employer account: log in with the Gmail listed in `EMPLOYER_EMAILS`
(comma-separated) — the first login grants the `employer` role. Everyone else
is an `employee` (read + claim, no payroll controls).

Test without Google: `npx tsx scripts/e2e-seed.mjs` creates a test employer
and prints a session token; use it as the `hp_session` cookie (this is how
the offline flow below was verified).

### CSV format

```csv
email,name,amount,near_account,stealth_meta,privacy
jane@x.com,Jane,1500,jane.testnet,,
joe@x.com,Joe,250.5,,sip:near:0x...:0x...,shielded
```

- `transparent` rows need `near_account`; `shielded`/`compliant` rows need
  `stealth_meta` (the employee's `sip:near:...` meta address).
- Per-row `privacy` overrides the run default. Duplicate emails, bad
  amounts, and >50 rows are rejected with line-level errors.

### Scripts

| Command | Purpose |
|---|---|
| `npm run dev` / `npm run build && npm start` | Run / build the app |
| `npx tsc --noEmit` | Type-check |
| `npx tsx scripts/smoke.mjs` | Offline test: vault crypto, SIP stealth round-trip, CSV parser, NEAR/USDC math |
| `npx tsx scripts/e2e-seed.mjs` | Seed a test employer + session token for the API |

## Private expense audit (TEE verified)

The dashboard's **Audit** action (rail or quick actions) opens the private
expense auditor. It is built for the NEAR AI Cloud hackathon, Privacy and
Private AI track, and satisfies the track requirements directly:

1. **OpenAI-compatible API on NEAR AI Cloud.** `src/app/api/audit/route.ts`
   talks to `https://cloud-api.near.ai/v1` (key in `.env.local`) and chooses a
   TEE-hosted model listed by the `/models` endpoint.
2. **Attestation with a fresh random nonce, verified end to end.** Every audit
   mints a fresh 32-byte nonce, fetches `/attestation/report` for the chosen
   model, and checks it the way the NEAR AI Cloud verification docs describe:
   the TEE node echoes our exact nonce, an Intel TDX quote is present, the
   NVIDIA GPU evidence is verified through **NVIDIA NRAS** (secure boot on,
   debug disabled, nonce match, overall result true), and the **ECDSA
   signature** on the completion recovers to the attested model TEE address
   with the signed request and response hashes matching our exact bytes. The
   UI shows a **Verified** panel listing every check.
3. **Nothing is kept server-side after a response returns.** The document text
   exists only inside the single HTTPS request to NEAR AI Cloud and in the
   memory of the process until the response is sent. There is no database, no
   uploads folder, no disk write, and no log that contains the document. Only
   metadata (model name, chat id, hashes) is ever recorded. The same promise
   is written in the source comments at the top of
   `src/app/api/audit/route.ts` and repeated in the UI footer.
4. **Fictional sample documents.** `public/samples/sample-statement.txt` and
   `public/samples/sample-receipts.txt` are made up, so anyone can run a full
   audit without real data.

**Demo mode (temporary).** Until NEAR AI Cloud credits are added, `.env.local`
may set `FORTYTWO_API_KEY`, which routes the *completion* to an external
OpenAI-compatible model so local development works. The TEE attestation
pipeline still runs live and is displayed, but the answer is clearly marked
**Not verified (demo)** and this mode must be removed before submission.

## How keys are held

```
data/kms.key            server master key (auto-generated, mode 0600, gitignored)
data/hushpay.db         SQLite: users, sessions, vaults, payroll runs/items (file name kept for backward compatibility)
```

Per-employer vault = AES-256-GCM envelope:

1. Fresh random DEK encrypts the key material (NEAR master key + SIP
   spending/viewing keys + account id).
2. The DEK is wrapped with `SHA-256(PBKDF2(passphrase) ‖ KMS key)` — so the
   ciphertext is useless without **both** your passphrase and the server's KMS key.
3. The same ciphertext is the backup bundle. Restore = bundle + passphrase.

The passphrase never leaves your browser except inside the unlock/execute
requests. SQLite columns for money are `TEXT` (decimal strings) — 1 NEAR =
10²⁴ yocto overflows `INTEGER`/REAL and would silently corrupt amounts.

## Verified

- `npx tsc --noEmit` — clean
- `npx tsx scripts/smoke.mjs` — 22/22 (vault round-trip, wrong-passphrase
  rejection, backup bundle decode, stealth create/derive/claim + non-claim by
  other employee, CSV validation incl. duplicate + 50-cap, NEAR/USDC math)
- `npx next build` — clean (18 routes)
- Live server, real HTTP: landing/login/dashboard render; unauthed APIs →
  401; vault create → 201 with encrypted record; backup record + re-download;
  payroll preview → 2/2 valid; run create → 201; run list/detail → exact
  decimal amounts; 51 rows → 400; unconfigured Google → actionable 400.
- **Google OAuth round-trip verified live** (real client, real consent,
  employer login via `roseflinch5@gmail.com`).

**Not yet exercised** (needs real external state): actual on-chain transfers
(no funded account / `NEAR_NETWORK` endpoint). The execution path — signing,
nonce-ordered sequential sends, stealth funding, claim — is implemented in
`src/lib/near.ts` / `src/lib/payroll.ts` / `src/lib/privacy.ts` and
type-checked, but treat it as unverified until one real testnet run.

## Honest risk notes (read before going live)

1. **Custodial by design.** We hold the keys (encrypted). If the server is
   fully compromised — KMS key + passphrase — funds move. MVP trade-off for
   simplicity; a self-custodial upgrade is the next milestone.
2. **Stealth ≠ full shield.** In `shielded`/`compliant` the *sender* account
   is still visible on-chain; what's hidden is the link to the employee and
   the recipient address. Full ZK shielded-pool privacy on NEAR routes
   through Intents — a centralized rail whose compliance layer has paused
   funds before (July and October 2026). The MVP deliberately stays on-chain
   so your funds are never held by a third party.
3. **Backup = your safety.** Lose passphrase **and** KMS key and the vault
   is unrecoverable. Treat the backup bundle like the master key itself.

## Layout

```
src/lib/        crypto · db · near · privacy · vault · google · sessions · payroll
src/app/api/    auth/google/{start,callback} · logout · me · vault(+backup/claim/restore) ·
                payroll(+preview/runs/[id]/[id]/execute) · balance · swap · audit
src/app/        page (landing) · login · dashboard (Wallet / New payroll / Runs / Backup / Audit)
scripts/        smoke.mjs (offline) · e2e-seed.mjs (test session)
public/samples/ fictional statement + receipts for the expense auditor
```
