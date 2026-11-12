import { randomUUID } from "node:crypto";
import { getDb } from "./db";
import {
  accountFromVault,
  defaultNearConfig,
  ensureUsdcRegistration,
  sendNear,
  sendUsdc,
  toYocto,
  usdcToBase,
  yoctoToNear,
} from "./near";
import { NEAR_ACCOUNT_RE, nearAccountLengthOk } from "./employees";

/**
 * Payment ledger + one off sends. Every payout (payroll line item or a manual
 * one off send) is written here so the dashboard can show "last paid per
 * employee" and the portfolio chart can trend against real outflow.
 */

export type PaymentAsset = "NEAR" | "USDC";

export interface PaymentInput {
  employerId: string;
  employeeId?: string | null;
  recipientName?: string;
  recipientWallet: string;
  kind: "payroll" | "send" | "swap";
  asset: PaymentAsset;
  amount: string; // human units
  note?: string;
  txRef?: string;
  status?: "sent" | "pending" | "failed";
}

export interface Payment {
  id: string;
  employeeId: string | null;
  recipientName: string | null;
  recipientWallet: string;
  kind: string;
  asset: string;
  amount: string;
  note: string | null;
  txRef: string | null;
  status: string;
  paidAt: string;
}

export function isNearAccount(w: string): boolean {
  const t = w.trim().toLowerCase();
  if (/^[0-9a-f]{64}$/.test(t)) return true; // implicit account
  return NEAR_ACCOUNT_RE.test(t) && nearAccountLengthOk(t);
}

/** human amount -> integer base units for the asset. Throws on bad input. */
export function toBase(asset: PaymentAsset, human: string): bigint {
  const s = String(human).trim();
  if (!/^\d+(\.\d{1,8})?$/.test(s)) throw new Error(`bad amount "${human}"`);
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) throw new Error("amount must be greater than zero");
  return asset === "NEAR" ? toYocto(s) : usdcToBase(s);
}

/** integer base units -> human string for the asset. */
export function fromBase(asset: PaymentAsset, base: string | bigint): string {
  const b = BigInt(base);
  if (asset === "NEAR") return yoctoToNear(b);
  const whole = b / 1_000_000n;
  const frac = (b % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

export function recordPayment(input: PaymentInput): string {
  const db = getDb();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO payments
      (id, employer_id, employee_id, recipient_name, recipient_wallet, kind, asset, amount, note, tx_ref, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.employerId,
    input.employeeId ?? null,
    input.recipientName ?? null,
    String(input.recipientWallet).trim().toLowerCase(),
    input.kind,
    input.asset,
    String(input.amount),
    input.note?.trim() || null,
    input.txRef ?? null,
    input.status ?? "sent"
  );
  return id;
}

export function listPayments(employerId: string, limit = 200): Payment[] {
  const rows = getDb()
    .prepare(
      `SELECT id, employee_id, recipient_name, recipient_wallet, kind, asset, amount, note, tx_ref, status, paid_at
       FROM payments WHERE employer_id = ?
       ORDER BY paid_at DESC, rowid DESC LIMIT ?`
    )
    .all(employerId, limit) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id),
    employeeId: (r.employee_id as string | null) ?? null,
    recipientName: (r.recipient_name as string | null) ?? null,
    recipientWallet: String(r.recipient_wallet),
    kind: String(r.kind),
    asset: String(r.asset),
    amount: String(r.amount),
    note: (r.note as string | null) ?? null,
    txRef: (r.tx_ref as string | null) ?? null,
    status: String(r.status),
    paidAt: String(r.paid_at),
  }));
}

export interface SendOneOffInput {
  employerId: string;
  to: string;
  asset: PaymentAsset;
  amount: string;
  note?: string;
  employeeId?: string | null;
}

export interface SendOneOffResult {
  txHash: string;
  status: string;
  paymentId: string;
}

/**
 * Send NEAR or USDC from the employer's vault to any NEAR wallet. Signs with
 * the auto unlocked master key, then records the payout in the ledger.
 */
export async function sendOneOff(
  input: SendOneOffInput,
  vault: { nearAccount: string; nearMasterKey: string }
): Promise<SendOneOffResult> {
  const to = String(input.to).trim().toLowerCase();
  if (!isNearAccount(to)) throw new Error("recipient is not a valid NEAR wallet address");
  if (to === vault.nearAccount) throw new Error("cannot send to your own wallet");
  const asset = input.asset;
  const base = toBase(asset, input.amount);

  const account = accountFromVault(vault.nearAccount, vault.nearMasterKey);
  const cfg = defaultNearConfig();
  if (asset === "USDC") {
    // USDC.e storage: first USDC activity on a fresh vault needs registration
    // (live storage minimum, idempotent) or the ft_transfer fails.
    await ensureUsdcRegistration(account, cfg);
  }
  const tx =
    asset === "NEAR"
      ? await sendNear(account, to, base)
      : await sendUsdc(account, to, base, cfg);

  const paymentId = recordPayment({
    employerId: input.employerId,
    employeeId: input.employeeId ?? null,
    recipientWallet: to,
    kind: "send",
    asset,
    amount: String(input.amount).trim(),
    note: input.note,
    txRef: tx.txHash || "ok",
    status: "sent",
  });

  return { txHash: tx.txHash || "", status: tx.status ?? "submitted", paymentId };
}
