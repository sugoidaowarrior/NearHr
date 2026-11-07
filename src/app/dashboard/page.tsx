"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ThemeToggle } from "@/components/theme-toggle";
import { displayAvatar, type PfpStyle } from "@/lib/pfp";
import { NEAR_LOGO, USDC_LOGO } from "@/lib/token-logos";

/* ── types ──────────────────────────────────────────────────────────── */
type User = {
  id: string;
  email: string;
  name: string | null;
  avatar: string | null;
  pfp_style: string | null;
  role: string;
  display_currency?: string;
};
type Balance = {
  nearAccount: string;
  funded: boolean;
  near: { yocto: string; human: string };
  usdc: { base: string; human: string };
};
type Prices = { NEAR: number; USDC: number; NGN: number; EUR: number; source: "live" | "fallback"; at: number };
type Currency = "NGN" | "USD" | "EUR";
type Employee = {
  id: string;
  name: string;
  email: string | null;
  department: string | null;
  jobTitle: string | null;
  avatar: string | null;
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
  status: string;
  tx_ref: string | null;
  error: string | null;
};
type Run = {
  id: string;
  name: string;
  asset: string;
  status: string;
  employee_count: number;
  total_yocto: string;
  near_ref: string | null;
  executed_at: string | null;
  created_at: string;
  items: RunItem[];
};
type SalaryMonth = {
  key: string;
  label: string;
  monthTotal: number;
  monthTotalUsd: number;
  monthPaid: number;
  monthPaidUsd: number;
  paidCount: number;
};
type SalarySummary = {
  nextPayroll: {
    date: string | null;
    dayName: string;
    dayOfMonth: number;
    monthName: string;
    year: number;
    frequency: string;
    daysUntilDue: number | null;
    dueEmployeeCount: number;
    unpaidEmployeeCount: number;
    isOverdue: boolean;
  };
  month: {
    key: string;
    name: string;
    plannedNear: number;
    plannedUsdc: number;
    plannedNgn: number;
    plannedUsd: number;
    paidNear: number;
    paidUsdc: number;
    paidNgn: number;
    paidUsd: number;
    paidCount: number;
  };
  pendingRuns: {
    name: string;
    asset: string;
    status: string;
    employee_count: number;
    total: string;
    created_at: string;
  }[];
  months: SalaryMonth[];
  prices: { NEAR: number; USDC: number; NGN: number; EUR: number };
};

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
const ngn = (n: number) =>
  "₦" + Math.round(n).toLocaleString("en-NG");

/**
 * Currency aware amount formatters. The employer picks NGN/USD/EUR at sign in;
 * every amount widget renders in that currency. NGN keeps the naira symbol,
 * USD and EUR use their standard codes. compact() is for the chart axis (M/K).
 */
function makeFmts(currency: Currency, prices: Prices | null) {
  const isNgn = currency === "NGN";
  const fmt = (n: number) => {
    if (isNgn) return ngn(Math.round(n));
    const code = currency as "USD" | "EUR";
    return n.toLocaleString("en-US", { style: "currency", currency: code, maximumFractionDigits: 0 });
  };
  const compact = (n: number) => {
    const sym = isNgn ? "₦" : currency === "USD" ? "$" : "€";
    if (n >= 1_000_000) return sym + (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
    if (n >= 1000) return sym + (n / 1000).toFixed(1).replace(/\.0$/, "") + "K";
    return sym + Math.round(n);
  };
  // Convert a USD figure into the chosen display currency.
  const fromUsd = (usdVal: number) =>
    isNgn ? usdVal * (prices?.NGN ?? 1500) : currency === "EUR" ? usdVal * (prices?.EUR ?? 0.92) : usdVal;
  return { fmt, compact, fromUsd, isNgn, symbol: isNgn ? "₦" : currency === "USD" ? "$" : "€" };
}
const shortAddr = (a: string) => (a && a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a || "…");
const nameInitials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase() || "?";

const fmtDate = (s: string | null) => {
  if (!s) return "never";
  const d = new Date(s.includes("T") ? s : s.replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};
/** Unique, always valid email so directory payroll never drops a row. */
const syntheticEmail = (name: string, i: number) =>
  `${(name.replace(/[^a-z0-9]/gi, "").toLowerCase() || "emp")}${i}@payroll.near`;

/** Official token mark on a brand tile. Inlined data URLs, never a broken image. */
function TokenIcon({ asset, size = 34 }: { asset: "NEAR" | "USDC"; size?: number }) {
  return (
    <div
      className="coin"
      style={{
        width: size,
        height: size,
        background: asset === "NEAR" ? "linear-gradient(135deg,#4d65ff,#0082f3)" : "#ffffff",
        borderColor: asset === "NEAR" ? "transparent" : "var(--color-rule)",
      }}
    >
      <img
        src={asset === "NEAR" ? NEAR_LOGO : USDC_LOGO}
        alt={asset}
        style={{ width: "62%", height: "62%", objectFit: "contain", display: "block" }}
      />
    </div>
  );
}

function Logo({ size = 34 }: { size?: number }) {
  return (
    <div className="flex items-center gap-2.5">
      <TokenIcon asset="NEAR" size={size} />
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

/* ── payroll bar chart (disbursed vs total, grouped bars) ──────────── */
function PayrollBars({
  months,
  loading,
  currency,
  prices,
}: {
  months: SalaryMonth[];
  loading: boolean;
  currency: Currency;
  prices: Prices | null;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const F = useMemo(() => makeFmts(currency, prices), [currency, prices]);
  const valTotal = (m: SalaryMonth) => F.fromUsd(m.monthTotalUsd);
  const valPaid = (m: SalaryMonth) => F.fromUsd(m.monthPaidUsd);
  const W = 880;
  const H = 360;
  const P = { t: 16, r: 16, b: 30, l: 72 };
  const iw = W - P.l - P.r;
  const ih = H - P.t - P.b;
  const n = Math.max(months.length, 1);
  const max = Math.max(...months.map((m) => Math.max(valTotal(m), valPaid(m))), 1);
  // round the top up to a clean multiple so the axis reads like 1M/2M/3M
  const mag = Math.pow(10, Math.floor(Math.log10(max)));
  const step = mag / 2;
  const top = Math.ceil((max * 1.08) / step) * step;
  const y = (v: number) => P.t + ih - (v / top) * ih;
  const group = iw / n;
  const barW = Math.min(30, group * 0.3);
  const yTicks = 4;
  const compact = (v: number) => F.compact(v);

  if (loading) {
    return (
      <div className="grid h-[360px] place-items-center">
        <div className="pulse-dot text-xs text-[var(--color-faint)]">loading salary history</div>
      </div>
    );
  }

  return (
    <div className="relative w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: "auto" }} onMouseLeave={() => setHover(null)}>
        {Array.from({ length: yTicks + 1 }).map((_, i) => {
          const v = (top / yTicks) * i;
          const yy = y(v);
          return (
            <g key={i}>
              <line x1={P.l} x2={W - P.r} y1={yy} y2={yy} stroke="var(--line-soft)" strokeDasharray="3 4" />
              <text x={P.l - 8} y={yy + 3} textAnchor="end" fill="var(--color-faint)" fontSize="10">
                {compact(v)}
              </text>
            </g>
          );
        })}
        {months.map((m, i) => {
          const cx = P.l + group * i + group / 2;
          const dim = hover == null || hover === i ? 1 : 0.5;
          const totalY = y(valTotal(m));
          const paidY = y(valPaid(m));
          return (
            <g key={i} opacity={dim}>
              {/* total payroll (dark) */}
              <rect x={cx - barW - 3} y={totalY} width={barW} height={Math.max(2, P.t + ih - totalY)} rx="2" fill="#5b6474" />
              {/* disbursed (light blue) */}
              <rect x={cx + 3} y={paidY} width={barW} height={Math.max(2, P.t + ih - paidY)} rx="2" fill="#9db8ff" />
              <text x={cx} y={H - 8} textAnchor="middle" fill="var(--color-faint)" fontSize="10">
                {m.label}
              </text>
              <rect
                x={P.l + group * i}
                y={P.t}
                width={group}
                height={ih}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
              />
            </g>
          );
        })}
        {hover != null && months[hover] && (
          <line x1={P.l + group * hover + group / 2} x2={P.l + group * hover + group / 2} y1={P.t} y2={P.t + ih} stroke="var(--color-accent)" strokeWidth="1" strokeDasharray="3 3" />
        )}
      </svg>
      {hover != null && months[hover] && (
        <div
          className="pointer-events-none absolute top-2 z-10 rounded-lg border border-[var(--color-rule)] bg-[var(--color-bg-2)] px-3 py-2 text-xs shadow-xl"
          style={{ left: `${Math.min(74, Math.max(2, ((P.l + group * hover + group / 2) / W) * 100))}%` }}
        >
          <div className="mb-1 text-[var(--color-faint)]">{months[hover].label}</div>
          <div className="flex items-center gap-1.5 font-semibold">
            <span className="h-2 w-2 bg-[#5b6474]" /> Total payroll {F.fmt(valTotal(months[hover]))}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5">
            <span className="h-2 w-2 bg-[#9db8ff]" /> Disbursed {F.fmt(valPaid(months[hover]))}
          </div>
          <div className="mt-0.5 text-[var(--color-faint)]">{months[hover].paidCount} payment{months[hover].paidCount === 1 ? "" : "s"} sent</div>
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

/* ── profile modal: choose default pfp or upload your own ──────────── */
function ProfileModal({
  user,
  initials,
  onClose,
  onSave,
  onSignedOut,
}: {
  user: User;
  initials: string;
  onClose: () => void;
  onSave: (patch: { avatar?: string | null; pfpStyle?: PfpStyle }) => Promise<boolean>;
  onSignedOut: () => void;
}) {
  const [mode, setMode] = useState<"default" | "image">(user.avatar ? "image" : "default");
  const [style, setStyle] = useState<PfpStyle>(user.pfp_style === "B" ? "B" : "A");
  const [imgPreview, setImgPreview] = useState<string | null>(user.avatar);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const defaultSrcA = useMemo(() => displayAvatar(null, initials, "A"), [initials]);
  const defaultSrcB = useMemo(() => displayAvatar(null, initials, "B"), [initials]);
  const selected =
    mode === "image" && imgPreview
      ? imgPreview
      : style === "B"
        ? defaultSrcB
        : defaultSrcA;
  const unchanged =
    mode === "image"
      ? imgPreview === user.avatar
      : user.avatar === null && style === (user.pfp_style === "B" ? "B" : "A");

  async function pickImage(file: File) {
    setErr("");
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) {
      setErr("Please choose a png, jpeg, webp or gif image.");
      return;
    }
    // Downscale to a 256x256 square so the data URL stays small.
    try {
      const url = URL.createObjectURL(file);
      const img = await new Promise<HTMLImageElement>((res, rej) => {
        const im = new Image();
        im.onload = () => res(im);
        im.onerror = () => rej(new Error("could not read image"));
        im.src = url;
      });
      const size = 256;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas not supported");
      const side = Math.min(img.width, img.height);
      const sx = (img.width - side) / 2;
      const sy = (img.height - side) / 2;
      ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
      URL.revokeObjectURL(url);
      setImgPreview(canvas.toDataURL("image/jpeg", 0.85));
      setMode("image");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "could not read image");
    }
  }

  async function save() {
    setBusy(true);
    setErr("");
    const patch = mode === "image" ? { avatar: imgPreview } : { avatar: null, pfpStyle: style };
    const ok = await onSave(patch);
    setBusy(false);
    if (ok) onClose();
    else setErr("Could not save your profile. Try again.");
  }

  return (
    <Modal title="Your profile" onClose={onClose}>
      <div className="flex flex-col items-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={selected} alt="Profile" className="h-24 w-24 rounded-full object-cover" />
        <div className="mt-4 text-sm font-semibold">{user.name}</div>
        <div className="mono text-xs text-[var(--color-faint)]">{user.email}</div>

        <div className="mt-5 w-full">
          <div className="label mb-2">Default picture</div>
          <div className="flex gap-3">
            {(["A", "B"] as const).map((s) => (
              <button
                key={s}
                onClick={() => {
                  setStyle(s);
                  setMode("default");
                  setErr("");
                }}
                title={`Style ${s}`}
                className={`flex flex-1 flex-col items-center gap-2 rounded-xl border p-3 transition ${
                  mode === "default" && style === s
                    ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]"
                    : "border-[var(--color-rule)] hover:border-[var(--color-accent)]"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={s === "B" ? defaultSrcB : defaultSrcA}
                  alt={`Default picture style ${s}`}
                  className="h-14 w-14 rounded-full object-cover"
                />
                <span className="text-xs font-semibold text-[var(--color-muted)]">Style {s}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 w-full">
          <div className="label mb-2">Or upload from your computer</div>
          <label
            className={`flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-4 text-sm font-semibold transition ${
              mode === "image"
                ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-ink)]"
                : "border-[var(--color-rule)] text-[var(--color-muted)] hover:border-[var(--color-accent)]"
            }`}
          >
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) pickImage(f);
                e.target.value = "";
              }}
            />
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
            {mode === "image" ? "Change image" : "Choose an image (png, jpeg, webp or gif)"}
          </label>
        </div>

        {err && <div className="mt-4 w-full border border-[var(--color-danger)] bg-[rgba(239,68,68,0.08)] p-3 text-xs text-[#f87171]">{err}</div>}

        <div className="mt-6 flex w-full flex-col gap-2">
          <button className="btn btn-primary w-full" disabled={busy || unchanged} onClick={save}>
            {busy ? "Saving" : "Save profile"}
          </button>
          <button className="btn btn-danger w-full" onClick={onSignedOut}>
            Sign out
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ── main ───────────────────────────────────────────────────────────── */
export default function Dashboard() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [booting, setBooting] = useState(true);
  const [account, setAccount] = useState<string | null>(null);
  const [prices, setPrices] = useState<Prices | null>(null);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(true);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [salary, setSalary] = useState<SalarySummary | null>(null);
  const [loadErr, setLoadErr] = useState("");

  const [sendOpen, setSendOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [empModal, setEmpModal] = useState<null | { editing: Employee | null }>(null);
  const [payrollOpen, setPayrollOpen] = useState(false);
  const [invoicesOpen, setInvoicesOpen] = useState(false);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [statementOpen, setStatementOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [currency, setCurrency] = useState<Currency>("NGN");
  const [currencyOpen, setCurrencyOpen] = useState(false);

  const [toast, setToast] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = useCallback((kind: "ok" | "err", msg: string) => {
    setToast({ kind, msg });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4200);
  }, []);

  const isEmployer = !!user;

  // Currency aware formatting for every amount on the page.
  const F = useMemo(() => makeFmts(currency, prices), [currency, prices]);
  const changeCurrency = useCallback(async (c: Currency) => {
    setCurrency(c);
    setCurrencyOpen(false);
    try {
      await api("/api/me", { method: "PATCH", body: JSON.stringify({ currency: c }) });
      notify("ok", `amounts now shown in ${c === "NGN" ? "naira" : c === "USD" ? "dollars" : "euros"}`);
    } catch {
      /* best effort, local state already updated */
    }
  }, [notify]);

  const loadFast = useCallback(async () => {
    setLoadErr("");
    try {
      const me = await api("/api/me");
      setUser(me.user);
      const cur: Currency = (["NGN", "USD", "EUR"].includes(me.user?.display_currency) ? me.user.display_currency : "NGN") as Currency;
      setCurrency(cur);
      // Every user is an HR operator of their own workspace.
      const [pf, emps, pay, sch, runRes, sal] = await Promise.all([
        api("/api/portfolio").catch(() => null),
        api("/api/employees").catch(() => ({ employees: [] })),
        api("/api/payments").catch(() => ({ payments: [] })),
        api("/api/schedule").catch(() => null),
        api("/api/payroll/runs").catch(() => ({ runs: [] })),
        api("/api/payroll/summary").catch(() => null),
      ]);
      if (pf) {
        setPrices(pf.prices);
        setAccount(pf.account);
      }
      setEmployees(emps.employees);
      setPayments(pay.payments);
      setSchedule(sch?.schedule ?? null);
      setRuns(runRes.runs);
      setSalary(sal ?? null);
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

  const loadInvoices = useCallback(async () => {
    try {
      const d = await api("/api/invoices");
      setInvoices(d.invoices ?? []);
    } catch {
      /* invoices are non fatal */
    }
  }, []);

  useEffect(() => {
    loadFast();
    loadBalance();
    loadInvoices();
  }, [loadFast, loadBalance, loadInvoices]);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadFast(), loadBalance(true)]);
    notify("ok", "refreshed");
  }, [loadFast, loadBalance, notify]);

  const signOut = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    router.push("/login");
  }, [router]);

  const saveProfile = useCallback(
    async (patch: { avatar?: string | null; pfpStyle?: PfpStyle }) => {
      try {
        const res = await api("/api/me/avatar", {
          method: "POST",
          body: JSON.stringify(patch),
        });
        setUser((prev) =>
          prev
            ? {
                ...prev,
                avatar: res.avatar ?? prev.avatar,
                pfp_style: res.pfpStyle ?? prev.pfp_style,
              }
            : prev
        );
        return true;
      } catch {
        return false;
      }
    },
    []
  );

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
          body: JSON.stringify({ name: `Payroll ${new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}`, asset, csv }),
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
  const pfpStyle: PfpStyle = user?.pfp_style === "B" ? "B" : "A";
  const avatarSrc = useMemo(
    () => (user ? displayAvatar(user.avatar, initials, pfpStyle) : ""),
    [user, initials, pfpStyle]
  );

  if (booting || !user) {
    return (
      <main className="grid min-h-screen place-items-center">
        <div className="flex flex-col items-center gap-4">
          <TokenIcon asset="NEAR" size={56} />
          <div className="mono text-sm text-[var(--color-faint)]">{loadErr ? `error: ${loadErr}` : "loading your workspace"}</div>
        </div>
      </main>
    );
  }

  const assetOf = (a: "NEAR" | "USDC") => {
    if (!balance) return "…";
    const h = balance[a === "NEAR" ? "near" : "usdc"].human;
    // NEAR arrives with full 24 digit precision; the balance card wants 2 decimals.
    return a === "NEAR" ? Number(h).toFixed(2) : h;
  };
  const nearAmt = balance ? Number(balance.near.human) : 0;
  const usdcAmt = balance ? Number(balance.usdc.human) : 0;
  const spark = (i: number, k = 26) =>
    Array.from({ length: k }, (_, j) => 50 + 32 * seeded(i * 131 + j * 7) + 14 * Math.sin(j / 2.1 + i));
  const filteredEmps = employees.filter((e) => {
    if (!query) return true;
    return [e.name, e.email ?? "", e.department ?? "", e.wallet, e.jobTitle ?? ""]
      .join(" ")
      .toLowerCase()
      .includes(query.toLowerCase());
  });

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
        <button className="rail-btn" title="Invoices" onClick={() => setInvoicesOpen(true)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="4" y="3" width="16" height="18" rx="2" />
            <path d="M8 7h8M8 11h8M8 15h5" />
          </svg>
        </button>
        <button className="rail-btn" title="Payroll statement" onClick={() => setStatementOpen(true)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6M9 13h6M9 17h4" />
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
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/img/nearhr-logo-crop.png" alt="NearHr" className="hidden h-8 w-auto rounded-lg object-contain md:block" />
              <h1 className="text-xl font-bold tracking-tight md:text-2xl">Dashboard</h1>
            </div>
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
              <ThemeToggle compact />
              <div className="relative">
                <button
                  className="flex items-center gap-1 rounded-full border border-[var(--color-rule)] bg-[var(--color-bg-2)] px-3 py-1.5 text-sm font-semibold transition hover:border-[var(--color-accent)]"
                  onClick={() => setCurrencyOpen((v) => !v)}
                  title="Change currency"
                  aria-label="Change currency"
                >
                  <span className="mono">{currency}</span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>
                {currencyOpen && (
                  <div className="fixed inset-0 z-30" onClick={() => setCurrencyOpen(false)} />
                )}
                {currencyOpen && (
                  <div className="absolute right-0 top-full z-40 mt-1 w-44 rounded-xl border border-[var(--color-rule)] bg-[var(--color-bg-2)] p-1 shadow-xl">
                    <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-faint)]">
                      Show amounts in
                    </div>
                    {(["NGN", "USD", "EUR"] as Currency[]).map((c) => (
                      <button
                        key={c}
                        onClick={() => changeCurrency(c)}
                        className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition hover:bg-[var(--color-accent-soft)] ${
                          currency === c ? "text-[var(--color-accent)]" : ""
                        }`}
                      >
                        <span>{c === "NGN" ? "₦ Naira" : c === "USD" ? "$ US Dollar" : "€ Euro"}</span>
                        {currency === c && (
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                            <path d="M20 6L9 17l-5-5" />
                          </svg>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                className="flex items-center gap-2 rounded-full border border-[var(--color-rule)] bg-[var(--color-bg-2)] py-1 pl-1 pr-3 transition hover:border-[var(--color-accent)]"
                onClick={() => setProfileOpen(true)}
                title="Your profile"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={avatarSrc} alt="" className="h-7 w-7 rounded-full object-cover" />
                <span className="hidden max-w-[140px] truncate text-sm font-medium sm:block">{user.name || user.email}</span>
              </button>
            </div>
          </div>

          {/* next payroll + total salary */}
          <section className="mt-5 grid gap-4 lg:grid-cols-3">
            <div className="fade-up rounded-2xl bg-gradient-to-br from-[#4d65ff] to-[#0082f3] p-6 text-white lg:col-span-2">
              <div className="flex items-start gap-4">
                <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-white/15">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <rect x="3" y="4" width="18" height="17" rx="2.5" />
                    <path d="M3 9h18M8 2v4M16 2v4" />
                    <path d="M14.5 13.2a3 3 0 1 0-5 0M9.5 16.5h5" />
                    <circle cx="12" cy="13" r="1.6" fill="currentColor" stroke="none" />
                    <path d="M12 14.6v1.9" />
                  </svg>
                </div>
                <div className="min-w-0">
                  <h2 className="font-[var(--font-display)] text-xl font-bold tracking-tight md:text-2xl">
                    {salary?.nextPayroll.date
                      ? `Next Payroll (${salary.nextPayroll.monthName} ${salary.nextPayroll.dayOfMonth})`
                      : "Next Payroll"}
                  </h2>
                  <p className="mt-1.5 text-sm text-[#dfe6ff]">
                    {salary?.nextPayroll.date
                      ? `Payroll runs automatically before close of business on ${salary.nextPayroll.dayName}, ${salary.nextPayroll.monthName} ${salary.nextPayroll.dayOfMonth}${salary.nextPayroll.year !== new Date().getFullYear() ? `, ${salary.nextPayroll.year}` : ""}.`
                      : "Set a payday schedule to see your next run here."}
                  </p>
                  <div className="mt-4 flex flex-wrap items-center gap-2.5">
                    <button
                      className="btn btn-sm bg-white font-bold text-[#2b3fb8] hover:bg-[#e8edff]"
                      onClick={() => setPayrollOpen(true)}
                    >
                      Run payroll now
                    </button>
                    <button
                      className="btn btn-sm border border-white/40 text-white hover:border-white hover:bg-white/10"
                      onClick={() => setEmpModal({ editing: null })}
                    >
                      Add employee
                    </button>
                    {salary && salary.pendingRuns.length > 0 && (
                      <span className="text-xs text-[#dfe6ff]">
                        {salary.pendingRuns.length} run{salary.pendingRuns.length === 1 ? "" : "s"} waiting to execute
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="fade-up d1 glass flex flex-col justify-center p-6">
              <div className="flex items-center gap-2.5">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 6.5v11M14.8 8.6c-.6-.9-1.6-1.4-2.8-1.4-1.7 0-3 .9-3 2.2 0 2.9 6 1.6 6 4.4 0 1.3-1.3 2.2-3 2.2-1.2 0-2.3-.5-2.9-1.4" />
                  </svg>
                </div>
                <div className="text-xs font-semibold uppercase tracking-wider text-[var(--color-faint)]">
                  Total salary (this month)
                </div>
              </div>
              <div className="mt-3 mono text-3xl font-bold tracking-tight">
                {salary ? (
                  F.fmt(F.fromUsd(salary.month.plannedUsd))
                ) : (
                  "…"
                )}
              </div>
              <div className="mt-2 text-xs text-[var(--color-faint)]">
                {salary
                  ? `${salary.month.plannedNear > 0 ? `${salary.month.plannedNear.toLocaleString()} NEAR` : ""}${
                      salary.month.plannedNear > 0 && salary.month.plannedUsdc > 0 ? " + " : ""
                    }${salary.month.plannedUsdc > 0 ? `${salary.month.plannedUsdc.toLocaleString()} USDC` : ""} · ${salary.month.paidCount} payment${salary.month.paidCount === 1 ? "" : "s"} sent`
                  : "Calculating from active employees"}
              </div>
              {salary && salary.month.paidUsd > 0 && (
                <div className="mt-2 text-xs text-[var(--color-muted)]">
                  {F.fmt(F.fromUsd(salary.month.paidUsd))} already disbursed
                </div>
              )}
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
                <TokenIcon asset="NEAR" />
              </div>
              <div className="mt-2 mono text-2xl font-bold tracking-tight">{balanceLoading ? "…" : assetOf("NEAR")}</div>
              <div className="mt-1 flex items-center gap-2 text-xs">
                <span className="pill pill-muted">native</span>
                <span className="mono text-[var(--color-faint)]">{prices ? `${F.fmt(F.fromUsd(prices.NEAR))} / NEAR · = ${F.fmt(F.fromUsd(nearAmt * prices.NEAR))}` : "…"}</span>
              </div>
              <Sparkline points={spark(1)} color="#4d65ff" />
            </div>

            <div className="stat-card fade-up d2">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--color-faint)]">
                  USDC
                  <span
                    title="USDC on NEAR, a nep141 token with 6 decimals. Clients pay invoices in it and it lands directly in your vault."
                    className="grid h-3.5 w-3.5 cursor-help place-items-center rounded-full border border-[var(--color-rule)] text-[9px] font-bold text-[var(--color-faint)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
                  >
                    ?
                  </span>
                </span>
                <TokenIcon asset="USDC" />
              </div>
              <div className="mt-2 mono text-2xl font-bold tracking-tight">{balanceLoading ? "…" : assetOf("USDC")}</div>
              <div className="mt-1 flex items-center gap-2 text-xs">
                <span className="pill pill-muted">stable</span>
                <span className="mono text-[var(--color-faint)]">{prices ? `${F.fmt(F.fromUsd(prices.USDC))} / USDC · = ${F.fmt(F.fromUsd(usdcAmt * prices.USDC))}` : "…"}</span>
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
                  <span className="mono text-[var(--color-faint)]">A.</span> Salary history
                </div>
                <div className="hidden items-center gap-4 text-xs text-[var(--color-muted)] sm:flex">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-sm bg-[#9db8ff]" /> Disbursed payment
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-sm bg-[#5b6474]" /> Total payroll
                  </span>
                </div>
                <span className="mono text-xs text-[var(--color-faint)]">last 6 paydays</span>
              </div>
              <PayrollBars months={salary?.months ?? []} loading={!salary} currency={currency} prices={prices} />
            </div>

            <div className="flex flex-col gap-4 lg:col-span-4">
              {/* operations */}
              <div className="glass fade-up d3 p-5">
                <div className="mb-4 section-title">
                  <span className="mono text-[var(--color-faint)]">B.</span> Operations
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <button className="btn btn-primary btn-sm col-span-2" onClick={() => setEmpModal({ editing: null })}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                    Add employee
                  </button>
                  <button className="btn btn-primary btn-sm" onClick={() => setPayrollOpen(true)}>New payroll</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setSendOpen(true)}>Send</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setReceiveOpen(true)}>Receive</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setInvoicesOpen(true)}>Invoices</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setStatementOpen(true)}>Statement</button>
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
                            {r.status === "draft"
                              ? `created ${fmtDate(r.created_at)}`
                              : r.executed_at
                                ? fmtDate(r.executed_at)
                                : "queued"}
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
            <div className="glass fade-up d3 flex flex-col p-5 lg:col-span-7">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-[15px] font-bold tracking-tight">Team directory</h3>
                  <p className="mt-0.5 text-xs text-[var(--color-faint)]">
                    {employees.length} {employees.length === 1 ? "person" : "people"}
                  </p>
                </div>
                <div className="flex flex-none flex-col items-end gap-2.5">
                  <button className="btn btn-primary btn-sm" onClick={() => setEmpModal({ editing: null })}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                    Add person
                  </button>
                </div>
              </div>

              <div className="mt-4 flex-1">
                {filteredEmps.length === 0 ? (
                  <div className="grid h-full min-h-[220px] place-items-center border border-dashed border-[var(--color-rule)] px-6 text-center">
                    <div>
                      <div className="mb-2 mono text-[11px] tracking-widest text-[var(--color-faint)]">DIRECTORY</div>
                      <p className="text-sm text-[var(--color-muted)]">
                        {employees.length === 0
                          ? "No people yet. Add your first team member to start tracking paydays."
                          : "No one matches this filter yet."}
                      </p>
                      {employees.length === 0 && (
                        <button className="btn btn-ghost btn-sm mt-4" onClick={() => setEmpModal({ editing: null })}>
                          Add the first person
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3">
                    {filteredEmps.map((e) => {
                      return (
                        <div key={e.id} className="member-card" title={e.name}>
                          <div className="flex items-start justify-between gap-1">
                            <div
                              className="member-ring flex-none"
                              style={{ boxShadow: `0 0 0 2px #4d65ff`, color: "#4d65ff" }}
                            >
                              {e.avatar && e.avatar.startsWith("data:image/") ? (
                                <img src={e.avatar} alt={e.name} className="member-photo" />
                              ) : (
                                <span className="text-[15px] font-extrabold">{nameInitials(e.name)}</span>
                              )}
                            </div>
                          </div>
                          <div className="mt-2.5 min-w-0">
                            <div className="truncate text-[13px] font-semibold">{e.name}</div>
                            <div className="mt-0.5 truncate text-[11px] text-[var(--color-faint)]">
                              {e.jobTitle || e.department || "team member"}
                            </div>
                          </div>
                          <div className="mt-3 flex items-center justify-between gap-1 border-t border-[var(--color-rule)] pt-2.5">
                            <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--color-faint)]">
                              {e.lastPaidAt ? `last paid ${fmtDate(e.lastPaidAt)}` : "not paid yet"}
                            </span>
                            {e.lastPaidAt ? (
                              <span className="mono text-[11px] text-[var(--color-muted)]">
                                {e.timesPaid}
                                <span className="text-[var(--color-faint)]">×</span>
                              </span>
                            ) : (
                              <span className="pill pill-warn" style={{ padding: "2px 7px", fontSize: 9 }}>
                                new
                              </span>
                            )}
                          </div>
                          <div className="mt-2 flex items-center justify-between">
                            <button
                              className="btn btn-ghost btn-sm"
                              style={{ padding: "3px 9px", fontSize: 11 }}
                              onClick={() => setEmpModal({ editing: e })}
                            >
                              Edit
                            </button>
                            <button className="icon-btn" style={{ width: 26, height: 26 }} onClick={() => deleteEmployee(e.id)} title="Remove from directory">
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

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
                            {r.employee_count} people · {r.asset} · created {fmtDate(r.created_at)}
                          </div>
                        </div>
                        <span
                          className={`pill ${
                            r.status === "done" || r.status === "executed"
                              ? "pill-green"
                              : r.status === "executing"
                                ? "pill-warn"
                                : r.status === "partial"
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
      {profileOpen && user && (
        <ProfileModal
          user={user}
          initials={initials}
          onClose={() => setProfileOpen(false)}
          onSave={saveProfile}
          onSignedOut={() => {
            setProfileOpen(false);
            signOut();
          }}
        />
      )}
      {sendOpen && <SendModal employees={employees} onClose={() => setSendOpen(false)} onSend={sendOneOff} />}
      {receiveOpen && account && <ReceiveModal address={account} onClose={() => setReceiveOpen(false)} />}
      {invoicesOpen && (
        <InvoicesModal
          invoices={invoices}
          reload={loadInvoices}
          notify={notify}
          onClose={() => setInvoicesOpen(false)}
        />
      )}
      {statementOpen && <StatementModal onClose={() => setStatementOpen(false)} />}
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

/* ── invoices modal: bill a client, they pay any token on any chain ─── */
const INV_STATUS: Record<string, { label: string; cls: string }> = {
  open: { label: "open", cls: "bg-[var(--color-bg)] text-[var(--color-muted)]" },
  pending: { label: "awaiting deposit", cls: "bg-[var(--color-accent-soft)] text-[var(--color-accent)]" },
  paid: { label: "paid", cls: "bg-[var(--color-accent-soft)] text-[var(--color-accent)]" },
  refunded: { label: "refunded", cls: "bg-[var(--color-bg)] text-[var(--color-muted)]" },
  void: { label: "void", cls: "bg-[var(--color-bg)] text-[var(--color-faint)]" },
};

function InvoicesModal({
  invoices,
  reload,
  notify,
  onClose,
}: {
  invoices: any[];
  reload: () => Promise<void>;
  notify: (kind: "ok" | "err", msg: string) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"list" | "new">("list");
  const [created, setCreated] = useState<any | null>(null);
  const [client, setClient] = useState("");
  const [email, setEmail] = useState("");
  const [amount, setAmount] = useState("");
  const [asset, setAsset] = useState<"USDC" | "NEAR">("USDC");
  const [dueDate, setDueDate] = useState("");
  const [note, setNote] = useState("");
  const [rows, setRows] = useState<{ desc: string; amt: string }[]>([{ desc: "", amt: "" }]);
  const [busy, setBusy] = useState(false);
  const [refundBusy, setRefundBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");

  const amtNum = Number(amount);
  const rowsTotal = rows.reduce((s, r) => {
    const v = Number(r.amt);
    return Number.isFinite(v) ? s + v : s;
  }, 0);

  async function create() {
    setErr("");
    setBusy(true);
    try {
      if (!client.trim()) throw new Error("client name is required");
      if (!Number.isFinite(amtNum) || amtNum <= 0) throw new Error("amount must be above zero");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) throw new Error("due date is required");
      const r = await fetch("/api/invoices", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_name: client.trim(),
          client_email: email.trim() || null,
          note: note.trim() || null,
          amount: amtNum.toFixed(2),
          due_date: dueDate,
          asset,
          items: rows
            .map((row) => ({ description: row.desc.trim(), amount: row.amt.trim() }))
            .filter((row) => row.description && row.amount)
            .map((row) => ({ ...row, amount: Number(row.amount).toFixed(2) })),
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "could not create the invoice");
      setCreated(d.invoice);
      await reload();
      notify("ok", "invoice created");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function copyLink(slug: string) {
    const link = `${window.location.origin}/i/${slug}`;
    try {
      await navigator.clipboard.writeText(link);
      notify("ok", "pay link copied");
    } catch {
      notify("err", "copy failed");
    }
  }
  async function refreshOne(id: string) {
    try {
      const r = await fetch(`/api/invoices/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "refresh" }),
      });
      if (r.ok) {
        await reload();
        notify("ok", "invoice refreshed");
      }
    } catch {
      /* ignore */
    }
  }
  async function voidOne(id: string) {
    try {
      const r = await fetch(`/api/invoices/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "void" }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        await reload();
        notify("ok", "invoice voided");
      } else {
        notify("err", d.error || "could not void");
      }
    } catch {
      /* ignore */
    }
  }
  async function refundOne(id: string) {
    if (!confirm("Return the full invoice amount to the payer on chain and reopen the invoice?")) return;
    setRefundBusy(id);
    try {
      const r = await fetch(`/api/invoices/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "refund" }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        await reload();
        notify("ok", "refund sent on chain, invoice reopened");
      } else {
        notify("err", d.error || "refund failed");
      }
    } catch {
      notify("err", "refund failed");
    } finally {
      setRefundBusy(null);
    }
  }

  // created state: show the pay link
  if (created) {
    const link = `${window.location.origin}/i/${created.slug}`;
    return (
      <Modal title="Invoice ready to send" onClose={onClose}>
        <div className="card-2 px-4 py-3 text-sm">
          <div className="font-semibold">{created.client_name}</div>
          <div className="mono text-xs text-[var(--muted)]">
            ${Number(created.amount).toFixed(2)} · {created.asset} · due {created.due_date}
          </div>
        </div>
        <p className="mt-4 text-sm text-[var(--muted)]">
          Send this link to your client. They pay in {created.asset === "NEAR" ? "NEAR" : "USDC on NEAR"} straight from their wallet and it lands in your NEAR vault.
        </p>
        <div className="mt-4 flex gap-2">
          <input className="input mono flex-1" readOnly value={link} onFocus={(e) => e.target.select()} />
          <button className="btn btn-ghost" onClick={() => copyLink(created.slug)}>
            Copy
          </button>
        </div>
        <button
          className="btn btn-primary mt-6 w-full"
          onClick={() => {
            setCreated(null);
            setClient("");
            setEmail("");
            setAmount("");
            setAsset("USDC");
            setDueDate("");
            setNote("");
            setTab("list");
          }}
        >
          Create another
        </button>
      </Modal>
    );
  }

  return (
    <Modal title="Invoices" onClose={onClose} wide>
      <div className="seg mb-5 w-full">
        <button className={`${tab === "list" ? "active" : ""}`} style={{ flex: 1 }} onClick={() => setTab("list")}>
          Your invoices
        </button>
        <button className={`${tab === "new" ? "active" : ""}`} style={{ flex: 1 }} onClick={() => setTab("new")}>
          New invoice
        </button>
      </div>

      {tab === "list" ? (
        invoices.length === 0 ? (
          <div className="py-10 text-center">
            <p className="text-sm text-[var(--muted)]">No invoices yet.</p>
            <button className="btn btn-primary mt-4" onClick={() => setTab("new")}>
              Create your first invoice
            </button>
          </div>
        ) : (
          <>
          <div className="flex items-center justify-between">
            <div className="text-xs text-[var(--color-faint)]">
              {invoices.length} invoice{invoices.length === 1 ? "" : "s"}
            </div>
            <a className="text-xs text-[var(--color-accent)] hover:underline" href="/api/invoices/csv">
              Export all CSV
            </a>
          </div>
          <div className="mt-2 max-h-[52vh] space-y-2 overflow-y-auto pr-1">
            {invoices.map((inv) => {
              const st = INV_STATUS[inv.status] ?? INV_STATUS.open;
              return (
                <div key={inv.id} className="card-2 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{inv.client_name}</div>
                      <div className="mono text-xs text-[var(--muted)]">
                        ${Number(inv.amount).toFixed(2)} · {inv.asset} · due {inv.due_date}
                      </div>
                      {(() => {
                        try {
                          const it = JSON.parse(inv.items_json || "[]");
                          if (Array.isArray(it) && it.length) {
                            return (
                              <div className="mt-1 truncate text-[11px] text-[var(--color-faint)]">
                                {it.map((x: { description: string }) => x.description).join(" · ")}
                              </div>
                            );
                          }
                        } catch {
                          /* no line items */
                        }
                        return null;
                      })()}
                    </div>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${st.cls}`}>{st.label}</span>
                  </div>
                  <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs">
                    <button className="btn btn-ghost !px-2.5 !py-1 text-xs" onClick={() => copyLink(inv.slug)}>
                      Copy pay link
                    </button>
                    <button className="btn btn-ghost !px-2.5 !py-1 text-xs" onClick={() => refreshOne(inv.id)}>
                      Refresh
                    </button>
                    {(inv.status === "open" || inv.status === "pending") && (
                      <button className="btn btn-ghost !px-2.5 !py-1 text-xs" onClick={() => voidOne(inv.id)}>
                        Void
                      </button>
                    )}
                    {inv.status === "paid" && (
                      <button
                        className="btn btn-ghost !px-2.5 !py-1 text-xs"
                        disabled={refundBusy === inv.id}
                        style={refundBusy === inv.id ? { opacity: 0.6 } : undefined}
                        onClick={() => refundOne(inv.id)}
                      >
                        {refundBusy === inv.id ? "Refunding on chain…" : "Refund"}
                      </button>
                    )}
                    <a className="ml-auto btn btn-ghost !px-2.5 !py-1 text-xs" href={`/i/${inv.slug}`} target="_blank" rel="noreferrer">
                      Open
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
          </>
        )
      ) : (
        <div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Client name">
              <input className="input" placeholder="Acme Studio" value={client} onChange={(e) => setClient(e.target.value)} />
            </Field>
            <Field label="Client email (optional)">
              <input className="input" placeholder="billing@acme.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="Amount (USD)">
              <input className="input mono" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <Field label="Due date">
              <input className="input mono" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </Field>
          </div>

          <div className="mt-4">
            <Field label="Client pays in">
              <div className="seg w-full">
                <button className={`${asset === "USDC" ? "active" : ""}`} style={{ flex: 1 }} onClick={() => setAsset("USDC")}>
                  USDC on NEAR
                </button>
                <button className={`${asset === "NEAR" ? "active" : ""}`} style={{ flex: 1 }} onClick={() => setAsset("NEAR")}>
                  NEAR
                </button>
              </div>
            </Field>
          </div>

          <div className="mt-4">
            <Field label="Note (optional)">
              <input className="input" placeholder="what you are billing for" value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </div>

          <div className="mt-4">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--muted)]">Line items (optional)</span>
              <button className="text-xs font-semibold text-[var(--color-accent)]" onClick={() => setRows((r) => [...r, { desc: "", amt: "" }])}>
                Add row
              </button>
            </div>
            {rows.map((row, i) => (
              <div key={i} className="flex gap-2 mb-1.5">
                <input
                  className="input flex-1"
                  placeholder="Description"
                  value={row.desc}
                  onChange={(e) => setRows((r) => r.map((x, j) => (j === i ? { ...x, desc: e.target.value } : x)))}
                />
                <input
                  className="input mono w-28 shrink-0"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={row.amt}
                  onChange={(e) => setRows((r) => r.map((x, j) => (j === i ? { ...x, amt: e.target.value } : x)))}
                />
                <button
                  className="btn btn-ghost !px-2 !py-1 text-xs shrink-0"
                  onClick={() => setRows((r) => (r.length > 1 ? r.filter((_, j) => j !== i) : [{ desc: "", amt: "" }]))}
                >
                  x
                </button>
              </div>
            ))}
            {rowsTotal > 0 && (
              <div className="mt-1 text-xs text-[var(--muted)]">
                Lines total {rowsTotal.toFixed(2)} {asset}
                {Number.isFinite(amtNum) && Math.abs(rowsTotal - amtNum) > 0.005 && (
                  <span className="text-[var(--color-danger)]"> · billed amount field shows {amtNum.toFixed(2)}</span>
                )}
              </div>
            )}
          </div>

          <div className="card-2 mt-4 px-4 py-2.5 text-xs text-[var(--muted)]">
            Your client pays {asset === "NEAR" ? "NEAR" : "USDC"} straight from their wallet into your NEAR vault. The payment is confirmed on chain before the invoice is marked paid.
          </div>

          {err && <div className="mt-3 text-sm text-[var(--color-danger)]">{err}</div>}

          <button className="btn btn-primary mt-6 w-full" disabled={busy} onClick={create}>
            {busy ? "Creating…" : "Create invoice"}
          </button>
        </div>
      )}
    </Modal>
  );
}

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
    avatar: employee?.avatar ?? "",
    wallet: employee?.wallet ?? "",
    asset: employee?.asset ?? "NEAR",
    salary: employee?.salary ?? "",
    frequency: employee?.frequency ?? "monthly",
    payDay: employee?.payDay ?? 28,
    status: employee?.status ?? "active",
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string | number) => setF((p) => ({ ...p, [k]: v }));

  const pickAvatar = (file: File | undefined) => {
    if (!file) return;
    if (!/image\/(png|jpeg|webp|gif)/.test(file.type) || file.size > 300 * 1024) return;
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = 96;
      c.height = 96;
      const ctx = c.getContext("2d");
      if (ctx) {
        const s = Math.min(img.width, img.height);
        ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 96, 96);
        set("avatar", c.toDataURL("image/jpeg", 0.85));
      }
      URL.revokeObjectURL(url);
    };
    img.src = url;
  };

  async function submit() {
    setBusy(true);
    const ok = await onSave({
      name: f.name,
      email: f.email || undefined,
      department: f.department || undefined,
      jobTitle: f.jobTitle || undefined,
      avatar: f.avatar || undefined,
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
        <div className="sm:col-span-2">
          <Field label="Profile photo">
            <div className="flex flex-wrap items-center gap-3">
              <div className="member-ring flex-none">
                {f.avatar ? (
                  <img src={f.avatar} alt="Profile preview" className="member-photo" />
                ) : (
                  <span className="text-[15px] font-extrabold">
                    {(f.name || "A").trim().charAt(0).toUpperCase() || "A"}
                  </span>
                )}
              </div>
              <label className="btn btn-ghost btn-sm cursor-pointer">
                Upload image
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className="sr-only"
                  onChange={(e) => pickAvatar(e.target.files?.[0])}
                />
              </label>
              {f.avatar && (
                <button className="btn btn-ghost btn-sm" onClick={() => set("avatar", "")}>
                  Remove
                </button>
              )}
              <span className="text-[11px] text-[var(--color-faint)]">
                png, jpeg, webp or gif · 300KB max
              </span>
            </div>
          </Field>
        </div>
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

function StatementModal({ onClose }: { onClose: () => void }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function download() {
    setErr("");
    setBusy(true);
    try {
      if (!/^\d{4}-\d{2}$/.test(from)) throw new Error("pick the start month first");
      if (!/^\d{4}-\d{2}$/.test(to)) throw new Error("pick the end month first");
      if (from > to) throw new Error("the start month must not be after the end month");
      const span =
        (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + (Number(to.slice(5)) - Number(from.slice(5)));
      if (span > 23) throw new Error("pick a range of at most 24 months");
      const r = await fetch(`/api/statement?from=${from}&to=${to}`);
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || "could not build the statement");
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `nearhr-statement-${from}-to-${to}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Payroll statement" onClose={onClose}>
      <p className="mb-4 text-sm leading-relaxed text-[var(--muted)]">
        A signed PDF of everything money moved in a range, the payroll runs you paid and the invoices your clients
        settled, each with its NEAR transaction. Send it to a client, an accountant, or an auditor.
      </p>
      <div className="grid grid-cols-2 gap-4">
        <Field label="From month">
          <input className="input mono" type="month" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="To month">
          <input className="input mono" type="month" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>
      {err && <div className="mt-3 text-sm text-[var(--color-danger)]">{err}</div>}
      <button className="btn btn-primary mt-5 w-full" disabled={busy} onClick={download}>
        {busy ? "Building the PDF…" : "Download PDF statement"}
      </button>
    </Modal>
  );
}
