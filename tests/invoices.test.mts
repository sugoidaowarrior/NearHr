/**
 * Invoice amount parsing / formatting and slug helpers (pure, no DB/network).
 *
 * These guard the money math that underpins the trustless pay + refund flow:
 * USDC is 6 decimals, NEAR is 24, and base units exceed 2^53 so they must
 * never transit a float.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  parseAmount,
  amountBase,
  formatAmount,
  makeSlug,
  parseItems,
} from "../src/lib/invoices";

test("parseAmount: USDC 6 decimal base units", () => {
  assert.equal(parseAmount("1"), 1_000_000n);
  assert.equal(parseAmount("12.5"), 12_500_000n);
  assert.equal(parseAmount("12.50"), 12_500_000n);
  assert.equal(parseAmount("0.000001"), 1n);
});

test("parseAmount: rejects anything not clean money", () => {
  assert.throws(() => parseAmount(""), /bad amount/);
  assert.throws(() => parseAmount("abc"), /bad amount/);
  assert.throws(() => parseAmount("1.2.3"), /bad amount/);
  assert.throws(() => parseAmount("-5"), /bad amount/);
  assert.throws(() => parseAmount("1e6"), /bad amount/);
  assert.throws(() => parseAmount("1.2345678"), /bad amount/); // 7 dp
  assert.throws(() => parseAmount("99999999999999999999999"), /bad amount/);
});

test("amountBase: dispatches on the invoice asset", () => {
  // USDC: 6 decimals.
  assert.equal(amountBase({ amount: "2.5", asset: "USDC" }), 2_500_000n);
  // NEAR: 24 decimals (yocto).
  assert.equal(amountBase({ amount: "1", asset: "NEAR" }), 10n ** 24n);
  assert.equal(amountBase({ amount: "0.5", asset: "NEAR" }), 5n * 10n ** 23n);
});

test("formatAmount: base units back to a human string", () => {
  assert.equal(formatAmount(1_000_000n), "1");
  assert.equal(formatAmount(12_500_000n), "12.5");
  assert.equal(formatAmount(1n), "0.000001");
  assert.equal(formatAmount(0n), "0");
});

test("formatAmount/parseAmount round trip", () => {
  for (const s of ["1", "0.5", "123.456789", "999999.999999"]) {
    assert.equal(formatAmount(parseAmount(s)), s);
  }
});

test("makeSlug: URL safe, fixed length, no ambiguous chars", () => {
  for (let i = 0; i < 20; i++) {
    const s = makeSlug();
    assert.equal(s.length, 6);
    // Exact alphabet the app uses: no l, i, o, 0, 1 (they look alike).
    assert.match(s, /^[abcdefghjkmnpqrstuvwxyz23456789]{6}$/);
  }
  assert.notEqual(makeSlug(), makeSlug());
});

test("parseItems: tolerates null and malformed JSON", () => {
  assert.deepEqual(parseItems(null), []);
  assert.deepEqual(parseItems(undefined), []);
  assert.deepEqual(parseItems(""), []);
  assert.deepEqual(parseItems("not json"), []);
  assert.deepEqual(parseItems("42"), []); // not an array
  // Only entries missing a string description or amount are dropped; an empty
  // description is kept so the displayed items still sum to the invoice total.
  assert.deepEqual(
    parseItems('[{"description":"Design","amount":"100"},{"amount":"x","nope":1},{"description":"","amount":"5"}]'),
    [
      { description: "Design", amount: "100" },
      { description: "", amount: "5" },
    ]
  );
});
