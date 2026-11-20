import { getSupabase } from "@/lib/supabase";

/**
 * WhatsApp alerts, browser side (supabase/migrations/20261206000025_whatsapp_alerts.sql).
 * The database holds the number, checks the code, merges bursts, keeps quiet hours and the monthly cap. The browser only asks,
 * and words the answers. The full number never comes back: only a masked form.
 */

export const WHATSAPP_KEY = "whatsapp";

export interface WaRecent {
  kind: "test" | "rfq" | "po";
  title: string;
  status: "queued" | "sending" | "sent" | "failed" | "skipped";
  created_at: string;
  delivered: boolean;
  merged: number;
}

export interface WaSettings {
  status: "none" | "pending" | "verified";
  /** Masked, e.g. +91••••10 */
  phone?: string;
  paused?: boolean;
  want_rfq?: boolean;
  want_po?: boolean;
  quiet_start?: number;
  quiet_end?: number;
  code_pending?: boolean;
  recent: WaRecent[];
  month_count: number;
}

export type ConfirmResult =
  | { ok: true }
  | { ok: false; error: "wrong_code" | "expired" | "too_many" | "no_pending" | "phone_in_use"; left?: number };

/**
 * What a person typed -> +<country><number>, or null when it cannot be a mobile number.
 * A 10 digit number starting 6-9 is taken as Indian (+91); a leading 0 or 91 is dropped; "+" or "00" starts a full number.
 */
export function normalizePhone(input: string): string | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;
  let digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("00")) digits = `+${digits.slice(2)}`;
  if (digits.startsWith("+")) {
    const d = digits.slice(1).replace(/\D/g, "");
    return /^[1-9][0-9]{7,14}$/.test(d) ? `+${d}` : null;
  }
  const d = digits.replace(/\D/g, "");
  if (/^[6-9][0-9]{9}$/.test(d)) return `+91${d}`;
  if (/^0[6-9][0-9]{9}$/.test(d)) return `+91${d.slice(1)}`;
  if (/^91[6-9][0-9]{9}$/.test(d)) return `+${d}`;
  return null;
}

/** 0-23 -> "9 pm" */
export function hourLabel(h: number): string {
  const x = ((Math.floor(h) % 24) + 24) % 24;
  const ap = x < 12 ? "am" : "pm";
  const t = x % 12 === 0 ? 12 : x % 12;
  return `${t} ${ap}`;
}

export function quietLabel(start: number, end: number): string {
  return start === end ? "No quiet hours" : `Quiet from ${hourLabel(start)} to ${hourLabel(end)} (India time)`;
}

const ERRORS: Record<string, string> = {
  not_authenticated: "Please sign in again.",
  invalid_phone: "That doesn't look like a mobile number. Use your WhatsApp number, for example 98765 43210.",
  phone_in_use: "That number is already used by another Vendora account.",
  rate_limited: "Too many tries. Please wait a little and try again.",
  not_verified: "Confirm your WhatsApp number first.",
  no_contact: "Add your WhatsApp number first.",
  invalid_request: "That setting isn't valid.",
};

export const CONFIRM_ERRORS: Record<string, string> = {
  wrong_code: "That code isn't right.",
  expired: "That code has expired. Send a new one.",
  too_many: "Too many wrong tries. Send a new code.",
  no_pending: "There is no code waiting. Send a new one.",
  phone_in_use: "That number is already used by another Vendora account.",
};

export function confirmMessage(r: Extract<ConfirmResult, { ok: false }>): string {
  const base = CONFIRM_ERRORS[r.error] ?? "That didn't work. Please try again.";
  return r.error === "wrong_code" && typeof r.left === "number" && r.left > 0 ? `${base} ${r.left} ${r.left === 1 ? "try" : "tries"} left.` : base;
}

function errorText(error: { message?: string }): string {
  const m = error.message ?? "";
  if (m.includes("Could not find the function")) return "WhatsApp alerts aren't set up yet. Run migration 25 (20261206000025_whatsapp_alerts.sql) in Supabase.";
  const k = Object.keys(ERRORS).find((x) => m.includes(x));
  return k ? ERRORS[k]! : "Something went wrong. Please check your connection and try again.";
}

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await getSupabase().rpc(fn, args);
  if (error) throw new Error(errorText(error));
  return data as T;
}

const clean = (d: Partial<WaSettings> | null): WaSettings => ({
  status: d?.status ?? "none",
  ...(d?.phone ? { phone: d.phone } : {}),
  ...(d?.paused !== undefined ? { paused: d.paused } : {}),
  ...(d?.want_rfq !== undefined ? { want_rfq: d.want_rfq } : {}),
  ...(d?.want_po !== undefined ? { want_po: d.want_po } : {}),
  ...(d?.quiet_start !== undefined ? { quiet_start: Number(d.quiet_start) } : {}),
  ...(d?.quiet_end !== undefined ? { quiet_end: Number(d.quiet_end) } : {}),
  ...(d?.code_pending !== undefined ? { code_pending: d.code_pending } : {}),
  recent: d?.recent ?? [],
  month_count: Number(d?.month_count ?? 0),
});

export const getWhatsAppSettings = async () => clean(await rpc<Partial<WaSettings>>("get_whatsapp_settings"));
export const startWhatsAppVerification = (phone: string) => rpc<{ status: "code_sent" | "verified"; phone: string }>("start_whatsapp_verification", { p_phone: phone });
export const confirmWhatsAppVerification = (code: string) => rpc<ConfirmResult>("confirm_whatsapp_verification", { p_code: code });
export const setWhatsAppPrefs = async (p: Partial<Pick<WaSettings, "want_rfq" | "want_po" | "paused" | "quiet_start" | "quiet_end">>) =>
  clean(await rpc<Partial<WaSettings>>("set_whatsapp_prefs", { p_data: p }));
export const stopWhatsApp = () => rpc<{ status: "none" }>("stop_whatsapp");
export const sendWhatsAppTest = () => rpc<{ queued: true }>("send_whatsapp_test");

/** A short plain word for a message's state. */
export function recentLabel(r: WaRecent): { text: string; tone: "good" | "wait" | "bad" | "muted" } {
  if (r.status === "sent") return r.delivered ? { text: "Delivered", tone: "good" } : { text: "Sent", tone: "good" };
  if (r.status === "queued" || r.status === "sending") return { text: "Waiting to send", tone: "wait" };
  if (r.status === "failed") return { text: "Could not be delivered", tone: "bad" };
  return { text: "Not sent", tone: "muted" };
}
