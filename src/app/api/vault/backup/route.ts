import { NextRequest, NextResponse } from "next/server";
import { resolveSession, COOKIE } from "@/lib/sessions";
import { getVaultView, markBackupSent, clearBackupEmail } from "@/lib/vault";

// POST /api/vault/backup { backupEmail } -> record the optional backup
// destination (and return the bundle so the client can store/send it).
// DELETE /api/vault/backup -> clear it.
export async function POST(req: NextRequest) {
  const userId = resolveSession(req.cookies.get(COOKIE)?.value);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const backupEmail = String(body?.backupEmail ?? "").trim().toLowerCase();
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(backupEmail))
    return NextResponse.json({ error: "invalid backup email" }, { status: 400 });
  markBackupSent(userId, backupEmail);
  return NextResponse.json({
    ok: true,
    backupEmail,
    note: "Backup destination saved. You can also download the encrypted bundle below.",
  });
}

export async function DELETE(req: NextRequest) {
  const userId = resolveSession(req.cookies.get(COOKIE)?.value);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  clearBackupEmail(userId);
  return NextResponse.json({ ok: true });
}

// GET /api/vault/backup -> re-download the current bundle (no email required).
export async function GET(req: NextRequest) {
  const userId = resolveSession(req.cookies.get(COOKIE)?.value);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { getDb } = await import("@/lib/db");
  const { makeBackupBundle } = await import("@/lib/crypto");
  const row = getDb().prepare("SELECT record FROM vaults WHERE user_id = ?").get(userId) as
    | { record: string }
    | undefined;
  if (!row) return NextResponse.json({ error: "no vault" }, { status: 404 });
  const view = getVaultView(userId);
  return NextResponse.json({
    backupEmail: view?.backupEmail ?? null,
    bundle: makeBackupBundle(userId, row.record),
  });
}
