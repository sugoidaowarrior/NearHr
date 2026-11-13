/**
 * Client for the NearHr invoice registry contract.
 *
 * The contract is an append only audit log that mirrors the app's invoice
 * lifecycle: every invoice created in the app is recorded on chain, a payment
 * flips it to paid with the settlement tx hash, and a refund flips it to
 * refunded. Anyone can read any invoice back with a plain view call on any
 * public RPC, no key required: that is the auditable record.
 *
 * Money does not move through the contract. The app settles payments the way
 * it always has, and these writes only record what happened. Every call here
 * is best effort: a failure never blocks the app, never blocks a payment, and
 * never changes money state. It only means the on chain record is missing for
 * now, which the next write retries (the contract is idempotent, so a retry
 * can not double record).
 *
 * The calls are signed by the employer's own vault account, which the deploy
 * script registered on the contract as an authorized employer. The app
 * already holds that vault's key (it signs refunds today), so no new key and
 * no new account are introduced.
 *
 * Set NEAR_INVOICE_CONTRACT_ID (see .env.example) to enable the registry.
 * Unset, every function returns null and the app runs exactly as before.
 */
import { getDb } from "./db";
import { unlockVault } from "./vault";
import {
  accountForUrl,
  defaultNearConfig,
  explorerUrl,
  rawViewFailover,
  rpcCandidates,
} from "./near";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The on chain invoice record (as returned by the contract's get). */
export interface ChainInvoice {
  employer: string;
  client: string;
  amount: number; // USDC base units for USDC invoices, yocto for NEAR invoices
  status: number; // 0 open, 1 pending, 2 paid, 3 refunded, 4 void
  near_tx: string; // the settlement tx recorded by mark_paid
  updated_at: number;
}

export function invoiceContractId(): string | null {
  const id = (process.env.NEAR_INVOICE_CONTRACT_ID ?? "").trim();
  return id || null;
}

/** The on chain asset code the registry uses for an invoice asset. */
export function assetCode(asset: "USDC" | "NEAR"): "usdc" | "near" {
  return asset === "NEAR" ? "near" : "usdc";
}

/** Keyless audit read of one invoice from the registry, or null when absent. */
export async function chainGetInvoice(
  slug: string,
  contractId: string = invoiceContractId() ?? ""
): Promise<ChainInvoice | null> {
  if (!contractId) return null;
  try {
    const text = await rawViewFailover(contractId, "get", { slug });
    const v = JSON.parse(text) as Partial<ChainInvoice>;
    if (typeof v?.status !== "number") return null;
    return v as ChainInvoice;
  } catch {
    return null; // not recorded yet (or the RPC chain is down)
  }
}

function chainFields(
  txHash: string | null,
  cfg: { networkId: string }
): Record<string, string | null> {
  return {
    chain_status: "recorded",
    chain_tx: txHash && txHash !== "ok" ? explorerUrl(cfg.networkId, txHash) : null,
  };
}

/**
 * Send one contract call, failing over the public RPC endpoints. Returns the
 * tx hash on success, null on failure (never throws: the registry must not be
 * able to break the app).
 */
async function chainCall(
  contractId: string,
  account: string,
  key: string,
  method: string,
  args: Record<string, unknown>
): Promise<string | null> {
  const cfg = defaultNearConfig();
  const urls = Array.from(new Set([cfg.nodeUrl, ...rpcCandidates(cfg.networkId)]));
  let lastErr: unknown = null;
  for (const url of urls) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const acct = accountForUrl(url, account, key);
        const res = (await acct.callFunctionRaw({
          contractId,
          methodName: method,
          args,
          deposit: 0n,
          gas: 120_000_000_000_000n,
        })) as unknown as {
          transaction?: { hash?: string };
          transaction_hash?: string;
          hash?: string;
          status?: unknown;
        };
        const st = res?.status;
        if (
          st &&
          typeof st === "object" &&
          !Array.isArray(st) &&
          Object.keys(st as object).includes("Failure")
        ) {
          // A failed action is deterministic; another node returns the same
          // result, so stop instead of burning the failover chain.
          return null;
        }
        // near-api-js 7.x nests the hash under `transaction.hash`; older
        // shapes use a flat `transaction_hash`.
        return res?.transaction?.hash || res?.transaction_hash || res?.hash || null;
      } catch (e) {
        lastErr = e;
        // A deterministic on chain rejection is identical on every node.
        if (/employer not registered|slug exists|no such invoice|panic|reverted/i.test(String((e as Error)?.message ?? e))) {
          return null;
        }
        await sleep(800 * (attempt + 1));
      }
    }
  }
  void lastErr;
  return null;
}

/**
 * In-flight guard plus a per row throttle. A write already in progress is
 * not started twice, and a row that just failed (for example a vault that
 * is not registered on the contract) is not retried on every dashboard
 * visit: five minutes between attempts is plenty for the RPC to come back.
 */
const inflight = new Set<string>();
const lastAttempt = new Map<string, number>();
const RETRY_COOLDOWN_MS = 5 * 60 * 1000;

/**
 * Map an app invoice state to the on chain write that would record it, or
 * null for states with nothing to record (void, or an unknown value). The
 * registry mirrors the lifecycle: open invoices are created, paid ones get
 * mark_paid with the settlement tx, refunded ones mark_refunded.
 */
export function onChainActionForStatus(
  status: string
): "create" | "paid" | "refunded" | null {
  if (status === "open") return "create";
  if (status === "paid") return "paid";
  if (status === "refunded") return "refunded";
  return null;
}

/**
 * Self heal: re attempt the on chain write for every invoice of this
 * employer that is flagged pending (a best effort write that failed, for
 * example because the RPC was down). Called when the employer loads the
 * invoice list, so a registry that lagged the app catches up on the next
 * dashboard visit. The action follows the app state: open invoices re run
 * create_invoice, paid ones mark_paid with the settlement tx, refunded
 * ones mark_refunded. Best effort throughout: never throws, never blocks
 * the response, and a row that cannot be recorded yet is left pending for
 * the next pass.
 */
export async function retryPendingOnChain(employerId: string): Promise<void> {
  if (!invoiceContractId()) return;
  let rows: {
    id: string;
    slug: string;
    client_name: string;
    amount: string;
    asset: "USDC" | "NEAR";
    status: string;
    near_tx: string | null;
  }[];
  try {
    rows = getDb()
      .prepare(
        `SELECT id, slug, client_name, amount, asset, status, near_tx
         FROM invoices WHERE employer_id = ? AND chain_status = 'pending'`
      )
      .all(employerId) as typeof rows;
  } catch {
    return; // the flag read is best effort too
  }
  const now = Date.now();
  for (const row of rows) {
    const action = onChainActionForStatus(row.status);
    if (!action) continue; // void or an unknown state: nothing to record
    if (inflight.has(row.id)) continue;
    const last = lastAttempt.get(row.id) ?? 0;
    if (now - last < RETRY_COOLDOWN_MS) continue;
    inflight.add(row.id);
    lastAttempt.set(row.id, now);
    void recordInvoiceOnChain(
      {
        id: row.id,
        slug: row.slug,
        employer_id: employerId,
        client_name: row.client_name,
        amount: row.amount,
        asset: row.asset,
      },
      action,
      row.near_tx ?? undefined
    )
      .catch(() => null)
      .finally(() => {
        inflight.delete(row.id);
      });
  }
}

/**
 * Record the invoice lifecycle transition on chain, best effort. Resolves
 * the employer's vault, signs the call, and stores the receipt on the
 * invoice row (chain_status, chain_tx). When the invoice was not on chain
 * yet, create_invoice is re run first: the contract rejects a second create
 * for the same slug, so a retry after a past failure is safe.
 *
 * Resolves null (no receipt) whenever: the contract is not configured, the
 * invoice asset is not registered, the vault is not usable, or the write
 * failed (in that last case the row is flagged "pending" so the next
 * transition retries it). Never throws.
 */
export async function recordInvoiceOnChain(
  invoice: { id: string; slug: string; employer_id: string; client_name: string; amount: string; asset: "USDC" | "NEAR" },
  action: "create" | "paid" | "refunded",
  txHash?: string
): Promise<{ txHash: string; explorerUrl: string } | null> {
  const contractId = invoiceContractId();
  if (!contractId) return null;
  // NEAR invoices are not registered: the payment and the refund are native
  // NEAR transfers, which are already fully on chain and publicly traceable.
  if (invoice.asset === "NEAR") return null;
  const cfg = defaultNearConfig();
  // USDC base units (6 decimals), floored to the 0.1 USDC registry minimum.
  const base = BigInt(Math.round(Number(invoice.amount) * 1e6));
  if (base < 100_000n) return null;
  let vault: { nearAccount: string; nearMasterKey: string };
  try {
    vault = unlockVault(invoice.employer_id);
  } catch {
    return null; // vault not ready: the payment flow surfaces it on its own
  }
  try {
    let tx: string | null = null;
    if (action === "create") {
      const fields = getDb()
        .prepare("SELECT chain_status, chain_tx FROM invoices WHERE id = ?")
        .get(invoice.id) as { chain_status: string | null; chain_tx: string | null } | undefined;
      if (fields?.chain_status !== "recorded") {
        tx = await chainCall(
          contractId,
          vault.nearAccount,
          vault.nearMasterKey,
          "create_invoice",
          {
            slug: invoice.slug,
            employer: vault.nearAccount,
            client: invoice.client_name,
            // u128 over JSON: the app caps invoices at 1e12 base units, far
            // below 2^53, so a plain number is exact (see the live cycle).
            amount: Number(base),
          }
        );
        if (!tx) {
          // A deterministic "slug exists" (a past partial write) or a node
          // that dropped the receipt both leave the record on chain. Confirm
          // with a keyless read instead of flagging the row pending.
          const existing = await chainGetInvoice(invoice.slug, contractId);
          if (!existing) throw new Error("create_invoice not accepted");
          tx = null; // on chain, but without a fresh receipt
        }
      } else if (fields.chain_tx) {
        tx = null; // keep the existing receipt
      }
    } else {
      // mark_paid / mark_refunded need the invoice to exist on chain first.
      const existing = await chainGetInvoice(invoice.slug, contractId);
      if (!existing) {
        tx = await chainCall(
          contractId,
          vault.nearAccount,
          vault.nearMasterKey,
          "create_invoice",
          {
            slug: invoice.slug,
            employer: vault.nearAccount,
            client: invoice.client_name,
            amount: Number(base),
          }
        );
        if (!tx) {
          const again = await chainGetInvoice(invoice.slug, contractId);
          if (!again) throw new Error("create_invoice not accepted");
          tx = null;
        }
      }
      const mark = await chainCall(
        contractId,
        vault.nearAccount,
        vault.nearMasterKey,
        action === "paid" ? "mark_paid" : "mark_refunded",
        action === "paid" ? { slug: invoice.slug, near_tx: txHash ?? "" } : { slug: invoice.slug }
      );
      if (!mark) {
        // mark_paid is idempotent: if the read-back already shows the state
        // we wanted, the earlier write landed and only the receipt is lost.
        const after = await chainGetInvoice(invoice.slug, contractId);
        const want = action === "paid" ? 2 : 3;
        if (!after || after.status !== want) throw new Error(`${action} not accepted`);
        tx = null; // on chain, without a fresh receipt
      } else {
        tx = mark;
      }
    }
    const fields = chainFields(tx, cfg);
    getDb().prepare(
      // COALESCE keeps a receipt an earlier write already stored when this
      // one confirmed the on chain state without a fresh hash.
      `UPDATE invoices SET chain_status = ?, chain_tx = COALESCE(?, chain_tx), updated_at = datetime('now') WHERE id = ?`
    ).run(fields.chain_status, fields.chain_tx, invoice.id);
    return { txHash: tx ?? "", explorerUrl: fields.chain_tx ?? "" };
  } catch {
    // A failed write is retried by the next transition; flag the row so the
    // app can show it is not on chain yet.
    try {
      getDb().prepare(`UPDATE invoices SET chain_status = 'pending' WHERE id = ?`).run(invoice.id);
    } catch {
      /* the flag itself is best effort */
    }
    return null;
  }
}
