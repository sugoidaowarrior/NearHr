/**
 * Privacy layer — wraps @sip-protocol/sdk NEAR stealth addresses.
 *
 * MVP "shielded" model (on-chain, no external dependency):
 *  - Each employee owns a SIP stealth meta address (spending + viewing keys),
 *    generated at onboarding and stored encrypted in their vault.
 *  - For each payroll payment the employer derives a one-time stealth address
 *    for the employee. That stealth address maps to a 64-hex NEAR implicit
 *    account. The employer sends NEAR/USDC to that implicit account.
 *  - The employee, holding only their private keys, "claims" it: they check the
 *    pending stealth addresses against their viewing key, derive the one-time
 *    private key, and sweep the funds to their real account.
 *
 * Levels:
 *  - transparent: pay directly to the employee's NEAR account (fully public).
 *  - shielded:    pay to a one-time stealth implicit account (recipient
 *                 unlinkable; sender visible).
 *  - compliant:   shielded + the employee's viewing key is registered, so the
 *                 employer/auditor can prove a payment was made without
 *                 revealing the employee's account.
 *
 * Upgrade path (full ZK shielded pool): route through NEAR Intents /
 * NEARIntentsAdapter so the amount itself is a Pedersen commitment. That is
 * centralized (SHIELD compliance layer can pause) — see README risk section.
 */
import {
  generateNEARStealthMetaAddress,
  encodeNEARStealthMetaAddress,
  parseNEARStealthMetaAddress,
  generateNEARStealthAddress,
  checkNEARStealthAddress,
  deriveNEARStealthPrivateKey,
} from "@sip-protocol/sdk";

export type PrivacyLevel = "transparent" | "shielded" | "compliant";

export const PRIVACY_LEVELS: PrivacyLevel[] = ["transparent", "shielded", "compliant"];

export type Hex = `0x${string}`;

export interface EmployeeStealth {
  /** Encoded sip:near:<spending>:<viewing> — share this with the employer. */
  metaAddress: string;
  spendingPrivateKey: Hex; // NEVER share
  viewingPrivateKey: Hex; // share only with auditor (compliant)
  label?: string;
}

export interface StealthSend {
  /** 64-hex NEAR implicit account to fund. */
  implicitAccountId: string;
  /** The full stealth address object (store to enable later claim/check). */
  stealthAddress: {
    address: string;
    ephemeralPublicKey: string;
    viewTag: number;
  };
}

export interface StealthClaim {
  /** Private key that can spend from this stealth address. */
  privateKey: string;
  /** The implicit account that held the funds. */
  implicitAccountId: string;
}

export function isPrivacyLevel(v: string): v is PrivacyLevel {
  return (PRIVACY_LEVELS as string[]).includes(v);
}

/** One-time setup per employee. Returns the key material to encrypt into vault. */
export function createEmployeeStealth(label = "payroll"): EmployeeStealth {
  const meta = generateNEARStealthMetaAddress(label);
  return {
    metaAddress: encodeNEARStealthMetaAddress(meta.metaAddress),
    spendingPrivateKey: meta.spendingPrivateKey,
    viewingPrivateKey: meta.viewingPrivateKey,
    label,
  };
}

/**
 * Employer side: derive the one-time receiving account for an employee's
 * meta address. Call once per payment. Funds sent to `implicitAccountId`.
 */
export function derivePayrollDestination(employeeMetaAddress: string): StealthSend {
  const meta = parseNEARStealthMetaAddress(employeeMetaAddress);
  const st = generateNEARStealthAddress(meta);
  return {
    implicitAccountId: st.implicitAccountId,
    stealthAddress: {
      address: st.stealthAddress.address,
      ephemeralPublicKey: st.stealthAddress.ephemeralPublicKey,
      viewTag: st.stealthAddress.viewTag as number,
    },
  };
}

export interface PendingPayment {
  stealthAddress: {
    address: string;
    ephemeralPublicKey: string;
    viewTag: number;
  };
}

/**
 * Employee side: is this pending stealth payment mine?
 * Used to scan for inbound payroll.
 */
export function isMineForEmployee(
  pending: PendingPayment,
  employee: Pick<EmployeeStealth, "viewingPrivateKey" | "metaAddress">
): boolean {
  const meta = parseNEARStealthMetaAddress(employee.metaAddress);
  return checkNEARStealthAddress(
    pending.stealthAddress as never,
    employee.viewingPrivateKey,
    meta.spendingKey
  );
}

/**
 * Employee side: derive the one-time private key to claim a pending payment.
 * Only callable if isMineForEmployee() === true.
 */
export function claimPayment(
  pending: PendingPayment,
  employee: Pick<EmployeeStealth, "spendingPrivateKey" | "viewingPrivateKey" | "metaAddress">
): StealthClaim {
  const meta = parseNEARStealthMetaAddress(employee.metaAddress);
  const rec = deriveNEARStealthPrivateKey(
    pending.stealthAddress as never,
    employee.spendingPrivateKey,
    meta.spendingKey
  );
  return {
    privateKey: (rec as { privateKey: string }).privateKey,
    implicitAccountId: (rec as { stealthAddress: string }).stealthAddress.replace("0x", "").toLowerCase(),
  };
}
