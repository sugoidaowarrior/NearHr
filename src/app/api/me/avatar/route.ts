import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { resolveSession, COOKIE } from "@/lib/sessions";

// POST /api/me/avatar  { avatar?: "data:image/...;base64,..." | null, pfpStyle?: "A" | "B" }
// Stores the user's chosen profile image as a data URL (or clears it back to
// the default monogram) and/or which monogram style to show. Limited to small
// images; anything larger is rejected.
const MAX_BYTES = 300 * 1024; // ~225KB binary before base64

export async function POST(req: NextRequest) {
  const userId = resolveSession(req.cookies.get(COOKIE)?.value);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as {
    avatar?: string | null;
    pfpStyle?: string;
  } | null;
  if (!body) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const db = getDb();
  const row = db
    .prepare("SELECT avatar, pfp_style FROM users WHERE id = ?")
    .get(userId) as { avatar: string | null; pfp_style: string | null } | undefined;
  if (!row) return NextResponse.json({ error: "unknown user" }, { status: 404 });

  let avatar: string | null = row.avatar;
  if (body.avatar !== undefined) {
    if (body.avatar === null) {
      avatar = null;
    } else if (typeof body.avatar === "string" && body.avatar.length > 0) {
      const m = body.avatar.match(/^data:(image\/(png|jpeg|webp|gif));base64,(.+)$/s);
      if (!m) return NextResponse.json({ error: "image must be png, jpeg, webp or gif" }, { status: 400 });
      const b64 = m[3];
      if (Math.ceil((b64.length * 3) / 4) > MAX_BYTES) {
        return NextResponse.json({ error: "image too large (300KB max)" }, { status: 400 });
      }
      avatar = body.avatar.slice(0, 600_000);
    } else {
      return NextResponse.json({ error: "invalid avatar" }, { status: 400 });
    }
  }

  let pfpStyle = row.pfp_style === "B" ? "B" : "A";
  if (body.pfpStyle !== undefined) {
    if (body.pfpStyle !== "A" && body.pfpStyle !== "B") {
      return NextResponse.json({ error: "invalid pfpStyle" }, { status: 400 });
    }
    pfpStyle = body.pfpStyle;
  }

  db.prepare("UPDATE users SET avatar = ?, pfp_style = ? WHERE id = ?").run(avatar, pfpStyle, userId);
  return NextResponse.json({ ok: true, avatar, pfpStyle });
}
