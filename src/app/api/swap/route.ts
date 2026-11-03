import { NextRequest, NextResponse } from "next/server";
import { resolveSession, COOKIE } from "@/lib/sessions";
import { getDb } from "@/lib/db";
import { ensureVault, unlockVault } from "@/lib/vault";
import { quoteSwap, executeSwap, type SwapAsset } from "@/lib/swap";

function parseAsset(v: unknown): SwapAsset {
  return v === "USDC" ? "USDC" : "NEAR";
}

function requireEmployer(req: NextRequest) {
  const userId = resolveSession(req.cookies.get(COOKIE)?.value);
  if (!userId) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) } as const;
  const role = (getDb().prepare("SELECT role FROM users WHERE id = ?").get(userId) as
    | { role: string }
    | undefined)?.role;
  if (role !== "employer")
    return { error: NextResponse.json({ error: "employer role required" }, { status: 403 }) } as const;
  return { userId } as const;
}

// GET /api/swap?from=NEAR&to=USDC&amount=1  -> live quote (no keys touched)
export async function GET(req: NextRequest) {
  const { error } = requireEmployer(req);
  if (error) return error;
  const q = req.nextUrl.searchParams;
  const from = parseAsset(q.get("from"));
  const to = parseAsset(q.get("to"));
  const amount = q.get("amount") ?? "";
  const slippage = Number(q.get("slippage") ?? "0.5");
  if (!amount) return NextResponse.json({ error: "amount is required" }, { status: 400 });
  try {
    const quote = await quoteSwap(from, to, amount, slippage);
    return NextResponse.json(quote);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

// POST /api/swap  { from, to, amount, slippage? } -> execute on mainnet
export async function POST(req: NextRequest) {
  const auth = requireEmployer(req);
  if (auth.error) return auth.error;
  const { userId } = auth;

  const body = (await req.json().catch(() => null)) as {
    from?: string;
    to?: string;
    amount?: string;
    slippage?: number;
  } | null;
  if (!body?.amount) return NextResponse.json({ error: "from, to and amount are required" }, { status: 400 });
  const from = parseAsset(body.from);
  const to = parseAsset(body.to);
  if (from === to) return NextResponse.json({ error: "from and to must differ" }, { status: 400 });

  let vault;
  try {
    ensureVault(userId);
    vault = unlockVault(userId);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }

  try {
    const res = await executeSwap(
      { employerId: userId, from, to, amount: String(body.amount), slippage: body.slippage },
      { nearAccount: vault.nearAccount, nearMasterKey: vault.nearMasterKey }
    );
    return NextResponse.json(res, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
