import { createFileRoute } from "@tanstack/react-router";

import { suppress } from "@/server/mail/resend.server";

/**
 * Resend webhook (Svix-signed). Configure in Resend → Webhooks:
 *   URL: https://<your-domain>/api/public/resend-webhook
 *   Events: email.delivered, email.bounced, email.complained, email.delivery_delayed
 * Set the signing secret (whsec_...) as RESEND_WEBHOOK_SECRET.
 */

const enc = new TextEncoder();

async function verify(secret: string, id: string, ts: string, body: string, sigHeader: string): Promise<boolean> {
  const age = Math.abs(Date.now() / 1000 - Number(ts));
  if (!Number.isFinite(age) || age > 300) return false; // replay protection
  const raw = atob(secret.replace(/^whsec_/, ""));
  const keyBytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`${id}.${ts}.${body}`)));
  let s = "";
  mac.forEach((b) => (s += String.fromCharCode(b)));
  const expected = btoa(s);
  return sigHeader.split(" ").some((part) => {
    const sig = part.split(",")[1] ?? "";
    if (sig.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
    return diff === 0;
  });
}

export const Route = createFileRoute("/api/public/resend-webhook")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const secret = process.env.RESEND_WEBHOOK_SECRET;
        if (!secret) return new Response("Webhook not configured", { status: 503 });
        const id = request.headers.get("svix-id") ?? "";
        const ts = request.headers.get("svix-timestamp") ?? "";
        const sig = request.headers.get("svix-signature") ?? "";
        const body = await request.text();
        let ok = false;
        try {
          ok = !!id && !!ts && !!sig && (await verify(secret, id, ts, body, sig));
        } catch {
          ok = false;
        }
        if (!ok) return new Response("Invalid signature", { status: 401 });

        try {
          const evt = JSON.parse(body) as { type?: string; data?: { to?: string[]; email_id?: string } };
          const to = evt.data?.to ?? [];
          if (evt.type === "email.bounced" || evt.type === "email.complained") {
            to.forEach(suppress); // stop sending to bounced / complaining addresses
          }
          console.log(`[mail-webhook] ${evt.type} ${evt.data?.email_id ?? ""}`);
        } catch {
          /* ignore malformed payloads after signature check */
        }
        return new Response("ok", { status: 200 });
      },
    },
  },
});
