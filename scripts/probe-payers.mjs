
import { JsonRpcProvider } from "near-api-js";
const conn = new JsonRpcProvider({ url: "https://rpc.testnet.near.org" });
const C = "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af";
const A = {
  "payer-2500f896(test-employer)": "2500f89639735ec20b3e23e7f9382ae0833469ca5c2c334fb55024c203fa67b8",
  "payer-f2d160c4(sugoi)": "f2d160c46531bfa2efcb660dedf5df6c9f597325cd93dba7743a15422fdbd322",
  "payer-ad0a0c45(celerxchange)": "ad0a0c45f40f180d8ce1444c794827e7f34a54ffa3f310f173be39bf4e0a22aa",
};
const view = async (acc, method, args) => {
  const r = await conn.query({ request_type: "call_function", account_id: acc, method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"), finality: "optimistic" });
  return r.result ? Buffer.from(r.result).toString("utf8") : "?";
};
for (const [label, a] of Object.entries(A)) {
  let near = "?";
  try { const r = await conn.query({ request_type: "view_account", account_id: a, finality: "optimistic" });
    near = ((r.result || {}).amount || "0") / 1e24 + " NEAR";
  } catch (e) { near = "NOT FUNDED"; }
  let usdc = "?"; try { usdc = await view(C, "ft_balance_of", { account_id: a }); } catch (e) {}
  let reg = "?"; try { reg = await view(C, "storage_balance_of", { account_id: a }); } catch (e) {}
  console.log(label, "| NEAR:", near, "| USDC:", usdc, "| reg:", reg);
}
