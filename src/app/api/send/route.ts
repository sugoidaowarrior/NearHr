import { NextRequest, NextResponse } from "next/server";
import { resolveSession, COOKIE } from "@/lib/sessions";
import { getDb } from "@/lib/db";
import { ensureVault, unlockVault } from "@/lib/vault";
import { sendOneOff, PaymentAsset } from "@/lib/payments";

// POST /api/send  { to, asset, amount, note?, employeeId? } -> one off payout
export async function POST(req: NextRequest) {
  const userId = resolveSession(req.cookies.get(COOKIE)?.value);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const role = (getDb().prepare("SELECT role FROM users WHERE id = ?").get(userId) as
    | { role: string }
    | undefined)?.role;
  if (role !== "employer")
    return NextResponse.json({ error: "employer role required" }, { status: 403 });

  const body = (await req.json().catch(() => null)) as {
    to?: string;
    asset?: string;
    amount?: string;
    note?: string;
    employeeId?: string | null;
  } | null;
  if (!body?.to || !body?.amount)
    return NextResponse.json({ error: "to and amount are required" }, { status: 400 });
  const asset: PaymentAsset = body.asset === "USDC" ? "USDC" : "NEAR";

  let vault;
  try {
    ensureVault(userId);
    vault = unlockVault(userId);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }

  try {
    const res = await sendOneOff(
      {
        employerId: userId,
        to: String(body.to),
        asset,
        amount: String(body.amount),
        note: body.note,
        employeeId: body.employeeId ?? null,
      },
      { nearAccount: vault.nearAccount, nearMasterKey: vault.nearMasterKey }
    );
    return NextResponse.json(res, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
