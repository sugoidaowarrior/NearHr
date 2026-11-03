import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { resolveSession, COOKIE } from "@/lib/sessions";

function requireEmployer(req: NextRequest) {
  const userId = resolveSession(req.cookies.get(COOKIE)?.value);
  if (!userId) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  const role = (getDb().prepare("SELECT role FROM users WHERE id = ?").get(userId) as
    | { role: string }
    | undefined)?.role;
  if (role !== "employer")
    return { error: NextResponse.json({ error: "employer role required" }, { status: 403 }) };
  return { userId: userId! };
}

import {
  listEmployees,
  addEmployee,
  EmployeeInput,
} from "@/lib/employees";

// GET /api/employees -> roster with last paid info
export async function GET(req: NextRequest) {
  const auth = requireEmployer(req);
  if (auth.error) return auth.error;
  return NextResponse.json({ employees: listEmployees(auth.userId!) });
}

// POST /api/employees { name, email?, department?, jobTitle?, wallet, asset?, salary?, frequency?, payDay? }
export async function POST(req: NextRequest) {
  const auth = requireEmployer(req);
  if (auth.error) return auth.error;
  const body = (await req.json().catch(() => null)) as EmployeeInput | null;
  if (!body) return NextResponse.json({ error: "invalid body" }, { status: 400 });
  try {
    const emp = addEmployee(auth.userId!, body);
    return NextResponse.json({ employee: emp }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
