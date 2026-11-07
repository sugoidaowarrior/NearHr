import { NextRequest, NextResponse } from "next/server";
import {
  getInvoiceBySlug,
  publicView,
  payDetails,
  verifyPayment,
  VaultNotReadyError,
} from "@/lib/invoices";
import { usdcStorageMin, normalizeTxHash } from "@/lib/near";

// Public pay link API. No login: the link is the permission.
//
// GET  /api/invoices/slug/[slug]        -> what the client owes + where to send it
// POST /api/invoices/slug/[slug] { txHash, payerAccount }
//      -> the client signs in with a wallet, sends USDC, then posts the hash.
//         The server reads the chain and flips the invoice to paid only when the
//         vault is provably credited the exact amount. Trustless.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const inv = getInvoiceBySlug(slug);
  if (!inv) return NextResponse.json({ error: "invoice not found" }, { status: 404 });
  try {
    const v = publicView(inv, true);
    // USDC invoices need the live storage minimum so the wallet can attach
    // exactly what the token contract requires (it grows over time).
    const extra: Record<string, unknown> =
      v.asset === "USDC" ? { usdcRegistration: (await usdcStorageMin()).toString() } : {};
    return NextResponse.json({ ...v, ...extra });
  } catch (e) {
    if (e instanceof VaultNotReadyError) {
      return NextResponse.json(
        { error: "The employer has not finished setting up their NEAR vault yet. Nothing is lost: wait a few minutes and try again." },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const inv = getInvoiceBySlug(slug);
  if (!inv) return NextResponse.json({ error: "invoice not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const signedTxBase64 = String(body.signedTxBase64 ?? "").trim();
  const payerAccount = String(body.payerAccount ?? "").trim();
  // Account id: a NEAR account (alice.testnet), an implicit 64 hex account,
  // or a base58 encoded implicit account. Empty is only allowed with a manual
  // hash claim, and the server then asks for it explicitly.
  if (
    payerAccount !== "" &&
    !/^[a-z0-9._-]{2,64}(\.testnet|\.near)$/i.test(payerAccount) &&
    !/^[0-9a-f]{64}$/i.test(payerAccount) &&
    !/^[1-9A-HJ-NP-Za-km-z]{32,55}$/.test(payerAccount)
  ) {
    return NextResponse.json({ error: "your wallet account id is required" }, { status: 400 });
  }
  // We accept either the full signed tx (preferred: the hash is derived on the
  // server so it can not be fabricated) or a tx hash from a manual send, in
  // hex, base58 (explorer) or base64 form.
  const txHashRaw = String(body.txHash ?? "").trim();
  if (!signedTxBase64 && !normalizeTxHash(txHashRaw)) {
    return NextResponse.json({ error: "a transaction hash is required" }, { status: 400 });
  }
  try {
    // Touch payDetails so a broken vault surfaces a friendly 503 up front.
    if (inv.status === "open" || inv.status === "refunded") payDetails(inv);
    const res = await verifyPayment(slug, signedTxBase64, payerAccount, txHashRaw);
    return NextResponse.json({
      invoice: publicView(res.invoice, true),
      confirmed: res.confirmed,
      detail: res.detail,
    });
  } catch (e) {
    if (e instanceof VaultNotReadyError) {
      return NextResponse.json(
        { error: "The employer has not finished setting up their NEAR vault yet. Nothing is lost: wait a few minutes and try again." },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
