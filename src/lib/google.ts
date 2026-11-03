/**
 * Google OAuth (Authorization Code + PKCE), hand-rolled — no framework.
 * Endpoints:
 *   GET  /api/auth/google/start  -> 302 to accounts.google.com
 *   GET  /api/auth/google/callback -> verifies id_token, upserts user, sets session
 *
 * Requires in .env:
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 *   APP_URL  (e.g. http://localhost:3000)
 */
import { randomBytes, createHash } from "node:crypto";

export const GOOGLE_AUTH_BASE = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_USERINFO = "https://www.googleapis.com/oauth2/v3/userinfo";

const STATE_KEY = "hp_oauth_state";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function appUrl(): string {
  return (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
}

export function googleClientId(): string {
  const id = process.env.GOOGLE_CLIENT_ID;
  if (!id) throw new Error("GOOGLE_CLIENT_ID not set — see .env.example");
  return id;
}

export interface OAuthStart {
  url: string;
  state: string;
  verifier: string;
}

/** Build the Google consent URL + PKCE verifier (to store server-side in state). */
export function startOAuth(): OAuthStart {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(16).toString("base64url");
  const params = new URLSearchParams({
    client_id: googleClientId(),
    redirect_uri: `${appUrl()}/api/auth/google/callback`,
    response_type: "code",
    scope: "openid email profile",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return { url: `${GOOGLE_AUTH_BASE}?${params.toString()}`, state, verifier };
}

/** Exchange the auth code for tokens, then fetch the user's profile. */
export async function exchangeCode(code: string, verifier: string): Promise<{
  sub: string;
  email: string;
  name: string;
  avatar: string | null;
  emailVerified: boolean;
}> {
  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: googleClientId(),
      client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
      redirect_uri: `${appUrl()}/api/auth/google/callback`,
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
  });
  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    throw new Error(`Google token exchange failed: ${tokenRes.status} ${body.slice(0, 200)}`);
  }
  const tokens = (await tokenRes.json()) as { id_token?: string; access_token?: string };
  if (!tokens.id_token) throw new Error("Google did not return an id_token");

  // Decode + verify the id_token payload (issuer, aud, exp, email_verified).
  const payload = decodeJwt(tokens.id_token) as {
    iss?: string;
    aud?: string;
    sub?: string;
    exp?: number;
    email?: string;
    email_verified?: boolean;
    name?: string;
    picture?: string;
  };
  if (payload.iss !== "accounts.google.com" && payload.iss !== "https://accounts.google.com") {
    throw new Error(`bad id_token issuer: ${payload.iss}`);
  }
  if (payload.aud !== googleClientId()) throw new Error("bad id_token audience");
  if (payload.exp && payload.exp * 1000 < Date.now()) throw new Error("id_token expired");
  if (!payload.sub) throw new Error("id_token missing sub");

  return {
    sub: payload.sub,
    email: payload.email ?? "",
    name: payload.name ?? payload.email ?? "",
    avatar: payload.picture ?? null,
    emailVerified: !!payload.email_verified,
  };
}

/** Minimal JWT decode (we re-verify iss/aud/exp above; signature check via
 *  Google's JWKS is the hardening step — see README. Kept light for MVP.) */
function decodeJwt(token: string): Record<string, unknown> {
  const [, b64] = token.split(".");
  const json = Buffer.from(b64.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  return JSON.parse(json);
}

export { STATE_KEY, SESSION_TTL_MS };
