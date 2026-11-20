import { getSupabase } from "@/lib/supabase";

/**
 * The MSME 45-day payment tracker, browser side. The browser only asks and displays. Whether the rule covers a supplier,
 * the deadline, the days left, the interest estimate and the tax-year warning are ALL worked out by the database
 * (supabase/migrations/20261201000020_msme_payments.sql); nothing here recalculates them.
 *
 * The rule (Income-tax Act s.43B(h), since 1 April 2024): a buyer who pays a MICRO or SMALL supplier after the agreed period
 * (never more than 45 days, 15 without a written agreement, counted from acceptance of the goods) can deduct the expense only
 * in the year it actually pays. Medium suppliers and pure traders are outside it. This is information, not tax or legal advice.
 */

export const PAYMENTS_KEY = "payments";
export const PAYMENTS_CHANGED = "vendora:payments-changed";

export type PayStatus = "none" | "not_started" | "on_hold" | "on_track" | "due_soon" | "due_today" | "overdue" | "paid" | "paid_late";
export type PayApplies = "yes" | "no" | "unknown";
export type PayDeduction = "na" | "safe" | "at_risk" | "deferred";
export type PayMethod = "bank_transfer" | "upi" | "cheque" | "other";

export interface PayState {
  phase: "none" | "awaiting_delivery" | "on_hold" | "running";
  status: PayStatus;
  applies: PayApplies;
  /** "small" or "micro" when covered; "medium", "trader" or "no_udyam" otherwise. */
  applies_why: string;
  udyam: { number: string; size: string; activity: string; verified_on: string } | null;
  total: number;
  paid: number;
  balance: number;
  last_paid_on: string | null;
  agreed_days: number;
  due_days: number;
  capped: boolean;
  written_agreement: boolean;
  accepted_on: string | null;
  due_date: string | null;
  /** True before delivery: the date is a forecast (promised delivery date plus the payment days). */
  projected: boolean;
  days_left: number | null;
  on_hold: boolean;
  objection_at: string | null;
  objection_note: string;
  objection_open_until: string | null;
  interest_estimate: number;
  bank_rate: number;
  fy_end: string | null;
  deduction: PayDeduction;
  disputed_payments: number;
}

export interface PayRules {
  max_days: number;
  max_days_no_agreement: number;
  objection_days: number;
  effective_from: string;
  interest_multiple: number;
  bank_rate: number;
  bank_rate_as_of: string;
}

export interface PaymentRow {
  id: string;
  amount: number;
  paid_on: string;
  method: PayMethod;
  reference: string;
  note: string;
  recorded_by?: string;
  confirmed_at: string | null;
  disputed_at: string | null;
  dispute_note: string;
  can_void?: boolean;
  can_respond?: boolean;
}

export interface PoPayment {
  state: PayState;
  rules: PayRules;
  payments: PaymentRow[];
  can_record?: boolean;
  can_object?: boolean;
  can_clear_objection?: boolean;
}

export interface PayablesSummary {
  overdue_count: number;
  overdue_amount: number;
  due_soon_count: number;
  due_soon_amount: number;
  at_risk_count: number;
  at_risk_amount: number;
  open_amount: number;
  interest_estimate: number;
  unknown_count: number;
  paid_count: number;
  year_end: string;
}
export interface PayableRow {
  id: string;
  number: string;
  title: string;
  supplier_id: string;
  supplier_name: string;
  state: PayState;
}
export interface Payables {
  summary: PayablesSummary;
  items: PayableRow[];
  rules: PayRules;
}

export interface ReceivablesSummary {
  overdue_count: number;
  overdue_amount: number;
  due_soon_count: number;
  due_soon_amount: number;
  expected_amount: number;
  interest_estimate: number;
  to_confirm: number;
  paid_count: number;
  covered: boolean;
  udyam: PayState["udyam"];
}
export interface ReceivableRow {
  id: string;
  number: string;
  title: string;
  buyer_name: string;
  state: PayState;
}
export interface Receivables {
  summary: ReceivablesSummary;
  items: ReceivableRow[];
  rules: PayRules;
}

export type PayFilter = "all" | "attention" | "open" | "paid";

// ───────── plain-language errors ─────────
const ERRORS: Record<string, string> = {
  not_authenticated: "Please sign in again.",
  not_allowed: "You don't have permission to do that.",
  not_found: "That order isn't available. It may have been removed.",
  not_delivered: "Record the delivery first. The payment period starts when the goods are accepted.",
  invalid_amount: "Enter an amount greater than zero.",
  invalid_date: "The date can't be in the future or before the delivery.",
  invalid_method: "Choose how it was paid.",
  invalid_text: "The reference or note is too long.",
  too_much: "That's more than is still owed.",
  already_paid: "This order is already paid.",
  too_many_payments: "This order already has 50 payments. Contact support.",
  already_confirmed: "The supplier already confirmed this payment, so it can't be changed.",
  too_late: "It's too late for that. Objections are allowed within 15 days of delivery; a payment can be removed within 24 hours.",
  already_objected: "An objection has already been raised for this order.",
  no_objection: "There is no open objection.",
  note_required: "Please add a short explanation.",
  invalid_filter: "That filter isn't valid.",
  invalid_rate: "Enter a rate between 0 and 25.",
};
export function payError(e: unknown): string {
  const m = e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : "";
  if (m.includes("Could not find the function")) return "Payment tracking isn't set up yet. Run migration 20 (20261201000020_msme_payments.sql) in Supabase.";
  const hit = m.match(/(?:note_required|too_much|invalid_date|too_late|already_paid|not_delivered): ([^\n]+)/);
  if (hit && m.includes("note_required")) return hit[1] ?? ERRORS.note_required!;
  const k = Object.keys(ERRORS).find((x) => m.includes(x));
  return k ? ERRORS[k]! : "Something went wrong. Please check your connection and try again.";
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabase().rpc(fn, args);
  if (error) throw new Error(payError(error));
  return data as T;
}

const n = (v: unknown) => Number(v ?? 0);
function state(s: PayState): PayState {
  return { ...s, total: n(s.total), paid: n(s.paid), balance: n(s.balance), interest_estimate: n(s.interest_estimate), bank_rate: n(s.bank_rate) };
}
const payments = (p: PaymentRow[] | null | undefined): PaymentRow[] => (p ?? []).map((x) => ({ ...x, amount: n(x.amount) }));

// ───────── buyer ─────────
export async function listPayables(orgId: string, filter: PayFilter = "all"): Promise<Payables> {
  const d = await rpc<Payables>("list_payables", { p_org: orgId, p_filter: filter });
  return { ...d, items: (d.items ?? []).map((i) => ({ ...i, state: state(i.state) })) };
}
export async function getPoPayment(poId: string): Promise<PoPayment> {
  const d = await rpc<PoPayment>("get_po_payment", { p_po: poId });
  return { ...d, state: state(d.state), payments: payments(d.payments) };
}
export interface RecordPaymentInput {
  amount: number;
  paidOn: string;
  method: PayMethod;
  reference: string;
  note: string;
}
export async function recordPayment(poId: string, i: RecordPaymentInput): Promise<{ balance: number; fully_paid: boolean }> {
  return rpc("record_po_payment", {
    p_po: poId, p_amount: i.amount, p_paid_on: i.paidOn || null, p_method: i.method, p_reference: i.reference, p_note: i.note,
  });
}
export async function voidPayment(paymentId: string): Promise<void> {
  await rpc("void_po_payment", { p_payment: paymentId });
}
export async function raiseObjection(poId: string, note: string): Promise<void> {
  await rpc("raise_po_objection", { p_po: poId, p_note: note });
}
export async function clearObjection(poId: string): Promise<void> {
  await rpc("clear_po_objection", { p_po: poId });
}

// ───────── supplier ─────────
export async function listReceivables(orgId: string, filter: PayFilter = "all"): Promise<Receivables> {
  const d = await rpc<Receivables>("list_receivables", { p_org: orgId, p_filter: filter });
  return { ...d, items: (d.items ?? []).map((i) => ({ ...i, state: state(i.state) })) };
}
export async function getSupplierPoPayment(orgId: string, poId: string): Promise<PoPayment> {
  const d = await rpc<PoPayment>("get_supplier_po_payment", { p_org: orgId, p_po: poId });
  return { ...d, state: state(d.state), payments: payments(d.payments) };
}
export async function confirmPayment(orgId: string, paymentId: string): Promise<void> {
  await rpc("confirm_po_payment", { p_org: orgId, p_payment: paymentId });
}
export async function disputePayment(orgId: string, paymentId: string, note: string): Promise<void> {
  await rpc("dispute_po_payment", { p_org: orgId, p_payment: paymentId, p_note: note });
}

// ───────── pure helpers (tested) ─────────
/** A Udyam number looks like UDYAM-MH-12-1234567. Returns "" when fine, else the sentence to show. */
export function udyamProblem(v: string): string {
  const t = v.replace(/\s/g, "").toUpperCase();
  if (!t) return "Enter your Udyam registration number.";
  if (!/^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/.test(t)) return "It should look like UDYAM-MH-12-1234567.";
  return "";
}

export const STATUS_LABEL: Record<PayStatus, string> = {
  none: "Not tracked",
  not_started: "Clock starts at delivery",
  on_hold: "On hold: objection raised",
  on_track: "On track",
  due_soon: "Due soon",
  due_today: "Due today",
  overdue: "Overdue",
  paid: "Paid on time",
  paid_late: "Paid late",
};

/** Colour family for a status. Colour is never the only signal: every badge also carries its words. */
export function statusTone(s: PayStatus): "red" | "amber" | "green" | "blue" | "grey" {
  switch (s) {
    case "overdue": return "red";
    case "due_today":
    case "due_soon":
    case "on_hold":
    case "paid_late": return "amber";
    case "paid":
    case "on_track": return "green";
    case "not_started": return "blue";
    default: return "grey";
  }
}

/** "5 days left", "due today", "3 days overdue". */
export function daysText(daysLeft: number | null): string {
  if (daysLeft === null) return "";
  if (daysLeft === 0) return "due today";
  const a = Math.abs(daysLeft);
  const u = `${a} day${a === 1 ? "" : "s"}`;
  return daysLeft > 0 ? `${u} left` : `${u} overdue`;
}

/** Why the rule does or does not apply, in words the buyer and the supplier can both read. */
export function appliesText(s: Pick<PayState, "applies" | "applies_why">, side: "buyer" | "supplier"): string {
  if (s.applies === "yes") {
    return side === "buyer"
      ? `This supplier is a verified ${s.applies_why} enterprise, so the 45-day rule applies to you.`
      : `You are a verified ${s.applies_why} enterprise, so buyers must pay you within the legal limit.`;
  }
  if (s.applies === "no") {
    return s.applies_why === "trader"
      ? "A pure trader is outside the 45-day rule. The agreed payment terms apply."
      : "A medium enterprise is outside the 45-day rule. The agreed payment terms apply.";
  }
  return side === "buyer"
    ? "This supplier hasn't verified a Udyam registration, so we can't tell whether the 45-day rule applies. The date shown is the safe one. Ask them to add it to their Trust Passport."
    : "Add your Udyam registration to your Trust Passport. Until a reviewer verifies it, buyers aren't reminded about the 45-day rule.";
}

/** One sentence about the tax deduction, for the buyer only. */
export function deductionText(s: Pick<PayState, "deduction" | "fy_end" | "balance">, fmt: (n: number) => string, dateFmt: (d: string) => string): string {
  const end = s.fy_end ? dateFmt(s.fy_end) : "31 March";
  switch (s.deduction) {
    case "at_risk": return `Pay ${fmt(s.balance)} by ${end}. If it is still unpaid then, this expense can only be deducted next year.`;
    case "deferred": return "The deduction for this expense moves to the year of payment, because it was unpaid at the end of the financial year after the deadline.";
    case "safe": return "This expense is safe to deduct for the year.";
    default: return "";
  }
}

/** Two decimals, no more. Amounts in the tracker are always shown exactly as the database holds them. */
export const PAY_METHODS: { value: PayMethod; label: string }[] = [
  { value: "bank_transfer", label: "Bank transfer (NEFT / RTGS / IMPS)" },
  { value: "upi", label: "UPI" },
  { value: "cheque", label: "Cheque (enter the date it cleared)" },
  { value: "other", label: "Other" },
];

export const MSME_DISCLAIMER =
  "This is information, not tax or legal advice. Based on Income-tax Act s.43B(h) and MSMED Act s.15–16. Interest is an estimate at three times the RBI bank rate, compounded monthly. Check with your accountant.";

/** The tabs on both trackers. The server supports the same filters; the pages fetch once and filter here so every tab shows a count. */
export function matchesFilter(s: Pick<PayState, "status" | "deduction">, f: PayFilter, side: "buyer" | "supplier"): boolean {
  switch (f) {
    case "attention":
      return s.status === "overdue" || s.status === "due_today" || s.status === "due_soon" || (side === "buyer" ? s.deduction === "at_risk" : s.status === "on_hold");
    case "open":
      return ["on_track", "due_soon", "due_today", "overdue", "on_hold", "not_started"].includes(s.status);
    case "paid":
      return s.status === "paid" || s.status === "paid_late";
    default:
      return true;
  }
}
