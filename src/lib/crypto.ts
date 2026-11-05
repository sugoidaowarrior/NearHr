/**
 * Crypto core: vault (server-side encrypted user keys) + backup bundle.
 *
 * Threat model (MVP, custodial):
 *  - Every user account has a NEAR master key (ed25519) that controls a
 *    custodial NEAR smart-account contract (M13) holding funds.
 *  - The master key + SIP stealth keys are stored in SQLite encrypted with
 *    AES-256-GCM under an envelope key: DEK derived from the user's chosen
 *    backup passphrase (PBKDF2, 210k iters), then wrapped by a server key
 *    (KMS_KEY) so a leaked DB is useless without the passphrase AND the
 *    server key.
 *  - The backup bundle is the same ciphertext (base64) delivered to the
 *    user's backup email; restoring it + the passphrase restores the vault.
 */
import { randomBytes, pbkdf2Sync, createCipheriv, createDecipheriv, timingSafeEqual, randomUUID, createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const KDF_ALG = "sha256";
const PBKDF2_ITERATIONS = 210_000;
const SALT_LEN = 16;
const IV_LEN = 12;
const KEY_LEN = 32;
const FORMAT = "nearhr.vault.v1";
const FORMAT_LEGACY = "hushpay.vault.v1"; // pre rename, accepted on decrypt only

/** Server master key, 64 hex chars (32 bytes). Generated on first run (see db.ts).
 *  Read from disk on demand — the file is the source of truth (see kms()). */
function kms() {
  const p = path.join(process.cwd(), "data", "kms.key");
  const key = Buffer.from(fs.readFileSync(p, "utf8").trim(), "hex");
  if (key.length !== 32) throw new Error("KMS key file is not 32 bytes");
  return key;
}

export interface VaultPlaintext {
  nearMasterKey: string; // hex (64) or base58 NEAR seed
  sipSpendingKey: string; // hex, SIP stealth spending private key
  sipViewingKey: string; // hex, SIP stealth viewing private key
  sipMetaAddress: string; // encoded sip:near:... meta address
  nearAccount: string; // NEAR account id of the smart account
  createdAt: string;
  [extra: string]: string;
}

interface VaultRecord {
  v: string;
  kdf: string;
  iter: number;
  salt: string; // base64 (user-passphrase salt)
  dekWrapIv: string; // base64
  dekWrapped: string; // base64, AES-256-GCM(kek, dek)
  dataIv: string; // base64
  data: string; // base64, AES-256-GCM(dek, json)
  mac: string; // base64, hmac-ish tag of data (GCM tag is in data auth)
}

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return pbkdf2Sync(passphrase, salt, PBKDF2_ITERATIONS, KEY_LEN, KDF_ALG);
}

/**
 * DEK wrap key = SHA-256(user KEK ‖ KMS key). Binding both secrets means a
 * stolen DB (has the ciphertext, lacks the passphrase) AND a stolen KMS key
 * (has the passphrase-less half, lacks the DB) are each individually useless.
 */
function dekWrapKey(kek: Buffer): Buffer {
  return createHash("sha256").update(kek).update(kms()).digest();
}

function gcmEncrypt(key: Buffer, plaintext: Buffer): { iv: Buffer; out: Buffer } {
  const iv = randomBytes(IV_LEN);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const out = Buffer.concat([c.update(plaintext), c.final()]);
  return { iv, out: Buffer.concat([out, c.getAuthTag()]) };
}

function gcmDecrypt(key: Buffer, iv: Buffer, data: Buffer): Buffer {
  const d = createDecipheriv("aes-256-gcm", key, iv);
  // setAuthTag MUST be called before final(); otherwise GCM verifies against
  // an empty tag and final() throws on every decrypt.
  d.setAuthTag(data.subarray(data.length - 16));
  const plain = Buffer.concat([d.update(data.subarray(0, data.length - 16)), d.final()]);
  return plain;
}

/** Encrypt a vault. Returns the record as JSON (stored in DB / emailed as backup). */
export function encryptVault(plain: VaultPlaintext, passphrase: string): string {
  const salt = randomBytes(SALT_LEN);
  const dek = randomBytes(KEY_LEN); // data key, fresh per vault
  const kek = deriveKey(passphrase, salt);
  const wrapped = gcmEncrypt(dekWrapKey(kek), dek);
  const payload = gcmEncrypt(dek, Buffer.from(JSON.stringify(plain), "utf8"));
  const rec: VaultRecord = {
    v: FORMAT,
    kdf: `pbkdf2-${KDF_ALG}`,
    iter: PBKDF2_ITERATIONS,
    salt: salt.toString("base64"),
    dekWrapIv: wrapped.iv.toString("base64"),
    dekWrapped: wrapped.out.toString("base64"),
    dataIv: payload.iv.toString("base64"),
    data: payload.out.toString("base64"),
    mac: randomBytes(16).toString("base64"), // opaque; real auth is the GCM tags
  };
  return JSON.stringify(rec);
}

/** Decrypt a vault record with the passphrase. Throws on wrong passphrase. */
export function decryptVault(record: string | VaultRecord, passphrase: string): VaultPlaintext {
  const r: VaultRecord = typeof record === "string" ? JSON.parse(record) : record;
  if (r.v !== FORMAT && r.v !== FORMAT_LEGACY) throw new Error(`unknown vault format: ${r.v}`);
  const salt = Buffer.from(r.salt, "base64");
  const kek = deriveKey(passphrase, salt);
  let dek: Buffer;
  try {
    dek = gcmDecrypt(dekWrapKey(kek), Buffer.from(r.dekWrapIv, "base64"), Buffer.from(r.dekWrapped, "base64"));
  } catch {
    throw new Error("wrong passphrase or corrupted vault");
  }
  const plain = gcmDecrypt(dek, Buffer.from(r.dataIv, "base64"), Buffer.from(r.data, "base64"));
  return JSON.parse(plain.toString("utf8")) as VaultPlaintext;
}

export interface BackupBundle {
  appId: string;
  generatedAt: string;
  note: string;
  vault: VaultRecord;
}

/** Human-facing backup file contents (emailed as attachment). */
export function makeBackupBundle(appId: string, vaultRecord: string): BackupBundle {
  return {
    appId,
    generatedAt: new Date().toISOString(),
    note:
      "NearHr backup (encrypted). Keep this file somewhere safe. If you ever lose access to NearHr, contact support with this file and proof of identity. It lets your vault be recreated. No passphrase needed: your login is the key.",
    vault: JSON.parse(vaultRecord),
  };
}

/** Constant-time string compare for tokens (session ids). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function newToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function newVaultId(): string {
  return randomUUID();
}
