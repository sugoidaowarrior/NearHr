/**
 * Vault operations — ties encrypted key material (crypto.ts) to a user in the DB.
 * Handles first-run setup, passphrase verification, and backup bundle delivery.
 */
import { getDb } from "./db";
import {
  encryptVault,
  decryptVault,
  makeBackupBundle,
} from "./crypto";
import { newMasterKey } from "./near";
import { createEmployeeStealth, EmployeeStealth } from "./privacy";
import { newVaultId } from "./crypto";

export interface VaultView {
  userId: string;
  nearAccount: string;
  hasBackup: boolean;
  backupEmail: string | null;
  backupSentAt: string | null;
  createdAt: string;
}

/**
 * First-run: generate master NEAR key + SIP stealth keys, encrypt with the
 * user's passphrase, and store. Returns the NEAR account id to fund + the
 * (encrypted) backup bundle to email.
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

/** Verify passphrase and return decrypted material. Throws on wrong passphrase. */
export function unlockVault(userId: string, passphrase: string) {
  const db = getDb();
  const row = db.prepare(`SELECT record, near_account FROM vaults WHERE user_id = ?`).get(userId) as
    | { record: string; near_account: string }
    | undefined;
  if (!row) throw new Error("no vault for user");
  const plain = decryptVault(row.record, passphrase);
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
}

/** Store the encrypted backup bundle we sent (so we can re-send). */
export function markBackupSent(userId: string, backupEmail: string) {
  getDb()
    .prepare(`UPDATE vaults SET backup_email = ?, backup_sent_at = datetime('now') WHERE user_id = ?`)
    .run(backupEmail, userId);
}

export function getVaultView(userId: string): VaultView | null {
  const row = getDb()
    .prepare(
      `SELECT near_account, backup_email, backup_sent_at, created_at FROM vaults WHERE user_id = ?`
    )
    .get(userId) as
    | { near_account: string; backup_email: string | null; backup_sent_at: string | null; created_at: string }
    | undefined;
  if (!row) return null;
  return {
    userId,
    nearAccount: row.near_account,
    hasBackup: !!row.backup_email,
    backupEmail: row.backup_email,
    backupSentAt: row.backup_sent_at,
    createdAt: row.created_at,
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
