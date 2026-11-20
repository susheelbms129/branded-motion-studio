import { getSupabase } from "@/lib/supabase";

/**
 * "Paid vs market": what the buyer paid for an awarded RFQ compared with every real quote suppliers sent for it.
 * The numbers come from the database (supabase/migrations/20261205000024_quote_insights.sql); this file only decides the words
 * and the severity, as pure functions, so a test can prove the rules and the page never shows a claim the rules did not make.
 */

export interface QuoteInsightRow {
  po_id: string;
  po_number: string;
  title: string;
  rfq_id: string;
  issued_at: string | null;
  /** How many real quotes were compared (always 2 or more). */
  quotes: number;
  paid: number;
  average: number;
  cheapest: number;
  dearest: number;
  /** 1 = the cheapest quote was chosen. */
  rank: number;
  pct_vs_average: number;
  diff_vs_average: number;
  extra_vs_cheapest: number;
  saved_vs_dearest: number;
}

export interface QuoteInsightSummary {
  orders: number;
  paid_total: number;
  /** Positive = paid more than the average quote across all compared orders; negative = paid less. */
  vs_average_total: number;
  saved_vs_dearest_total: number;
  extra_vs_cheapest_total: number;
  above_average: number;
  below_average: number;
}

export interface QuoteInsights {
  as_of: string;
  items: QuoteInsightRow[];
  summary: QuoteInsightSummary;
}

export type Tone = "high" | "medium" | "good" | "neutral";

/** At or above FLAG_PCT over the average the order is flagged (HIGH_PCT = high). At GOOD_PCT or more below, it is a good buy. */
export const FLAG_PCT = 8;
export const HIGH_PCT = 15;
export const GOOD_PCT = 3;

export const inr = (n: number) => `₹${Math.round(Math.abs(n)).toLocaleString("en-IN")}`;
const pct = (n: number) => `${Math.abs(Math.round(n))}%`;

export function toneOf(r: Pick<QuoteInsightRow, "pct_vs_average">): Tone {
  if (r.pct_vs_average >= HIGH_PCT) return "high";
  if (r.pct_vs_average >= FLAG_PCT) return "medium";
  if (r.pct_vs_average <= -GOOD_PCT) return "good";
  return "neutral";
}

/** One headline per order, in plain words. */
export function headline(r: QuoteInsightRow): string {
  const t = toneOf(r);
  if (t === "high" || t === "medium") return `You paid ${pct(r.pct_vs_average)} above the average quote`;
  if (t === "good") return `You paid ${pct(r.pct_vs_average)} below the average quote`;
  return "You paid about the average quote";
}

/** The facts behind the headline. Never says the choice was wrong: price is only one reason to pick a supplier. */
export function detail(r: QuoteInsightRow): string {
  const parts = [`${r.quotes} quotes were compared on total landed cost (items, GST, freight and other charges).`];
  if (r.rank === 1) parts.push("You chose the cheapest quote.");
  else if (r.extra_vs_cheapest > 0)
    parts.push(
      `A quote ${inr(r.extra_vs_cheapest)} cheaper was available. Delivery time, terms or trust level may have been good reasons to choose differently.`,
    );
  if (r.diff_vs_average > 0) parts.push(`That is ${inr(r.diff_vs_average)} more than the average of ${inr(r.average)}.`);
  else if (r.diff_vs_average < 0) parts.push(`That is ${inr(r.diff_vs_average)} less than the average of ${inr(r.average)}.`);
  return parts.join(" ");
}

/** What to do next, only when there is something to do. */
export function nextStep(r: QuoteInsightRow): string | null {
  const t = toneOf(r);
  if (t === "high" || t === "medium")
    return "Next time, ask your chosen supplier to match the lowest quote, or invite one more supplier to the RFQ before you award.";
  return null;
}

const EMPTY: QuoteInsightSummary = {
  orders: 0,
  paid_total: 0,
  vs_average_total: 0,
  saved_vs_dearest_total: 0,
  extra_vs_cheapest_total: 0,
  above_average: 0,
  below_average: 0,
};

const num = (v: unknown) => Number(v ?? 0);

export async function getQuoteInsights(orgId: string): Promise<QuoteInsights> {
  const { data, error } = await getSupabase().rpc("get_quote_insights", { p_org: orgId });
  if (error) {
    const m = error.message ?? "";
    if (m.includes("Could not find the function"))
      throw new Error("Real insights aren't set up yet. Run migration 24 (20261205000024_quote_insights.sql) in Supabase.");
    if (m.includes("not_allowed")) throw new Error("Only members of this company can see these insights.");
    throw new Error("We couldn't load your insights. Please check your connection and try again.");
  }
  const d = (data ?? {}) as Partial<QuoteInsights>;
  const s = (d.summary ?? EMPTY) as QuoteInsightSummary;
  return {
    as_of: d.as_of ?? "",
    items: (d.items ?? []).map((r) => ({
      ...r,
      quotes: num(r.quotes),
      paid: num(r.paid),
      average: num(r.average),
      cheapest: num(r.cheapest),
      dearest: num(r.dearest),
      rank: num(r.rank),
      pct_vs_average: num(r.pct_vs_average),
      diff_vs_average: num(r.diff_vs_average),
      extra_vs_cheapest: num(r.extra_vs_cheapest),
      saved_vs_dearest: num(r.saved_vs_dearest),
    })),
    summary: {
      orders: num(s.orders),
      paid_total: num(s.paid_total),
      vs_average_total: num(s.vs_average_total),
      saved_vs_dearest_total: num(s.saved_vs_dearest_total),
      extra_vs_cheapest_total: num(s.extra_vs_cheapest_total),
      above_average: num(s.above_average),
      below_average: num(s.below_average),
    },
  };
}
