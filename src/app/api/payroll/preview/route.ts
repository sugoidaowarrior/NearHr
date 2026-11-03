import { NextRequest, NextResponse } from "next/server";
import { resolveSession, COOKIE } from "@/lib/sessions";
import { getDb } from "@/lib/db";
import { parsePayrollCsv, MAX_EMPLOYEES_PER_RUN } from "@/lib/payroll";


// POST /api/payroll/preview  { csv } -> parse + validate only, no persistence
export async function POST(req: NextRequest) {
  const userId = resolveSession(req.cookies.get(COOKIE)?.value);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const role = (getDb().prepare("SELECT role FROM users WHERE id = ?").get(userId) as
    | { role: string }
    | undefined)?.role;
  if (role !== "employer")
    return NextResponse.json({ error: "employer role required" }, { status: 403 });
  const body = await req.json().catch(() => null);
  const parsed = parsePayrollCsv(String(body?.csv ?? ""));
  return NextResponse.json({
    count: parsed.employees.length,
    max: MAX_EMPLOYEES_PER_RUN,
    errors: parsed.errors,
    employees: parsed.employees.map((e) => ({
      email: e.email,
      name: e.name,
      amount: e.amount,
      privacy: e.privacy ?? null,
      hasAccount: !!e.nearAccount,
      hasStealth: !!e.stealthMeta,
    })),
  });
}
