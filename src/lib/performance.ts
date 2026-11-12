import { differenceInCalendarDays, parseISO } from "date-fns";

import type { PurchaseOrder, Quotation, Rfq } from "@/types/domain";

export interface SupplierPerformance {
  supplierId: string;
  /** 0..100 or null when there is not enough history */
  score: number | null;
  onTimeRate: number | null; // 0..1
  deliveredCount: number;
  onTimeCount: number;
  avgDelayDays: number | null;
  priceVariance: number | null; // avg % vs category median quote (negative = cheaper)
  quotesCompared: number;
  responseRate: number | null; // 0..1
  invitedCount: number;
  respondedCount: number;
  weights: { onTime: number; price: number; response: number };
}

export const PERFORMANCE_WEIGHTS = { onTime: 0.5, price: 0.3, response: 0.2 };
export const MIN_DELIVERIES = 2;

/** Computed only from POs, RFQ invites and quotations. Never invented. */
export function computeSupplierPerformance(
  supplierId: string,
  pos: PurchaseOrder[],
  rfqs: Rfq[],
  quotations: Quotation[],
): SupplierPerformance {
  const delivered = pos.filter((p) => p.supplierId === supplierId && p.deliveredAt);
  const onTime = delivered.filter(
    (p) => differenceInCalendarDays(parseISO(p.deliveredAt as string), parseISO(p.expectedAt)) <= 0,
  );
  const delays = delivered.map((p) =>
    Math.max(0, differenceInCalendarDays(parseISO(p.deliveredAt as string), parseISO(p.expectedAt))),
  );

  const invites = rfqs.flatMap((r) => r.invites.filter((i) => i.supplierId === supplierId && r.status !== "draft"));
  const responded = invites.filter((i) => i.status === "quoted");

  // price variance vs median of competing quotes on the same RFQ
  const variances: number[] = [];
  for (const q of quotations.filter((x) => x.supplierId === supplierId)) {
    const peers = quotations.filter((x) => x.rfqId === q.rfqId);
    if (peers.length < 2) continue;
    const totals = peers.map((p) => p.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0)).sort((a, b) => a - b);
    const median = totals[Math.floor(totals.length / 2)];
    const mine = q.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
    if (median > 0) variances.push((mine - median) / median);
  }

  const onTimeRate = delivered.length >= MIN_DELIVERIES ? onTime.length / delivered.length : null;
  const responseRate = invites.length > 0 ? responded.length / invites.length : null;
  const priceVariance = variances.length > 0 ? variances.reduce((a, b) => a + b, 0) / variances.length : null;

  let score: number | null = null;
  if (onTimeRate !== null) {
    // price component: 0% variance => 70, -15% => 100, +15% => 40 (clamped)
    const priceScore = priceVariance === null ? 0.7 : clamp(0.7 - priceVariance * 2, 0, 1);
    const respScore = responseRate ?? 0.5;
    score = Math.round(
      (onTimeRate * PERFORMANCE_WEIGHTS.onTime + priceScore * PERFORMANCE_WEIGHTS.price + respScore * PERFORMANCE_WEIGHTS.response) * 100,
    );
  }

  return {
    supplierId,
    score,
    onTimeRate,
    deliveredCount: delivered.length,
    onTimeCount: onTime.length,
    avgDelayDays: delays.length ? delays.reduce((a, b) => a + b, 0) / delays.length : null,
    priceVariance,
    quotesCompared: variances.length,
    responseRate,
    invitedCount: invites.length,
    respondedCount: responded.length,
    weights: PERFORMANCE_WEIGHTS,
  };
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}
