import { getSupabase } from "@/lib/supabase";

/**
 * Buyer side of quotes, browser side. The browser only asks and displays. WHO may read quotes (members of the buyer
 * company that owns the RFQ) is decided by the database (supabase/migrations/20261126000015_rfq_quotes.sql).
 */

export interface RfqQuoteLine {
  item_id: string;
  qty: number;
  unit_price: number;
}
export interface RfqQuote {
  quote_id: string;
  supplier_org: string;
  name: string;
  city: string;
  state: string;
  /** The Trust Passport level today (0 = a proof has lapsed or was never verified). */
  level_now: number;
  /** The level when the RFQ went out. */
  level_at_send: number | null;
  revision: number;
  sent_at: string | null;
  received_at: string;
  gst_rate: number;
  shipping: number;
  other_charges: number;
  delivery_days: number;
  payment_terms_days: number;
  /** yyyy-MM-dd */
  valid_until: string | null;
  notes: string;
  /** The supplier already declined an order for this quote: it can't be awarded again. */
  declined_order: boolean;
  lines: RfqQuoteLine[];
  /** The database's own money for this quote (same maths as quoting), used to double check the browser's. */
  amounts: {
    subtotal: number;
    gst: number;
    shipping: number;
    other_charges: number;
    total: number;
  } | null;
}
export interface RfqQuotes {
  currency: string;
  rfq_status: string;
  due_date: string | null;
  /** The database's today, yyyy-MM-dd. */
  today: string;
  quotes: RfqQuote[];
  /** The live purchase order for this RFQ, once a quote has been awarded. */
  po: { id: string; number: string; status: string; quotation_id: string; supplier_name: string } | null;
  /** Only an owner or procurement manager, on an RFQ with no live order. Decided by the database. */
  can_award: boolean;
}

const ERRORS: Record<string, string> = {
  not_authenticated: "Please sign in again.",
  not_found: "These quotes aren't available. The RFQ may have been removed.",
};

export function rfqQuotesError(e: unknown): string {
  const m =
    e instanceof Error
      ? e.message
      : typeof e === "object" && e && "message" in e
        ? String((e as { message: unknown }).message)
        : "";
  if (m.includes("Could not find the function")) {
    return "Quote comparison isn't set up yet. Run migration 15 (20261126000015_rfq_quotes.sql) in Supabase.";
  }
  const k = Object.keys(ERRORS).find((x) => m.includes(x));
  return k ? ERRORS[k]! : "Something went wrong. Please check your connection and try again.";
}

const num = (v: unknown) => Number(v ?? 0);

export async function getRfqQuotes(rfqId: string): Promise<RfqQuotes> {
  const { data, error } = await getSupabase().rpc("get_rfq_quotes", { p_rfq: rfqId });
  if (error) throw new Error(rfqQuotesError(error));
  const d = (data ?? {}) as Partial<RfqQuotes>;
  return {
    currency: d.currency ?? "INR",
    rfq_status: d.rfq_status ?? "",
    due_date: d.due_date ?? null,
    today: d.today ?? new Date().toISOString().slice(0, 10),
    po: d.po ?? null,
    can_award: d.can_award === true,
    quotes: (d.quotes ?? []).map((q) => ({
      ...q,
      declined_order: q.declined_order === true,
      level_now: num(q.level_now),
      level_at_send: q.level_at_send == null ? null : num(q.level_at_send),
      revision: num(q.revision) || 1,
      gst_rate: num(q.gst_rate),
      shipping: num(q.shipping),
      other_charges: num(q.other_charges),
      delivery_days: num(q.delivery_days),
      payment_terms_days: num(q.payment_terms_days),
      notes: q.notes ?? "",
      lines: (q.lines ?? []).map((l) => ({
        item_id: l.item_id,
        qty: num(l.qty),
        unit_price: num(l.unit_price),
      })),
      amounts: q.amounts
        ? {
            subtotal: num(q.amounts.subtotal),
            gst: num(q.amounts.gst),
            shipping: num(q.amounts.shipping),
            other_charges: num(q.amounts.other_charges),
            total: num(q.amounts.total),
          }
        : null,
    })),
  };
}
