import { NextRequest, NextResponse } from "next/server";
import { resolveSession, COOKIE } from "@/lib/sessions";
import { cashOutPayerAccount } from "@/lib/walletless";

export const instant = false;

/**
 * POST /api/payer/cashout { dest, asset, amount? }
 * Walletless payer: move funds from their NearHr payment account to a NEAR
 * account of their choice, on chain. This is how they get money back to a
 * wallet they control (after a refund, or unspent change). The server sends
 * the exact amount and confirms the transaction executed before responding.
 */
export async function POST(req: NextRequest) {
  const userId = resolveSession(req.cookies.get(COOKIE)?.value);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const dest = String(body.dest ?? "").trim();
  const asset = body.asset === "NEAR" || body.asset === "USDC" ? body.asset : null;
  if (!dest) return NextResponse.json({ error: "a destination NEAR account is required" }, { status: 400 });
  if (!asset) return NextResponse.json({ error: "asset must be NEAR or USDC" }, { status: 400 });
  const amount = body.amount === undefined ? undefined : String(body.amount ?? "").trim();
  try {
    const res = await cashOutPayerAccount(userId, dest, asset, amount);
    return NextResponse.json({
      confirmed: res.confirmed,
      detail: res.detail,
      txHash: res.txHash,
      explorerUrl: res.explorerUrl,
      balance: {
        nearYocto: res.balance.nearYocto.toString(),
        usdcBase: res.balance.usdcBase.toString(),
      },
    });
  } catch (e) {
    const code = (e as Error & { code?: string })?.code;
    if (code === "unfunded") {
      return NextResponse.json({ error: e instanceof Error ? e.message : "unfunded" }, { status: 402 });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
