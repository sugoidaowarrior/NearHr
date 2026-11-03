import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { resolveSession, COOKIE } from "@/lib/sessions";
import { unlockVault } from "@/lib/vault";


// POST /api/balance  { passphrase } -> unlocked balance (NEAR + optional USDC)
export async function POST(req: NextRequest) {
  const userId = resolveSession(req.cookies.get(COOKIE)?.value);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const passphrase = String(body?.passphrase ?? "");
  let vault;
  try {
    vault = unlockVault(userId, passphrase);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
  const { accountFromVault, balanceOf, yoctoToNear } = await import("@/lib/near");
  const account = accountFromVault(vault.nearAccount, vault.nearMasterKey);
  const near = await balanceOf(account).catch((e) => null);
  return NextResponse.json({
    nearAccount: vault.nearAccount,
    near: near !== null ? { yocto: near.toString(), human: yoctoToNear(near) } : null,
    error: near === null ? "could not read balance (check NEAR_NETWORK)" : undefined,
  });
}
