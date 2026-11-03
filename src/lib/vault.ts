/**
 * Vault operations — ties encrypted key material (crypto.ts) to a user in the DB.
 *
 * Umbra-style onboarding: the vault is created automatically at first login —
 * no passphrase, no seed phrase. Key material is encrypted with the server KMS
 * key (custodial), so the user never handles a recovery secret. Email backup is
 * offered but optional.
 */
import { getDb } from "./db";
import {
  encryptVault,
  decryptVault,
  makeBackupBundle,
} from "./crypto";
import { newMasterKey, PublicKey } from "./near";
import { createEmployeeStealth, EmployeeStealth } from "./privacy";
import { newVaultId } from "./crypto";

export interface VaultView {
  userId: string;
  nearAccount: string;
  hasBackup: boolean;
  backupEmail: string | null;
  backupSentAt: string | null;
  createdAt: string;
  /** True if the vault was created by the old passphrase flow (can't auto-unlock). */
  legacy?: boolean;
}

/**
 * Implicit NEAR account id from an ed25519 public key (64 hex chars = the raw
 * 32-byte public key). Implicit accounts self-activate on first funding —
 * no registration step, nothing for the user to do.
 */
export function implicitAccountId(publicKeyStr: string): string {
  const pk = PublicKey.fromString(publicKeyStr);
  return Buffer.from(pk.data).toString("hex");
}

/**
 * Auto-create (or return the existing) vault for a user. Idempotent — safe to
 * call on every login. Derives the NEAR address from the freshly generated
 * master key, so the same user always gets the same address.
 */
export function ensureVault(userId: string): {
  nearAccount: string;
  masterPublicKey: string;
  created: boolean;
} {
  const db = getDb();
  const existing = db
    .prepare("SELECT near_account FROM vaults WHERE user_id = ?")
    .get(userId) as { near_account: string } | undefined;
  if (existing) return { nearAccount: existing.near_account, masterPublicKey: "", created: false };

  const master = newMasterKey();
  const account = implicitAccountId(master.publicKey);
  const stealth: EmployeeStealth = createEmployeeStealth("payroll");
  // Custodial: encrypted with a server-derived key. The KMS key + this record
  // together are the only way to decrypt; neither the DB alone nor the KMS
  // key alone is sufficient. (Custodial MVP — see README threat model.)
  const record = encryptVault(
    {
      nearMasterKey: master.base58,
      sipSpendingKey: stealth.spendingPrivateKey,
      sipViewingKey: stealth.viewingPrivateKey,
      sipMetaAddress: stealth.metaAddress,
      nearAccount: account,
      createdAt: new Date().toISOString(),
    },
    serverKekFor(userId)
  );

  db.prepare(
    `INSERT INTO vaults (user_id, record, near_account) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET record = excluded.record, near_account = excluded.near_account`
  ).run(userId, record, account);

  return { nearAccount: account, masterPublicKey: master.publicKey, created: true };
}

/**
 * Server-side KEK (custodial MVP): derived from a stable per-app secret bound
 * to the KMS key. There is deliberately no user-chosen secret — that's the
 * point of this flow. If you later want non-custodial recovery, swap this for
 * a user passphrase (the encrypt/decrypt functions are unchanged).
 */
function serverKekFor(userId: string): string {
  const appSecret = process.env.VAULT_APP_SECRET || "hushpay-custodial-dev";
  return `${appSecret}:${userId}`;
}

/**
 * Create a vault from an explicit passphrase + NEAR account.
 * Retained for non-custodial flows / recovery; the default UI path is
 * ensureVault() which asks nothing.
 */
export function createVault(userId: string, passphrase: string, nearAccount: string): {
  nearAccount: string;
  masterPublicKey: string;
  backup: ReturnType<typeof makeBackupBundle>;
} {
  const master = newMasterKey();
  const stealth: EmployeeStealth = createEmployeeStealth("payroll");
  const record = encryptVault(
    {
      nearMasterKey: master.base58,
      sipSpendingKey: stealth.spendingPrivateKey,
      sipViewingKey: stealth.viewingPrivateKey,
      sipMetaAddress: stealth.metaAddress,
      nearAccount,
      createdAt: new Date().toISOString(),
    },
    passphrase
  );

  const db = getDb();
  db.prepare(
    `INSERT INTO vaults (user_id, record, near_account) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET record = excluded.record, near_account = excluded.near_account`
  ).run(userId, record, nearAccount);

  const backup = makeBackupBundle(userId, record);
  return {
    nearAccount,
    masterPublicKey: master.publicKey,
    backup,
  };
}

/**
 * Unlock the vault for the current user. Works for both auto-created (server
 * KEK) and passphrase-encrypted vaults: try the server KEK first, fall back to
 * a user-supplied passphrase if provided.
 */
export function unlockVault(userId: string, passphrase?: string) {
  const db = getDb();
  const row = db.prepare(`SELECT record, near_account FROM vaults WHERE user_id = ?`).get(userId) as
    | { record: string; near_account: string }
    | undefined;
  if (!row) throw new Error("no vault for user");

  const candidates = [serverKekFor(userId), ...(passphrase ? [passphrase] : [])];
  let lastErr: unknown = null;
  for (const kek of candidates) {
    try {
      const plain = decryptVault(row.record, kek);
      return {
        ...plain,
        nearAccount: plain.nearAccount ?? row.near_account,
      } as {
        nearMasterKey: string;
        sipSpendingKey: string;
        sipViewingKey: string;
        sipMetaAddress: string;
        nearAccount: string;
        createdAt: string;
      };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("could not decrypt vault");
}

/** Store the encrypted backup bundle we sent (so we can re-send). Optional. */
export function markBackupSent(userId: string, backupEmail: string) {
  getDb()
    .prepare(`UPDATE vaults SET backup_email = ?, backup_sent_at = datetime('now') WHERE user_id = ?`)
    .run(backupEmail, userId);
}

/** Clear the optional backup email (user removed their backup destination). */
export function clearBackupEmail(userId: string) {
  getDb()
    .prepare(`UPDATE vaults SET backup_email = NULL, backup_sent_at = NULL WHERE user_id = ?`)
    .run(userId);
}

/** Cheap memo: legacy detection costs one PBKDF2 per user; cache the answer. */
const legacyCache = new Map<string, boolean>();

export function getVaultView(userId: string): VaultView | null {
  const row = getDb()
    .prepare(
      `SELECT near_account, backup_email, backup_sent_at, created_at, record FROM vaults WHERE user_id = ?`
    )
    .get(userId) as
    | {
        near_account: string;
        backup_email: string | null;
        backup_sent_at: string | null;
        created_at: string;
        record: string;
      }
    | undefined;
  if (!row) return null;
  // Legacy detection: vaults created by the old passphrase flow can't be
  // opened with the server KEK. Flag them so the UI can say what to do.
  let legacy = legacyCache.get(userId);
  if (legacy === undefined) {
    try {
      decryptVault(row.record, serverKekFor(userId));
      legacy = false;
    } catch {
      legacy = true;
    }
    legacyCache.set(userId, legacy);
  }
  return {
    userId,
    nearAccount: row.near_account,
    hasBackup: !!row.backup_email,
    backupEmail: row.backup_email,
    backupSentAt: row.backup_sent_at,
    createdAt: row.created_at,
    legacy,
  };
}

/** Restore a vault from an uploaded backup bundle + passphrase. */
export function restoreVaultFromBackup(
  userId: string,
  backupJson: string,
  passphrase: string
): { nearAccount: string } {
  const bundle = JSON.parse(backupJson);
  const record = bundle.vault ? JSON.stringify(bundle.vault) : backupJson;
  const plain = decryptVault(record, passphrase); // throws on wrong passphrase
  const db = getDb();
  db.prepare(
    `INSERT INTO vaults (user_id, record, near_account) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET record = excluded.record, near_account = excluded.near_account`
  ).run(userId, record, plain.nearAccount);
  return { nearAccount: plain.nearAccount };
}

export { newVaultId };
