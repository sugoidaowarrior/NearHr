import { createHash } from "node:crypto";
import { Transaction, SignedTransaction } from "@near-js/transactions";

const RPC = "https://archival-rpc.testnet.fastnear.com";
const CONTRACT = "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af";

let idc = 0;
async function rpc(method, params) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const res = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: String(++idc), method, params }),
    });
    const d = await res.json();
    if (d.error) {
      const msg = JSON.stringify(d.error);
      if (/429|Rate limits exceeded/i.test(msg) && attempt < 9) {
        await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
        continue;
      }
      throw new Error(method + " " + msg.slice(0, 160));
    }
    return d.result;
  }
  throw new Error("rate limited too long on " + method);
}

// Scan a small window of blocks around the balance change and decode every
// oldhat96 tx that touches the USDC contract.
const START = 276571380;
const END = 276571520;
const VAULT = "26fb69d73d9124e7845f04d10f8245479a312fc0b48405d78bf49f964fbccc66";
const found = [];
for (let h = START; h <= END; h++) {
  let b;
  try {
    b = await rpc("block", { block_id: h });
  } catch (e) {
    console.error(`block ${h}: ${e.message}`);
    continue;
  }
  // receipts executed in this block that touched the USDC contract
  for (const r of b.receipts_outcomes || []) {
    const o = r.outcome && r.outcome.receipt;
    if (!o || o.receiver_id !== CONTRACT) continue;
    for (const a of o.actions || []) {
      if (!a.FunctionCall || a.FunctionCall.method_name !== "ft_transfer") continue;
      let arg = "";
      try {
        arg = Buffer.from(a.FunctionCall.args, "base64").toString("utf8");
      } catch {
        continue;
      }
      if (!arg.includes(VAULT)) continue;
      found.push({
        kind: "receipt",
        height: h,
        receipt_id: r.id,
        predecessor: o.predecessor_id,
        args: arg.slice(0, 120),
      });
    }
  }
  for (const st of b.transactions || []) {
    let txObj;
    try {
      txObj = Transaction.decode(Buffer.from(st.transaction, "base64"));
    } catch {
      continue;
    }
    const toVault = (txObj.actions || []).some((a) => {
      if (!a || !a.FunctionCall || a.FunctionCall.method_name !== "ft_transfer") return false;
      try {
        return Buffer.from(a.FunctionCall.args, "base64").toString("utf8").includes(VAULT);
      } catch {
        return false;
      }
    });
    if (!toVault) continue;
    let hash = "";
    try {
      const sig = { type: 1, data: Buffer.from(st.signature.data, "base64") };
      const signed = new SignedTransaction({ transaction: txObj, signature: sig });
      hash = createHash("sha256").update(signed.encode()).digest("hex");
    } catch (e) {
      hash = "(encode failed: " + e.message + ")";
    }
    const fts = (txObj.actions || [])
      .filter((a) => a && a.FunctionCall && a.FunctionCall.method_name === "ft_transfer")
      .map((a) => {
        try {
          return Buffer.from(a.FunctionCall.args, "base64").toString("utf8");
        } catch {
          return "";
        }
      });
    found.push({
      kind: "tx",
      height: h,
      hash,
      signer: txObj.signer_id,
      methods: (txObj.actions || []).filter((a) => a && a.FunctionCall).map((a) => a.FunctionCall.method_name).join(","),
      transfers: fts,
    });
  }
  if (h % 20 === 0) console.error(`...${h}`);
}
console.log(JSON.stringify(found, null, 2));
