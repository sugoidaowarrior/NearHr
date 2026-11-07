import { NextRequest, NextResponse } from "next/server";
import { resolveSession, COOKIE } from "@/lib/sessions";
import { listInvoices, parseItems } from "@/lib/invoices";
import { explorerUrl, defaultNearConfig } from "@/lib/near";

// GET /api/invoices/csv -> one row per invoice, an accountant opens it with no questions.
export async function GET(req: NextRequest) {
  const userId = resolveSession(req.cookies.get(COOKIE)?.value);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const invoices = listInvoices(userId);
  const net = defaultNearConfig().networkId;

  const esc = (v: string | null | undefined) => {
    const s = v ?? "";
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const head = [
    "invoice_number",
    "client_name",
    "client_email",
    "invoice_date",
    "due_date",
    "narration",
    "line_items",
    "asset",
    "amount",
    "status",
    "amount_paid",
    "paid_time",
    "payer_wallet",
    "near_transaction",
    "explorer_link",
    "refund_transaction",
    "refund_time",
  ];

  const rows = invoices.map((inv) =>
    [
      inv.slug,
      inv.client_name,
      inv.client_email ?? "",
      inv.created_at.slice(0, 10),
      inv.due_date,
      inv.note ?? "",
      parseItems(inv.items_json).map((it) => `${it.description} ${it.amount}`).join(" | "),
      inv.asset,
      inv.amount,
      inv.status,
      inv.payer_amount ?? "",
      inv.settled_at ?? "",
      inv.payer_account ?? "",
      inv.near_tx ?? "",
      inv.near_tx ? explorerUrl(net, inv.near_tx) : "",
      inv.refund_tx ?? "",
      inv.refund_at ?? "",
    ]
      .map(esc)
      .join(",")
  );

  const csv = [head.map(esc).join(","), ...rows].join("\n") + "\n";
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="nearhr-invoices-${stamp}.csv"`,
    },
  });
}
