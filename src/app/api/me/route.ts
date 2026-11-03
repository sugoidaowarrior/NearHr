import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { resolveSession, COOKIE } from "@/lib/sessions";


export async function GET(req: NextRequest) {
  const userId = resolveSession(req.cookies.get(COOKIE)?.value);
  if (!userId) return NextResponse.json({ user: null }, { status: 401 });
  const u = getDb().prepare("SELECT id, email, name, avatar, pfp_style, role FROM users WHERE id = ?").get(userId) as Record<string, unknown> | undefined;
  if (!u) return NextResponse.json({ user: null }, { status: 401 });
  return NextResponse.json({ user: u });
}
