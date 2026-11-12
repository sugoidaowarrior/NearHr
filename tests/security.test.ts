/**
 * Security tests: vault envelope encryption, session handling, OAuth state,
 * IDOR ownership checks on runs, invoices and employees, SQL injection
 * attempts through parameterized queries.
 *
 * Uses a real (isolated, temp) SQLite database. No network, no NEAR chain.
 */
import "./_setup";
import { test, before } from "node:test";
import assert from "node:assert/strict";

import { getDb } from "../src/lib/db";
import { encryptVault, decryptVault, safeEqual, newToken } from "../src/lib/crypto";
import {
  issueSession,
  resolveSession,
  destroySession,
  sessionCookieOptions,
  COOKIE,
} from "../src/lib/sessions";
import { ensureVault, unlockVault, serverKekFor, getVaultView } from "../src/lib/vault";
import { createRun, getRun, listRuns } from "../src/lib/payroll";
import { createInvoice, getInvoiceById, getInvoiceBySlug, listInvoices } from "../src/lib/invoices";
import { addEmployee, listEmployees, updateEmployee, deleteEmployee, NEAR_ACCOUNT_RE } from "../src/lib/employees";
import { isNearAccount } from "../src/lib/payments";
import { startOAuth } from "../src/lib/google";

const EMP1 = "google-sub-111";
const EMP2 = "google-sub-222";
const WALLET1 = "0f".repeat(32);
const WALLET2 = "1e".repeat(32);

function insertUser(id: string, email: string, name: string) {
  getDb()
    .prepare("INSERT OR IGNORE INTO users (id, email, name, role) VALUES (?, ?, ?, 'employer')")
    .run(id, email, name);
}

before(() => {
  getDb(); // init the temp database
  insertUser(EMP1, "emp1@acme.com", "Employer One");
  insertUser(EMP2, "emp2@acme.com", "Employer Two");
  // Google client id so startOAuth() does not throw (value is not validated here).
  process.env.GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com";
});

/* ── vault envelope encryption ─────────────────────────────────────── */

test("encrypt/decrypt round trip preserves the key material", () => {
  const plain = {
    nearMasterKey: "ed25519-abc123",
    nearAccount: "ab".repeat(32),
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  const rec = encryptVault(plain, "correct horse");
  const back = decryptVault(rec, "correct horse");
  assert.equal(back.nearMasterKey, plain.nearMasterKey);
  assert.equal(back.nearAccount, plain.nearAccount);
});

test("wrong passphrase is rejected with a clear error", () => {
  const rec = encryptVault({ nearMasterKey: "k", nearAccount: "a", createdAt: "t" }, "right");
  assert.throws(() => decryptVault(rec, "wrong"), /wrong passphrase or corrupted vault/);
});

test("tampering with the ciphertext is detected (GCM auth tag)", () => {
  const rec = JSON.parse(
    encryptVault({ nearMasterKey: "k", nearAccount: "a", createdAt: "t" }, "pw")
  );
  // Flip a byte in the data blob: base64 decode, mutate, re-encode.
  const buf = Buffer.from(rec.data, "base64");
  buf[0] ^= 0xff;
  rec.data = buf.toString("base64");
  assert.throws(() => decryptVault(rec, "pw"));
});

test("tampering with the wrapped DEK is detected", () => {
  const rec = JSON.parse(
    encryptVault({ nearMasterKey: "k", nearAccount: "a", createdAt: "t" }, "pw")
  );
  const buf = Buffer.from(rec.dekWrapped, "base64");
  buf[buf.length - 1] ^= 0x01;
  rec.dekWrapped = buf.toString("base64");
  assert.throws(() => decryptVault(rec, "pw"));
});

test("unknown vault format is rejected", () => {
  const rec = JSON.parse(
    encryptVault({ nearMasterKey: "k", nearAccount: "a", createdAt: "t" }, "pw")
  );
  rec.v = "nearhr.vault.v2";
  assert.throws(() => decryptVault(rec, "pw"), /unknown vault format/);
});

test("legacy format (pre rename) is still decryptable", () => {
  const rec = JSON.parse(
    encryptVault({ nearMasterKey: "k", nearAccount: "a", createdAt: "t" }, "pw")
  );
  rec.v = "hushpay.vault.v1";
  const back = decryptVault(rec, "pw");
  assert.equal(back.nearMasterKey, "k");
});

test("two encryptions of the same plaintext produce different records (fresh salt + DEK)", () => {
  const a = encryptVault({ nearMasterKey: "k", nearAccount: "a", createdAt: "t" }, "pw");
  const b = encryptVault({ nearMasterKey: "k", nearAccount: "a", createdAt: "t" }, "pw");
  assert.notEqual(a, b);
});

test("safeEqual: constant time compare", () => {
  assert.equal(safeEqual("abc", "abc"), true);
  assert.equal(safeEqual("abc", "abd"), false);
  assert.equal(safeEqual("abc", "ab"), false); // different lengths
  assert.equal(safeEqual("", ""), true);
});

test("newToken: 32 bytes, base64url, unique", () => {
  const t1 = newToken();
  const t2 = newToken();
  assert.notEqual(t1, t2);
  assert.match(t1, /^[A-Za-z0-9_-]+$/);
  assert.equal(Buffer.from(t1, "base64url").length, 32);
});

/* ── sessions ──────────────────────────────────────────────────────── */

test("session: issue, resolve, destroy", () => {
  const { token, expiresAt } = issueSession(EMP1);
  assert.match(token, /^[A-Za-z0-9_-]+$/);
  assert.ok(expiresAt.getTime() > Date.now() + 6 * 24 * 3600 * 1000); // ~7 day TTL
  assert.equal(resolveSession(token), EMP1);
  destroySession(token);
  assert.equal(resolveSession(token), null);
});

test("session: unknown and empty tokens resolve to null", () => {
  assert.equal(resolveSession(undefined), null);
  assert.equal(resolveSession(""), null);
  assert.equal(resolveSession("not-a-real-token"), null);
});

test("session: expired tokens do not resolve", () => {
  const { token } = issueSession(EMP1);
  getDb().prepare("UPDATE sessions SET expires_at = datetime('now', '-1 day') WHERE token = ?").run(token);
  assert.equal(resolveSession(token), null);
  destroySession(token);
});

test("session: cookie flags are safe", () => {
  const opts = sessionCookieOptions(true);
  assert.equal(COOKIE, "hp_session");
  assert.equal(opts.httpOnly, true);
  assert.equal(opts.secure, true);
  assert.equal(opts.sameSite, "lax");
  assert.equal(opts.path, "/");
  assert.ok(opts.maxAge > 6 * 24 * 3600);
  assert.equal(sessionCookieOptions(false).secure, false);
});

/* ── oauth start ───────────────────────────────────────────────────── */

test("startOAuth: builds a valid PKCE consent URL", () => {
  const { url, state, verifier, next } = startOAuth("/dashboard");
  const u = new URL(url);
  assert.equal(u.origin + u.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(u.searchParams.get("client_id"), "test-client-id.apps.googleusercontent.com");
  assert.equal(u.searchParams.get("redirect_uri"), "http://localhost:3000/api/auth/google/callback");
  assert.equal(u.searchParams.get("response_type"), "code");
  assert.equal(u.searchParams.get("code_challenge_method"), "S256");
  assert.equal(state, u.searchParams.get("state"));
  assert.equal(next, "/dashboard");
  // S256 challenge = BASE64URL(SHA256(verifier))
  const { createHash } = require("node:crypto");
  const expectChallenge = createHash("sha256").update(verifier).digest("base64url");
  assert.equal(u.searchParams.get("code_challenge"), expectChallenge);
});

test("startOAuth: next path must be a single slash relative path", () => {
  assert.equal(startOAuth("/invoicing").next, "/invoicing");
  assert.equal(startOAuth("//evil.com").next, "/dashboard");
  assert.equal(startOAuth("http://evil.com").next, "/dashboard");
  assert.equal(startOAuth("dashboard").next, "/dashboard");
  assert.equal(startOAuth(undefined).next, "/dashboard");
  assert.equal(startOAuth("").next, "/dashboard");
});

/* ── vault per user (DB) ───────────────────────────────────────────── */

test("ensureVault: creates a 64 hex implicit account, idempotent", () => {
  const v1 = ensureVault(EMP1);
  assert.equal(v1.created, true);
  assert.match(v1.nearAccount, /^[0-9a-f]{64}$/);
  const v2 = ensureVault(EMP1);
  assert.equal(v2.created, false);
  assert.equal(v2.nearAccount, v1.nearAccount);
});

test("unlockVault: recovers the master key via the server KEK", () => {
  ensureVault(EMP1);
  const v = unlockVault(EMP1);
  assert.ok(v.nearMasterKey.length > 30);
  assert.match(v.nearAccount, /^[0-9a-f]{64}$/);
});

test("unlockVault: no vault throws", () => {
  assert.throws(() => unlockVault("no-such-user"), /no vault/);
});

test("server KEK is bound to the user id", () => {
  assert.notEqual(serverKekFor("u1"), serverKekFor("u2"));
});

test("getVaultView: reflects the created vault", () => {
  ensureVault(EMP1);
  const view = getVaultView(EMP1);
  assert.ok(view);
  assert.equal(view.userId, EMP1);
  assert.equal(view.legacy, false);
  assert.equal(view.hasBackup, false);
});

/* ── payroll runs: ownership (IDOR) ────────────────────────────────── */

test("createRun + getRun for the owning employer", () => {
  const id = createRun({
    employerId: EMP1,
    name: "October payroll",
    asset: "NEAR",
    items: [
      { email: "alice@acme.com", name: "Alice", amount: "1.5", nearAccount: WALLET1 },
      { email: "bob@acme.com", name: "Bob", amount: "2", nearAccount: WALLET2 },
    ],
  });
  const run = getRun(id, EMP1);
  assert.ok(run);
  assert.equal(run.name, "October payroll");
  assert.equal(run.employee_count, 2);
  // total = 3.5 NEAR in yocto (exact bigint math)
  assert.equal(run.total_yocto, (35n * 10n ** 23n).toString());
  assert.equal(run.items.length, 2);
  assert.equal(run.items[0].amount, (15n * 10n ** 23n).toString());
});

test("getRun: another employer cannot read the run (IDOR)", () => {
  const id = createRun({
    employerId: EMP1,
    name: "secret run",
    asset: "NEAR",
    items: [{ email: "x@acme.com", name: "X", amount: "1", nearAccount: WALLET1 }],
  });
  assert.ok(getRun(id, EMP1));
  assert.equal(getRun(id, EMP2), null);
});

test("listRuns: only the employer's own runs", () => {
  createRun({
    employerId: EMP2,
    name: "emp2 run",
    asset: "USDC",
    items: [{ email: "y@acme.com", name: "Y", amount: "1", nearAccount: WALLET1 }],
  });
  const runs1 = listRuns(EMP1);
  const runs2 = listRuns(EMP2);
  assert.ok(runs1.length >= 2);
  assert.ok(runs2.length >= 1);
  for (const r of runs1) assert.notEqual(r.name, "emp2 run");
  for (const r of runs2) assert.equal(r.status, "draft");
});

/* ── invoices: ownership + validation (IDOR) ───────────────────────── */

test("createInvoice: valid invoice, USDC default", () => {
  const inv = createInvoice(EMP1, {
    client_name: "Acme Corp",
    client_email: "billing@acme.com",
    note: "October retainer",
    amount: "250.50",
    due_date: "2026-11-15",
  });
  assert.equal(inv.status, "open");
  assert.equal(inv.asset, "USDC");
  assert.equal(inv.amount, "250.50");
  assert.match(inv.slug, /^[abcdefghjkmnpqrstuvwxyz23456789]{6}$/);
  assert.equal(inv.employer_id, EMP1);
});

test("createInvoice: validation errors", () => {
  assert.throws(
    () => createInvoice(EMP1, { client_name: "", client_email: null, note: null, amount: "1", due_date: "2026-11-15" }),
    /client name/
  );
  assert.throws(
    () => createInvoice(EMP1, { client_name: "A", client_email: "nope", note: null, amount: "1", due_date: "2026-11-15" }),
    /bad client email/
  );
  assert.throws(
    () => createInvoice(EMP1, { client_name: "A", client_email: null, note: null, amount: "0", due_date: "2026-11-15" }),
    /above zero/
  );
  assert.throws(
    () => createInvoice(EMP1, { client_name: "A", client_email: null, note: null, amount: "1.2345678", due_date: "2026-11-15" }),
    /bad amount/
  );
  assert.throws(
    () => createInvoice(EMP1, { client_name: "A", client_email: null, note: null, amount: "1", due_date: "15/11/2026" }),
    /due date/
  );
});

test("createInvoice: line items sum into the amount", () => {
  const inv = createInvoice(EMP1, {
    client_name: "Acme Corp",
    client_email: null,
    note: null,
    amount: "0",
    due_date: "2026-11-15",
    items: [
      { description: "Work A", amount: "10.5" },
      { description: "Work B", amount: "11.25" },
    ],
  });
  assert.equal(inv.amount, "21.75");
  assert.equal(getInvoiceBySlug(inv.slug)?.client_name, "Acme Corp");
});

test("getInvoiceById / listInvoices: ownership enforced (IDOR)", () => {
  const inv = createInvoice(EMP1, {
    client_name: "Confidential Client",
    client_email: null,
    note: null,
    amount: "100",
    due_date: "2026-11-20",
  });
  assert.ok(getInvoiceById(inv.id, EMP1));
  assert.equal(getInvoiceById(inv.id, EMP2), null);
  const inv2 = createInvoice(EMP2, { client_email: null, note: null, client_name: "Other", amount: "1", due_date: "2026-11-20" });
  const emp1List = listInvoices(EMP1);
  assert.ok(emp1List.some((i) => i.id === inv.id));
  assert.ok(!emp1List.some((i) => i.id === inv2.id));
});

/* ── employees: validation + ownership (IDOR) ──────────────────────── */

test("addEmployee: valid, with wallet lowercased", () => {
  const e = addEmployee(EMP1, {
    name: "Alice Smith",
    email: "alice@acme.com",
    wallet: WALLET1,
    asset: "USDC",
    salary: "2500",
    frequency: "monthly",
    payDay: 28,
  });
  assert.equal(e.name, "Alice Smith");
  assert.equal(e.wallet, WALLET1);
  assert.equal(e.asset, "USDC");
  assert.equal(e.status, "active");
});

test("addEmployee: validation errors", () => {
  assert.throws(() => addEmployee(EMP1, { name: "", wallet: WALLET1 }), /name is required/);
  assert.throws(() => addEmployee(EMP1, { name: "X", wallet: "not a wallet" }), /invalid NEAR/);
  assert.throws(() => addEmployee(EMP1, { name: "X", wallet: WALLET1, email: "bad" }), /invalid email/);
  assert.throws(() => addEmployee(EMP1, { name: "X", wallet: WALLET1, asset: "BTC" as never }), /asset must be/);
  assert.throws(() => addEmployee(EMP1, { name: "X", wallet: WALLET1, payDay: 31 }), /pay day/);
  assert.throws(() => addEmployee(EMP1, { name: "X", wallet: WALLET1, payDay: 0 }), /pay day/);
});

test("NEAR account regex: accepts valid, rejects junk", () => {
  assert.ok(NEAR_ACCOUNT_RE.test("alice.near"));
  assert.ok(NEAR_ACCOUNT_RE.test("some-sub.account-test.net")); // dashes + dots allowed
  assert.ok(!NEAR_ACCOUNT_RE.test(".leading"));
  assert.ok(!NEAR_ACCOUNT_RE.test("UPPER"));
  assert.ok(!NEAR_ACCOUNT_RE.test("has space"));
  assert.ok(!NEAR_ACCOUNT_RE.test(""));
  assert.ok(isNearAccount("alice.near"));
  assert.ok(isNearAccount("not_a_wallet")); // underscores are legal per NEAR account rules
  assert.ok(isNearAccount(WALLET1)); // implicit 64 hex
  assert.ok(!isNearAccount("nope nope")); // spaces are not account ids
  assert.ok(!isNearAccount("user@gmail.com")); // @ is not allowed
  assert.ok(!isNearAccount("a".repeat(65))); // longer than 64 chars
  assert.ok(!isNearAccount(""));
});

test("updateEmployee: only the owner can update (IDOR)", () => {
  const e = addEmployee(EMP1, { name: "Bob", wallet: WALLET2 });
  const updated = updateEmployee(EMP1, e.id, { salary: "3000" });
  assert.equal(updated.salary, "3000");
  assert.throws(() => updateEmployee(EMP2, e.id, { salary: "1" }), /employee not found/);
});

test("deleteEmployee: only the owner can delete (IDOR)", () => {
  const e = addEmployee(EMP1, { name: "Carol", wallet: WALLET1 });
  assert.throws(() => deleteEmployee(EMP2, e.id), /employee not found/);
  deleteEmployee(EMP1, e.id);
  assert.ok(!listEmployees(EMP1).some((x) => x.id === e.id));
});

test("listEmployees: scoped per employer", () => {
  const a = listEmployees(EMP1);
  const b = listEmployees(EMP2);
  assert.ok(a.length >= 2);
  for (const e of b) assert.ok(!a.some((x) => x.id === e.id));
});

/* ── SQL injection attempts through the public API ─────────────────── */

test("SQL injection: tokens, slugs and ids are treated as data", () => {
  const { token } = issueSession(EMP1);
  const inj = "x' OR '1'='1";
  assert.equal(resolveSession(inj), null);
  assert.equal(resolveSession(`${inj}--`), null);
  assert.equal(getInvoiceBySlug(inj), null);
  assert.equal(getRun("1 UNION SELECT 1,2,3,4,5,6,7,8,9,10,11", EMP1), null);
  assert.equal(getInvoiceById("1; DROP TABLE invoices;--", EMP1), null);
  // resolve the real token: still works, and the DB is intact.
  assert.equal(resolveSession(token), EMP1);
  destroySession(token);
  const count = getDb().prepare("SELECT COUNT(*) AS c FROM invoices").get() as { c: number };
  assert.ok(count.c >= 3);
});

test("SQL injection: a crafted employee id cannot leak or modify", () => {
  const before = getDb().prepare("SELECT COUNT(*) AS c FROM employees").get() as { c: number };
  assert.throws(() => updateEmployee(EMP1, "1; DROP TABLE employees;--", { salary: "1" }), /employee not found/);
  const after = getDb().prepare("SELECT COUNT(*) AS c FROM employees").get() as { c: number };
  assert.equal(before.c, after.c);
});
