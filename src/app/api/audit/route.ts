import { createHash, randomBytes } from "node:crypto";
import { verifyMessage } from "ethers";
import { NextRequest, NextResponse } from "next/server";
import { resolveSession, COOKIE } from "@/lib/sessions";
import { getDb } from "@/lib/db";

// ============================================================================
// DATA POLICY: THIS ROUTE IS STATELESS BY DESIGN.
//   * No database, no files, no disk writes, no background jobs.
//   * The document text lives ONLY in the `text` variable of this request,
//     in RAM. When the response is sent, the request scope is dropped and
//     the text is gone.
//   * We never log the document. Only metadata (model, chat id, hashes).
// The same promise is repeated in the README and in the UI footer.
//
// AUTH: employer role only (same guard as /api/swap and /api/payroll).
// ============================================================================

// (NearHr runs with nextConfig.cacheComponents, so no route segment config
// exports like `runtime` or `maxDuration` are allowed here. Route handlers
// default to the nodejs runtime under cacheComponents anyway.)

const BASE = "https://cloud-api.near.ai/v1";
const NRAS = "https://nras.attestation.nvidia.com/v3/attest/gpu";
const TEE_MODELS = new Set([
  "deepseek-ai/DeepSeek-V4.1-Flash-1017",
  "deepseek/deepseek-v3.2",
  "qwen/qwen3.5-397b-a17b",
]);
const NEAR_DEFAULT = "deepseek-ai/DeepSeek-V4.1-Flash-1017";

// DEMO MODE (temporary, for local development before NEAR credits are added):
// if FORTYTWO_API_KEY is set, the completion is served by the external
// provider at FORTYTWO_BASE_URL and the proof panel is clearly marked
// "not verified". Remove the env var to return to the real NEAR flow.
const DEMO_KEY = process.env.FORTYTWO_API_KEY;
const DEMO_BASE = process.env.FORTYTWO_BASE_URL || "https://api.fortytwo.network/v1";
const DEMO_MODEL = process.env.FORTYTWO_MODEL || "qwen/qwen3.8-27b";
const DEMO_PROVIDER = "Fortytwo";

const sha256hex = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const jwtPayload = (t: string) =>
  JSON.parse(Buffer.from(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));

function requireEmployer(req: NextRequest): NextResponse | null {
  const userId = resolveSession(req.cookies.get(COOKIE)?.value);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const role = (getDb().prepare("SELECT role FROM users WHERE id = ?").get(userId) as
    | { role: string }
    | undefined)?.role;
  if (role !== "employer") return NextResponse.json({ error: "employer role required" }, { status: 403 });
  return null;
}

const SYSTEM_PROMPT_TEE = `You are a private expense auditor running inside a confidential computing enclave.
Analyze the document the user provides (a bank statement and/or receipts) and return ONLY a JSON object, no markdown fences, with exactly this shape:
{
  "items": [
    {
      "desc": "short description of the charge",
      "date": "YYYY-MM-DD or empty string",
      "amount": 12.34,
      "category": one of: "Income", "Rent", "Food & Groceries", "Transport", "Utilities", "Health", "Entertainment", "Shopping", "Travel", "Subscriptions", "Fees", "Other",
      "flag": null or one of: "large_amount", "duplicate", "unusual_time", "unfamiliar_merchant", "high_frequency"
    }
  ],
  "totals": { "income": number, "spend": number },
  "anomalies": ["one plain sentence per flagged item, explaining why it looks unusual"],
  "summary": "2 to 3 plain sentences about the overall spending pattern"
}
Rules: use negative amounts for money out, positive for money in. Flag a charge as large_amount when it is at least 5x the median of that month, or at least 300 in value. Flag duplicate when the same merchant and amount appear more than once. Flag unusual_time for charges dated late night (00:00 to 05:00) or on a weekend at a venue type that usually closes early. Flag unfamiliar_merchant when the merchant name is not a recognizable brand and the charge is over 100. Flag high_frequency when the same merchant appears 5 or more times in the period. Do not invent charges that are not in the document.`;

const SYSTEM_PROMPT_DEMO = SYSTEM_PROMPT_TEE.replace(
  "You are a private expense auditor running inside a confidential computing enclave.",
  "You are a private expense auditor."
);

async function fetchJson(url: string, init?: RequestInit) {
  const r = await fetch(url, init);
  const text = await r.text();
  return { ok: r.ok, status: r.status, text, json: () => JSON.parse(text) };
}

export async function GET(req: NextRequest) {
  const denied = requireEmployer(req);
  if (denied) return denied;
  const key = process.env.NEAR_AI_CLOUD_API_KEY;
  const r = await fetchJson(`${BASE}/models`, key ? { headers: { Authorization: `Bearer ${key}` } } : undefined);
  let models: string[] = [...TEE_MODELS];
  if (r.ok) {
    const all = r.json().data ?? [];
    const listed = all.filter((m: any) => TEE_MODELS.has(m.id)).map((m: any) => m.id);
    if (listed.length) models = listed;
  }
  return NextResponse.json({
    models,
    demo: Boolean(DEMO_KEY),
    demoModel: DEMO_KEY ? DEMO_MODEL : null,
    demoProvider: DEMO_KEY ? DEMO_PROVIDER : null,
  });
}

export async function POST(req: NextRequest) {
  const denied = requireEmployer(req);
  if (denied) return denied;
  const key = process.env.NEAR_AI_CLOUD_API_KEY;
  const demo = Boolean(DEMO_KEY);
  if (!key && !demo) {
    return NextResponse.json(
      { error: "NEAR_AI_CLOUD_API_KEY is not set. Copy .env.example to .env.local, add your key from https://cloud.near.ai/dashboard, then restart the server." },
      { status: 503 }
    );
  }
  const body = await req.json().catch(() => ({}));
  const text: string = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return NextResponse.json({ error: "No document text provided." }, { status: 400 });
  const nearModel: string = TEE_MODELS.has(body.model) ? body.model : NEAR_DEFAULT;
  const nearAuth = { accept: "application/json" as const, ...(key ? { Authorization: `Bearer ${key}` } : {}) };
  const checks: { name: string; pass: boolean | null; detail?: string }[] = [];
  const check = (name: string, pass: boolean | null, detail?: string) => {
    checks.push({ name, pass, detail });
  };

  // ---- step 1: attestation report with a fresh random nonce ----------------
  // In demo mode this still runs live against NEAR AI Cloud (the attestation
  // endpoint needs no key) so the pipeline is demonstrated end to end. It
  // proves the TEE fleet is healthy; it does NOT cover the demo completion.
  const nonce = randomBytes(32).toString("hex");
  const attRes = await fetchJson(
    `${BASE}/attestation/report?model=${encodeURIComponent(nearModel)}&signing_algo=ecdsa&nonce=${nonce}`,
    { headers: nearAuth }
  );
  if (!attRes.ok) {
    return NextResponse.json({ error: `Attestation request failed: ${attRes.status}`, checks }, { status: 502 });
  }
  const att = attRes.json();
  const modelAtts: any[] = att.model_attestations ?? [];
  const modelAddrs = [...new Set(modelAtts.map((a) => a.signing_address).filter(Boolean))];
  const gatewayAddr: string | null = att.gateway_attestation?.signing_address ?? null;
  check("Attestation returned the model TEE node(s)", modelAtts.length > 0, `${modelAtts.length} node(s)`);
  check("TEE node echoed our fresh random nonce", modelAtts.length > 0 && modelAtts.every((a) => a.request_nonce === nonce));
  if (modelAtts[0]?.intel_quote) check("Intel TDX quote present in report", true, `${String(modelAtts[0].intel_quote).length} bytes`);

  // ---- step 2: NVIDIA NRAS GPU attestation ---------------------------------
  const gpuAtts = modelAtts.filter((a) => a.nvidia_payload);
  let gpuOk = true;
  const gpuSummary: string[] = [];
  for (const m of gpuAtts) {
    const r = await fetch(NRAS, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: typeof m.nvidia_payload === "string" ? m.nvidia_payload : JSON.stringify(m.nvidia_payload),
    });
    if (!r.ok) {
      gpuOk = false;
      check("NVIDIA NRAS attestation", false, `HTTP ${r.status}`);
      continue;
    }
    const nra = (await r.json()) as any;
    const decoded: Record<string, any> = {};
    for (const item of Array.isArray(nra) ? nra : []) {
      if (Array.isArray(item) && item.length === 2) decoded[item[0]] = jwtPayload(item[1]);
      else if (item && typeof item === "object") for (const [k, v] of Object.entries(item)) decoded[k] = jwtPayload(String(v));
    }
    const overall = decoded.JWT ?? {};
    check("NVIDIA overall attestation result is true", overall["x-nvidia-overall-att-result"] === true);
    check("NVIDIA ate exactly our request nonce", String(overall.eat_nonce ?? "").toLowerCase() === nonce);
    for (const [k, g] of Object.entries(decoded) as [string, any][]) {
      if (!k.startsWith("GPU-")) continue;
      const pass = g.secboot === true && g.dbgstat === "disabled" && g["x-nvidia-gpu-attestation-report-nonce-match"] === true;
      gpuOk = gpuOk && pass;
      check(`GPU ${k.replace("GPU-", "")}: secure boot on, debug disabled, nonce match`, pass, `${String(g.hwmodel ?? "GPU")} driver ${String(g["x-nvidia-gpu-driver-version"] ?? "?")}`);
    }
    gpuSummary.push(`verified via NVIDIA NRAS, driver ${String(overall["x-nvidia-gpu-driver-version"] ?? "unknown")}`);
  }
  if (gpuAtts.length === 0) check("No GPU evidence in report (CPU only enclave)", true, "GPU checks skipped");

  // ---- step 3: the completion ----------------------------------------------
  // Demo mode note: qwen3.8 on FortyTwo is a reasoning model. It takes around
  // two minutes per audit, and unless thinking is turned off it burns its
  // token budget on internal reasoning and returns a truncated `content`. The
  // documented switch is a trailing `/no_think` token in the user message,
  // which makes it emit the JSON directly. Its answer may still arrive in the
  // `reasoning` field when `content` is null, so we read both (handled below).
  const demoNoThink = demo ? " /no_think" : "";
  const reqBody = JSON.stringify({
    model: demo ? DEMO_MODEL : nearModel,
    stream: false,
    temperature: 0,
    ...(demo ? { max_tokens: 8000 } : {}),
    messages: [
      { role: "system", content: demo ? SYSTEM_PROMPT_DEMO : SYSTEM_PROMPT_TEE },
      { role: "user", content: `Audit this spending document.${demoNoThink}\n\n${text}` },
    ],
  });
  const cRes = await fetchJson(demo ? `${DEMO_BASE}/chat/completions` : `${BASE}/chat/completions`, {
    method: "POST",
    headers: {
      ...(demo ? { Authorization: `Bearer ${DEMO_KEY}` } : nearAuth),
      "content-type": "application/json",
    },
    body: reqBody,
  });
  const cText = cRes.text; // raw bytes retained for hash comparison
  if (!cRes.ok) {
    return NextResponse.json({ error: `Model call failed: ${cRes.status} ${cText.slice(0, 300)}`, checks }, { status: 502 });
  }
  const cJson = JSON.parse(cText);
  const chatId: string = cJson.id;
  const choiceMsg: any = cJson.choices?.[0]?.message ?? {};
  // Reasoning models may put the answer in `reasoning` while `content` is null.
  const rawReply: string =
    typeof choiceMsg.content === "string" && choiceMsg.content.trim()
      ? choiceMsg.content
      : typeof choiceMsg.reasoning === "string" && choiceMsg.reasoning.trim()
        ? choiceMsg.reasoning
        : "";
  const reqHash = sha256hex(reqBody);
  const respHash = sha256hex(cText);
  check(
    demo ? "Completion fetched (external provider, demo mode)" : "Completion fetched (non streaming, so the TEE signs)",
    true,
    chatId
  );

  // ---- step 4: signature, hashes, recovered signer -------------------------
  let sig: any = null;
  let signatureVerified = false;
  let recovered: string | null = null;
  let sigKind: string | null = null;
  if (demo) {
    check("Response signature fetched", null, "skipped in demo mode (external provider does not sign)");
    check("Signed hashes match our request and response bytes", null, "skipped in demo mode");
    check("Recovered signer matches the attested TEE address", null, "skipped in demo mode");
  } else {
    for (let attempt = 0; attempt < 6 && !sig; attempt++) {
      const sRes = await fetchJson(
        `${BASE}/signature/${chatId}?model=${encodeURIComponent(nearModel)}&signing_algo=ecdsa`,
        { headers: nearAuth }
      );
      if (sRes.ok) {
        const j = sRes.json();
        if (!j.error_code && j.signature) sig = j;
      }
      if (!sig) await new Promise((r) => setTimeout(r, 700));
    }
    if (!sig) {
      check("Fetched response signature", false, "404 after retries");
    } else {
      check("Fetched response signature", true);
      sigKind = sig.signature_kind ?? (sig.text.split(":").length === 3 ? "provider_tee" : "gateway");
      const parts = sig.text.split(":");
      const hasModel = parts.length === 3;
      const expected = sigKind === "gateway" ? [gatewayAddr].filter(Boolean) : modelAddrs;
      check("Signed request hash matches our exact request bytes", parts[hasModel ? 1 : 0] === reqHash);
      check("Signed response hash matches the exact response bytes", parts[hasModel ? 2 : 1] === respHash);
      if (sigKind === "provider_tee") check("Signed model id matches the requested TEE model", parts[0] === nearModel, parts[0]);
      try {
        recovered = verifyMessage(sig.text, sig.signature);
        check(
          `Recovered signer is the attested ${sigKind === "gateway" ? "gateway" : "model TEE"} address`,
          expected.some((a) => a.toLowerCase() === recovered!.toLowerCase()),
          recovered
        );
        signatureVerified = expected.some((a) => a.toLowerCase() === recovered!.toLowerCase());
      } catch (e: any) {
        check("Signature verifies", false, e.message);
      }
    }
  }

  // ---- parse the model report (best effort; UI degrades gracefully) --------
  let report: any = null;
  const parseReport = (s: string) => {
    const cleaned = s.replace(/```json\s*|\s*```/g, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      // Truncated JSON (reasoning models can hit a token cap). Recover the
      // items array if it is present and the trailing totals are missing.
      const itemMatch = cleaned.match(/"items"\s*:\s*\[([\s\S]*?)\]/);
      if (!itemMatch) return null;
      try {
        const items = JSON.parse(`[${itemMatch[1]}]`);
        return { items, totals: {}, anomalies: [], summary: "(report was truncated by the model)" };
      } catch {
        return null;
      }
    }
  };
  report = parseReport(rawReply);

  const active = checks.filter((c) => c.pass !== null);
  const allPass = active.every((c) => c.pass) && gpuOk;

  // This object is the entire state of the audit. It is returned to the
  // browser and then dropped. Nothing from it is written anywhere.
  return NextResponse.json({
    demo,
    demoProvider: demo ? DEMO_PROVIDER : null,
    demoModel: demo ? DEMO_MODEL : null,
    verified: !demo && signatureVerified && allPass,
    allPass,
    signatureVerified,
    model: demo ? `${DEMO_MODEL} (external, demo)` : nearModel,
    attestedModel: nearModel,
    nonce,
    chatId,
    checks,
    attestation: {
      modelAddress: modelAddrs[0] ?? null,
      gatewayAddress: gatewayAddr,
      nodeCount: modelAtts.length,
      intelQuotePresent: Boolean(modelAtts[0]?.intel_quote),
      gpuSummary,
    },
    signature: { kind: sigKind, recovered },
    requestHash: reqHash,
    responseHash: respHash,
    report,
    rawReply: report ? null : rawReply.slice(0, 4000),
  });
}
