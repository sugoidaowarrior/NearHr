import { NextRequest, NextResponse } from "next/server";
import { resolveSession, COOKIE } from "@/lib/sessions";
import { getInvoiceById, updateInvoice, refundInvoice } from "@/lib/invoices";

// GET  /api/invoices/[id] -> one invoice
// POST /api/invoices/[id] -> {action:"void"} cancel it
// POST /api/invoices/[id] -> {action:"refund"} return the money on chain, reopen it
// (payments re verify from the chain via /api/invoices/slug/[slug]/status)
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = resolveSession(req.cookies.get(COOKIE)?.value);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const inv = getInvoiceById(id, userId);
  if (!inv) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ invoice: inv });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = resolveSession(req.cookies.get(COOKIE)?.value);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  let body: any = {};
  try {
    body = await req.json().catch(() => ({}));
  } catch {
    /* empty body ok */
  }
  const inv = getInvoiceById(id, userId);
  if (!inv) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (body.action === "void") {
    if (inv.status === "paid") return NextResponse.json({ error: "a paid invoice cannot be voided" }, { status: 400 });
    updateInvoice(id, { status: "void" });
    return NextResponse.json({ invoice: getInvoiceById(id, userId) });
  }
  if (body.action === "refund") {
    try {
      const res = await refundInvoice(id, userId);
      return NextResponse.json(res);
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
    }
  }
  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
