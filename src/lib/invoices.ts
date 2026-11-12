/**
 * Invoices (testnet, wallet pay, dual asset).
 *
 * The employer bills a client a total amount with a short narration (what the
 * work is for). There are no line items. The employer picks the token at
 * creation time: USDC or NEAR. The client opens the pay link, signs in with a
 * NEAR wallet (Meteor or HERE on testnet) and pays in exactly that token,
 * straight to the employer's vault. No payment API, no x402, no third party rail.
 *
 * Verification is trustless. The client only posts its signed transaction and
 * its own account id. The server reads the real on chain outcome with the `tx`
 * RPC and confirms the vault actually received the exact amount before the
 * invoice ever flips to paid, so a client can not claim a payment that did not
 * happen.
 *
 * Amounts are decimal strings in the DB. USDC on NEAR is 6 decimals
 * (1 USDC = 1_000_000n), NEAR is 24 decimals (yocto). Base units exceed 2^53,
 * so they never ride through a float.
 */
import { getDb } from "./db";
import { createHash, randomBytes } from "node:crypto";
import { unlockVault } from "./vault";
import { recordInvoicePayment } from "./invoice-payments";
import { recordInvoiceOnChain } from "./contract";
import {
  accountFromVault,
  defaultNearConfig,
  ensureUsdcRegistration,
  explorerUrl,
  nearProvider,
  normalizeTxHash,
  queryTx,
  sendNear,
  sendUsdc,
  toYocto,
  usdcContractId,
} from "./near";

export type InvoiceAsset = "USDC" | "NEAR";

/**
 * Vault readiness before a payment can land: the vault must exist on chain and
 * (for USDC invoices) hold a USDC storage record, or the client's transfer
 * cannot be received. Auto-registers the USDC record (idempotent) so the payer
 * never hits a failed delivery.
 */
export class VaultNotReadyError extends Error {
  constructor(public readonly address: string) {
    super(`vault ${address} not ready`);
    this.name = "VaultNotReadyError";
  }
}

export async function ensureVaultReadyForInvoices(vault: { nearAccount: string; nearMasterKey: string }): Promise<void> {
  const addr = vault.nearAccount;
  try {
    const provider = nearProvider();
    await provider.query({ request_type: "view_account", account_id: addr, finality: "optimistic" } as never);
  } catch (e) {
    if (/does not exist/i.test(e instanceof Error ? e.message : String(e))) {
      throw new VaultNotReadyError(addr);
    }
    // Transient RPC error: proceed, registration below surfaces a real failure.
  }
  try {
    await ensureUsdcRegistration(accountFromVault(addr, vault.nearMasterKey));
  } catch (e) {
    if (/does not exist/i.test(e instanceof Error ? e.message : String(e))) {
      throw new VaultNotReadyError(addr);
    }
    throw e;
  }
}

export type InvoiceStatus = "open" | "pending" | "paid" | "refunded" | "void";

export type Invoice = {
  id: string;
  slug: string;
  employer_id: string;
  client_name: string;
  client_email: string | null;
  note: string | null; // narration: what the invoice is for
  items_json: string; // legacy, now always "[]" (no line items)
  amount: string; // decimal string in the invoice's asset
  due_date: string; // YYYY-MM-DD
  status: InvoiceStatus;
  quote_ref: string | null;
  deposit_address: string | null; // the employer's vault (payment destination)
  deposit_deadline: string | null;
  asset: InvoiceAsset; // the token this invoice is billed in
  payer_asset: string | null; // the token actually received when paid
  payer_amount: string | null; // base units received
  payer_account: string | null; // the wallet that paid (for re poll lookups)
  near_tx: string | null;
  refund_tx: string | null;
  refund_at: string | null;
  chain_status: string | null; // "recorded" | "pending" | null (registry receipt)
  chain_tx: string | null; // explorer link of the on chain registry write
  settled_at: string | null;
  relayer_tx: string | null;
  created_at: string;
  updated_at: string;
};

const SLUG_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export function makeSlug(): string {
  const b = randomBytes(6);
  let s = "";
  for (let i = 0; i < 6; i++) s += SLUG_ALPHABET[b[i] % SLUG_ALPHABET.length];
  return s;
}

/** "12.50" -> 12_500_000n USDC base units. Throws on anything not clean money. */
export function parseAmount(s: string): bigint {
  const m = /^(\d{1,9})(?:\.(\d{1,6}))?$/.exec(String(s).trim());
  if (!m) throw new Error("bad amount");
  const frac = (m[2] ?? "").padEnd(6, "0");
  return BigInt(m[1]) * 10n ** 6n + BigInt(frac);
}

/** The invoice amount in the base units of its asset (USDC 6 dp, NEAR 24 dp). */
export function amountBase(inv: Pick<Invoice, "amount" | "asset">): bigint {
  return inv.asset === "NEAR" ? toYocto(inv.amount) : parseAmount(inv.amount);
}

/** USDC base units -> human string ("12.5"). */
export function formatAmount(base: string | bigint): string {
  const s = String(base).padStart(7, "0");
  const tail = s.slice(-6).replace(/0+$/, "");
  return s.slice(0, -6) + (tail ? "." + tail : "");
}

export type InvoiceLineItem = {
  description: string;
  amount: string; // decimal string in the invoice's asset
};

export function parseItems(itemsJson: string | null | undefined): InvoiceLineItem[] {
  if (!itemsJson) return [];
  try {
    const v = JSON.parse(itemsJson);
    if (!Array.isArray(v)) return [];
    return v
      .filter((x) => x && typeof x.description === "string" && typeof x.amount === "string")
      .map((x) => ({ description: x.description, amount: x.amount }));
  } catch {
    return [];
  }
}

export function createInvoice(
  employerId: string,
  input: {
    client_name: string;
    client_email: string | null;
    note: string | null;
    amount: string;
    due_date: string;
    asset?: InvoiceAsset;
    items?: { description: string; amount: string }[];
  }
): Invoice {
  if (!input.client_name || input.client_name.length > 120) throw new Error("client name is required");
  if (input.client_email && !/^[^\s@]+\@[^\s@]+\.[^\s@]+$/.test(input.client_email)) throw new Error("bad client email");
  const asset: InvoiceAsset = input.asset === "NEAR" ? "NEAR" : "USDC";
  const items: InvoiceLineItem[] = (input.items ?? [])
    .map((it) => ({ description: it.description.trim().slice(0, 200), amount: it.amount.trim() }))
    .filter((it) => it.description && it.amount);
  let amountStr = input.amount;
  if (items.length) {
    for (const it of items) {
      const v = Number(it.amount);
      if (!Number.isFinite(v) || v <= 0) throw new Error("each line item needs an amount above zero");
    }
    const totalCents = items.reduce((s, it) => s + Math.round(Number(it.amount) * 100), 0);
    amountStr = (totalCents / 100).toFixed(2);
  }
  const base = amountBase({ amount: amountStr, asset });
  if (base <= 0n) throw new Error("amount must be above zero");
  if (base > (asset === "NEAR" ? 10n ** 30n : 10n ** 12n)) throw new Error("invoice too large");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.due_date) || isNaN(Date.parse(input.due_date))) throw new Error("due date must be YYYY-MM-DD");
  const id = randomBytes(12).toString("hex");
  const slug = makeSlug();
  const db = getDb();
  db.prepare(
    `INSERT INTO invoices (id, slug, employer_id, client_name, client_email, note, items_json, amount, due_date, asset)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    slug,
    employerId,
    input.client_name,
    input.client_email ?? null,
    input.note ?? null,
    items.length ? JSON.stringify(items) : "[]",
    amountStr,
    input.due_date,
    asset
  );
  const row = db.prepare("SELECT * FROM invoices WHERE id = ?").get(id) as Invoice;
  if (!row) throw new Error("insert failed");
  return row;
}

export function listInvoices(employerId: string): Invoice[] {
  return getDb()
    .prepare("SELECT * FROM invoices WHERE employer_id = ? ORDER BY created_at DESC, id DESC LIMIT 200")
    .all(employerId) as Invoice[];
}

export function getInvoiceBySlug(slug: string): Invoice | null {
  return (getDb().prepare("SELECT * FROM invoices WHERE slug = ?").get(slug) as Invoice) ?? null;
}

export function getInvoiceById(id: string, employerId: string): Invoice | null {
  return (getDb().prepare("SELECT * FROM invoices WHERE id = ? AND employer_id = ?").get(id, employerId) as Invoice) ?? null;
}

export function updateInvoice(id: string, fields: Record<string, string | null>): void {
  const keys = Object.keys(fields);
  if (keys.length === 0) return;
  const sets = keys.map((k) => `${k} = ?`).join(", ");
  getDb()
    .prepare(`UPDATE invoices SET ${sets}, updated_at = datetime('now') WHERE id = ?`)
    .run(...keys.map((k) => fields[k]), id);
}

/** The employer's vault: where the client's payment lands. */
export function invoiceVault(employerId: string): string {
  return unlockVault(employerId).nearAccount;
}

/**
 * What the payer needs to send the payment: token, destination, base amount.
 * The vault is the employer's implicit account, so it does not have to be
 * pre funded: it comes into existence the moment it receives a payment. The
 * vault's one time USDC storage record is registered by the payer inside the
 * same transaction (see wallet.tsx and sendUsdcToVault) and is paid from the
 * payer's wallet, not the (often empty) employer vault.
 */
export function payDetails(inv: Invoice) {
  const cfg = defaultNearConfig();
  const v = unlockVault(inv.employer_id);
  return {
    asset: inv.asset,
    vault: v.nearAccount,
    usdcContract: usdcContractId(cfg.networkId),
    networkId: cfg.networkId,
    amountBase: String(amountBase(inv)),
  };
}

export function publicView(inv: Invoice, withPay = false) {
  // What a client sees: no employer emails, no internal ids beyond the slug.
  const view = {
    slug: inv.slug,
    clientName: inv.client_name,
    note: inv.note,
    amount: inv.amount,
    asset: inv.asset,
    dueDate: inv.due_date,
    items: parseItems(inv.items_json),
    status: inv.status,
    nearTx: inv.near_tx,
    refundTx: inv.refund_tx,
    chainStatus: inv.chain_status,
    chainTx: inv.chain_tx,
    settledAt: inv.settled_at,
    createdAt: inv.created_at,
    explorerUrl: inv.near_tx ? explorerUrl(defaultNearConfig().networkId, inv.near_tx) : null,
    refundExplorerUrl: inv.refund_tx ? explorerUrl(defaultNearConfig().networkId, inv.refund_tx) : null,
  };
  if (withPay) {
    try {
      const pd = payDetails(inv);
      return {
        ...view,
        vault: pd.vault,
        usdcContract: pd.usdcContract,
        networkId: pd.networkId,
        amountBase: pd.amountBase,
      };
    } catch {
      // Vault not unlocked (decryption issue): payer is told to try again shortly.
      return { ...view, vault: null, usdcContract: null, networkId: null, amountBase: String(amountBase(inv)) };
    }
  }
  return view;
}

/* ── Trustless on chain verification ─────────────────────────────────── */

type TxOutcome = Awaited<ReturnType<typeof queryTx>>;

/** Scan the executed receipts for the USDC ft_transfer that credits the vault
 * the exact billed amount, initiated by the claimed payer. Returns the base
 * units received, or null when no matching receipt is present.
 */
function usdcCreditToVault(o: TxOutcome, vault: string, usdcContract: string, expectedBase: bigint, payer: string | null): bigint | null {
  const receipts = Array.isArray(o.receipts) ? o.receipts : [];
  for (const r of receipts) {
    if (!r || r.receiver_id !== usdcContract) continue;
    const actions = r.receipt?.Action?.actions;
    if (!Array.isArray(actions)) continue;
    for (const a of actions) {
      const fc = (a as { FunctionCall?: { method_name?: string; args?: string } }).FunctionCall;
      if (!fc || fc.method_name !== "ft_transfer") continue;
      let args: { receiver_id?: string; amount?: string };
      try {
        args = JSON.parse(Buffer.from(fc.args ?? "", "base64").toString("utf8"));
      } catch {
        continue;
      }
      if (args.receiver_id !== vault) continue;
      let base: bigint;
      try {
        base = BigInt(String(args.amount ?? "0"));
      } catch {
        continue;
      }
      // When we know who claimed the payment, bind the receipt to them: the
      // transfer must have been initiated by that account. On a re-poll by hash
      // alone (payer null) we skip this: the hash + exact credit is the proof.
      if (payer && r.predecessor_id && r.predecessor_id !== payer) continue;
      if (base !== expectedBase) continue;
      return base;
    }
  }
  return null;
}

/** For a native NEAR invoice: the tx must go straight to the vault (from the
 * claimed payer) and its total NEAR deposit must equal the billed amount.
 */
function nearCreditToVault(o: TxOutcome, vault: string, expected: bigint, payer: string | null): bigint | null {
  const t = o.transaction as { receiver_id?: string; signer_id?: string; actions?: unknown[] } | undefined;
  if (!t || t.receiver_id !== vault) return null;
  if (payer && t.signer_id && t.signer_id !== payer) return null;
  let total = 0n;
  const actions = Array.isArray(t.actions) ? t.actions : [];
  for (const a of actions) {
    const tr = (a as { Transfer?: { deposit?: string } }).Transfer;
    if (tr?.deposit) {
      try {
        total += BigInt(String(tr.deposit));
      } catch {
        /* ignore malformed */
      }
    }
    const fc = (a as { FunctionCall?: { deposit?: string } }).FunctionCall;
    if (fc?.deposit) {
      // Smart account vaults receive NEAR as a FunctionCall deposit.
      try {
        total += BigInt(String(fc.deposit));
      } catch {
        /* ignore malformed */
      }
    }
  }
  return total === expected ? total : null;
}

export interface VerifyResult {
  invoice: Invoice;
  /** true when the chain proves the payment and the invoice is paid. */
  confirmed: boolean;
  /** human readable reason when not confirmed (chain not final, wrong amount, ...). */
  detail: string;
  /** the canonical tx hash we verified against (for storing / linking). */
  txHash: string;
}

function successStatus(o: TxOutcome): boolean {
  // Modern nodes report the milestone in final_execution_status ("FINAL",
  // "INCLUDED", ...) and the actual result in `status` as {SuccessValue} or
  // {Failure}. Older nodes put "SuccessValue" directly in final_execution_status.
  const s = o.status;
  if (s && typeof s === "object" && !Array.isArray(s)) {
    const keys = Object.keys(s as Record<string, unknown>);
    if (keys.includes("Failure")) return false;
    return keys.includes("SuccessValue");
  }
  return o.final_execution_status === "SuccessValue";
}

/**
 * Read the chain and decide the invoice state from a claim.
 *
 * Claimed by hash: `signedTxBase64` is empty and `payerAccount` is the account
 * that sent it (re-poll path). Claimed by wallet outcome: `signedTxBase64` is
 * the base64 SignedTransaction and `payerAccount` is the signer (first claim).
 * The tx hash is derived here (sha256 of the signed bytes) so the client never
 * fabricates it, then stored on the invoice for the polling path.
 */
export async function verifyPayment(
  slug: string,
  signedTxBase64: string,
  payerAccount: string,
  rawTxHash = ""
): Promise<VerifyResult> {
  const inv = getInvoiceBySlug(slug);
  if (!inv) throw new Error("invoice not found");
  if (inv.status === "void") return { invoice: inv, confirmed: false, detail: "invoice is void", txHash: inv.near_tx ?? "" };

  const txHash = signedTxBase64
    ? createHash("sha256").update(Buffer.from(signedTxBase64, "base64")).digest("hex")
    : normalizeTxHash(rawTxHash || inv.near_tx || "");
  if (!/^[0-9a-f]{64}$/.test(txHash)) {
    return { invoice: inv, confirmed: false, detail: "no transaction to verify yet", txHash };
  }

  const cfg = defaultNearConfig();
  const usdcContract = usdcContractId(cfg.networkId);
  const expected = amountBase(inv);

  let vault: string;
  try {
    vault = inv.deposit_address ?? invoiceVault(inv.employer_id);
  } catch {
    if (inv.status !== "pending") updateInvoice(inv.id, { status: "pending", near_tx: txHash });
    return { invoice: getInvoiceBySlug(slug)!, confirmed: false, detail: "the employer's payment vault is not ready yet, try again shortly", txHash };
  }

  const claimedPayer = payerAccount || inv.payer_account || "";

  let o: TxOutcome;
  try {
    // The tx RPC is looked up by hash + the account that sent it. On a re-poll
    // by hash we fall back to the payer recorded from the first claim. The
    // endpoint requires a syntactically valid sender account but resolves the
    // tx by hash, so when nobody claimed the payment a placeholder keeps the
    // query valid: the proof is then the hash itself plus the exact credit to
    // the vault (both checked below, and the payer binding is skipped).
    const rpcSender = claimedPayer || "anyone.testnet";
    o = await queryTx(txHash, rpcSender);
  } catch {
    if (inv.status !== "pending") updateInvoice(inv.id, { status: "pending", near_tx: txHash, deposit_address: vault, payer_account: payerAccount || null });
    return { invoice: getInvoiceBySlug(slug)!, confirmed: false, detail: "payment is still in flight, check again in a few seconds", txHash };
  }

  if (!successStatus(o)) {
    return { invoice: inv, confirmed: false, detail: "the wallet transaction did not succeed on chain", txHash };
  }

  const received =
    inv.asset === "NEAR"
      ? nearCreditToVault(o, vault, expected, claimedPayer || null)
      : usdcCreditToVault(o, vault, usdcContract, expected, claimedPayer || null);
  if (received === null) {
    if (inv.status !== "pending") updateInvoice(inv.id, { status: "pending", near_tx: txHash, deposit_address: vault, payer_account: payerAccount || null });
    return { invoice: getInvoiceBySlug(slug)!, confirmed: false, detail: `waiting for the ${inv.asset} transfer to be recorded on chain`, txHash };
  }

  let justPaid = false;
  if (inv.status !== "paid") {
    justPaid = true;
    updateInvoice(inv.id, {
      status: "paid",
      near_tx: txHash,
      deposit_address: vault,
      payer_asset: inv.asset,
      payer_amount: String(received),
      payer_account: payerAccount || inv.payer_account,
      settled_at: new Date().toISOString(),
    });
  }
  const fresh = getInvoiceBySlug(slug)!;
  // Book the received payment in the payments ledger (only on the first paid
  // transition, so a duplicate payment is never double booked).
  if (justPaid) {
    try {
      recordInvoicePayment(fresh, fresh.payer_account);
    } catch {
      /* ledger write is best effort; the chain is the source of truth */
    }
    // Record the payment on the on chain invoice registry (best effort, see
    // contract.ts: a failure never changes money state and is retried by the
    // next transition).
    void recordInvoiceOnChain(fresh, "paid", txHash).catch(() => null);
  }
  return { invoice: fresh, confirmed: true, detail: "payment confirmed on chain", txHash };
}

/**
 * Refund a paid invoice: send the exact billed amount back to the paying
 * account from the employer's vault, then move the invoice to refunded. The
 * payer can then re-pay (a walletless account keeps its balance after a
 * refund, so it can pay again immediately).
 *
 * Wallet payers (a NEAR account that signed in with Meteor or HERE) can always
 * receive on chain: a plain transfer or ft_transfer lands in any NEAR account.
 * Walletless payers hold an implicit NEAR account too, so they can receive as
 * well. The refund is the exact amount billed in the invoice's asset, which is
 * also what was verified as received on chain.
 */
export interface RefundResult {
  invoice: Invoice;
  txHash: string;
  explorerUrl: string;
}

export async function refundInvoice(id: string, employerId: string): Promise<RefundResult> {
  const inv = getInvoiceById(id, employerId);
  if (!inv) throw new Error("invoice not found");
  if (inv.status !== "paid") throw new Error(`only a paid invoice can be refunded (this one is ${inv.status})`);
  const payer = (inv.payer_account ?? "").trim().toLowerCase();
  if (!payer) throw new Error("no payer wallet is recorded for this invoice, so there is nowhere to refund");
  if (payer === (inv.deposit_address ?? "").trim().toLowerCase()) {
    throw new Error("the payment was made from your own vault; nothing to refund");
  }

  // Refund the exact billed amount in the invoice's asset (what was verified
  // as received on chain when it was paid).
  const base = amountBase(inv);

  let vault;
  try {
    vault = unlockVault(employerId);
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : "vault is not ready");
  }
  const account = accountFromVault(vault.nearAccount, vault.nearMasterKey);
  const cfg = defaultNearConfig();
  if (inv.asset === "USDC") {
    // Sending USDC requires the vault's storage record on the token contract
    // (the pay side already registered it, so this is a no-op in practice).
    await ensureUsdcRegistration(account, cfg);
  }

  let txHash: string;
  if (inv.asset === "NEAR") {
    ({ txHash } = await sendNear(account, payer, base));
  } else {
    ({ txHash } = await sendUsdc(account, payer, base, cfg));
  }

  updateInvoice(id, {
    status: "refunded",
    refund_tx: txHash,
    refund_at: new Date().toISOString(),
  });
  // Book the outflow in the ledger so the PDF statement and dashboard show the
  // money leaving the vault again (kind 'refund' is read by statementData).
  try {
    getDb()
      .prepare(
        `INSERT INTO payments (id, employer_id, employee_id, recipient_name, recipient_wallet, kind, asset, amount, note, tx_ref, status, paid_at)
         VALUES (?, ?, NULL, ?, ?, 'refund', ?, ?, ?, ?, 'sent', datetime('now'))`
      )
      .run(
        randomBytes(12).toString("hex"),
        employerId,
        inv.client_name,
        payer,
        inv.asset,
        inv.amount,
        `refund of invoice ${inv.slug}`,
        txHash || null
      );
  } catch {
    /* ledger write is best effort; the chain is the source of truth */
  }
  // Record the refund on the on chain invoice registry (best effort, see
  // contract.ts).
  void recordInvoiceOnChain(getInvoiceById(id, employerId)!, "refunded").catch(() => null);
  return {
    invoice: getInvoiceById(id, employerId)!,
    txHash,
    explorerUrl: explorerUrl(cfg.networkId, txHash),
  };
}
