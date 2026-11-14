import { getSupabase } from "@/lib/supabase";

/**
 * RFQs, browser side. The browser only asks and displays. WHO may send an RFQ, WHICH suppliers may be invited (a Trust
 * Passport that counts at the moment of sending), the RFQ numbers and every input check are decided by the database
 * (supabase/migrations/20261124000013_rfqs.sql). The buyer's estimated prices never reach an RFQ.
 */

export const RFQ_KEY = "rfqs";
export const MAX_RFQ_SUPPLIERS = 20;
export const MAX_RFQ_NOTE = 1000;
export const MAX_DUE_DAYS = 180;

export type RfqStatus = "draft" | "sent" | "evaluating" | "awarded" | "closed";
export type InviteStatus = "sent" | "viewed" | "quoted" | "declined";

export interface RfqRow {
  id: string;
  number: string;
  title: string;
  status: RfqStatus;
  category: string;
  due_date: string | null;
  created_at: string;
  request_id: string | null;
  request_number: string | null;
  owner_name: string;
  invited: number;
  quoted: number;
  item_count: number;
}
export interface RfqList {
  total: number;
  counts: Partial<Record<RfqStatus, number>>;
  items: RfqRow[];
}
export interface RfqItem {
  id: string;
  description: string;
  qty: number;
  unit: string;
}
export interface RfqInvite {
  id: string;
  supplier_org: string;
  name: string;
  city: string;
  state: string;
  status: InviteStatus;
  sent_at: string;
  responded_at: string | null;
  /** The Trust Passport level when the RFQ went out: the evidence of who was verified at that moment. */
  level_at_send: number | null;
  /** The level today. Lower than level_at_send means a proof has lapsed since. */
  level_now: number;
}
export interface RfqDetail {
  rfq: {
    id: string;
    org_id: string;
    number: string;
    title: string;
    status: RfqStatus;
    category: string;
    due_date: string | null;
    created_at: string;
    notes: string;
    request_id: string | null;
    request_number: string | null;
    owner_name: string;
  };
  items: RfqItem[];
  invites: RfqInvite[];
}
export interface RequestRfqInfo {
  rfq_id: string | null;
  rfq_number: string | null;
  /** True only for an owner or procurement manager, on an approved request that has not been sent yet. */
  can_send: boolean;
}
export interface SendRfqInput {
  supplierIds: string[];
  /** yyyy-MM-dd */
  dueDate: string;
  notes: string;
}

export const LEVEL_NAMES: Record<number, string> = {
  0: "Not verified",
  1: "Registered",
  2: "Verified",
  3: "Certified",
};

/** Plain-language messages for every code the database can raise. */
const ERRORS: Record<string, string> = {
  not_authenticated: "Please sign in again.",
  not_allowed: "Only an owner or a procurement manager can send RFQs.",
  not_found: "This request or RFQ isn't available. It may have been removed.",
  not_approved: "Only an approved request can be sent to suppliers.",
  already_sent: "This request has already been sent as an RFQ.",
  invalid_request: "Something is wrong with this RFQ. Please check the form.",
  invalid_due_date: "Pick a response deadline from tomorrow up to 180 days away.",
  invalid_notes: "The note can be up to 1000 characters.",
  no_suppliers: "Choose at least one supplier.",
  too_many_suppliers: "You can invite at most 20 suppliers to one RFQ.",
  invalid_suppliers: "One of the chosen suppliers isn't valid. Refresh and choose again.",
  duplicate_suppliers: "A supplier was chosen twice. Refresh and choose again.",
  supplier_not_found:
    "One of the chosen suppliers is no longer available. Refresh and choose again.",
  supplier_not_verified:
    "One of the chosen suppliers is no longer verified (a proof may have expired). Refresh the list and choose again.",
  no_items: "This request has no items to quote.",
  invalid_status: "That status filter isn't valid.",
};

export function rfqError(e: unknown): string {
  const m =
    e instanceof Error
      ? e.message
      : typeof e === "object" && e && "message" in e
        ? String((e as { message: unknown }).message)
        : "";
  if (m.includes("Could not find the function")) {
    return "RFQs aren't set up yet. Run migration 13 (20261124000013_rfqs.sql) in Supabase.";
  }
  const k = Object.keys(ERRORS).find((x) => m.includes(x));
  return k ? ERRORS[k]! : "Something went wrong. Please check your connection and try again.";
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabase().rpc(fn, args);
  if (error) throw new Error(rfqError(error));
  return data as T;
}

const num = (v: unknown) => Number(v ?? 0);

export async function listRfqs(
  orgId: string,
  status = "all",
  limit = 100,
  offset = 0,
): Promise<RfqList> {
  const d = await rpc<Partial<RfqList> | null>("list_rfqs", {
    p_org: orgId,
    p_status: status === "all" ? null : status,
    p_limit: limit,
    p_offset: offset,
  });
  return {
    total: num(d?.total),
    counts: d?.counts ?? {},
    items: (d?.items ?? []).map((r) => ({
      ...r,
      invited: num(r.invited),
      quoted: num(r.quoted),
      item_count: num(r.item_count),
    })),
  };
}

export async function getRfq(rfqId: string): Promise<RfqDetail> {
  const d = await rpc<RfqDetail>("get_rfq", { p_rfq: rfqId });
  return {
    rfq: d.rfq,
    items: (d.items ?? []).map((i) => ({ ...i, qty: num(i.qty) })),
    invites: (d.invites ?? []).map((i) => ({ ...i, level_now: num(i.level_now) })),
  };
}

export async function getRequestRfq(requestId: string): Promise<RequestRfqInfo> {
  const d = await rpc<Partial<RequestRfqInfo> | null>("get_request_rfq", { p_request: requestId });
  return {
    rfq_id: d?.rfq_id ?? null,
    rfq_number: d?.rfq_number ?? null,
    can_send: d?.can_send === true,
  };
}

export async function sendRfq(
  requestId: string,
  input: SendRfqInput,
): Promise<{ id: string; number: string; status: RfqStatus; invited: number }> {
  return rpc("send_rfq", { p_request: requestId, p_data: input });
}
