import { NextRequest, NextResponse } from "next/server";
import { resolveSession, COOKIE } from "@/lib/sessions";
import { getPrices, buildChartSeries, RANGES, Range } from "@/lib/portfolio";

// GET /api/portfolio/chart?range=day|week|month|year&total=<live USD>
// total is the live portfolio value (client already fetched it) so the chart
// anchors to reality without a second on chain round trip.
export async function GET(req: NextRequest) {
  const userId = resolveSession(req.cookies.get(COOKIE)?.value);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sp = req.nextUrl.searchParams;
  const rangeRaw = sp.get("range") ?? "month";
  const range: Range = (RANGES as string[]).includes(rangeRaw) ? (rangeRaw as Range) : "month";
  const total = Number(sp.get("total") ?? "0") || 0;
  const prices = await getPrices();
  return NextResponse.json({
    range,
    points: buildChartSeries(userId, range, total, prices.NEAR),
  });
}
