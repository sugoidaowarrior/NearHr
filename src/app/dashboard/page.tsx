"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { GlassRing } from "@/components/GlassRing";

/* ── types ──────────────────────────────────────────────────────────── */
type User = { id: string; email: string; name: string | null; avatar: string | null; role: string };
type Balance = {
  nearAccount: string;
  funded: boolean;
  near: { yocto: string; human: string };
  usdc: { base: string; human: string };
};
type Prices = { NEAR: number; USDC: number; source: "live" | "fallback"; at: number };
type Employee = {
  id: string;
  name: string;
  email: string | null;
  department: string | null;
  jobTitle: string | null;
  wallet: string;
  asset: string;
  salary: string;
  frequency: string;
  payDay: number | null;
  status: string;
  lastPaidAt: string | null;
  lastPaidAmount: string | null;
  lastPaidAsset: string | null;
  timesPaid: number;
};
type Payment = {
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
};
type Schedule = {
  frequency: string;
  payDay: number;
  reminderDays: number;
  remindEmail: string | null;
  active: boolean;
  nextDue: string | null;
  isOverdue: boolean;
  daysUntilDue: number | null;
  reminderWindow: boolean;
  dueEmployeeCount: number;
  unpaidEmployeeCount: number;
};
type RunItem = {
  email: string;
  name: string;
  amount: string;
  privacy: string;
  status: string;
  tx_ref: string | null;
  error: string | null;
};
type Run = {
  id: string;
  name: string;
  asset: string;
  privacy: string;
  status: string;
  employee_count: number;
  total_yocto: string;
  near_ref: string | null;
  executed_at: string | null;
  items: RunItem[];
};
type ChartPoint = { label: string; t: number; total: number; invested: number };
type Range = "day" | "week" | "month" | "year";

/* ── helpers ────────────────────────────────────────────────────────── */
function api(path: string, opts?: RequestInit): Promise<any> {
  return fetch(path, { credentials: "include", headers: { "content-type": "application/json" }, ...opts }).then(
    async (r) => {
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `request failed (${r.status})`);
      return data;
    }
  );
}
const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const shortAddr = (a: string) => (a && a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a || "…");
const fmtDate = (s: string | null) => {
  if (!s) return "never";
  const d = new Date(s.includes("T") ? s : s.replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};
/** Unique, always valid email so directory payroll never drops a row. */
const syntheticEmail = (name: string, i: number) =>
  `${(name.replace(/[^a-z0-9]/gi, "").toLowerCase() || "emp")}${i}@payroll.near`;

function Logo({ size = 34 }: { size?: number }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="coin coin-lime" style={{ width: size, height: size, fontSize: size * 0.42 }}>
        N
      </div>
      <div className="text-xl font-extrabold tracking-tight">
        Near<span className="text-[var(--accent)]">Hr</span>
      </div>
    </div>
  );
}

/* ── overview chart (inline SVG, zero deps) ─────────────────────────── */
function OverviewChart({ points, loading }: { points: ChartPoint[]; loading: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const H = 248;
  const P = { l: 46, r: 14, t: 16, b: 26 };
  const iw = W - P.l - P.r;
  const ih = H - P.t - P.b;
  const max = Math.max(1, ...points.map((p) => Math.max(p.total, p.invested)));
  const x = (i: number) => P.l + (points.length <= 1 ? iw / 2 : (i / (points.length - 1)) * iw);
  const y = (v: number) => P.t + ih - (v / max) * ih;
  const linePath = (key: "total" | "invested") =>
    points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p[key]).toFixed(1)}`).join(" ");
  const areaPath = points.length
    ? `${linePath("total")} L ${x(points.length - 1).toFixed(1)} ${(P.t + ih).toFixed(1)} L ${x(0).toFixed(1)} ${(P.t + ih).toFixed(1)} Z`
    : "";
  const yTicks = 4;
  const xTickCount = Math.min(6, Math.max(2, points.length));
  const xIdx = useMemo(() => {
    const out: number[] = [];
    for (let i = 0; i < xTickCount; i++) out.push(Math.round((i / (xTickCount - 1)) * (points.length - 1)));
    return out;
  }, [points.length, xTickCount]);

  if (loading) return <div className="shimmer h-[248px] w-full" />;
  if (!points.length)
    return (
      <div className="grid h-[248px] place-items-center text-sm text-[var(--muted-2)]">
        No activity yet. Run payroll and the curve comes alive.
      </div>
    );

  return (
    <div className="relative w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height: "auto" }}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="totalFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(53,240,106,0.34)" />
            <stop offset="100%" stopColor="rgba(53,240,106,0)" />
          </linearGradient>
        </defs>
        {Array.from({ length: yTicks + 1 }).map((_, i) => {
          const v = (max / yTicks) * i;
          const yy = y(v);
          return (
            <g key={i}>
              <line x1={P.l} x2={W - P.r} y1={yy} y2={yy} stroke="var(--line-soft)" />
              <text x={P.l - 8} y={yy + 3} textAnchor="end" fill="var(--muted-2)" fontSize="10">
                {v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v >= 10 ? v.toFixed(0) : v.toFixed(1)}
              </text>
            </g>
          );
        })}
        <path d={areaPath} fill="url(#totalFill)" />
        <path d={linePath("invested")} fill="none" stroke="rgba(157,177,157,0.5)" strokeWidth="2" strokeDasharray="5 5" strokeLinecap="round" />
        <path d={linePath("total")} fill="none" stroke="var(--accent)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        {hover != null && points[hover] && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={P.t} y2={P.t + ih} stroke="var(--line)" strokeWidth="1" />
            <circle cx={x(hover)} cy={y(points[hover].total)} r="4.5" fill="var(--accent)" />
            <circle cx={x(hover)} cy={y(points[hover].invested)} r="3.5" fill="var(--muted)" />
          </g>
        )}
        {xIdx.map((i, k) => (
          <text key={k} x={x(i)} y={H - 8} textAnchor="middle" fill="var(--muted-2)" fontSize="10">
            {points[i]?.label}
          </text>
        ))}
        {points.map((_, i) => (
          <rect key={i} x={x(i) - iw / (points.length * 2)} y={P.t} width={iw / points.length} height={ih} fill="transparent" onMouseEnter={() => setHover(i)} />
        ))}
      </svg>
      {hover != null && points[hover] && (
        <div
          className="pointer-events-none absolute top-2 z-10 rounded-xl border border-[var(--line)] bg-[#0b1a10]/95 px-3 py-2 text-xs shadow-2xl"
          style={{ left: `${Math.min(78, Math.max(2, (x(hover) / W) * 100))}%` }}
        >
          <div className="mb-1 text-[var(--muted)]">{points[hover].label}</div>
          <div className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-[var(--accent)]" />
            <span className="font-semibold">{usd(points[hover].total)}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-[var(--muted)]" />
            <span>{usd(points[hover].invested)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── generic modal ──────────────────────────────────────────────────── */
function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal-panel ${wide ? "max-w-2xl" : ""}`}>
        <div className="flex items-center justify-between border-b border-[var(--line)] px-6 py-4">
          <h3 className="text-base font-bold">{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

/* ── main ───────────────────────────────────────────────────────────── */
export default function Dashboard() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [booting, setBooting] = useState(true);
  const [network, setNetwork] = useState("testnet");
  const [account, setAccount] = useState<string | null>(null);
  const [prices, setPrices] = useState<Prices | null>(null);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(true);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [range, setRange] = useState<Range>("month");
  const [chart, setChart] = useState<ChartPoint[]>([]);
  const [chartLoading, setChartLoading] = useState(true);
  const [loadErr, setLoadErr] = useState("");

  const [sendOpen, setSendOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [empModal, setEmpModal] = useState<null | { editing: Employee | null }>(null);
  const [payrollOpen, setPayrollOpen] = useState(false);

  const [toast, setToast] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = useCallback((kind: "ok" | "err", msg: string) => {
    setToast({ kind, msg });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4200);
  }, []);

  const isEmployer = user?.role === "employer";

  const loadFast = useCallback(async () => {
    setLoadErr("");
    try {
      const me = await api("/api/me");
      setUser(me.user);
      if (me.user?.role !== "employer") {
        setBooting(false);
        return;
      }
      const [pf, emps, pay, sch, runRes] = await Promise.all([
        api("/api/portfolio").catch(() => null),
        api("/api/employees").catch(() => ({ employees: [] })),
        api("/api/payments").catch(() => ({ payments: [] })),
        api("/api/schedule").catch(() => null),
        api("/api/payroll/runs").catch(() => ({ runs: [] })),
      ]);
      if (pf) {
        setPrices(pf.prices);
        setNetwork(pf.network);
        setAccount(pf.account);
      }
      setEmployees(emps.employees);
      setPayments(pay.payments);
      setSchedule(sch?.schedule ?? null);
      setRuns(runRes.runs);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === "unauthorized") router.replace("/login");
      else setLoadErr(msg);
    } finally {
      setBooting(false);
    }
  }, [router]);

  const loadBalance = useCallback(async (force = false) => {
    setBalanceLoading(true);
    try {
      const b = await api(`/api/balance${force ? "?refresh=1" : ""}`);
      setBalance(b);
      setAccount(b.nearAccount);
    } catch {
      /* balance is non fatal */
    } finally {
      setBalanceLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFast();
    loadBalance();
  }, [loadFast, loadBalance]);

  const totalUsd = useMemo(() => {
    if (!balance || !prices) return null;
    return Number(balance.near.human) * prices.NEAR + Number(balance.usdc.human) * prices.USDC;
  }, [balance, prices]);

  const loadChart = useCallback(async (r: Range, total: number) => {
    setChartLoading(true);
    try {
      const data = await api(`/api/portfolio/chart?range=${r}&total=${total.toFixed(2)}`);
      setChart(data.points);
    } catch {
      setChart([]);
    } finally {
      setChartLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isEmployer && totalUsd != null) loadChart(range, totalUsd);
  }, [isEmployer, totalUsd, range, loadChart]);

  const change = useMemo(() => {
    if (chart.length < 2) return null;
    const first = chart[0].total;
    const last = chart[chart.length - 1].total;
    if (!first) return 0;
    return ((last - first) / first) * 100;
  }, [chart]);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadFast(), loadBalance(true)]);
    notify("ok", "refreshed");
  }, [loadFast, loadBalance, notify]);

  const signOut = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    router.push("/login");
  }, [router]);

  const addEmployee = useCallback(
    async (input: Partial<Employee>) => {
      try {
        const res = await api("/api/employees", { method: "POST", body: JSON.stringify(input) });
        setEmployees((prev) => [res.employee, ...prev]);
        notify("ok", "employee added");
        return true;
      } catch (e) {
        notify("err", e instanceof Error ? e.message : "failed to add");
        return false;
      }
    },
    [notify]
  );
  const updateEmployee = useCallback(
    async (id: string, input: Partial<Employee>) => {
      try {
        const res = await api(`/api/employees/${id}`, { method: "PUT", body: JSON.stringify(input) });
        setEmployees((prev) => prev.map((e) => (e.id === id ? res.employee : e)));
        notify("ok", "employee updated");
        return true;
      } catch (e) {
        notify("err", e instanceof Error ? e.message : "failed to update");
        return false;
      }
    },
    [notify]
  );
  const deleteEmployee = useCallback(
    async (id: string) => {
      try {
        await api(`/api/employees/${id}`, { method: "DELETE" });
        setEmployees((prev) => prev.filter((e) => e.id !== id));
        notify("ok", "employee removed");
      } catch (e) {
        notify("err", e instanceof Error ? e.message : "failed to delete");
      }
    },
    [notify]
  );

  const sendOneOff = useCallback(
    async (input: { to: string; asset: string; amount: string; note?: string; employeeId?: string | null }) => {
      try {
        await api("/api/send", { method: "POST", body: JSON.stringify(input) });
        notify("ok", `sent ${input.amount} ${input.asset} to ${shortAddr(input.to)}`);
        setBalance(null);
        setBalanceLoading(true);
        setTimeout(() => loadBalance(), 1500);
        setTimeout(() => loadFast(), 1800);
        return true;
      } catch (e) {
        notify("err", e instanceof Error ? e.message : "send failed");
        return false;
      }
    },
    [notify, loadBalance, loadFast]
  );

  const runPayrollFromDirectory = useCallback(
    async (asset: string): Promise<boolean> => {
      const rows = employees.filter((e) => e.status === "active" && e.wallet && e.salary && Number(e.salary) > 0);
      if (rows.length === 0) {
        notify("err", "no active employees with a wallet and salary yet");
        return false;
      }
      if (rows.length > 50) {
        notify("err", "max 50 employees per payroll run. trim the roster or split it.");
        return false;
      }
      // Real emails when available so the ledger links to the directory and
      // "last paid" stays accurate; synthetic unique fallback otherwise.
      const used = new Set<string>();
      const emailFor = (e: Employee, i: number) => {
        let m = e.email ? e.email.trim().toLowerCase() : null;
        if (!m || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(m)) m = syntheticEmail(e.name, i);
        let base = m;
        let n = 2;
        while (used.has(m)) m = `${base.split("@")[0]}${n}@${base.split("@")[1] || "payroll.near"}`, n++;
        used.add(m);
        return m;
      };
      const csv =
        "email,name,amount,near_account\n" +
        rows.map((e, i) => `${emailFor(e, i)},"${e.name.replace(/"/g, '""')}",${e.salary},${e.wallet}`).join("\n");
      try {
        const created = await api("/api/payroll", {
          method: "POST",
          body: JSON.stringify({ name: `Payroll ${new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}`, asset, privacy: "transparent", csv }),
        });
        const result = await api(`/api/payroll/runs/${created.runId}/execute`, { method: "POST" });
        notify("ok", `payroll executed: ${result.executed} paid, ${result.failed} failed`);
        await loadFast();
        setBalance(null);
        setBalanceLoading(true);
        setTimeout(() => loadBalance(), 1500);
        return true;
      } catch (e) {
        notify("err", e instanceof Error ? e.message : "payroll failed");
        return false;
      }
    },
    [employees, notify, loadFast, loadBalance]
  );

  const executeRun = useCallback(
    async (id: string) => {
      try {
        const result = await api(`/api/payroll/runs/${id}/execute`, { method: "POST", body: "{}" });
        notify("ok", `run executed: ${result.executed} paid, ${result.failed} failed`);
        await loadFast();
        setBalance(null);
        setBalanceLoading(true);
        setTimeout(() => loadBalance(), 1500);
      } catch (e) {
        notify("err", e instanceof Error ? e.message : "execution failed");
      }
    },
    [notify, loadFast, loadBalance]
  );

  const saveSchedule = useCallback(
    async (input: Partial<Schedule>) => {
      try {
        const res = await api("/api/schedule", { method: "POST", body: JSON.stringify(input) });
        setSchedule(res.schedule);
        notify("ok", "payday schedule saved");
        return true;
      } catch (e) {
        notify("err", e instanceof Error ? e.message : "failed to save");
        return false;
      }
    },
    [notify]
  );

  const remind = useCallback(async () => {
    try {
      await api("/api/schedule/reminder", { method: "POST" });
      notify("ok", "reminder queued to your email");
    } catch (e) {
      notify("err", e instanceof Error ? e.message : "reminder failed");
    }
  }, [notify]);

  const initials = user?.name
    ? user.name.split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase()
    : (user?.email?.[0] ?? "U").toUpperCase();

  if (booting || !user) {
    return (
      <main className="grid min-h-screen place-items-center">
        <div className="aurora" />
        <div className="flex flex-col items-center gap-4">
          <div className="coin coin-lime float" style={{ width: 56, height: 56, fontSize: 24 }}>
            N
          </div>
          <div className="mono text-sm text-[var(--muted)]">{loadErr ? `error: ${loadErr}` : "loading your workspace"}</div>
        </div>
      </main>
    );
  }

  const assetOf = (a: "NEAR" | "USDC") =>
    balance ? balance[a === "NEAR" ? "near" : "usdc"].human : "…";

  return (
    <main className="min-h-screen overflow-x-clip pb-16">
      <div className="aurora" />
      <GlassRing />

      {/* top bar */}
      <header className="sticky top-0 z-30 border-b border-[var(--line-soft)] bg-[var(--background)]/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1280px] items-center justify-between gap-4 px-5 py-3.5 md:px-8">
          <Logo />
          <div className="flex items-center gap-2.5">
            <div className="seg hidden sm:inline-flex">
              <button className={network === "testnet" ? "active" : ""}>Testnet</button>
              <button className={network === "mainnet" ? "active" : ""}>Mainnet</button>
            </div>
            <button className="icon-btn" onClick={refreshAll} title="Refresh" aria-label="Refresh">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" />
              </svg>
            </button>
            <div className="flex items-center gap-2 rounded-full border border-[var(--line)] bg-[rgba(255,255,255,0.04)] py-1 pl-1 pr-3">
              {user.avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={user.avatar} alt="" className="h-7 w-7 rounded-full object-cover" />
              ) : (
                <div className="grid h-7 w-7 place-items-center rounded-full bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)] text-xs font-bold text-[var(--accent-ink)]">
                  {initials}
                </div>
              )}
              <span className="hidden max-w-[140px] truncate text-sm font-medium sm:block">{user.name || user.email}</span>
              <button onClick={signOut} className="text-xs text-[var(--muted-2)] transition hover:text-[var(--danger)]">
                Sign out
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1280px] px-5 pt-6 md:px-8">
        {/* hero */}
        <section className="fade-up mb-5 grid gap-4 lg:grid-cols-12">
          <div className="glow glass sheen hero-card relative overflow-hidden p-6 lg:col-span-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="eyebrow">Portfolio value</div>
                <div className="mt-2 flex flex-wrap items-end gap-3">
                  {totalUsd == null ? (
                    <div className="shimmer h-11 w-56" />
                  ) : (
                    <div className="text-4xl font-extrabold tracking-tight md:text-[44px]">{usd(totalUsd)}</div>
                  )}
                  {change != null && (
                    <div className={`mb-1.5 pill ${change >= 0 ? "pill-green" : "pill-danger"}`}>
                      {change >= 0 ? "▲" : "▼"} {Math.abs(change).toFixed(2)}% this {range}
                    </div>
                  )}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-[var(--muted)]">
                  {balanceLoading ? (
                    <span className="pill pill-muted pulse-dot">checking on chain</span>
                  ) : balance?.funded ? (
                    <span className="pill pill-green">
                      <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" /> wallet active
                    </span>
                  ) : (
                    <span className="pill pill-warn">
                      <span className="h-1.5 w-1.5 rounded-full bg-[var(--warn)]" /> fund your wallet to start
                    </span>
                  )}
                  {prices && <span className="mono text-xs text-[var(--muted-2)]">1 NEAR = {usd(prices.NEAR)}</span>}
                </div>
              </div>
              <div className="coin-stack" aria-hidden>
                <div className="coin coin-lime float" style={{ width: 54, height: 54, fontSize: 22 }}>
                  N
                </div>
                <div className="coin coin-blue float-slow" style={{ width: 44, height: 44, fontSize: 16 }}>
                  U
                </div>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {(["NEAR", "USDC"] as const).map((a) => (
                <div key={a} className="card-2 flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <div className={`coin ${a === "NEAR" ? "coin-lime" : "coin-blue"}`} style={{ width: 30, height: 30, fontSize: 12 }}>
                      {a[0]}
                    </div>
                    <div>
                      <div className="text-xs text-[var(--muted)]">{a}</div>
                      <div className="mono text-sm font-semibold">{assetOf(a)}</div>
                    </div>
                  </div>
                  <div className="mono text-sm text-[var(--muted)]">
                    {balance && prices ? usd(Number(assetOf(a)) * prices[a]) : "…"}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="glass fade-up d2 grid grid-cols-2 gap-3 p-4 lg:col-span-4">
            {[
              { label: "Send", sub: "any wallet", onClick: () => setSendOpen(true), hot: true, dim: false },
              { label: "Receive", sub: "your address", onClick: () => setReceiveOpen(true), hot: false, dim: false },
              { label: "Buy", sub: "coming soon", onClick: () => notify("err", "buying is coming soon"), hot: false, dim: true },
              { label: "Swap", sub: "coming soon", onClick: () => notify("err", "swap is coming soon"), hot: false, dim: true },
            ].map((a) => (
              <button
                key={a.label}
                onClick={a.onClick}
                disabled={a.dim}
                className="group flex flex-col items-start gap-1 rounded-2xl border border-[var(--line)] bg-[rgba(255,255,255,0.03)] px-4 py-4 text-left transition hover:-translate-y-0.5 hover:border-[var(--accent)]/40 hover:bg-[rgba(53,240,106,0.06)] disabled:cursor-not-allowed disabled:opacity-45"
              >
                <span className={`text-base font-bold ${a.hot ? "text-[var(--accent)]" : ""}`}>{a.label}</span>
                <span className="text-xs text-[var(--muted-2)]">{a.sub}</span>
              </button>
            ))}
          </div>
        </section>

        {/* reminder banner */}
        {isEmployer && schedule && (schedule.isOverdue || schedule.reminderWindow) && (
          <div
            className={`fade-up d1 mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-5 py-3.5 ${
              schedule.isOverdue ? "border-[var(--danger)]/40 bg-[rgba(251,113,133,0.08)]" : "border-[var(--warn)]/40 bg-[rgba(251,191,36,0.08)]"
            }`}
          >
            <div className="flex flex-wrap items-center gap-3">
              <span className="pill pulse-dot" style={{ background: "rgba(255,255,255,0.1)" }}>
                {schedule.isOverdue ? "payroll overdue" : `payroll due in ${schedule.daysUntilDue} day${schedule.daysUntilDue === 1 ? "" : "s"}`}
              </span>
              <span className="text-sm text-[var(--muted)]">
                {schedule.dueEmployeeCount} active employees · {schedule.unpaidEmployeeCount} not paid yet
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button className="btn btn-ghost btn-sm" onClick={() => setPayrollOpen(true)}>
                Run payroll
              </button>
              <button className="btn btn-ghost btn-sm" onClick={remind}>
                Email reminder
              </button>
            </div>
          </div>
        )}

        {loadErr && (
          <div className="fade-up mb-5 rounded-2xl border border-[var(--danger)]/40 bg-[rgba(251,113,133,0.08)] px-5 py-3 text-sm text-[var(--danger)]">
            {loadErr}
          </div>
        )}

        {/* chart + tokens */}
        {isEmployer && (
          <section className="mb-5 grid gap-4 lg:grid-cols-12">
            <div className="glass fade-up d2 p-5 lg:col-span-8">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="section-title">Portfolio overview</div>
                <div className="flex items-center gap-4">
                  <div className="hidden items-center gap-4 text-xs text-[var(--muted)] sm:flex">
                    <span className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-[var(--accent)]" /> Total value
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-[var(--muted)]" /> Invested
                    </span>
                  </div>
                  <div className="seg">
                    {(["day", "week", "month", "year"] as Range[]).map((r) => (
                      <button key={r} className={range === r ? "active" : ""} onClick={() => setRange(r)}>
                        {r[0].toUpperCase() + r.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <OverviewChart points={chart} loading={chartLoading || (balanceLoading && totalUsd == null)} />
            </div>

            <div className="glass fade-up d3 p-5 lg:col-span-4">
              <div className="mb-4 section-title">Top tokens and assets</div>
              <div className="flex flex-col gap-2.5">
                {(["NEAR", "USDC"] as const).map((a, i) => {
                  const amount = balance ? Number(balance[a === "NEAR" ? "near" : "usdc"].human) : 0;
                  const val = balance && prices ? amount * prices[a] : 0;
                  const pct = totalUsd ? (val / totalUsd) * 100 : 0;
                  return (
                    <div key={a} className="card-2 flex items-center justify-between px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className={`coin ${a === "NEAR" ? "coin-lime" : "coin-blue"} ${i === 0 ? "float" : "float-slow"}`} style={{ width: 40, height: 40, fontSize: 15 }}>
                          {a[0]}
                        </div>
                        <div>
                          <div className="flex items-center gap-2 text-sm font-semibold">
                            {a} <span className="text-xs font-normal text-[var(--muted-2)]">{a === "NEAR" ? "native" : "stable"}</span>
                          </div>
                          <div className="mono text-xs text-[var(--muted)]">
                            {amount.toFixed(a === "NEAR" ? 4 : 2)} · {pct.toFixed(1)}% of portfolio
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="mono text-sm font-bold">{usd(val)}</div>
                        <div className="mono text-xs text-[var(--muted-2)]">
                          {prices ? usd(prices[a]) : "…"}/{a}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div className="card-2 mt-1 flex items-center justify-between px-4 py-3 text-xs text-[var(--muted)]">
                  <span>Wallet</span>
                  <span className="mono">{account ? shortAddr(account) : "…"}</span>
                </div>
                <div className="card-2 flex items-center justify-between px-4 py-3 text-xs text-[var(--muted)]">
                  <span>Network</span>
                  <span className="capitalize">{network}</span>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* employees + payroll */}
        {isEmployer && (
          <section className="mb-5 grid gap-4 lg:grid-cols-12">
            <div className="glass fade-up d3 p-5 lg:col-span-7">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="section-title">
                  Employees <span className="pill pill-muted">{employees.length}</span>
                </div>
                <button className="btn btn-primary btn-sm" onClick={() => setEmpModal({ editing: null })}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                  Add employee
                </button>
              </div>

              {employees.length === 0 ? (
                <div className="grid place-items-center rounded-2xl border border-dashed border-[var(--line)] py-12 text-center">
                  <div>
                    <div className="mb-2 text-3xl">👥</div>
                    <p className="text-sm text-[var(--muted)]">No employees yet. Add your first person to track who to pay.</p>
                  </div>
                </div>
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Employee</th>
                        <th>Department</th>
                        <th>Wallet</th>
                        <th>Salary</th>
                        <th>Last paid</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {employees.map((e) => (
                        <tr key={e.id}>
                          <td>
                            <div className="font-semibold">{e.name}</div>
                            <div className="text-xs text-[var(--muted-2)]">{e.jobTitle || e.email || "no contact"}</div>
                          </td>
                          <td>
                            <span className="pill pill-muted">{e.department || "general"}</span>
                          </td>
                          <td>
                            <span className="mono text-xs">{shortAddr(e.wallet)}</span>
                          </td>
                          <td className="mono">
                            {e.salary} <span className="text-[var(--muted-2)]">{e.asset}</span>
                          </td>
                          <td>
                            {e.lastPaidAt ? (
                              <div>
                                <div className="text-xs font-medium">{fmtDate(e.lastPaidAt)}</div>
                                <div className="mono text-[11px] text-[var(--muted-2)]">
                                  {e.lastPaidAmount} {e.lastPaidAsset} · {e.timesPaid}× paid
                                </div>
                              </div>
                            ) : (
                              <span className="pill pill-warn">not paid yet</span>
                            )}
                          </td>
                          <td>
                            <div className="flex items-center gap-1">
                              <button className="icon-btn" style={{ width: 30, height: 30 }} onClick={() => setEmpModal({ editing: e })} title="Edit">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
                                </svg>
                              </button>
                              <button className="icon-btn" style={{ width: 30, height: 30 }} onClick={() => deleteEmployee(e.id)} title="Delete">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
                                </svg>
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="glass fade-up d4 flex flex-col p-5 lg:col-span-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="section-title">Payroll</div>
                <button className="btn btn-primary btn-sm" onClick={() => setPayrollOpen(true)}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                    <path d="M5 3l14 9-14 9V3z" />
                  </svg>
                  Run payroll
                </button>
              </div>

              {schedule && (
                <div className="card-2 mb-3 flex items-center justify-between px-4 py-3 text-sm">
                  <div>
                    <div className="text-xs text-[var(--muted-2)]">Payday schedule</div>
                    <div className="font-semibold capitalize">
                      {schedule.frequency} · due {schedule.nextDue}
                      {schedule.remindEmail && (
                        <span className="text-[var(--muted-2)]"> · {schedule.reminderDays}d before</span>
                      )}
                    </div>
                  </div>
                  <button className="btn btn-ghost btn-sm" onClick={() => setPayrollOpen(true)}>
                    Manage
                  </button>
                </div>
              )}

              <div className="flex-1 space-y-2.5 overflow-y-auto pr-1" style={{ maxHeight: 360 }}>
                {runs.length === 0 ? (
                  <div className="grid place-items-center rounded-2xl border border-dashed border-[var(--line)] py-10 text-center">
                    <p className="text-sm text-[var(--muted)]">No payroll runs yet. Add employees then run payroll to pay the whole team at once.</p>
                  </div>
                ) : (
                  runs.map((r) => (
                    <div key={r.id} className="card-2 px-4 py-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-sm font-semibold">{r.name}</div>
                          <div className="text-xs text-[var(--muted-2)]">
                            {r.employee_count} people · {r.asset} · {r.privacy}
                          </div>
                        </div>
                        <span
                          className={`pill ${
                            r.status === "done" || r.status === "executed"
                              ? "pill-green"
                              : r.status === "executing"
                                ? "pill-warn"
                                : r.status === "failed"
                                  ? "pill-danger"
                                  : "pill-muted"
                          }`}
                        >
                          {r.status}
                        </span>
                      </div>
                      {r.status === "draft" && (
                        <button className="btn btn-primary btn-sm mt-3 w-full" onClick={() => executeRun(r.id)}>
                          Execute {r.employee_count} payments
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>
        )}

        {/* activity */}
        {isEmployer && (
          <section className="glass fade-up d5 p-5">
            <div className="mb-4 section-title">Recent activity</div>
            {payments.length === 0 ? (
              <div className="grid place-items-center rounded-2xl border border-dashed border-[var(--line)] py-10">
                <p className="text-sm text-[var(--muted)]">No payments yet. Send crypto or run payroll and it shows up here.</p>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="data-table" style={{ minWidth: 560 }}>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Recipient</th>
                      <th>Type</th>
                      <th>Asset</th>
                      <th className="text-right">Amount</th>
                      <th className="text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.slice(0, 25).map((p) => (
                      <tr key={p.id}>
                        <td className="text-[var(--muted)]">{fmtDate(p.paidAt)}</td>
                        <td>
                          <div className="font-medium">{p.recipientName || shortAddr(p.recipientWallet)}</div>
                          <div className="mono text-[11px] text-[var(--muted-2)]">{shortAddr(p.recipientWallet)}</div>
                        </td>
                        <td>
                          <span className="pill pill-muted">{p.kind === "send" ? "one off" : "payroll"}</span>
                        </td>
                        <td>{p.asset}</td>
                        <td className="mono text-right font-semibold">{p.amount}</td>
                        <td className="text-right">
                          <span className={`pill ${p.status === "sent" ? "pill-green" : p.status === "failed" ? "pill-danger" : "pill-warn"}`}>{p.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* non employer wallet only */}
        {!isEmployer && (
          <section className="glass fade-up d2 p-8 text-center">
            <div className="mb-3 text-3xl">🔐</div>
            <h2 className="text-xl font-bold">Your NearHr wallet</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-[var(--muted)]">
              When your employer runs payroll, your pay lands in this wallet in NEAR or USDC. Share your receiving address with HR to get paid.
            </p>
            <div className="mt-5 flex justify-center">
              <button className="btn btn-primary" onClick={() => setReceiveOpen(true)}>
                Show receive address
              </button>
            </div>
          </section>
        )}

        <p className="mt-6 text-center text-xs text-[var(--muted-2)]">
          NearHr · private payroll on NEAR · keys encrypted at rest, no seed phrase required
        </p>
      </div>

      {/* modals */}
      {sendOpen && <SendModal employees={employees} onClose={() => setSendOpen(false)} onSend={sendOneOff} />}
      {receiveOpen && account && <ReceiveModal address={account} onClose={() => setReceiveOpen(false)} />}
      {empModal && (
        <EmployeeModal
          employee={empModal.editing}
          onClose={() => setEmpModal(null)}
          onSave={async (input) => {
            return empModal.editing ? await updateEmployee(empModal.editing.id, input) : await addEmployee(input);
          }}
        />
      )}
      {payrollOpen && (
        <PayrollModal employees={employees} schedule={schedule} onClose={() => setPayrollOpen(false)} onRun={runPayrollFromDirectory} onSchedule={saveSchedule} />
      )}

      {toast && (
        <div
          className={`fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-full border px-5 py-3 text-sm font-semibold shadow-2xl ${
            toast.kind === "ok" ? "border-[var(--accent)]/40 bg-[#0b1f13] text-[var(--accent)]" : "border-[var(--danger)]/40 bg-[#241015] text-[var(--danger)]"
          }`}
          style={{ animation: "popIn 200ms ease both" }}
        >
          {toast.msg}
        </div>
      )}
    </main>
  );
}

/* ── send modal ─────────────────────────────────────────────────────── */
function SendModal({
  employees,
  onClose,
  onSend,
}: {
  employees: Employee[];
  onClose: () => void;
  onSend: (i: { to: string; asset: string; amount: string; note?: string; employeeId?: string | null }) => Promise<boolean>;
}) {
  const [mode, setMode] = useState<"employee" | "custom">("employee");
  const [empId, setEmpId] = useState("");
  const [to, setTo] = useState("");
  const [asset, setAsset] = useState("NEAR");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const emp = employees.find((e) => e.id === empId);
  const dest = mode === "employee" ? emp?.wallet : to;

  async function submit() {
    if (!dest || !amount) return;
    setBusy(true);
    const ok = await onSend({ to: dest, asset, amount, note: note || undefined, employeeId: mode === "employee" ? empId : null });
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <Modal title="Send crypto" onClose={onClose}>
      <div className="seg mb-5 w-full">
        <button className={`${mode === "employee" ? "active" : ""}`} style={{ flex: 1 }} onClick={() => setMode("employee")}>
          To an employee
        </button>
        <button className={`${mode === "custom" ? "active" : ""}`} style={{ flex: 1 }} onClick={() => setMode("custom")}>
          Any wallet
        </button>
      </div>

      {mode === "employee" ? (
        <Field label="Employee">
          <select className="input" value={empId} onChange={(e) => setEmpId(e.target.value)}>
            <option value="">choose an employee</option>
            {employees.filter((e) => e.status === "active").map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} · {shortAddr(e.wallet)}
              </option>
            ))}
          </select>
        </Field>
      ) : (
        <Field label="NEAR wallet address">
          <input className="input mono" placeholder="alice.near or a 64 char address" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
      )}

      <div className="mt-4 grid grid-cols-2 gap-4">
        <Field label="Asset">
          <div className="seg w-full">
            <button className={`${asset === "NEAR" ? "active" : ""}`} style={{ flex: 1 }} onClick={() => setAsset("NEAR")}>
              NEAR
            </button>
            <button className={`${asset === "USDC" ? "active" : ""}`} style={{ flex: 1 }} onClick={() => setAsset("USDC")}>
              USDC
            </button>
          </div>
        </Field>
        <Field label="Amount">
          <input className="input mono" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
      </div>

      {mode === "employee" && emp && (
        <div className="card-2 mt-4 px-4 py-2.5 text-xs text-[var(--muted)]">
          Salary on file: <span className="mono font-semibold text-[var(--foreground)]">{emp.salary} {emp.asset}</span> · {emp.department || "general"}
        </div>
      )}

      <div className="mt-4">
        <Field label="Note (optional)">
          <input className="input" placeholder="bonus, refund, invoice" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>

      <button className="btn btn-primary mt-6 w-full" disabled={busy || !dest || !amount} onClick={submit}>
        {busy ? "Sending" : `Send ${amount || ""} ${asset}`}
      </button>
    </Modal>
  );
}

/* ── receive modal ──────────────────────────────────────────────────── */
function ReceiveModal({ address, onClose }: { address: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const qr = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(address)}`;
  return (
    <Modal title="Receive" onClose={onClose}>
      <div className="flex flex-col items-center gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qr} alt="QR code" className="h-44 w-44 rounded-2xl border border-[var(--line)] bg-white p-2" />
        <div>
          <div className="eyebrow mb-1">Send NEAR or USDC to this address</div>
          <div className="mono break-all text-center text-sm">{address}</div>
        </div>
        <button
          className="btn btn-ghost"
          onClick={() => {
            navigator.clipboard?.writeText(address);
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
          }}
        >
          {copied ? "copied" : "copy address"}
        </button>
        <p className="text-center text-xs text-[var(--muted-2)]">
          This is your auto created private wallet. NEAR is the native coin and USDC is the stablecoin on the same address.
        </p>
      </div>
    </Modal>
  );
}

/* ── employee modal ─────────────────────────────────────────────────── */
function EmployeeModal({
  employee,
  onClose,
  onSave,
}: {
  employee: Employee | null;
  onClose: () => void;
  onSave: (i: Partial<Employee>) => Promise<boolean>;
}) {
  const [f, setF] = useState({
    name: employee?.name ?? "",
    email: employee?.email ?? "",
    department: employee?.department ?? "",
    jobTitle: employee?.jobTitle ?? "",
    wallet: employee?.wallet ?? "",
    asset: employee?.asset ?? "NEAR",
    salary: employee?.salary ?? "",
    frequency: employee?.frequency ?? "monthly",
    payDay: employee?.payDay ?? 28,
    status: employee?.status ?? "active",
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string | number) => setF((p) => ({ ...p, [k]: v }));

  async function submit() {
    setBusy(true);
    const ok = await onSave({
      name: f.name,
      email: f.email || undefined,
      department: f.department || undefined,
      jobTitle: f.jobTitle || undefined,
      wallet: f.wallet,
      asset: f.asset as "NEAR" | "USDC",
      salary: f.salary,
      frequency: f.frequency as Employee["frequency"],
      payDay: Number(f.payDay) || null,
      status: f.status as Employee["status"],
    });
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <Modal title={employee ? "Edit employee" : "Add employee"} onClose={onClose} wide>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Full name">
          <input className="input" value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Ada Okoye" />
        </Field>
        <Field label="Email">
          <input className="input" value={f.email} onChange={(e) => set("email", e.target.value)} placeholder="ada@company.com" />
        </Field>
        <Field label="Department">
          <input className="input" value={f.department} onChange={(e) => set("department", e.target.value)} placeholder="Engineering" />
        </Field>
        <Field label="Job title">
          <input className="input" value={f.jobTitle} onChange={(e) => set("jobTitle", e.target.value)} placeholder="Frontend Engineer" />
        </Field>
        <div className="sm:col-span-2">
          <Field label="NEAR wallet address">
            <input className="input mono" value={f.wallet} onChange={(e) => set("wallet", e.target.value)} placeholder="ada.near or a 64 char address" />
          </Field>
        </div>
        <Field label="Pay asset">
          <div className="seg w-full">
            <button className={`${f.asset === "NEAR" ? "active" : ""}`} style={{ flex: 1 }} onClick={() => set("asset", "NEAR")}>
              NEAR
            </button>
            <button className={`${f.asset === "USDC" ? "active" : ""}`} style={{ flex: 1 }} onClick={() => set("asset", "USDC")}>
              USDC
            </button>
          </div>
        </Field>
        <Field label="Salary per period">
          <input className="input mono" inputMode="decimal" value={f.salary} onChange={(e) => set("salary", e.target.value)} placeholder="1500" />
        </Field>
        <Field label="Frequency">
          <select className="input" value={f.frequency} onChange={(e) => set("frequency", e.target.value)}>
            <option value="monthly">monthly</option>
            <option value="biweekly">biweekly</option>
            <option value="weekly">weekly</option>
          </select>
        </Field>
        <Field label="Pay day (day of month)">
          <input className="input mono" inputMode="numeric" value={String(f.payDay)} onChange={(e) => set("payDay", e.target.value)} disabled={f.frequency !== "monthly"} />
        </Field>
        <Field label="Status">
          <select className="input" value={f.status} onChange={(e) => set("status", e.target.value)}>
            <option value="active">active</option>
            <option value="offboarded">offboarded</option>
          </select>
        </Field>
      </div>
      <button className="btn btn-primary mt-6 w-full" disabled={busy || !f.name || !f.wallet} onClick={submit}>
        {busy ? "Saving" : employee ? "Save changes" : "Add employee"}
      </button>
    </Modal>
  );
}

/* ── payroll modal ──────────────────────────────────────────────────── */
function PayrollModal({
  employees,
  schedule,
  onClose,
  onRun,
  onSchedule,
}: {
  employees: Employee[];
  schedule: Schedule | null;
  onClose: () => void;
  onRun: (asset: string) => Promise<boolean>;
  onSchedule: (i: Partial<Schedule>) => Promise<boolean>;
}) {
  const [tab, setTab] = useState<"run" | "schedule">("run");
  const [asset, setAsset] = useState("NEAR");
  const [busy, setBusy] = useState(false);
  const [s, setS] = useState({
    frequency: schedule?.frequency ?? "monthly",
    payDay: schedule?.payDay ?? 28,
    reminderDays: schedule?.reminderDays ?? 3,
    remindEmail: schedule?.remindEmail ?? "",
    active: schedule?.active ?? true,
  });
  const [saving, setSaving] = useState(false);

  const eligible = employees.filter((e) => e.status === "active" && e.wallet && e.salary && Number(e.salary) > 0);
  const total = eligible.reduce((sum, e) => sum + Number(e.salary || 0), 0);

  async function run() {
    setBusy(true);
    const ok = await onRun(asset);
    setBusy(false);
    if (ok) onClose();
  }
  async function saveSchedule() {
    setSaving(true);
    const ok = await onSchedule({
      frequency: s.frequency as Schedule["frequency"],
      payDay: Number(s.payDay) || 28,
      reminderDays: Number(s.reminderDays) || 0,
      remindEmail: s.remindEmail || null,
      active: s.active,
    });
    setSaving(false);
    if (ok) onClose();
  }

  return (
    <Modal title="Payroll" onClose={onClose}>
      <div className="seg mb-5 w-full">
        <button className={`${tab === "run" ? "active" : ""}`} style={{ flex: 1 }} onClick={() => setTab("run")}>
          Run payroll
        </button>
        <button className={`${tab === "schedule" ? "active" : ""}`} style={{ flex: 1 }} onClick={() => setTab("schedule")}>
          Payday and reminder
        </button>
      </div>

      {tab === "run" ? (
        <div>
          <div className="card-2 mb-4 px-4 py-3 text-sm">
            <div className="font-semibold">{eligible.length} active employees ready</div>
            <div className="text-xs text-[var(--muted)]">
              total pay {total.toLocaleString()} {asset} · paid to each wallet on chain
            </div>
          </div>
          <Field label="Pay asset">
            <div className="seg w-full">
              <button className={`${asset === "NEAR" ? "active" : ""}`} style={{ flex: 1 }} onClick={() => setAsset("NEAR")}>
                NEAR
              </button>
              <button className={`${asset === "USDC" ? "active" : ""}`} style={{ flex: 1 }} onClick={() => setAsset("USDC")}>
                USDC
              </button>
            </div>
          </Field>
          <p className="mt-4 text-xs leading-relaxed text-[var(--muted-2)]">
            Runs a transparent payroll batch (up to 50) using each employee's saved wallet and salary. Every payout is recorded so last paid stays accurate.
          </p>
          <button className="btn btn-primary mt-5 w-full" disabled={busy || eligible.length === 0} onClick={run}>
            {busy ? "Executing" : `Run payroll for ${eligible.length} employees`}
          </button>
        </div>
      ) : (
        <div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Frequency">
              <select className="input" value={s.frequency} onChange={(e) => setS((p) => ({ ...p, frequency: e.target.value }))}>
                <option value="monthly">monthly</option>
                <option value="biweekly">biweekly</option>
                <option value="weekly">weekly</option>
              </select>
            </Field>
            <Field label="Pay day">
              <input className="input mono" inputMode="numeric" value={String(s.payDay)} onChange={(e) => setS((p) => ({ ...p, payDay: Number(e.target.value) || 28 }))} disabled={s.frequency !== "monthly"} />
            </Field>
            <Field label="Remind N days before">
              <input className="input mono" inputMode="numeric" value={String(s.reminderDays)} onChange={(e) => setS((p) => ({ ...p, reminderDays: Number(e.target.value) || 0 }))} />
            </Field>
            <Field label="Reminder email">
              <input className="input" value={s.remindEmail} onChange={(e) => setS((p) => ({ ...p, remindEmail: e.target.value }))} placeholder="hr@company.com" />
            </Field>
          </div>
          <label className="mt-4 flex items-center gap-3 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={s.active} onChange={(e) => setS((p) => ({ ...p, active: e.target.checked }))} />
            reminders enabled
          </label>
          <p className="mt-4 text-xs leading-relaxed text-[var(--muted-2)]">
            NearHr shows a dashboard banner when payroll falls due and queues a reminder email to the address above.
          </p>
          <button className="btn btn-primary mt-5 w-full" disabled={saving} onClick={saveSchedule}>
            {saving ? "Saving" : "Save schedule"}
          </button>
        </div>
      )}
    </Modal>
  );
}
