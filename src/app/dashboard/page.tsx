"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type User = { id: string; email: string; name: string; role: string } | null;
type Vault = { nearAccount: string; hasBackup: boolean; backupEmail: string | null } | null;
type Run = {
  id: string;
  name: string;
  asset: string;
  privacy: string;
  status: string;
  employee_count: number;
  total_yocto: string;
  executed_at: string | null;
  items?: { email: string; status: string; amount: string; error: string | null }[];
};

function humanize(amount: string, asset: string): string {
  if (asset === "USDC") {
    const b = BigInt(amount);
    return `${(Number(b) / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC`;
  }
  const b = BigInt(amount);
  const whole = b / 10n ** 24n;
  const frac = (b % 10n ** 24n).toString().padStart(24, "0").slice(0, 6).replace(/0+$/, "");
  return frac ? `${whole}.${frac} NEAR` : `${whole} NEAR`;
}

export default function Dashboard() {
  const router = useRouter();
  const [user, setUser] = useState<User>(null);
  const [vault, setVault] = useState<Vault>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"wallet" | "payroll" | "runs" | "backup">("wallet");

  // wallet state
  const [passphrase, setPassphrase] = useState("");
  const [nearAccount, setNearAccount] = useState("");
  const [backupEmail, setBackupEmail] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [balance, setBalance] = useState<{ human: string; error?: string } | null>(null);

  // payroll state
  const [csv, setCsv] = useState("");
  const [runName, setRunName] = useState("");
  const [asset, setAsset] = useState<"NEAR" | "USDC">("NEAR");
  const [privacy, setPrivacy] = useState<"transparent" | "shielded" | "compliant">("transparent");
  const [preview, setPreview] = useState<{ count: number; errors: string[]; employees: { email: string; name: string; amount: string }[] } | null>(null);

  // runs state
  const [runs, setRuns] = useState<Run[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [execResult, setExecResult] = useState<{ executed: number; failed: number } | null>(null);

  async function load() {
    try {
      const me = await fetch("/api/me").then((r) => r.json());
      if (!me.user) {
        router.push("/login");
        return;
      }
      setUser(me.user);
      const v = await fetch("/api/vault").then((r) => r.json());
      setVault(v.vault);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [router]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  async function createWallet() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/vault", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passphrase, nearAccount }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "failed");
      // record backup intent
      await fetch("/api/vault/backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ backupEmail }),
      });
      setMsg({
        kind: "ok",
        text: "Wallet created. Fund it with " + j.nearAccount + " (testnet faucet or mainnet). Download your backup bundle now.",
      });
      await load();
      setTab("backup");
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function checkBalance() {
    setBusy(true);
    setBalance(null);
    try {
      const r = await fetch("/api/balance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passphrase }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "failed");
      setBalance(j.near ? { human: j.near.human } : { human: "—", error: j.error });
    } catch (e) {
      setBalance({ human: "—", error: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function doPreview() {
    const r = await fetch("/api/payroll/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csv }),
    });
    setPreview(await r.json());
  }

  async function createRun() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/payroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: runName, asset, privacy, csv }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "failed");
      setMsg({ kind: "ok", text: `Run created (${j.count} employees). Find it in the Runs tab.` });
      setCsv("");
      setRunName("");
      setPreview(null);
      setTab("runs");
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function loadRuns() {
    const r = await fetch("/api/payroll/runs");
    const j = await r.json();
    if (r.ok) setRuns(j.runs ?? []);
  }

  useEffect(() => {
    if (tab === "runs" && user?.role === "employer") loadRuns();
  }, [tab, user]);

  async function executeRun(id: string) {
    setBusy(true);
    setExecResult(null);
    try {
      const r = await fetch(`/api/payroll/runs/${id}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passphrase }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "failed");
      setExecResult({ executed: j.executed, failed: j.failed });
      await loadRuns();
    } catch (e) {
      setExecResult(null);
      setMsg({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function openRun(id: string) {
    const r = await fetch(`/api/payroll/runs/${id}`).then((x) => x.json());
    if (r.run) {
      setRunId(id);
      setRuns((prev) => prev.map((x) => (x.id === id ? { ...x, items: r.run.items } : x)));
    }
  }

  function downloadBackup() {
    fetch("/api/vault/backup").then((r) => r.json()).then((j) => {
      const blob = new Blob([JSON.stringify(j.bundle, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `hushpay-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    });
  }

  if (loading) {
    return <main className="min-h-screen bg-zinc-950 text-zinc-400 flex items-center justify-center">Loading…</main>;
  }
  if (!user) return null;

  const tabs: { id: typeof tab; label: string; employerOnly?: boolean }[] = [
    { id: "wallet", label: "Wallet" },
    { id: "payroll", label: "New payroll", employerOnly: true },
    { id: "runs", label: "Runs", employerOnly: true },
    { id: "backup", label: "Backup" },
  ];

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800">
        <div className="mx-auto max-w-5xl px-6 py-4 flex items-center justify-between">
          <div className="font-semibold">
            Hush<span className="text-emerald-400">Pay</span>
            <span className="ml-3 text-xs font-normal text-zinc-500">
              {user.name} · {user.email} · <span className="text-emerald-400/80">{user.role}</span>
            </span>
          </div>
          <div className="flex items-center gap-4">
            <nav className="flex gap-1">
              {tabs
                .filter((t) => !t.employerOnly || user.role === "employer")
                .map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    className={`rounded-lg px-3 py-1.5 text-sm ${
                      tab === t.id ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
            </nav>
            <button onClick={logout} className="text-sm text-zinc-500 hover:text-zinc-300">
              Log out
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-6 py-10">
        {msg && (
          <div
            className={`mb-6 rounded-lg border p-3 text-sm ${
              msg.kind === "ok"
                ? "border-emerald-900 bg-emerald-950/40 text-emerald-200"
                : "border-red-900 bg-red-950/40 text-red-200"
            }`}
          >
            {msg.text}
          </div>
        )}

        {tab === "wallet" && (
          <section className="space-y-6">
            <h2 className="text-xl font-semibold">Wallet</h2>
            {!vault ? (
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6 space-y-4">
                <p className="text-sm text-zinc-400">
                  First time: pick a <strong>backup passphrase</strong> (12+ chars — the only thing
                  that decrypts your keys) and the NEAR account to use.
                </p>
                <div>
                  <label className="text-xs text-zinc-500">Backup passphrase</label>
                  <input
                    type="password"
                    value={passphrase}
                    onChange={(e) => setPassphrase(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
                    placeholder="at least 12 characters"
                  />
                </div>
                <div>
                  <label className="text-xs text-zinc-500">NEAR account id (yours to control)</label>
                  <input
                    value={nearAccount}
                    onChange={(e) => setNearAccount(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
                    placeholder="yourname.near  or  yourname.testnet"
                  />
                  <p className="mt-1 text-xs text-zinc-600">
                    Must already exist and be funded (create one at test.nearwallet.io for testnet).
                  </p>
                </div>
                <div>
                  <label className="text-xs text-zinc-500">Backup email (second Gmail, for recovery)</label>
                  <input
                    value={backupEmail}
                    onChange={(e) => setBackupEmail(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
                    placeholder="backup@gmail.com"
                  />
                </div>
                <button
                  onClick={createWallet}
                  disabled={busy || passphrase.length < 12 || !nearAccount}
                  className="rounded-lg bg-emerald-500 px-5 py-2.5 text-sm font-medium text-zinc-950 disabled:opacity-40 hover:bg-emerald-400"
                >
                  {busy ? "Creating…" : "Create wallet"}
                </button>
              </div>
            ) : (
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6 space-y-4">
                <div className="flex justify-between items-center">
                  <div>
                    <div className="text-xs text-zinc-500">Account</div>
                    <div className="font-mono text-sm">{vault.nearAccount}</div>
                  </div>
                  <div>
                    <div className="text-xs text-zinc-500">NEAR balance</div>
                    <div className="font-mono text-sm">
                      {balance ? (balance.error ? "—" : balance.human) : "—"}
                    </div>
                    {balance?.error && <div className="text-xs text-amber-400/70">{balance.error}</div>}
                  </div>
                </div>
                <div>
                  <label className="text-xs text-zinc-500">Unlock with backup passphrase</label>
                  <div className="mt-1 flex gap-2">
                    <input
                      type="password"
                      value={passphrase}
                      onChange={(e) => setPassphrase(e.target.value)}
                      className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
                      placeholder="passphrase"
                    />
                    <button
                      onClick={checkBalance}
                      disabled={busy}
                      className="rounded-lg border border-zinc-700 px-4 py-2 text-sm hover:border-zinc-500 disabled:opacity-40"
                    >
                      Check
                    </button>
                  </div>
                </div>
                <p className="text-xs text-zinc-600">
                  The passphrase is required to execute payroll (it unlocks your signing key). It
                  never leaves your browser except in this session.
                </p>
              </div>
            )}
          </section>
        )}

        {tab === "payroll" && user.role === "employer" && (
          <section className="space-y-6">
            <h2 className="text-xl font-semibold">New payroll run</h2>
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6 space-y-4">
              <div>
                <label className="text-xs text-zinc-500">CSV — header: email,name,amount,[near_account|stealth_meta],[privacy]</label>
                <textarea
                  value={csv}
                  onChange={(e) => setCsv(e.target.value)}
                  rows={8}
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-xs"
                  placeholder={"email,name,amount,near_account,stealth_meta,privacy\njane@gmail.com,Jane,1500,jane.near,,\njoe@gmail.com,Joe,250,,sip:near:0x..:0x..,shielded"}
                />
                <p className="mt-1 text-xs text-zinc-600">
                  Max 50 rows. Transparent rows need <code>near_account</code>; shielded/compliant
                  rows need <code>stealth_meta</code> (the employee&apos;s sip:near address).
                </p>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-zinc-500">Run name</label>
                  <input
                    value={runName}
                    onChange={(e) => setRunName(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
                    placeholder="October payroll"
                  />
                </div>
                <div>
                  <label className="text-xs text-zinc-500">Asset</label>
                  <select
                    value={asset}
                    onChange={(e) => setAsset(e.target.value as "NEAR" | "USDC")}
                    className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
                  >
                    <option>NEAR</option>
                    <option>USDC</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-zinc-500">Default privacy</label>
                  <select
                    value={privacy}
                    onChange={(e) => setPrivacy(e.target.value as typeof privacy)}
                    className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
                  >
                    <option value="transparent">transparent</option>
                    <option value="shielded">shielded</option>
                    <option value="compliant">compliant</option>
                  </select>
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={doPreview}
                  disabled={!csv.trim()}
                  className="rounded-lg border border-zinc-700 px-4 py-2 text-sm hover:border-zinc-500 disabled:opacity-40"
                >
                  Preview
                </button>
                <button
                  onClick={createRun}
                  disabled={busy || !csv.trim() || !runName}
                  className="rounded-lg bg-emerald-500 px-5 py-2 text-sm font-medium text-zinc-950 disabled:opacity-40 hover:bg-emerald-400"
                >
                  {busy ? "Creating…" : "Create run"}
                </button>
              </div>
              {preview && (
                <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-sm">
                  <div className="mb-2 text-zinc-300">
                    {preview.count} valid rows
                    {preview.errors.length > 0 && (
                      <span className="text-amber-400"> · {preview.errors.length} issue(s)</span>
                    )}
                  </div>
                  {preview.errors.map((e, i) => (
                    <div key={i} className="text-xs text-amber-400/90">{e}</div>
                  ))}
                  <div className="mt-2 max-h-48 overflow-auto">
                    {preview.employees.map((e, i) => (
                      <div key={i} className="flex justify-between border-b border-zinc-900 py-1 text-xs text-zinc-400">
                        <span>{e.name || e.email}</span>
                        <span>{e.email}</span>
                        <span className="font-mono">{e.amount}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {tab === "runs" && user.role === "employer" && (
          <section className="space-y-4">
            <h2 className="text-xl font-semibold">Payroll runs</h2>
            {runs.length === 0 && (
              <p className="text-sm text-zinc-500">No runs yet. Create one in the “New payroll” tab.</p>
            )}
            {runs.map((r) => (
              <div key={r.id} className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">{r.name}</div>
                    <div className="text-xs text-zinc-500">
                      {r.asset} · {r.privacy} · {r.employee_count} people ·{" "}
                      {humanize(r.total_yocto, r.asset)}
                      {r.executed_at && ` · ${r.executed_at}`}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs ${
                        r.status === "done"
                          ? "bg-emerald-950 text-emerald-300"
                          : r.status === "failed"
                          ? "bg-red-950 text-red-300"
                          : r.status === "executing"
                          ? "bg-amber-950 text-amber-300"
                          : "bg-zinc-800 text-zinc-300"
                      }`}
                    >
                      {r.status}
                    </span>
                    {(r.status === "draft" || r.status === "confirmed") && (
                      <button
                        onClick={() => executeRun(r.id)}
                        disabled={busy || !passphrase}
                        className="rounded-lg bg-emerald-500 px-4 py-1.5 text-sm font-medium text-zinc-950 disabled:opacity-40 hover:bg-emerald-400"
                      >
                        Execute
                      </button>
                    )}
                    <button
                      onClick={() => openRun(r.id)}
                      className="text-xs text-zinc-500 hover:text-zinc-300"
                    >
                      {runId === r.id && r.items ? "hide" : "details"}
                    </button>
                  </div>
                </div>
                {runId === r.id && r.items && (
                  <div className="mt-3 max-h-64 overflow-auto rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                    {r.items.map((it, i) => (
                      <div key={i} className="flex justify-between border-b border-zinc-900 py-1 text-xs">
                        <span className="text-zinc-400">{it.email}</span>
                        <span className="font-mono text-zinc-500">{humanize(it.amount, r.asset)}</span>
                        <span
                          className={
                            it.status === "executed"
                              ? "text-emerald-400"
                              : it.status === "failed"
                              ? "text-red-400"
                              : "text-zinc-500"
                          }
                        >
                          {it.status}
                          {it.error ? ` — ${it.error}` : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {execResult && (
              <div
                className={`rounded-lg border p-3 text-sm ${
                  execResult.failed === 0
                    ? "border-emerald-900 bg-emerald-950/40 text-emerald-200"
                    : "border-amber-900 bg-amber-950/40 text-amber-200"
                }`}
              >
                Executed {execResult.executed}, failed {execResult.failed}.
                {execResult.failed > 0 && " Check the run details for errors."}
              </div>
            )}
          </section>
        )}

        {tab === "backup" && (
          <section className="space-y-6">
            <h2 className="text-xl font-semibold">Backup &amp; recovery</h2>
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6 space-y-4">
              <p className="text-sm text-zinc-400">
                Your backup bundle contains the encrypted master key + stealth keys. Send it to
                your backup email (<span className="font-mono">{vault?.backupEmail ?? "set during setup"}</span>)
                and write the passphrase down. Together they recover everything — including
                after device loss.
              </p>
              {vault?.hasBackup ? (
                <button
                  onClick={downloadBackup}
                  className="rounded-lg border border-zinc-700 px-4 py-2 text-sm hover:border-zinc-500"
                >
                  Download backup bundle
                </button>
              ) : (
                <p className="text-xs text-amber-400/80">Create your wallet first, then back it up.</p>
              )}
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-xs text-zinc-500">
                <strong className="text-zinc-400">Restore:</strong> log in with Google → create
                wallet screen → API <code>POST /api/vault/restore</code> with your bundle JSON +
                passphrase. (UI restore lands with the next iteration.)
              </div>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
