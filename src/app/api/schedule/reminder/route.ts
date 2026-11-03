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

import { buildReminder } from "@/lib/schedule";

// POST /api/schedule/reminder -> build (and persist as queued) the reminder.
// No mail provider is wired in the MVP: returns the mail ready payload and a
// "queued" status so the flow is complete. Drop sendReminderEmail() in the
// library to go live with a real provider.
export async function POST(req: NextRequest) {
  const auth = requireEmployer(req);
  if (auth.error) return auth.error;
  const reminder = buildReminder(auth.userId!);
  if (!reminder) return NextResponse.json({ error: "no schedule" }, { status: 404 });
  return NextResponse.json({ queued: true, to: reminder.to, reminder }, { status: 202 });
}
