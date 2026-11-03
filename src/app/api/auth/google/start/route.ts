import { NextResponse } from "next/server";
import { startOAuth } from "@/lib/google";
import { getDb } from "@/lib/db";


// GET /api/auth/google/start -> 302 to Google consent screen
export async function GET() {
  let url: string;
  let state: string;
  let verifier: string;
  try {
    ({ url, state, verifier } = startOAuth());
  } catch (e) {
    const msg = e instanceof Error ? e.message : "OAuth not configured";
    return NextResponse.json(
      {
        error: `Google sign-in is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.local, and register the redirect URI ${process.env.APP_URL ?? "http://localhost:3000"}/api/auth/google/callback in your Google Cloud Console.`,
        detail: msg,
      },
      { status: 400 }
    );
  }
  // Stash PKCE verifier keyed by state (short TTL; single-use).
  getDb()
    .prepare(
      "INSERT INTO oauth_states (state, verifier, expires_at) VALUES (?, ?, datetime('now', '+10 minutes'))"
    )
    .run(state, verifier);
  return NextResponse.redirect(url);
}
