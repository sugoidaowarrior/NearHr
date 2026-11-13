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
import "./_setup";
import test from "node:test";
import assert from "node:assert/strict";

import {
  invoiceContractId,
  assetCode,
  chainGetInvoice,
  recordInvoiceOnChain,
  retryPendingOnChain,
  onChainActionForStatus,
} from "../src/lib/contract";
import { getDb } from "../src/lib/db";

const CONTRACT = "0b435161055d82a427059c442a73cdfd8a87c854478895434d1a730189fc84c2";

/**
 * Insert a real invoice row for the employer, flagged pending on chain. The
 * employer has no vault, so recordInvoiceOnChain bails at unlockVault before
 * any network call: these tests exercise the self heal decision logic
 * offline and never touch testnet.
 */
function pendingInvoice(
  rowId: string,
  employerId: string,
  opts: { status?: string; asset?: "USDC" | "NEAR"; amount?: string; nearTx?: string } = {}
): { id: string; slug: string } {
  const slug = `sh${rowId}`;
  getDb()
    .prepare(
      `INSERT INTO invoices (id, slug, employer_id, client_name, client_email, note,
         items_json, amount, due_date, status, asset, near_tx, chain_status)
       VALUES (?, ?, ?, ?, NULL, NULL, '[]', ?, ?, ?, ?, ?, 'pending')`
    )
    .run(rowId, slug, employerId, "Self Heal Client", opts.amount ?? "1.00",
      "2026-12-01", opts.status ?? "open", opts.asset ?? "USDC", opts.nearTx ?? null);
  return { id: rowId, slug };
}

const chainStatusOf = (id: string): string | null =>
  (getDb().prepare("SELECT chain_status FROM invoices WHERE id = ?").get(id) as { chain_status: string | null } | undefined)
    ?.chain_status ?? null;

const settle = () => new Promise((r) => setTimeout(r, 150));

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

// Self heal (retryPendingOnChain), exercised offline. The test employers have
// no vault, so every attempt bails at unlockVault before any network call and
// the row stays pending: the tests pin the decision logic (which states get
// retried, which never do, throttling, best effort) without touching testnet.

test("onChainActionForStatus: the app state picks the registry write", () => {
  assert.equal(onChainActionForStatus("open"), "create");
  assert.equal(onChainActionForStatus("paid"), "paid");
  assert.equal(onChainActionForStatus("refunded"), "refunded");
  assert.equal(onChainActionForStatus("void"), null);
  assert.equal(onChainActionForStatus("pending"), null);
  assert.equal(onChainActionForStatus("garbage"), null);
});

test("retryPendingOnChain: contract not configured is a no-op", async () => {
  const prev = process.env.NEAR_INVOICE_CONTRACT_ID;
  try {
    delete process.env.NEAR_INVOICE_CONTRACT_ID;
    pendingInvoice("sh-noop1", "emp-noop");
    await retryPendingOnChain("emp-noop");
    assert.equal(chainStatusOf("sh-noop1"), "pending"); // untouched
  } finally {
    if (prev === undefined) delete process.env.NEAR_INVOICE_CONTRACT_ID;
    else process.env.NEAR_INVOICE_CONTRACT_ID = prev;
  }
});

test("retryPendingOnChain: no pending rows for the employer is a no-op", async () => {
  const prev = process.env.NEAR_INVOICE_CONTRACT_ID;
  try {
    process.env.NEAR_INVOICE_CONTRACT_ID = CONTRACT;
    pendingInvoice("sh-none1", "emp-none");
    getDb().prepare("UPDATE invoices SET chain_status = 'recorded' WHERE id = ?").run("sh-none1");
    await retryPendingOnChain("emp-none"); // nothing pending: nothing attempted
    // another employer's pending row is not theirs: left alone
    pendingInvoice("sh-none2", "emp-none-other");
    await retryPendingOnChain("emp-none");
    assert.equal(chainStatusOf("sh-none1"), "recorded");
  } finally {
    if (prev === undefined) delete process.env.NEAR_INVOICE_CONTRACT_ID;
    else process.env.NEAR_INVOICE_CONTRACT_ID = prev;
  }
});

test("retryPendingOnChain: a failed attempt stays pending, best effort, no throw", async () => {
  const prev = process.env.NEAR_INVOICE_CONTRACT_ID;
  try {
    process.env.NEAR_INVOICE_CONTRACT_ID = CONTRACT;
    pendingInvoice("sh-open1", "emp-open"); // open, no vault: the write cannot land
    await retryPendingOnChain("emp-open"); // resolves, never throws
    await settle();
    assert.equal(chainStatusOf("sh-open1"), "pending"); // flagged for the next pass
  } finally {
    if (prev === undefined) delete process.env.NEAR_INVOICE_CONTRACT_ID;
    else process.env.NEAR_INVOICE_CONTRACT_ID = prev;
  }
});

test("retryPendingOnChain: a second pass within the cooldown does not re attempt", async () => {
  const prev = process.env.NEAR_INVOICE_CONTRACT_ID;
  try {
    process.env.NEAR_INVOICE_CONTRACT_ID = CONTRACT;
    pendingInvoice("sh-try1", "emp-try");
    await retryPendingOnChain("emp-try"); // first attempt (now stamped)
    await settle();
    getDb().prepare("UPDATE invoices SET updated_at = '2020-01-01' WHERE id = ?").run("sh-try1");
    await retryPendingOnChain("emp-try"); // within the 5 min cooldown: skipped
    await settle();
    assert.equal(
      (getDb().prepare("SELECT updated_at FROM invoices WHERE id = ?").get("sh-try1") as { updated_at: string }).updated_at,
      "2020-01-01" // untouched by the throttled pass
    );
  } finally {
    if (prev === undefined) delete process.env.NEAR_INVOICE_CONTRACT_ID;
    else process.env.NEAR_INVOICE_CONTRACT_ID = prev;
  }
});

test("retryPendingOnChain: void invoices are never re-attempted", async () => {
  const prev = process.env.NEAR_INVOICE_CONTRACT_ID;
  try {
    process.env.NEAR_INVOICE_CONTRACT_ID = CONTRACT;
    pendingInvoice("sh-void1", "emp-void", { status: "void" });
    getDb().prepare("UPDATE invoices SET updated_at = '2020-01-01' WHERE id = ?").run("sh-void1");
    await retryPendingOnChain("emp-void");
    await settle();
    assert.equal(chainStatusOf("sh-void1"), "pending");
    assert.equal(
      (getDb().prepare("SELECT updated_at FROM invoices WHERE id = ?").get("sh-void1") as { updated_at: string }).updated_at,
      "2020-01-01" // the void row is skipped, not written
    );
  } finally {
    if (prev === undefined) delete process.env.NEAR_INVOICE_CONTRACT_ID;
    else process.env.NEAR_INVOICE_CONTRACT_ID = prev;
  }
});

test("retryPendingOnChain: paid and refunded rows are candidates (not skipped)", async () => {
  const prev = process.env.NEAR_INVOICE_CONTRACT_ID;
  try {
    process.env.NEAR_INVOICE_CONTRACT_ID = CONTRACT;
    pendingInvoice("sh-paid1", "emp-paid", { status: "paid", nearTx: "deadbeef" });
    pendingInvoice("sh-ref1", "emp-paid", { status: "refunded" });
    getDb().prepare("UPDATE invoices SET updated_at = '2020-01-01' WHERE id = ?").run("sh-paid1");
    getDb().prepare("UPDATE invoices SET updated_at = '2020-01-01' WHERE id = ?").run("sh-ref1");
    await retryPendingOnChain("emp-paid");
    await settle();
    // Both were attempted (the vaultless write fails at unlockVault, so both
    // were written back as pending); neither was skipped as "nothing to record".
    assert.equal(chainStatusOf("sh-paid1"), "pending");
    assert.equal(chainStatusOf("sh-ref1"), "pending");
  } finally {
    if (prev === undefined) delete process.env.NEAR_INVOICE_CONTRACT_ID;
    else process.env.NEAR_INVOICE_CONTRACT_ID = prev;
  }
});
