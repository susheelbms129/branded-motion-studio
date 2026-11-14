import { calculateLandedCost, type LandedCost } from "@/lib/landed-cost";
import type { RfqQuote } from "@/lib/rfq-quotes-api";

/**
 * Compare real quotes on what the buyer will actually pay (total landed cost: items + GST + freight + other charges),
 * not on the sticker price. Pure and deterministic: no clock, no network, so it is easy to test and to trust.
 *
 * It reuses calculateLandedCost from landed-cost.ts. Ranking uses the supplier's Trust Passport level as the "can I rely on
 * them" signal (delivery record arrives with the supplier scorecard, Task 19). Nothing here can be bought: no paid rank.
 */

export type Priority = "balanced" | "cheapest" | "fastest" | "cashflow";

export const PRIORITIES: { id: Priority; label: string; hint: string }[] = [
  { id: "balanced", label: "Balanced", hint: "Cost first, then speed, payment terms and trust" },
  { id: "cheapest", label: "Lowest cost", hint: "Total landed cost matters most" },
  { id: "fastest", label: "Fastest", hint: "Delivery time matters most" },
  { id: "cashflow", label: "Cash flow", hint: "Longer payment terms matter most" },
];

interface Weights {
  cost: number;
  delivery: number;
  payment: number;
  trust: number;
}
export const PRIORITY_WEIGHTS: Record<Priority, Weights> = {
  balanced: { cost: 50, delivery: 20, payment: 15, trust: 15 },
  cheapest: { cost: 80, delivery: 5, payment: 5, trust: 10 },
  fastest: { cost: 25, delivery: 55, payment: 5, trust: 15 },
  cashflow: { cost: 35, delivery: 10, payment: 45, trust: 10 },
};

/** A quote this many days (or fewer) from its validity date is flagged. */
export const EXPIRES_SOON_DAYS = 3;

export interface QuoteView {
  quote: RfqQuote;
  landed: LandedCost;
  /** Validity date has passed: shown, but never ranked or recommended. */
  expired: boolean;
  /** The supplier already declined an order for this quote: shown, never ranked or recommended. */
  declined: boolean;
  /** Days left (0 = last day). Null when the quote has no validity date. */
  daysLeft: number | null;
  expiresSoon: boolean;
  /** Verified when invited, but a proof has lapsed since. */
  lapsed: boolean;
  /** 1 = best. Null for an expired or declined quote. */
  rank: number | null;
  /** 0..100 on the chosen priority. Null for an expired quote. */
  fit: number | null;
  /** Total landed cost above the cheapest valid quote (0 for the cheapest). */
  aboveLowest: number;
  aboveLowestPct: number;
  /** Hours between the RFQ going out and this quote (latest revision). */
  replyHours: number | null;
  reasons: string[];
}

export interface Comparison {
  views: QuoteView[];
  /** The recommended quote, or null when there is no valid quote. */
  pick: QuoteView | null;
  insights: string[];
  stats: {
    valid: number;
    lowest: number | null;
    highest: number | null;
    average: number | null;
    /** How much cheaper the pick is than the average valid quote (0 when not cheaper). */
    pickSavesVsAverage: number;
    /** Highest valid quote above the lowest, in percent. */
    spreadPct: number;
  };
  /** The lowest unit price per item among valid quotes, used to highlight the best price per line. */
  bestLinePrice: Record<string, number>;
}

const DAY = 86_400_000;
const round2 = (n: number) => Math.round(n * 100) / 100;

function dayNumber(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return Math.round(Date.UTC(y!, (m ?? 1) - 1, d ?? 1) / DAY);
}

export function daysBetween(fromYmd: string, toYmd: string): number {
  return dayNumber(toYmd) - dayNumber(fromYmd);
}

export function landedOf(q: RfqQuote): LandedCost {
  return calculateLandedCost({
    lines: q.lines.map((l) => ({ qty: l.qty, unitPrice: l.unit_price })),
    gstRate: q.gst_rate,
    shipping: q.shipping,
    otherCharges: q.other_charges,
  });
}

/** Min-max to 0..1. All equal means everyone is equally good (1). */
function norm(vals: number[], v: number, higherIsBetter: boolean): number {
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  if (max === min) return 1;
  const t = (v - min) / (max - min);
  return higherIsBetter ? t : 1 - t;
}

/** The one value that is strictly best, or null when several tie (a tie is not worth a badge). */
function onlyBest(vals: number[], lower: boolean): number | null {
  if (vals.length < 2) return null;
  const best = lower ? Math.min(...vals) : Math.max(...vals);
  return vals.filter((v) => v === best).length === 1 && new Set(vals).size > 1 ? best : null;
}

export function compareQuotes(
  quotes: RfqQuote[],
  today: string,
  priority: Priority = "balanced",
  money: (n: number) => string = (n) => n.toFixed(2),
): Comparison {
  const w = PRIORITY_WEIGHTS[priority];
  const base = quotes.map((quote) => {
    const daysLeft = quote.valid_until ? daysBetween(today, quote.valid_until) : null;
    const expired = daysLeft !== null && daysLeft < 0;
    const declined = quote.declined_order === true;
    return {
      quote,
      landed: landedOf(quote),
      expired,
      declined,
      out: expired || declined,
      daysLeft,
      expiresSoon: !expired && daysLeft !== null && daysLeft <= EXPIRES_SOON_DAYS,
      lapsed: quote.level_at_send != null && quote.level_now < quote.level_at_send,
      replyHours: quote.sent_at
        ? Math.max(
            0,
            Math.round(
              ((Date.parse(quote.received_at) - Date.parse(quote.sent_at)) / 3_600_000) * 10,
            ) / 10,
          )
        : null,
    };
  });

  const valid = base.filter((b) => !b.out);
  const costs = valid.map((b) => b.landed.total);
  const days = valid.map((b) => b.quote.delivery_days);
  const terms = valid.map((b) => b.quote.payment_terms_days);
  const wSum = w.cost + w.delivery + w.payment + w.trust || 1;
  const lowest = costs.length ? Math.min(...costs) : null;

  const scored = base.map((b) => {
    if (b.out) return { ...b, fit: null as number | null };
    const s =
      norm(costs, b.landed.total, false) * w.cost +
      norm(days, b.quote.delivery_days, false) * w.delivery +
      norm(terms, b.quote.payment_terms_days, true) * w.payment +
      (Math.min(Math.max(b.quote.level_now, 0), 3) / 3) * w.trust;
    return { ...b, fit: Math.round((s / wSum) * 1000) / 10 };
  });

  const order = (a: (typeof scored)[number], b: (typeof scored)[number]) =>
    (b.fit ?? -1) - (a.fit ?? -1) ||
    a.landed.total - b.landed.total ||
    a.quote.received_at.localeCompare(b.quote.received_at) ||
    a.quote.quote_id.localeCompare(b.quote.quote_id);
  const sorted = [
    ...scored.filter((s) => !s.out).sort(order),
    ...scored.filter((s) => s.out).sort(order),
  ];

  const bestCost = onlyBest(costs, true);
  const bestDays = onlyBest(days, true);
  const bestTerms = onlyBest(terms, false);
  const trustVals = valid.map((b) => b.quote.level_now);
  const bestTrust = onlyBest(trustVals, false);

  const views: QuoteView[] = sorted.map((s, i) => {
    const reasons: string[] = [];
    if (!s.out) {
      if (bestCost !== null && s.landed.total === bestCost) {
        const second = [...costs].sort((a, b) => a - b)[1]!;
        reasons.push(
          `Lowest total landed cost, ${money(round2(second - bestCost))} below the next quote`,
        );
      }
      if (bestDays !== null && s.quote.delivery_days === bestDays)
        reasons.push(`Fastest delivery (${bestDays} days)`);
      if (bestTerms !== null && s.quote.payment_terms_days === bestTerms)
        reasons.push(`Longest payment terms (${bestTerms} days)`);
      if (bestTrust !== null && s.quote.level_now === bestTrust && bestTrust > 0)
        reasons.push("Highest verification level among bidders");
    }
    const above = s.out || lowest === null ? 0 : round2(s.landed.total - lowest);
    return {
      quote: s.quote,
      landed: s.landed,
      expired: s.expired,
      declined: s.declined,
      daysLeft: s.daysLeft,
      expiresSoon: s.expiresSoon,
      lapsed: s.lapsed,
      rank: s.out ? null : i + 1,
      fit: s.fit,
      aboveLowest: above,
      aboveLowestPct: lowest && lowest > 0 ? Math.round((above / lowest) * 1000) / 10 : 0,
      replyHours: s.replyHours,
      reasons,
    };
  });

  const pick = views.find((v) => v.rank === 1) ?? null;
  const average = costs.length ? round2(costs.reduce((a, b) => a + b, 0) / costs.length) : null;
  const highest = costs.length ? Math.max(...costs) : null;

  const insights: string[] = [];
  if (valid.length >= 2) {
    // The headline idea: the lowest sticker price is not always the lowest real price.
    const cheapestSticker = [...valid].sort((a, b) => a.landed.subtotal - b.landed.subtotal)[0]!;
    const cheapestLanded = [...valid].sort((a, b) => a.landed.total - b.landed.total)[0]!;
    if (cheapestSticker.quote.quote_id !== cheapestLanded.quote.quote_id) {
      insights.push(
        `${cheapestSticker.quote.name} shows the lowest item prices, but ${cheapestLanded.quote.name} is ${money(
          round2(cheapestSticker.landed.total - cheapestLanded.landed.total),
        )} cheaper once GST, freight and other charges are added.`,
      );
    }
    if (lowest !== null && highest !== null && lowest > 0 && highest > lowest) {
      insights.push(
        `The highest quote is ${Math.round(((highest - lowest) / lowest) * 100)}% above the lowest (${money(highest)} vs ${money(lowest)}).`,
      );
    }
  }
  const soon = views.filter((v) => v.expiresSoon);
  if (soon.length)
    insights.push(
      `${soon.map((v) => v.quote.name).join(", ")} ${soon.length === 1 ? "expires" : "expire"} within ${EXPIRES_SOON_DAYS} days. Decide before the price lapses.`,
    );
  const lapsed = views.filter((v) => v.lapsed && !v.expired);
  if (lapsed.length)
    insights.push(
      `${lapsed.map((v) => v.quote.name).join(", ")} ${lapsed.length === 1 ? "was" : "were"} verified when invited but a proof has lapsed since. Check the Trust Passport before ordering.`,
    );
  const expired = views.filter((v) => v.expired);
  if (expired.length)
    insights.push(
      `${expired.length} quote${expired.length === 1 ? " has" : "s have"} expired and ${expired.length === 1 ? "is" : "are"} not ranked. Ask the supplier to revise.`,
    );

  const bestLinePrice: Record<string, number> = {};
  for (const b of valid)
    for (const l of b.quote.lines) {
      const cur = bestLinePrice[l.item_id];
      if (cur === undefined || l.unit_price < cur) bestLinePrice[l.item_id] = l.unit_price;
    }

  return {
    views,
    pick,
    insights,
    stats: {
      valid: valid.length,
      lowest,
      highest,
      average,
      pickSavesVsAverage:
        pick && average !== null ? Math.max(0, round2(average - pick.landed.total)) : 0,
      spreadPct:
        lowest && highest && lowest > 0 ? Math.round(((highest - lowest) / lowest) * 1000) / 10 : 0,
    },
    bestLinePrice,
  };
}

/** A spreadsheet-safe cell: a leading = + - @ would be run as a formula by Excel, so it is neutralised. */
export function csvCell(v: string | number): string {
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The comparison as CSV: one column per supplier, so the buyer can share it with their finance team. */
export function comparisonCsv(
  items: { id: string; description: string; qty: number; unit: string }[],
  cmp: Comparison,
): string {
  const vs = cmp.views;
  const row = (label: string, f: (v: QuoteView) => string | number) =>
    [label, ...vs.map(f)].map(csvCell).join(",");
  const lines = [
    row("Supplier", (v) => v.quote.name),
    row("Rank", (v) => v.rank ?? "Expired"),
    ...items.map((it) =>
      row(
        `${it.description} (${it.qty} ${it.unit}) unit price`,
        (v) => v.quote.lines.find((l) => l.item_id === it.id)?.unit_price ?? "",
      ),
    ),
    row("Items subtotal", (v) => v.landed.subtotal),
    row("GST", (v) => v.landed.gst),
    row("Freight", (v) => v.landed.shipping),
    row("Other charges", (v) => v.landed.otherCharges),
    row("Total landed cost", (v) => v.landed.total),
    row("Delivery (days)", (v) => v.quote.delivery_days),
    row("Payment terms (days)", (v) => v.quote.payment_terms_days),
    row("Valid until", (v) => v.quote.valid_until ?? ""),
  ];
  return lines.join("\r\n");
}
