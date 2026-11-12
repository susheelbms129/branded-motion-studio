import { AlertTriangle, CopyCheck, Timer, TrendingUp } from "lucide-react";
import { useState, type CSSProperties } from "react";

import { formatMoney } from "@/lib/format";

import { Reveal, SectionHead } from "./motion";

const OLD = 62.4;
const NEW = 70.3;
const KG = 1800;
const PCT = (((NEW - OLD) / OLD) * 100).toFixed(1);

const INSIGHTS = [
  {
    key: "price",
    icon: TrendingUp,
    label: "Price increase",
    severity: "High",
    title: `Hot-rolled coil is up ${PCT}% in three orders`,
    what: `The unit price moved from ₹${OLD} to ₹${NEW} per kg across your last three purchase orders for this material.`,
    why: "Each order was placed with the same supplier, and the price rose every time with no matching change in quantity.",
    evidence: ["PO-2026-644 · ₹62.40/kg", "PO-2026-681 · ₹66.10/kg", "PO-2026-718 · ₹70.30/kg"],
    action: "Send an RFQ to two alternative suppliers before the next order.",
    confidence: 0.91,
    impact: (NEW - OLD) * KG,
  },
  {
    key: "delay",
    icon: Timer,
    label: "Repeated delay",
    severity: "Medium",
    title: "Supplier B was late on 3 of their last 5 orders",
    what: "Three of five delivered orders arrived after the expected date, by four days on average.",
    why: "Late delivery is repeating rather than random, which is when it starts affecting production plans.",
    evidence: ["PO-2026-602 · 5 days late", "PO-2026-651 · 4 days late", "PO-2026-690 · 3 days late"],
    action: "Add buffer days to their next PO, or prefer a faster bidder.",
    confidence: 0.78,
    impact: null,
  },
  {
    key: "landed",
    icon: AlertTriangle,
    label: "Lower landed cost",
    severity: "Medium",
    title: "A cheaper option existed on RFQ-2026-031",
    what: "The quote you chose is not the lowest once GST and freight are included.",
    why: "Supplier B's unit price is lowest, but its freight outweighs the saving. Supplier C wins on total landed cost.",
    evidence: ["Quote B · ₹2,75,820 landed", "Quote C · ₹2,48,450 landed"],
    action: "Review the comparison before issuing the purchase order.",
    confidence: 0.86,
    impact: 275820 - 248450,
  },
  {
    key: "dup",
    icon: CopyCheck,
    label: "Possible duplicate",
    severity: "Low",
    title: "Two requests for CNC coolant, two days apart",
    what: "PR-0405 and PR-0411 describe the same item and quantity, raised by different people.",
    why: "Matching items within a short window are the most common source of double buying.",
    evidence: ["PR-0405 · Production", "PR-0411 · Maintenance"],
    action: "Merge the requests or confirm both are needed.",
    confidence: 0.64,
    impact: null,
  },
];

const SEV = { High: "tint-red", Medium: "tint-amber", Low: "tint-slate" } as const;

export function Insights() {
  const [i, setI] = useState(0);
  const cur = INSIGHTS[i] ?? INSIGHTS[0]!;
  return (
    <section id="insights" className="relative overflow-hidden bg-gradient-lavender py-28 sm:py-40">
      <div className="bg-grid-light mask-radial pointer-events-none absolute inset-0" />
      <div className="relative mx-auto max-w-[1400px] px-5 sm:px-8">
        <SectionHead dark={false} eyebrow="AI Insights" title={<>An AI that <span className="text-gradient-brand animate-gradient-pan">shows its homework.</span></>} body="Every alert lists the records it came from, why it was raised, and how confident it is. If an impact can't be calculated from your data, we say so." />

        <div className="mt-16 grid gap-8 lg:grid-cols-12">
          <Reveal className="space-y-3 lg:col-span-5">
            {INSIGHTS.map((n, k) => (
              <button key={n.key} type="button" onClick={() => setI(k)} className={`flex w-full items-center gap-4 rounded-3xl border p-5 text-left transition-all duration-300 ${k === i ? "border-violet/40 bg-white shadow-lift sm:translate-x-2" : "border-border bg-white/60 hover:bg-white"}`}>
                <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-white transition ${k === i ? "bg-gradient-ai" : "bg-gradient-primary opacity-70"}`}>
                  <n.icon className="h-6 w-6" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-lg font-semibold text-foreground">{n.label}</span>
                  <span className="block truncate text-sm text-muted-foreground">{n.title}</span>
                </span>
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${SEV[n.severity as keyof typeof SEV]}`}>{n.severity}</span>
              </button>
            ))}
          </Reveal>

          <Reveal className="lg:col-span-7" delay={0.12} scale>
            <div key={cur.key} className="slide-in-r rounded-[32px] border border-border bg-white p-7 shadow-lift sm:p-10">
              <span className="tint-violet inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-semibold">
                <cur.icon className="h-4 w-4" /> {cur.label}
              </span>
              <h3 className="mt-5 text-3xl font-semibold leading-tight text-foreground sm:text-4xl">{cur.title}</h3>
              <div className="mt-6 grid gap-5 sm:grid-cols-2">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-subtle-foreground">What happened</p>
                  <p className="mt-1.5 text-muted-foreground sm:text-lg">{cur.what}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-subtle-foreground">Why it was flagged</p>
                  <p className="mt-1.5 text-muted-foreground sm:text-lg">{cur.why}</p>
                </div>
              </div>
              <p className="mt-6 text-xs font-semibold uppercase tracking-widest text-subtle-foreground">Evidence</p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {cur.evidence.map((e, k) => (
                  <li key={e} className="pop-in rounded-xl bg-lavender px-3.5 py-2 font-mono text-sm text-secondary-foreground" style={{ animationDelay: `${0.1 + k * 0.1}s` }}>
                    {e}
                  </li>
                ))}
              </ul>
              <div className="mt-7 grid gap-5 sm:grid-cols-2">
                <div>
                  <p className="flex justify-between text-sm text-muted-foreground">
                    Confidence <b className="tabular text-foreground">{Math.round(cur.confidence * 100)}%</b>
                  </p>
                  <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-muted">
                    <div key={cur.key} className="progress-fill h-full rounded-full bg-gradient-cta" style={{ width: `${cur.confidence * 100}%`, "--dur": "900ms" } as CSSProperties} />
                  </div>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Impact</p>
                  <p className="text-2xl font-semibold tabular text-foreground">{cur.impact === null ? <span className="text-base font-medium text-subtle-foreground">Not computable from records</span> : formatMoney(Math.round(cur.impact))}</p>
                </div>
              </div>
              <p className="mt-7 rounded-2xl bg-gradient-primary px-5 py-4 font-medium text-white">Suggested: {cur.action}</p>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
