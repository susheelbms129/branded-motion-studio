import { Check, Package, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";

import { formatMoney, formatMoneyCompact } from "@/lib/format";
import { PERFORMANCE_WEIGHTS } from "@/lib/performance";

import { Reveal, SectionHead, Spot } from "./motion";

const card = "h-full rounded-[28px] border border-white/10 bg-white/[0.04] p-7 sm:p-9";

function Scorecard() {
  const [onTime, setOnTime] = useState(90);
  const variance = -0.03;
  const response = 1;
  const priceScore = Math.min(1, Math.max(0, 0.7 - variance * 2));
  const score = Math.round((onTime / 100 * PERFORMANCE_WEIGHTS.onTime + priceScore * PERFORMANCE_WEIGHTS.price + response * PERFORMANCE_WEIGHTS.response) * 100);
  const r = 62;
  const c = 2 * Math.PI * r;
  return (
    <div className={card}>
      <h3 className="text-2xl font-semibold text-white sm:text-3xl">Scorecards earned, not invented</h3>
      <p className="mt-2 text-navy-muted sm:text-lg">Half on-time delivery, thirty percent price, twenty percent responsiveness. Drag to see how delivery moves the score.</p>
      <div className="mt-8 flex flex-col items-center gap-8 sm:flex-row">
        <div className="relative h-44 w-44 shrink-0">
          <svg viewBox="0 0 150 150" className="-rotate-90">
            <circle cx="75" cy="75" r={r} fill="none" stroke="oklch(1 0 0 / 10%)" strokeWidth="12" />
            <circle cx="75" cy="75" r={r} fill="none" stroke="url(#sg)" strokeWidth="12" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)} style={{ transition: "stroke-dashoffset 600ms cubic-bezier(0.16,1,0.3,1)" }} />
            <defs>
              <linearGradient id="sg" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="oklch(0.797 0.134 211.5)" />
                <stop offset="100%" stopColor="oklch(0.667 0.259 322.1)" />
              </linearGradient>
            </defs>
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-5xl font-semibold tabular text-white">{score}</span>
            <span className="text-xs uppercase tracking-widest text-navy-muted">of 100</span>
          </div>
        </div>
        <div className="w-full space-y-4">
          <label className="block">
            <span className="flex justify-between text-sm text-white/80">On-time delivery <b className="tabular text-white">{onTime}%</b></span>
            <input type="range" min={40} max={100} value={onTime} onChange={(e) => setOnTime(Number(e.target.value))} className="mt-2 w-full accent-[var(--brand-cyan)]" />
          </label>
          {[
            ["Price vs median quote", "3% cheaper"],
            ["Responds to RFQs", "Every time"],
          ].map(([k, v]) => (
            <p key={k} className="flex justify-between border-t border-white/10 pt-3 text-sm text-navy-muted">
              {k} <b className="text-white">{v}</b>
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}

function Rules() {
  const [rules, setRules] = useState([
    { name: "Department head approves everything", detail: "1 level · Approver", on: true },
    { name: "Finance approval above ₹2,00,000", detail: "2 levels · Finance Manager", on: true },
    { name: "IT purchases need owner sign-off", detail: "2 levels · Owner", on: false },
  ]);
  return (
    <div className={card}>
      <h3 className="text-2xl font-semibold text-white sm:text-3xl">Rules that enforce themselves</h3>
      <p className="mt-2 text-navy-muted sm:text-lg">Switch a rule on and the next purchase obeys it. No memo required.</p>
      <ul className="mt-7 space-y-3">
        {rules.map((r, i) => (
          <li key={r.name} className="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/5 p-4">
            <ShieldCheck className={`h-6 w-6 shrink-0 transition ${r.on ? "text-emerald" : "text-white/30"}`} />
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-white">{r.name}</p>
              <p className="text-sm text-navy-muted">{r.detail}</p>
            </div>
            <button type="button" role="switch" aria-checked={r.on} aria-label={r.name} onClick={() => setRules((p) => p.map((x, k) => (k === i ? { ...x, on: !x.on } : x)))} className={`relative h-8 w-14 shrink-0 rounded-full transition ${r.on ? "bg-gradient-emerald" : "bg-white/15"}`}>
              <span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all ${r.on ? "left-7" : "left-1"}`} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function IndiaNative() {
  const amounts = [1250000, 18400000, 1234567];
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setI((v) => (v + 1) % amounts.length), 2600);
    return () => window.clearInterval(t);
  }, [amounts.length]);
  const v = amounts[i] ?? 0;
  return (
    <div className={card}>
      <h3 className="text-2xl font-semibold text-white sm:text-3xl">Speaks lakh and crore</h3>
      <p className="mt-2 text-navy-muted sm:text-lg">Indian digit grouping everywhere, with GST in the maths from the first line.</p>
      <div key={i} className="pop-in mt-8 rounded-2xl bg-white/5 p-6 text-center">
        <p className="text-4xl font-semibold tabular text-white sm:text-5xl">{formatMoney(v)}</p>
        <p className="animate-gradient-pan text-gradient-brand-dark mt-2 text-2xl font-semibold tabular">{formatMoneyCompact(v)}</p>
      </div>
    </div>
  );
}

const MATERIALS = ["MS plate 10 mm", "Hydraulic hose", "Servo drive", "Corrugated carton", "Safety gloves", "CNC coolant", "Cat6 cable", "Packaging film", "Bearing 6205"];

function Materials() {
  return (
    <div className={card}>
      <h3 className="flex items-center gap-3 text-2xl font-semibold text-white sm:text-3xl">
        <Package className="h-7 w-7 text-pink" /> One name per material
      </h3>
      <p className="mt-2 text-navy-muted sm:text-lg">A shared materials master stops "MS plate", "M.S. Plate" and "ms-plate" from becoming three suppliers' worth of confusion.</p>
      <div className="mt-6 flex flex-wrap gap-2.5">
        {MATERIALS.map((m, i) => (
          <span key={m} className="pop-in rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/90 transition hover:-translate-y-1 hover:border-pink/50" style={{ animationDelay: `${i * 0.06}s` }}>
            {m}
          </span>
        ))}
      </div>
    </div>
  );
}

const TRAIL = [
  ["Kavya Iyer", "approved PR-0412", "9:12 am"],
  ["Priya Nair", "sent RFQ-2026-031 to 5 suppliers", "9:40 am"],
  ["Rohan Mehta", "approved PO-2026-722", "11:05 am"],
  ["Vendora", "flagged a possible duplicate request", "11:30 am"],
] as const;

function Trail() {
  const [on, setOn] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setOn((v) => (v + 1) % TRAIL.length), 2200);
    return () => window.clearInterval(t);
  }, []);
  return (
    <div className={card}>
      <h3 className="text-2xl font-semibold text-white sm:text-3xl">Every action, on the record</h3>
      <p className="mt-2 text-navy-muted sm:text-lg">Who, what and when. Ready for the audit you hope never comes.</p>
      <ol className="relative mt-7 space-y-4 border-l border-white/15 pl-6">
        {TRAIL.map(([who, what, when], i) => (
          <li key={what} className={`relative transition-all duration-500 ${i === on ? "translate-x-1 opacity-100" : "opacity-50"}`}>
            <span className={`absolute -left-[31px] top-1.5 h-3 w-3 rounded-full ring-4 ring-navy transition ${i === on ? "dot-live bg-cyan" : "bg-white/30"}`} />
            <p className="text-white">
              <b>{who}</b> {what}
            </p>
            <p className="text-sm text-navy-muted">{when}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function Platform() {
  return (
    <section id="platform" className="relative overflow-hidden bg-navy py-28 sm:py-40">
      <div className="glow-violet pointer-events-none absolute -right-40 top-20 h-[600px] w-[600px] opacity-40" />
      <div className="relative mx-auto max-w-[1400px] px-5 sm:px-8">
        <SectionHead eyebrow="Built to be trusted" title={<>Controls you can <span className="text-gradient-brand-dark animate-gradient-pan">put your name on.</span></>} body="Procurement earns trust one visible decision at a time. These are the pieces that make every decision visible." />
        <div className="mt-16 grid gap-6 lg:grid-cols-6">
          {[
            { node: <Scorecard />, span: "lg:col-span-4" },
            { node: <IndiaNative />, span: "lg:col-span-2" },
            { node: <Rules />, span: "lg:col-span-3" },
            { node: <Trail />, span: "lg:col-span-3" },
            { node: <Materials />, span: "lg:col-span-6" },
          ].map((b, i) => (
            <Reveal key={i} delay={(i % 2) * 0.1} className={b.span}>
              <Spot className="h-full rounded-[28px]">{b.node}</Spot>
            </Reveal>
          ))}
        </div>
        <p className="mt-10 flex items-center justify-center gap-2 text-sm text-navy-muted">
          <Check className="h-4 w-4 text-emerald" /> Supplier scores only appear after two or more deliveries. We'd rather show nothing than guess.
        </p>
      </div>
    </section>
  );
}
