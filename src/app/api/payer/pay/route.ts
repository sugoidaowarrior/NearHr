import { NextRequest, NextResponse } from "next/server";
import { resolveSession, COOKIE } from "@/lib/sessions";
import { payInvoiceFromPayerAccount } from "@/lib/walletless";
import { VaultNotReadyError } from "@/lib/invoices";

export const instant = false;

/**
 * POST /api/payer/pay { slug }
 * Walletless payer (2nd payment option): sends the invoice payment from the
 * customer's NearHr provisioned account (funded by them from a faucet) and
 * runs the same trustless on chain verification as the wallet path. The
 * invoice only flips to paid when the chain proves the vault was credited.
 */
export async function POST(req: NextRequest) {
  const userId = resolveSession(req.cookies.get(COOKIE)?.value);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const slug = String(body.slug ?? "").trim();
  if (!slug) return NextResponse.json({ error: "invoice slug is required" }, { status: 400 });
  try {
    const res = await payInvoiceFromPayerAccount(userId, slug);
    return NextResponse.json({
      ...res,
      balance: {
        nearYocto: res.balance.nearYocto.toString(),
        usdcBase: res.balance.usdcBase.toString(),
      },
    });
  } catch (e) {
    if (e instanceof VaultNotReadyError) {
      return NextResponse.json(
        { error: "the employer vault is not ready yet, try again shortly" },
        { status: 503 }
      );
    }
    const code = (e as Error & { code?: string })?.code;
    if (code === "unfunded") {
      return NextResponse.json({ error: e instanceof Error ? e.message : "unfunded" }, { status: 402 });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
