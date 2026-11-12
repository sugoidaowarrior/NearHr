#!/usr/bin/env node
/**
 * Deploy the NearHr invoice contract. Works on testnet or mainnet.
 *
 * Two supported paths:
 *
 *  1. Dedicated implicit account (the one used for the live testnet deploy):
 *     the account is funded with free testnet NEAR and auto created on chain,
 *     and the deploy key is the key that generated the implicit address.
 *
 *     node scripts/deploy-invoice-contract.mjs deploy
 *
 *  2. A regular named sub account created by an existing account:
 *
 *     NEAR_DEPLOYER_ACCOUNT=you.testnet NEAR_DEPLOYER_KEY=ed25519:... \
 *       node scripts/deploy-invoice-contract.mjs deploy
 *
 * Sub commands:
 *
 *   node scripts/deploy-invoice-contract.mjs deploy              # deploy + init
 *   node scripts/deploy-invoice-contract.mjs register <account>  # register an employer
 *   node scripts/deploy-invoice-contract.mjs check <account>     # is_employer view call
 *
 * The deploy key becomes the contract owner (set_relayer, register_employer)
 * AND the relayer of record (it may pay gas for mark_paid / mark_refunded).
 * Employer accounts are equally authorized to mark their own invoices.
 *
 * Env vars:
 *   NEAR_NETWORK             testnet (default) or mainnet
 *   NEAR_INVOICE_CONTRACT_ID the contract account (defaults to the live one)
 *   NEAR_DEPLOY_KEY          private key, ed25519 base58 (or set NEAR_DEPLOY_KEY_FILE)
 *   NEAR_DEPLOY_KEY_FILE     path to a file holding the key (default data/contract-deploy.key)
 *   NEAR_DEPLOYER_ACCOUNT    only needed for path 2, to create a sub account
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Account, JsonRpcProvider } from "near-api-js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const WASM = join(root, "contracts/invoice-contract/target/wasm32-unknown-unknown/release/nearhr_invoice.wasm");

const NETWORK = process.env.NEAR_NETWORK || "testnet";
const RPC =
  NETWORK === "mainnet"
    ? process.env.NEAR_NODE_URL || "https://free.rpc.fastnear.com"
    : "https://rpc.testnet.near.org";

// The live testnet deployment (funded with free testnet NEAR, see README).
const contractId = process.env.NEAR_INVOICE_CONTRACT_ID || "0b435161055d82a427059c442a73cdfd8a87c854478895434d1a730189fc84c2";
const EXPLORER = NETWORK === "mainnet" ? "https://explorer.near.org" : "https://explorer.testnet.near.org";

const provider = new JsonRpcProvider({ url: RPC });

function loadKey() {
  const file = process.env.NEAR_DEPLOY_KEY_FILE || join(root, "data/contract-deploy.key");
  if (process.env.NEAR_DEPLOY_KEY) return process.env.NEAR_DEPLOY_KEY.trim();
  if (existsSync(file)) return readFileSync(file, "utf8").trim();
  console.error("No deploy key. Set NEAR_DEPLOY_KEY or write the key to " + file);
  process.exit(1);
}

const txHash = (r) => r?.transaction?.hash || r?.transaction_hash || r?.hash || "unknown";
const txLink = (r) => EXPLORER + "/transactions/" + txHash(r);

async function accountFor(keyStr, id = contractId) {
  // near-api-js Account takes the key as a string, not a KeyPair object.
  return new Account(id, provider, keyStr);
}

async function exists(id) {
  try {
    await provider.query({ request_type: "view_account", account_id: id, finality: "optimistic" });
    return true;
  } catch (e) {
    return /does not exist/i.test(String(e?.message || e));
  }
}

async function deploy() {
  const key = loadKey();
  const wasm = readFileSync(WASM);
  console.log(`wasm: ${wasm.length} bytes  contract: ${contractId}  network: ${NETWORK}`);

  const present = await exists(contractId);
  if (!present && process.env.NEAR_DEPLOYER_ACCOUNT) {
    // path 2: create a sub account under the deployer (0.25 NEAR storage)
    const owner = await accountFor(process.env.NEAR_DEPLOYER_KEY || key, process.env.NEAR_DEPLOYER_ACCOUNT);
    console.log(`creating ${contractId} as a sub of ${process.env.NEAR_DEPLOYER_ACCOUNT}`);
    const created = await owner.createAccount({
      newAccountId: contractId,
      publicKey: key.replace(/^[^:]+:/, ""),
      nearToTransfer: 250_000_000_000_000_000_000n,
    });
    console.log("create tx:", txLink(created), JSON.stringify(created.status));
  } else if (!present) {
    console.error(`Account ${contractId} does not exist on ${NETWORK}. Fund it first (implicit path) or set NEAR_DEPLOYER_ACCOUNT (sub account path).`);
    process.exit(1);
  }

  const account = await accountFor(key);
  const deployed = await account.deployContract(wasm);
  console.log("deploy tx:", txLink(deployed), JSON.stringify(deployed.status));

  // init only on first run: reinit is rejected by the contract itself
  const init = await account.callFunctionRaw({
    contractId,
    methodName: "new",
    args: { relayer: contractId, employers: [] },
    deposit: 0n,
    gas: 300_000_000_000_000_000n,
  }).catch((e) => {
    if (/reinit not allowed|already exists/i.test(String(e?.message || e))) return null;
    throw e;
  });
  if (init) console.log("init tx:", txLink(init), JSON.stringify(init.status));
  else console.log("init: already initialized, skipped");

  console.log(`\nDone. Contract live at ${EXPLORER}/accounts/${contractId}`);
  console.log("Next: register the employer account(s) that will bill clients:");
  console.log(`  node scripts/deploy-invoice-contract.mjs register <employer.vault.account>`);
  console.log(`\nSet in .env.local: NEAR_INVOICE_CONTRACT_ID=${contractId}`);
}

async function register(employer) {
  const key = loadKey();
  if (!employer) {
    console.error("usage: node scripts/deploy-invoice-contract.mjs register <employer.vault.account>");
    process.exit(1);
  }
  const account = await accountFor(key);
  const res = await account.callFunctionRaw({
    contractId,
    methodName: "register_employer",
    args: { employer },
    deposit: 0n,
    gas: 300_000_000_000_000_000n,
  });
  console.log("register_employer tx:", txLink(res), JSON.stringify(res.status));
  console.log(`is_employer(${employer}): see check command`);
}

async function check(employer) {
  if (!employer) {
    console.error("usage: node scripts/deploy-invoice-contract.mjs check <account>");
    process.exit(1);
  }
  const argsBase64 = Buffer.from(JSON.stringify({ employer })).toString("base64");
  const r = await provider.query({
    request_type: "call_function",
    account_id: contractId,
    method_name: "is_employer",
    args_base64: argsBase64,
    finality: "optimistic",
  });
  const bytes = Array.isArray(r.result?.result) ? r.result.result : r.result;
  console.log(`is_employer(${employer}) = ${Buffer.from(bytes).toString("utf8")}`);
}

const [,, cmd, arg] = process.argv;
if (cmd === "deploy") await deploy();
else if (cmd === "register") await register(arg);
else if (cmd === "check") await check(arg);
else {
  console.log("usage: node scripts/deploy-invoice-contract.mjs deploy | register <account> | check <account>");
  process.exit(1);
}
