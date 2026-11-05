/**
 * Payroll engine — CSV parsing, validation, and batch execution.
 *
 * Execution modes per run (set by privacy level):
 *  - transparent: employer's smart account sends NEAR/USDC directly to each
 *    employee's NEAR account. One tx per employee (batched sequentially to
 *    respect per-account nonce ordering).
 *  - shielded / compliant: employer derives a one-time stealth implicit
 *    account per employee and funds it. Employees claim from their device.
 *    (compliant additionally records the viewing key for audit.)
 *
 * Max 50 employees per run (product decision).
 */
import { getDb } from "./db";
import { newVaultId } from "./crypto";
import {
  isPrivacyLevel,
  PrivacyLevel,
  derivePayrollDestination,
} from "./privacy";
import {
  accountFromVault,
  sendNear,
  sendUsdc,
  toYocto,
  usdcToBase,
  NearConfig,
  defaultNearConfig,
} from "./near";
import { recordPayment, fromBase } from "./payments";
import { findEmployee, bumpPrivacy } from "./employees";

export const MAX_EMPLOYEES_PER_RUN = 50;

export interface CsvEmployee {
  email: string;
  name: string;
  amount: string; // human-readable ("1500", "1.5")
  asset?: string; // NEAR | USDC — defaults to run asset
  privacy?: PrivacyLevel; // per-row override
  nearAccount?: string; // required for transparent mode
  stealthMeta?: string; // required for shielded/compliant mode
}

export interface ParsedCsv {
  employees: CsvEmployee[];
  errors: string[];
}

/**
 * Minimal CSV parser (no deps): handles quoted fields, commas, CRLF.
 * Expected header (case-insensitive): email,name,amount,near_account,stealth_meta,privacy
 * Unknown columns are ignored; per-row privacy/asset override the run.
 */
export function parsePayrollCsv(text: string): ParsedCsv {
  const rows = parseCsvRows(text);
  const errors: string[] = [];
  if (rows.length === 0) return { employees: [], errors: ["empty CSV"] };

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name);
  const iEmail = idx("email");
  const iName = idx("name");
  const iAmount = idx("amount");
  const iAccount = idx("near_account");
  const iStealth = idx("stealth_meta");
  const iPrivacy = idx("privacy");

  if (iEmail < 0 || iAmount < 0) {
    return {
      employees: [],
      errors: ["CSV must have at least 'email' and 'amount' columns"],
    };
  }

  const employees: CsvEmployee[] = [];
  const seen = new Set<string>();

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const email = (row[iEmail] || "").trim().toLowerCase();
    if (!email) {
      errors.push(`row ${r + 1}: missing email`);
      continue;
    }
    if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)) {
      errors.push(`row ${r + 1}: invalid email "${email}"`);
      continue;
    }
    if (seen.has(email)) {
      errors.push(`row ${r + 1}: duplicate email ${email}`);
      continue;
    }
    seen.add(email);

    const amount = (row[iAmount] || "").trim();
    if (!/^\d+(\.\d{1,6})?$/.test(amount) || parseFloat(amount) <= 0) {
      errors.push(`row ${r + 1}: bad amount "${amount}"`);
      continue;
    }

    const emp: CsvEmployee = {
      email,
      name: (row[iName] || "").trim(),
      amount,
    };
    if (iAccount >= 0) emp.nearAccount = (row[iAccount] || "").trim();
    if (iStealth >= 0) emp.stealthMeta = (row[iStealth] || "").trim();
    if (iPrivacy >= 0) {
      const p = (row[iPrivacy] || "").trim().toLowerCase();
      if (p) {
        if (isPrivacyLevel(p)) emp.privacy = p;
        else errors.push(`row ${r + 1}: bad privacy level "${p}"`);
      }
    }
    employees.push(emp);
  }

  if (employees.length > MAX_EMPLOYEES_PER_RUN) {
    errors.push(
      `too many employees (${employees.length}); max is ${MAX_EMPLOYEES_PER_RUN} per run — split into multiple runs`
    );
  }
  return { employees, errors };
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      cur.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      cur.push(field);
      field = "";
      if (cur.some((f) => f.trim() !== "")) rows.push(cur);
      cur = [];
    } else field += c;
  }
  cur.push(field);
  if (cur.some((f) => f.trim() !== "")) rows.push(cur);
  return rows;
}

export interface CreateRunInput {
  employerId: string;
  name: string;
  asset: "NEAR" | "USDC";
  privacy: PrivacyLevel;
  usdcContract?: string;
  items: CsvEmployee[];
}

/** Persist a draft run + items. Returns run id. */
export function createRun(input: CreateRunInput): string {
  const db = getDb();
  const runId = newVaultId();
  const totalYocto =
    input.asset === "NEAR"
      ? input.items.reduce((s, e) => s + toYocto(e.amount), 0n)
      : 0n; // USDC total tracked in base units via items
  db.prepare(
    `INSERT INTO payroll_runs (id, employer_id, name, asset, usdc_contract, privacy, status, total_yocto, employee_count)
     VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?)`
  ).run(runId, input.employerId, input.name, input.asset, input.usdcContract ?? null, input.privacy, totalYocto.toString(), input.items.length);
  const ins = db.prepare(
    `INSERT INTO payroll_items (id, run_id, recipient_email, recipient_name, amount_yocto, privacy, stealth_addr, near_account, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
  );
  const tx = db.transaction(() => {
    for (const e of input.items) {
      const privacy = e.privacy ?? input.privacy;
      const amount =
        input.asset === "NEAR" ? toYocto(e.amount) : usdcToBase(e.amount);
      ins.run(newVaultId(), runId, e.email, e.name, amount.toString(), privacy, e.stealthMeta ?? null, e.nearAccount ?? null);
    }
  });
  tx();
  return runId;
}

export interface RunSummary {
  id: string;
  name: string;
  asset: string;
  privacy: PrivacyLevel;
  status: string;
  employee_count: number;
  total_yocto: string;
  near_ref: string | null;
  executed_at: string | null;
  created_at: string;
  items: {
    email: string;
    name: string;
    amount: string;
    privacy: PrivacyLevel;
    status: string;
    tx_ref: string | null;
    error: string | null;
  }[];
}

export function getRun(runId: string, employerId?: string): RunSummary | null {
  const db = getDb();
  const where = employerId ? "WHERE r.id = ? AND r.employer_id = ?" : "WHERE r.id = ?";
  const run = db
    .prepare(
      `SELECT * FROM payroll_runs r ${where}`
    )
    .get(...(employerId ? [runId, employerId] : [runId])) as
    | Record<string, unknown>
    | undefined;
  if (!run) return null;
  const items = db
    .prepare(
      `SELECT recipient_email, recipient_name, amount_yocto, privacy, status, tx_ref, error FROM payroll_items WHERE run_id = ? ORDER BY rowid`
    )
    .all(runId) as Record<string, unknown>[];
  return {
    id: String(run.id),
    name: String(run.name),
    asset: String(run.asset),
    privacy: run.privacy as PrivacyLevel,
    status: String(run.status),
    employee_count: Number(run.employee_count),
    total_yocto: String(run.total_yocto),
    near_ref: (run.near_ref as string | null) ?? null,
    executed_at: (run.executed_at as string | null) ?? null,
    created_at: String(run.created_at),
    items: items.map((i) => ({
      email: String(i.recipient_email),
      name: String(i.recipient_name ?? ""),
      amount: String(i.amount_yocto),
      privacy: i.privacy as PrivacyLevel,
      status: String(i.status),
      tx_ref: (i.tx_ref as string | null) ?? null,
      error: (i.error as string | null) ?? null,
    })),
  };
}

export function listRuns(employerId: string): RunSummary[] {
  const db = getDb();
  const runs = db
    .prepare(`SELECT id FROM payroll_runs WHERE employer_id = ? ORDER BY created_at DESC`)
    .all(employerId) as { id: string }[];
  return runs
    .map((r) => getRun(r.id, employerId))
    .filter((r): r is RunSummary => r !== null);
}

export interface ExecuteResult {
  runId: string;
  executed: number;
  failed: number;
  results: { email: string; status: string; txRef?: string; error?: string }[];
}

/**
 * Execute a run. Requires the employer's unlocked vault material
 * (passphrase-verified) because we sign with their master key.
 *
 * Sequential on purpose: per-account nonce must be strictly ordered.
 * 50 employees × ~2s per tx is acceptable for MVP; a gas-key / meta-transaction
 * batcher is the scale-up path.
 */
export async function executeRun(
  runId: string,
  vault: { nearMasterKey: string; nearAccount: string },
  cfg: NearConfig = defaultNearConfig()
): Promise<ExecuteResult> {
  const db = getDb();
  const run = db.prepare(`SELECT * FROM payroll_runs WHERE id = ?`).get(runId) as
    | Record<string, unknown>
    | undefined;
  if (!run) throw new Error("run not found");
  if (run.status === "executing") throw new Error("run already executing");
  if (run.status === "done" || run.status === "failed")
    throw new Error(`run already finished (${run.status})`);

  db.prepare(`UPDATE payroll_runs SET status = 'executing' WHERE id = ?`).run(runId);

  const account = accountFromVault(vault.nearAccount, vault.nearMasterKey);
  const asset = String(run.asset);
  const employerId = String(run.employer_id);
  const results: ExecuteResult["results"] = [];
  let executed = 0;
  let failed = 0;

  const items = db
    .prepare(
      `SELECT id, recipient_email, recipient_name, amount_yocto, privacy, stealth_addr, near_account, status FROM payroll_items WHERE run_id = ? AND status = 'pending' ORDER BY rowid`
    )
    .all(runId) as Record<string, unknown>[];

  for (const item of items) {
    const email = String(item.recipient_email);
    const privacy = String(item.privacy) as PrivacyLevel;
    const amountStr = String(item.amount_yocto);
    const stealthMeta = (item.stealth_addr as string | null) ?? null;
    try {
      let txHash = "";
      let dest = "";
      if (privacy === "transparent") {
        // Destination: the NEAR account the employer supplied in the CSV, else
        // fall back to a registered NearHr user with that email.
        dest = (item.near_account as string | null) ?? (await resolveTransparentDest(email)) ?? "";
        if (!dest) throw new Error("no NEAR account for transparent recipient");
        if (asset === "NEAR") {
          txHash = (await sendNear(account, dest, BigInt(amountStr))).txHash;
        } else {
          txHash = (await sendUsdc(account, dest, BigInt(amountStr), cfg)).txHash;
        }
      } else {
        // shielded / compliant: fund a one-time stealth implicit account
        if (!stealthMeta) throw new Error("missing stealth meta address");
        const destSt = derivePayrollDestination(stealthMeta);
        dest = destSt.implicitAccountId;
        if (asset === "NEAR") {
          txHash = (await sendNear(account, dest, BigInt(amountStr))).txHash;
        } else {
          txHash = (await sendUsdc(account, dest, BigInt(amountStr), cfg)).txHash;
        }
      }
      db.prepare(`UPDATE payroll_items SET status='executed', tx_ref=?, executed_at=datetime('now') WHERE id=?`).run(
        txHash || "ok",
        item.id
      );
      executed++;
      // ledger: link the payout to the employee directory (best effort) so
      // "last paid" stays accurate. Never let a ledger hiccup fail the run.
      try {
        const empId = findEmployee(employerId, {
          email,
          wallet: privacy === "transparent" ? dest : undefined,
        });
        // keep the team directory privacy label in sync with how this person
        // was actually paid (stealth payout upgrades the level in place)
        if (empId) bumpPrivacy(employerId, empId, privacy);
        recordPayment({
          employerId,
          employeeId: empId,
          recipientName: String(item.recipient_name ?? ""),
          recipientWallet: dest,
          kind: "payroll",
          asset: asset as "NEAR" | "USDC",
          amount: fromBase(asset as "NEAR" | "USDC", amountStr),
          note: String(run.name),
          txRef: txHash || "ok",
          status: "sent",
        });
      } catch {
        // ignore ledger errors
      }
      results.push({ email, status: "executed", txRef: txHash });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      db.prepare(`UPDATE payroll_items SET status='failed', error=? WHERE id=?`).run(msg, item.id);
      failed++;
      results.push({ email, status: "failed", error: msg });
    }
  }

  const finalStatus = failed === 0 ? "done" : executed > 0 ? "done" : "failed";
  db.prepare(
    `UPDATE payroll_runs SET status=?, executed_at=datetime('now'), near_ref=? WHERE id=?`
  ).run(finalStatus, results.map((r) => r.txRef).filter(Boolean).slice(-1)[0] ?? "", runId);

  return { runId, executed, failed, results };
}

/**
 * Resolve the destination account for a transparent transfer.
 * Order: (1) a registered NearHr user with that email, (2) the item's
 * stealth meta's underlying account is NOT valid for transparent — so require
 * the employer to have supplied a NEAR account. For MVP we accept the email
 * matching a user's NEAR account, else we require the row to carry one.
 */
async function resolveTransparentDest(email: string): Promise<string | null> {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT v.near_account FROM users u JOIN vaults v ON v.user_id = u.id WHERE lower(u.email) = ?`
    )
    .get(email.toLowerCase()) as { near_account: string } | undefined;
  return row?.near_account ?? null;
}
