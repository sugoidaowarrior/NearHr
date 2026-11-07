import { NextRequest, NextResponse } from "next/server";
import { getInvoiceBySlug, publicView, verifyPayment } from "@/lib/invoices";

// GET /api/invoices/slug/[slug]/status -> re check the chain (called by the
// payer page and the employer dashboard, no auth needed for a public link).
// When a tx was claimed, the server reads the chain again and confirms.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const inv = getInvoiceBySlug(slug);
  if (!inv) return NextResponse.json({ error: "invoice not found" }, { status: 404 });

  // Nothing claimed yet: just report current state.
  if (!inv.near_tx || inv.status === "paid" || inv.status === "void" || inv.status === "refunded") {
    return NextResponse.json(publicView(inv));
  }

  // A tx is on record but unconfirmed: re read the chain. No payer claim is
  // needed here: the tx hash is unforgeable and the credit check (exact amount
  // to the vault) is what matters.
  try {
    const res = await verifyPayment(slug, "", "");
    return NextResponse.json({ ...publicView(res.invoice), confirmed: res.confirmed, detail: res.detail });
  } catch {
    return NextResponse.json(publicView(inv));
  }
}
