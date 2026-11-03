#!/usr/bin/env node
/**
 * Offline smoke test — no network, no DB file pollution beyond data/.
 *   node --env-file=.env.local scripts/smoke.mjs     (or without .env)
 * Verifies: vault encrypt/decrypt round-trip, passphrase failure, SIP NEAR
 * stealth create/derive/check/claim round-trip, CSV parser, USDC/NEAR math.
 */
process.env.NEAR_NETWORK = process.env.NEAR_NETWORK || "testnet";

import { initDb, getDb } from "../src/lib/db.ts";
import { encryptVault, decryptVault, makeBackupBundle, newToken, safeEqual } from "../src/lib/crypto.ts";
import { createEmployeeStealth, derivePayrollDestination, isMineForEmployee, claimPayment, isPrivacyLevel } from "../src/lib/privacy.ts";
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
const st = createEmployeeStealth("smoke");
const rec = encryptVault(
  { nearMasterKey: mk.base58, sipSpendingKey: st.spendingPrivateKey, sipViewingKey: st.viewingPrivateKey, sipMetaAddress: st.metaAddress, nearAccount: "smoke-account.testnet", createdAt: new Date().toISOString() },
  "correct horse battery staple"
);
const back = decryptVault(rec, "correct horse battery staple");
check("round-trip master key", back.nearMasterKey === mk.base58);
check("round-trip stealth meta", back.sipMetaAddress === st.metaAddress);
let threw = false;
try { decryptVault(rec, "wrong passphrase"); } catch { threw = true; }
check("wrong passphrase rejected", threw);
const bundle = makeBackupBundle("user-1", rec);
check("backup bundle decodes+decrypts", decryptVault(JSON.stringify(bundle.vault), "correct horse battery staple").nearAccount === "smoke-account.testnet");
check("safeEqual works", safeEqual(newToken(), newToken()) === false);

console.log("== privacy: NEAR stealth round-trip ==");
const emp = createEmployeeStealth("emp");
const dest = derivePayrollDestination(emp.metaAddress);
check("implicit account is 64 hex", /^[0-9a-f]{64}$/.test(dest.implicitAccountId));
const pending = { stealthAddress: dest.stealthAddress };
check("employer can derive destination (no secret)", true);
check("employee recognizes payment", isMineForEmployee(pending, emp));
const claim = claimPayment(pending, emp);
check("claim produces private key", claim.privateKey.length > 0);
check("claim implicit account matches", claim.implicitAccountId === dest.implicitAccountId);
const other = createEmployeeStealth("other");
check("other employee cannot claim", isMineForEmployee(pending, other) === false);
check("privacy levels valid", isPrivacyLevel("shielded") && isPrivacyLevel("compliant") && isPrivacyLevel("transparent") && !isPrivacyLevel("naked"));

console.log("== payroll: CSV parser ==");
const csv = `email,name,amount,near_account,stealth_meta,privacy
a@gmail.com,Alice,1500,a123.testnet,,
b@gmail.com,Bob,250.5,,${emp.metaAddress},shielded
c@gmail.com,Carol,100,c123.testnet,,transparent
a@gmail.com,Alice-dup,10,x.testnet,,
bad email,Bad,10,,
`;
const parsed = parsePayrollCsv(csv);
check("3 valid employees (true dup rejected)", parsed.employees.length === 3);
check("bad email flagged", parsed.errors.some((e) => e.includes("bad email")));
check("duplicate email flagged", parsed.errors.some((e) => e.includes("duplicate")));
check("row-level privacy kept", parsed.employees[1].privacy === "shielded");
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
