import { getSupabase } from "@/lib/supabase";

/**
 * Supplier quote requests, browser side. The browser only asks and displays. WHO may see an RFQ (only invited suppliers),
 * WHO may quote or decline (owner or procurement manager of the supplier company), the money checks and the rule that a
 * quote must price every item are all decided by the database (supabase/migrations/20261125000014_quote_requests.sql).
 */

export const MAX_QUOTE_NOTE = 1000;
export const MAX_DECLINE_REASON = 500;

/** open: waiting for a quote. quoted / declined: answered. closed: the deadline passed or the buyer closed the RFQ. */
export type QuoteState = "open" | "quoted" | "declined" | "closed";
export type QuoteFilter = "all" | QuoteState;

export interface QuoteRequestRow {
  rfq_id: string;
  number: string;
  title: string;
  category: string;
  due_date: string | null;
  sent_at: string;
  responded_at: string | null;
  state: QuoteState;
  item_count: number;
  /** How many suppliers were invited in total (never who). */
  invited: number;
  buyer_name: string;
  buyer_city: string;
  buyer_state: string;
  currency: string;
  /** The landed total of this supplier's own quote, when there is one. */
  my_total: number | null;
}
export interface QuoteRequestList {
  total: number;
  counts: Partial<Record<QuoteState, number>>;
  items: QuoteRequestRow[];
}

export interface ProductSuggestion {
  product_id: string;
  name: string;
  price: number;
  unit: string;
  moq: number | null;
  availability: string;
}
export interface QuoteItem {
  id: string;
  description: string;
  qty: number;
  unit: string;
  /** The supplier's own matching product, if any: this is what makes "quote in 60 seconds" work. */
  suggestion: ProductSuggestion | null;
}
export interface Amounts {
  subtotal: number;
  gst: number;
  shipping: number;
  other_charges: number;
  total: number;
}
export interface MyQuote {
  id: string;
  revision: number;
  received_at: string;
  gst_rate: number;
  shipping: number;
  other_charges: number;
  delivery_days: number;
  payment_terms_days: number;
  valid_until: string | null;
  notes: string;
  amounts: Amounts | null;
  lines: { item_id: string; unit_price: number }[];
}
export interface QuoteRequestDetail {
  rfq: {
    id: string;
    number: string;
    title: string;
    category: string;
    due_date: string | null;
    notes: string;
    currency: string;
    /** False once the deadline has passed or the buyer closed or awarded the RFQ. */
    open: boolean;
    invited: number;
  };
  buyer: { name: string; city: string; state: string };
  invite: {
    status: string;
    state: QuoteState;
    sent_at: string;
    viewed_at: string | null;
    responded_at: string | null;
    decline_reason: string;
    level_at_send: number | null;
  };
  items: QuoteItem[];
  quote: MyQuote | null;
  last_terms: { gst_rate: number; payment_terms_days: number; delivery_days: number } | null;
  /** False for members who may look but not answer (the database decides; this only disables the buttons). */
  can_respond: boolean;
}
export interface SubmitQuoteInput {
  lines: { itemId: string; unitPrice: number }[];
  gstRate: number;
  shipping: number;
  otherCharges: number;
  deliveryDays: number;
  paymentTermsDays: number;
  /** yyyy-MM-dd */
  validUntil: string;
  notes: string;
}

/** Plain-language messages for every code the database can raise. */
const ERRORS: Record<string, string> = {
  not_authenticated: "Please sign in again.",
  not_allowed: "Only the owner or a procurement manager can answer quote requests.",
  not_found: "This quote request isn't available. It may have been removed.",
  rfq_closed: "This request is closed: the deadline has passed or the buyer has closed it.",
  already_quoted: "You have already sent a quote for this request. Revise it instead of declining.",
  invalid_request: "Something is wrong with this quote. Please check the form.",
  incomplete_quote: "Add a price for every item before sending.",
  invalid_price: "Enter a valid price above 0 for every item (up to 2 decimals).",
  invalid_gst: "GST must be between 0% and 40%.",
  invalid_shipping: "Enter a valid freight amount (0 or more).",
  invalid_other_charges: "Enter valid other charges (0 or more).",
  invalid_delivery_days: "Delivery time must be a whole number of days, from 0 to 365.",
  invalid_payment_terms: "Payment terms must be a whole number of days, from 0 to 365.",
  invalid_valid_until: "Quote validity must be from today up to 365 days away.",
  invalid_notes: "The note can be up to 1000 characters.",
  invalid_reason: "The reason can be up to 500 characters.",
  invalid_status: "That filter isn't valid.",
};

export function quoteError(e: unknown): string {
  const m =
    e instanceof Error
      ? e.message
      : typeof e === "object" && e && "message" in e
        ? String((e as { message: unknown }).message)
        : "";
  if (m.includes("Could not find the function")) {
    return "Quote requests aren't set up yet. Run migration 14 (20261125000014_quote_requests.sql) in Supabase.";
  }
  const k = Object.keys(ERRORS).find((x) => m.includes(x));
  return k ? ERRORS[k]! : "Something went wrong. Please check your connection and try again.";
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabase().rpc(fn, args);
  if (error) throw new Error(quoteError(error));
  return data as T;
}

const num = (v: unknown) => Number(v ?? 0);
const numOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export async function listQuoteRequests(
  orgId: string,
  filter: QuoteFilter = "all",
  limit = 100,
  offset = 0,
): Promise<QuoteRequestList> {
  const d = await rpc<Partial<QuoteRequestList> | null>("list_quote_requests", {
    p_org: orgId,
    p_filter: filter === "all" ? null : filter,
    p_limit: limit,
    p_offset: offset,
  });
  const counts: QuoteRequestList["counts"] = {};
  for (const [k, v] of Object.entries(d?.counts ?? {})) counts[k as QuoteState] = num(v);
  return {
    total: num(d?.total),
    counts,
    items: (d?.items ?? []).map((r) => ({
      ...r,
      item_count: num(r.item_count),
      invited: num(r.invited),
      my_total: numOrNull(r.my_total),
    })),
  };
}

/** How many requests are waiting for this supplier. Never throws: the menu badge must not break a page. */
export async function countOpenQuoteRequests(orgId: string): Promise<number> {
  try {
    const d = await rpc<{ counts?: Record<string, unknown> } | null>("list_quote_requests", {
      p_org: orgId,
      p_filter: "open",
      p_limit: 1,
      p_offset: 0,
    });
    return num(d?.counts?.["open"]);
  } catch {
    return 0;
  }
}

export async function getQuoteRequest(orgId: string, rfqId: string): Promise<QuoteRequestDetail> {
  const d = await rpc<QuoteRequestDetail>("get_quote_request", { p_org: orgId, p_rfq: rfqId });
  const q = d.quote;
  return {
    ...d,
    rfq: { ...d.rfq, open: d.rfq.open === true, invited: num(d.rfq.invited) },
    items: (d.items ?? []).map((i) => ({
      ...i,
      qty: num(i.qty),
      suggestion: i.suggestion
        ? {
            ...i.suggestion,
            price: num(i.suggestion.price),
            moq: numOrNull(i.suggestion.moq),
          }
        : null,
    })),
    quote: q
      ? {
          ...q,
          revision: num(q.revision),
          gst_rate: num(q.gst_rate),
          shipping: num(q.shipping),
          other_charges: num(q.other_charges),
          delivery_days: num(q.delivery_days),
          payment_terms_days: num(q.payment_terms_days),
          amounts: q.amounts
            ? {
                subtotal: num(q.amounts.subtotal),
                gst: num(q.amounts.gst),
                shipping: num(q.amounts.shipping),
                other_charges: num(q.amounts.other_charges),
                total: num(q.amounts.total),
              }
            : null,
          lines: (q.lines ?? []).map((l) => ({
            item_id: l.item_id,
            unit_price: num(l.unit_price),
          })),
        }
      : null,
    last_terms: d.last_terms
      ? {
          gst_rate: num(d.last_terms.gst_rate),
          payment_terms_days: num(d.last_terms.payment_terms_days),
          delivery_days: num(d.last_terms.delivery_days),
        }
      : null,
    can_respond: d.can_respond === true,
  };
}

export async function submitQuotation(
  orgId: string,
  rfqId: string,
  input: SubmitQuoteInput,
): Promise<{ id: string; revision: number; amounts: Amounts }> {
  return rpc("submit_quotation", { p_org: orgId, p_rfq: rfqId, p_data: input });
}

export async function declineQuoteRequest(
  orgId: string,
  rfqId: string,
  reason: string,
): Promise<void> {
  await rpc("decline_quote_request", {
    p_org: orgId,
    p_rfq: rfqId,
    p_reason: reason.trim() || null,
  });
}
