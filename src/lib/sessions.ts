/**
 * Server-side session store backed by SQLite.
 * Cookie name: hp_session (httpOnly, sameSite=lax, secure in prod).
 */
import { getDb } from "./db";
import { newToken, safeEqual } from "./crypto";
import { SESSION_TTL_MS } from "./google";

const COOKIE = "hp_session";

export function issueSession(userId: string): { token: string; expiresAt: Date } {
  const token = newToken(32);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  getDb()
    .prepare(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)`)
    .run(token, userId, expiresAt.toISOString());
  return { token, expiresAt };
}

export function resolveSession(token: string | undefined): string | null {
  if (!token) return null;
  const row = getDb()
    .prepare(
      `SELECT user_id FROM sessions WHERE token = ? AND expires_at > datetime('now')`
    )
    .get(token) as { user_id: string } | undefined;
  return row?.user_id ?? null;
}

export function destroySession(token: string | undefined): void {
  if (!token) return;
  getDb().prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
}

export function sessionCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  };
}

export { COOKIE };
