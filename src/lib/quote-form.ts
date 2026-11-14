import { calculateLandedCost, type LandedCost } from "@/lib/landed-cost";
import {
  MAX_QUOTE_NOTE,
  type QuoteItem,
  type QuoteRequestDetail,
  type QuoteState,
  type SubmitQuoteInput,
} from "@/lib/quote-requests-api";

/**
 * The logic behind the quote form, with no browser and no database, so a test can prove it. The form is checked here to be
 * friendly and checked again by the database to be safe (submit_quotation in migration 14).
 *
 * "Quote in 60 seconds": prices start from the supplier's own product list and the terms from their last quote, so the
 * supplier checks and sends instead of typing everything again.
 */

export interface QuoteForm {
  /** What the supplier typed per RFQ item, by item id. */
  prices: Record<string, string>;
  gstRate: string;
  shipping: string;
  otherCharges: string;
  deliveryDays: string;
  paymentTermsDays: string;
  /** yyyy-MM-dd */
  validUntil: string;
  notes: string;
}

export const DEFAULT_TERMS = {
  gstRate: 18,
  paymentTermsDays: 30,
  deliveryDays: 7,
  validDays: 15,
} as const;

/** yyyy-MM-dd in the person's own calendar day. */
export function ymd(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
}

/** "12", "12.5", "1,250.00" -> a number with at most 2 decimals, or null. */
export function parseAmount(s: string): number | null {
  const t = s.trim().replace(/,/g, "");
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(t)) return null;
  return Number(t);
}

const sameUnit = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export interface FormStart {
  form: QuoteForm;
  /** Item ids whose price came from the supplier's own product list. */
  prefilled: string[];
  /** Item ids where a product matched but its price is per a different unit, so nothing was filled in. */
  unitMismatch: string[];
}

/** The form's starting point: the existing quote (when revising), otherwise product-list prices and the last terms. */
export function startForm(d: QuoteRequestDetail, today: Date = new Date()): FormStart {
  const q = d.quote;
  if (q) {
    const prices: Record<string, string> = {};
    for (const l of q.lines) prices[l.item_id] = String(l.unit_price);
    return {
      form: {
        prices,
        gstRate: String(q.gst_rate),
        shipping: String(q.shipping),
        otherCharges: String(q.other_charges),
        deliveryDays: String(q.delivery_days),
        paymentTermsDays: String(q.payment_terms_days),
        validUntil: q.valid_until ?? ymd(addDays(today, DEFAULT_TERMS.validDays)),
        notes: q.notes,
      },
      prefilled: [],
      unitMismatch: [],
    };
  }
  const prices: Record<string, string> = {};
  const prefilled: string[] = [];
  const unitMismatch: string[] = [];
  for (const it of d.items) {
    const s = it.suggestion;
    if (!s) continue;
    if (!it.unit.trim() || sameUnit(s.unit, it.unit)) {
      prices[it.id] = String(s.price);
      prefilled.push(it.id);
    } else {
      unitMismatch.push(it.id);
    }
  }
  const t = d.last_terms;
  return {
    form: {
      prices,
      gstRate: String(t?.gst_rate ?? DEFAULT_TERMS.gstRate),
      shipping: "0",
      otherCharges: "0",
      deliveryDays: String(t?.delivery_days ?? DEFAULT_TERMS.deliveryDays),
      paymentTermsDays: String(t?.payment_terms_days ?? DEFAULT_TERMS.paymentTermsDays),
      validUntil: ymd(addDays(today, DEFAULT_TERMS.validDays)),
      notes: "",
    },
    prefilled,
    unitMismatch,
  };
}

export type QuoteErrors = Partial<Record<string, string>>;

const wholeDays = (s: string): number | null => {
  const t = s.trim();
  if (!/^\d{1,3}$/.test(t)) return null;
  const n = Number(t);
  return n <= 365 ? n : null;
};

/** Friendly checks. Keys: "price:<itemId>", gstRate, shipping, otherCharges, deliveryDays, paymentTermsDays, validUntil, notes. */
export function validateQuote(
  f: QuoteForm,
  items: QuoteItem[],
  today: Date = new Date(),
): QuoteErrors {
  const e: QuoteErrors = {};
  for (const it of items) {
    const p = parseAmount(f.prices[it.id] ?? "");
    if (p === null) e[`price:${it.id}`] = "Enter a price";
    else if (p < 0.01) e[`price:${it.id}`] = "Must be above 0";
    else if (p > 10_000_000) e[`price:${it.id}`] = "Too large";
  }
  const g = parseAmount(f.gstRate);
  if (g === null || g > 40) e["gstRate"] = "0 to 40";
  const s = parseAmount(f.shipping);
  if (s === null || s > 1_000_000_000) e["shipping"] = "Enter 0 or more";
  const o = parseAmount(f.otherCharges);
  if (o === null || o > 1_000_000_000) e["otherCharges"] = "Enter 0 or more";
  if (wholeDays(f.deliveryDays) === null) e["deliveryDays"] = "Whole days, 0 to 365";
  if (wholeDays(f.paymentTermsDays) === null) e["paymentTermsDays"] = "Whole days, 0 to 365";
  const min = ymd(today);
  const max = ymd(addDays(today, 365));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.validUntil) || f.validUntil < min || f.validUntil > max) {
    e["validUntil"] = "From today up to 365 days away";
  }
  if (f.notes.trim().length > MAX_QUOTE_NOTE) e["notes"] = `Up to ${MAX_QUOTE_NOTE} characters`;
  return e;
}

/** The payload for submit_quotation. Call only after validateQuote returned no errors. */
export function toInput(f: QuoteForm, items: QuoteItem[]): SubmitQuoteInput {
  return {
    lines: items.map((it) => ({
      itemId: it.id,
      unitPrice: parseAmount(f.prices[it.id] ?? "") ?? 0,
    })),
    gstRate: parseAmount(f.gstRate) ?? 0,
    shipping: parseAmount(f.shipping) ?? 0,
    otherCharges: parseAmount(f.otherCharges) ?? 0,
    deliveryDays: wholeDays(f.deliveryDays) ?? 0,
    paymentTermsDays: wholeDays(f.paymentTermsDays) ?? 0,
    validUntil: f.validUntil,
    notes: f.notes.trim(),
  };
}

/** The live "what the buyer will compare" number, using the same landed-cost code the buyer side uses. */
export function liveTotals(f: QuoteForm, items: QuoteItem[]): LandedCost & { priced: number } {
  let priced = 0;
  const lines = items.map((it) => {
    const p = parseAmount(f.prices[it.id] ?? "");
    if (p !== null && p > 0) priced += 1;
    return { qty: it.qty, unitPrice: p ?? 0 };
  });
  const landed = calculateLandedCost({
    lines,
    gstRate: parseAmount(f.gstRate) ?? 0,
    shipping: parseAmount(f.shipping) ?? 0,
    otherCharges: parseAmount(f.otherCharges) ?? 0,
  });
  return { ...landed, priced };
}

export type DeadlineTone = "none" | "ok" | "soon" | "late";
export interface Deadline {
  days: number | null;
  label: string;
  tone: DeadlineTone;
}

/** Whole calendar days from `now` to the due date (yyyy-MM-dd); negative when it has passed. Time zones cannot shift it. */
export function daysUntil(due: string, now: Date = new Date()): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(due);
  if (!m) return null;
  const a = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const b = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((a - b) / 86_400_000);
}

export function deadline(due: string | null, now: Date = new Date()): Deadline {
  if (!due) return { days: null, label: "No deadline", tone: "none" };
  const n = daysUntil(due, now);
  if (n === null) return { days: null, label: "No deadline", tone: "none" };
  if (n < 0) return { days: n, label: "Deadline passed", tone: "late" };
  if (n === 0) return { days: 0, label: "Due today", tone: "soon" };
  if (n === 1) return { days: 1, label: "Due tomorrow", tone: "soon" };
  return { days: n, label: `${n} days left`, tone: n <= 3 ? "soon" : "ok" };
}

export const STATE_LABEL: Record<QuoteState, string> = {
  open: "Needs your quote",
  quoted: "Quote sent",
  declined: "Declined",
  closed: "Closed",
};

/** Where the buyer is, in one short line ("Pune, Maharashtra"). */
export function placeLine(city: string, state: string): string {
  return [city, state]
    .map((x) => x.trim())
    .filter(Boolean)
    .join(", ");
}
