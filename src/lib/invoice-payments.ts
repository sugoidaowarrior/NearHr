/**
 * Invoice payment bookkeeping. When a client pays an invoice the received USDC
 * is recorded in the payments ledger (kind 'invoice') so the payroll statement
 * shows money in as well as money out, and the dashboard transactions feed
 * shows it live.
 */
import { randomBytes } from "node:crypto";
import { getDb } from "./db";
import type { Invoice } from "./invoices";

/** Record a confirmed invoice payment in the payments ledger. Idempotent per tx. */
export function recordInvoicePayment(inv: Invoice, payerAccount: string | null): void {
  const db = getDb();
  if (inv.near_tx) {
    const dup = db.prepare("SELECT id FROM payments WHERE tx_ref = ? AND kind = 'invoice'").get(inv.near_tx);
    if (dup) return;
  }
  db.prepare(
    `INSERT INTO payments (id, employer_id, employee_id, recipient_name, recipient_wallet, kind, asset, amount, note, tx_ref, status, paid_at)
     VALUES (?, ?, NULL, ?, ?, 'invoice', ?, ?, ?, ?, 'confirmed', datetime('now'))`
  ).run(
    randomBytes(12).toString("hex"),
    inv.employer_id,
    inv.client_name,
    payerAccount ?? inv.payer_account ?? "",
    inv.asset,
    inv.amount,
    inv.note ?? "invoice payment",
    inv.near_tx ?? null
  );
}

/**
 * Statement data for the PDF payroll statement: money in (invoice payments),
 * money out (payroll runs + manual sends) and the payroll runs themselves,
 * grouped by month (YYYY-MM) for the requested window.
 */
export function statementData(employerId: string, from: string, to: string) {
  const db = getDb();
  const paid = db
    .prepare(
      `SELECT paid_at, amount, asset, recipient_name, note, tx_ref FROM payments
       WHERE employer_id = ? AND kind = 'invoice' AND status = 'confirmed'
         AND strftime('%Y-%m', paid_at) BETWEEN ? AND ?
       ORDER BY paid_at ASC`
    )
    .all(employerId, from, to) as any[];
  const out = db
    .prepare(
      `SELECT paid_at, amount, asset, kind, recipient_name, note, tx_ref FROM payments
       WHERE employer_id = ? AND kind IN ('payroll', 'send', 'refund') AND status IN ('confirmed', 'sent')
         AND strftime('%Y-%m', paid_at) BETWEEN ? AND ?
       ORDER BY paid_at ASC`
    )
    .all(employerId, from, to) as any[];
  const runs = db
    .prepare(
      `SELECT name, asset, total_yocto, employee_count, executed_at, near_ref, status FROM payroll_runs
       WHERE employer_id = ? AND status IN ('done', 'executed') AND executed_at IS NOT NULL
         AND strftime('%Y-%m', executed_at) BETWEEN ? AND ?
       ORDER BY executed_at ASC`
    )
    .all(employerId, from, to) as any[];
  return { paid, out, runs };
}
