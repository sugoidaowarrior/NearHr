/**
 * On chain invoice registry client (src/lib/contract.ts).
 *
 * These tests cover the safety contract of the wiring: when the registry is
 * not configured, or the invoice is not eligible, the client must return null
 * without touching the network or the money path. The real on chain write is
 * exercised by the live cycle (create -> paid -> refunded on testnet), which is
 * the actual proof; here we pin the gating and the no-op guarantees so a
 * future edit can not silently make invoice creation depend on an external RPC.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  invoiceContractId,
  assetCode,
  chainGetInvoice,
  recordInvoiceOnChain,
} from "../src/lib/contract";

const CONTRACT = "0b435161055d82a427059c442a73cdfd8a87c854478895434d1a730189fc84c2";

test("invoiceContractId: unset is null (registry off, app runs as before)", () => {
  const prev = process.env.NEAR_INVOICE_CONTRACT_ID;
  try {
    delete process.env.NEAR_INVOICE_CONTRACT_ID;
    assert.equal(invoiceContractId(), null);
    process.env.NEAR_INVOICE_CONTRACT_ID = "   ";
    assert.equal(invoiceContractId(), null); // whitespace only is also off
  } finally {
    if (prev === undefined) delete process.env.NEAR_INVOICE_CONTRACT_ID;
    else process.env.NEAR_INVOICE_CONTRACT_ID = prev;
  }
});

test("invoiceContractId: set returns the trimmed account id", () => {
  const prev = process.env.NEAR_INVOICE_CONTRACT_ID;
  try {
    process.env.NEAR_INVOICE_CONTRACT_ID = `  ${CONTRACT}  `;
    assert.equal(invoiceContractId(), CONTRACT);
  } finally {
    if (prev === undefined) delete process.env.NEAR_INVOICE_CONTRACT_ID;
    else process.env.NEAR_INVOICE_CONTRACT_ID = prev;
  }
});

test("assetCode: USDC -> usdc, NEAR -> near", () => {
  assert.equal(assetCode("USDC"), "usdc");
  assert.equal(assetCode("NEAR"), "near");
});

test("chainGetInvoice: no contract configured resolves null (no throw, no net)", async () => {
  const prev = process.env.NEAR_INVOICE_CONTRACT_ID;
  try {
    delete process.env.NEAR_INVOICE_CONTRACT_ID;
    assert.equal(await chainGetInvoice("some-slug", ""), null);
  } finally {
    if (prev === undefined) delete process.env.NEAR_INVOICE_CONTRACT_ID;
    else process.env.NEAR_INVOICE_CONTRACT_ID = prev;
  }
});

test("recordInvoiceOnChain: registry off -> null for every action (never throws)", async () => {
  const prev = process.env.NEAR_INVOICE_CONTRACT_ID;
  try {
    delete process.env.NEAR_INVOICE_CONTRACT_ID;
    const inv = {
      id: "inv1",
      slug: "abc123",
      employer_id: "u1",
      client_name: "Client",
      amount: "10",
      asset: "USDC" as const,
    };
    assert.equal(await recordInvoiceOnChain(inv, "create"), null);
    assert.equal(await recordInvoiceOnChain(inv, "paid", "deadbeef"), null);
    assert.equal(await recordInvoiceOnChain(inv, "refunded"), null);
  } finally {
    if (prev === undefined) delete process.env.NEAR_INVOICE_CONTRACT_ID;
    else process.env.NEAR_INVOICE_CONTRACT_ID = prev;
  }
});

test("recordInvoiceOnChain: NEAR invoices are never registered (native NEAR is already on chain)", async () => {
  const prev = process.env.NEAR_INVOICE_CONTRACT_ID;
  try {
    process.env.NEAR_INVOICE_CONTRACT_ID = CONTRACT;
    const inv = {
      id: "inv2",
      slug: "abc123",
      employer_id: "u1",
      client_name: "Client",
      amount: "1",
      asset: "NEAR" as const,
    };
    // Returns before touching the vault or the network.
    assert.equal(await recordInvoiceOnChain(inv, "create"), null);
    assert.equal(await recordInvoiceOnChain(inv, "paid", "deadbeef"), null);
  } finally {
    if (prev === undefined) delete process.env.NEAR_INVOICE_CONTRACT_ID;
    else process.env.NEAR_INVOICE_CONTRACT_ID = prev;
  }
});

test("recordInvoiceOnChain: USDC below the 0.1 minimum is not registered", async () => {
  const prev = process.env.NEAR_INVOICE_CONTRACT_ID;
  try {
    process.env.NEAR_INVOICE_CONTRACT_ID = CONTRACT;
    const inv = {
      id: "inv3",
      slug: "abc123",
      employer_id: "u1",
      client_name: "Client",
      amount: "0.05", // 50_000 base units, under the contract's 100_000 floor
      asset: "USDC" as const,
    };
    assert.equal(await recordInvoiceOnChain(inv, "create"), null);
  } finally {
    if (prev === undefined) delete process.env.NEAR_INVOICE_CONTRACT_ID;
    else process.env.NEAR_INVOICE_CONTRACT_ID = prev;
  }
});
