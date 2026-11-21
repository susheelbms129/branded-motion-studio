import { getSupabase } from "@/lib/supabase";

/**
 * Goods acceptance, browser side, for BOTH sides (supabase/migrations/20261207000026_goods_receipts.sql).
 * The database decides who may record, fix or close a delivery, checks every quantity and date, and moves the order (and the
 * MSME payment clock) forward. This file only asks, words the answers, and runs the same checks first so people get a clear
 * message before anything is sent. The pure functions here are tested without a browser.
 */

export const RECEIVING_KEY = "po-receiving";
export const BUCKET = "goods-photos";
export const MAX_PHOTOS = 6;
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const MAX_NOTE = 500;
export const MAX_REASON = 200;
export const MAX_RESPONSE_NOTE = 300;

export interface ReceivingLine {
  id: string;
  description: string;
  unit: string;
  ordered: number;
  accepted: number;
  rejected: number;
  /** Still to accept: ordered minus accepted. Rejected goods never use up the order. */
  remaining: number;
}

export interface ReceiptLine {
  description: string;
  unit: string;
  accepted: number;
  rejected: number;
  reason: string;
}

export interface Receipt {
  id: string;
  number: string;
  received_on: string;
  created_at: string;
  by: string;
  note: string;
  voided: boolean;
  void_reason: string;
  supplier_response: "agreed" | "disputed" | null;
  supplier_note: string;
  supplier_responded_at: string | null;
  can_void: boolean;
  can_respond: boolean;
  can_add_photo: boolean;
  lines: ReceiptLine[];
  photos: { id: string; name: string }[];
}

export interface Receiving {
  po_status: string;
  expected_at: string | null;
  delivered_at: string | null;
  closed_short: boolean;
  short_close_reason: string;
  /** Delivered before receipts existed: only the date is known. */
  legacy: boolean;
  can_record: boolean;
  can_close_short: boolean;
  lines: ReceivingLine[];
  receipts: Receipt[];
}

/** One row of the "record a delivery" form. Numbers are typed text so a half-typed value never breaks the form. */
export interface DraftLine {
  lineId: string;
  accepted: string;
  rejected: string;
  reason: string;
}

// ───────────────────────── pure rules (tested) ─────────────────────────

/** Typed text -> a quantity with at most 3 decimals, or null when it is not one. Empty means 0. */
export function parseQty(text: string): number | null {
  const t = (text ?? "").trim().replace(/,/g, "");
  if (t === "") return 0;
  if (!/^\d+(\.\d{1,3})?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Quantity for display: no trailing zeros ("12.5", "100"). */
export function fmtQty(n: number): string {
  return Number(n.toFixed(3)).toString();
}

/** The form starts as "everything still to come arrived fine", so the common case is one tap. */
export function initialDraft(lines: ReceivingLine[]): DraftLine[] {
  return lines.map((l) => ({ lineId: l.id, accepted: l.remaining > 0 ? fmtQty(l.remaining) : "", rejected: "", reason: "" }));
}

export interface DraftCheck {
  ok: boolean;
  /** First problem to show the person, in plain words. */
  error: string;
  /** Lines to send (only those with a quantity). */
  lines: { lineId: string; accepted: number; rejected: number; reason: string }[];
  acceptedTotal: number;
  rejectedTotal: number;
}

/** The same rules the database applies, checked first so the message is immediate and kind. */
export function checkDraft(draft: DraftLine[], lines: ReceivingLine[], receivedOn: string, today: string, issuedOn?: string): DraftCheck {
  const bad = (error: string): DraftCheck => ({ ok: false, error, lines: [], acceptedTotal: 0, rejectedTotal: 0 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(receivedOn)) return bad("Choose the date the goods arrived.");
  if (receivedOn > today) return bad("The delivery date cannot be in the future.");
  if (issuedOn && receivedOn < issuedOn) return bad("The delivery date cannot be before the order was placed.");
  const byId = new Map(lines.map((l) => [l.id, l]));
  const out: DraftCheck["lines"] = [];
  let a = 0;
  let r = 0;
  for (const d of draft) {
    const l = byId.get(d.lineId);
    if (!l) continue;
    const acc = parseQty(d.accepted);
    const rej = parseQty(d.rejected);
    if (acc === null || rej === null) return bad(`Check the quantity for ${l.description}. Use numbers, up to 3 decimals.`);
    if (acc === 0 && rej === 0) continue;
    if (acc > l.remaining) return bad(`${l.description}: only ${fmtQty(l.remaining)} ${l.unit} are still to be accepted.`);
    if (rej > l.ordered) return bad(`${l.description}: you cannot reject more than was ordered.`);
    const reason = d.reason.trim();
    if (rej > 0 && reason.length < 3) return bad(`${l.description}: say why the goods were rejected.`);
    if (reason.length > MAX_REASON) return bad(`${l.description}: the reason is too long.`);
    out.push({ lineId: d.lineId, accepted: acc, rejected: rej, reason: rej > 0 ? reason : "" });
    a += acc;
    r += rej;
  }
  if (out.length === 0) return bad("Enter a quantity for at least one item.");
  return { ok: true, error: "", lines: out, acceptedTotal: a, rejectedTotal: r };
}

/** "60 of 100 accepted" style progress for one item, and for the whole order. */
export function progress(lines: ReceivingLine[]): { percent: number; accepted: number; ordered: number } {
  const ordered = lines.reduce((s, l) => s + l.ordered, 0);
  const accepted = lines.reduce((s, l) => s + Math.min(l.accepted, l.ordered), 0);
  return { percent: ordered > 0 ? Math.round((accepted / ordered) * 100) : 0, accepted, ordered };
}

/** One sentence on where the order stands and what happens next. Never promises more than the rules do. */
export function standing(r: Pick<Receiving, "po_status" | "lines" | "closed_short" | "legacy" | "delivered_at">, side: "buyer" | "supplier"): string {
  const who = side === "buyer" ? "you" : "the buyer";
  if (r.legacy) return "This delivery was recorded before item-by-item receipts existed, so only the date is known.";
  if (r.po_status === "received" || r.po_status === "closed") {
    return r.closed_short
      ? "Closed as short-delivered. What arrived was accepted, and the payment period is running."
      : "Everything was accepted. The payment period is running.";
  }
  const rejected = r.lines.some((l) => l.rejected > 0);
  const p = progress(r.lines);
  if (p.accepted === 0 && !rejected) return "Nothing received yet.";
  if (p.accepted === 0) return `Goods were rejected and nothing is accepted yet. The payment period starts once ${who} accept${side === "buyer" ? "" : "s"} the full order.`;
  return `Partly received (${p.percent}% accepted). The payment period starts once ${who} accept${side === "buyer" ? "" : "s"} the full order, or the buyer closes it as short-delivered.`;
}

/** What the supplier answered, in plain words. */
export function responseLabel(r: Pick<Receipt, "supplier_response">): { text: string; tone: "good" | "bad" | "wait" } {
  if (r.supplier_response === "agreed") return { text: "Supplier agreed", tone: "good" };
  if (r.supplier_response === "disputed") return { text: "Supplier disputed", tone: "bad" };
  return { text: "Waiting for the supplier", tone: "wait" };
}

/** Rough check of a chosen photo, before upload. */
export function photoProblem(f: { type: string; size: number }): string | null {
  if (!PHOTO_TYPES.includes(f.type)) return "Please choose a JPG, PNG or WEBP photo.";
  return null;
}

/** Folder rule of the private bucket: <buyer company id>/<receipt id>/<file>. */
export function photoPath(orgId: string, receiptId: string, ext: string, nonce: string): string {
  const e = ext.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "jpg";
  return `${orgId}/${receiptId}/${nonce}.${e}`;
}

// ───────────────────────── words for the database's answers ─────────────────────────

const ERRORS: Record<string, string> = {
  not_authenticated: "Please sign in again.",
  not_found: "We couldn't find this order or receipt.",
  not_allowed: "Only the owner or a procurement manager of the buying company can do this.",
  not_receivable: "This order can't take a delivery in its current state.",
  invalid_date: "The delivery date must be between the day the order was placed and today.",
  invalid_lines: "Something is wrong with the items in this delivery. Please reload and try again.",
  invalid_quantity: "Check the quantities. Use numbers, up to 3 decimals, and never reject more than was ordered.",
  invalid_note: "That note is too long.",
  invalid_request: "That request isn't valid.",
  empty_receipt: "Enter a quantity for at least one item.",
  already_voided: "This receipt was already taken back.",
  too_late: "A receipt can only be taken back within 48 hours.",
  locked: "A payment or an objection already depends on this delivery, so it can't be taken back.",
  reason_required: "Please give a short reason.",
  nothing_accepted: "Accept at least one delivery before closing the order as short-delivered.",
  invalid_response: "Choose agree or dispute.",
  note_required: "Please say what is different.",
  too_many_photos: "A receipt can have up to 6 photos.",
  file_missing: "The photo didn't upload. Please try again.",
  file_too_large: "That photo is larger than 5 MB.",
  file_type: "Please choose a JPG, PNG or WEBP photo.",
  already_attached: "That photo is already on the receipt.",
  invalid_path: "That photo couldn't be saved. Please try again.",
};

export function receivingError(e: unknown): string {
  const m = e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : "";
  if (m.includes("Could not find the function")) return "Goods receipts aren't set up yet. Run migration 26 (20261207000026_goods_receipts.sql) in Supabase.";
  // the database words some answers itself ("over_received: only 40 still to accept of Steel rods"): show those as they are
  const detail = /^(over_received|reason_required|empty_receipt|nothing_accepted|too_late|locked|note_required|file_[a-z_]+|too_many_photos): (.+)$/m.exec(m);
  if (detail) return detail[2]!.charAt(0).toUpperCase() + detail[2]!.slice(1);
  const k = Object.keys(ERRORS).find((x) => m.includes(x));
  if (k) return ERRORS[k]!;
  if (m.includes("over_received")) return "You can't accept more than is still to come.";
  return "Something went wrong. Please check your connection and try again.";
}

// ───────────────────────── calls ─────────────────────────

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabase().rpc(fn, args);
  if (error) throw new Error(receivingError(error));
  return data as T;
}

const num = (v: unknown) => Number(v ?? 0);

export async function getReceiving(poId: string): Promise<Receiving> {
  const d = await rpc<Partial<Receiving> | null>("get_po_receiving", { p_po: poId });
  return {
    po_status: d?.po_status ?? "",
    expected_at: d?.expected_at ?? null,
    delivered_at: d?.delivered_at ?? null,
    closed_short: !!d?.closed_short,
    short_close_reason: d?.short_close_reason ?? "",
    legacy: !!d?.legacy,
    can_record: !!d?.can_record,
    can_close_short: !!d?.can_close_short,
    lines: (d?.lines ?? []).map((l) => ({ ...l, ordered: num(l.ordered), accepted: num(l.accepted), rejected: num(l.rejected), remaining: num(l.remaining) })),
    receipts: (d?.receipts ?? []).map((r) => ({
      ...r,
      lines: (r.lines ?? []).map((x) => ({ ...x, accepted: num(x.accepted), rejected: num(x.rejected) })),
      photos: r.photos ?? [],
    })),
  };
}

export interface RecordedReceipt {
  id: string;
  number: string;
  status: string;
  complete: boolean;
  delivered_on: string | null;
  on_time: boolean;
}

export const recordGoodsReceipt = (poId: string, d: { receivedOn: string; note: string; lines: DraftCheck["lines"] }) =>
  rpc<RecordedReceipt>("record_goods_receipt", { p_po: poId, p_data: { receivedOn: d.receivedOn, note: d.note.trim(), lines: d.lines } });
export const voidGoodsReceipt = (receiptId: string, reason: string) => rpc<{ status: string }>("void_goods_receipt", { p_receipt: receiptId, p_reason: reason.trim() });
export const closeReceivingShort = (poId: string, reason: string) => rpc<{ status: string }>("close_receiving_short", { p_po: poId, p_reason: reason.trim() });
export const respondGoodsReceipt = (receiptId: string, response: "agreed" | "disputed", note: string) =>
  rpc<{ response: string }>("respond_goods_receipt", { p_receipt: receiptId, p_response: response, p_note: note.trim() });

/**
 * Phone photos are often 4-8 MB. Shrink them in the browser (longest side 1600 px, JPEG) before upload: faster on a mobile
 * connection and always under the 5 MB limit. Falls back to the original when the browser cannot do it.
 */
export async function shrinkPhoto(file: File): Promise<File> {
  try {
    if (typeof document === "undefined" || typeof createImageBitmap === "undefined") return file;
    if (file.size < 600 * 1024 && file.type === "image/jpeg") return file;
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bmp.width * scale));
    canvas.height = Math.max(1, Math.round(bmp.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close?.();
    const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.82));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

/** Upload one photo into the private bucket, then register it with the receipt. Each step is checked by the database. */
export async function uploadReceiptPhoto(orgId: string, receiptId: string, original: File): Promise<void> {
  const problem = photoProblem(original);
  if (problem) throw new Error(problem);
  const file = await shrinkPhoto(original);
  if (file.size > MAX_PHOTO_BYTES) throw new Error("That photo is larger than 5 MB.");
  const sb = getSupabase();
  const path = photoPath(orgId, receiptId, file.name.split(".").pop() ?? "jpg", crypto.randomUUID());
  const up = await sb.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (up.error) throw new Error("The photo didn't upload. Check your connection and try again.");
  await rpc("attach_receipt_photo", { p_receipt: receiptId, p_path: path, p_name: original.name.slice(0, 200) });
}

/** A link to a photo that works for 60 seconds. */
export async function openReceiptPhoto(photoId: string): Promise<string> {
  const path = await rpc<string>("open_receipt_photo", { p_photo: photoId });
  const { data, error } = await getSupabase().storage.from(BUCKET).createSignedUrl(path, 60);
  if (error || !data?.signedUrl) throw new Error("We couldn't open that photo. Please try again.");
  return data.signedUrl;
}
