import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { resolveSession, COOKIE } from "@/lib/sessions";
import { markBackupSent } from "@/lib/vault";
import { makeBackupBundle } from "@/lib/crypto";


// POST /api/vault/backup { backupEmail } -> record that the backup bundle was
// delivered. MVP: the client downloads the bundle and sends it to the backup
// email itself (or a real mailer slots in behind BACKUP_SENDER_EMAIL).
export async function POST(req: NextRequest) {
  const userId = resolveSession(req.cookies.get(COOKIE)?.value);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const backupEmail = String(body?.backupEmail ?? "").trim().toLowerCase();
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(backupEmail))
    return NextResponse.json({ error: "invalid backup email" }, { status: 400 });
  const row = getDb().prepare("SELECT record FROM vaults WHERE user_id = ?").get(userId) as
    | { record: string }
    | undefined;
  if (!row) return NextResponse.json({ error: "no vault" }, { status: 404 });
  markBackupSent(userId, backupEmail);
  return NextResponse.json({
    ok: true,
    backupEmail,
    bundle: makeBackupBundle(userId, row.record),
    note: "MVP: download the bundle and send it to the backup email yourself (or configure a mailer).",
  });
}

// GET /api/vault/backup -> re-download the current bundle (no email required).
export async function GET(req: NextRequest) {
  const userId = resolveSession(req.cookies.get(COOKIE)?.value);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const row = getDb().prepare("SELECT record FROM vaults WHERE user_id = ?").get(userId) as
    | { record: string }
    | undefined;
  if (!row) return NextResponse.json({ error: "no vault" }, { status: 404 });
  return NextResponse.json({ bundle: makeBackupBundle(userId, row.record) });
}
