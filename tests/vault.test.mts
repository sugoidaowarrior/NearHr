/**
 * Vault crypto tests: passphrase encryption round trip, tamper detection,
 * legacy format acceptance, and the token helpers. Runs in a temp dir with a
 * throwaway KMS key so the real data/ directory is never touched.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nearhr-vault-"));
fs.mkdirSync(path.join(tmp, "data"), { recursive: true });
fs.writeFileSync(
  path.join(tmp, "data", "kms.key"),
  randomBytes(32).toString("hex"),
  { mode: 0o600 }
);
process.chdir(tmp);

const {
  encryptVault,
  decryptVault,
  makeBackupBundle,
  safeEqual,
  newToken,
  newVaultId,
} = await import("../src/lib/crypto");

const PLAIN = {
  nearMasterKey: "abcd1234",
  nearAccount: "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
  createdAt: "2026-01-01T00:00:00.000Z",
  extraField: "kept too",
};

test("encrypt/decrypt round trip preserves every field", () => {
  const rec = encryptVault(PLAIN, "correct horse battery staple");
  const back = decryptVault(rec, "correct horse battery staple");
  assert.deepEqual(back, PLAIN);
});

test("each encryption uses fresh salt/keys (records differ)", () => {
  const a = encryptVault(PLAIN, "same passphrase");
  const b = encryptVault(PLAIN, "same passphrase");
  assert.notEqual(a, b);
});

test("wrong passphrase is rejected", () => {
  const rec = encryptVault(PLAIN, "passphrase-one");
  assert.throws(
    () => decryptVault(rec, "passphrase-two"),
    /wrong passphrase or corrupted vault/
  );
});

test("tampering with the payload is detected (GCM auth)", () => {
  const rec = JSON.parse(encryptVault(PLAIN, "pp")) as any;
  // Flip the last base64 char: still valid base64, different ciphertext.
  rec.data = rec.data.slice(0, -1) + (rec.data.endsWith("A") ? "B" : "A");
  assert.throws(() => decryptVault(rec, "pp"), /wrong passphrase or corrupted vault/);
});

test("tampering with the wrapped key is detected", () => {
  const rec = JSON.parse(encryptVault(PLAIN, "pp")) as any;
  rec.dekWrapped = rec.dekWrapped.slice(0, -1) + (rec.dekWrapped.endsWith("A") ? "B" : "A");
  assert.throws(() => decryptVault(rec, "pp"), /wrong passphrase or corrupted vault/);
});

test("legacy hushpay.vault.v1 records still decrypt", () => {
  const rec = JSON.parse(encryptVault(PLAIN, "pp")) as Record<string, unknown>;
  rec.v = "hushpay.vault.v1";
  const back = decryptVault(rec as never, "pp");
  assert.deepEqual(back, PLAIN);
});

test("unknown vault format is rejected", () => {
  const rec = JSON.parse(encryptVault(PLAIN, "pp")) as Record<string, unknown>;
  rec.v = "nearhr.vault.v99";
  assert.throws(() => decryptVault(rec as never, "pp"), /unknown vault format/);
});

test("makeBackupBundle wraps the record", () => {
  const rec = encryptVault(PLAIN, "pp");
  const bundle = makeBackupBundle("user-123", rec);
  assert.equal(bundle.appId, "user-123");
  assert.match(bundle.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(bundle.vault.salt, (JSON.parse(rec) as { salt: string }).salt);
});

test("safeEqual: constant time compare semantics", () => {
  assert.equal(safeEqual("abc", "abc"), true);
  assert.equal(safeEqual("abc", "abd"), false);
  assert.equal(safeEqual("abc", "abcd"), false); // different length
  assert.equal(safeEqual("", ""), true);
});

test("newToken: 32 random bytes as base64url, unique", () => {
  const t = newToken();
  assert.match(t, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(newToken(), newToken());
});

test("newVaultId: valid v4 UUID", () => {
  assert.match(
    newVaultId(),
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
  );
});
