import { getDb } from "./db";
import { listEmployees } from "./employees";

/**
 * Payroll reminder engine. Tracks a single schedule per employer (payday,
 * frequency, how many days before payday HR gets nudged, and the reminder
 * email). It computes the next due date, whether payroll is overdue, and how
 * many active employees are due, and returns a mail ready reminder payload the
 * UI surfaces as a banner (and can hand to a mail provider when one is set).
 *
 * No mail provider is wired in the MVP: reminders are persisted and shown in
 * the dashboard, and the email is recorded as "queued" so the flow is complete
 * end to end. Drop a `sendReminderEmail()` implementation in here to go live.
 */

export type Frequency = "monthly" | "biweekly" | "weekly";
const FREQ: Frequency[] = ["monthly", "biweekly", "weekly"];

export interface Schedule {
  frequency: Frequency;
  payDay: number; // 1..28
  reminderDays: number;
  remindEmail: string | null;
  active: boolean;
  nextDue: string | null;
  updatedAt?: string;
}

export interface ScheduleState extends Schedule {
  isOverdue: boolean;
  daysUntilDue: number | null; // negative when overdue
  reminderWindow: boolean; // true when within reminderDays of payday
  dueEmployeeCount: number;
  unpaidEmployeeCount: number;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/**
 * Next occurrence of the payday. monthly -> day of month (clamped to 28 so it
 * never lands on 29..31); biweekly -> every 14 days from the stored anchor;
 * weekly -> every 7 days.
 */
function nextDue(sched: Schedule, from: Date): Date {
  const anchor =
    sched.nextDue && !Number.isNaN(parseLocalDate(sched.nextDue).getTime())
      ? parseLocalDate(sched.nextDue)
      : from;

  if (sched.frequency === "monthly") {
    const day = Math.min(Math.max(1, sched.payDay), 28);
    const base = new Date(from.getFullYear(), from.getMonth(), 1);
    let candidate = new Date(from.getFullYear(), from.getMonth(), day);
    if (candidate < base) candidate = new Date(from.getFullYear(), from.getMonth(), 1);
    // step forward until strictly after today
    while (candidate.getTime() <= from.getTime()) {
      candidate = new Date(candidate.getFullYear(), candidate.getMonth() + 1, day);
    }
    return candidate;
  }

  // biweekly / weekly
  const stepDays = sched.frequency === "biweekly" ? 14 : 7;
  let candidate = anchor;
  // snap the anchor into a clean cycle relative to today
  if (candidate.getTime() < from.getTime()) {
    let guard = 0;
    while (candidate.getTime() <= from.getTime() && guard < 400) {
      candidate = addDays(candidate, stepDays);
      guard++;
    }
  }
  return candidate;
}

function readSchedule(employerId: string): Schedule | null {
  const row = getDb()
    .prepare(
      `SELECT frequency, pay_day, reminder_days, remind_email, active, next_due, updated_at
       FROM payroll_schedules WHERE employer_id = ?`
    )
    .get(employerId) as
    | {
        frequency: string;
        pay_day: number;
        reminder_days: number;
        remind_email: string | null;
        active: number;
        next_due: string | null;
        updated_at: string;
      }
    | undefined;
  if (!row) return null;
  return {
    frequency: FREQ.includes(row.frequency as Frequency) ? (row.frequency as Frequency) : "monthly",
    payDay: row.pay_day,
    reminderDays: row.reminder_days,
    remindEmail: row.remind_email,
    active: row.active === 1,
    nextDue: row.next_due,
    updatedAt: row.updated_at,
  };
}

export function getScheduleState(employerId: string): ScheduleState {
  const now = new Date();
  const today = todayIso();
  const row = readSchedule(employerId);

  const base: Schedule =
    row ??
    ({
      frequency: "monthly",
      payDay: 28,
      reminderDays: 3,
      remindEmail: null,
      active: true,
      nextDue: null,
    } as Schedule);

  const due = nextDue(base, now);
  const dueIso = iso(due);
  const daysUntilDue = Math.round((due.getTime() - now.getTime()) / (24 * 3600_000));
  const isOverdue = dueIso < today;
  const reminderWindow = !row?.active ? false : daysUntilDue >= 0 && daysUntilDue <= base.reminderDays;

  const emps = listEmployees(employerId).filter((e) => e.status === "active");
  const dueEmployeeCount = emps.length;
  const unpaidEmployeeCount = emps.filter((e) => !e.lastPaidAt).length;

  return {
    ...base,
    nextDue: dueIso,
    isOverdue,
    daysUntilDue,
    reminderWindow,
    dueEmployeeCount,
    unpaidEmployeeCount,
  };
}

export interface ScheduleInput {
  frequency?: Frequency;
  payDay?: number;
  reminderDays?: number;
  remindEmail?: string | null;
  active?: boolean;
}

/** Upsert the employer's schedule. Recomputes next_due. */
export function saveSchedule(employerId: string, input: ScheduleInput): ScheduleState {
  const db = getDb();
  const cur = readSchedule(employerId) ?? {
    frequency: "monthly",
    payDay: 28,
    reminderDays: 3,
    remindEmail: null,
    active: true,
    nextDue: null,
  };

  const frequency: Frequency =
    input.frequency && FREQ.includes(input.frequency) ? input.frequency : cur.frequency;
  let payDay =
    input.payDay !== undefined && Number.isInteger(input.payDay) && input.payDay >= 1 && input.payDay <= 28
      ? input.payDay
      : cur.payDay;
  if (frequency !== "monthly") payDay = 28; // only monthly uses the day
  const reminderDays =
    input.reminderDays !== undefined && Number.isInteger(input.reminderDays) && input.reminderDays >= 0 && input.reminderDays <= 30
      ? input.reminderDays
      : cur.reminderDays;
  const remindEmail =
    input.remindEmail !== undefined
      ? input.remindEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.remindEmail)
        ? input.remindEmail
        : null
      : cur.remindEmail;
  const active = input.active !== undefined ? input.active : cur.active;

  const next = nextDue({ frequency, payDay, reminderDays, remindEmail, active, nextDue: cur.nextDue }, new Date());

  db.prepare(
    `INSERT INTO payroll_schedules (employer_id, frequency, pay_day, reminder_days, remind_email, active, next_due, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(employer_id) DO UPDATE SET
       frequency = excluded.frequency,
       pay_day = excluded.pay_day,
       reminder_days = excluded.reminder_days,
       remind_email = excluded.remind_email,
       active = excluded.active,
       next_due = excluded.next_due,
       updated_at = datetime('now')`
  ).run(employerId, frequency, payDay, reminderDays, remindEmail, active ? 1 : 0, iso(next));

  return getScheduleState(employerId);
}

export interface ReminderPayload {
  to: string | null;
  employerId: string;
  subject: string;
  body: string;
  overdue: boolean;
  dueEmployeeCount: number;
  unpaidEmployeeCount: number;
  nextDue: string;
}

/** Build the reminder email body (mail ready). */
export function buildReminder(employerId: string): ReminderPayload | null {
  const s = getScheduleState(employerId);
  const who = s.dueEmployeeCount === 0 ? "your team" : `${s.dueEmployeeCount} active employee${s.dueEmployeeCount === 1 ? "" : "s"}`;
  const line = s.isOverdue
    ? `Payroll is overdue. Payday has passed.`
    : s.reminderWindow
      ? `Payroll for ${who} is due in ${s.daysUntilDue} day${s.daysUntilDue === 1 ? "" : "s"}.`
      : `Payroll for ${who} is due on ${s.nextDue}.`;
  return {
    to: s.remindEmail,
    employerId,
    subject: `NearHr payroll reminder: ${s.isOverdue ? "overdue" : `due ${s.nextDue}`}`,
    body: `Hello,\n\n${line}\n\n${s.unpaidEmployeeCount} of ${s.dueEmployeeCount} active employees have no recorded payment yet.\n\nSign in to NearHr to run payroll.\n`,
    overdue: s.isOverdue,
    dueEmployeeCount: s.dueEmployeeCount,
    unpaidEmployeeCount: s.unpaidEmployeeCount,
    nextDue: s.nextDue ?? todayIso(),
  };
}
