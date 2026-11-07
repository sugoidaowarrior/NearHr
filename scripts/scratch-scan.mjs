import { createHash } from "node:crypto";
import { Transaction, SignedTransaction } from "@near-js/transactions";

const RPC = "https://archival-rpc.testnet.fastnear.com";
const CONTRACT = "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af";
const VAULT = "26fb69d73d9124e7845f04d10f8245479a312fc0b48405d78bf49f964fbccc66";
const ARG = Buffer.from(JSON.stringify({ account_id: VAULT })).toString("base64");

let idc = 0;
async function rpc(method, params) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const res = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: String(++idc), method, params }),
    });
    const d = await res.json();
    if (d.error) {
      const msg = JSON.stringify(d.error);
      if (/429|Rate limits exceeded/i.test(msg) && attempt < 7) {
        await new Promise((r) => setTimeout(r, 2500 * (attempt + 1)));
        continue;
      }
      throw new Error(method + " " + msg.slice(0, 200));
    }
    return d.result;
  }
  throw new Error("rate limited too long on " + method);
}

async function balanceAtHeight(h) {
  const r = await rpc("query", {
    request_type: "call_function",
    account_id: CONTRACT,
    method_name: "ft_balance_of",
    args_base64: ARG,
    block_id: h,
  });
  const out = r.result;
  const text = Array.isArray(out) ? Buffer.from(out).toString("utf8") : out;
  return JSON.parse(text); // e.g. "3000000"
}

const head = await rpc("block", { finality: "final" });
const H = Number(head.header.height);
console.error("head height", H);

const cur = await balanceAtHeight(H);
console.error("current balance", cur);

// Find change points going backwards: the latest block where balance < cur,
// then repeat for the previous level. Payments were made within the last few
// hours, so a 60000 block window is plenty (testnet is ~1.5s blocks).
const changes = [];
let top = H;
let level = cur;
for (let step = 0; step < 6; step++) {
  let lo = top - 60000;
  let hi = top; // balance(hi) == level
  if (lo <= 0) break;
  if (Number(await balanceAtHeight(lo)) >= Number(level)) {
    // no change in the window: the whole balance is older than we can reach
    console.error(`no change within ${top - lo} blocks of ${top}`);
    break;
  }
  // balance(lo) < level <= balance(hi): first block in (lo, hi] with balance == level
  let a = lo, b = hi;
  while (b - a > 1) {
    const m = Math.floor((a + b) / 2);
    if (Number(await balanceAtHeight(m)) >= Number(level)) b = m;
    else a = m;
    if ((m * 1000) % 97 === 0) process.stdout.write(".");
  }
  changes.push({ firstAt: b, balanceFrom: level });
  top = b;
  level = await balanceAtHeight(b - 1);
  console.error(`change found: height ${b}, balance ${level} -> ${cur}`);
  if (level === "0") break;
}

console.error("change points:", JSON.stringify(changes));

// For each change point block, decode the transactions and keep the USDC ones.
const results = [];
for (const c of changes) {
  const b = await rpc("block", { block_id: c.firstAt });
  for (const st of b.transactions || []) {
    try {
      const txObj = Transaction.decode(Buffer.from(st.transaction, "base64"));
      if (!/oldhat96/i.test(txObj.signer_id)) continue;
      const hitsUsdc = (txObj.actions || []).some(
        (a) => a && a.FunctionCall && (a.FunctionCall.account_id || "") === CONTRACT
      );
      if (!hitsUsdc) continue;
      const sig = {
        type: 1,
        data: Buffer.from(st.signature.data, "base64"),
      };
      const signed = new SignedTransaction({ transaction: txObj, signature: sig });
      const hash = createHash("sha256").update(signed.encode()).digest("hex");
      const methods = (txObj.actions || [])
        .filter((a) => a && a.FunctionCall)
        .map((a) => a.FunctionCall.method_name)
        .join(",");
      const amounts = (txObj.actions || [])
        .filter((a) => a && a.FunctionCall && a.FunctionCall.method_name === "ft_transfer")
        .map((a) => Buffer.from(a.FunctionCall.args, "base64").toString("utf8"))
        .join(" ");
      results.push({ height: c.firstAt, hash, signer: txObj.signer_id, methods, amounts });
    } catch (e) {
      /* skip undecodable */
    }
  }
}

console.log(JSON.stringify(results, null, 2));
