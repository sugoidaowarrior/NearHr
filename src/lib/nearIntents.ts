/**
 * Near Intents adapter for the swap (opt in, key gated).
 *
 * "Swap via an underlying safe near" has two legs:
 *   1. Base (always on, verified on mainnet): the on-chain Ref Finance v2
 *      engine in swap.ts. Safe, self controlled, no third party.
 *   2. Near Intents (opt in): the 1Click solver relay at 1click.chaindefuser.com.
 *      It needs a partner API key (NEAR_INTENTS_API_KEY) and signs intents with
 *      the NEP-413 wallet. When the key is absent the adapter reports
 *      disabled and the caller falls back to the on-chain engine, so the swap
 *      always has a working path.
 *
 * Asset encoding for 1Click:
 *   - native NEAR  -> "NEAR"
 *   - Fungible     -> "nep141:<contract>"   (USDC.e uses the bridge contract)
 *
 * Endpoints (POST, JSON, X-API-Key header):
 *   /generate-intent  { sellAsset, buyAsset, amount, slippageBps? }
 *   /submit-intent    { intent, walletSignature }
 *
 * We cannot ship a verified end to end intents path without a partner key, so
 * every function here returns null on any failure and the route keeps the
 * on-chain quote/execution as the guaranteed result.
 */
import { USDC_E_ID } from "./near";
import type { SwapAsset, SwapQuote, SwapResult } from "./swap";

const BASE = "https://1click.chaindefuser.com";

function apiKey(): string | null {
  const k = (process.env.NEAR_INTENTS_API_KEY ?? "").trim();
  return k.length ? k : null;
}

export function nearIntentsEnabled(): boolean {
  return apiKey() != null;
}

function encodeAsset(a: SwapAsset): string {
  return a === "NEAR" ? "NEAR" : `nep141:${USDC_E_ID}`;
}

async function post<T>(path: string, body: Record<string, unknown>): Promise<T | null> {
  const key = apiKey();
  if (!key) return null;
  try {
    const r = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": key,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    return (await r.json().catch(() => null)) as T | null;
  } catch {
    return null;
  }
}

interface OneClickQuote {
  // The relay reports the amount you would receive after its solver fee. Field
  // names vary across 1Click revisions, so read a few known aliases.
  buyAmount?: string;
  amountOut?: string;
  minBuyAmount?: string;
  amountOutMin?: string;
  slippageBps?: number;
}

/**
 * Quote through 1Click. Returns a SwapQuote shaped object when the relay
 * returns a usable number, else null (caller falls back to on-chain).
 */
export async function quoteViaIntents(
  from: SwapAsset,
  to: SwapAsset,
  amountHuman: string,
  slippagePct: number
): Promise<SwapQuote | null> {
  const j = await post<OneClickQuote>("/generate-intent", {
    sellAsset: encodeAsset(from),
    buyAsset: encodeAsset(to),
    amount: String(amountHuman),
    slippageBps: Math.round(slippagePct * 100),
  });
  if (!j) return null;
  const out = j.buyAmount ?? j.amountOut;
  if (!out || !/^\d+(\.\d+)?$/.test(out)) return null;
  const minOut = j.minBuyAmount ?? j.amountOutMin ?? out;
  return {
    from,
    to,
    amount: String(amountHuman),
    expectedOut: out,
    rate: "0",
    poolId: 0,
    slippage: slippagePct,
    minOut: minOut && /^\d+(\.\d+)?$/.test(minOut) ? minOut : out,
  };
}

/**
 * Execute through 1Click. Requires the user's wallet signature over the intent
 * (NEP-413). In the custodial model the server signs with the master key, but
 * the relay additionally requires an authenticated session token for submit;
 * without that the relay rejects. Returns null unless the relay confirms a
 * submitted transaction, so the caller can fall back to on-chain execution.
 */
export async function executeViaIntents(
  input: { employerId: string; from: SwapAsset; to: SwapAsset; amount: string; slippage?: number },
  walletSignature: string
): Promise<SwapResult | null> {
  const quote = await post<{ intent?: string }>("/generate-intent", {
    sellAsset: encodeAsset(input.from),
    buyAsset: encodeAsset(input.to),
    amount: String(input.amount),
    slippageBps: Math.round((input.slippage ?? 0.5) * 100),
  });
  if (!quote?.intent) return null;
  const res = await post<{ txHash?: string; status?: string }>("/submit-intent", {
    intent: quote.intent,
    walletSignature,
  });
  if (!res || !res.txHash) return null;
  return {
    txHashes: [res.txHash],
    status: res.status ?? "submitted",
    expectedOut: "0",
    minOut: "0",
    from: input.from,
    to: input.to,
    amount: String(input.amount),
    paymentId: null,
  };
}
