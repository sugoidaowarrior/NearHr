#!/usr/bin/env node
/**
 * Offline smoke test — no network, no DB file pollution beyond data/.
 *   npx tsx --env-file=.env.local scripts/smoke.mjs
 * (tsx is required: the lib modules use bundler-style extensionless imports.)
 * Verifies: vault encrypt/decrypt round-trip, passphrase failure, CSV parser,
 * USDC/NEAR math.
 */
process.env.NEAR_NETWORK = process.env.NEAR_NETWORK || "testnet";

import { initDb, getDb } from "../src/lib/db.ts";
import { encryptVault, decryptVault, makeBackupBundle, newToken, safeEqual } from "../src/lib/crypto.ts";
import { parsePayrollCsv } from "../src/lib/payroll.ts";
import { toYocto, yoctoToNear, usdcToBase, newMasterKey } from "../src/lib/near.ts";

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log("  ok  ", name); }
  else { fail++; console.error("  FAIL", name); }
}

console.log("== crypto: vault round-trip ==");
initDb();
const mk = newMasterKey();
const rec = encryptVault(
  { nearMasterKey: mk.base58, nearAccount: "smoke-account.testnet", createdAt: new Date().toISOString() },
  "correct horse battery staple"
);
const back = decryptVault(rec, "correct horse battery staple");
check("round-trip master key", back.nearMasterKey === mk.base58);
check("round-trip near account", back.nearAccount === "smoke-account.testnet");
let threw = false;
try { decryptVault(rec, "wrong passphrase"); } catch { threw = true; }
check("wrong passphrase rejected", threw);
const bundle = makeBackupBundle("user-1", rec);
check("backup bundle decodes+decrypts", decryptVault(JSON.stringify(bundle.vault), "correct horse battery staple").nearAccount === "smoke-account.testnet");
check("safeEqual works", safeEqual(newToken(), newToken()) === false);

console.log("== payroll: CSV parser ==");
const csv = `email,name,amount,near_account
a@gmail.com,Alice,1500,a123.testnet
b@gmail.com,Bob,250.5,
c@gmail.com,Carol,100,c123.testnet
a@gmail.com,Alice-dup,10,x.testnet
bad email,Bad,10,
`;
const parsed = parsePayrollCsv(csv);
check("3 valid employees (true dup rejected)", parsed.employees.length === 3);
check("bad email flagged", parsed.errors.some((e) => e.includes("bad email")));
check("duplicate email flagged", parsed.errors.some((e) => e.includes("duplicate")));
check("near account kept", parsed.employees[0].nearAccount === "a123.testnet");
const many = "email,name,amount\n" + Array.from({ length: 60 }, (_, i) => `e${i}@x.com,E${i},1`).join("\n");
check("60 rows rejected (>50)", parsePayrollCsv(many).errors.some((e) => e.includes("max is 50")));

console.log("== near math ==");
check("toYocto 1.5", toYocto("1.5") === 15n * 10n ** 23n);
check("toYocto 0", toYocto("0") === 0n);
check("yoctoToNear", yoctoToNear(15n * 10n ** 23n) === "1.5");
check("usdcToBase 12.5", usdcToBase("12.5") === 12500000n);
check("master key format", /^ed25519:/.test(mk.base58));

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"}: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
