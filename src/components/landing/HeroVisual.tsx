import { Bell, Check, ChevronDown, ClipboardList, FileSpreadsheet, LayoutDashboard, Minus, Package, ReceiptText, Send, Sparkles, Truck, Users, X } from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";

import { formatMoneyCompact } from "@/lib/format";

/* ───────────────────────── Desktop dashboard ───────────────────────── */

type TabKey = "requests" | "rfqs" | "orders";
interface Row {
  id: string;
  title: string;
  meta: string;
  amount: number;
}
const TABS: { key: TabKey; label: string; count: number }[] = [
  { key: "requests", label: "Requests", count: 7 },
  { key: "rfqs", label: "RFQs", count: 4 },
  { key: "orders", label: "Purchase orders", count: 12 },
];
const ROWS: Record<TabKey, Row[]> = {
  requests: [
    { id: "PR-0412", title: "Hydraulic hose, 1/2 in", meta: "MRO & Tools · Production", amount: 38400 },
    { id: "PR-0409", title: "Cut-resistant gloves", meta: "Safety & PPE · Maintenance", amount: 12600 },
    { id: "PR-0405", title: "CNC coolant, 200 L", meta: "Raw Materials · Production", amount: 94000 },
  ],
  rfqs: [
    { id: "RFQ-031", title: "Hot-rolled coil, 12 tonnes", meta: "4 of 5 suppliers quoted", amount: 912000 },
    { id: "RFQ-029", title: "Corrugated cartons", meta: "3 of 4 suppliers quoted", amount: 146000 },
    { id: "RFQ-027", title: "Network switches", meta: "Closes tomorrow", amount: 184000 },
  ],
  orders: [
    { id: "PO-2026-718", title: "Hot-rolled coil", meta: "Expected 19 Nov · Net 45", amount: 248450 },
    { id: "PO-2026-722", title: "Packaging film", meta: "Expected 21 Nov · Net 30", amount: 112500 },
    { id: "PO-2026-725", title: "Servo drives", meta: "Awaiting approval", amount: 326000 },
  ],
};
const MONTHS = ["Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov"];
const SPEND = [11.2, 12.8, 10.4, 13.9, 15.1, 12.2, 14.6, 16.3, 15.4, 17.8, 16.9, 19.2];
const BUDGETS = [
  { name: "Raw Materials", pct: 82, color: "bg-blue" },
  { name: "Electrical", pct: 64, color: "bg-amber" },
  { name: "Packaging", pct: 47, color: "bg-emerald" },
  { name: "IT & Electronics", pct: 91, color: "bg-violet" },
];

export function HeroDashboard() {
  const [tab, setTab] = useState<TabKey>("requests");
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [hover, setHover] = useState<number | null>(11);
  const max = Math.max(...SPEND);
  const SIDE = [LayoutDashboard, ClipboardList, FileSpreadsheet, ReceiptText, Truck, Package, Users];

  return (
    <div className="overflow-hidden rounded-[28px] border border-white/20 bg-white shadow-[0_40px_120px_-20px_oklch(0.55_0.25_285/55%)] ring-8 ring-white/5">
      <div className="flex">
        <aside className="hidden w-14 shrink-0 flex-col items-center gap-4 border-r border-border bg-lavender py-5 sm:flex">
          <span className="h-8 w-8 rounded-xl bg-gradient-primary" />
          {SIDE.map((I, i) => (
            <span key={i} className={`flex h-9 w-9 items-center justify-center rounded-xl transition ${i === 0 ? "bg-primary/10 text-primary" : "text-subtle-foreground hover:bg-accent"}`}>
              <I className="h-[18px] w-[18px]" />
            </span>
          ))}
        </aside>

        <div className="min-w-0 flex-1 p-4 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs text-subtle-foreground">Sharma Precision Industries · Pune</p>
              <h3 className="text-xl font-semibold text-foreground sm:text-2xl">Today's desk</h3>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="hidden items-center gap-1 rounded-full bg-muted px-3 py-1.5 sm:flex">
                All locations <ChevronDown className="h-3 w-3" />
              </span>
              <span className="rounded-full bg-muted px-3 py-1.5">Dec 2025 – Nov 2026</span>
              <span className="relative flex h-8 w-8 items-center justify-center rounded-full bg-muted">
                <Bell className="h-4 w-4" />
                <span className="dot-live absolute right-1 top-1 h-2 w-2 rounded-full bg-coral" />
              </span>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            {[
              ["Awaiting you", "7", "tint-blue"],
              ["RFQs live", "4", "tint-violet"],
              ["Orders in transit", "12", "tint-emerald"],
              ["Overdue", "2", "tint-coral"],
            ].map(([l, v, t]) => (
              <div key={l} className="rounded-2xl border border-border p-3 transition hover:-translate-y-0.5 hover:shadow-card">
                <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${t}`}>{l}</span>
                <p className="mt-1.5 text-2xl font-semibold text-foreground tabular">{v}</p>
              </div>
            ))}
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-5">
            <div className="rounded-2xl border border-border p-4 lg:col-span-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-foreground">Spend by month</p>
                <p className="text-sm font-semibold tabular text-primary">{hover !== null ? `${MONTHS[hover]} · ${formatMoneyCompact((SPEND[hover] ?? 0) * 100000)}` : "Hover a bar"}</p>
              </div>
              <div className="mt-4 flex h-36 items-end gap-1.5 sm:gap-2" onMouseLeave={() => setHover(11)}>
                {SPEND.map((v, i) => (
                  <button
                    key={MONTHS[i]}
                    type="button"
                    aria-label={`${MONTHS[i]} spend`}
                    onMouseEnter={() => setHover(i)}
                    onFocus={() => setHover(i)}
                    className="group flex h-full flex-1 flex-col justify-end"
                  >
                    <span
                      className={`bar-grow block w-full rounded-t-lg transition-all ${hover === i ? "bg-gradient-primary shadow-glow" : "bg-primary/20"}`}
                      style={{ height: `${(v / max) * 100}%`, animationDelay: `${0.5 + i * 0.06}s` }}
                    />
                  </button>
                ))}
              </div>
              <div className="mt-1.5 flex gap-1.5 text-[9px] text-subtle-foreground sm:gap-2">
                {MONTHS.map((m) => (
                  <span key={m} className="flex-1 text-center">
                    {m}
                  </span>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-border p-4 lg:col-span-2">
              <p className="text-sm font-semibold text-foreground">Budget used this month</p>
              <div className="mt-3 space-y-3">
                {BUDGETS.map((b, i) => (
                  <div key={b.name}>
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>{b.name}</span>
                      <span className="tabular">{b.pct}%</span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                      <div className={`progress-fill h-full rounded-full ${b.color}`} style={{ width: `${b.pct}%`, animationDelay: `${0.7 + i * 0.12}s`, "--dur": "1400ms" } as CSSProperties} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-border">
            <div className="flex gap-1 border-b border-border px-3 pt-2">
              {TABS.map((t) => (
                <button key={t.key} type="button" onClick={() => setTab(t.key)} className={`relative px-3 py-2.5 text-sm font-medium transition ${tab === t.key ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}>
                  {t.label} <span className="ml-1 rounded-full bg-muted px-1.5 text-[10px] tabular">{t.count}</span>
                  {tab === t.key ? <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" /> : null}
                </button>
              ))}
            </div>
            <ul key={tab} className="divide-y divide-border">
              {ROWS[tab].map((r, i) => (
                <li key={r.id} className="slide-in-r flex items-center gap-3 px-4 py-3" style={{ animationDelay: `${i * 0.07}s` }}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground">
                      <span className="mr-2 font-mono text-xs text-subtle-foreground">{r.id}</span>
                      {r.title}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{r.meta}</p>
                  </div>
                  <p className="text-sm font-semibold tabular text-foreground">{formatMoneyCompact(r.amount)}</p>
                  <button
                    type="button"
                    onClick={() => setDone((d) => ({ ...d, [r.id]: !d[r.id] }))}
                    className={`flex w-[88px] items-center justify-center gap-1 rounded-full py-1.5 text-xs font-semibold transition ${done[r.id] ? "pop-in tint-green" : "bg-primary text-white hover:scale-105"}`}
                  >
                    {done[r.id] ? <><Check className="h-3.5 w-3.5" /> Cleared</> : "Review"}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── Phone ───────────────────────── */

const PHONE_ITEMS = [
  { id: "PO-2026-722", title: "Packaging film", sub: "Due 21 Nov · Pune plant", amount: 112500 },
  { id: "PR-0412", title: "Hydraulic hose, 1/2 in", sub: "Raised by Arjun Reddy", amount: 38400 },
  { id: "PO-2026-725", title: "Servo drives", sub: "Finance sign-off needed", amount: 326000 },
];

export function HeroPhone() {
  const [i, setI] = useState(0);
  const [ok, setOk] = useState(false);
  useEffect(() => {
    if (!ok) return;
    const t = window.setTimeout(() => {
      setOk(false);
      setI((n) => (n + 1) % PHONE_ITEMS.length);
    }, 1200);
    return () => window.clearTimeout(t);
  }, [ok]);
  const item = PHONE_ITEMS[i] ?? PHONE_ITEMS[0]!;
  return (
    <div className="w-[250px] overflow-hidden rounded-[34px] border-[6px] border-navy bg-navy shadow-[0_30px_80px_-10px_oklch(0.2_0.1_270/70%)]">
      <div className="bg-gradient-to-b from-indigo to-blue px-5 pb-5 pt-3 text-white">
        <div className="flex justify-between text-[11px] font-semibold">
          <span>9:41</span>
          <span>5G ▮▮▮</span>
        </div>
        <p className="mt-3 text-sm font-semibold">Sharma Precision</p>
        <div className="mt-3 grid grid-cols-4 gap-2 text-center text-[10px]">
          {[ClipboardList, ReceiptText, Truck, Sparkles].map((I, k) => (
            <span key={k} className="flex flex-col items-center gap-1">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20">
                <I className="h-4 w-4" />
              </span>
              {["Request", "Orders", "Suppliers", "Ask AI"][k]}
            </span>
          ))}
        </div>
      </div>
      <div className="min-h-[190px] rounded-t-3xl bg-white px-4 py-4">
        <p className="text-xs font-semibold text-foreground">Waiting on you · {PHONE_ITEMS.length - (ok ? 1 : 0)}</p>
        <div key={i} className="slide-in-r mt-3 rounded-2xl border border-border p-3">
          <div className="flex justify-between">
            <span className="font-mono text-[11px] text-subtle-foreground">{item.id}</span>
            <span className="tint-amber rounded-full px-2 text-[10px] font-semibold">Review</span>
          </div>
          <p className="mt-1 text-sm font-semibold text-foreground">{item.title}</p>
          <p className="text-[11px] text-muted-foreground">{item.sub}</p>
          <p className="mt-2 text-lg font-semibold tabular text-foreground">{formatMoneyCompact(item.amount)}</p>
          <button type="button" onClick={() => setOk(true)} className={`mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-semibold transition ${ok ? "bg-success text-white" : "bg-gradient-primary text-white hover:scale-[1.02]"}`}>
            {ok ? <><Check className="h-4 w-4" /> Approved</> : "Approve"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── AI assistant ───────────────────────── */

const SCRIPT = [
  { q: "What needs my approval today?", a: "Three things: PR-0412 (₹38,400), PO-2026-722 (₹1,12,500) and PO-2026-725 (₹3,26,000). The last one needs Finance, so I've pinged Rohan." },
  { q: "Which supplier wins the coil RFQ?", a: "Supplier C. Supplier B quoted a lower unit price, but after GST and freight C is ₹27,370 cheaper and delivers sooner." },
  { q: "Any price creep this month?", a: "Yes. Hot-rolled coil rose 12.7% across your last three orders. I've linked all three POs as evidence." },
];

export function HeroAssistant() {
  const [min, setMin] = useState(false);
  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState<"q" | "dots" | "a">("q");
  const [n, setN] = useState(0);
  const cur = SCRIPT[idx % SCRIPT.length] ?? SCRIPT[0]!;

  useEffect(() => {
    if (phase === "q") {
      const t = window.setTimeout(() => setPhase("dots"), 900);
      return () => window.clearTimeout(t);
    }
    if (phase === "dots") {
      const t = window.setTimeout(() => {
        setN(0);
        setPhase("a");
      }, 1100);
      return () => window.clearTimeout(t);
    }
    const iv = window.setInterval(() => {
      setN((v) => {
        if (v >= cur.a.length) {
          window.clearInterval(iv);
          return v;
        }
        return v + 2;
      });
    }, 22);
    return () => window.clearInterval(iv);
  }, [phase, cur.a.length]);

  useEffect(() => {
    if (phase !== "a" || n < cur.a.length) return;
    const t = window.setTimeout(() => {
      setIdx((v) => v + 1);
      setPhase("q");
    }, 3600);
    return () => window.clearTimeout(t);
  }, [phase, n, cur.a.length]);

  return (
    <div className="w-[320px] overflow-hidden rounded-2xl border border-white/20 bg-white shadow-[0_24px_70px_-10px_oklch(0.2_0.1_270/70%)]">
      <div className="flex items-center justify-between bg-navy px-4 py-3 text-white">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="h-4 w-4 text-cyan" /> Vendora Assistant
        </span>
        <button type="button" aria-label={min ? "Expand assistant" : "Minimise assistant"} onClick={() => setMin((m) => !m)} className="rounded-full p-1 transition hover:bg-white/15">
          {min ? <X className="h-4 w-4 rotate-45" /> : <Minus className="h-4 w-4" />}
        </button>
      </div>
      {min ? null : (
        <div className="min-h-[210px] space-y-3 bg-lavender/60 p-4 text-[13px] leading-snug">
          <div key={`q${idx}`} className="pop-in ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3.5 py-2 text-white">
            {cur.q}
          </div>
          {phase === "dots" ? (
            <div className="pop-in flex w-fit gap-1 rounded-2xl rounded-bl-sm bg-white px-4 py-3 shadow-soft">
              {[0, 1, 2].map((d) => (
                <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-violet" style={{ animationDelay: `${d * 0.15}s` }} />
              ))}
            </div>
          ) : null}
          {phase === "a" ? (
            <div className={`w-fit max-w-[92%] rounded-2xl rounded-bl-sm bg-white px-3.5 py-2.5 text-foreground shadow-soft ${n < cur.a.length ? "caret" : ""}`}>{cur.a.slice(0, n)}</div>
          ) : null}
        </div>
      )}
      {min ? null : (
        <div className="flex items-center gap-2 border-t border-border bg-white px-3 py-2.5 text-xs text-subtle-foreground">
          <span className="flex-1">Ask about spend, suppliers, quotes…</span>
          <Send className="h-4 w-4 text-primary" />
        </div>
      )}
    </div>
  );
}
