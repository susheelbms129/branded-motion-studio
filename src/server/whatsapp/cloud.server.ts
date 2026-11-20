/**
 * WhatsApp Cloud API transport (Meta). Server-only: reads secrets, never import from client code.
 *
 * One attempt per call, with a timeout. Retrying is the database's job (wa_mark_result), so a crash or a deploy in the middle
 * of a batch can never lose or duplicate a message: unfinished rows are handed out again after 10 minutes.
 * Never throws: callers get a result object, so a WhatsApp outage can never break anything.
 *
 *   sent   - WhatsApp accepted it
 *   retry  - a temporary problem (network, rate limit, WhatsApp side): try again soon
 *   hold   - OUR setup is wrong (token expired, template missing or not approved): wait, and do not use up an attempt
 *   failed - this message can never be delivered (number not on WhatsApp, blocked, invalid)
 */
import type { TemplateMessage, WaEnv } from "./message.server";

export type CloudResult =
  | { outcome: "sent"; id: string }
  | { outcome: "retry" | "hold" | "failed"; error: string };

export function waEnv(): WaEnv & { token: string; phoneNumberId: string; version: string } {
  return {
    token: process.env.WHATSAPP_TOKEN ?? "",
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? "",
    version: process.env.WHATSAPP_API_VERSION ?? "v24.0",
    appUrl: (process.env.APP_URL ?? "").replace(/\/$/, ""),
    alertTemplate: process.env.WHATSAPP_ALERT_TEMPLATE ?? "vendora_alert",
    verifyTemplate: process.env.WHATSAPP_VERIFY_TEMPLATE ?? "vendora_verify_code",
    language: process.env.WHATSAPP_TEMPLATE_LANG ?? "en",
  };
}

export const isConfigured = () => {
  const e = waEnv();
  return Boolean(e.token && e.phoneNumberId);
};

/** Meta error codes that mean "we set it up wrong" (token, template, number, account), not "this person cannot be reached". Checked against Meta's error-code page. */
const SETUP_CODES = new Set([100, 190, 368, 131048, 132000, 132001, 132005, 132007, 132012, 132015, 132016, 133005, 133010]);
/** Temporary: rate limits and WhatsApp-side trouble. */
const TEMP_CODES = new Set([4, 17, 80007, 130429, 131016, 131056, 133004, 133016]);

export function classify(status: number, code: number | undefined, message: string): CloudResult {
  const error = `${status}${code ? `/${code}` : ""} ${message}`.slice(0, 280);
  if (status === 401 || status === 403 || (code !== undefined && SETUP_CODES.has(code))) return { outcome: "hold", error };
  if (status === 429 || status >= 500 || (code !== undefined && TEMP_CODES.has(code))) return { outcome: "retry", error };
  return { outcome: "failed", error };
}

async function post(path: string, body: unknown): Promise<CloudResult> {
  const e = waEnv();
  if (!e.token || !e.phoneNumberId) return { outcome: "hold", error: "not_configured" };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10_000);
  try {
    const res = await fetch(`https://graph.facebook.com/${e.version}/${e.phoneNumberId}/${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${e.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    const json = (await res.json().catch(() => ({}))) as {
      messages?: { id?: string }[];
      error?: { code?: number; message?: string };
    };
    if (res.ok) {
      const id = json.messages?.[0]?.id;
      return id ? { outcome: "sent", id } : { outcome: "retry", error: "no_message_id" };
    }
    return classify(res.status, json.error?.code, json.error?.message ?? res.statusText);
  } catch (err) {
    return { outcome: "retry", error: err instanceof Error ? err.name : "network" };
  } finally {
    clearTimeout(timer);
  }
}

export function sendTemplate(m: TemplateMessage): Promise<CloudResult> {
  return post("messages", {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: m.to,
    type: "template",
    template: { name: m.template, language: { code: m.language }, components: m.components },
  });
}

/** Free-form text, allowed only as a reply inside 24 hours of the person writing to us (used to confirm a STOP). */
export function sendText(to: string, text: string): Promise<CloudResult> {
  return post("messages", { messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { body: text.slice(0, 500) } });
}
