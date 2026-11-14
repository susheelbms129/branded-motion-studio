import { getSupabase } from "@/lib/supabase";

/**
 * Purchase orders, browser side, for BOTH sides. The browser only asks and displays. WHO may award a quote, confirm or
 * decline an order, WHICH quotes may be awarded (not expired, supplier still verified), the order numbers and every input
 * check are decided by the database (supabase/migrations/20261127000016_purchase_orders.sql). An order is built from the
 * supplier's own quote, so the order can never disagree with it.
 */

export const ORDERS_KEY = "orders";
export const MIN_ADDRESS = 5;
export const MAX_ADDRESS = 500;
export const MAX_ORDER_NOTE = 1000;
export const MAX_RESPONSE_NOTE = 500;
/** The browser event a page fires after a supplier answers an order, so the menu badge refreshes. */
export const ORDERS_CHANGED = "vendora:orders-changed";

export type OrderStatus =
  | "issued"
  | "acknowledged"
  | "partially_received"
  | "received"
  | "closed"
  | "cancelled";
/** What a supplier sees: new (waiting for them), confirmed, or declined (cancelled). */
export type OrderState = "new" | "confirmed" | "declined";
export type OrderFilter = "all" | OrderState;

export interface OrderAmounts {
  subtotal: number;
  gst: number;
  shipping: number;
  other_charges: number;
  total: number;
}
export interface OrderLine {
  id: string;
  description: string;
  qty: number;
  unit: string;
  unit_price: number;
  gst_rate: number;
}

export interface BuyerOrderRow {
  id: string;
  number: string;
  title: string;
  status: OrderStatus;
  supplier_name: string;
  issued_at: string | null;
  expected_at: string | null;
  rfq_id: string | null;
  rfq_number: string | null;
  currency: string;
  total: number;
}
export interface BuyerOrderList {
  total: number;
  counts: Partial<Record<OrderStatus, number>>;
  items: BuyerOrderRow[];
}
export interface BuyerOrder {
  po: {
    id: string;
    number: string;
    title: string;
    category: string;
    status: OrderStatus;
    created_at: string;
    issued_at: string | null;
    expected_at: string | null;
    acknowledged_at: string | null;
    cancelled_at: string | null;
    cancelled_by: "buyer" | "supplier" | null;
    payment_terms_days: number;
    delivery_address: string;
    notes: string;
    supplier_note: string;
    decline_reason: string;
    rfq_id: string | null;
    rfq_number: string | null;
    created_by_name: string;
    currency: string;
  };
  supplier: { id: string; name: string; city: string; state: string; gstin: string; level_now: number };
  lines: OrderLine[];
  amounts: OrderAmounts;
  can_cancel: boolean;
}

export interface SupplierOrderRow {
  id: string;
  number: string;
  title: string;
  status: OrderStatus;
  state: OrderState;
  buyer_name: string;
  buyer_city: string;
  buyer_state: string;
  currency: string;
  issued_at: string | null;
  expected_at: string | null;
  total: number;
}
export interface SupplierOrderList {
  total: number;
  counts: Partial<Record<OrderState, number>>;
  items: SupplierOrderRow[];
}
export interface SupplierOrder {
  po: {
    id: string;
    number: string;
    title: string;
    category: string;
    status: OrderStatus;
    state: OrderState;
    issued_at: string | null;
    expected_at: string | null;
    acknowledged_at: string | null;
    cancelled_at: string | null;
    cancelled_by: "buyer" | "supplier" | null;
    payment_terms_days: number;
    delivery_address: string;
    notes: string;
    supplier_note: string;
    decline_reason: string;
    currency: string;
  };
  buyer: { name: string; city: string; state: string };
  lines: OrderLine[];
  amounts: OrderAmounts;
  can_respond: boolean;
}

export interface AwardInput {
  deliveryAddress: string;
  notes: string;
}

/** Plain-language messages for every code the database can raise. "quote_not_found" is listed before "not_found". */
const ERRORS: Record<string, string> = {
  not_authenticated: "Please sign in again.",
  quote_not_found: "That quote isn't available any more. Refresh and choose again.",
  quote_expired: "This quote has expired. Ask the supplier to send a revised quote.",
  supplier_not_verified:
    "This supplier is no longer verified (a proof may have expired), so it can't be awarded. Check its Trust Passport.",
  supplier_declined: "This supplier already declined an order for this quote. Choose another quote.",
  already_awarded: "This RFQ has already been awarded.",
  rfq_closed: "This RFQ is closed, so it can't be awarded.",
  not_pending: "This order has already been answered, so it can't be changed.",
  not_allowed: "Only an owner or a procurement manager can do this.",
  not_found: "This order isn't available. It may have been removed.",
  invalid_address: "Enter the delivery address (5 to 500 characters).",
  invalid_notes: "The note can be up to 1000 characters.",
  invalid_note: "The note can be up to 500 characters.",
  invalid_reason: "The reason can be up to 500 characters.",
  invalid_request: "Something is wrong with this order. Please check the form.",
  invalid_status: "That status filter isn't valid.",
};

export function orderError(e: unknown): string {
  const m =
    e instanceof Error
      ? e.message
      : typeof e === "object" && e && "message" in e
        ? String((e as { message: unknown }).message)
        : "";
  if (m.includes("Could not find the function")) {
    return "Purchase orders aren't set up yet. Run migration 16 (20261127000016_purchase_orders.sql) in Supabase.";
  }
  const k = Object.keys(ERRORS).find((x) => m.includes(x));
  return k ? ERRORS[k]! : "Something went wrong. Please check your connection and try again.";
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabase().rpc(fn, args);
  if (error) throw new Error(orderError(error));
  return data as T;
}

const num = (v: unknown) => Number(v ?? 0);
const amounts = (a: Partial<OrderAmounts> | null | undefined): OrderAmounts => ({
  subtotal: num(a?.subtotal),
  gst: num(a?.gst),
  shipping: num(a?.shipping),
  other_charges: num(a?.other_charges),
  total: num(a?.total),
});
const lines = (l: OrderLine[] | null | undefined): OrderLine[] =>
  (l ?? []).map((x) => ({ ...x, qty: num(x.qty), unit_price: num(x.unit_price), gst_rate: num(x.gst_rate) }));

// ── buyer ──
export async function awardRfq(
  rfqId: string,
  quotationId: string,
  input: AwardInput,
): Promise<{ id: string; number: string; status: OrderStatus }> {
  return rpc("award_rfq", { p_rfq: rfqId, p_quotation: quotationId, p_data: input });
}

export async function listPurchaseOrders(
  orgId: string,
  status = "all",
  limit = 100,
  offset = 0,
): Promise<BuyerOrderList> {
  const d = await rpc<Partial<BuyerOrderList> | null>("list_purchase_orders", {
    p_org: orgId,
    p_status: status === "all" ? null : status,
    p_limit: limit,
    p_offset: offset,
  });
  return {
    total: num(d?.total),
    counts: d?.counts ?? {},
    items: (d?.items ?? []).map((r) => ({ ...r, total: num(r.total) })),
  };
}

export async function getPurchaseOrder(poId: string): Promise<BuyerOrder> {
  const d = await rpc<BuyerOrder>("get_purchase_order", { p_po: poId });
  return {
    ...d,
    po: { ...d.po, payment_terms_days: num(d.po.payment_terms_days) },
    lines: lines(d.lines),
    amounts: amounts(d.amounts),
    can_cancel: d.can_cancel === true,
  };
}

export async function cancelPurchaseOrder(poId: string, reason: string): Promise<void> {
  await rpc("cancel_purchase_order", { p_po: poId, p_reason: reason.trim() || null });
}

// ── supplier ──
export async function listSupplierOrders(
  orgId: string,
  filter: OrderFilter = "all",
  limit = 100,
  offset = 0,
): Promise<SupplierOrderList> {
  const d = await rpc<Partial<SupplierOrderList> | null>("list_supplier_orders", {
    p_org: orgId,
    p_filter: filter,
    p_limit: limit,
    p_offset: offset,
  });
  return {
    total: num(d?.total),
    counts: d?.counts ?? {},
    items: (d?.items ?? []).map((r) => ({ ...r, total: num(r.total) })),
  };
}

/** Orders waiting for this supplier to confirm: the menu badge. Never throws, so a hiccup can't break the menu. */
export async function countNewOrders(orgId: string): Promise<number> {
  try {
    return num(await rpc<number>("count_new_orders", { p_org: orgId }));
  } catch {
    return 0;
  }
}

export async function getSupplierOrder(orgId: string, poId: string): Promise<SupplierOrder> {
  const d = await rpc<SupplierOrder>("get_supplier_order", { p_org: orgId, p_po: poId });
  return {
    ...d,
    po: { ...d.po, payment_terms_days: num(d.po.payment_terms_days) },
    lines: lines(d.lines),
    amounts: amounts(d.amounts),
    can_respond: d.can_respond === true,
  };
}

export async function confirmPurchaseOrder(orgId: string, poId: string, note: string): Promise<void> {
  await rpc("confirm_purchase_order", { p_org: orgId, p_po: poId, p_note: note.trim() || null });
}

export async function declinePurchaseOrder(orgId: string, poId: string, reason: string): Promise<void> {
  await rpc("decline_purchase_order", { p_org: orgId, p_po: poId, p_reason: reason.trim() || null });
}
