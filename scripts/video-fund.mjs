// One off: register + fund Philip's walletless payer account for the demo video.
import { unlockVault } from "../src/lib/vault.ts";
import {
  accountFromVault, defaultNearConfig, usdcContractId, usdcStorageMin,
  usdcToBase, sendUsdc, rawViewFailover,
} from "../src/lib/near.ts";

const USER = "111124370366682245498"; // Philip Oba-daini
const PAYER = "eb03bc5b301ee1129f0eac8bcf9896375b5c1270cd4decb5b95d4a6348c62d2b";
const FUND = "2.00";

const vault = unlockVault(USER);
const account = accountFromVault(vault.nearAccount, vault.nearMasterKey);
const cfg = defaultNearConfig();
const contract = usdcContractId(cfg.networkId);

async function reg() {
  const r = await account.callFunctionRaw({
    contractId: contract, methodName: "storage_deposit",
    args: { account_id: PAYER, registration_only: true },
    gas: (30e12).toString(), deposit: (await usdcStorageMin(cfg)).toString(),
  });
  return r;
}
async function bal(acct) {
  const t = (await rawViewFailover(contract, "storage_balance_of", { account_id: acct })).trim();
  return t;
}

console.log("vault:", account.accountId);
console.log("payer before:", await bal(PAYER));
await reg();
console.log("payer after register:", await bal(PAYER));
const tx = await sendUsdc(account, PAYER, usdcToBase(FUND));
console.log("fund tx:", tx.txHash, tx.status);
console.log("explorer: https://explorer.testnet.near.org/transactions/" + tx.txHash);
const after = await bal(PAYER);
console.log("payer balance record:", after);
