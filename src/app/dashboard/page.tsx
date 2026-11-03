"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

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
      <div className="mono text-base font-bold tracking-tight">
        NEARHR<span className="text-[var(--color-accent)]">®</span>
      </div>
    </div>
  );
}

/* ── deterministic pseudo random (stable per index, no deps) ───────── */
function seeded(seed: number) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}
function buildCandles(points: ChartPoint[]) {
  const n = Math.max(points.length, 1);
  return Array.from({ length: n }, (_, i) => {
    const t = points[i]?.total ?? 0;
    const r1 = seeded(i + 1);
    const r2 = seeded(i + 71);
    const r3 = seeded(i + 149);
    const open = t * (0.95 + 0.1 * r1);
    const close = t * (0.95 + 0.1 * r2);
    const hi = Math.max(open, close) * (1.02 + 0.05 * r3);
    const lo = Math.min(open, close) * (0.98 - 0.05 * r1);
    return { up: close >= open, o: open, c: close, hi, lo };
  });
}

/* ── sparkline (asset cards) ───────────────────────────────────────── */
function Sparkline({ points, color }: { points: number[]; color: string }) {
  const W = 108;
  const H = 40;
  const vals = points.length ? points : [0, 0];
  const max = Math.max(...vals, 1);
  const min = Math.min(...vals, 0);
  const span = max - min || 1;
  const xy = (i: number, v: number) =>
    `${((i / (vals.length - 1 || 1)) * W).toFixed(1)} ${(H - ((v - min) / span) * (H - 4) - 2).toFixed(1)}`;
  const d = vals.map((v, i) => `${i === 0 ? "M" : "L"} ${xy(i, v)}`).join(" ");
  const area = `${d} L ${W} ${H} L 0 ${H} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="spark" aria-hidden>
      <path d={area} fill={color} opacity="0.14" />
      <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ── analytics chart (candlestick, inline SVG, zero deps) ──────────── */
function AnalyticsChart({ points, loading }: { points: ChartPoint[]; loading: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 880;
  const H = 360;
  const P = { l: 44, r: 16, t: 18, b: 30 };
  const iw = W - P.l - P.r;
  const ih = H - P.t - P.b;
  const candles = useMemo(() => buildCandles(points), [points]);
  const max = Math.max(1, ...candles.map((c) => c.hi));
  const min = Math.min(0, ...candles.map((c) => c.lo));
  const span = max - min || 1;
  const n = Math.max(candles.length, 1);
  const x = (i: number) => P.l + (n <= 1 ? iw / 2 : (i / (n - 1)) * (iw - 10) + 5);
  const y = (v: number) => P.t + ih - ((v - min) / span) * ih;
  const cw = Math.max(3, Math.min(14, (iw / n) * 0.55));
  const yTicks = 4;
  const xTickCount = Math.min(6, Math.max(2, n));
  const xIdx = useMemo(() => {
    const out: number[] = [];
    for (let i = 0; i < xTickCount; i++) out.push(Math.round((i / (xTickCount - 1)) * (n - 1)));
    return out;
  }, [n, xTickCount]);
  const fmt = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v >= 10 ? v.toFixed(0) : v.toFixed(2));

  if (loading) return <div className="shimmer h-[360px] w-full" />;
  if (!points.length)
    return (
      <div className="grid h-[360px] place-items-center text-sm text-[var(--color-faint)]">
        No activity yet. Run payroll and the analytics come alive.
      </div>
    );

  return (
    <div className="relative w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: "auto" }} onMouseLeave={() => setHover(null)}>
        {Array.from({ length: yTicks + 1 }).map((_, i) => {
          const v = min + (span / yTicks) * i;
          const yy = y(v);
          return (
            <g key={i}>
              <line x1={P.l} x2={W - P.r} y1={yy} y2={yy} stroke="var(--line-soft)" strokeDasharray="3 4" />
              <text x={P.l - 8} y={yy + 3} textAnchor="end" fill="var(--color-faint)" fontSize="10">
                {fmt(v)}
              </text>
            </g>
          );
        })}
        {candles.map((c, i) => {
          const up = c.up;
          const col = up ? "#22c55e" : "#ef4444";
          const top = Math.min(y(c.o), y(c.c));
          const hgt = Math.max(2, Math.abs(y(c.o) - y(c.c)));
          return (
            <g key={i} opacity={hover == null || hover === i ? 1 : 0.5}>
              <line x1={x(i)} x2={x(i)} y1={y(c.hi)} y2={y(c.lo)} stroke={col} strokeWidth="1.4" />
              <rect x={x(i) - cw / 2} y={top} width={cw} height={hgt} rx="1.5" fill={col} />
            </g>
          );
        })}
        {xIdx.map((i, k) => (
          <text key={k} x={x(i)} y={H - 8} textAnchor="middle" fill="var(--color-faint)" fontSize="10">
            {points[i]?.label}
          </text>
        ))}
        {hover != null && candles[hover] && (
          <line x1={x(hover)} x2={x(hover)} y1={P.t} y2={P.t + ih} stroke="var(--color-accent)" strokeWidth="1" strokeDasharray="3 3" />
        )}
        {candles.map((_, i) => (
          <rect key={i} x={x(i) - iw / (n * 2)} y={P.t} width={iw / n} height={ih} fill="transparent" onMouseEnter={() => setHover(i)} />
        ))}
      </svg>
      {hover != null && candles[hover] && (
        <div
          className="pointer-events-none absolute top-2 z-10 rounded-lg border border-[var(--color-rule)] bg-[#0b0d14] px-3 py-2 text-xs shadow-xl"
          style={{ left: `${Math.min(74, Math.max(2, (x(hover) / W) * 100))}%` }}
        >
          <div className="mb-1 text-[var(--color-faint)]">{points[hover].label}</div>
          <div className="font-semibold">{usd(candles[hover].c)}</div>
          <div className="text-[var(--color-faint)]">
            h {usd(candles[hover].hi)} · l {usd(candles[hover].lo)}
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
  const [network, setNetwork] = useState("mainnet");
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
  const [swapOpen, setSwapOpen] = useState(false);
  const [query, setQuery] = useState("");

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
        <div className="flex flex-col items-center gap-4">
          <div className="coin coin-lime" style={{ width: 56, height: 56, fontSize: 24 }}>
            N
          </div>
          <div className="mono text-sm text-[var(--color-faint)]">{loadErr ? `error: ${loadErr}` : "loading your workspace"}</div>
        </div>
      </main>
    );
  }

  const assetOf = (a: "NEAR" | "USDC") =>
    balance ? balance[a === "NEAR" ? "near" : "usdc"].human : "…";
  const nearAmt = balance ? Number(balance.near.human) : 0;
  const usdcAmt = balance ? Number(balance.usdc.human) : 0;
  const spark = (i: number, k = 26) =>
    Array.from({ length: k }, (_, j) => 50 + 32 * seeded(i * 131 + j * 7) + 14 * Math.sin(j / 2.1 + i));
  const nearChange = change ?? 0;
  const filteredEmps = query
    ? employees.filter((e) =>
        [e.name, e.email ?? "", e.department ?? "", e.wallet, e.jobTitle ?? ""].join(" ").toLowerCase().includes(query.toLowerCase())
      )
    : employees;

  return (
    <main className="min-h-screen overflow-x-clip pb-16">
      {/* left icon rail */}
      <nav className="rail" aria-label="Primary">
        <div className="rail-logo" title="NearHr">N</div>
        <button className="rail-btn active" title="Dashboard" aria-label="Dashboard">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="7" height="7" rx="1.5" />
            <rect x="14" y="3" width="7" height="7" rx="1.5" />
            <rect x="3" y="14" width="7" height="7" rx="1.5" />
            <rect x="14" y="14" width="7" height="7" rx="1.5" />
          </svg>
        </button>
        <button className="rail-btn" title="Wallet" onClick={() => setReceiveOpen(true)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 7h18v12H3z" />
            <path d="M3 7l3-3h12l3 3" />
            <circle cx="16.5" cy="13" r="1.4" fill="currentColor" stroke="none" />
          </svg>
        </button>
        <button className="rail-btn" title="Send" onClick={() => setSendOpen(true)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="2" y="5" width="20" height="14" rx="2.5" />
            <path d="M2 10h20" />
          </svg>
        </button>
        <button className="rail-btn" title="Payroll" onClick={() => setPayrollOpen(true)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
            <path d="M9 8h6M9 12h6" />
          </svg>
        </button>
        <button className="rail-btn" title="Analytics" onClick={() => document.getElementById("analytics")?.scrollIntoView({ behavior: "smooth" })}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
          </svg>
        </button>
        <button className="rail-btn" title="Swap" onClick={() => setSwapOpen(true)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M7 8h13l-3-3M17 16H4l3 3" />
          </svg>
        </button>
        <div className="rail-spacer" />
        <button className="rail-btn" title="Sign out" onClick={signOut}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" />
          </svg>
        </button>
      </nav>

      <div className="rail-main">
        <div className="mx-auto max-w-[1240px] px-5 md:px-8">
          {/* top bar */}
          <div className="topbar">
            <h1 className="text-xl font-bold tracking-tight md:text-2xl">Dashboard</h1>
            <div className="flex items-center gap-3">
              <div className="search-pill">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0">
                  <circle cx="11" cy="11" r="7" />
                  <path d="M21 21l-4.3-4.3" />
                </svg>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search employees, wallets, runs"
                  aria-label="Search"
                />
              </div>
              <button className="icon-btn" onClick={refreshAll} title="Refresh" aria-label="Refresh">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" />
                </svg>
              </button>
              <div className="flex items-center gap-2 rounded-full border border-[var(--color-rule)] bg-[var(--color-bg-2)] py-1 pl-1 pr-3">
                {user.avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={user.avatar} alt="" className="h-7 w-7 rounded-full object-cover" />
                ) : (
                  <div className="grid h-7 w-7 place-items-center rounded-full bg-gradient-to-br from-[#4d65ff] to-[#0082f3] text-xs font-bold text-white">
                    {initials}
                  </div>
                )}
                <span className="hidden max-w-[140px] truncate text-sm font-medium sm:block">{user.name || user.email}</span>
              </div>
            </div>
          </div>

          {/* hero banner */}
          <section className="mt-5">
            <div className="hero-banner fade-up p-6 md:p-8">
              <div className="globe" aria-hidden />
              <img src="/img/hero-payment.svg" alt="Payroll payout flow" className="art hidden md:block" />
              <div className="relative z-10 max-w-[62%]">
                <div className="eyebrow">Welcome back</div>
                <h2 className="mt-2 font-[var(--font-display)] text-2xl font-bold leading-tight tracking-tight text-white md:text-[32px]">
                  Make Your Crypto Transaction Easier
                </h2>
                <p className="mt-3 text-sm text-[#9aa0b4]">Check your daily payroll report</p>
                <div className="mt-5 flex flex-wrap items-center gap-2.5">
                  <button className="btn btn-primary btn-sm" onClick={() => setPayrollOpen(true)}>Run payroll</button>
                  <button className="btn btn-ghost btn-sm !border-white/25 !text-white hover:!border-white/60 hover:!text-white hover:!bg-white/10" onClick={() => setSwapOpen(true)}>
                    Swap NEAR and USDC
                  </button>
                </div>
                <div className="mt-5 flex flex-wrap items-center gap-2 text-sm">
                  {balanceLoading ? (
                    <span className="pill pill-muted pulse-dot">checking on chain</span>
                  ) : balance?.funded ? (
                    <span className="pill pill-green">
                      <span className="h-1.5 w-1.5 bg-[#22c55e]" /> wallet active
                    </span>
                  ) : (
                    <span className="pill pill-warn">
                      <span className="h-1.5 w-1.5 bg-[#f59e0b]" /> fund your wallet to start
                    </span>
                  )}
                  {prices && <span className="mono text-xs text-[#9aa0b4]">1 NEAR = {usd(prices.NEAR)}</span>}
                </div>
              </div>
            </div>
          </section>

        {/* reminder banner */}
        {isEmployer && schedule && (schedule.isOverdue || schedule.reminderWindow) && (
          <div
            className={`fade-up d1 mb-5 flex flex-wrap items-center justify-between gap-3 border px-5 py-3.5 ${
              schedule.isOverdue
                ? "border-[var(--color-danger)] bg-[rgba(191,61,61,0.05)]"
                : "border-[var(--color-warn)] bg-[rgba(154,106,14,0.06)]"
            }`}
          >
            <div className="flex flex-wrap items-center gap-3">
              <span
                className="pill pulse-dot"
                style={
                  schedule.isOverdue
                    ? { borderColor: "var(--color-danger)", color: "var(--color-danger)" }
                    : { borderColor: "var(--color-warn)", color: "var(--color-warn)" }
                }
              >
                {schedule.isOverdue ? "payroll overdue" : `payroll due in ${schedule.daysUntilDue} day${schedule.daysUntilDue === 1 ? "" : "s"}`}
              </span>
              <span className="text-sm text-[var(--color-muted)]">
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
          <div className="fade-up mb-5 border border-[var(--color-danger)] bg-[rgba(191,61,61,0.05)] px-5 py-3 text-sm text-[var(--color-danger)]">
            {loadErr}
          </div>
        )}

        {/* asset stat cards */}
        {isEmployer && (
          <section className="mb-5 grid gap-3 sm:grid-cols-3">
            <div className="stat-card fade-up d1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-faint)]">NEAR</span>
                <div className="coin coin-lime" style={{ width: 34, height: 34, fontSize: 14 }}>
                  N
                </div>
              </div>
              <div className="mt-2 mono text-2xl font-bold tracking-tight">{balanceLoading ? "…" : assetOf("NEAR")}</div>
              <div className="mt-1 flex items-center gap-2 text-xs">
                <span className={`pill ${nearChange >= 0 ? "pill-green" : "pill-danger"}`}>
                  {nearChange >= 0 ? "▲" : "▼"} {Math.abs(nearChange).toFixed(2)}%
                </span>
                <span className="mono text-[var(--color-faint)]">{prices ? `= ${usd(nearAmt * prices.NEAR)}` : "…"}</span>
              </div>
              <Sparkline points={spark(1)} color="#4d65ff" />
            </div>

            <div className="stat-card fade-up d2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-faint)]">USDC.e</span>
                <div className="coin coin-blue" style={{ width: 34, height: 34, fontSize: 14 }}>
                  U
                </div>
              </div>
              <div className="mt-2 mono text-2xl font-bold tracking-tight">{balanceLoading ? "…" : assetOf("USDC")}</div>
              <div className="mt-1 flex items-center gap-2 text-xs">
                <span className="pill pill-muted">stable</span>
                <span className="mono text-[var(--color-faint)]">{prices ? `= ${usd(usdcAmt * prices.USDC)}` : "…"}</span>
              </div>
              <Sparkline points={spark(2)} color="#0082f3" />
            </div>

            <div className="stat-card fade-up d3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-faint)]">Team size</span>
                <div className="coin coin-magenta" style={{ width: 34, height: 34, fontSize: 13 }}>
                  {employees.length}
                </div>
              </div>
              <div className="mt-2 mono text-2xl font-bold tracking-tight">{employees.length}</div>
              <div className="mt-1 text-xs text-[var(--color-faint)]">
                active payees · {payments.filter((p) => p.kind === "payroll" && p.status === "confirmed").length} payroll payouts sent
              </div>
              <Sparkline points={spark(3)} color="#8b5cf6" />
            </div>
          </section>
        )}

        {/* analytics + operations / transactions */}
        {isEmployer && (
          <section id="analytics" className="mb-5 grid gap-4 lg:grid-cols-12">
            <div className="glass fade-up d2 p-5 lg:col-span-8">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="section-title">
                  <span className="mono text-[var(--color-faint)]">A.</span> Analytics
                </div>
                <div className="flex items-center gap-4">
                  <div className="hidden items-center gap-4 text-xs text-[var(--color-muted)] sm:flex">
                    <span className="flex items-center gap-1.5">
                      <span className="h-2 w-2 bg-[#22c55e]" /> up
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="h-2 w-2 bg-[#ef4444]" /> down
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    {([["1m", "day"], ["3m", "week"], ["6m", "month"], ["1y", "year"]] as [string, Range][]).map(([label, r]) => (
                      <button key={r} className={`range-chip ${range === r ? "active" : ""}`} onClick={() => setRange(r)}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <AnalyticsChart points={chart} loading={chartLoading || (balanceLoading && totalUsd == null)} />
            </div>

            <div className="flex flex-col gap-4 lg:col-span-4">
              {/* operations */}
              <div className="glass fade-up d3 p-5">
                <div className="mb-4 section-title">
                  <span className="mono text-[var(--color-faint)]">B.</span> Operations
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <button className="btn btn-primary btn-sm" onClick={() => setPayrollOpen(true)}>New payroll</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setSendOpen(true)}>Send</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setReceiveOpen(true)}>Receive</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setSwapOpen(true)}>Swap</button>
                </div>
                <div className="mt-4 border-t border-[var(--color-rule)] pt-4">
                  <div className="mb-2.5 flex items-center justify-between text-xs text-[var(--color-faint)]">
                    <span className="font-semibold uppercase tracking-wider">Payroll runs</span>
                    <span className="mono">{runs.length}</span>
                  </div>
                  <div className="flex flex-col gap-2">
                    {runs.slice(0, 3).map((r) => {
                      const ok = r.items.filter((it) => it.status === "confirmed").length;
                      const done = ok === r.employee_count && r.status !== "failed";
                      return (
                        <div key={r.id} className="flex items-center justify-between gap-2 text-sm">
                          <span className="mono text-xs text-[var(--color-faint)]">
                            {r.executed_at ? new Date(r.executed_at).toLocaleDateString() : "queued"}
                          </span>
                          <span className="mono">
                            {ok}/{r.employee_count} ok
                          </span>
                          <span className={`pill ${done ? "pill-green" : "pill-warn"}`}>{r.status}</span>
                        </div>
                      );
                    })}
                    {runs.length === 0 && <div className="text-xs text-[var(--color-faint)]">No runs yet.</div>}
                  </div>
                </div>
              </div>

              {/* transactions */}
              <div className="glass fade-up d4 flex-1 p-5">
                <div className="mb-4 section-title">
                  <span className="mono text-[var(--color-faint)]">C.</span> Transactions
                </div>
                <div className="flex flex-col gap-3">
                  {payments.slice(0, 5).map((p) => (
                    <div key={p.id} className="flex items-center gap-3">
                      <div
                        className="grid h-9 w-9 flex-none place-items-center rounded-full text-sm"
                        style={{
                          background:
                            p.status === "confirmed" ? "rgba(34,197,94,0.14)" : p.status === "pending" ? "rgba(245,158,11,0.14)" : "rgba(239,68,68,0.14)",
                          color: p.status === "confirmed" ? "#4ade80" : p.status === "pending" ? "#fbbf24" : "#f87171",
                        }}
                      >
                        {p.kind === "swap" ? "⇄" : p.kind === "payroll" ? "✓" : "↑"}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{p.note || p.recipientName || p.kind}</div>
                        <div className="mono text-[11px] text-[var(--color-faint)]">
                          {shortAddr(p.recipientWallet)} · {fmtDate(p.paidAt)}
                        </div>
                      </div>
                      <div className="mono text-sm font-semibold">
                        {p.amount} <span className="text-xs text-[var(--color-faint)]">{p.asset}</span>
                      </div>
                    </div>
                  ))}
                  {payments.length === 0 && <div className="text-xs text-[var(--color-faint)]">No payments yet. Your activity lands here.</div>}
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

              {filteredEmps.length === 0 ? (
                <div className="grid place-items-center border border-dashed border-[var(--color-rule)] py-12 text-center">
                  <div>
                    <div className="mb-2 mono text-[11px] tracking-widest text-[var(--color-faint)]">DIRECTORY</div>
                    <p className="text-sm text-[var(--color-muted)]">
                      {employees.length === 0
                        ? "No employees yet. Add your first person to track who to pay."
                        : "No employees match your search."}
                    </p>
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
                      {filteredEmps.map((e, i) => (
                        <tr key={e.id}>
                          <td>
                            <div className="flex items-center gap-3">
                              <span className="entry-n w-6">{String(i + 1).padStart(2, "0")}</span>
                              <div>
                                <div className="font-semibold">{e.name}</div>
                                <div className="text-xs text-[var(--color-faint)]">{e.jobTitle || e.email || "no contact"}</div>
                              </div>
                            </div>
                          </td>
                          <td>
                            <span className="pill pill-muted">{e.department || "general"}</span>
                          </td>
                          <td>
                            <span className="mono text-xs">{shortAddr(e.wallet)}</span>
                          </td>
                          <td className="mono">
                            {e.salary} <span className="text-[var(--color-faint)]">{e.asset}</span>
                          </td>
                          <td>
                            {e.lastPaidAt ? (
                              <div>
                                <div className="text-xs font-medium">{fmtDate(e.lastPaidAt)}</div>
                                <div className="mono text-[11px] text-[var(--color-faint)]">
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
                  <div className="grid place-items-center border border-dashed border-[var(--color-rule)] py-10 text-center">
                    <p className="text-sm text-[var(--color-muted)]">No payroll runs yet. Add employees then run payroll to pay the whole team at once.</p>
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
              <div className="grid place-items-center border border-dashed border-[var(--color-rule)] py-10">
                <p className="text-sm text-[var(--color-muted)]">No payments yet. Send crypto or run payroll and it shows up here.</p>
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
      {swapOpen && (
        <SwapModal
          onClose={() => setSwapOpen(false)}
          onDone={() => {
            setSwapOpen(false);
            refreshAll();
          }}
        />
      )}
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
          className={`fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 border px-5 py-3 text-sm font-semibold ${
            toast.kind === "ok" ? "border-[var(--color-ink)] bg-[var(--color-ink)] text-[var(--color-bg)]" : "border-[var(--color-danger)] bg-[var(--color-danger)] text-white"
          }`}
          style={{ animation: "popIn 200ms ease both" }}
        >
          {toast.msg}
        </div>
      )}
        </div>
    </main>
  );
}

/* ── swap modal (NEAR ↔ USDC.e via Ref Finance, mainnet) ────────────── */
function SwapModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [fromAsset, setFromAsset] = useState<"NEAR" | "USDC">("NEAR");
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<{ out: number; minOut: number; rate: number; poolId: number } | null>(null);
  const [quoteErr, setQuoteErr] = useState("");
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    let live = true;
    setQuote(null);
    setQuoteErr("");
    if (!amount || Number(amount) <= 0) return;
    setQuoteLoading(true);
    api(`/api/swap?from=${fromAsset}&amount=${encodeURIComponent(amount)}`)
      .then((d) => {
        if (!live) return;
        setQuote({ out: d.outHuman, minOut: d.minOutHuman, rate: d.rate, poolId: d.poolId });
        setQuoteErr("");
      })
      .catch((e) => {
        if (live) setQuoteErr(e.message || "could not fetch a quote");
      })
      .finally(() => {
        if (live) setQuoteLoading(false);
      });
    return () => {
      live = false;
    };
  }, [fromAsset, amount]);

  async function swap() {
    setBusy(true);
    setResult(null);
    try {
      const d = await api("/api/swap", {
        method: "POST",
        body: JSON.stringify({ from: fromAsset, to: toAsset, amount }),
      });
      setResult({ ok: true, msg: d.message || "swap executed on NEAR mainnet" });
      setTimeout(onDone, 900);
    } catch (e: any) {
      setResult({ ok: false, msg: e.message || "swap failed" });
    } finally {
      setBusy(false);
    }
  }

  const toAsset = fromAsset === "NEAR" ? "USDC" : "NEAR";

  return (
    <Modal title="Swap assets" onClose={onClose}>
      <p className="mb-5 text-sm text-[var(--color-muted)]">
        Swap between NEAR and USDC.e on NEAR mainnet via Ref Finance. Live rate, executed from your wallet.
      </p>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <span className="label">From</span>
          <div className="seg w-full">
            <button className={`${fromAsset === "NEAR" ? "active" : ""}`} style={{ flex: 1 }} onClick={() => setFromAsset("NEAR")}>
              NEAR
            </button>
            <button className={`${fromAsset === "USDC" ? "active" : ""}`} style={{ flex: 1 }} onClick={() => setFromAsset("USDC")}>
              USDC
            </button>
          </div>
        </div>
        <div>
          <span className="label">Amount</span>
          <input className="input mono" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
      </div>

      <div className="my-4 grid place-items-center">
        <button
          className="icon-btn"
          title="Flip direction"
          aria-label="Flip direction"
          onClick={() => setFromAsset(fromAsset === "NEAR" ? "USDC" : "NEAR")}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 3v18M8 15l-4 4 4 4M16 9l4-4-4-4" />
          </svg>
        </button>
      </div>

      <div className="card-2 mb-4 px-4 py-3 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-[var(--color-muted)]">You receive</span>
          <span className="mono font-semibold">
            {quoteLoading ? "…" : quote ? `${quote.out.toFixed(6)} ${toAsset}` : "…"}
          </span>
        </div>
        {quote && (
          <div className="mt-1.5 flex items-center justify-between text-xs text-[var(--color-faint)]">
            <span>
              1 {fromAsset} ≈ {quote.rate.toFixed(4)} {toAsset} · pool #{quote.poolId}
            </span>
            <span>min {quote.minOut.toFixed(6)} {toAsset}</span>
          </div>
        )}
        {quoteErr && <div className="mt-1.5 text-xs text-[var(--color-danger)]">{quoteErr}</div>}
      </div>

      {result && (
        <div
          className={`mb-4 px-4 py-3 text-sm ${
            result.ok ? "border border-[rgba(34,197,94,0.4)] bg-[rgba(34,197,94,0.1)] text-[#4ade80]" : "border border-[var(--color-danger)] bg-[rgba(239,68,68,0.08)] text-[var(--color-danger)]"
          }`}
        >
          {result.msg}
        </div>
      )}

      <button className="btn btn-primary mt-2 w-full" disabled={busy || !quote} onClick={swap}>
        {busy ? "Swapping on mainnet" : `Swap ${amount || ""} ${fromAsset} for ${toAsset}`}
      </button>
    </Modal>
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
        <img src={qr} alt="QR code" className="h-44 w-44 border border-[var(--color-rule)] bg-white p-2" />
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
