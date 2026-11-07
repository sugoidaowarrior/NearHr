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
import { actionCreators } from "@near-js/transactions";

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

/**
 * Circle's native USDC on NEAR testnet. This is the contract Circle's faucet
 * mints to: payers funded from the Circle Arc faucet hold their balance and
 * storage record here (verified on chain). near-api-js's USDC_TEST
 * (`usdc.fakes.testnet`) is a different, non-Circle contract that those payers
 * are not registered on, so pointing at it made every transfer panic with
 * "The account X is not registered".
 */
const USDC_CIRCLE_TESTNET = "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af";

/** USDC contract id for the active network (testnet: Circle's native USDC, mainnet: USDC.e). */
export function usdcContractId(networkId: string): string {
  return networkId === "mainnet" ? USDC_E_ID : USDC_CIRCLE_TESTNET;
}

export interface NearConfig {
  networkId: string; // "mainnet" | "testnet"
  nodeUrl: string;
}

export function defaultNearConfig(): NearConfig {
  const env = process.env;
  // Default to testnet: this build is a demo app. Mainnet is an explicit
  // choice (NEAR_NETWORK=mainnet in .env.local), never a silent fallback.
  const network = (env.NEAR_NETWORK || "testnet").toLowerCase();
  return {
    networkId: network,
    nodeUrl:
      env.NEAR_NODE_URL ||
      (network === "mainnet" ? "https://free.rpc.fastnear.com" : "https://test.rpc.fastnear.com"),
  };
}

/**
 * RPC failover order. rpc.mainnet.near.org is deprecated and rate limited
 * (it 429s and warns to switch), so it stays only as the last resort.
 */
export function rpcCandidates(network: string): string[] {
  if (network !== "mainnet") {
    // rpc.testnet.near.org is deprecated and now hard 429s, so the working
    // public testnet endpoints come first and it is the last resort.
    return [
      "https://test.rpc.fastnear.com",
      "https://rpc.testnet.fastnear.com",
      "https://archival-rpc.testnet.near.org",
      "https://rpc.testnet.near.org",
    ];
  }
  return [
    "https://free.rpc.fastnear.com",
    "https://rpc.mainnet.fastnear.com",
    "https://rpc.mainnet.near.org",
  ];
}

/** One provider per URL (keep alive connections, no repeated TLS handshakes). */
const providerByUrl = new Map<string, JsonRpcProvider>();
function providerFor(url: string): JsonRpcProvider {
  let p = providerByUrl.get(url);
  if (!p) {
    p = new JsonRpcProvider({ url });
    providerByUrl.set(url, p);
  }
  return p;
}

/**
 * Raw view call with automatic RPC failover. Network, rate limit and bad
 * response errors fall through to the next endpoint; deterministic on chain
 * errors are returned as-is (retrying another node would return the same
 * error and just burn time).
 */
export async function rawViewFailover(
  accountId: string,
  method: string,
  args: Record<string, unknown>
): Promise<string> {
  const cfg = defaultNearConfig();
  const urls = Array.from(new Set([cfg.nodeUrl, ...rpcCandidates(cfg.networkId)]));
  let lastErr: unknown = null;
  for (const url of urls) {
    try {
      const res = (await providerFor(url).query({
        request_type: "call_function",
        account_id: accountId,
        method_name: method,
        args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
        finality: "optimistic",
      } as never)) as unknown as { error?: string; result?: unknown[] };
      if (typeof res?.error === "string") return res.error;
      if (Array.isArray(res?.result)) return Buffer.from(res.result as number[]).toString("utf8");
      throw new Error(`view ${method} returned no result`);
    } catch (e) {
      // Deterministic on chain failures (wasm execution errors, panics) are
      // the same on every node: fail fast instead of burning the failover chain.
      const name = e instanceof Error ? e.name : "";
      if (name === "ContractExecutionError" || /wasm execution failed|reverted|panicked/i.test(String(e))) {
        throw e;
      }
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
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

/** Explorer URL for a tx hash on the active network. */
export function explorerUrl(networkId: string, txHash: string): string {
  const base =
    networkId === "mainnet" ? "https://explorer.near.org" : "https://explorer.testnet.near.org";
  return `${base}/transactions/${txHash}`;
}

const HEX64_RE = /^[0-9a-f]{64}$/i;
const B58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,55}$/;

function b58ToHex(s: string): string | null {
  const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = 0n;
  for (const c of s) {
    const i = A.indexOf(c);
    if (i < 0) return null;
    n = n * 58n + BigInt(i);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n % 256n));
    n /= 256n;
  }
  for (const c of s) {
    if (c === "1") bytes.unshift(0);
    else break;
  }
  if (bytes.length !== 32) return null;
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function b64ToHex(s: string): string | null {
  try {
    const b = Buffer.from(s, "base64");
    if (b.length !== 32) return null;
    return b.toString("hex");
  } catch {
    return null;
  }
}

/**
 * Normalize a tx hash in any of the encodings we may see to the canonical 64
 * hex CryptoHash: 64 hex (RPC), base58 (explorer + some wallets), base64
 * (other wallets). Returns "" when the input is not a recognizable hash.
 */
export function normalizeTxHash(input: string): string {
  let t = String(input ?? "").trim();
  if (!t) return "";
  // A pasted explorer URL carries the hash in the last path segment.
  if (/^https?:\/\//i.test(t)) {
    const m = t.match(/\/transactions\/([A-Za-z0-9+/=]+)/i);
    if (!m) return "";
    t = m[1];
  }
  if (HEX64_RE.test(t)) return t.toLowerCase();
  if (B58_RE.test(t)) return b58ToHex(t) ?? "";
  if (/^[A-Za-z0-9+/]{40,48}={0,2}$/.test(t)) return b64ToHex(t) ?? "";
  return "";
}

/**
 * Raw tx status RPC: fetch a fully executed transaction by hash + signer id.
 * The modern nearcore node takes the tx method with a BASE58 encoded hash and
 * `sender_account_id` (hex or other encodings are rejected with a parse
 * error), and `EXPERIMENTAL_tx_status` is the variant that returns the
 * receipt list we verify against. We fail over across the public endpoints
 * and across the two method names (newer nodes renamed it to `tx_status`).
 * Returns the FinalExecutionOutcome: { final_execution_status, status,
 * transaction, receipts[] }. This is the primitive for trustless server side
 * payment verification: the server reads the real on chain outcome, so a
 * payer can not claim a payment that never happened.
 */
const TX_STATUS_METHODS = ["EXPERIMENTAL_tx_status", "tx_status"];

function hexToB58(hex: string): string {
  const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = BigInt("0x" + hex);
  let s = "";
  while (n > 0n) {
    s = A[Number(n % 58n)] + s;
    n /= 58n;
  }
  for (const c of hex) {
    if (c === "0") s = "1" + s;
    else break;
  }
  return s;
}

export async function queryTx(txHash: string, senderId: string) {
  const cfg = defaultNearConfig();
  const urls = Array.from(new Set([cfg.nodeUrl, ...rpcCandidates(cfg.networkId)]));
  const b58 = hexToB58(txHash);
  let lastErr: unknown = null;
  for (const url of urls) {
    for (const method of TX_STATUS_METHODS) {
      try {
        const res = (await providerFor(url).sendJsonRpc(method as never, {
          tx_hash: b58,
          sender_account_id: senderId,
          wait_until: "EXECUTED_OPTIMISTIC",
        })) as unknown as {
          final_execution_status?: string;
          status?: unknown;
          transaction?: unknown;
          transaction_outcome?: unknown;
          receipts_outcome?: { id: string; outcome: Record<string, unknown> }[];
          receipts?: {
            receipt_id: string;
            receiver_id: string;
            predecessor_id: string;
            receipt?: { Action?: { actions?: unknown[] } };
          }[];
        };
        return res;
      } catch (e) {
        lastErr = e;
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
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
 * Live USDC storage minimum (base yoctoNEAR). The contract computes it from
 * current storage usage, so it grows over time: read it, do not hardcode it.
 * Falls back to a safe 2x the last observed minimum when the view call fails.
 */
export async function usdcStorageMin(cfg: NearConfig = defaultNearConfig()): Promise<bigint> {
  const contractId = usdcContractId(cfg.networkId);
  try {
    const text = (await rawViewFailover(contractId, "storage_balance_bounds", {})).trim();
    const b = JSON.parse(text) as { min?: string };
    const min = BigInt(String(b.min ?? "0"));
    if (min > 0n) return min;
  } catch {
    /* fall through to the fallback */
  }
  // Last observed minimum on chain. Attaching above max panics, so this is the
  // exact observed value, not a padded guess.
  return 1250000000000000000000n;
}

/**
 * USDC.e (nep141) registration: the vault must own a storage record on the
 * token contract before it can hold USDC. Cost is the live storage minimum
 * (verified against storage_balance_bounds on chain). Idempotent: no-op when
 * already registered.
 */
export async function ensureUsdcRegistration(
  account: Account,
  cfg: NearConfig = defaultNearConfig()
): Promise<void> {
  const contractId = usdcContractId(cfg.networkId);
  const owner = account.accountId;
  let text = "";
  try {
    text = (await rawViewFailover(contractId, "storage_balance_of", { account_id: owner })).trim();
  } catch {
    text = "";
  }
  if (text && text !== "null" && text.length > 1) return; // already registered
  const dep = (await account.callFunctionRaw({
    contractId,
    methodName: "storage_deposit",
    args: { registration_only: true, account_id: owner },
    gas: teraToGas(30),
    deposit: await usdcStorageMin(cfg),
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
    deposit: 1n, // NEP-141 requires exactly 1 yoctoNEAR attached to ft_transfer
  })) as unknown;
  const { txHash, failed } = parseTx(res);
  if (failed) throw new Error(`USDC transfer failed: ${failed}`);
  return { txHash, status: "Success" };
}

/**
 * Send USDC from the payer to the employer's vault, and in the SAME
 * transaction register the vault on the token contract. The one time
 * registration costs the live storage minimum (read on demand) and is paid
 * by the payer (the vault is an implicit account that is usually empty, so
 * it can not pay for its own record). If the vault already has a record, the
 * contract refunds the whole deposit, so paying twice is safe. Actions
 * execute in order: the record exists before the transfer runs.
 */
export async function sendUsdcToVault(
  from: Account,
  to: string,
  amountBase: bigint,
  cfg: NearConfig = defaultNearConfig(),
  registrationDeposit?: bigint
): Promise<TxResult> {
  const contractId = usdcContractId(cfg.networkId);
  const reg = registrationDeposit ?? (await usdcStorageMin(cfg));
  // v7 (@near-js/transactions 2.5.x) serializes actions with borsh using the
  // camelCase Action schema (functionCall.methodName, args as JSON bytes).
  // Hand built PascalCase objects (FunctionCall.method_name + base64 args)
  // are rejected by that schema, so always build via actionCreators.
  const actions = [
    actionCreators.functionCall(
      "storage_deposit",
      { account_id: to },
      teraToGas(30),
      reg
    ),
    actionCreators.functionCall(
      "ft_transfer",
      { receiver_id: to, amount: amountBase.toString() },
      teraToGas(30),
      1n // NEP-141 requires exactly 1 yoctoNEAR attached to ft_transfer
    ),
  ];
  const res = (await from.signAndSendTransaction({ receiverId: contractId, actions })) as unknown;
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
  let text = "";
  try {
    text = (await rawViewFailover(contractId, "ft_balance_of", { account_id: owner })).trim();
  } catch {
    return 0n;
  }
  if (!text) return 0n;
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
