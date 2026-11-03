import { NextRequest, NextResponse } from "next/server";
import { exchangeCode } from "@/lib/google";
import { getDb } from "@/lib/db";
import { issueSession, destroySession, COOKIE, sessionCookieOptions } from "@/lib/sessions";


// GET /api/auth/google/callback?code=...&state=...
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const code = sp.get("code");
  const state = sp.get("state");
  const error = sp.get("error");
  if (error) {
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error)}`, req.url));
  }
  if (!code || !state) {
    return NextResponse.redirect(new URL("/login?error=missing_params", req.url));
  }
  const db = getDb();
  const row = db.prepare("SELECT user_id FROM sessions WHERE token = ?").get(`oauth:${state}`) as
    | { user_id: string }
    | undefined;
  const verifier = row?.user_id;
  db.prepare("DELETE FROM sessions WHERE token = ?").run(`oauth:${state}`); // single use
  if (!verifier) {
    return NextResponse.redirect(new URL("/login?error=bad_state", req.url));
  }
  let profile;
  try {
    profile = await exchangeCode(code, verifier);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(msg)}`, req.url));
  }
  // Upsert user
  const isEmployer = process.env.EMPLOYER_EMAILS
    ?.split(",")
    .map((s) => s.trim().toLowerCase())
    .includes(profile.email.toLowerCase());
  db.prepare(
    `INSERT INTO users (id, email, name, avatar, role) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET email=excluded.email, name=excluded.name, avatar=excluded.avatar,
       role = CASE WHEN users.role='employer' THEN 'employer' ELSE excluded.role END`
  ).run(profile.sub, profile.email, profile.name, profile.avatar, isEmployer ? "employer" : "employee");

  const { token, expiresAt } = issueSession(profile.sub);
  const res = NextResponse.redirect(new URL("/", req.url));
  res.cookies.set(COOKIE, token, sessionCookieOptions(process.env.NODE_ENV === "production"));
  res.cookies.set(COOKIE + "_exp", expiresAt.toISOString(), sessionCookieOptions(process.env.NODE_ENV === "production"));
  return res;
}
