// Live refund verification: tx status + balances + ledger row
const RPC = "https://test.rpc.fastnear.com";
const rpc = (method, params) =>
  fetch(RPC, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "1", method, params }) }).then(r => r.json());
const VAULT = "26fb69d73d9124e7845f04d10f8245479a312fc0b48405d78bf49f964fbccc66";
const PAYER = "f2d160c46531bfa2efcb660dedf5df6c9f597325cd93dba7743a15422fdbd322";
const TX = "5CzUXxtwYuVyHc7Ff5wdqbmtuZvXd5gRaUzirMU4Q7wY";
const t = await rpc("EXPERIMENTAL_tx_status", { tx_hash: TX, sender_account_id: VAULT, wait_until: "EXECUTED_OPTIMISTIC" });
console.log("refund tx status:", JSON.stringify(t.result?.status), "receipts:", t.result?.receipts_outcome?.length);
for (const [name, id] of [["vault", VAULT], ["payer", PAYER]]) {
  const a = await rpc("query", { request_type: "view_account", account_id: id, finality: "optimistic" });
  console.log(name, "NEAR:", Number(BigInt(a.result.account.amount)) / 1e24);
}
