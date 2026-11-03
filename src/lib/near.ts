/**
 * NEAR layer (near-api-js v7 API).
 *
 * Custodial model: HushPay holds an ed25519 master key per user. That key is
 * attached (full access) to the user's smart-account contract so the server can
 * sign transfers on their behalf. All secrets live encrypted in the vault.
 *
 * v7 API notes (verified against node_modules):
 *  - `new Account(accountId, provider, keyPairString)` — no `connect()`.
 *  - `account.transfer({ receiverId, amount })` -> RpcTransactionResponse (native NEAR).
 *  - `account.callFunctionRaw({ contractId, methodName, args, gas, deposit })`
 *     -> RpcTransactionResponse (has .transaction_hash).
 *  - `account.callFunction(...)` -> just the return value (no hash). Use Raw for hash.
 *  - `account.addFullAccessKey(publicKey)`.
 *  - `account.getAccessKeyList()` -> { keys: AccessKeyInfoView[] } (field is `keys`).
 *  - `account.getBalance()` -> bigint (total yoctoNEAR).
 *  - Token constants: `near-api-js/tokens/mainnet|testnet`.
 */
import {
  Account,
  KeyPair,
  KeyPairEd25519,
  JsonRpcProvider,
  PublicKey,
  teraToGas,
  formatNearAmount,
} from "near-api-js";
import { USDC as USDC_MAIN } from "near-api-js/tokens/mainnet";
import { USDC as USDC_TEST } from "near-api-js/tokens/testnet";

export interface NearConfig {
  networkId: string; // "mainnet" | "testnet"
  nodeUrl: string;
}

export function defaultNearConfig(): NearConfig {
  const env = process.env;
  const network = (env.NEAR_NETWORK || "testnet").toLowerCase();
  return {
    networkId: network,
    nodeUrl:
      env.NEAR_NODE_URL ||
      (network === "mainnet" ? "https://rpc.mainnet.near.org" : "https://rpc.testnet.near.org"),
  };
}

let provider: JsonRpcProvider | null = null;
export function nearProvider(cfg: NearConfig = defaultNearConfig()): JsonRpcProvider {
  if (!provider) provider = new JsonRpcProvider({ url: cfg.nodeUrl });
  return provider;
}

/** Build an Account handle from a stored account id + master key. */
export function accountFromVault(accountId: string, masterKeyBase58: string): Account {
  return new Account(accountId, nearProvider(), masterKeyBase58 as never);
}

/** "1.5" (human NEAR) -> yocto bigint. */
export function toYocto(amount: number | string): bigint {
  const s = String(amount);
  const [whole, frac = ""] = s.split(".");
  return BigInt(whole || "0") * 10n ** 24n + BigInt((frac + "0".repeat(24)).slice(0, 24));
}

/** yocto bigint -> human-readable NEAR string. */
export function yoctoToNear(y: bigint | string): string {
  return formatNearAmount(String(y));
}

export function newMasterKey() {
  const kp = KeyPairEd25519.fromRandom();
  return {
    base58: kp.toString(),
    publicKey: kp.getPublicKey().toString(),
  };
}

export interface TxResult {
  txHash: string;
  status?: string;
}

/**
 * Ensure the master key has full access on the account (idempotent).
 * Call once after account creation / recovery.
 */
export async function ensureFullAccessKey(account: Account, masterKeyBase58: string): Promise<boolean> {
  const kp = KeyPair.fromString(masterKeyBase58 as never);
  const pk = kp.getPublicKey().toString();
  const list = await account.getAccessKeyList();
  const existing = list.keys ?? [];
  if (existing.some((k) => String(k.public_key) === pk)) return false;
  await account.addFullAccessKey(pk);
  return true;
}

/** Send native NEAR. `amount` in yoctoNEAR (bigint). */
export async function sendNear(from: Account, to: string, yoctoAmount: bigint): Promise<TxResult> {
  const res = (await from.transfer({ receiverId: to, amount: yoctoAmount })) as unknown as {
    transaction_hash?: string;
    final_execution_status?: string;
  };
  return { txHash: res.transaction_hash ?? "", status: res.final_execution_status };
}

/**
 * Send USDC (nep141). `amount` in token base units — USDC on NEAR is 6 decimals,
 * so 1 USDC = 1_000_000n.
 */
export async function sendUsdc(
  from: Account,
  to: string,
  amountBase: bigint,
  cfg: NearConfig = defaultNearConfig()
): Promise<TxResult> {
  const contractId = cfg.networkId === "mainnet" ? USDC_MAIN.accountId : USDC_TEST.accountId;
  const res = (await from.callFunctionRaw({
    contractId,
    methodName: "ft_transfer",
    args: { receiver_id: to, amount: amountBase.toString() },
    gas: teraToGas(30),
    deposit: 0n,
  })) as unknown as { transaction_hash?: string; final_execution_status?: string };
  return { txHash: res.transaction_hash ?? "", status: res.final_execution_status };
}

/** USDC decimal string ("12.5") -> base units (12_500_000n). */
export function usdcToBase(amount: number | string): bigint {
  const s = String(amount);
  const [whole, frac = ""] = s.split(".");
  return BigInt(whole || "0") * 1_000_000n + BigInt((frac + "000000").slice(0, 6));
}

/** Total balance in yoctoNEAR. */
export async function balanceOf(account: Account): Promise<bigint> {
  return account.getBalance();
}

export { PublicKey, teraToGas };
