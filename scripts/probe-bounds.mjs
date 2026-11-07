
import { JsonRpcProvider } from "near-api-js";
const conn = new JsonRpcProvider({ url: "https://rpc.testnet.near.org" });
const C = "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af";
const view = async (method, args) => {
  const r = await conn.query({ request_type: "call_function", account_id: C, method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"), finality: "optimistic" });
  if (r.error) return "RPC_ERR " + JSON.stringify(r.error).slice(0,140);
  if (r.result && Array.isArray(r.result)) return Buffer.from(r.result).toString("utf8");
  return JSON.stringify(r).slice(0, 200);
};
console.log("storage_balance_bounds:", await view("storage_balance_bounds", {}));
