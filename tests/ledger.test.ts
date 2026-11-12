/**
 * Payment ledger: booking invoice payments, double booking protection,
 * one off sends ledger entries, statement data grouping.
 * Isolated temp DB. No network.
 */
import "./_setup";
import { test, before } from "node:test";
import assert from "node:assert/strict";

import { getDb } from "../src/lib/db";
import { createInvoice, getInvoiceBySlug, updateInvoice } from "../src/lib/invoices";
import { recordInvoicePayment, statementData } from "../src/lib/invoice-payments";
import { recordPayment, listPayments } from "../src/lib/payments";
import { addEmployee, findEmployee } from "../src/lib/employees";
import type { Invoice } from "../src/lib/invoices";

const EMP = "google-sub-ledger";
const WALLET = "2d".repeat(32);

function insertUser(id: string, email: string, name: string) {
  getDb()
    .prepare("INSERT OR IGNORE INTO users (id, email, name, role) VALUES (?, ?, ?, 'employer')")
    .run(id, email, name);
}

function paidInvoice(client: string, amount: string, txHash: string): Invoice {
  const inv = createInvoice(EMP, {
    client_email: null,
    note: null,
    client_name: client,
    amount,
    due_date: "2026-11-20",
  });
  updateInvoice(inv.id, {
    status: "paid",
    near_tx: txHash,
    payer_account: "payer.testnet",
    settled_at: new Date().toISOString(),
  });
  return getInvoiceBySlug(inv.slug)!;
}

before(() => {
  getDb();
  insertUser(EMP, "ledger@acme.com", "Ledger Employer");
});

test("recordInvoicePayment: books a confirmed payment", () => {
  const inv = paidInvoice("Acme", "100", "aa".repeat(32));
  recordInvoicePayment(inv, "payer.testnet");
  const rows = listPayments(EMP).filter((p) => p.kind === "invoice");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "confirmed");
  assert.equal(rows[0].amount, "100");
  assert.equal(rows[0].txRef, "aa".repeat(32));
  assert.equal(rows[0].recipientWallet, "payer.testnet");
});

test("recordInvoicePayment: the same tx is never double booked", () => {
  const inv = paidInvoice("Acme", "250", "bb".repeat(32));
  recordInvoicePayment(inv, "payer.testnet");
  recordInvoicePayment(inv, "payer.testnet");
  recordInvoicePayment(inv, "someone-else.testnet");
  const rows = listPayments(EMP).filter((p) => p.kind === "invoice" && p.txRef === "bb".repeat(32));
  assert.equal(rows.length, 1);
});

test("different invoices with different tx hashes each book once", () => {
  const a = paidInvoice("Client A", "10", "cc".repeat(32));
  const b = paidInvoice("Client B", "20", "dd".repeat(32));
  recordInvoicePayment(a, "a.testnet");
  recordInvoicePayment(b, "b.testnet");
  const rows = listPayments(EMP).filter((p) => p.kind === "invoice");
  assert.ok(rows.length >= 4); // the two above + the ones from earlier tests in this file
  assert.ok(rows.some((p) => p.txRef === "cc".repeat(32)));
  assert.ok(rows.some((p) => p.txRef === "dd".repeat(32)));
});

test("recordPayment: one off send, then linked to an employee by wallet", () => {
  const emp = addEmployee(EMP, { name: "Dave", wallet: WALLET, asset: "NEAR" });
  const id = recordPayment({
    employerId: EMP,
    employeeId: findEmployee(EMP, { wallet: WALLET }),
    recipientName: "Dave",
    recipientWallet: WALLET,
    kind: "send",
    asset: "NEAR",
    amount: "2",
    note: "bonus",
    txRef: "ee".repeat(32),
    status: "sent",
  });
  assert.ok(id);
  const sends = listPayments(EMP).filter((p) => p.id === id);
  assert.equal(sends.length, 1);
  assert.equal(sends[0].kind, "send");
  assert.equal(sends[0].employeeId, emp.id);
});

test("findEmployee: wallet and email lookups, scoped per employer", () => {
  const e1 = addEmployee(EMP, { name: "Eve", email: "eve@acme.com", wallet: "3c".repeat(32) });
  assert.equal(findEmployee(EMP, { email: "eve@acme.com" }), e1.id);
  assert.equal(findEmployee(EMP, { wallet: "3C".repeat(32) }), e1.id); // case insensitive
  assert.equal(findEmployee("other-employer", { email: "eve@acme.com" }), null);
});

test("listPayments: respects the limit", () => {
  const all = listPayments(EMP);
  assert.ok(all.length >= 4);
  const limited = listPayments(EMP, 1);
  assert.equal(limited.length, 1);
});

test("statementData: money in and money out group correctly", () => {
  // Seed a payroll-style outflow this month.
  recordPayment({
    employerId: EMP,
    recipientName: "Payroll",
    recipientWallet: "4d".repeat(32),
    kind: "payroll",
    asset: "NEAR",
    amount: "100",
    note: "October payroll",
    txRef: "ff".repeat(32),
    status: "sent",
  });
  const db = getDb();
  const now = db.prepare("SELECT strftime('%Y-%m', 'now') AS m").get() as { m: string };
  const { paid, out } = statementData(EMP, now.m, now.m);
  assert.ok(paid.length >= 4); // confirmed invoice payments
  assert.ok(out.length >= 1); // the payroll outflow
  const payrollRow = out.find((r: any) => r.tx_ref === "ff".repeat(32));
  assert.ok(payrollRow);
  assert.equal(payrollRow.kind, "payroll");
});

test("statementData: empty window returns empty arrays", () => {
  const { paid, out, runs } = statementData(EMP, "1999-01", "1999-02");
  assert.deepEqual(paid, []);
  assert.deepEqual(out, []);
  assert.deepEqual(runs, []);
});
