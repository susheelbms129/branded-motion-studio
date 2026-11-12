import type { Quotation } from "@/types/domain";

export interface LandedCostInput {
  lines: { qty: number; unitPrice: number }[];
  gstRate: number; // percent, e.g. 18
  shipping: number;
  otherCharges: number;
}

export interface LandedCost {
  subtotal: number;
  gst: number;
  shipping: number;
  otherCharges: number;
  total: number;
}

/** Total landed cost = Σ(unit price × qty) + GST on goods + shipping + other charges. Pure. */
export function calculateLandedCost(input: LandedCostInput): LandedCost {
  const subtotal = round2(input.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0));
  const gst = round2((subtotal * input.gstRate) / 100);
  const shipping = round2(input.shipping);
  const otherCharges = round2(input.otherCharges);
  return { subtotal, gst, shipping, otherCharges, total: round2(subtotal + gst + shipping + otherCharges) };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export interface ComparisonWeights {
  cost: number;
  delivery: number;
  paymentTerms: number;
  performance: number;
}

export const DEFAULT_WEIGHTS: ComparisonWeights = { cost: 50, delivery: 20, paymentTerms: 10, performance: 20 };

export interface RankedQuotation {
  quotation: Quotation;
  landed: LandedCost;
  scores: { cost: number; delivery: number; paymentTerms: number; performance: number };
  total: number; // 0..100
  rank: number;
  reasons: string[];
}

/**
 * Rank quotations with min-max normalised criteria. Lower cost and delivery days are better,
 * longer payment terms and higher supplier performance are better.
 */
export function rankQuotations(
  quotations: Quotation[],
  performanceBySupplier: Record<string, number | null>,
  weights: ComparisonWeights,
  supplierName: (id: string) => string = (id) => id,
): RankedQuotation[] {
  if (quotations.length === 0) return [];
  const rows = quotations.map((q) => ({ q, landed: calculateLandedCost(q) }));
  const norm = (vals: number[], v: number, higherIsBetter: boolean) => {
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    if (max === min) return 1;
    const t = (v - min) / (max - min);
    return higherIsBetter ? t : 1 - t;
  };
  const costs = rows.map((r) => r.landed.total);
  const days = rows.map((r) => r.q.deliveryDays);
  const terms = rows.map((r) => r.q.paymentTermsDays);
  const perfs = rows.map((r) => performanceBySupplier[r.q.supplierId] ?? 0);
  const wSum = weights.cost + weights.delivery + weights.paymentTerms + weights.performance || 1;

  const scored = rows.map((r) => {
    const scores = {
      cost: norm(costs, r.landed.total, false),
      delivery: norm(days, r.q.deliveryDays, false),
      paymentTerms: norm(terms, r.q.paymentTermsDays, true),
      performance: norm(perfs, performanceBySupplier[r.q.supplierId] ?? 0, true),
    };
    const total =
      ((scores.cost * weights.cost +
        scores.delivery * weights.delivery +
        scores.paymentTerms * weights.paymentTerms +
        scores.performance * weights.performance) /
        wSum) *
      100;
    return { quotation: r.q, landed: r.landed, scores, total: Math.round(total * 10) / 10 };
  });

  scored.sort((a, b) => b.total - a.total);
  const cheapest = Math.min(...costs);
  const fastest = Math.min(...days);
  const longestTerms = Math.max(...terms);
  const bestPerf = Math.max(...perfs);

  return scored.map((s, i) => {
    const reasons: string[] = [];
    const next = scored[i + 1];
    if (s.landed.total === cheapest) {
      const second = [...costs].sort((a, b) => a - b)[1];
      reasons.push(
        second !== undefined && second > cheapest
          ? `Lowest total landed cost — ${Math.round(second - cheapest).toLocaleString("en-IN")} below the next quote`
          : "Lowest total landed cost",
      );
    }
    if (s.quotation.deliveryDays === fastest) reasons.push(`Fastest delivery (${fastest} days)`);
    if (s.quotation.paymentTermsDays === longestTerms) reasons.push(`Longest payment terms (${longestTerms} days)`);
    const perf = performanceBySupplier[s.quotation.supplierId];
    if (perf !== null && perf !== undefined && perf === bestPerf && perf > 0)
      reasons.push(`Best past performance among bidders (${Math.round(perf)}/100)`);
    if (i === 0 && next)
      reasons.push(`Scores ${(s.total - next.total).toFixed(1)} pts ahead of ${supplierName(next.quotation.supplierId)} on your weights`);
    return { ...s, rank: i + 1, reasons };
  });
}
