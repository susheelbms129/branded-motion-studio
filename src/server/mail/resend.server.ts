/**
 * Resend transport. Server-only: this file reads secrets and must never be imported from client code.
 *
 * - Retries temporary failures (network, 429, 5xx) with exponential backoff + jitter.
 * - Sends an Idempotency-Key so a retry (or a double click) never produces a duplicate email.
 * - Never throws: callers get a result object, so an email outage cannot break a business action.
 */

const RESEND_URL = "https://api.resend.com/emails";
const MAX_ATTEMPTS = 3;

export type SendResult =
  | { ok: true; id: string }
  | { ok: false; error: string; retryable: boolean };

export interface SendArgs {
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
  replyTo?: string | undefined;
  /** Display name only. The real sending address is always the verified Vendora domain. */
  fromName?: string | undefined;
  tags?: { name: string; value: string }[] | undefined;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function mailEnv() {
  return {
    apiKey: process.env.RESEND_API_KEY ?? "",
    from: process.env.MAIL_FROM ?? "Vendora <onboarding@resend.dev>",
    support: process.env.MAIL_SUPPORT_EMAIL ?? "support@vendora.in",
    appUrl: (process.env.APP_URL ?? "").replace(/\/$/, ""),
  };
}

/** `Vendora <a@b.com>` -> `Jane Doe via Vendora <a@b.com>`; the address itself is never changed. */
function withDisplayName(from: string, name?: string): string {
  if (!name) return from;
  const m = from.match(/<([^>]+)>/);
  const address = m ? m[1] : from;
  // Strip anything that could make the display name look like another address (spoofing).
  const clean = name.replace(/[<>"@;,()\[\]\\\r\n]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  if (!clean) return from;
  const safe = `${clean} via Vendora`;
  return `${safe} <${address}>`;
}

// ---- Suppression list (bounces / complaints). In-memory = per server instance; see SETUP-EMAIL.md.
const suppressed = new Set<string>();
export const suppress = (email: string) => void suppressed.add(email.toLowerCase());
export const isSuppressed = (email: string) => suppressed.has(email.toLowerCase());

// ---- Tiny sliding-window rate limiter (abuse protection; per server instance).
const hits = new Map<string, number[]>();
export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= max) {
    hits.set(key, arr);
    return false;
  }
  arr.push(now);
  hits.set(key, arr);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
  return true;
}

const mask = (e: string) => e.replace(/^(.).*(@.*)$/, "$1***$2");

export async function sendEmail(a: SendArgs): Promise<SendResult> {
  const env = mailEnv();
  if (!env.apiKey) return { ok: false, error: "Email is not configured (RESEND_API_KEY missing)", retryable: false };
  if (isSuppressed(a.to)) return { ok: false, error: "Recipient previously bounced or complained", retryable: false };

  const body = JSON.stringify({
    from: withDisplayName(env.from, a.fromName),
    to: [a.to],
    subject: a.subject,
    html: a.html,
    text: a.text,
    ...(a.replyTo ? { reply_to: a.replyTo } : {}),
    ...(a.tags ? { tags: a.tags } : {}),
  });

  let lastError = "Unknown error";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(RESEND_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": a.idempotencyKey.slice(0, 250),
        },
        body,
      });
      const json = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
      if (res.ok && json.id) return { ok: true, id: json.id };
      lastError = json.message ?? `Provider returned ${res.status}`;
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable) return { ok: false, error: lastError, retryable: false };
    } catch (e) {
      lastError = e instanceof Error ? e.message : "Network error";
    }
    if (attempt < MAX_ATTEMPTS) await sleep(400 * 3 ** (attempt - 1) + Math.random() * 200);
  }
  console.error(`[mail] giving up after ${MAX_ATTEMPTS} attempts to ${mask(a.to)}: ${lastError}`);
  return { ok: false, error: lastError, retryable: true };
}
