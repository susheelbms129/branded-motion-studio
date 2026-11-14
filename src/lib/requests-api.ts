import { getSupabase } from "@/lib/supabase";
import type { Priority, RequestStatus } from "@/types/domain";

/**
 * Purchase requests, browser side. The browser only asks and displays. WHO may see a request, WHO is the next approver,
 * whether a decision is allowed right now, the request numbers and every input check are decided by the database
 * (supabase/migrations/20261123000012_purchase_requests.sql). Nothing about a request is kept in the browser.
 */

export const APPROVAL_LIMIT = 200000; // above this a second (finance) approval is added by the database

export interface RequestRow {
  id: string;
  number: string;
  title: string;
  status: RequestStatus;
  priority: Priority;
  category: string;
  department: string;
  needed_by: string | null;
  created_at: string;
  requester_id: string;
  requester_name: string;
  total: number;
  item_count: number;
  /** Name of the person whose decision the request is waiting on (only while it is pending). */
  waiting_on: string | null;
}

export interface RequestList {
  total: number;
  counts: Partial<Record<RequestStatus, number>>;
  items: RequestRow[];
}

export interface RequestLine {
  id: string;
  description: string;
  qty: number;
  unit: string;
  unit_price: number;
}
export interface RequestApproval {
  id: string;
  level: number;
  status: "pending" | "approved" | "rejected" | "waiting";
  approver_id: string;
  approver_name: string;
  decided_at: string | null;
  comment: string | null;
}
export interface RequestEvent {
  id: number;
  type: "created" | "submitted" | "routed" | "approved" | "rejected" | "withdrawn" | "auto_approved";
  text: string;
  at: string;
  actor_id: string | null;
  actor_name: string;
}
export interface RequestDetail {
  request: {
    id: string;
    org_id: string;
    number: string;
    title: string;
    status: RequestStatus;
    priority: Priority;
    category: string;
    department: string;
    needed_by: string | null;
    created_at: string;
    submitted_at: string | null;
    justification: string;
    requester_id: string;
    requester_name: string;
    total: number;
  };
  items: RequestLine[];
  approvals: RequestApproval[];
  events: RequestEvent[];
  is_requester: boolean;
  can_decide: boolean;
  can_withdraw: boolean;
}

export interface NewRequestInput {
  title: string;
  department: string;
  category: string;
  priority: Priority;
  neededBy: string;
  justification: string;
  items: { description: string; qty: number; unit: string; unitPrice: number }[];
}

/** Plain-language messages for every code the database can raise. */
const ERRORS: Record<string, string> = {
  not_authenticated: "Please sign in again.",
  not_allowed: "You don't have permission to do that in this company.",
  not_found: "This request isn't available. It may have been removed.",
  invalid_request: "Something is wrong with this request. Please check the form.",
  invalid_title: "Give the request a short title (3 to 120 characters).",
  invalid_department: "Enter a department (2 to 60 characters).",
  invalid_category: "Choose or type a category (2 to 60 characters).",
  invalid_justification: "Add a short justification (10 to 2000 characters).",
  invalid_priority: "Choose a priority.",
  invalid_needed_by: "Pick a delivery date that is today or later (within 3 years).",
  no_items: "Add at least one item.",
  too_many_items: "A request can have at most 50 items.",
  invalid_item: "One of the items is not valid.",
  invalid_item_description: "Every item needs a name (2 to 200 characters).",
  invalid_item_unit: "Every item needs a unit, like pcs, kg or box.",
  invalid_item_qty: "Quantities must be above 0 (up to 3 decimals).",
  invalid_item_price: "Prices can't be negative (up to 2 decimals).",
  invalid_decision: "That decision isn't valid.",
  invalid_comment: "Comments can be up to 1000 characters.",
  invalid_status: "That status filter isn't valid.",
  comment_required: "Please say why you're rejecting this request.",
  not_pending: "This request is no longer waiting for approval. Refresh to see its latest state.",
  not_draft: "Only a draft can be changed this way.",
  not_your_turn: "This request is waiting for someone else's decision.",
  no_approver: "Nobody in your company can approve requests yet. Ask the owner to invite an approver.",
};

export function requestError(e: unknown): string {
  const m =
    e instanceof Error
      ? e.message
      : typeof e === "object" && e && "message" in e
        ? String((e as { message: unknown }).message)
        : "";
  if (m.includes("Could not find the function")) {
    return "Purchase requests aren't set up yet. Run migration 12 (20261123000012_purchase_requests.sql) in Supabase.";
  }
  const k = Object.keys(ERRORS).find((x) => m.includes(x));
  return k ? ERRORS[k]! : "Something went wrong. Please check your connection and try again.";
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabase().rpc(fn, args);
  if (error) throw new Error(requestError(error));
  return data as T;
}

const num = (v: unknown) => Number(v ?? 0);

export async function listRequests(orgId: string, status = "all", limit = 100, offset = 0): Promise<RequestList> {
  const d = await rpc<Partial<RequestList> | null>("list_requests", {
    p_org: orgId,
    p_status: status === "all" ? null : status,
    p_limit: limit,
    p_offset: offset,
  });
  return {
    total: num(d?.total),
    counts: d?.counts ?? {},
    items: (d?.items ?? []).map((r) => ({ ...r, total: num(r.total), item_count: num(r.item_count) })),
  };
}

export async function getRequest(requestId: string): Promise<RequestDetail> {
  const d = await rpc<RequestDetail>("get_request", { p_request: requestId });
  return {
    ...d,
    request: { ...d.request, total: num(d.request.total) },
    items: (d.items ?? []).map((i) => ({ ...i, qty: num(i.qty), unit_price: num(i.unit_price) })),
    approvals: d.approvals ?? [],
    events: d.events ?? [],
  };
}

export async function createRequest(
  orgId: string,
  input: NewRequestInput,
  submit: boolean,
): Promise<{ id: string; number: string; status: RequestStatus }> {
  return rpc("create_request", { p_org: orgId, p_data: input, p_submit: submit });
}

export async function submitRequest(requestId: string): Promise<{ id: string; status: RequestStatus }> {
  return rpc("submit_request", { p_request: requestId });
}

export async function decideRequest(
  requestId: string,
  decision: "approved" | "rejected",
  comment: string,
): Promise<{ id: string; status: RequestStatus }> {
  return rpc("decide_request", { p_request: requestId, p_decision: decision, p_comment: comment });
}

export async function withdrawRequest(requestId: string): Promise<{ id: string; status: RequestStatus }> {
  return rpc("withdraw_request", { p_request: requestId });
}

export async function deleteDraftRequest(requestId: string): Promise<void> {
  await rpc("delete_draft_request", { p_request: requestId });
}

export async function countMyPendingApprovals(orgId: string): Promise<number> {
  return num(await rpc<number>("count_my_pending_approvals", { p_org: orgId }));
}

/** Common categories offered as suggestions. A request can use any category; the list is only a convenience. */
export const REQUEST_CATEGORIES = [
  "Raw material",
  "Packaging",
  "Consumables",
  "Spares & maintenance",
  "Tools & equipment",
  "Electrical",
  "Safety & PPE",
  "Office & IT",
  "Services",
];
