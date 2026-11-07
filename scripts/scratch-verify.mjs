const RPC = "https://test.rpc.fastnear.com";
const H = "6o1n2cwwAZCWHutqMgonTjQVRyQK2c16TGXU5kp5rXL9";
const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
let n = 0n;
for (const c of H) n = n * 58n + BigInt(A.indexOf(c));
const bytes = [];
while (n > 0n) { bytes.unshift(Number(n % 256n)); n /= 256n; }
const hex = bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
console.log("hex:", hex, "len", hex.length);

async function q(account_id) {
  const p = { request_type: "tx", tx_hash: hex, finality: "optimistic" };
  if (account_id) p.account_id = account_id;
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "1", method: "query", params: p }),
  });
  return (await res.json()).result;
}

const r = await q("oldhat96.testnet") ?? await q();
console.log("status:", r.final_execution_status);
const t = r.transaction;
console.log("signer:", t.signer_id, "receiver:", t.receiver_id);
for (const a of t.actions) {
  if (a.FunctionCall) {
    const args = Buffer.from(a.FunctionCall.args, "base64").toString("utf8");
    console.log("call:", a.FunctionCall.method_name, args);
  }
  if (a.Transfer) console.log("transfer:", a.Transfer.deposit);
}
