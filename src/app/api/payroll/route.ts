import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { resolveSession, COOKIE } from "@/lib/sessions";
import {
  parsePayrollCsv,
  createRun,
} from "@/lib/payroll";


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

// POST /api/payroll  { name, asset, usdcContract?, csv } -> create draft run
export async function POST(req: NextRequest) {
  const auth = requireEmployer(req);
  if (auth.error) return auth.error;
  const body = await req.json().catch(() => null);
  const name = String(body?.name ?? "").trim();
  const asset = String(body?.asset ?? "NEAR");
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  if (!["NEAR", "USDC"].includes(asset))
    return NextResponse.json({ error: "asset must be NEAR or USDC" }, { status: 400 });
  const parsed = parsePayrollCsv(String(body?.csv ?? ""));
  if (parsed.errors.length > 0)
    return NextResponse.json({ error: parsed.errors.join("; ") }, { status: 400 });
  if (parsed.employees.length === 0)
    return NextResponse.json({ error: "no valid rows" }, { status: 400 });

  const runId = createRun({
    employerId: auth.userId!,
    name,
    asset: asset as "NEAR" | "USDC",
    usdcContract: body?.usdcContract ? String(body.usdcContract) : undefined,
    items: parsed.employees,
  });
  return NextResponse.json({ runId, count: parsed.employees.length }, { status: 201 });
}
