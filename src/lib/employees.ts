import { randomUUID } from "node:crypto";
import { getDb } from "./db";

/**
 * Employee directory: the employer's roster of people they pay. Each profile
 * carries the wallet to pay into, pay amount, frequency and pay day so the
 * payroll and reminder engines can work off the roster alone.
 */

export type EmployeeFrequency = "monthly" | "biweekly" | "weekly";

const FREQ: readonly string[] = ["monthly", "biweekly", "weekly"];

/**
 * NEAR account id grammar (nearcore): parts of lowercase alphanumerics
 * separated by "_" or "-" joined with ".", no leading/trailing/double
 * separators. Length (2..64) is enforced at the call sites.
 */
export const NEAR_ACCOUNT_RE =
  /^(([a-z0-9]+[\-_])*[a-z0-9]+\.)*([a-z0-9]+[\-_])*[a-z0-9]+$/;

/** Length rules for account ids: min 2, max 64. */
export function nearAccountLengthOk(t: string): boolean {
  return t.length >= 2 && t.length <= 64;
}

export interface EmployeeInput {
  name: string;
  email?: string;
  department?: string;
  jobTitle?: string;
  avatar?: string | null;
  wallet: string;
  asset?: "NEAR" | "USDC";
  salary?: string;
  frequency?: EmployeeFrequency;
  payDay?: number | null;
  status?: "active" | "offboarded";
}

export interface Employee {
  id: string;
  name: string;
  email: string | null;
  department: string | null;
  jobTitle: string | null;
  avatar: string | null;
  wallet: string;
  asset: string;
  salary: string;
  frequency: string;
  payDay: number | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  lastPaidAt: string | null;
  lastPaidAmount: string | null;
  lastPaidAsset: string | null;
  timesPaid: number;
}

type Row = {
  id: string;
  name: string;
  email: string | null;
  department: string | null;
  job_title: string | null;
  avatar: string | null;
  wallet: string;
  asset: string;
  salary: string;
  frequency: string;
  pay_day: number | null;
  status: string;
  created_at: string;
  updated_at: string;
  last_paid_at: string | null;
  last_paid_amount: string | null;
  last_paid_asset: string | null;
  times_paid: number;
};

function validate(input: Partial<EmployeeInput>, { partial = false }: { partial?: boolean } = {}) {
  const out: string[] = [];
  if (!partial || input.name !== undefined) {
    if (!input.name || !input.name.trim()) out.push("employee name is required");
    else if (input.name.trim().length > 120) out.push("name too long");
  }
  if (input.wallet !== undefined) {
    const w = String(input.wallet).trim().toLowerCase();
    if (partial && !w) out.push("wallet address is required");
    if (w && !(NEAR_ACCOUNT_RE.test(w) && nearAccountLengthOk(w)) && !/^[0-9a-f]{64}$/.test(w))
      out.push(`invalid NEAR address: ${w}`);
  }
  if (input.email !== undefined && input.email) {
    const e = String(input.email).trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) out.push("invalid email address");
  }
  if (input.asset !== undefined && !["NEAR", "USDC"].includes(input.asset))
    out.push("asset must be NEAR or USDC");
  if (input.frequency !== undefined && !(FREQ as string[]).includes(input.frequency))
    out.push("frequency must be monthly, biweekly or weekly");
  if (input.status !== undefined && !["active", "offboarded"].includes(input.status))
    out.push("status must be active or offboarded");
  if (input.avatar !== undefined && input.avatar !== null && input.avatar !== "") {
    if (
      typeof input.avatar !== "string" ||
      !/^data:image\/(png|jpeg|webp|gif);base64,/.test(input.avatar) ||
      input.avatar.length > 600_000
    ) {
      out.push("avatar must be a small png, jpeg, webp or gif image");
    }
  }
  if (input.payDay !== undefined && input.payDay !== null) {
    const d = Number(input.payDay);
    if (!Number.isInteger(d) || d < 1 || d > 28) out.push("pay day must be an integer from 1 to 28");
  }
  if (input.salary !== undefined && input.salary !== null) {
    const n = Number(input.salary);
    if (Number.isNaN(n) || n < 0) out.push("salary must be zero or a positive number");
  }
  return out;
}

export function listEmployees(employerId: string): Employee[] {
  const rows = getDb()
    .prepare(
      `SELECT e.*,
        (SELECT paid_at FROM payments p
          WHERE p.employee_id = e.id AND p.status = 'sent'
          ORDER BY paid_at DESC LIMIT 1) AS last_paid_at,
        (SELECT amount FROM payments p
          WHERE p.employee_id = e.id AND p.status = 'sent'
          ORDER BY paid_at DESC LIMIT 1) AS last_paid_amount,
        (SELECT asset FROM payments p
          WHERE p.employee_id = e.id AND p.status = 'sent'
          ORDER BY paid_at DESC LIMIT 1) AS last_paid_asset,
        (SELECT COUNT(*) FROM payments p
          WHERE p.employee_id = e.id AND p.status = 'sent') AS times_paid
      FROM employees e
      WHERE e.employer_id = ?
      ORDER BY e.created_at DESC, e.name ASC`
    )
    .all(employerId) as Row[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    department: r.department,
    jobTitle: r.job_title,
    avatar: r.avatar ?? null,
    wallet: r.wallet,
    asset: r.asset,
    salary: r.salary,
    frequency: r.frequency,
    payDay: r.pay_day,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    lastPaidAt: r.last_paid_at,
    lastPaidAmount: r.last_paid_amount,
    lastPaidAsset: r.last_paid_asset,
    timesPaid: r.times_paid,
  }));
}

export function addEmployee(employerId: string, input: EmployeeInput): Employee {
  const errors = validate(input);
  if (errors.length) throw new Error(errors.join("; "));
  const db = getDb();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO employees
      (id, employer_id, name, email, department, job_title, avatar, wallet, asset, salary, frequency, pay_day, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    employerId,
    input.name.trim(),
    input.email?.trim() || null,
    input.department?.trim() || null,
    input.jobTitle?.trim() || null,
    input.avatar || null,
    String(input.wallet).trim().toLowerCase(),
    input.asset ?? "NEAR",
    String(input.salary ?? "0"),
    input.frequency ?? "monthly",
    input.payDay ?? null,
    input.status ?? "active"
  );
  const one = listEmployees(employerId).find((e) => e.id === id);
  if (!one) throw new Error("employee vanished after insert");
  return one;
}

export function updateEmployee(employerId: string, id: string, input: Partial<EmployeeInput>): Employee {
  const errors = validate(input, { partial: true });
  if (errors.length) throw new Error(errors.join("; "));
  const db = getDb();
  const owned = db
    .prepare("SELECT 1 FROM employees WHERE id = ? AND employer_id = ?")
    .get(id, employerId);
  if (!owned) throw new Error("employee not found");

  const sets: string[] = [];
  const args: (string | number | null)[] = [];
  const put = (col: string, val: string | number | null) => {
    sets.push(`${col} = ?`);
    args.push(val);
  };
  if (input.name !== undefined) put("name", input.name.trim());
  if (input.email !== undefined) put("email", input.email?.trim() || null);
  if (input.department !== undefined) put("department", input.department?.trim() || null);
  if (input.jobTitle !== undefined) put("job_title", input.jobTitle?.trim() || null);
  if (input.avatar !== undefined) put("avatar", input.avatar || null);
  if (input.wallet !== undefined) put("wallet", String(input.wallet).trim().toLowerCase());
  if (input.asset !== undefined) put("asset", input.asset);
  if (input.salary !== undefined) put("salary", String(input.salary ?? "0"));
  if (input.frequency !== undefined) put("frequency", input.frequency);
  if (input.payDay !== undefined) put("pay_day", input.payDay);
  if (input.status !== undefined) put("status", input.status);
  if (sets.length === 0) return listEmployees(employerId).find((e) => e.id === id)!;
  sets.push("updated_at = datetime('now')");
  args.push(id, employerId);
  db.prepare(`UPDATE employees SET ${sets.join(", ")} WHERE id = ? AND employer_id = ?`).run(...args);
  const one = listEmployees(employerId).find((e) => e.id === id);
  if (!one) throw new Error("employee not found");
  return one;
}

export function deleteEmployee(employerId: string, id: string): void {
  const db = getDb();
  const res = db.prepare("DELETE FROM employees WHERE id = ? AND employer_id = ?").run(id, employerId);
  if (res.changes === 0) throw new Error("employee not found");
}

/** Find an employee by wallet or email for an employer (used to link payments). */
export function findEmployee(
  employerId: string,
  match: { wallet?: string; email?: string }
): string | null {
  const db = getDb();
  if (match.wallet) {
    const w = String(match.wallet).trim().toLowerCase();
    const r = db
      .prepare("SELECT id FROM employees WHERE employer_id = ? AND lower(wallet) = ?")
      .get(employerId, w) as { id: string } | undefined;
    if (r) return r.id;
  }
  if (match.email) {
    const e = String(match.email).trim().toLowerCase();
    const r = db
      .prepare("SELECT id FROM employees WHERE employer_id = ? AND lower(email) = ?")
      .get(employerId, e) as { id: string } | undefined;
    if (r) return r.id;
  }
  return null;
}

/**
 * Map of employee_id -> latest successful payment, for a whole roster in one
 * query (avoids N queries in the table render).
 */
export function lastPaidByEmployee(employerId: string): Record<string, { paidAt: string; amount: string; asset: string }> {
  const rows = getDb()
    .prepare(
      `SELECT employee_id, paid_at, amount, asset
       FROM payments
       WHERE employer_id = ? AND employee_id IS NOT NULL AND status = 'sent'`
    )
    .all(employerId) as { employee_id: string; paid_at: string; amount: string; asset: string }[];
  const map: Record<string, { paidAt: string; amount: string; asset: string }> = {};
  for (const r of rows) {
    const cur = map[r.employee_id];
    if (!cur || r.paid_at > cur.paidAt) map[r.employee_id] = { paidAt: r.paid_at, amount: r.amount, asset: r.asset };
  }
  return map;
}
