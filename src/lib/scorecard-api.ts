import { getSupabase } from "@/lib/supabase";

/**
 * The Supplier Scorecard, browser side: a record earned from real orders (supabase/migrations/20261202000021_supplier_scorecard.sql).
 * The database counts everything and decides what may be shown. A percentage or a median is null until there are enough real events,
 * and buyers' names and order values never arrive here. This file only asks and words the answer.
 */

export interface ScorecardBadge {
  key: "fast_replies" | "on_time_record" | "repeat_buyers" | "clean_record";
  title: string;
  rule: string;
  earned: boolean;
  /** Progress. Only the supplier itself receives these; buyers and the public get earned badges without them. */
  have?: number;
  need?: number;
  unit?: string;
}

export interface ScorecardMonth {
  month: string; // yyyy-MM
  orders: number;
  on_time: number;
  quotes: number;
  median_hours: number | null;
}

export type OutcomeKind = "early" | "on_time" | "late" | "cancelled";
export interface ScorecardOutcome {
  month: string;
  outcome: OutcomeKind;
  days: number | null;
}

export interface Scorecard {
  window_days: number;
  min_samples: number;
  level: number;
  is_new: boolean;
  replies: {
    rfqs_counted: number;
    answered: number;
    quoted: number;
    answered_pct: number | null;
    median_hours: number | null;
    within_24h_pct: number | null;
  };
  delivery: {
    orders_counted: number;
    delivered: number;
    on_time: number;
    early: number;
    late_1_3: number;
    late_4_plus: number;
    on_time_pct: number | null;
    median_days_vs_promise: number | null;
    cancelled_after_confirming: number;
  };
  buyers: { different: number; repeat: number };
  excluded_same_group: number;
  months: ScorecardMonth[];
  recent: ScorecardOutcome[];
  badges: ScorecardBadge[];
}

const ERRORS: Record<string, string> = {
  not_authenticated: "Please sign in again.",
  not_allowed: "This isn't available for your account.",
  not_found: "We couldn't find this supplier.",
};

export function scorecardError(e: unknown): string {
  const m = e instanceof Error ? e.message : e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : "";
  if (m.includes("Could not find the function")) return "The scorecard isn't set up yet. Run migration 21 (20261202000021_supplier_scorecard.sql) in Supabase.";
  const k = Object.keys(ERRORS).find((x) => m.includes(x));
  return k ? ERRORS[k]! : "We couldn't load the scorecard. Please try again.";
}

export async function getSupplierScorecard(orgId: string): Promise<Scorecard> {
  const { data, error } = await getSupabase().rpc("get_supplier_scorecard", { p_org: orgId });
  if (error) throw new Error(scorecardError(error));
  return data as Scorecard;
}

// ───────── plain-language helpers (pure, so a test can check them) ─────────

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-11" becomes "Nov". Anything else comes back unchanged. */
export function monthLabel(ym: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) return ym;
  const i = Number(m[2]) - 1;
  return i >= 0 && i < 12 ? MONTHS[i]! : ym;
}
/** "Nov 2026", for the recent-outcomes list. */
export function monthYear(ym: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  return m ? `${monthLabel(ym)} ${m[1]}` : ym;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** One recent result, in words. */
export function outcomeText(o: Pick<ScorecardOutcome, "outcome" | "days">): string {
  switch (o.outcome) {
    case "early": return `Delivered ${plural(o.days ?? 0, "day")} early`;
    case "on_time": return "Delivered on the promised day";
    case "late": return `Delivered ${plural(o.days ?? 0, "day")} late`;
    default: return "Confirmed, then cancelled by the supplier";
  }
}

/** On-time share of one month, 0 to 100, or null when the month had no deliveries (so the gap stays a gap, not a zero). */
export function monthOnTimePct(m: Pick<ScorecardMonth, "orders" | "on_time">): number | null {
  return m.orders > 0 ? Math.round((100 * m.on_time) / m.orders) : null;
}

/** The headline for delivery. Counts always show; the percentage only when the database allowed it. */
export function deliveryHeadline(d: Scorecard["delivery"], minSamples = 3): string {
  if (d.on_time_pct !== null) return `${d.on_time_pct}% on time`;
  if (d.delivered === 0) return "No deliveries yet";
  return `${plural(d.delivered, "delivery", "deliveries")} so far (a percentage appears at ${minSamples})`;
}

export function replyHeadline(r: Scorecard["replies"], minSamples = 3): string {
  if (r.median_hours !== null) return r.median_hours < 1 ? "Replies in under an hour" : `Replies in about ${r.median_hours < 10 ? r.median_hours : Math.round(r.median_hours)} hours`;
  if (r.quoted === 0) return "No quotes yet";
  return `${plural(r.quoted, "quote")} so far (a typical time appears at ${minSamples})`;
}

/** The delivery spread as four parts of a bar, in the order shown. Parts with nothing in them are dropped. */
export function deliverySegments(d: Scorecard["delivery"]): { key: string; label: string; n: number }[] {
  const exact = d.on_time - d.early;
  return [
    { key: "early", label: "Early", n: d.early },
    { key: "on_time", label: "On the day", n: Math.max(exact, 0) },
    { key: "late_1_3", label: "1 to 3 days late", n: d.late_1_3 },
    { key: "late_4_plus", label: "4+ days late", n: d.late_4_plus },
  ].filter((s) => s.n > 0);
}

/** For the supplier only: what is left to earn each badge, nearest first. Earned badges are left out. */
export function badgeProgress(b: ScorecardBadge): { pct: number; left: string } | null {
  if (b.earned || b.have === undefined || b.need === undefined) return null;
  const pct = b.need > 0 ? Math.max(0, Math.min(100, Math.round((100 * b.have) / b.need))) : 0;
  const rest = Math.max(b.need - b.have, 0);
  return { pct, left: rest > 0 ? `${rest} more ${b.unit ?? ""}`.trim() : "keep the standard up (see the rule)" };
}
export function nextBadge(badges: ScorecardBadge[]): ScorecardBadge | null {
  const open = badges.filter((b) => !b.earned && b.have !== undefined && b.need !== undefined);
  if (open.length === 0) return null;
  return [...open].sort((a, b) => (b.have! / b.need!) - (a.have! / a.need!))[0] ?? null;
}
