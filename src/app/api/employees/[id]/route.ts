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

import { updateEmployee, deleteEmployee, EmployeeInput } from "@/lib/employees";

// PUT /api/employees/:id  { partial employee fields }
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireEmployer(req);
  if (auth.error) return auth.error;
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as Partial<EmployeeInput> | null;
  if (!body) return NextResponse.json({ error: "invalid body" }, { status: 400 });
  try {
    const emp = updateEmployee(auth.userId!, id, body);
    return NextResponse.json({ employee: emp });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: msg.includes("not found") ? 404 : 400 });
  }
}

// DELETE /api/employees/:id
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireEmployer(req);
  if (auth.error) return auth.error;
  const { id } = await params;
  try {
    deleteEmployee(auth.userId!, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: msg.includes("not found") ? 404 : 400 });
  }
}
