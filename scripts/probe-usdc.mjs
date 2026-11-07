// Probe: where does Circle faucet USDC live on NEAR testnet, and who is registered where.
import { JsonRpcProvider } from "near-api-js";

const RPC = "https://rpc.testnet.near.org";
const PAYER = "oldhat96.testnet";
const VAULT = "7a7dfb4a68cf8e072ece6506a0ed8a87d7c36a5abef5c7cec8272a2602bb6e6e";
const CONTRACTS = ["usdc.fakes.testnet", "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af"];

const conn = new JsonRpcProvider({ url: RPC });
const view = async (contract, method, args) => {
  try {
    const r = await conn.query({
      request_type: "call_function",
      account_id: contract,
      method_name: method,
      args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
      finality: "optimistic",
    });
    if (r.result && Array.isArray(r.result)) return Buffer.from(r.result).toString("utf8");
    if (r.result) return JSON.stringify(r.result);
    return r.logs ? r.logs[r.logs.length - 1] : String(r).slice(0, 120);
  } catch (e) {
    return `ERR ${String(e.message || e).split("\n")[0].slice(0, 140)}`;
  }
};

for (const c of CONTRACTS) {
  console.log(`\n=== ${c}`);
  const meta = await view(c, "ft_metadata", {});
  console.log("metadata:", meta);
  console.log("payer ft_balance_of:", await view(c, "ft_balance_of", { account_id: PAYER }));
  console.log("payer storage_balance_of:", await view(c, "storage_balance_of", { account_id: PAYER }));
  console.log("vault storage_balance_of:", await view(c, "storage_balance_of", { account_id: VAULT }));
  console.log("vault ft_balance_of:", await view(c, "ft_balance_of", { account_id: VAULT }));
}
console.log("\n=== payer account exists?");
try {
  const a = await conn.query({ request_type: "view_account", account_id: PAYER, finality: "optimistic" });
  const acc = a.result || a;
  console.log("payer:", acc.amount, "locked:", acc.locked);
} catch (e) {
  console.log("payer query:", String(e).slice(0, 120));
}
