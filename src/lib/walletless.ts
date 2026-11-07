/**
 * Walletless payer accounts (2nd payment option on the pay page).
 *
 * A customer without a NEAR wallet signs in with Google on the pay page.
 * NearHr provisions a NEAR account for them: a fresh ed25519 keypair whose
 * public key is the implicit NEAR account id, with the private key stored
 * encrypted (same custodial model as the employer vault).
 *
 * Email is only the sign in method. It does not contain money and does not
 * automatically fund the wallet: the customer still needs NEAR or a supported
 * test token to pay the invoice. For the hackathon the customer funds the new
 * account from a faucet or another funded wallet, then the server sends the
 * invoice payment from it and verifies the on chain result before marking the
 * invoice paid.
 */
import { getDb } from "./db";
import { encryptVault, decryptVault } from "./crypto";
import { implicitAccountId, serverKekFor } from "./vault";
import {
  accountFromVault,
  balanceOf,
  newMasterKey,
  sendNear,
  sendUsdcToVault,
  usdcStorageMin,
  toYocto,
  usdcBalanceOf,
} from "./near";
import {
  getInvoiceBySlug,
  parseAmount,
  payDetails,
  verifyPayment,
} from "./invoices";

function payerKek(userId: string): string {
  return serverKekFor(`payer:${userId}`);
}

interface StoredPayer {
  nearAccount: string;
  masterKeyBase58: string;
}

/**
 * Return the payer's account, provisioning it on first use. Idempotent: the
 * same Google user always gets the same NEAR account.
 */
export function ensurePayerAccount(userId: string): StoredPayer {
  const db = getDb();
  const row = db
    .prepare("SELECT near_account, record FROM payer_accounts WHERE user_id = ?")
    .get(userId) as { near_account: string; record: string } | undefined;
  if (row) {
    const plain = decryptVault(row.record, payerKek(userId));
    return { nearAccount: row.near_account, masterKeyBase58: plain.nearMasterKey };
  }
  const master = newMasterKey();
  const account = implicitAccountId(master.publicKey);
  const record = encryptVault(
    { nearMasterKey: master.base58, nearAccount: account, createdAt: new Date().toISOString() },
    payerKek(userId)
  );
  db.prepare(
    `INSERT INTO payer_accounts (user_id, near_account, record) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET record = excluded.record, near_account = excluded.near_account`
  ).run(userId, account, record);
  return { nearAccount: account, masterKeyBase58: master.base58 };
}

/** USDC faucet for the active network: Circle's public faucet (permissionless,
 * no account, mints to Circle's NEAR USDC contract). Empty on mainnet. */
export function faucetUrl(): string {
  const network = (process.env.NEAR_NETWORK || "testnet").toLowerCase();
  return network === "mainnet" ? "" : "https://faucet.circle.com";
}

/** Native NEAR faucet (testnet only) — used for the small gas amount a USDC
 * invoice still needs. Official docs page (built in faucet). */
export function nearFaucetUrl(): string {
  const network = (process.env.NEAR_NETWORK || "testnet").toLowerCase();
  return network === "mainnet" ? "" : "https://docs.near.org/getting-started/faucet";
}

export interface PayerBalance {
  nearYocto: bigint;
  usdcBase: bigint;
}

/** Live balances of the payer's account (view calls; 0 when not on chain yet). */
export async function payerBalances(p: StoredPayer): Promise<PayerBalance> {
  const [nearYocto, usdcBase] = await Promise.all([
    balanceOf(accountFromVault(p.nearAccount, p.masterKeyBase58)).catch(() => 0n),
    usdcBalanceOf(p.nearAccount).catch(() => 0n),
  ]);
  return { nearYocto, usdcBase };
}

const NEAR_GAS_MARGIN = toYocto("0.001");

export interface PayerPayResult {
  confirmed: boolean;
  detail: string;
  balance: PayerBalance;
}

/**
 * Send the invoice payment from the payer's walletless account and run the
 * same trustless on chain verification as the wallet path. Throws
 * `not funded` (code "unfunded") when the account balance is below the
 * invoice amount, so the UI can keep pointing the customer at the faucet.
 */
export async function payInvoiceFromPayerAccount(
  userId: string,
  slug: string
): Promise<PayerPayResult> {
  const inv = getInvoiceBySlug(slug);
  if (!inv) throw new Error("invoice not found");
  if (inv.status !== "open" && inv.status !== "refunded") {
    throw new Error(`this invoice is ${inv.status}, it can no longer be paid`);
  }
  const payer = ensurePayerAccount(userId);
  // Resolves the vault on chain (registers the USDC storage record when
  // missing) and throws VaultNotReadyError when the employer side is not up.
  const { vault } = await payDetails(inv);
  const bal = await payerBalances(payer);
  const needed = inv.asset === "NEAR" ? toYocto(inv.amount) + NEAR_GAS_MARGIN : parseAmount(inv.amount);
  const have = inv.asset === "NEAR" ? bal.nearYocto : bal.usdcBase;
  // A USDC invoice still needs a little NEAR for gas, plus the one time
  // storage record that registers the employer's vault for USDC (live minimum
  // from the contract, refunded on chain if it already has a record).
  if (inv.asset === "USDC" && bal.nearYocto < (await usdcStorageMin()) + NEAR_GAS_MARGIN) {
    const e = new Error("your payment account needs a little more NEAR: a small one time registration for the employer's vault on USDC, plus the fee");
    (e as Error & { code?: string }).code = "unfunded";
    throw e;
  }
  if (have < needed) {
    const e = new Error("your payment account does not hold enough funds for this invoice yet");
    (e as Error & { code?: string }).code = "unfunded";
    throw e;
  }
  const account = accountFromVault(payer.nearAccount, payer.masterKeyBase58);
  let txHash: string;
  if (inv.asset === "NEAR") {
    ({ txHash } = await sendNear(account, vault, toYocto(inv.amount)));
  } else {
    ({ txHash } = await sendUsdcToVault(account, vault, parseAmount(inv.amount)));
  }
  const res = await verifyPayment(slug, "", payer.nearAccount, txHash);
  const balAfter = await payerBalances(payer).catch(() => bal);
  return { confirmed: res.confirmed, detail: res.detail, balance: balAfter };
}
