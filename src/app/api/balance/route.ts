import { NextRequest, NextResponse } from "next/server";
import { resolveSession, COOKIE } from "@/lib/sessions";
import { ensureVault, unlockVault } from "@/lib/vault";

// Short in-memory cache keyed by user — the NEAR testnet RPC round-trip is
// slow (~5-7s) and the dashboard refreshes often. TTL keeps it fresh without
// re-hitting the chain on every visit.
const CACHE_TTL_MS = 10_000;
const balanceCache = new Map<string, { at: number; body: unknown }>();

// GET /api/balance -> wallet balances (NEAR + USDC). No passphrase — the
// vault auto-unlocks server-side. Account state is included so the UI can
// show "fund your wallet" when the implicit account hasn't been funded yet.
export async function GET(req: NextRequest) {
  const userId = resolveSession(req.cookies.get(COOKIE)?.value);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const cached = balanceCache.get(userId);
  const force = req.nextUrl.searchParams.get("refresh") === "1";
  if (!force && cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return NextResponse.json(cached.body);
  }

  let vault;
  try {
    ensureVault(userId);
    vault = unlockVault(userId);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }

  const { accountFromVault, balanceOf, yoctoToNear, usdcBalanceOf } = await import("@/lib/near");
  const account = accountFromVault(vault.nearAccount, vault.nearMasterKey);

  let near: bigint | null = null;
  try {
    near = await balanceOf(account);
  } catch {
    near = null; // implicit account not yet funded -> treat as 0
  }
  const usdc = await usdcBalanceOf(vault.nearAccount).catch(() => 0n);

  const body = {
    nearAccount: vault.nearAccount,
    funded: near !== null,
    near:
      near !== null
        ? { yocto: near.toString(), human: yoctoToNear(near) }
        : { yocto: "0", human: "0" },
    usdc: { base: usdc.toString(), human: (Number(usdc) / 1e6).toFixed(2) },
  };
  balanceCache.set(userId, { at: Date.now(), body });
  return NextResponse.json(body);
}
