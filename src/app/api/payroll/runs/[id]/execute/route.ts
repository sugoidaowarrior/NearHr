import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { resolveSession, COOKIE } from "@/lib/sessions";
import { unlockVault } from "@/lib/vault";
import { executeRun } from "@/lib/payroll";


// POST /api/payroll/runs/:id/execute  { passphrase }
// Employer confirms with their backup passphrase; we unlock the vault, sign
// with their master key, and execute each line item (sequential).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const userId = resolveSession(req.cookies.get(COOKIE)?.value);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const role = (getDb().prepare("SELECT role FROM users WHERE id = ?").get(userId) as
    | { role: string }
    | undefined)?.role;
  if (role !== "employer")
    return NextResponse.json({ error: "employer role required" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const passphrase = String(body?.passphrase ?? "");
  let vault;
  try {
    vault = unlockVault(userId, passphrase);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }

  try {
    const result = await executeRun(id, {
      nearMasterKey: vault.nearMasterKey,
      nearAccount: vault.nearAccount,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
