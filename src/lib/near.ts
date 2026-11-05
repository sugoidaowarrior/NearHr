/**
 * NEAR layer (near-api-js v7 API).
 *
 * Custodial model: NearHr holds an ed25519 master key per user. That key is
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
import { USDC as USDC_TEST } from "near-api-js/tokens/testnet";

/**
 * Mainnet token contracts (single source of truth).
 *
 * USDC is standardized on the bridged USDC.e (the deployment Ref Finance v2
 * pools against), so payroll payouts and swaps use the same token with real
 * liquidity. wrap.near is the official wNEAR wrapper used as the swap input.
 */
export const REF_CONTRACT = "v2.ref-finance.near";
export const WNEAR_ID = "wrap.near";
export const USDC_E_ID = "a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.factory.bridge.near";

/** Mainnet USDC = USDC.e (bridged, Ref Finance liquid). Testnet keeps its own. */
function usdcContractId(networkId: string): string {
  return networkId === "mainnet" ? USDC_E_ID : USDC_TEST.accountId;
}

export interface NearConfig {
  networkId: string; // "mainnet" | "testnet"
  nodeUrl: string;
}

export function defaultNearConfig(): NearConfig {
  const env = process.env;
  const network = (env.NEAR_NETWORK || "mainnet").toLowerCase();
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

/**
 * v7 send_tx / signAndSendTransaction return shape (verified against
 * node_modules): the transaction hash is `transaction_outcome.id` (the RPC
 * level also echoes it as `transaction_hash`) and the final status is a top
 * level `status` field: `{ Success }` or `{ Failure: "..." }`.
 */
function parseTx(res: unknown): { txHash: string; failed: string | null } {
  const r = res as {
    transaction_hash?: string;
    status?: { Success?: unknown; Failure?: string } | string;
    transaction_outcome?: { id?: string };
  };
  const txHash =
    r.transaction_hash ||
    r.transaction_outcome?.id ||
    "";
  let failed: string | null = null;
  if (typeof r.status === "object" && r.status !== null && "Failure" in r.status) {
    failed = String(r.status.Failure ?? "unknown failure");
  }
  return { txHash, failed };
}

/** Send native NEAR. `amount` in yoctoNEAR (bigint). */
export async function sendNear(from: Account, to: string, yoctoAmount: bigint): Promise<TxResult> {
  const res = (await from.transfer({ receiverId: to, amount: yoctoAmount })) as unknown;
  const { txHash, failed } = parseTx(res);
  if (failed) throw new Error(`NEAR transfer failed: ${failed}`);
  return { txHash, status: "Success" };
}

/**
 * USDC.e (nep141) registration: the vault must own a storage record on the
 * token contract before it can hold USDC (mainnet cost: 0.125 NEAR, verified
 * against storage_balance_bounds). Idempotent: no-op when already registered.
 */
export async function ensureUsdcRegistration(
  account: Account,
  cfg: NearConfig = defaultNearConfig()
): Promise<void> {
  const contractId = usdcContractId(cfg.networkId);
  const owner = account.accountId;
  const argsBase64 = Buffer.from(JSON.stringify({ account_id: owner })).toString("base64");
  const res = (await nearProvider(cfg).query({
    request_type: "call_function",
    account_id: contractId,
    method_name: "storage_balance_of",
    args_base64: argsBase64,
    finality: "optimistic",
  } as never)) as unknown as { result?: unknown[] };
  const text = res.result ? Buffer.from(res.result as number[]).toString("utf8").trim() : "";
  if (text && text !== "null" && text.length > 1) return; // already registered
  const dep = (await account.callFunctionRaw({
    contractId,
    methodName: "storage_deposit",
    args: { registration_only: true, account_id: owner },
    gas: teraToGas(30),
    deposit: toYocto("0.125"),
  })) as unknown;
  const { failed } = parseTx(dep);
  if (failed) throw new Error(`USDC registration failed: ${failed}`);
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
  const contractId = usdcContractId(cfg.networkId);
  const res = (await from.callFunctionRaw({
    contractId,
    methodName: "ft_transfer",
    args: { receiver_id: to, amount: amountBase.toString() },
    gas: teraToGas(30),
    deposit: 0n,
  })) as unknown;
  const { txHash, failed } = parseTx(res);
  if (failed) throw new Error(`USDC transfer failed: ${failed}`);
  return { txHash, status: "Success" };
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

/**
 * USDC (nep141) balance for an account, in base units (6 decimals).
 * Uses a plain view call — works for implicit accounts (returns 0 if unfunded).
 */
export async function usdcBalanceOf(owner: string, cfg: NearConfig = defaultNearConfig()): Promise<bigint> {
  const contractId = usdcContractId(cfg.networkId);
  const argsBase64 = Buffer.from(JSON.stringify({ account_id: owner })).toString("base64");
  const res = (await nearProvider(cfg).query({
    request_type: "call_function",
    account_id: contractId,
    method_name: "ft_balance_of",
    args_base64: argsBase64,
    finality: "optimistic",
  } as never)) as unknown as { result?: unknown[] };

  // call_function returns raw bytes of the method's serialized return value.
  const bytes = res.result;
  if (!bytes || !Array.isArray(bytes) || bytes.length === 0) return 0n;
  const text = Buffer.from(bytes as number[]).toString("utf8").trim();
  let amount = "0";
  if (text.startsWith("{")) {
    // e.g. {"amount":"1000"}
    try {
      const obj = JSON.parse(text) as { amount?: unknown };
      amount = String(obj.amount ?? "0");
    } catch {
      amount = "0";
    }
  } else {
    // e.g. "1000" or 1000
    amount = text.replace(/^"|"$/g, "").trim();
  }
  return amount ? BigInt(amount) : 0n;
}

export { PublicKey, teraToGas };
