import { NextRequest, NextResponse } from "next/server";
import { resolveSession, COOKIE } from "@/lib/sessions";
import { ensurePayerAccount, faucetUrl, nearFaucetUrl, payerBalances } from "@/lib/walletless";

export const instant = false;

/**
 * GET /api/payer/account
 * Walletless payer (2nd payment option): after Google sign in on the pay
 * page, this provisions the customer's NEAR account on first use and returns
 * its address, live balances and the faucet to fund it. The account holds no
 * money until the customer funds it: email is only the sign in method.
 */
export async function GET(req: NextRequest) {
  const userId = resolveSession(req.cookies.get(COOKIE)?.value);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const payer = ensurePayerAccount(userId);
    const balance = await payerBalances(payer);
    return NextResponse.json({
      nearAccount: payer.nearAccount,
      faucetUrl: faucetUrl(),
      nearFaucetUrl: nearFaucetUrl(),
      balance: { nearYocto: balance.nearYocto.toString(), usdcBase: balance.usdcBase.toString() },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
