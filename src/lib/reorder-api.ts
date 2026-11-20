import { getSupabase } from "@/lib/supabase";

/**
 * One-click reorder with a memory, browser side (supabase/migrations/20261203000022_reorder.sql).
 * The database re-checks the supplier today, copies prices / GST / terms from the earlier order, refuses duplicates, enforces the
 * owner-only line and the daily limit, and learns the buyer's rhythm. The browser sends ONLY line ids and quantities
 * (plus an optional address and note), so a tampered request cannot move a price. This file asks, words the answer and does the sums for display.
 */

export const REORDER_KEY = "reorder";
export const OWNER_ONLY_ABOVE = 200000;
export const MAX_QTY = 99999999;

export type Blocker = "role" | "not_delivered" | "supplier_not_verified" | "no_lines";

export interface ReorderLine {
  id: string;
  description: string;
  unit: string;
  qty: number;
  unit_price: number;
  gst_rate: number;
  /** What the buyer paid for this line on the order before the source order (null when there is none). */
  earlier_price: number | null;
  earlier_on: string | null;
}
export interface Rhythm {
  orders: number;
  last_order_on: string | null;
  gap_days: number | null;
  next_due: string | null;
  /** Negative when the next order is late. */
  days_until: number | null;
}
export interface ReorderPreview {
  source: {
    id: string;
    number: string;
    title: string;
    category: string;
    status: string;
    issued_at: string | null;
    expected_at: string | null;
    delivered_at: string | null;
    /** Positive = late, negative = early, null = unknown. */
    days_vs_promise: number | null;
    lead_days: number;
    payment_terms_days: number;
    delivery_address: string;
    shipping: number;
    other_charges: number;
    currency: string;
  };
  supplier: {
    id: string;
    name: string;
    city: string;
    state: string;
    level_now: number;
    verified_today: boolean;
  };
  lines: ReorderLine[];
  amounts: {
    subtotal: number;
    gst: number;
    shipping: number;
    other_charges: number;
    total: number;
  };
  rhythm: Rhythm;
  duplicate: { id: string; number: string; status: string; issued_at: string | null } | null;
  blockers: Blocker[];
  can_reorder: boolean;
  role: string;
  limit: { owner_only_above: number; you_may_exceed: boolean };
}
export interface ReorderSuggestion {
  po_id: string;
  number: string;
  title: string;
  supplier_id: string;
  supplier_name: string;
  delivered_at: string | null;
  total: number;
  orders: number;
  gap_days: number | null;
  next_due: string | null;
  days_until: number | null;
  open_order: boolean;
  verified_today: boolean;
}
export interface ReorderContext {
  reordered_from: { id: string; number: string } | null;
  reorders: { id: string; number: string; status: string }[];
}
export interface SupplierReorderInfo {
  is_reorder: boolean;
  source_number: string | null;
  source_delivered_at: string | null;
  orders_together: number;
}
export interface ReorderInput {
  lines: { id: string; qty: number }[];
  deliveryAddress?: string;
  notes?: string;
  allowDuplicate?: boolean;
}

/** Plain-language messages for every code the database can raise. */
const ERRORS: Record<string, string> = {
  not_authenticated: "Please sign in again.",
  not_allowed: "Only an owner or a procurement manager can reorder.",
  not_found: "This order isn't available. It may have been removed.",
  not_delivered: "Only an order that has been delivered can be reordered.",
  supplier_not_verified:
    "This supplier is no longer verified (a proof may have expired), so it can't be reordered right now. Check its Trust Passport.",
  invalid_lines: "Choose at least one item from the earlier order.",
  invalid_quantity: "Enter a quantity above zero, with up to 3 decimals.",
  invalid_address: "Enter the delivery address (5 to 500 characters).",
  invalid_notes: "The note can be up to 1000 characters.",
  invalid_request: "Something is wrong with this reorder. Please check the form.",
  duplicate_open:
    'An order for the same items is already on its way from this supplier. Tick "order again anyway" if you really want a second one.',
  owner_required:
    "Orders above ₹2,00,000 can only be placed by the company owner, so a second person always sees them.",
  daily_limit: "Your company has reached today's limit of 30 reorders. Please try again tomorrow.",
};

export function reorderError(e: unknown): string {
  const m =
    e instanceof Error
      ? e.message
      : typeof e === "object" && e && "message" in e
        ? String((e as { message: unknown }).message)
        : "";
  if (m.includes("Could not find the function")) {
    return "Reorder isn't set up yet. Run migration 22 (20261203000022_reorder.sql) in Supabase.";
  }
  const k = Object.keys(ERRORS).find((x) => m.includes(x));
  return k ? ERRORS[k]! : "Something went wrong. Please check your connection and try again.";
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabase().rpc(fn, args);
  if (error) throw new Error(reorderError(error));
  return data as T;
}

const num = (v: unknown) => Number(v ?? 0);
const numOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export async function previewReorder(poId: string): Promise<ReorderPreview> {
  const d = await rpc<ReorderPreview>("preview_reorder", { p_po: poId });
  return {
    ...d,
    source: {
      ...d.source,
      payment_terms_days: num(d.source.payment_terms_days),
      lead_days: num(d.source.lead_days),
      shipping: num(d.source.shipping),
      other_charges: num(d.source.other_charges),
    },
    lines: (d.lines ?? []).map((l) => ({
      ...l,
      qty: num(l.qty),
      unit_price: num(l.unit_price),
      gst_rate: num(l.gst_rate),
      earlier_price: numOrNull(l.earlier_price),
    })),
    amounts: {
      subtotal: num(d.amounts?.subtotal),
      gst: num(d.amounts?.gst),
      shipping: num(d.amounts?.shipping),
      other_charges: num(d.amounts?.other_charges),
      total: num(d.amounts?.total),
    },
    limit: {
      owner_only_above: num(d.limit?.owner_only_above) || OWNER_ONLY_ABOVE,
      you_may_exceed: d.limit?.you_may_exceed === true,
    },
    blockers: d.blockers ?? [],
    can_reorder: d.can_reorder === true,
  };
}

export async function reorderPurchaseOrder(
  poId: string,
  input: ReorderInput,
): Promise<{ id: string; number: string; total: number }> {
  const d = await rpc<{ id: string; number: string; total: number }>("reorder_purchase_order", {
    p_po: poId,
    p_data: input,
  });
  return { ...d, total: num(d.total) };
}

export async function listReorderSuggestions(
  orgId: string,
  limit = 12,
): Promise<{ items: ReorderSuggestion[]; can_reorder: boolean }> {
  const d = await rpc<{ items?: ReorderSuggestion[]; can_reorder?: boolean } | null>(
    "list_reorder_suggestions",
    { p_org: orgId, p_limit: limit },
  );
  return {
    items: (d?.items ?? []).map((r) => ({
      ...r,
      total: num(r.total),
      orders: num(r.orders),
      gap_days: numOrNull(r.gap_days),
      days_until: numOrNull(r.days_until),
    })),
    can_reorder: d?.can_reorder === true,
  };
}

export async function getReorderContext(poId: string): Promise<ReorderContext> {
  const d = await rpc<Partial<ReorderContext> | null>("get_reorder_context", { p_po: poId });
  return { reordered_from: d?.reordered_from ?? null, reorders: d?.reorders ?? [] };
}

export async function getSupplierReorderInfo(
  orgId: string,
  poId: string,
): Promise<SupplierReorderInfo> {
  const d = await rpc<Partial<SupplierReorderInfo> | null>("get_supplier_reorder_info", {
    p_org: orgId,
    p_po: poId,
  });
  return {
    is_reorder: d?.is_reorder === true,
    source_number: d?.source_number ?? null,
    source_delivered_at: d?.source_delivered_at ?? null,
    orders_together: num(d?.orders_together),
  };
}

// ── words and sums for the screen (the database decides; these only display) ──

const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

/** "Last delivery came 2 days late." */
export function deliveryText(daysVsPromise: number | null): string {
  if (daysVsPromise === null || Number.isNaN(daysVsPromise))
    return "Last delivery date wasn't recorded.";
  if (daysVsPromise === 0) return "Last delivery came on the promised day.";
  if (daysVsPromise < 0) return `Last delivery came ${plural(-daysVsPromise, "day")} early.`;
  return `Last delivery came ${plural(daysVsPromise, "day")} late.`;
}

export type DeliveryTone = "good" | "warn" | "bad" | "none";
export function deliveryTone(daysVsPromise: number | null): DeliveryTone {
  if (daysVsPromise === null || Number.isNaN(daysVsPromise)) return "none";
  if (daysVsPromise <= 0) return "good";
  return daysVsPromise <= 3 ? "warn" : "bad";
}

/** "Due in 6 days", "Due today", "9 days late". Null when there is no rhythm yet. */
export function dueText(daysUntil: number | null): string | null {
  if (daysUntil === null || Number.isNaN(daysUntil)) return null;
  if (daysUntil === 0) return "Due today";
  if (daysUntil === 1) return "Due tomorrow";
  if (daysUntil > 0) return `Due in ${plural(daysUntil, "day")}`;
  return `${plural(-daysUntil, "day")} late`;
}

export type DueTone = "late" | "soon" | "later" | "none";
export function dueTone(daysUntil: number | null): DueTone {
  if (daysUntil === null || Number.isNaN(daysUntil)) return "none";
  if (daysUntil < 0) return "late";
  return daysUntil <= 14 ? "soon" : "later";
}

/** "You usually reorder this every 30 days (3 orders so far)." */
export function rhythmText(r: Rhythm | null | undefined): string {
  if (!r || r.orders < 2 || r.gap_days === null)
    return "Order this again and Vendora will learn how often you need it.";
  return `You usually reorder this every ${plural(r.gap_days, "day")} (${plural(r.orders, "order")} so far).`;
}

/** Price change since the order before: null when there is nothing to compare. Rounded to one decimal. */
export function priceChangePct(now: number, earlier: number | null): number | null {
  if (earlier === null || !Number.isFinite(earlier) || earlier <= 0 || !Number.isFinite(now))
    return null;
  const pct = ((now - earlier) / earlier) * 100;
  return Math.round(pct * 10) / 10;
}

export function priceChangeText(pct: number | null): string {
  if (pct === null) return "No earlier price";
  if (pct === 0) return "Same as before";
  return `${pct > 0 ? "▲" : "▼"} ${Math.abs(pct)}% vs before`;
}

/** Parse what a person typed as a quantity: up to 3 decimals, above zero. Null when it isn't valid. */
export function parseQty(text: string): number | null {
  const t = text.trim();
  if (!/^\d+(\.\d{1,3})?$/.test(t)) return null;
  const n = Number(t);
  return n > 0 && n <= MAX_QTY ? n : null;
}

/** The total the order will come to, using the prices copied from the earlier order. Mirrors the database (GST per line, charges as before). */
export function estimateTotal(
  lines: { qty: number | null; unit_price: number; gst_rate: number }[],
  shipping: number,
  otherCharges: number,
): number {
  // same order of rounding as the database: add up the lines first, then round the subtotal and the GST to paise
  let sub = 0;
  let gst = 0;
  for (const l of lines) {
    if (l.qty === null) continue;
    sub += l.qty * l.unit_price;
    gst += (l.qty * l.unit_price * l.gst_rate) / 100;
  }
  sub = Math.round(sub * 100) / 100;
  gst = Math.round(gst * 100) / 100;
  return Math.round((sub + gst + shipping + otherCharges) * 100) / 100;
}

/** True when this person may not place an order of this size (the database makes the final call). */
export function needsOwner(
  total: number,
  youMayExceed: boolean,
  ownerOnlyAbove = OWNER_ONLY_ABOVE,
): boolean {
  return total > ownerOnlyAbove && !youMayExceed;
}

/** Why a reorder can't be placed, in words. Empty when it can. */
export function blockerText(b: Blocker): string {
  switch (b) {
    case "role":
      return "Only an owner or a procurement manager can reorder.";
    case "not_delivered":
      return "Only a delivered order can be reordered.";
    case "supplier_not_verified":
      return "This supplier is not verified today, so it can't be reordered right now.";
    case "no_lines":
      return "This order has no items to reorder.";
  }
}
