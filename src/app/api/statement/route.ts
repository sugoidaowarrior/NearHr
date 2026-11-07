import { NextRequest } from "next/server";
import PDFDocument from "pdfkit";
import { readFileSync } from "node:fs";
import path from "node:path";
import { resolveSession, COOKIE } from "@/lib/sessions";
import { getDb } from "@/lib/db";
import { statementData } from "@/lib/invoice-payments";

// GET /api/statement?from=YYYY-MM&to=YYYY-MM -> the payroll statement as a PDF
// download: everything the employer sent out (payroll runs, manual sends) and
// everything received (paid invoices), grouped by month, with the totals.
export const instant = false; // pdfkit is a blocking generation

function money(n: number | string | null | undefined): string {
  const v = n == null ? NaN : Number(n);
  if (!Number.isFinite(v)) return "0.00";
  return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function shortHash(h: string | null): string {
  if (!h) return "";
  return h.slice(0, 8) + "…" + h.slice(-6);
}

function ymLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const names = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${names[(m || 1) - 1] ?? m} ${y}`;
}

export async function GET(req: NextRequest) {
  const userId = resolveSession(req.cookies.get(COOKIE)?.value);
  if (!userId) return new Response("unauthorized", { status: 401 });

  // Default window: last 6 months including the current one.
  const now = new Date();
  const defTo = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const back = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const defFrom = `${back.getFullYear()}-${String(back.getMonth() + 1).padStart(2, "0")}`;
  const from = /^[0-9]{4}-[0-9]{2}$/.test(req.nextUrl.searchParams.get("from") ?? "") ? req.nextUrl.searchParams.get("from")! : defFrom;
  const to = /^[0-9]{4}-[0-9]{2}$/.test(req.nextUrl.searchParams.get("to") ?? "") ? req.nextUrl.searchParams.get("to")! : defTo;
  if (from > to) return new Response("from must be before to", { status: 400 });

  const user = getDb().prepare("SELECT name, email FROM users WHERE id = ?").get(userId) as { name: string | null; email: string } | undefined;
  if (!user) return new Response("not found", { status: 404 });
  const { paid, out, runs } = statementData(userId, from, to);

  const totalIn = paid.reduce((s, r) => s + Number(r.amount || 0), 0);
  const totalOut = out.reduce((s, r) => s + Number(r.amount || 0), 0);

  const doc = new PDFDocument({ size: "A4", margin: 48, bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on("data", (c) => chunks.push(c));

  // palette
  const INK = "#15181d";
  const BAND = "#101318";
  const MUTED = "#6b7280";
  const FAINT = "#9aa0ab";
  const RULE = "#e3e6ec";
  const ACCENT = "#3f6cf6";
  const GREEN = "#15803d";
  const RED = "#b91c1c";
  const ZEBRA = "#f7f8fa";

  const L = 48;
  const R = doc.page.width - 48;
  const W = R - L;
  const PAGE_BOTTOM = 800;

  const text = (
    t: string,
    x: number,
    y: number,
    o: { size?: number; font?: string; color?: string; align?: "left" | "right" | "center"; width?: number; spacing?: number; wrap?: boolean } = {}
  ) => {
    doc
      .font(o.font ?? "Helvetica")
      .fontSize(o.size ?? 9)
      .fillColor(o.color ?? INK)
      .text(t, x, y, {
        width: o.width ?? 300,
        align: o.align ?? "left",
        lineBreak: o.wrap ?? false,
        characterSpacing: o.spacing,
      });
    return doc;
  };
  const rect = (x: number, y: number, w: number, h: number, fill: string) => doc.rect(x, y, w, h).fill(fill);
  const roundedRect = (x: number, y: number, w: number, h: number, r: number, fill: string) =>
    doc.roundedRect(x, y, w, h, r).fill(fill);
  const rule = (y: number, color = RULE, width = 0.8) => {
    doc.moveTo(L, y).lineTo(R, y).strokeColor(color).lineWidth(width).stroke();
  };
  const ensure = (h: number) => {
    if (doc.y + h > PAGE_BOTTOM) doc.addPage();
  };

  // ---------- masthead: the NearHR logo lockup ----------
  const logoBuf = readFileSync(path.join(process.cwd(), "public", "img", "nearhr-logo-banner.png"));
  const [lw, lh] = [logoBuf.readUInt32BE(16), logoBuf.readUInt32BE(20)];
  const BAND_H = Math.round((doc.page.width * lh) / lw); // full bleed logo banner
  rect(0, 0, doc.page.width, BAND_H, BAND);
  doc.image(logoBuf, 0, 0, { width: doc.page.width });

  const nameLine = user.name || user.email;
  const INFO_Y = BAND_H + 28;
  text(nameLine, L, INFO_Y, { size: 12, font: "Helvetica-Bold", width: 300 });
  if (user.name) text(user.email, L, INFO_Y + 16, { size: 9, color: MUTED, width: 300 });
  text("PAYROLL STATEMENT", R - 200, INFO_Y - 1, { size: 8, font: "Helvetica-Bold", color: FAINT, width: 200, align: "right", spacing: 1.6 });
  text(`${ymLabel(from)} to ${ymLabel(to)}`, R - 200, INFO_Y + 12, { size: 10.5, font: "Helvetica-Bold", width: 200, align: "right" });
  text(`Generated ${new Date().toISOString().slice(0, 10)}`, R - 200, INFO_Y + 25, { size: 8.5, color: MUTED, width: 200, align: "right" });
  rule(INFO_Y + 42);

  // ---------- summary cards ----------
  const net = totalIn - totalOut;
  const cardW = (W - 24) / 3;
  const CARD_Y = INFO_Y + 58;
  const cards: { label: string; value: string; tint: string; bar: string; valueColor: string }[] = [
    { label: "INVOICES PAID", value: `$${money(totalIn)}`, tint: "#eef7f1", bar: GREEN, valueColor: GREEN },
    { label: "PAYROLL AND SENDS", value: `$${money(totalOut)}`, tint: "#fdf2f2", bar: RED, valueColor: RED },
    { label: "NET FOR THE WINDOW", value: net < 0 ? `$${money(Math.abs(net))}` : `+$${money(net)}`, tint: "#f0f4ff", bar: ACCENT, valueColor: net < 0 ? RED : ACCENT },
  ];
  cards.forEach((c, i) => {
    const x = L + i * (cardW + 12);
    roundedRect(x, CARD_Y, cardW, 62, 9, c.tint);
    roundedRect(x + 1, CARD_Y + 1, 3.5, 60, 1.75, c.bar);
    text(c.label, x + 14, CARD_Y + 12, { size: 7, font: "Helvetica-Bold", color: MUTED, width: cardW - 26, spacing: 0.4, wrap: true });
    text(c.value, x + 8, CARD_Y + 46, { size: 15, font: "Helvetica-Bold", color: c.valueColor, width: cardW - 16, align: "right" });
  });
  doc.y = CARD_Y + 62 + 26;

  // ---------- section + table machinery ----------
  const sectionTitle = (t: string) => {
    ensure(70);
    const y = doc.y;
    rect(L, y + 1, 3, 12, ACCENT);
    text(t.toUpperCase(), L + 12, y, { size: 10.5, font: "Helvetica-Bold", width: W - 12, spacing: 0.6 });
    doc.y = y + 30;
  };

  const ROW = 30;
  const COLS: { x: number; w: number; label: string; align?: "right" }[] = [
    { x: L + 10, w: 48, label: "DATE" },
    { x: 116, w: 118, label: "PARTY" },
    { x: 248, w: 146, label: "NOTE" },
    { x: 398, w: 44, label: "ASSET", align: "right" },
    { x: 456, w: R - 456, label: "AMOUNT", align: "right" },
  ];
  const headRow = () => {
    const hy = doc.y;
    COLS.forEach((c) => text(c.label, c.x, hy + 4, { size: 7.5, font: "Helvetica-Bold", color: FAINT, width: c.w, align: c.align ?? "left", spacing: 0.5 }));
    doc.y = hy + 16;
    rule(doc.y);
    doc.y += 5;
  };

  const table = (rows: { date: string; who: string; note: string; asset: string; amount: number; tx: string | null }[], sign: 1 | -1) => {
    if (rows.length === 0) {
      ensure(34);
      const y = doc.y;
      text("Nothing recorded in this window.", L + 2, y, { size: 9, font: "Helvetica-Oblique", color: MUTED, width: W });
      doc.y = y + 24;
      return;
    }
    let headDone = false;
    rows.forEach((r, i) => {
      const pageBefore = doc.page;
      ensure(ROW + 10);
      if (!headDone || doc.page !== pageBefore) {
        headRow();
        headDone = true;
      }
      const yTop = doc.y;
      if (i % 2 === 1) rect(L, yTop, W, ROW, ZEBRA);
      const base = r.tx ? yTop + 15 : yTop + 18;
      text(r.date, COLS[0].x, base, { size: 8, color: MUTED, width: COLS[0].w });
      text(r.who, COLS[1].x, base, { size: 9, font: "Helvetica-Bold", width: COLS[1].w });
      text(r.note, COLS[2].x, base, { size: 8.5, font: "Helvetica-Oblique", color: MUTED, width: COLS[2].w });
      text(r.asset, COLS[3].x, base, { size: 8.5, color: MUTED, width: COLS[3].w, align: "right" });
      text(`${sign > 0 ? "+" : ""}$${money(r.amount)}`, COLS[4].x, base, { size: 9.5, font: "Helvetica-Bold", color: sign > 0 ? GREEN : INK, width: COLS[4].w, align: "right" });
      if (r.tx) text(`tx ${shortHash(r.tx)}`, COLS[1].x, yTop + 26, { size: 6.8, font: "Courier", color: FAINT, width: 200 });
      doc.y = yTop + ROW;
    });
    doc.y += 12;
  };

  sectionTitle(`Money in · invoices paid (${paid.length})`);
  table(
    paid.map((r) => ({
      date: (r.paid_at ?? "").slice(0, 10),
      who: r.recipient_name || "client",
      note: r.note ?? "invoice",
      asset: r.asset || "USDC",
      amount: Number(r.amount || 0),
      tx: r.tx_ref,
    })),
    1
  );

  sectionTitle(`Money out · payroll and sends (${out.length})`);
  table(
    out.map((r) => ({
      date: (r.paid_at ?? "").slice(0, 10),
      who: r.recipient_name || (r.kind === "payroll" ? "payroll run" : r.kind === "refund" ? "refund" : "send"),
      note: r.note ?? (r.kind === "payroll" ? "payroll" : r.kind === "refund" ? "refund" : "manual send"),
      asset: r.asset || "NEAR",
      amount: Number(r.amount || 0),
      tx: r.tx_ref,
    })),
    -1
  );

  sectionTitle(`Payroll runs in this window (${runs.length})`);
  if (runs.length === 0) {
    ensure(34);
    const y = doc.y;
    text("No payroll runs executed in this window.", L + 2, y, { size: 9, font: "Helvetica-Oblique", color: MUTED, width: W });
    doc.y = y + 24;
  } else {
    const RCOLS = [
      { x: L + 10, w: 210, label: "PAYROLL RUN" },
      { x: 280, w: 140, label: "TEAM" },
      { x: 451, w: R - 451, label: "TOTAL", align: "right" as const },
    ];
    let headDone = false;
    runs.forEach((r, i) => {
      const pageBefore = doc.page;
      ensure(ROW + 10);
      if (!headDone || doc.page !== pageBefore) {
        const hy = doc.y;
        RCOLS.forEach((c) => text(c.label, c.x, hy + 4, { size: 7.5, font: "Helvetica-Bold", color: FAINT, width: c.w, align: c.align ?? "left", spacing: 0.5 }));
        doc.y = hy + 16;
        rule(doc.y);
        doc.y += 5;
        headDone = true;
      }
      const yTop = doc.y;
      if (i % 2 === 1) rect(L, yTop, W, ROW, ZEBRA);
      const base = r.near_ref ? yTop + 15 : yTop + 18;
      const nearTotal = Number(r.total_yocto || 0) / 1e24;
      const totalStr = r.asset === "USDC" ? `$${money(r.total_yocto)}` : `${nearTotal.toLocaleString("en-US", { maximumFractionDigits: 4 })} ${r.asset || "NEAR"}`;
      text(r.name || "payroll", RCOLS[0].x, base, { size: 9, font: "Helvetica-Bold", width: RCOLS[0].w });
      text(`${r.employee_count} people · ${r.asset || "NEAR"}`, RCOLS[1].x, base, { size: 8.5, color: MUTED, width: RCOLS[1].w });
      text(totalStr, RCOLS[2].x, base, { size: 9.5, font: "Helvetica-Bold", width: RCOLS[2].w, align: "right" });
      if (r.near_ref) text(`executed ${(r.executed_at ?? "").slice(0, 10)} · tx ${shortHash(r.near_ref)}`, RCOLS[0].x, yTop + 26, { size: 6.8, font: "Courier", color: FAINT, width: 300 });
      doc.y = yTop + ROW;
    });
    doc.y += 12;
  }

  // ---------- footer on every page ----------
  const pages = doc.bufferedPageRange();
  for (let i = pages.start; i < pages.start + pages.count; i++) {
    doc.switchToPage(i);
    rule(812, "#e6e8ee", 0.8);
    text("NearHr · every figure is confirmed on NEAR", L, 822, { size: 7.5, color: FAINT, width: 300 });
    text(`page ${i + 1} of ${pages.count}`, R, 822, { size: 7.5, color: FAINT, width: 80, align: "right" });
  }

  // pdfkit emits page data asynchronously. Concatenating the chunks right
  // after doc.end() returns before any data event has fired and produces a
  // 0 byte file, so wait for the end event before reading the buffer.
  await new Promise<void>((resolve, reject) => {
    doc.on("end", () => resolve());
    doc.on("error", reject);
    doc.end();
  });
  const buf = Buffer.concat(chunks);
  return new Response(new Uint8Array(buf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="nearhr-payroll-statement-${from}-to-${to}.pdf"`,
      "content-length": String(buf.length),
    },
  });
}
