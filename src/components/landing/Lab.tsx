import { RotateCcw, Trophy } from "lucide-react";
import { useState } from "react";

import { formatMoney } from "@/lib/format";
import { calculateLandedCost } from "@/lib/landed-cost";

import { Reveal, SectionHead } from "./motion";

const QTY = 500;
const GST = 18;
const START = [
  { name: "Supplier A", terms: "Net 30", unit: 412, freight: 18000, accent: "bg-blue" },
  { name: "Supplier B", terms: "Net 45", unit: 398, freight: 41000, accent: "bg-violet" },
  { name: "Supplier C", terms: "Net 45", unit: 405, freight: 9500, accent: "bg-cyan" },
];

export function Lab() {
  const [q, setQ] = useState(START.map((s) => ({ unit: s.unit, freight: s.freight })));
  const rows = START.map((s, i) => {
    const v = q[i] ?? { unit: s.unit, freight: s.freight };
    const landed = calculateLandedCost({ lines: [{ qty: QTY, unitPrice: v.unit }], gstRate: GST, shipping: v.freight, otherCharges: 0 });
    return { ...s, ...v, landed };
  });
  const maxTotal = Math.max(...rows.map((r) => r.landed.total));
  const bestTotal = Math.min(...rows.map((r) => r.landed.total));
  const bestUnit = Math.min(...rows.map((r) => r.unit));
  const winner = rows.find((r) => r.landed.total === bestTotal);
  const sticker = rows.find((r) => r.unit === bestUnit);
  const trap = winner && sticker && winner.name !== sticker.name;
  const gap = sticker ? sticker.landed.total - bestTotal : 0;

  return (
    <section id="lab" className="relative overflow-hidden bg-gradient-lavender py-28 sm:py-40">
      <div className="bg-grid-light mask-radial pointer-events-none absolute inset-0" />
      <div className="relative mx-auto max-w-[1400px] px-5 sm:px-8">
        <SectionHead dark={false} eyebrow="Landed-Cost Lab" title={<>The lowest price tag is <span className="text-gradient-brand animate-gradient-pan">not always the lowest bill.</span></>} body={`Drag the sliders. Same 500 units, 18% GST on goods, and freight that changes the answer. This is the exact calculation Vendora runs on every quotation.`} />

        <div className="mt-16 grid gap-6 lg:grid-cols-3">
          {rows.map((r, i) => {
            const best = r.landed.total === bestTotal;
            const goods = (r.landed.subtotal / maxTotal) * 100;
            const tax = (r.landed.gst / maxTotal) * 100;
            const frt = (r.landed.shipping / maxTotal) * 100;
            return (
              <Reveal key={r.name} delay={i * 0.1} scale>
                <div className={`relative h-full rounded-[28px] border bg-white p-7 transition-all duration-500 ${best ? "border-emerald/50 shadow-[0_30px_80px_-20px_oklch(0.696_0.149_162.5/45%)] lg:-translate-y-3" : "border-border shadow-card"}`}>
                  {best ? (
                    <span className="pop-in absolute -top-4 left-7 flex items-center gap-1.5 rounded-full bg-gradient-emerald px-4 py-1.5 text-sm font-semibold text-white shadow-glow">
                      <Trophy className="h-4 w-4" /> Lowest landed cost
                    </span>
                  ) : null}
                  <div className="flex items-center justify-between">
                    <h3 className="text-2xl font-semibold text-foreground">{r.name}</h3>
                    <span className="tint-slate rounded-full px-3 py-1 text-xs font-semibold">{r.terms}</span>
                  </div>
                  {r.unit === bestUnit ? <p className="tint-amber mt-2 inline-block rounded-full px-3 py-1 text-xs font-semibold">Lowest unit price</p> : <div className="h-[30px]" />}

                  <label className="mt-5 block">
                    <span className="flex justify-between text-sm text-muted-foreground">
                      Unit price <b className="tabular text-foreground">{formatMoney(r.unit)}</b>
                    </span>
                    <input type="range" min={370} max={440} step={1} value={r.unit} onChange={(e) => setQ((p) => p.map((x, k) => (k === i ? { ...x, unit: Number(e.target.value) } : x)))} className="mt-2 w-full accent-[var(--brand-violet)]" />
                  </label>
                  <label className="mt-4 block">
                    <span className="flex justify-between text-sm text-muted-foreground">
                      Freight <b className="tabular text-foreground">{formatMoney(r.freight)}</b>
                    </span>
                    <input type="range" min={0} max={60000} step={500} value={r.freight} onChange={(e) => setQ((p) => p.map((x, k) => (k === i ? { ...x, freight: Number(e.target.value) } : x)))} className="mt-2 w-full accent-[var(--brand-blue)]" />
                  </label>

                  <div className="mt-7 flex h-4 overflow-hidden rounded-full bg-muted">
                    <span className={`${r.accent} transition-all duration-500`} style={{ width: `${goods}%` }} />
                    <span className="bg-amber transition-all duration-500" style={{ width: `${tax}%` }} />
                    <span className="bg-coral transition-all duration-500" style={{ width: `${frt}%` }} />
                  </div>
                  <div className="mt-2 flex justify-between text-[11px] text-subtle-foreground">
                    <span>Goods</span>
                    <span>GST</span>
                    <span>Freight</span>
                  </div>

                  <p className="mt-6 text-sm text-muted-foreground">Total landed cost</p>
                  <p className={`text-4xl font-semibold tabular transition-colors sm:text-5xl ${best ? "text-emerald" : "text-foreground"}`}>{formatMoney(r.landed.total)}</p>
                </div>
              </Reveal>
            );
          })}
        </div>

        <Reveal className="mt-10 flex flex-col items-center justify-between gap-4 rounded-3xl bg-navy p-6 text-white sm:flex-row sm:p-8">
          <p className="text-lg leading-snug sm:text-xl">
            {trap && winner && sticker ? (
              <>
                <b>{sticker.name}</b> has the lowest unit price, yet <b className="text-emerald">{winner.name}</b> is <b className="text-emerald">{formatMoney(gap)}</b> cheaper once GST and freight land.
              </>
            ) : (
              <>Right now the lowest price tag and the lowest bill agree. Nudge a freight slider and watch that change.</>
            )}
          </p>
          <button type="button" onClick={() => setQ(START.map((s) => ({ unit: s.unit, freight: s.freight })))} className="inline-flex shrink-0 items-center gap-2 rounded-full border border-white/20 px-5 py-3 font-semibold transition hover:bg-white/10">
            <RotateCcw className="h-4 w-4" /> Reset
          </button>
        </Reveal>
      </div>
    </section>
  );
}
