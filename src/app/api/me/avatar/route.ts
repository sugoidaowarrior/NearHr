import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { resolveSession, COOKIE } from "@/lib/sessions";

// POST /api/me/avatar  { avatar: "data:image/...;base64,..." | null }
// Stores the user's chosen profile image as a data URL, or clears it back to
// the default monogram. Limited to small images; anything larger is rejected.
const MAX_BYTES = 300 * 1024; // ~225KB binary before base64

export async function POST(req: NextRequest) {
  const userId = resolveSession(req.cookies.get(COOKIE)?.value);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { avatar?: string | null } | null;
  if (!body) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  let avatar: string | null = null;
  if (typeof body.avatar === "string" && body.avatar.length > 0) {
    const m = body.avatar.match(/^data:(image\/(png|jpeg|webp|gif));base64,(.+)$/s);
    if (!m) return NextResponse.json({ error: "image must be png, jpeg, webp or gif" }, { status: 400 });
    const b64 = m[3];
    if (Math.ceil((b64.length * 3) / 4) > MAX_BYTES) {
      return NextResponse.json(
        { error: "image too large (200KB max after resize)" },
        { status: 400 }
      );
    }
    avatar = body.avatar.slice(0, 600_000);
  }

  getDb().prepare("UPDATE users SET avatar = ? WHERE id = ?").run(avatar, userId);
  return NextResponse.json({ ok: true, avatar });
}
