import { NextRequest, NextResponse } from "next/server";
import { resolveSession, COOKIE } from "@/lib/sessions";
import { ensureVault, getVaultView } from "@/lib/vault";

// GET /api/vault -> vault status. Auto-provisions on first call (Umbra-style:
// the wallet exists the moment you log in — no setup form, no passphrase).
export async function GET(req: NextRequest) {
  const userId = resolveSession(req.cookies.get(COOKIE)?.value);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    ensureVault(userId);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
  return NextResponse.json({ vault: getVaultView(userId) });
}

// POST /api/vault — retained for the non-custodial path (explicit passphrase +
// a NEAR account the user already controls). The default UI never calls it.
export async function POST(req: NextRequest) {
  const userId = resolveSession(req.cookies.get(COOKIE)?.value);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const passphrase = String(body?.passphrase ?? "");
  const nearAccount = String(body?.nearAccount ?? "").trim().toLowerCase();
  if (passphrase.length < 12)
    return NextResponse.json({ error: "passphrase must be at least 12 characters" }, { status: 400 });
  if (!/^[a-z0-9.-]{1,64}\.?$/.test(nearAccount) || nearAccount.includes(".."))
    return NextResponse.json({ error: "invalid NEAR account id" }, { status: 400 });
  const { createVault } = await import("@/lib/vault");
  const db = (await import("@/lib/db")).getDb();
  if (db.prepare("SELECT 1 FROM vaults WHERE user_id = ?").get(userId))
    return NextResponse.json({ error: "vault already exists" }, { status: 409 });
  try {
    const out = createVault(userId, passphrase, nearAccount);
    return NextResponse.json(
      {
        nearAccount: out.nearAccount,
        masterPublicKey: out.masterPublicKey,
        backup: out.backup,
      },
      { status: 201 }
    );
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
