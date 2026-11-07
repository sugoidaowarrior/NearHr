const RPC = "https://test.rpc.fastnear.com";
const rpc = (account_id) =>
  fetch(RPC, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "1", method: "query",
      params: { request_type: "view_account", account_id, finality: "optimistic" } }) })
    .then(r => r.json());
for (const [name, id] of [["vault","26fb69d73d9124e7845f04d10f8245479a312fc0b48405d78bf49f964fbccc66"],["payer","f2d160c46531bfa2efcb660dedf5df6c9f597325cd93dba7743a15422fdbd322"]]) {
  const r = await rpc(id);
  const acc = r.result?.account;
  console.log(name, acc ? Number(BigInt(acc.amount)) / 1e24 + " NEAR" : JSON.stringify(r.error ?? r).slice(0,120));
}
