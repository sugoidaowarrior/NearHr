
import { JsonRpcProvider } from "near-api-js";
const conn = new JsonRpcProvider({ url: "https://rpc.testnet.near.org" });
const C = "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af";
const V = {
  "p6tdes-vault(7a7dfb4a)": "7a7dfb4a68cf8e072ece6506a0ed8a87d7c36a5abef5c7cec8272a2602bb6e6e",
  "test-employer(3f0d9001)": "3f0d9001886ce3a8eaa8397a860c9b04adb0a7a8397acb24f2d3cc2c723b520b",
  "sugoi(26fb69d7)": "26fb69d73d9124e7845f04d10f8245479a312fc0b48405d78bf49f964fbccc66",
  "rose(9e60d8c6)": "9e60d8c6daf7d7500707478fbd077564ce46d7aff21041b461a5642a0e96572e",
};
const view = async (acc, method, args) => {
  const r = await conn.query({ request_type: "call_function", account_id: acc, method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"), finality: "optimistic" });
  return r.result ? Buffer.from(r.result).toString("utf8") : JSON.stringify(r);
};
for (const [label, a] of Object.entries(V)) {
  let near = "?";
  try { const r = await conn.query({ request_type: "view_account", account_id: a, finality: "optimistic" });
    near = ((r.result || {}).amount || "?") / 1e24 + " NEAR";
  } catch (e) { near = "NOT ON CHAIN"; }
  let reg = "?", bal = "?";
  try { reg = await view(C, "storage_balance_of", { account_id: a }); } catch (e) { reg = String(e).slice(0, 60); }
  try { bal = await view(C, "ft_balance_of", { account_id: a }); } catch (e) { bal = "ERR"; }
  console.log(label, "| NEAR:", near, "| USDC reg:", reg, "| USDC bal:", bal);
}
