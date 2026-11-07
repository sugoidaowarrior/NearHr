// GET /api/me  -> { id, email, name, displayCurrency, vault }
// PATCH /api/me { currency: 'NGN'|'USD'|'EUR' } -> updated user (currency at sign in)
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { unlockVault } from "@/lib/vault";
import { resolveSession, COOKIE } from "@/lib/sessions";

export async function GET(req: NextRequest) {
  const token = req.cookies.get(COOKIE)?.value;
  const userId = resolveSession(token);
  if (!userId) return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  const user = getDb()
    .prepare("SELECT * FROM users WHERE id = ?")
    .get(userId) as Record<string, unknown>;
  if (!user) return NextResponse.json({ error: "no such user" }, { status: 404 });
  let vault: { accountId: string } | null = null;
  try {
    const v = unlockVault(userId);
    if (v) {
      vault = {
        accountId: v.nearAccount,
      };
    }
  } catch {
    /* vault not ready yet; the /api/vault endpoint surfaces the detail */
  }
  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      avatar: user.avatar ?? null,
      pfp_style: user.pfp_style,
      role: user.role,
      display_currency: user.display_currency,
    },
    displayCurrency: user.display_currency,
    vault,
  });
}

export async function PATCH(req: NextRequest) {
  const token = req.cookies.get(COOKIE)?.value;
  const userId = resolveSession(token);
  if (!userId) return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { currency?: string };
  const c = String(body.currency ?? "").toUpperCase();
  if (!["NGN", "USD", "EUR"].includes(c)) {
    return NextResponse.json({ error: "currency must be NGN, USD or EUR" }, { status: 400 });
  }
  getDb().prepare("UPDATE users SET display_currency = ? WHERE id = ?").run(c, userId);
  const user = getDb().prepare("SELECT * FROM users WHERE id = ?").get(userId) as Record<string, unknown>;
  return NextResponse.json({
    id: user.id,
    email: user.email,
    name: user.name,
    pfpStyle: user.pfp_style,
    displayCurrency: user.display_currency,
  });
}
