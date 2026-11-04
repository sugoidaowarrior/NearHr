import { NextRequest, NextResponse } from "next/server";
import { resolveSession, COOKIE } from "@/lib/sessions";
import { getDb } from "@/lib/db";
import { ensureVault, unlockVault } from "@/lib/vault";
import { quoteSwap, executeSwap, type SwapAsset } from "@/lib/swap";
import {
  nearIntentsEnabled,
  quoteViaIntents,
  executeViaIntents,
} from "@/lib/nearIntents";

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

// GET /api/swap?from=NEAR&to=USDC&amount=1&slippage=0.5
// -> live quote. `base` is always the on-chain Ref Finance number (the guaranteed
// execution path). `intents` (optional) is the Near Intents 1Click quote when a
// partner key is configured, so the UI can show both engines.
export async function GET(req: NextRequest) {
  const { error } = requireEmployer(req);
  if (error) return error;
  const q = req.nextUrl.searchParams;
  const from = parseAsset(q.get("from"));
  const to = parseAsset(q.get("to"));
  const amount = q.get("amount") ?? "";
  const slippage = Number(q.get("slippage") ?? "0.5");
  if (!amount) return NextResponse.json({ error: "amount is required" }, { status: 400 });
  if (from === to) return NextResponse.json({ error: "pick two different assets to swap" }, { status: 400 });
  try {
    const base = await quoteSwap(from, to, amount, slippage);
    let intents: typeof base | null = null;
    if (nearIntentsEnabled()) {
      intents = await quoteViaIntents(from, to, amount, slippage);
    }
    return NextResponse.json({
      ...base,
      engine: "ref-finance",
      intentsEnabled: nearIntentsEnabled(),
      intents,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

// POST /api/swap  { from, to, amount, slippage?, engine?, walletSignature? }
// engine "intents" routes through Near Intents 1Click when a key is set; on any
// failure (or when the key is absent) it falls back to the on-chain engine so
// the swap always has a working path.
export async function POST(req: NextRequest) {
  const auth = requireEmployer(req);
  if (auth.error) return auth.error;
  const { userId } = auth;

  const body = (await req.json().catch(() => null)) as {
    from?: string;
    to?: string;
    amount?: string;
    slippage?: number;
    engine?: string;
    walletSignature?: string;
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

  // Opt in Near Intents path (only attempted when the caller explicitly asks
  // and a partner key is configured).
  if (body.engine === "intents" && nearIntentsEnabled() && body.walletSignature) {
    try {
      const viaIntents = await executeViaIntents(
        { employerId: userId, from, to, amount: String(body.amount), slippage: body.slippage },
        body.walletSignature
      );
      if (viaIntents) return NextResponse.json({ ...viaIntents, engine: "near-intents" }, { status: 201 });
    } catch {
      /* fall through to the on-chain engine */
    }
  }

  try {
    const res = await executeSwap(
      { employerId: userId, from, to, amount: String(body.amount), slippage: body.slippage },
      { nearAccount: vault.nearAccount, nearMasterKey: vault.nearMasterKey }
    );
    return NextResponse.json({ ...res, engine: "ref-finance" }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
