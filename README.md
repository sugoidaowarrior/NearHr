# NearHr

Pay people. Get paid. On NEAR.

NearHr is payroll and invoicing for a normal company, running on NEAR. You
log in with Google and NearHr sets up your account on NEAR for you and looks
after it. You never install wallet software, never handle a secret recovery
phrase, and never buy gas. You pay your team in NEAR or USDC, and you send
clients an invoice they pay from their own wallet, or, if they have none,
from an account NearHr opens for them.

Everything NearHr does is public and checkable. Every payment is a real
transfer on NEAR with a receipt anyone can look up, and the app links each
entry to that receipt, so you can verify it with your own eyes any time.

## The two jobs

1. **Payroll.** Add your team one by one or import a CSV, check the list, and
   pay up to 50 people per run in NEAR or USDC. Every payout is recorded with
   its status and the on chain receipt.
2. **Invoices.** Bill a client in NEAR or USDC with a total amount, optional
   line items, a short narration and a due date. They open a public pay link
   in any browser and pay straight to your vault.

## About the money

- **The money is real.** It is NEAR and Circle's USDC, the dollar token.
  When you receive 10 USDC, you have 10 dollars worth. Nothing else, no
  conversion game.
- **The status is the truth.** An invoice is open, pending, paid, refunded
  or void. It only changes when the chain confirms the money actually
  moved, and every paid invoice links to that transaction.
- **Refunds go back.** When you refund an invoice, the exact amount goes
  back to the payer on the chain, the refund is recorded, and the invoice
  can be paid again.
- **One CSV, no questions.** Export gives you a file with who, how much,
  what it was for, when it was due, which token, whether it is paid, the
  wallet that paid, and the transaction.
- **A PDF statement for your records.** Pick a date range and NearHr lists
  every invoice payment, payroll run, manual send and refund in that window,
  each with its transaction.

## The invoice flow, step by step

1. Open **Invoices** from the rail and press **New invoice**.
2. Enter the client name, the amount, the token (NEAR or USDC), the due date,
   a note and any line items. If you add lines the amount adds up from them.
   Press **Save and get link**.
3. Share the link. It works on a phone and needs no login. The client sees
   the amount, the line items when present, the note, the due date and a
   **Pay** button.
4. The client presses **Pay** and picks one of two options:
   - **I have a NEAR wallet.** One button opens their wallet (Meteor or
     HERE). They approve the exact amount and the money goes straight to
     your vault.
   - **I don't have a NEAR wallet.** They sign in with Google and NearHr
     opens a payment account for them. They top it up with test money,
     review the payment, and press pay. NearHr sends the exact amount from
     their account to your vault.
5. The server reads the chain and marks the invoice paid only when your vault
   actually received the exact amount from the account that claimed it.
6. If the work is not accepted, press **Refund** on the invoice. The exact
   billed amount returns to the payer on chain and the invoice reopens.

## What each status means

| Status | Meaning | What you can prove |
|---|---|---|
| Open | The client has not paid yet | The invoice and its link |
| Pending | A transfer is in flight, the credit is being confirmed | The transfer, being watched on chain |
| Paid | Your vault received the exact amount | A link to the NEAR receipt |
| Refunded | You returned the money on chain | A link to the refund receipt |
| Void | You cancelled the invoice | The cancellation time |

No status is a guess. Each is set by a real response from the chain, and each
carries a link you can open.

## Payroll, in one paragraph

Manage your team with name, email, wallet, salary and frequency. Add people
one by one or import a CSV: any row with a bad amount or wallet is flagged
before anything is sent. To pay, open **Payroll**, preview every amount,
then run it. Each payment is a real transfer on NEAR, recorded with its
receipt. The same record feeds the PDF statement and the CSV export, so a
payroll run is a statement you can check.

## How the money settles

- **Client to you.** NEAR or USDC, straight from the client's wallet or the
  account NearHr opened for them, to your vault. No swap, no conversion, no
  middleman.
- **You to your team.** A direct transfer from your vault in the token you
  pick per employee.
- **You to the client (refunds).** The exact billed amount back on chain,
  recorded with its own transaction.

## The smart contract

`contracts/invoice-contract` is a Rust NEAR contract that keeps an on chain
registry of invoices. Each invoice stores the employer, the client, the
amount in USDC base units, the status, and the NEAR transaction hash that
settled it. State lives on chain, so an invoice record can be audited
independently of the app: anyone can call `get(slug)` on the contract and
see exactly what the app recorded.

The access model is the whole point of the contract:
- only the contract owner can register employers or rotate the relayer
- only a registered employer (or the relayer acting on their behalf) can
  create an invoice
- only a registered employer or the relayer can mark an invoice paid or
  refunded
- `mark_paid` and `mark_refunded` are idempotent, so a relayer retry after a
  timeout cannot corrupt state
- an invoice below 0.1 USDC is rejected at the contract layer, not just in
  the UI

Testing it needs no network and no keys. The near-sdk ships an in memory
blockchain, and every test gets a fresh one:

```bash
cd contracts/invoice-contract
cargo test
```

21 tests cover every access control rule, the idempotency of both status
transitions, the minimum amount, duplicate slugs, and the full open, paid,
refundable lifecycle. The same suite runs in CI on every push.

The contract is live on NEAR testnet at:

```
0b435161055d82a427059c442a73cdfd8a87c854478895434d1a730189fc84c2
```

It was deployed with `scripts/deploy-invoice-contract.mjs deploy`, funded
with free testnet NEAR, and a real cycle was run on chain with
`scripts/run-live-cycle.mjs`:

- `live-demo-001` was created for 25 USDC and then marked paid
- `live-demo-002` was created for 10 USDC and then marked refunded

Every state change was verified with a public view call, and the final state
was re verified from two separate RPC nodes. The transaction links are in the
terminal output and on the explorer.

You do not need any key to audit the live state. Two view calls against any
testnet RPC, using the base64 of `{"slug":"live-demo-001"}` as
`args_base64`:

```
method_name = get     -> full invoice record (employer, client, amount, status, near_tx)
method_name = status  -> just the status byte (2 = paid, 3 = refunded)
```

That keyless read is the whole point of the registry: anyone can confirm
exactly what the app recorded, without trusting the app, its database, or its
owner.

To deploy your own instance (one time, about 0.06 NEAR):

```bash
cargo build --release --target wasm32-unknown-unknown
node scripts/deploy-invoice-contract.mjs deploy              # deploys and initializes
node scripts/deploy-invoice-contract.mjs register <your.vault.account>
node scripts/deploy-invoice-contract.mjs check <your.vault.account>
```

One honest note: the running app settles money with plain NEP 141 transfers
into the vault account and verifies the receipts, which is the flow that was
tested live on testnet. The registry contract is the auditable record that
sits on top of that, and it is now deployed and holding live state.

## What is intentionally not in here

- **One click, without the 1Click API.** The pay button works like one click:
  the client approves a single transfer and NearHr settles it, with no route
  picking, no token choosing and no wallet software to set up. NearHr does
  not call the 1Click API itself because that API has no testnet, and this
  build proves its full paid invoice flow on testnet. The wallet popup does
  the same job for free, and a solver based route can be added on top without
  changing the invoice model.
- **No cross chain payments.** Your clients pay in NEAR or USDC that already
  live on NEAR, so a hop to another chain would add steps and nothing.

## Setting it up

```bash
npm install
cp .env.example .env.local
npm run dev    # http://localhost:3000
```

Fill in `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` for sign in. The first
account that logs in with the email in `EMPLOYER_EMAILS` becomes the employer.
To test without Google, run `npx tsx scripts/e2e-seed.mjs` and use the printed
token as the `hp_session` cookie.

## Tests

```bash
npm test
```

98 tests, no new dependencies. They run offline against a throwaway database
so they never touch your real data. The runner is `node:test` plus `tsx`, the
standard library, so there is nothing to install or configure.

What they cover:
- amount math at the exact bigint precision the chain uses
- transaction hash normalization (base58, base64, hex)
- payroll CSV parsing, including quoted fields, CRLF, and the 50 person cap
- the payment ledger: booking, double spend prevention, statement grouping
- invoice validation and money math
- the vault crypto: tamper detection, legacy format, backups
- sessions, OAuth state, and per employer access checks (IDOR)
- SQL injection attempts against the real query layer

Running the suite is how three real bugs were caught and fixed. Each one is
documented in the commit that added the tests.

## Verified

- Type check and production build pass clean.
- The full paid invoice flow is exercised live on testnet, in both tokens,
  through both payment options (wallet popup and walletless).
- The refund flow is tested live on testnet: an invoice paid, the exact amount
  refunded on chain, and the result verified by account balances and the
  transaction receipt.

## Honest risk notes

1. **The app keeps the keys, by design.** The server holds your NEAR keys,
   encrypted. If the server were taken over, the keys could be moved. That
   is the trade off for an app that is easy to use. Your own wallet is the
   next milestone.
2. **Testnet today.** The build runs on NEAR testnet. Mainnet is a config
   switch, but you should re check the faucets, the wallets and the storage
   record costs before real money moves.
3. **The backup file is your safety.** The encrypted wallet is wrapped in a
   backup bundle. Keep that bundle. Lose it and the wallet is gone.
