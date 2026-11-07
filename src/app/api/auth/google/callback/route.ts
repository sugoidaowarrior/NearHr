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
  const row = db
    .prepare("SELECT verifier, next_url FROM oauth_states WHERE state = ?")
    .get(state) as { verifier: string; next_url: string | null } | undefined;
  const verifier = row?.verifier;
  const next = row?.next_url ?? null;
  db.prepare("DELETE FROM oauth_states WHERE state = ?").run(state); // single use
  if (!verifier) {
    return NextResponse.redirect(new URL("/login?error=bad_state", req.url));
  }
  let profile;
  try {
    profile = await exchangeCode(code, verifier);
    console.log(`[auth] google ok for ${profile.email} (sub ${profile.sub})`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`[auth] google exchange failed: ${msg}`);
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(msg)}`, req.url));
  }
  // Upsert user. Everyone is an HR operator (no role selection) and the
  // profile starts with the default monogram pfp: the user picks their own
  // image in the app, so we never store Google's photo (it may be a meme).
  db.prepare(
    `INSERT INTO users (id, email, name, avatar, role) VALUES (?, ?, ?, NULL, 'employer')
     ON CONFLICT(id) DO UPDATE SET email=excluded.email, name=excluded.name, role='employer'`
  ).run(profile.sub, profile.email, profile.name);

  const { token, expiresAt } = issueSession(profile.sub);
  // Secure only on real HTTPS — a Secure cookie set over http://localhost
  // would be dropped by browsers (NODE_ENV=production is not a reliable signal).
  const secure = req.url.startsWith("https");
  const dest = next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
  const res = NextResponse.redirect(new URL(dest, req.url));
  res.cookies.set(COOKIE, token, sessionCookieOptions(secure));
  res.cookies.set(COOKIE + "_exp", expiresAt.toISOString(), sessionCookieOptions(secure));
  console.log(`[auth] session issued, redirecting to ${dest} (secure=${secure})`);
  return res;
}
