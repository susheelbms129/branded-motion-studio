import { getSupabase } from "@/lib/supabase";

/**
 * Fair Rank, browser and server side. The browser only asks and displays. The formula, the numbers and who may see what are
 * decided by the database (supabase/migrations/20261129000018_fair_ranking.sql): position is earned from trust, response
 * and delivery, never bought; a supplier sees only its OWN breakdown; buyers see the evidence, not the points.
 */

export const FAIR_RANK_KEY = "fair-rank";

export interface FairRankRules {
  version: number;
  max: number;
  trust: { max: number; by_level: Record<string, number> };
  response: {
    max: number;
    answered_weight: number;
    speed_weight: number;
    speed_bands: { within_hours: number; score: number }[];
    slower_score: number;
  };
  delivery: { max: number };
  window_days: number;
  prior: number;
  prior_weight: number;
  min_samples: number;
  tie_band: number;
}

export interface MyFairRank {
  day: string;
  level: 0 | 1 | 2 | 3;
  /** False when the supplier has no valid proof today: unverified suppliers are listed last and have no score. */
  ranked: boolean;
  /** No RFQs closed and no orders finished in the window yet: scored on the neutral middle, not as bad. */
  is_new: boolean;
  score: number | null;
  /** The share of the OTHER verified suppliers this one is at or ahead of. No names, ever. */
  ahead_of_pct: number | null;
  verified_suppliers: number;
  trust: { points: number; max: number };
  response: { points: number; max: number; rfqs_counted: number; answered: number; quoted: number; median_hours: number | null };
  delivery: { points: number; max: number; orders_counted: number; on_time: number };
  rules: FairRankRules;
}

/** What a buyer sees about one supplier's record. A statistic stays null until there are enough real data points. */
export interface SupplierRecord {
  fair_score: number | null;
  is_new: boolean;
  window_days: number;
  reply_hours: number | null;
  answered_pct: number | null;
  on_time_pct: number | null;
  rfqs_counted: number;
  orders_counted: number;
}

const ERRORS: Record<string, string> = {
  not_authenticated: "Please sign in again.",
  not_allowed: "This isn't available for your account.",
  not_found: "We couldn't find this supplier.",
  invalid_sort: "That sort order isn't available.",
};

const message = (e: unknown) =>
  e instanceof Error ? e.message : e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : "";

export function fairRankError(e: unknown): string {
  const m = message(e);
  if (m.includes("Could not find the function")) {
    return "Fair Rank isn't set up yet. Run migration 18 (20261129000018_fair_ranking.sql) in Supabase.";
  }
  const k = Object.keys(ERRORS).find((x) => m.includes(x));
  return k ? ERRORS[k]! : "Something went wrong. Please check your connection and try again.";
}

/** The formula, read live. This is the same function the ranking itself runs, so the page can never be out of date. */
export async function getFairRankRules(): Promise<FairRankRules> {
  const { data, error } = await getSupabase().rpc("get_fair_rank_rules");
  if (error) throw new Error(fairRankError(error));
  return data as FairRankRules;
}

export async function getMyFairRank(orgId: string): Promise<MyFairRank> {
  const { data, error } = await getSupabase().rpc("get_my_fair_rank", { p_org: orgId });
  if (error) throw new Error(fairRankError(error));
  return data as MyFairRank;
}

export async function getSupplierRecord(orgId: string): Promise<SupplierRecord> {
  const { data, error } = await getSupabase().rpc("get_supplier_record", { p_org: orgId });
  if (error) throw new Error(fairRankError(error));
  return data as SupplierRecord;
}

// ───────── plain-language helpers (pure, so a test can check them) ─────────

/** "about 3 hours", "about 2 days". Null when there are not enough replies to say. */
export function hoursText(h: number | null | undefined): string {
  if (h === null || h === undefined || !Number.isFinite(h)) return "Not enough replies yet";
  if (h < 1) return "under an hour";
  if (h < 24) {
    const n = Math.round(h);
    return `about ${n} ${n === 1 ? "hour" : "hours"}`;
  }
  const d = Math.round(h / 24);
  return `about ${d} ${d === 1 ? "day" : "days"}`;
}

export type RankTier = "Excellent" | "Strong" | "Building" | "Getting started";

export function rankTier(score: number | null): RankTier | null {
  if (score === null) return null;
  if (score >= 80) return "Excellent";
  if (score >= 65) return "Strong";
  if (score >= 50) return "Building";
  return "Getting started";
}

export interface RankTip {
  id: string;
  title: string;
  body: string;
}

/**
 * What a supplier can DO to rank higher, in order of what is worth most. Honest by construction: every tip is something
 * the supplier controls (a proof, a reply, a delivery). There is no tip that costs money, because nothing does.
 */
export function rankTips(r: MyFairRank): RankTip[] {
  if (!r.ranked) {
    return [
      {
        id: "verify",
        title: "Get your registration verified",
        body: "Suppliers without a valid proof are listed after every verified supplier. Verification is free and takes minutes.",
      },
    ];
  }
  const tips: (RankTip & { worth: number })[] = [];
  const by = r.rules.trust.by_level;
  const next = r.level < 3 ? (by[String(r.level + 1)] ?? 0) - (by[String(r.level)] ?? 0) : 0;
  if (r.level === 1) {
    tips.push({ id: "trust", worth: next, title: `Add an address and a bank proof (+${next} points)`, body: "Two more checked proofs move you from Registered to Verified. Buyers see each one with its date." });
  } else if (r.level === 2) {
    tips.push({ id: "trust", worth: next, title: `Add a certificate (+${next} points)`, body: "A reviewed certificate (ISO, BIS, FSSAI and others) takes you to Verified + Certificates." });
  }
  const rp = r.response;
  if (rp.rfqs_counted === 0) {
    tips.push({ id: "first-reply", worth: rp.max - rp.points, title: "Answer your first RFQ within 4 hours", body: "Until you have answered a few, you sit on the neutral middle. A quick, real quote moves you up." });
  } else {
    if (rp.answered / rp.rfqs_counted < 0.9) {
      tips.push({ id: "answer-all", worth: (rp.max - rp.points) * 0.6, title: "Answer every RFQ, even with a clear no", body: "RFQs left unanswered until their due date count against you. A fast, honest decline counts as an answer." });
    }
    if (rp.quoted > 0 && (rp.median_hours ?? 0) > 24) {
      tips.push({ id: "speed", worth: (rp.max - rp.points) * 0.5, title: "Send quotes within 24 hours", body: `Your typical reply takes ${hoursText(rp.median_hours)}. Replies within 4 hours earn full speed points.` });
    }
  }
  const dl = r.delivery;
  if (dl.orders_counted === 0) {
    tips.push({ id: "first-delivery", worth: dl.max - dl.points, title: "Deliver your first order on time", body: "You are on the neutral middle for delivery until buyers record deliveries. One on-time order starts your record." });
  } else if (dl.on_time / dl.orders_counted < 0.9) {
    tips.push({ id: "on-time", worth: dl.max - dl.points, title: "Promise delivery days you can keep", body: "Orders that arrive after the promised date, or are cancelled after you confirmed them, cost delivery points." });
  }
  return tips
    .sort((a, b) => b.worth - a.worth)
    .slice(0, 3)
    .map((t): RankTip => ({ id: t.id, title: t.title, body: t.body }));
}

/** The commitments, in the words shown to everyone. Each one is enforced by the database or a test, not by goodwill. */
export const FAIR_PROMISES: { title: string; body: string }[] = [
  { title: "Rank can't be bought", body: "No paid placement, no sponsored listings, no boosts. There is no price list because there is nothing to buy." },
  { title: "No selling of leads", body: "A buyer's RFQ goes only to the suppliers that buyer chose, free. Suppliers never pay to see or win a buyer." },
  { title: "Everyone sees the same order", body: "The order doesn't change with who is looking, which buyer, or any money. Equal suppliers take turns each day." },
  { title: "Newcomers get a fair start", body: "No history is never treated as bad history. It takes real evidence to move up or down." },
  { title: "Only real, recent evidence", body: "Replies and deliveries from the last 180 days count. Buyers record deliveries, so a supplier can't mark its own homework." },
];
