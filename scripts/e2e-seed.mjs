// Seed a test employer + session token so the API flow can be exercised
// end-to-end with curl. Prints the token to use as the hp_session cookie.
import { initDb, getDb } from "../src/lib/db.ts";
initDb();
const db = getDb();
const userId = "test-employer-001";
db.prepare(
  `INSERT INTO users (id, email, name, role) VALUES (?, ?, ?, 'employer')
   ON CONFLICT(id) DO UPDATE SET role='employer', email=excluded.email`
).run(userId, "boss@hushpay.test", "Test Boss");
const token = "e2e-session-token-0001";
const expires = new Date(Date.now() + 7 * 864e5).toISOString();
db.prepare(
  `INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, datetime('now'), ?)
   ON CONFLICT(token) DO UPDATE SET user_id=excluded.user_id, expires_at=excluded.expires_at`
).run(token, userId, expires);
console.log("TOKEN=" + token);
console.log("USER=" + userId);
