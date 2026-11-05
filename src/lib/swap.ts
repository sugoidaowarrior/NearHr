/**
 * Swap engine: NEAR <-> USDC.e on mainnet via Ref Finance (v2.ref-finance.near).
 *
 * Verified against live mainnet + the official ref-sdk (v1-swap/instantSwap.ts):
 *   - The v2.ref-finance.near contract (the SDK's REF_FI_CONTRACT_ID) takes the
 *     v1 execution format: a single ft_transfer_call on the INPUT token with
 *     msg = {"force":0,"actions":[{pool_id,token_in,token_out,amount_in,min_amount_out}]},
 *     gas 300 TGAS, deposit 1 yocto.
 *   - The swap input for the NEAR leg is wNEAR (wrap.near), NOT native NEAR, so
 *     we wrap before / unwrap after. The DCL {"Swap":{...}} shape belongs to a
 *     different contract (dclv2.ref-labs.near) and is deliberately NOT used.
 *   - Output token must be registered (storage_deposit registration_only) first.
 *
 * The pool used is chosen live (deepest wNEAR/USDC.e pool by wNEAR depth) so we
 * always route through real liquidity; it is never hardcoded.
 */
import {
  accountFromVault,
  balanceOf,
  defaultNearConfig,
  nearProvider,
  toYocto,
  usdcToBase,
  usdcBalanceOf,
  REF_CONTRACT,
  WNEAR_ID,
  USDC_E_ID,
  teraToGas,
} from "./near";
import { recordPayment, type PaymentAsset } from "./payments";

export type SwapAsset = "NEAR" | "USDC";

export interface SwapQuote {
  from: SwapAsset;
  to: SwapAsset;
  amount: string; // human, input
  expectedOut: string; // human, estimated output
  rate: string; // out per 1 in
  poolId: number;
  slippage: number;
  minOut: string; // human, worst acceptable (quote minus slippage)
}

export interface SwapResult {
  txHashes: string[];
  status: string;
  expectedOut: string;
  minOut: string;
  from: SwapAsset;
  to: SwapAsset;
  amount: string;
  paymentId: string | null;
}

const GAS_30 = teraToGas(30);
const GAS_300 = teraToGas(300);
const ONE_YOCTO = 1n;
const REGISTRATION_YOCTO = toYocto("0.125"); // storage_balance_bounds.min (verified)
// Reserve kept for gas + token registration so a fully-swept balance can't fail.
const NEAR_RESERVE_YOCTO = toYocto("0.30");

const DEFAULT_SLIPPAGE = 0.5; // percent

/* ------------------------------ live data ------------------------------ */

interface NearViewRes {
  result?: unknown[];
}

async function rawView(
  accountId: string,
  method: string,
  args: Record<string, unknown>
): Promise<string> {
  const cfg = defaultNearConfig();
  const res = (await nearProvider(cfg).query({
    request_type: "call_function",
    account_id: accountId,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
    finality: "optimistic",
  } as never)) as unknown as NearViewRes;
  return Buffer.from((res.result ?? []) as number[]).toString("utf8");
}

/** ft_balance_of -> bigint base units (0 if absent). */
async function ftBalance(token: string, owner: string): Promise<bigint> {
  try {
    const t = (await rawView(token, "ft_balance_of", { account_id: owner })).trim();
    let s = t;
    if (t.startsWith("{")) {
      const o = JSON.parse(t) as { amount?: unknown };
      s = String(o.amount ?? "0");
    } else {
      s = t.replace(/^"|"$/g, "").trim();
    }
    return s && /^\d+$/.test(s) ? BigInt(s) : 0n;
  } catch {
    return 0n;
  }
}

/** storage_balance_of -> true if the account is registered on the token. */
async function isRegistered(token: string, owner: string): Promise<boolean> {
  try {
    const t = (await rawView(token, "storage_balance_of", { account_id: owner })).trim();
    return t !== "null" && t.length > 0 && t !== "";
  } catch {
    return false;
  }
}

/** Deepest valid wNEAR/USDC.e pool, chosen live. Cached briefly. */
let poolCache: { poolId: number; at: number } | null = null;
const POOL_TTL_MS = 120_000;

export async function findUsdcWnearPool(): Promise<number> {
  if (poolCache && Date.now() - poolCache.at < POOL_TTL_MS) return poolCache.poolId;
  const raw = await rawView(REF_CONTRACT, "get_number_of_pools", {});
  const total = Number(raw.replace(/[^0-9]/g, "") || "0");
  if (!total) throw new Error("swap pool list unavailable");

  const page = 500;
  const pages: number[] = [];
  for (let i = 0; i < total; i += page) pages.push(i);

  // Fetch pages in small parallel waves (bounded concurrency, no hammering RPC).
  const rows: { id: number; w: number; u: number }[] = [];
  const wave = 6;
  for (let i = 0; i < pages.length; i += wave) {
    const chunk = pages.slice(i, i + wave);
    const res = await Promise.all(
      chunk.map(async (from) => {
        try {
          const t = await rawView(REF_CONTRACT, "get_pools", {
            from_index: from,
            limit: page,
          });
          return { from, arr: JSON.parse(t) as Record<string, unknown>[] };
        } catch {
          return { from, arr: [] as Record<string, unknown>[] };
        }
      })
    );
    for (const { from, arr } of res) {
      for (let k = 0; k < arr.length; k++) {
        const p = arr[k];
        const ids = p?.token_account_ids as string[] | undefined;
        const amounts = p?.amounts as string[] | undefined;
        if (!ids || !amounts || ids.length !== 2 || amounts.length !== 2) continue;
        if (!ids.includes(WNEAR_ID) || !ids.includes(USDC_E_ID)) continue;
        const iW = ids.indexOf(WNEAR_ID);
        const iT = ids.indexOf(USDC_E_ID);
        const w = Number(amounts[iW]);
        const u = Number(amounts[iT]);
        if (!Number.isFinite(w) || !Number.isFinite(u) || w <= 0 || u <= 0) continue;
        rows.push({ id: from + k, w, u });
      }
    }
  }

  if (!rows.length) throw new Error("no liquid USDC/NEAR pool found");
  rows.sort((a, b) => b.w - a.w);
  poolCache = { poolId: rows[0].id, at: Date.now() };
  return poolCache.poolId;
}

/** On-chain quote: input base units -> expected output base units (string). */
async function getReturn(
  poolId: number,
  tokenIn: string,
  tokenOut: string,
  amountIn: string
): Promise<string> {
  const t = (await rawView(REF_CONTRACT, "get_return", {
    pool_id: poolId,
    token_in: tokenIn,
    token_out: tokenOut,
    amount_in: amountIn,
  })).trim().replace(/^"|"$/g, "");
  if (!t || !/^\d+$/.test(t)) throw new Error("swap quote failed");
  return t;
}

/* ------------------------------- quote -------------------------------- */

export async function quoteSwap(
  from: SwapAsset,
  to: SwapAsset,
  amountHuman: string,
  slippage: number = DEFAULT_SLIPPAGE
): Promise<SwapQuote> {
  if (from === to) throw new Error("pick two different assets to swap");
  const s = String(amountHuman).trim();
  if (!/^\d+(\.\d{1,8})?$/.test(s) || Number(s) <= 0) throw new Error("amount must be greater than zero");
  const sl = Math.min(Math.max(slippage, 0), 20);

  const poolId = await findUsdcWnearPool();

  // NEAR -> USDC: wNEAR (24 dec) -> USDC.e (6 dec). USDC -> NEAR is the mirror.
  let tokenIn: string, tokenOut: string, inBase: string;
  let inDec = 24, outDec = 6;
  if (from === "NEAR") {
    tokenIn = WNEAR_ID;
    tokenOut = USDC_E_ID;
    inBase = toYocto(s).toString();
  } else {
    tokenIn = USDC_E_ID;
    tokenOut = WNEAR_ID;
    inBase = usdcToBase(s).toString();
    inDec = 6;
    outDec = 24;
  }
  const outBase = await getReturn(poolId, tokenIn, tokenOut, inBase);
  const inBaseN = BigInt(inBase);
  const outBaseN = BigInt(outBase);
  if (outBaseN <= 0n) throw new Error("quote returned zero; try a smaller amount");

  const exp = fromBaseHuman(to, outBase);
  const minBase = slippagePctDown(outBaseN, sl);
  const rate = divHuman(inBaseN, inDec, outBaseN, outDec);

  return {
    from,
    to,
    amount: s,
    expectedOut: exp,
    rate,
    poolId,
    slippage: sl,
    minOut: fromBaseHuman(to, minBase.toString()),
  };
}

/* ----------------------------- execution ------------------------------ */

/**
 * v7 send_tx return shape (verified): hash = transaction_outcome.id (also
 * echoed as transaction_hash), final status = top level `status`.
 */
function parseTx(res: unknown): { txHash: string; failed: string | null } {
  const r = res as {
    transaction_hash?: string;
    status?: { Success?: unknown; Failure?: string } | string;
    transaction_outcome?: { id?: string };
  };
  const txHash = r.transaction_hash || r.transaction_outcome?.id || "";
  let failed: string | null = null;
  if (typeof r.status === "object" && r.status !== null && "Failure" in r.status) {
    failed = String(r.status.Failure ?? "unknown failure");
  }
  return { txHash, failed };
}

async function call(
  account: import("near-api-js").Account,
  contractId: string,
  methodName: string,
  args: Record<string, unknown>,
  gas: bigint,
  deposit: bigint
): Promise<string> {
  const res = (await account.callFunctionRaw({
    contractId,
    methodName,
    args,
    gas,
    deposit,
  })) as unknown;
  const { txHash, failed } = parseTx(res);
  if (failed) {
    throw new Error(`transaction ${methodName} failed: ${failed}`);
  }
  return txHash;
}

/** Register the account on a token (0.125 NEAR) only if not already registered. */
async function ensureRegistered(account: import("near-api-js").Account, token: string, owner: string): Promise<string[]> {
  if (await isRegistered(token, owner)) return [];
  await call(account, token, "storage_deposit", { registration_only: true, account_id: owner }, GAS_30, REGISTRATION_YOCTO);
  return [token];
}

async function wrapNear(account: import("near-api-js").Account, yocto: bigint): Promise<string> {
  return call(account, WNEAR_ID, "create", {}, GAS_30, yocto);
}

async function unwrapWnear(account: import("near-api-js").Account, owner: string): Promise<string> {
  const w = await ftBalance(WNEAR_ID, owner);
  if (w <= 0n) return "";
  return call(account, WNEAR_ID, "unwrap", { amount: w.toString() }, GAS_30, 0n);
}

function refMsg(poolId: number, tokenIn: string, tokenOut: string, amountIn: string, minOut: string): string {
  return JSON.stringify({
    force: 0,
    actions: [{ pool_id: poolId, token_in: tokenIn, token_out: tokenOut, amount_in: amountIn, min_amount_out: minOut }],
  });
}

async function refTransferCall(
  account: import("near-api-js").Account,
  inputToken: string,
  amountIn: string,
  msg: string
): Promise<string> {
  return call(
    account,
    inputToken,
    "ft_transfer_call",
    { receiver_id: REF_CONTRACT, amount: amountIn, msg },
    GAS_300,
    ONE_YOCTO
  );
}

/**
 * Execute a NEAR <-> USDC swap from the employer vault and record it in the
 * ledger. Throws with a clear message on any failure (including insufficient
 * balance).
 */
export async function executeSwap(
  input: { employerId: string; from: SwapAsset; to: SwapAsset; amount: string; slippage?: number },
  vault: { nearAccount: string; nearMasterKey: string }
): Promise<SwapResult> {
  if (input.from === input.to) throw new Error("pick two different assets to swap");
  const s = String(input.amount).trim();
  const sl = input.slippage ?? DEFAULT_SLIPPAGE;

  const account = accountFromVault(vault.nearAccount, vault.nearMasterKey);
  const owner = vault.nearAccount;
  const txHashes: string[] = [];
  const registered: string[] = [];

  let expectedOut: string;
  let minOut: string;
  let poolId: number;
  let tokenIn: string, tokenOut: string;
  let inBase: string;

  if (input.from === "NEAR") {
    // --- NEAR -> USDC.e : register USDC.e, wrap, swap ---
    const nearBal = await balanceOf(account).catch(() => 0n);
    const need = toYocto(s) + NEAR_RESERVE_YOCTO;
    if (nearBal < need) {
      throw new Error(
        `insufficient NEAR: need at least ${(Number(need) / 1e24).toFixed(4)} NEAR to cover the swap plus gas and registration`
      );
    }
    const yocto = toYocto(s);
    poolId = await findUsdcWnearPool();
    tokenIn = WNEAR_ID;
    tokenOut = USDC_E_ID;
    inBase = yocto.toString();
    const outBase = await getReturn(poolId, tokenIn, tokenOut, inBase);
    if (BigInt(outBase) <= 0n) throw new Error("quote returned zero; try a smaller amount");
    expectedOut = fromBaseHuman("USDC", outBase);
    minOut = fromBaseHuman("USDC", slippagePctDown(BigInt(outBase), sl).toString());

    if ((await isRegistered(USDC_E_ID, owner)) === false) {
      registered.push(...(await ensureRegistered(account, USDC_E_ID, owner)));
    }
    txHashes.push(await wrapNear(account, yocto));
    txHashes.push(await refTransferCall(account, WNEAR_ID, inBase, refMsg(poolId, tokenIn, tokenOut, inBase, minOut)));
  } else {
    // --- USDC.e -> NEAR : register wNEAR, swap, unwrap ---
    const usdcBal = await usdcBalanceOf(owner).catch(() => 0n);
    const need = usdcToBase(s);
    if (usdcBal < need) throw new Error("insufficient USDC balance for this swap");
    const nearBal = await balanceOf(account).catch(() => 0n);
    if (nearBal < toYocto("0.2")) {
      throw new Error("insufficient NEAR for gas; add a small NEAR balance (0.2+ NEAR) first");
    }
    const base = usdcToBase(s);
    poolId = await findUsdcWnearPool();
    tokenIn = USDC_E_ID;
    tokenOut = WNEAR_ID;
    inBase = base.toString();
    const outBase = await getReturn(poolId, tokenIn, tokenOut, inBase);
    if (BigInt(outBase) <= 0n) throw new Error("quote returned zero; try a smaller amount");
    expectedOut = fromBaseHuman("NEAR", outBase);
    minOut = fromBaseHuman("NEAR", slippagePctDown(BigInt(outBase), sl).toString());

    if ((await isRegistered(WNEAR_ID, owner)) === false) {
      registered.push(...(await ensureRegistered(account, WNEAR_ID, owner)));
    }
    txHashes.push(await refTransferCall(account, USDC_E_ID, inBase, refMsg(poolId, tokenIn, tokenOut, inBase, minOut)));
    const un = await unwrapWnear(account, owner);
    if (un) txHashes.push(un);
  }

  const paymentId = recordPayment({
    employerId: input.employerId,
    employeeId: null,
    recipientWallet: owner,
    kind: "swap",
    asset: (input.from === "NEAR" ? "NEAR" : "USDC") as PaymentAsset,
    amount: s,
    note: `swap ${input.from} → ${input.to} (min ${minOut})`,
    txRef: txHashes[txHashes.length - 1] || "ok",
    status: "sent",
  });

  return {
    txHashes,
    status: "submitted",
    expectedOut,
    minOut,
    from: input.from,
    to: input.to,
    amount: s,
    paymentId,
  };
}

/* ------------------------------ helpers ------------------------------- */

function fromBaseHuman(asset: SwapAsset, base: string | bigint): string {
  const b = BigInt(base);
  if (asset === "NEAR") {
    const whole = b / 10n ** 24n;
    const frac = (b % 10n ** 24n).toString().padStart(24, "0").replace(/0+$/, "");
    return frac ? `${whole}.${frac}` : `${whole}`;
  }
  const whole = b / 1_000_000n;
  const frac = (b % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

function slippagePctDown(outBase: bigint, pct: number): bigint {
  if (pct <= 0) return outBase;
  // floor(outBase * (1 - pct/100)) with integer math.
  const scaled = outBase * BigInt(Math.round((100 - pct) * 1000));
  return scaled / 100_000n;
}

/** rate = out/in as a plain decimal string (6 dp), human friendly. */
function divHuman(inBase: bigint, inDec: number, outBase: bigint, outDec: number): string {
  const scale = 1000000n;
  const outS = outBase * scale * 10n ** BigInt(inDec);
  const num = outS / 10n ** BigInt(outDec);
  const den = inBase;
  if (den === 0n) return "0";
  const q = num / den;
  const whole = q / scale;
  const frac = (q % scale).toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}
