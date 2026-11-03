import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { resolveSession, COOKIE } from "@/lib/sessions";
import { getScheduleState } from "@/lib/schedule";
import { listEmployees } from "@/lib/employees";
import { listPayments } from "@/lib/payments";
import { getPrices } from "@/lib/portfolio";

/**
 * GET /api/payroll/summary
 *
 * The dashboard headline numbers, all computed from real ledger data:
 *  - nextPayroll: the scheduled payday (from the employer's schedule)
 *  - monthTotal:  expected salary this month = sum of active employees'
 *                 monthly equivalent (weekly x 52/12, biweekly x 26/12)
 *  - monthPaid:   confirmed salary payouts already sent this month
 *  - pendingRuns: draft or confirmed runs waiting to execute
 *  - months:      last 6 months of { label, monthTotal, monthPaid, paidCount }
 *                 for the disbursed vs total payroll bar chart (amounts in NGN)
 *  - prices:      live crypto + USD/NGN prices (static fallback)
 */
export async function GET(req: NextRequest) {
  const userId = resolveSession(req.cookies.get(COOKIE)?.value);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = getDb();
  const role = (db.prepare("SELECT role FROM users WHERE id = ?").get(userId) as
    | { role: string }
    | undefined)?.role;
  if (role !== "employer")
    return NextResponse.json({ error: "employer role required" }, { status: 403 });

  const sched = getScheduleState(userId);
  const emps = listEmployees(userId);
  const actives = emps.filter((e) => e.status === "active");

  // Monthly equivalent of each active employee's salary, in their pay asset.
  const mult = (freq: string) =>
    freq === "weekly" ? 52 / 12 : freq === "biweekly" ? 26 / 12 : 1;
  const monthPlanned: Record<string, number> = { NEAR: 0, USDC: 0 };
  for (const e of actives) {
    const amt = parseFloat(e.salary);
    if (!Number.isFinite(amt) || amt <= 0) continue;
    const asset = e.asset === "USDC" ? "USDC" : "NEAR";
    monthPlanned[asset] += amt * mult(e.frequency);
  }

  const now = new Date();
  const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const curYm = ym(now);

  // Confirmed salary payouts per month (last 6 months incl. current).
  const paidByMonth: Record<string, { NEAR: number; USDC: number; count: number }> = {};
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    paidByMonth[ym(d)] = { NEAR: 0, USDC: 0, count: 0 };
  }
  let monthPaidNear = 0;
  let monthPaidUsdc = 0;
  let monthPaidCount = 0;
  for (const p of listPayments(userId, 2000)) {
    if (p.kind !== "payroll" || p.status !== "sent") continue;
    const t = new Date(p.paidAt.includes("T") ? p.paidAt : p.paidAt.replace(" ", "T") + "Z");
    if (Number.isNaN(t.getTime())) continue;
    const key = ym(t);
    const amt = parseFloat(p.amount);
    if (!Number.isFinite(amt)) continue;
    const asset = p.asset === "USDC" ? "USDC" : "NEAR";
    if (paidByMonth[key]) {
      paidByMonth[key][asset] += amt;
      paidByMonth[key].count += 1;
    }
    if (key === curYm) {
      if (asset === "USDC") monthPaidUsdc += amt;
      else monthPaidNear += amt;
      monthPaidCount += 1;
    }
  }

  // Pending runs: drafted or confirmed but not yet executed.
  const pendingRuns = (db
    .prepare(
      `SELECT name, asset, status, employee_count, total_yocto, created_at
       FROM payroll_runs WHERE employer_id = ? AND status IN ('draft','confirmed')
       ORDER BY created_at DESC`
    )
    .all(userId) as Record<string, unknown>[])
    .map((r) => ({
      name: String(r.name),
      asset: String(r.asset),
      status: String(r.status),
      employee_count: Number(r.employee_count),
      total: String(r.total_yocto),
      created_at: String(r.created_at),
    }));

  const prices = await getPrices();
  const ngnValue = (near: number, usdc: number) =>
    Math.round((near * prices.NEAR + usdc * prices.USDC) * prices.NGN);

  // Label each month by its payday, e.g. "Feb 28" (matches how HR thinks of runs).
  const payDay = Math.min(Math.max(1, sched.payDay), 28);
  const months = Object.entries(paidByMonth).map(([key, v]) => {
    const [yy, mm] = key.split("-").map(Number);
    const d = new Date(yy, mm - 1, Math.min(payDay, new Date(yy, mm, 0).getDate()));
    return {
      key,
      label: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      monthTotal: ngnValue(monthPlanned.NEAR, monthPlanned.USDC),
      monthPaid: ngnValue(v.NEAR, v.USDC),
      paidCount: v.count,
    };
  });

  const due = sched.nextDue ? new Date(sched.nextDue + "T00:00:00") : now;

  return NextResponse.json({
    nextPayroll: {
      date: sched.nextDue,
      dayName: due.toLocaleDateString("en-US", { weekday: "long" }),
      dayOfMonth: due.getDate(),
      monthName: due.toLocaleDateString("en-US", { month: "long" }),
      year: due.getFullYear(),
      frequency: sched.frequency,
      daysUntilDue: sched.daysUntilDue,
      dueEmployeeCount: sched.dueEmployeeCount,
      unpaidEmployeeCount: sched.unpaidEmployeeCount,
      isOverdue: sched.isOverdue,
    },
    month: {
      key: curYm,
      name: now.toLocaleDateString("en-US", { month: "long" }),
      plannedNear: Math.round(monthPlanned.NEAR * 100) / 100,
      plannedUsdc: Math.round(monthPlanned.USDC * 100) / 100,
      plannedNgn: ngnValue(monthPlanned.NEAR, monthPlanned.USDC),
      paidNear: Math.round(monthPaidNear * 100) / 100,
      paidUsdc: Math.round(monthPaidUsdc * 100) / 100,
      paidNgn: ngnValue(monthPaidNear, monthPaidUsdc),
      paidCount: monthPaidCount,
    },
    pendingRuns,
    months,
    prices: { NEAR: prices.NEAR, USDC: prices.USDC, NGN: prices.NGN },
  });
}
