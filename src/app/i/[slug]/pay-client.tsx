"use client";

import { useCallback, useEffect, useState, use } from "react";
import { WalletProvider, useWallet, hashFromInput } from "./wallet";

/**
 * Public pay page: /i/[slug]. No login, mobile first, works from a link in an
 * email. The payer pays the invoice in the exact token it was created with:
 * NEAR (a plain transfer) or USDC (an ft_transfer call). They sign in with a
 * wallet (Meteor or HERE, testnet), approve the payment, and the server reads
 * the chain to confirm the vault was credited before the invoice flips to paid.
 */

type Inv = {
  slug: string;
  clientName: string;
  note: string | null;
  amount: string;
  currency: string;
  asset: "NEAR" | "USDC";
  dueDate: string;
  status: string;
  payerAccount: string | null;
  nearTx: string | null;
  explorerUrl: string | null;
  createdAt: string;
  vault: string | null;
  usdcContract: string | null;
  usdcRegistration?: string | null;
  networkId: string | null;
  amountBase: string | null;
};

export default function PayPage({ params }: { params: Promise<{ slug: string }> }) {
  return (
    <WalletProvider>
      <PayClientInner params={params} />
    </WalletProvider>
  );
}

type PayPhase = "idle" | "working" | "verifying";

function PayClientInner({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const { ready: walletReady, activeAccount, signIn, signOut, payInvoice } = useWallet();

  const [inv, setInv] = useState<Inv | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [phase, setPhase] = useState<PayPhase>("idle");
  const [msg, setMsg] = useState("");
  const [manualHash, setManualHash] = useState("");
  const [manualOn, setManualOn] = useState(false);
  const [payMode, setPayMode] = useState<"wallet" | "none">("wallet");
  const [walletless, setWalletless] = useState<{
    nearAccount: string;
    faucetUrl: string;
    nearFaucetUrl: string;
    balance: { nearYocto: string; usdcBase: string };
  } | null>(null);
  const [wlLoading, setWlLoading] = useState(false);
  const [wlBusy, setWlBusy] = useState(false);
  const [wlMsg, setWlMsg] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/invoices/slug/${slug}`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "not found");
      setInv(d as Inv);
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : String(e));
    }
  }, [slug]);

  useEffect(() => {
    load();
  }, [load]);

  // Keep polling the chain while the invoice is still waiting on a payment.
  // A pending invoice has a tx on record, so poll the status endpoint (the
  // one that re reads the chain); anything else polls the plain view.
  useEffect(() => {
    if (!inv || inv.status === "paid" || inv.status === "void") return;
    const t = setInterval(async () => {
      try {
        const path = inv.status === "pending" ? `/api/invoices/slug/${slug}/status` : `/api/invoices/slug/${slug}`;
        const r = await fetch(path);
        if (!r.ok) return;
        const d = await r.json();
        setInv((old) => (old ? ({ ...old, ...d } as Inv) : (d as Inv)));
      } catch {
        /* network blip, keep polling */
      }
    }, 3000);
    return () => clearInterval(t);
  }, [inv?.status, slug]);

  // Manual re check for a pending invoice: re read the chain right now.
  async function recheck() {
    setMsg("");
    try {
      const r = await fetch(`/api/invoices/slug/${slug}/status`);
      if (!r.ok) return;
      const d = await r.json();
      setInv((old) => (old ? ({ ...old, ...d } as Inv) : (d as Inv)));
      if (d.confirmed) setMsg("payment confirmed on chain");
      else if (d.detail) setMsg(d.detail);
    } catch {
      /* ignore */
    }
  }

  // The manual hash box, shared by the wallet pay card and the pending card.
  function manualHashBox() {
    return (
      <div style={{ marginTop: 12, borderTop: "1px solid var(--color-rule)", paddingTop: 10 }}>
        {!manualOn ? (
          <button style={{ ...linkBtn }} onClick={() => setManualOn(true)}>
            Already sent it? Paste the transaction hash
          </button>
        ) : (
          <div>
            <input
              value={manualHash}
              onChange={(e) => setManualHash(e.target.value)}
              placeholder="NEAR transaction hash or the full explorer link"
              style={input}
              spellCheck={false}
            />
            <button style={{ ...btn, marginTop: 8, background: "var(--color-ink)" }} disabled={phase === "verifying"} onClick={payManual}>
              Check that hash
            </button>
          </div>
        )}
      </div>
    );
  }

  // Walletless mode is remembered across the Google redirect via ?pw=1, so when
  // the customer comes back signed in we load their payment account directly.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("pw") === "1") {
      setPayMode("none");
      loadWalletless();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  // Primary path: open the wallet popup, sign, send, then hand the signed tx
  // to the server so it can prove the vault was credited.
  async function pay() {
    if (!inv || !inv.vault || !inv.amountBase) return;
    setMsg("");
    try {
      let account = activeAccount;
      if (!account) {
        setPhase("working");
        account = await signIn();
        if (!account) throw new Error("sign in with your wallet first");
      }
      setPhase("working");
      const { signedTxBase64, txHash } = await payInvoice({
        signerId: account,
        vault: inv.vault,
        usdcContract: inv.usdcContract ?? "",
        usdcRegistration: inv.usdcRegistration ?? undefined,
        asset: inv.asset,
        amountBase: inv.amountBase,
      });
      setPhase("verifying");
      setMsg("payment broadcast, the chain is confirming it");
      await postClaim({ signedTxBase64, payerAccount: account, txHash: txHash ?? "" });
    } catch (e) {
      setPhase("idle");
      setMsg(e instanceof Error ? e.message : "something went wrong with the wallet");
    }
  }

  // Secondary path: the payer already sent the payment some other way and
  // pastes the transaction hash instead.
  async function payManual() {
    if (!inv) return;
    setMsg("");
    const h = manualHash.trim();
    if (!hashFromInput(h)) {
      setMsg("paste the transaction hash from the NEAR explorer or your wallet (the hash, or the full explorer link)");
      return;
    }
    setPhase("verifying");
    await postClaim({ signedTxBase64: "", payerAccount: activeAccount ?? "", txHash: h });
  }

  async function postClaim(p: { signedTxBase64: string; payerAccount: string; txHash: string }) {
    try {
      const r = await fetch(`/api/invoices/slug/${slug}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(p),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "could not confirm the payment");
      if (d.invoice) setInv(d.invoice as Inv);
      if (d.confirmed) {
        setPhase("idle");
        setMsg("payment confirmed on chain");
      } else {
        setMsg(d.detail || "broadcast, the chain is confirming it");
      }
    } catch (e) {
      setPhase("idle");
      setMsg(e instanceof Error ? e.message : String(e));
    }
  }

  // Walletless payer (2nd option): Google sign in provisions a NEAR account
  // for the customer, they fund it from the faucet, then we send and verify.
  async function loadWalletless() {
    setWlLoading(true);
    setWlMsg("");
    try {
      const r = await fetch("/api/payer/account");
      if (r.status === 401) {
        setWalletless(null);
        return;
      }
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "could not load your payment account");
      setWalletless(d);
    } catch (e) {
      setWlMsg(e instanceof Error ? e.message : "could not load your payment account");
    } finally {
      setWlLoading(false);
    }
  }

  function startWalletlessOAuth() {
    const next = `/i/${slug}?pw=1`;
    window.location.href = `/api/auth/google/start?next=${encodeURIComponent(next)}`;
  }

  async function payWalletless() {
    if (!inv) return;
    setWlBusy(true);
    setWlMsg("");
    try {
      const r = await fetch("/api/payer/pay", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "could not send the payment");
      setWlMsg(d.confirmed ? "payment confirmed on chain" : d.detail || "payment is on its way");
      await load();
    } catch (e) {
      setWlMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setWlBusy(false);
    }
  }

  async function copyAccount() {
    if (!walletless) return;
    try {
      await navigator.clipboard.writeText(walletless.nearAccount);
      setWlMsg("address copied to your clipboard");
    } catch {
      setWlMsg("could not copy, select the address and copy it manually");
    }
  }

  const amt = inv ? Number(inv.amount) : 0;
  const amtStr = Number.isFinite(amt)
    ? amt.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : inv?.amount;
  const paidForGood = inv?.status === "paid";

  if (loadErr) {
    return (
      <Shell>
        <div style={card}>
          <h1 style={{ fontSize: 18, margin: 0 }}>
            {/not found/i.test(loadErr) ? "Invoice not found" : "Not ready yet"}
          </h1>
          <p style={{ color: "var(--color-muted)", margin: "10px 0 0" }}>{loadErr}</p>
        </div>
      </Shell>
    );
  }
  if (!inv) {
    return (
      <Shell>
        <div style={card}>
          <p style={{ color: "var(--color-muted)" }}>Loading invoice…</p>
        </div>
      </Shell>
    );
  }

  const canPay = (inv.status === "open" || inv.status === "refunded") && inv.vault && inv.amountBase;

  return (
    <Shell>
      {/* header */}
      <div style={{ textAlign: "center", marginBottom: 14 }}>
        <div style={{ fontWeight: 700, letterSpacing: "0.02em", fontSize: 13 }}>
          NEARHR<span style={{ color: "var(--color-accent)" }}>®</span>
        </div>
        <div style={{ fontSize: 11.5, color: "var(--color-muted)", marginTop: 2 }}>Invoice payment</div>
      </div>

      {/* amount */}
      <div style={card}>
        <div style={{ fontSize: 12, color: "var(--color-muted)", marginBottom: 4 }}>Amount due</div>
        <div style={{ fontSize: 32, fontWeight: 700, lineHeight: 1.15 }}>
          {amtStr} <span style={{ fontSize: 20, color: "var(--color-accent)" }}>{inv.asset}</span>
        </div>
        <div style={{ fontSize: 12.5, color: "var(--color-muted)", marginTop: 6 }}>
          billed to {inv.clientName} · due {inv.dueDate}
        </div>
        {inv.note && <div style={{ fontSize: 12.5, marginTop: 8, color: "var(--color-ink)", opacity: 0.85 }}>{inv.note}</div>}
      </div>

      {/* paid */}
      {paidForGood && (
        <div style={{ ...card, borderColor: "var(--color-accent)" }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Paid, the funds reached the employer</div>
          <p style={{ fontSize: 12.5, color: "var(--color-muted)", margin: "8px 0 0" }}>
            The exact {inv.amount} {inv.asset} was confirmed on NEAR and delivered to the employer vault. Thanks for paying.
          </p>
          {inv.explorerUrl && (
            <a
              href={inv.explorerUrl}
              target="_blank"
              rel="noreferrer"
              style={{ display: "inline-block", marginTop: 10, fontSize: 12.5, color: "var(--color-accent)", fontWeight: 600 }}
            >
              View on the NEAR explorer ↗
            </a>
          )}
        </div>
      )}

      {/* void */}
      {inv.status === "void" && (
        <div style={card}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>This invoice was closed</div>
          <p style={{ fontSize: 12.5, color: "var(--color-muted)", margin: "8px 0 0" }}>
            It was voided by the employer, so it can no longer be paid.
          </p>
        </div>
      )}

      {/* refunded: money returned, pay again */}
      {inv.status === "refunded" && (
        <div style={{ ...card, border: "1px solid var(--color-accent)", background: "var(--color-accent-soft, var(--color-bg-2))" }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>This invoice was refunded</div>
          <p style={{ fontSize: 12.5, color: "var(--color-muted)", margin: "8px 0 0" }}>
            The employer returned the full amount to your account on chain. If this was your own
            payment account, you can pay the invoice again right now.
          </p>
        </div>
      )}

      {/* paying: choose how to pay */}
      {canPay && (
        <>
          <div style={{ fontSize: 12, color: "var(--color-muted)", margin: "12px 2px 6px" }}>
            This invoice is settled in <b style={{ color: "var(--color-ink)" }}>{inv.asset}</b>. You pay in exactly this token, straight from your wallet.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
            <button
              onClick={() => setPayMode("wallet")}
              style={{
                ...linkBtn,
                background: "none",
                border: `1.5px solid ${payMode === "wallet" ? "var(--color-accent)" : "var(--color-rule)"}`,
                borderRadius: 11,
                padding: "10px 10px",
                textAlign: "left",
                opacity: 1,
                cursor: "pointer",
                fontSize: 12,
              }}
            >
              <div style={{ fontWeight: 700, color: "var(--color-ink)" }}>1 · I have a NEAR wallet</div>
              <div style={{ marginTop: 3, color: "var(--color-muted)", fontSize: 11 }}>
                Pay with Meteor or HERE, straight from your own wallet.
              </div>
            </button>
            <button
              onClick={() => {
                setPayMode("none");
                if (!walletless && !wlLoading) loadWalletless();
              }}
              style={{
                ...linkBtn,
                background: "none",
                border: `1.5px solid ${payMode === "none" ? "var(--color-accent)" : "var(--color-rule)"}`,
                borderRadius: 11,
                padding: "10px 10px",
                textAlign: "left",
                opacity: 1,
                cursor: "pointer",
                fontSize: 12,
              }}
            >
              <div style={{ fontWeight: 700, color: "var(--color-ink)" }}>2 · I don&apos;t have a NEAR wallet</div>
              <div style={{ marginTop: 3, color: "var(--color-muted)", fontSize: 11 }}>
                Sign in with Google, get a payment account and fund it.
              </div>
            </button>
          </div>

          {/* option 1: wallet pay */}
          {payMode === "wallet" && (
            <div style={card}>
              {activeAccount ? (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                  <div style={{ fontSize: 12, color: "var(--color-muted)" }}>
                    paying as <span style={{ fontFamily: "var(--font-geist-mono, monospace)", color: "var(--color-ink)" }}>{activeAccount}</span>
                  </div>
                  <button style={{ ...linkBtn }} onClick={signOut}>
                    switch
                  </button>
                </div>
              ) : (
                <div style={{ fontSize: 12.5, color: "var(--color-muted)", marginBottom: 10 }}>
                  You will be asked to open your wallet (Meteor or HERE) and approve the payment.
                </div>
              )}
              <button style={{ ...btn, opacity: phase !== "idle" || !walletReady ? 0.6 : 1 }} disabled={phase !== "idle" || !walletReady} onClick={pay}>
                {phase === "working"
                  ? "Waiting on your wallet…"
                  : phase === "verifying"
                    ? "Confirming on chain…"
                    : !walletReady
                      ? "Preparing wallet…"
                      : activeAccount
                        ? `Pay ${amtStr} ${inv.asset}`
                        : `Sign in and pay ${amtStr} ${inv.asset}`}
              </button>
              {msg && <div style={{ fontSize: 12, marginTop: 8, color: msg.includes("confirm") || msg.includes("broadcast") ? "var(--color-muted)" : "#d99" }}>{msg}</div>}

              {/* manual hash fallback */}
              {manualHashBox()}
            </div>
          )}

          {/* option 2: walletless pay */}
          {payMode === "none" && (
            <div style={card}>
              <div style={{ fontWeight: 700, fontSize: 13.5 }}>Pay without a NEAR wallet</div>
              <p style={{ fontSize: 12, color: "var(--color-muted)", margin: "7px 0 10px", lineHeight: 1.55 }}>
                Sign in with Google and NearHr sets up a payment account for you. Your email is only
                the sign in method: it does not contain money and does not automatically fund the
                account. You still need to add NEAR or a supported test token to it before paying.
              </p>

              {!walletless && !wlLoading && (
                <button style={btn} onClick={startWalletlessOAuth}>
                  Continue with Google
                </button>
              )}
              {!walletless && wlLoading && (
                <div style={{ fontSize: 12.5, color: "var(--color-muted)", padding: "6px 0" }}>
                  Setting up your payment account…
                </div>
              )}

              {walletless && (
                <>
                  <div style={{ background: "var(--color-bg)", border: "1px solid var(--color-rule)", borderRadius: 10, padding: "10px 11px" }}>
                    <div style={{ fontSize: 10.5, color: "var(--color-muted)", marginBottom: 4 }}>Your payment account</div>
                    <div
                      style={{
                        fontFamily: "var(--font-geist-mono, monospace)",
                        fontSize: 11.5,
                        wordBreak: "break-all",
                        color: "var(--color-ink)",
                      }}
                    >
                      {walletless.nearAccount}
                    </div>
                    <div style={{ display: "flex", gap: 14, marginTop: 8 }}>
                      <button style={{ ...linkBtn, fontSize: 11.5 }} onClick={copyAccount}>
                        Copy address
                      </button>
                      {walletless.faucetUrl && (
                        <a
                          href={walletless.faucetUrl}
                          target="_blank"
                          rel="noreferrer"
                          style={{ fontSize: 11.5, color: "var(--color-accent)", textDecoration: "none", fontWeight: 600 }}
                        >
                          {inv.asset === "USDC" ? "Fund it with USDC at the Circle faucet ↗" : "Fund it at the faucet ↗"}
                        </a>
                      )}
                      {walletless.nearFaucetUrl && inv.asset === "USDC" && (
                        <a
                          href={walletless.nearFaucetUrl}
                          target="_blank"
                          rel="noreferrer"
                          style={{ fontSize: 11.5, color: "var(--color-muted)", textDecoration: "none", fontWeight: 600 }}
                        >
                          a little NEAR for the fee too ↗
                        </a>
                      )}
                    </div>
                    <div style={{ fontSize: 11.5, color: "var(--color-muted)", marginTop: 8 }}>
                      balance: {fmtWl(inv.asset, walletless.balance)}
                    </div>
                  </div>
                  <button
                    style={{ ...btn, marginTop: 10, opacity: wlBusy ? 0.6 : 1 }}
                    disabled={wlBusy}
                    onClick={payWalletless}
                  >
                    {wlBusy
                      ? "Sending the payment…"
                      : `Pay ${amtStr} ${inv.asset} from my account`}
                  </button>
                  {wlMsg && (
                    <div style={{ fontSize: 12, marginTop: 8, color: wlMsg.includes("confirmed") || wlMsg.includes("copied") ? "var(--color-muted)" : "#d99" }}>
                      {wlMsg}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}

      {/* pending: a payment is in flight, the page waits on the chain */}
      {inv.status === "pending" && (
        <div style={card}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>Payment in progress</div>
          <p style={{ fontSize: 12.5, color: "var(--color-muted)", margin: "7px 0 10px", lineHeight: 1.55 }}>
            A payment is linked to this invoice and is being confirmed on chain. If you just
            paid, this page updates on its own in a few seconds.
          </p>
          <button style={{ ...btn, opacity: phase === "verifying" ? 0.6 : 1 }} disabled={phase === "verifying"} onClick={recheck}>
            Check status now
          </button>
          {msg && <div style={{ fontSize: 12, marginTop: 8, color: msg.includes("confirm") ? "var(--color-muted)" : "#d99" }}>{msg}</div>}
          {manualHashBox()}
        </div>
      )}

      {/* vault not ready */}
      {(inv.status === "open" || inv.status === "refunded") && !inv.vault && (
        <div style={card}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>The employer is setting up their vault</div>
          <p style={{ fontSize: 12.5, color: "var(--color-muted)", margin: "8px 0 0" }}>
            This link is ready but the receiving vault is still initializing on NEAR. Wait a few minutes and reload.
          </p>
          <button style={{ ...btn, marginTop: 10 }} onClick={load}>
            Reload
          </button>
        </div>
      )}

      <div style={{ fontSize: 10.5, color: "var(--color-muted)", textAlign: "center", marginTop: 12, opacity: 0.75, lineHeight: 1.5 }}>
        Settled on NEAR · {inv.asset} straight to the employer vault
      </div>
    </Shell>
  );
}

function fmtWl(asset: "NEAR" | "USDC", b: { nearYocto: string; usdcBase: string }): string {
  if (asset === "USDC") {
    const n = Number(b.usdcBase) / 1_000_000;
    return `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })} USDC`;
  }
  const n = Number(BigInt(b.nearYocto) / 10n ** 24n);
  return `${n.toLocaleString("en-US", { maximumFractionDigits: 3 })} NEAR`;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        minHeight: "100dvh",
        background: "var(--color-bg)",
        color: "var(--color-ink)",
        display: "flex",
        justifyContent: "center",
        padding: "28px 16px 40px",
      }}
    >
      <div style={{ width: "100%", maxWidth: 430 }}>{children}</div>
    </div>
  );
}

const card: React.CSSProperties = {
  background: "var(--color-bg-2)",
  border: "1px solid var(--color-rule)",
  borderRadius: 14,
  padding: "14px 15px",
  marginBottom: 10,
};
const btn: React.CSSProperties = {
  width: "100%",
  padding: "12px 14px",
  borderRadius: 11,
  border: "none",
  background: "var(--color-accent)",
  color: "var(--color-bg)",
  fontSize: 13.5,
  fontWeight: 700,
  cursor: "pointer",
};
const input: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "11px 12px",
  borderRadius: 10,
  border: "1px solid var(--color-rule)",
  background: "var(--color-bg)",
  color: "var(--color-ink)",
  fontSize: 12.5,
  outline: "none",
  fontFamily: "var(--font-geist-mono, monospace)",
};
const linkBtn: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "var(--color-accent)",
  cursor: "pointer",
  fontSize: 12,
  padding: 0,
};
