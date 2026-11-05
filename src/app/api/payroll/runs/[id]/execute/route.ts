import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { resolveSession, COOKIE } from "@/lib/sessions";
import { executeRun } from "@/lib/payroll";
import { ensureVault, unlockVault } from "@/lib/vault";

// POST /api/payroll/runs/:id/execute
// Employer confirms the run; the vault auto-unlocks (no passphrase), we sign
// with their master key and execute each line item (sequential).
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

  let vault;
  try {
    ensureVault(userId);
    vault = unlockVault(userId);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }

  try {
    const result = await executeRun(
      id,
      {
        nearMasterKey: vault.nearMasterKey,
        nearAccount: vault.nearAccount,
      },
      userId
    );
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
