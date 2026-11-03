import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { resolveSession, COOKIE } from "@/lib/sessions";

function requireEmployer(req: NextRequest) {
  const userId = resolveSession(req.cookies.get(COOKIE)?.value);
  if (!userId) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  const role = (getDb().prepare("SELECT role FROM users WHERE id = ?").get(userId) as
    | { role: string }
    | undefined)?.role;
  if (role !== "employer")
    return { error: NextResponse.json({ error: "employer role required" }, { status: 403 }) };
  return { userId: userId! };
}

import { listPayments } from "@/lib/payments";

// GET /api/payments -> recent payout ledger
export async function GET(req: NextRequest) {
  const auth = requireEmployer(req);
  if (auth.error) return auth.error;
  return NextResponse.json({ payments: listPayments(auth.userId!, 200) });
}
