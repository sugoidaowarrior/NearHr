#!/usr/bin/env node
/**
 * Deploy the NearHr invoice contract to NEAR mainnet.
 *
 * One time, ~0.06 NEAR total (account storage + init gas). The deployer key
 * needs a valid NEAR account name (e.g. nearhr.invoice.near) that is NOT yet
 * funded, plus enough balance to create it.
 *
 *   # 1. build the wasm (already done; re-run if you changed the contract)
 *   cd contracts/invoice-contract && cargo build --release --target wasm32-unknown-unknown
 *
 *   # 2. deploy  (paste the deployer PRIVATE key when prompted, or set NEAR_DEPLOY_KEY)
 *   node scripts/deploy-invoice-contract.mjs
 *
 *   # 3. register the employer (your vault account) so it may create_invoice / mark_paid
 *   node scripts/deploy-invoice-contract.mjs register <your.vault.account>
 *
 * The deployer key becomes the contract owner (set_relayer, register_employer)
 * AND the relayer of record (it may pay gas for mark_paid / mark_refunded).
 * Employer accounts register themselves and are equally authorized.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Account, JsonRpcProvider, KeyPair } from "near-api-js";
import { createInterface } from "node:readline/promises";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const WASM = join(root, "contracts/invoice-contract/target/wasm32-unknown-unknown/release/nearhr_invoice.wasm");

const NETWORK = process.env.NEAR_NETWORK || "mainnet";
const RPC =
  NETWORK === "mainnet"
    ? process.env.NEAR_NODE_URL || "https://free.rpc.fastnear.com"
    : "https://rpc.testnet.near.org";

const contractId = process.env.NEAR_INVOICE_CONTRACT_ID || "nearhr.invoice.near";
const [,, cmd, arg] = process.argv;

async function promptKey() {
  const envKey = process.env.NEAR_DEPLOY_KEY;
  if (envKey) return envKey.trim();
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const { value } = await rl.question("Deployer private key (ed25519 seed, base58): ");
  rl.close();
  return value.trim();
}

async function main() {
  const key = await promptKey();
  const keyPair = KeyPair.fromString(key);
  const provider = new JsonRpcProvider({ url: RPC });
  const account = new Account(contractId, provider, keyPair);

  // 0. check if the account exists yet
  let exists = true;
  try {
    await provider.query({ request_type: "view_account", account_id: contractId, finality: "optimistic" });
  } catch (e) {
    exists = /account .*? does not exist|does not exist/i.test(String(e?.message || e)) ? false : true;
  }

  if (cmd === "register") {
    // deployer calls register_employer on the already deployed contract
    const res = await account.callFunctionRaw({
      contractId,
      methodName: "register_employer",
      args: { employer: String(arg || "") },
      deposit: 0n,
      gas: 300_000_000_000_000n, // 300 Tgas
    });
    console.log("register_employer tx:", res.transaction_hash, "status:", JSON.stringify(res.status));
    return;
  }

  const wasm = readFileSync(WASM);
  console.log(`wasm: ${wasm.length} bytes`);
  console.log(`contract: ${contractId}  network: ${NETWORK}  rpc: ${RPC}`);

  // 1. create the account (only if it does not exist)
  if (!exists) {
    const owner = process.env.NEAR_DEPLOYER_ACCOUNT;
    if (!owner) {
      console.error("NEAR_DEPLOYER_ACCOUNT is required to create the account (the existing account that pays for it).");
      process.exit(1);
    }
    const ownerKp = KeyPair.fromString(process.env.NEAR_DEPLOYER_KEY || key);
    const owner = new Account(process.env.NEAR_DEPLOYER_ACCOUNT, provider, ownerKp);
    console.log(`creating ${contractId} as a sub of ${process.env.NEAR_DEPLOYER_ACCOUNT} (0.05 NEAR storage)`);
    const created = await owner.createAccount({
      newAccountId: contractId,
      publicKey: keyPair.getPublicKey().toString(),
      nearToTransfer: 50_000_000_000_000_000_000n, // 0.05 NEAR
    });
    console.log("create tx:", created.transaction_hash, JSON.stringify(created.status));
  }

  // 2. deploy the wasm
  console.log("deploying contract code...");
  const deployed = await account.deployContract(wasm);
  console.log("deploy tx:", deployed.transaction_hash, JSON.stringify(deployed.status));

  // 3. init: deployer is owner + relayer; start with no employers
  console.log("initializing (deployer = owner + relayer)...");
  const init = await account.callFunctionRaw({
    contractId,
    methodName: "new",
    args: { relayer: contractId, employers: [] },
    deposit: 0n,
    gas: 300_000_000_000_000_000n,
  });
  console.log("init tx:", init.transaction_hash, JSON.stringify(init.status));

  console.log("\nDone.");
  console.log(`Contract live at ${contractId} on ${NETWORK}.`);
  console.log(`Explorer: https://explorer.near.org/accounts/${contractId}`);
  console.log(`\nNext: register the employer account(s) that will bill clients:`);
  console.log(`  node scripts/deploy-invoice-contract.mjs register <employer.vault.account>`);
  console.log(`\nSet in .env.local:`);
  console.log(`  NEAR_INVOICE_CONTRACT=${contractId}`);
}

main().catch((e) => {
  console.error("deploy failed:", e?.message || e);
  process.exit(1);
});
