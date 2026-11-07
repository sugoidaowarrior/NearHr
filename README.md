# NearHr

Pay people. Get paid. On NEAR.

NearHr is payroll and invoicing for a normal company, running on NEAR. You
log in with Google and NearHr opens a smart account on NEAR for you that the
server looks after. You never install wallet software, never save a seed
phrase, and never buy gas. You pay your team in NEAR or USDC, and you invoice
clients who pay from their own wallet or, if they have none, through a
payment account NearHr provisions for them.

Everything NearHr does is transparent. Every payment is a real transfer on
NEAR with a public receipt, and the app's ledger ties each entry back to that
transaction, so you can check it with your own eyes at any time.

## The two jobs

1. **Payroll.** Add your team one by one or import a CSV, validate, and pay
   up to 50 people per run in native NEAR or USDC. Every payout is recorded
   with its status and on chain reference.
2. **Invoices.** Bill a client in NEAR or USDC with a total amount, optional
   line items, a short narration and a due date. They open a public pay link
   in any browser and pay straight to your vault.

## What a bookkeeper needs to know

- **The money is real.** It is native NEAR and Circle's USDC on NEAR, one to
  one with the dollar. No token you receive is worth anything else.
- **Status is trustworthy.** An invoice is open, pending, paid, refunded or
  void. Each state is set by what the chain actually reports, and each paid
  invoice carries the transaction that proves it.
- **Refunds are real.** Refunding a paid invoice sends the exact billed
  amount back to the payer on chain, records the refund transaction, and
  reopens the invoice so it can be paid again.
- **One CSV, no questions.** Export gives you a file with the client, the
  amount, the due date, the narration, the line items, the asset, the status,
  the payer wallet, the transaction, and the refund reference when present.
- **A PDF statement for your auditor.** Pick a date range and NearHr renders
  every invoice payment, payroll run, manual send and refund in that window,
  each with its on chain transaction.

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
     HERE). They approve the exact transfer and the money goes straight to
     your vault: a plain NEAR transfer, or an `ft_transfer` call on the USDC
     token contract.
   - **I don't have a NEAR wallet.** They sign in with Google and NearHr
     provisions a NEAR payment account for them. They fund it from the
     faucet, review the payment, and press pay. NearHr sends the exact
     amount from their account to your vault.
5. The server reads the chain and marks the invoice paid only when your vault
   actually received the exact amount from the account that claimed it.
6. If the work is not accepted, press **Refund** on the invoice. The exact
   billed amount returns to the payer on chain and the invoice reopens.

## What each status means

| Status | Meaning | What you can prove |
|---|---|---|
| Open | The client has not paid yet | The invoice and its link |
| Pending | A transaction is in flight, the credit is being confirmed | The transaction, being watched on chain |
| Paid | Your vault received the exact amount | The NEAR transaction hash |
| Refunded | You returned the money on chain | The refund transaction hash |
| Void | You cancelled the invoice | The cancellation time |

No status is a guess. Each is set by a real response from the chain, and each
carries a link you can open.

## Payroll, in one paragraph

Manage an employee roster with name, email, wallet, salary and frequency. Add
people one by one or import a CSV: rows with a malformed amount or wallet are
reported before anything is sent. To pay, open **Payroll**, preview every
amount, then execute. Each payment is a real transfer on NEAR, recorded in
the ledger with its transaction hash. The same ledger feeds the PDF statement
and the CSV export, so a payroll run is a statement you can check.

## How the money settles

- **Client to you.** NEAR or USDC, straight from the client's wallet or their
  NearHr provisioned account, to your vault. No swap, no conversion, no third
  party rail in between.
- **You to your team.** A direct transfer from your vault in the token you
  pick per employee.
- **You to the client (refunds).** The exact billed amount back on chain,
  recorded with its own transaction.

## What is intentionally not in here

- **One click, without the 1Click API.** The pay button works like one click:
  the client approves a single transfer and NearHr settles it, with no route
  picking, no token choosing and no wallet software to set up. NearHr does
  not call the 1Click API itself because that API has no testnet, and this
  build proves its full paid invoice flow on testnet. The wallet popup does
  the same job for free, and a solver based route can be added on top without
  changing the invoice model.
- **No cross chain Intents.** Your clients pay in NEAR or USDC that already
  live on NEAR, so a cross chain hop would add complexity and nothing.
- **No line items.** An invoice is a total plus a narration, like most real
  small business invoices.

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

## Verified

- Type check and production build pass clean.
- The full paid invoice flow is exercised live on testnet, in both tokens,
  through both payment options (wallet popup and walletless).
- The refund flow is tested live on testnet: an invoice paid, the exact amount
  refunded on chain, and the result verified by account balances and the
  transaction receipt.

## Honest risk notes

1. **Custodial by design.** The server holds your NEAR keys, encrypted. If
   the server is fully compromised, the keys can move. This is the trade off
   for a simple app. Self custody is the next milestone.
2. **Testnet today.** The build runs on NEAR testnet. Mainnet is a config
   switch, but you should re test the faucets, the wallets and the storage
   record costs before real money moves.
3. **Backup is your safety.** The encrypted vault is wrapped in a backup
   bundle. Keep that bundle. Lose it and the wallet is gone.
