"use client";

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { setupWalletSelector, actionCreators } from "@near-wallet-selector/core";
import { setupMeteorWallet } from "@near-wallet-selector/meteor-wallet";
import { setupHereWallet } from "@near-wallet-selector/here-wallet";
import type { WalletSelector, Wallet } from "@near-wallet-selector/core";
import type { FinalExecutionOutcome } from "@near-js/types";

/**
 * Wallet popup provider for the payer side (Meteor or HERE, testnet).
 *
 * The payer signs in with their own wallet, then pays the invoice in the exact
 * token it was created with:
 *   NEAR  -> a plain transfer of the yocto amount to the vault.
 *   USDC  -> an ft_transfer function call to the USDC contract.
 *
 * The wallet returns the base64 SignedTransaction that the server hashes and
 * re reads from the chain to confirm the payment, so the payer can not claim a
 * payment that did not actually happen.
 */

type WalletCtx = {
  ready: boolean;
  activeAccount: string | null;
  /** Open the wallet popup (Meteor or HERE) and sign the payer in. */
  signIn: () => Promise<string | null>;
  signOut: () => Promise<void>;
  /** Pay the invoice in its required token. Returns the base64 signed tx. */
  payInvoice: (params: {
    signerId: string;
    vault: string;
    usdcContract: string;
    asset: "NEAR" | "USDC";
    amountBase: string;
    /** Live USDC storage minimum (base yoctoNEAR) from the pay link. */
    usdcRegistration?: string;
  }) => Promise<{ signedTxBase64: string; txHash: string | null }>;
};

const Ctx = createContext<WalletCtx | null>(null);
export function useWallet(): WalletCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useWallet must be used inside <WalletProvider>");
  return c;
}

/**
 * Pick a concrete wallet module id. `sel.wallet()` with no id throws
 * "No wallet selected" until the user has picked one somewhere, so every
 * call site passes the id explicitly. Meteor is preferred (fastest popup),
 * HERE is the fallback; any other available module is a last resort.
 */
function pickWalletId(sel: WalletSelector): string {
  const state = sel.store.getState() as {
    modules?: { id: string; metadata?: { available?: boolean } }[];
  };
  const mods = state.modules ?? [];
  for (const id of ["meteor-wallet", "here-wallet"]) {
    if (mods.some((m) => m.id === id)) return id;
  }
  const fallback = mods.find((m) => m.metadata?.available) ?? mods[0];
  if (!fallback) throw new Error("no wallet is available, reload the page");
  return fallback.id;
}

/** Uint8Array -> base64, safe for large buffers (no call stack overflow). */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

const HEX64 = /^[0-9a-f]{64}$/i;
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,55}$/;

/** base58 (explorer format) -> 64 hex, or null. */
function b58ToHex(s: string): string | null {
  const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = 0n;
  for (const c of s) {
    const i = A.indexOf(c);
    if (i < 0) return null;
    n = n * 58n + BigInt(i);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n % 256n));
    n /= 256n;
  }
  for (const c of s) {
    if (c === "1") bytes.unshift(0);
    else break;
  }
  if (bytes.length !== 32) return null;
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** base64 (some wallets) -> 64 hex, or null. */
function b64ToHex(s: string): string | null {
  try {
    const bytes = Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
    if (bytes.length !== 32) return null;
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

/**
 * Normalize a tx hash string from any encoding we may see (64 hex, base58
 * explorer format, base64) to the canonical 64 hex CryptoHash.
 */
function normalizeHash(s: string): string | null {
  const t = s.trim();
  if (HEX64.test(t)) return t.toLowerCase();
  if (B58.test(t)) return b58ToHex(t);
  if (/^[A-Za-z0-9+/]{40,48}={0,2}$/.test(t)) return b64ToHex(t);
  return null;
}

/**
 * Pull a tx hash out of whatever the user pasted: a raw hash (hex, base58 or
 * base64) or a full explorer URL (the copy button on the explorer page copies
 * the URL, not the hash). Returns canonical 64 hex, or null when there is no
 * recognizable hash.
 */
export function hashFromInput(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  let candidate = t;
  if (/^https?:\/\//i.test(t)) {
    const m = t.match(/\/transactions\/([A-Za-z0-9+/=]+)/i);
    if (!m) return null;
    candidate = m[1];
  }
  return normalizeHash(candidate);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", bytes.buffer as ArrayBuffer);
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Pull the base64 SignedTransaction and the tx hash out of whatever shape the
 * wallet returns. The typed type says `transaction: any`, so wallets vary:
 * some return a base64 string, others a decoded SignedTransaction object with
 * `.encode()`. The wallet's own hash fields vary even more (hex, base58,
 * base64), so when the signed bytes are present we compute the canonical hash
 * ourselves: sha256 of the bytes is always 64 hex.
 */
async function extractTx(outcome: unknown): Promise<{ signedTxBase64: string; txHash: string | null }> {
  const o = outcome as {
    transaction?: string | { encode?: () => Uint8Array };
    transaction_hash?: string;
    transaction_outcome?: { id?: string };
  };
  let signedTxBase64 = "";
  let hashCand: string | null = null;
  const t = o?.transaction;
  if (typeof t === "string") {
    const ts = t.trim();
    // Some wallets put the hash (hex or base58) in `transaction` instead of
    // the signed bytes. A real signed tx is 40+ bytes, so a 32 byte string is
    // a hash, never a transaction.
    if (HEX64.test(ts) || B58.test(ts)) {
      hashCand = ts;
    } else if (ts) {
      signedTxBase64 = ts;
    }
  } else if (t && typeof t.encode === "function") {
    try {
      signedTxBase64 = bytesToBase64(t.encode());
    } catch {
      signedTxBase64 = "";
    }
  }
  if (signedTxBase64) {
    try {
      const bytes = Uint8Array.from(atob(signedTxBase64), (c) => c.charCodeAt(0));
      if (bytes.length >= 40) return { signedTxBase64, txHash: await sha256Hex(bytes) };
      signedTxBase64 = ""; // too short to be a signed tx: treat it as a hash
    } catch {
      signedTxBase64 = "";
    }
  }
  for (const cand of [hashCand, o?.transaction_hash, o?.transaction_outcome?.id]) {
    if (typeof cand === "string") {
      const h = normalizeHash(cand);
      if (h) return { signedTxBase64, txHash: h };
    }
  }
  return { signedTxBase64, txHash: null };
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [activeAccount, setActiveAccount] = useState<string | null>(null);
  const selectorRef = useRef<WalletSelector | null>(null);
  const accountRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const sel = await setupWalletSelector({
        network: "testnet",
        modules: [setupMeteorWallet(), setupHereWallet()],
      });
      if (cancelled) return;
      selectorRef.current = sel;
      const subs: { remove: () => void }[] = [];
      subs.push(sel.on("signedIn", (e) => {
        accountRef.current = e.accounts[0]?.accountId ?? null;
        setActiveAccount(accountRef.current);
      }));
      subs.push(sel.on("signedOut", () => {
        accountRef.current = null;
        setActiveAccount(null);
      }));
      // A previously signed in session may still be stored.
      if (sel.isSignedIn()) {
        try {
          const wallet = await sel.wallet(pickWalletId(sel));
          const accs = await wallet.getAccounts();
          accountRef.current = accs[0]?.accountId ?? null;
          setActiveAccount(accountRef.current);
        } catch {
          /* not signed in after all */
        }
      }
      setReady(true);
      return () => {
        subs.forEach((s) => s.remove());
      };
    })().catch((e) => {
      // The wallet modules may not load in some environments; the page still
      // shows the manual address flow so a payment is never blocked.
      console.error("wallet selector failed to init", e);
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (): Promise<string | null> => {
    const sel = selectorRef.current;
    if (!sel) throw new Error("wallet is still loading, try again");
    const wallet: Wallet = await sel.wallet(pickWalletId(sel));
    let accs: { accountId: string }[] = [];
    try {
      accs = await wallet.getAccounts();
    } catch {
      accs = [];
    }
    if (accs.length > 0) {
      accountRef.current = accs[0].accountId;
      setActiveAccount(accountRef.current);
      return accountRef.current;
    }
    const result = await wallet.signIn({} as never);
    const acc = result?.[0]?.accountId ?? accountRef.current;
    if (acc) {
      accountRef.current = acc;
      setActiveAccount(acc);
    }
    return acc;
  }, []);

  const signOut = useCallback(async () => {
    const sel = selectorRef.current;
    if (!sel) return;
    try {
      const wallet: Wallet = await sel.wallet(pickWalletId(sel));
      await wallet.signOut();
    } catch {
      /* wallet not active */
    }
    accountRef.current = null;
    setActiveAccount(null);
  }, []);

  const payInvoice = useCallback(
    async ({ signerId, vault, usdcContract, asset, amountBase, usdcRegistration }: Parameters<WalletCtx["payInvoice"]>[0]) => {
      const sel = selectorRef.current;
      if (!sel) throw new Error("wallet is still loading, try again");
      const wallet: Wallet = await sel.wallet(pickWalletId(sel));
      const actions =
        asset === "NEAR"
          ? [actionCreators.transfer(BigInt(amountBase))]
          : [
              // One time: register the employer's vault on the USDC contract so
              // it can hold the payment. The deposit is the live storage
              // minimum the pay link read from the contract (the minimum grows
              // as more accounts register, so it must never be hardcoded).
              // Paid by the payer; refunded on chain if the vault already has
              // a record.
              actionCreators.functionCall("storage_deposit", { account_id: vault }, 30_000_000_000_000n, BigInt(usdcRegistration ?? "1250000000000000000000")),
              actionCreators.functionCall("ft_transfer", { receiver_id: vault, amount: amountBase }, 30_000_000_000_000n, 1n),
            ];
      const receiverId = asset === "NEAR" ? vault : usdcContract;
      const outcome = (await wallet.signAndSendTransaction({ signerId, receiverId, actions })) as FinalExecutionOutcome | void;
      if (!outcome) throw new Error("your wallet closed without sending the payment");
      // Normalize whatever the wallet returns to base64 + hash. The server
      // derives the canonical hash from the base64 bytes, so the base64 is the
      // important part; the hash is a fallback for re polling.
      const { signedTxBase64, txHash } = await extractTx(outcome);
      if (!signedTxBase64 && !hashFromInput(txHash ?? "")) {
        throw new Error("your wallet did not return the transaction, open the manual hash box below and paste the hash from your wallet");
      }
      return { signedTxBase64, txHash };
    },
    []
  );

  return (
    <Ctx.Provider value={{ ready, activeAccount, signIn, signOut, payInvoice }}>{children}</Ctx.Provider>
  );
}
