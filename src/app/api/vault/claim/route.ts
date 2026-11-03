import { NextRequest, NextResponse } from "next/server";
import { resolveSession, COOKIE } from "@/lib/sessions";
import { ensureVault, unlockVault } from "@/lib/vault";
import { isMineForEmployee, claimPayment, Hex } from "@/lib/privacy";

// POST /api/vault/claim { pending }
//   pending: { stealthAddress: { address, ephemeralPublicKey, viewTag }, balanceYocto }
// Checks the pending stealth payment against the employee's viewing key and,
// if it's theirs, returns the one-time private key + implicit account so the
// client can sign the sweep on NEAR. No passphrase — server-side unlock.
export async function POST(req: NextRequest) {
  const userId = resolveSession(req.cookies.get(COOKIE)?.value);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const pending = body?.pending;
  if (!pending) return NextResponse.json({ error: "pending required" }, { status: 400 });

  let plain;
  try {
    ensureVault(userId);
    plain = unlockVault(userId);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
  const employee = {
    metaAddress: plain.sipMetaAddress,
    spendingPrivateKey: plain.sipSpendingKey as Hex,
    viewingPrivateKey: plain.sipViewingKey as Hex,
  };
  const mine = isMineForEmployee(pending, employee);
  if (!mine) return NextResponse.json({ mine: false });
  const claim = claimPayment(pending, employee);
  return NextResponse.json({ mine: true, claim });
}
