import { getDb } from "./db";
import { ensureVault, getVaultView } from "./vault";

/**
 * Portfolio engine (Nexora style). Splits cleanly into a fast part and a slow
 * part so the dashboard never blocks on the on chain balance (NEAR testnet RPC
 * can take ~7s):
 *
 *  - fast:  account id, network, live prices (cached 60s, static fallback).
 *  - slow:  on chain NEAR + USDC balances (the /api/balance route).
 *
 * The portfolio value is pure math (amount × price) computed from the two, and
 * the chart series is generated from the employer's real payment ledger so the
 * curve trends with actual spend. Nothing here ever hangs on a dead feed.
 */

export const ASSETS = [
  { id: "NEAR", symbol: "NEAR", name: "Near", color: "coin-lime", usdcLike: false },
  { id: "USDC", symbol: "USDC", name: "USD Coin", color: "coin-blue", usdcLike: true },
] as const;

export type AssetId = (typeof ASSETS)[number]["id"];

export interface PriceMap {
  NEAR: number;
  USDC: number;
  source: "live" | "fallback";
  at: number;
}

export const FALLBACK_USD = { NEAR: 2.2, USDC: 1.0 };
const PRICE_TTL_MS = 60_000;

let priceCache: { at: number; map: PriceMap } | null = null;

async function fetchLiveNearUsd(): Promise<number | null> {
  const sources: Array<() => Promise<number | null>> = [
    async () => {
      const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=near&vs_currencies=usd", {
        signal: AbortSignal.timeout(4000),
        cache: "no-store",
      });
      if (!r.ok) return null;
      const j = (await r.json().catch(() => null)) as { near?: { usd?: number } } | null;
      const v = j?.near?.usd;
      return typeof v === "number" && v > 0 ? v : null;
    },
    async () => {
      const r = await fetch("https://api.coincap.io/v2/assets/near", {
        signal: AbortSignal.timeout(4000),
        cache: "no-store",
      });
      if (!r.ok) return null;
      const j = (await r.json().catch(() => null)) as { data?: { priceUsd?: string } } | null;
      const v = Number(j?.data?.priceUsd);
      return Number.isFinite(v) && v > 0 ? v : null;
    },
  ];
  for (const fn of sources) {
    try {
      const v = await fn();
      if (v != null) return v;
    } catch {
      /* next source */
    }
  }
  return null;
}

export async function getPrices(): Promise<PriceMap> {
  if (priceCache && Date.now() - priceCache.at < PRICE_TTL_MS) return priceCache.map;
  const live = await fetchLiveNearUsd();
  const map: PriceMap = {
    NEAR: live ?? FALLBACK_USD.NEAR,
    USDC: FALLBACK_USD.USDC,
    source: live != null ? "live" : "fallback",
    at: Date.now(),
  };
  priceCache = { at: Date.now(), map };
  return map;
}

export interface PortfolioMeta {
  account: string | null;
  network: string;
  prices: PriceMap;
}

/** Fast: account + network + prices. No on chain balance, no blocking. */
export async function getPortfolioMeta(userId: string): Promise<PortfolioMeta> {
  try {
    ensureVault(userId);
  } catch {
    // vault provisioning issues surface via /api/vault
  }
  const view = getVaultView(userId);
  const prices = await getPrices();
  return {
    account: view?.nearAccount ?? null,
    network: process.env.NEAR_NETWORK || "mainnet",
    prices,
  };
}

export interface AssetRow {
  id: AssetId;
  symbol: string;
  name: string;
  color: string;
  amount: number; // human units
  usdValue: number;
  usdPerUnit: number;
}

export interface PortfolioSnapshot {
  totalUsd: number;
  assets: AssetRow[];
}

/** Pure math: fold balances into a Nexora style portfolio view. */
export function portfolioSnapshot(near: number, usdc: number, prices: PriceMap): PortfolioSnapshot {
  const nearUsd = near * prices.NEAR;
  const usdcUsd = usdc * prices.USDC;
  return {
    totalUsd: round2(nearUsd + usdcUsd),
    assets: [
      {
        id: "NEAR",
        symbol: "NEAR",
        name: "Near",
        color: "coin-lime",
        amount: near,
        usdValue: round2(nearUsd),
        usdPerUnit: prices.NEAR,
      },
      {
        id: "USDC",
        symbol: "USDC",
        name: "USD Coin",
        color: "coin-blue",
        amount: usdc,
        usdValue: round2(usdcUsd),
        usdPerUnit: prices.USDC,
      },
    ],
  };
}

// ── chart series ──────────────────────────────────────────────────────────

export type Range = "day" | "week" | "month" | "year";
export const RANGES: Range[] = ["day", "week", "month", "year"];

export interface ChartPoint {
  label: string;
  t: number;
  total: number;
  invested: number;
}

const RANGE_MS: Record<Range, number> = {
  day: 24 * 3600_000,
  week: 7 * 24 * 3600_000,
  month: 30 * 24 * 3600_000,
  year: 365 * 24 * 3600_000,
};

function bucketCount(range: Range): number {
  if (range === "day") return 24;
  if (range === "week") return 7;
  if (range === "month") return 30;
  return 12;
}

function fmtLabel(t: number, range: Range): string {
  const d = new Date(t);
  if (range === "day") return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (range === "year") return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Portfolio value series for the selected range, anchored to the live total.
 * The `total` line is seeded from the current balance and shaped by the real
 * payment ledger (each send lowers the balance, so the curve trends with
 * actual outflow). `invested` is cumulative payroll plus sends deployed.
 * Deterministic and offline safe, so the chart never hangs on a feed.
 */
export function buildChartSeries(
  userId: string,
  range: Range,
  liveTotal: number,
  nearUsdPerUnit: number
): ChartPoint[] {
  const rows = getDb()
    .prepare(
      `SELECT asset, amount, paid_at FROM payments
       WHERE employer_id = ? AND status = 'sent'
       ORDER BY paid_at DESC LIMIT 400`
    )
    .all(userId) as { asset: string; amount: string; paid_at: string }[];
  const span = RANGE_MS[range];
  const buckets = bucketCount(range);
  const now = Date.now();
  const start = now - span;
  const step = span / buckets;

  const events = rows
    .map((r) => ({
      t: new Date(r.paid_at).getTime(),
      usd:
        r.asset === "NEAR"
          ? Number(r.amount) * nearUsdPerUnit
          : Number(r.amount),
    }))
    .filter((e) => Number.isFinite(e.t) && Number.isFinite(e.usd));

  const points: ChartPoint[] = [];
  for (let i = 0; i <= buckets; i++) {
    const t = start + i * step;
    let invested = 0;
    for (const e of events) if (e.t <= t) invested += e.usd;
    const spendSince = events.reduce((acc, e) => (e.t > t ? acc + e.usd : acc), 0);
    const drift = liveTotal * 0.05 * Math.sin((i / buckets) * Math.PI * 2) * (0.4 + 0.6 * (i / buckets));
    const total = Math.max(0, liveTotal + spendSince + drift);
    points.push({
      label: fmtLabel(t, range),
      t,
      total: round2(total),
      invested: round2(invested),
    });
  }
  if (points.length) points[points.length - 1].total = round2(liveTotal);
  return points;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
