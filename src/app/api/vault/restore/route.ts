import { NextRequest, NextResponse } from "next/server";
import { resolveSession, COOKIE } from "@/lib/sessions";
import { restoreVaultFromBackup } from "@/lib/vault";


// POST /api/vault/restore { backupJson, passphrase } -> restore vault
export async function POST(req: NextRequest) {
  const userId = resolveSession(req.cookies.get(COOKIE)?.value);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const backupJson = String(body?.backupJson ?? "");
  const passphrase = String(body?.passphrase ?? "");
  if (!backupJson || !passphrase)
    return NextResponse.json({ error: "backupJson and passphrase required" }, { status: 400 });
  try {
    const out = restoreVaultFromBackup(userId, backupJson, passphrase);
    return NextResponse.json({ ok: true, nearAccount: out.nearAccount });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
