import { NextRequest, NextResponse } from "next/server";
import { resolveSession, COOKIE } from "@/lib/sessions";
import { getDb } from "@/lib/db";
import { ensureVault, unlockVault } from "@/lib/vault";
import { sendOneOff, PaymentAsset, isNearAccount } from "@/lib/payments";
import { isPrivacyLevel, derivePayrollDestination, PrivacyLevel } from "@/lib/privacy";

/**
 * Resolve the on chain destination for a one off send given a privacy level.
 *  - transparent: straight to the recipient's wallet.
 *  - shielded / compliant: fund a one time SIP stealth implicit account derived
 *    from the recipient's meta address. The recipient (a registered NearHr user)
 *    claims it from their device. Only valid for registered recipients because
 *    the claim needs their viewing key, and USDC must land on a registered
 *    account (a fresh implicit wallet cannot hold USDC).
 */
function resolveSendDestination(
  employerId: string,
  to: string,
  privacy: PrivacyLevel,
  asset: PaymentAsset
): { dest: string; destKind: string; recipientName: string | null } {
  const t = to.trim().toLowerCase();
  if (privacy === "transparent") return { dest: t, destKind: "wallet", recipientName: null };

  const row = getDb()
    .prepare(
      `SELECT u.name, v.sip_meta_address
       FROM users u JOIN vaults v ON v.user_id = u.id
       WHERE v.near_account = ? OR lower(u.email) = ? LIMIT 1`
    )
    .get(t, t) as { name: string; sip_meta_address: string | null } | undefined;

  if (!row?.sip_meta_address) {
    throw new Error(
      asset === "USDC"
        ? "shielded USDC sends need a registered NearHr recipient who can claim the stealth payout"
        : "shielded sends need the recipient to be a registered NearHr account"
    );
  }
  const dest = derivePayrollDestination(row.sip_meta_address).implicitAccountId;
  if (!isNearAccount(dest)) throw new Error("could not derive a stealth destination");
  return { dest, destKind: privacy === "compliant" ? "stealth-audit" : "stealth", recipientName: row.name };
}

// POST /api/send  { to, asset, amount, privacy?, note?, employeeId? } -> one off payout
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
    privacy?: string;
    note?: string;
    employeeId?: string | null;
  } | null;
  if (!body?.to || !body?.amount)
    return NextResponse.json({ error: "to and amount are required" }, { status: 400 });
  const asset: PaymentAsset = body.asset === "USDC" ? "USDC" : "NEAR";
  const privacy: PrivacyLevel = body.privacy && isPrivacyLevel(body.privacy) ? body.privacy : "transparent";

  let vault;
  try {
    ensureVault(userId);
    vault = unlockVault(userId);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }

  let dest: { dest: string; destKind: string; recipientName: string | null };
  try {
    dest = resolveSendDestination(userId, String(body.to), privacy, asset);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }

  try {
    const res = await sendOneOff(
      {
        employerId: userId,
        to: dest.dest,
        asset,
        amount: String(body.amount),
        note:
          body.note ??
          (dest.destKind === "wallet" ? undefined : `sent ${privacy} via stealth`),
        employeeId: body.employeeId ?? null,
      },
      { nearAccount: vault.nearAccount, nearMasterKey: vault.nearMasterKey }
    );
    return NextResponse.json(
      { ...res, destKind: dest.destKind, privacy, recipientName: dest.recipientName },
      { status: 201 }
    );
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
