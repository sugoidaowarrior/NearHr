import { NextRequest, NextResponse } from "next/server";
import { resolveSession, COOKIE } from "@/lib/sessions";
import { createInvoice, listInvoices } from "@/lib/invoices";
import { recordInvoiceOnChain, retryPendingOnChain } from "@/lib/contract";

// GET  /api/invoices -> the employer's invoices (newest first)
// POST /api/invoices -> create an invoice (asset: "USDC" | "NEAR"), returns it with its public link
export async function GET(req: NextRequest) {
  const userId = resolveSession(req.cookies.get(COOKIE)?.value);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // Self heal: any invoice whose on chain write is still pending (a best
  // effort write that could not reach the chain, for example because the RPC
  // was down) gets another attempt in the background. Never blocks the
  // response; the healed state shows on the next refresh.
  void retryPendingOnChain(userId).catch(() => null);
  return NextResponse.json({ invoices: listInvoices(userId) });
}

export async function POST(req: NextRequest) {
  const userId = resolveSession(req.cookies.get(COOKIE)?.value);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  try {
    const inv = createInvoice(userId, {
      client_name: body.client_name ?? body.clientName ?? "",
      client_email: body.client_email ?? body.clientEmail ?? null,
      note: body.note ?? null,
      amount: String(body.amount ?? ""),
      due_date: body.due_date ?? body.dueDate ?? "",
      asset: body.asset === "NEAR" ? "NEAR" : "USDC",
      items: ((): { description: string; amount: string }[] | undefined => {
        const raw: any[] = Array.isArray(body.items) ? body.items.slice(0, 20) : [];
        const cleaned = raw
          .map((it) => ({ description: String(it?.description ?? ""), amount: String(it?.amount ?? "") }))
          .filter((it) => it.description && it.amount);
        return cleaned.length ? cleaned : undefined;
      })(),
    });
    // Record the invoice on the on chain registry. Best effort and never
    // blocks the response: a failure (no contract configured, vault not
    // ready, or the RPC chain flaking) leaves the invoice in the app, and
    // the next transition retries the write (the contract is idempotent).
    void recordInvoiceOnChain(inv, "create").catch(() => null);
    return NextResponse.json({ invoice: inv, payUrl: `/i/${inv.slug}` }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
