/**
 * Pure unit tests: no DB, no network. Amount math (NEAR yocto / USDC base),
 * tx hash normalization, slug format, token constants.
 */
import "./_setup";
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  toYocto,
  yoctoToNear,
  usdcToBase,
  usdcContractId,
  USDC_E_ID,
  explorerUrl,
  normalizeTxHash,
  rpcCandidates,
  defaultNearConfig,
  newMasterKey,
} from "../src/lib/near";
import { toBase, fromBase } from "../src/lib/payments";
import {
  parseAmount,
  formatAmount,
  amountBase,
  makeSlug,
  parseItems,
} from "../src/lib/invoices";

test("toYocto: whole NEAR", () => {
  assert.equal(toYocto("1"), 10n ** 24n);
  assert.equal(toYocto("100"), 100n * 10n ** 24n);
});

test("toYocto: fractional NEAR", () => {
  assert.equal(toYocto("1.5"), 15n * 10n ** 23n);
  assert.equal(toYocto("0.000000000000000000000001"), 1n);
});

test("toYocto: keeps all 24 decimal digits exactly (no float drift)", () => {
  // 2^53+1 whole NEAR: a float would corrupt this.
  const y = toYocto("9007199254740993");
  assert.equal(y, 9007199254740993n * 10n ** 24n);
  assert.equal(toYocto("1.234567890123456789012345"), 10n ** 24n + 234567890123456789012345n);
});

test("yoctoToNear: round trips", () => {
  assert.equal(yoctoToNear(10n ** 24n), "1");
  assert.equal(yoctoToNear(15n * 10n ** 23n), "1.5");
  assert.equal(yoctoToNear(0n), "0");
});

test("usdcContractId: mainnet is the canonical eUSD contract id constant", () => {
  assert.equal(usdcContractId("mainnet"), USDC_E_ID);
});

test("usdcToBase: 6 decimal places", () => {
  assert.equal(usdcToBase("1"), 1_000_000n);
  assert.equal(usdcToBase("12.5"), 12_500_000n);
  assert.equal(usdcToBase("0.000001"), 1n);
  assert.equal(usdcToBase("1.2345678"), 1_234_567n); // 7th decimal truncated
});

test("parseAmount: USDC human string to base units", () => {
  assert.equal(parseAmount("12.50"), 12_500_000n);
  assert.equal(parseAmount("12"), 12_000_000n);
  assert.equal(parseAmount("0.000001"), 1n);
  assert.equal(parseAmount(" 12 "), 12_000_000n); // trims
});

test("parseAmount: rejects anything that is not clean money", () => {
  for (const bad of ["", "abc", "-5", "1e3", "1.2345678", "0.", "9999999999.99"]) {
    assert.throws(() => parseAmount(bad), new RegExp("bad amount"), `expected throw for ${JSON.stringify(bad)}`);
  }
});

test("formatAmount: base units to human string", () => {
  assert.equal(formatAmount("12500000"), "12.5");
  assert.equal(formatAmount("1000000"), "1");
  assert.equal(formatAmount("0"), "0");
  assert.equal(formatAmount("1234567"), "1.234567");
  assert.equal(formatAmount("1234560"), "1.23456");
});

test("amountBase: depends on the invoice asset", () => {
  assert.equal(amountBase({ amount: "12.5", asset: "USDC" }), 12_500_000n);
  assert.equal(amountBase({ amount: "1.5", asset: "NEAR" }), 15n * 10n ** 23n);
});

test("usdcContractId: network dependent", () => {
  assert.equal(usdcContractId("mainnet"), "a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.factory.bridge.near");
  assert.equal(usdcContractId("testnet"), "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af");
  assert.equal(usdcContractId("something-else"), usdcContractId("testnet"));
});

test("explorerUrl: mainnet vs testnet", () => {
  assert.equal(
    explorerUrl("mainnet", "abc123"),
    "https://explorer.near.org/transactions/abc123"
  );
  assert.equal(
    explorerUrl("testnet", "abc123"),
    "https://explorer.testnet.near.org/transactions/abc123"
  );
});

const A58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function hexToB58(hex: string): string {
  let n = BigInt("0x" + hex);
  let s = "";
  while (n > 0n) {
    s = A58[Number(n % 58n)] + s;
    n /= 58n;
  }
  // one leading "1" per leading zero BYTE (two hex chars), mirroring the app helper
  let zeroBytes = 0;
  for (let i = 0; i + 1 < hex.length; i += 2) {
    if (hex[i] === "0" && hex[i + 1] === "0") zeroBytes++;
    else break;
  }
  return "1".repeat(zeroBytes) + s;
}

test("normalizeTxHash: 64 hex passes through lowercased", () => {
  const hex = "a".repeat(32) + "B".repeat(32);
  assert.equal(normalizeTxHash(hex), "a".repeat(32) + "b".repeat(32));
});

test("normalizeTxHash: base58 to canonical hex (with and without leading zeros)", () => {
  const noZero = "1a".repeat(32); // 64 hex, no leading zero byte
  assert.equal(normalizeTxHash(hexToB58(noZero)), noZero);
  const withZero = "00" + "cd".repeat(31); // leading zero byte -> single "1" prefix
  const b58 = hexToB58(withZero);
  assert.equal(b58.slice(0, 1), "1");
  assert.notEqual(b58.slice(0, 2), "11"); // one "1" per zero BYTE, not per hex char
  assert.equal(normalizeTxHash(b58), withZero);
  // first byte 0x0f (first hex char "0") must round trip too
  const lowByte = "0f".repeat(32);
  assert.equal(normalizeTxHash(hexToB58(lowByte)), lowByte);
});

test("normalizeTxHash: base64 to canonical hex", () => {
  const bytes = Buffer.alloc(32, 0x5a);
  const b64 = bytes.toString("base64");
  assert.equal(normalizeTxHash(b64), bytes.toString("hex"));
  // Bytes 0xfb/0xff force '+' and '/' into the base64 so it cannot be
  // mistaken for base58 by the earlier branch.
  const hex = "fbff".repeat(16);
  assert.equal(normalizeTxHash(Buffer.from(hex, "hex").toString("base64")), hex);
});

test("normalizeTxHash: pulls the hash out of an explorer URL", () => {
  const hex = "0f".repeat(32);
  assert.equal(normalizeTxHash(`https://explorer.testnet.near.org/transactions/${hex}`), hex);
});

test("normalizeTxHash: junk input gives empty string", () => {
  assert.equal(normalizeTxHash(""), "");
  assert.equal(normalizeTxHash("hello"), "");
  assert.equal(normalizeTxHash("https://explorer.near.org/transactions"), "");
});

test("toBase / fromBase: round trip per asset", () => {
  assert.equal(toBase("NEAR", "1.5"), 15n * 10n ** 23n);
  assert.equal(toBase("USDC", "2"), 2_000_000n);
  assert.equal(fromBase("USDC", "12500000"), "12.5");
  assert.equal(fromBase("USDC", "1000000"), "1");
  assert.equal(fromBase("USDC", "1234567"), "1.234567");
  assert.equal(fromBase("NEAR", 15n * 10n ** 23n), "1.5");
});

test("toBase: rejects zero, negative, 9 decimals, non numeric", () => {
  for (const [asset, bad] of [
    ["NEAR", "0"],
    ["NEAR", "-1"],
    ["NEAR", "1.234567890"], // 9 decimals, more than the 8 allowed
    ["USDC", "abc"],
  ] as const) {
    assert.throws(() => toBase(asset, bad), `expected throw for ${asset} ${bad}`);
  }
  // 8 decimals is the documented max and is accepted.
  assert.equal(toBase("NEAR", "1.23456789"), toYocto("1.23456789"));
});

test("rpcCandidates: deprecated nodes are the last resort", () => {
  const main = rpcCandidates("mainnet");
  assert.equal(main[0], "https://free.rpc.fastnear.com");
  assert.equal(main[main.length - 1], "https://rpc.mainnet.near.org");
  const tnet = rpcCandidates("testnet");
  assert.equal(tnet[0], "https://test.rpc.fastnear.com");
  assert.equal(tnet[tnet.length - 1], "https://rpc.testnet.near.org");
});

test("defaultNearConfig: testnet by default, mainnet only when explicit", () => {
  const savedNet = process.env.NEAR_NETWORK;
  const savedUrl = process.env.NEAR_NODE_URL;
  try {
    delete process.env.NEAR_NETWORK;
    delete process.env.NEAR_NODE_URL;
    assert.equal(defaultNearConfig().networkId, "testnet");

    process.env.NEAR_NETWORK = "mainnet";
    assert.equal(defaultNearConfig().networkId, "mainnet");
    assert.equal(defaultNearConfig().nodeUrl, "https://free.rpc.fastnear.com");

    process.env.NEAR_NODE_URL = "https://my.node:3030";
    assert.equal(defaultNearConfig().nodeUrl, "https://my.node:3030");
  } finally {
    if (savedNet === undefined) delete process.env.NEAR_NETWORK;
    else process.env.NEAR_NETWORK = savedNet;
    if (savedUrl === undefined) delete process.env.NEAR_NODE_URL;
    else process.env.NEAR_NODE_URL = savedUrl;
  }
});

test("newMasterKey: ed25519 keypair shape", () => {
  const k = newMasterKey();
  assert.match(k.publicKey, /^ed25519:/);
  // NEAR secret key format: "ed25519:" + base58 of the 64 byte (secret+public) key.
  // Base58 drops leading zero bytes, so the tail is 87 or 88 chars.
  assert.match(k.base58, /^ed25519:[1-9A-HJ-NP-Za-km-z]{87,88}$/);
  assert.notEqual(k.base58, newMasterKey().base58);
});

test("makeSlug: 6 chars from the unambiguous alphabet", () => {
  for (let i = 0; i < 20; i++) {
    assert.match(makeSlug(), /^[abcdefghjkmnpqrstuvwxyz23456789]{6}$/);
  }
});

test("parseItems: tolerant of null, junk and bad entries", () => {
  assert.deepEqual(parseItems(null), []);
  assert.deepEqual(parseItems("not json"), []);
  assert.deepEqual(parseItems("[]"), []);
  assert.deepEqual(parseItems('{"a":1}'), []);
  assert.deepEqual(parseItems('[{"description":"x","amount":"1.5"}, {"broken":true}]'), [
    { description: "x", amount: "1.5" },
  ]);
});
