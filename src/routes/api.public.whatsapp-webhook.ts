import { createFileRoute } from "@tanstack/react-router";

import { serviceClient } from "@/server/supabase.server";
import { sendText } from "@/server/whatsapp/cloud.server";
import { isStopReply } from "@/server/whatsapp/message.server";
import { safeEqual, verifyMetaSignature } from "@/server/whatsapp/verify.server";

/**
 * WhatsApp webhook (Meta). Configure in Meta → WhatsApp → Configuration:
 *   Callback URL: https://<your-domain>/api/public/whatsapp-webhook
 *   Verify token: the value of WHATSAPP_VERIFY_TOKEN
 *   Subscribe to: messages
 * It does two things: records delivery results (delivered, read, failed) and honours a STOP reply at once.
 * Every POST must carry Meta's signature (X-Hub-Signature-256, made with WHATSAPP_APP_SECRET); anything else is refused.
 */

interface Change {
  value?: {
    statuses?: { id?: string; status?: string; errors?: { code?: number; title?: string }[] }[];
    messages?: { from?: string; type?: string; text?: { body?: string }; button?: { text?: string } }[];
  };
}

export const Route = createFileRoute("/api/public/whatsapp-webhook")({
  server: {
    handlers: {
      // Meta calls this once, when the webhook is saved, to prove the URL is ours.
      GET: async ({ request }: { request: Request }) => {
        const token = process.env.WHATSAPP_VERIFY_TOKEN ?? "";
        const u = new URL(request.url);
        const given = u.searchParams.get("hub.verify_token") ?? "";
        if (token.length >= 16 && u.searchParams.get("hub.mode") === "subscribe" && safeEqual(given, token)) {
          return new Response(u.searchParams.get("hub.challenge") ?? "", { status: 200 });
        }
        return new Response("Forbidden", { status: 403 });
      },

      POST: async ({ request }: { request: Request }) => {
        const secret = process.env.WHATSAPP_APP_SECRET ?? "";
        if (!secret) return new Response("Webhook not configured", { status: 503 });
        const body = await request.text();
        let valid = false;
        try {
          valid = await verifyMetaSignature(secret, body, request.headers.get("x-hub-signature-256"));
        } catch {
          valid = false;
        }
        if (!valid) return new Response("Invalid signature", { status: 401 });

        try {
          const payload = JSON.parse(body) as { entry?: { changes?: Change[] }[] };
          const db = serviceClient();
          for (const entry of payload.entry ?? []) {
            for (const ch of entry.changes ?? []) {
              for (const s of ch.value?.statuses ?? []) {
                if (!s.id || !s.status) continue;
                const err = s.errors?.[0];
                await db.rpc("wa_provider_status", { p_provider_id: s.id, p_status: s.status, p_error: err ? `${err.code ?? ""} ${err.title ?? ""}`.trim() : "" });
              }
              for (const m of ch.value?.messages ?? []) {
                const text = m.text?.body ?? m.button?.text ?? "";
                if (m.from && /^[0-9]{8,15}$/.test(m.from) && isStopReply(text)) {
                  await db.rpc("wa_stop_by_phone", { p_phone: `+${m.from}` });
                  // inside the 24 hours that follow their message, a plain reply is allowed
                  await sendText(m.from, "Okay, Vendora WhatsApp alerts are paused. You can turn them on again in Vendora under Notifications.");
                }
              }
            }
          }
        } catch (e) {
          console.log(`[whatsapp-webhook] ${e instanceof Error ? e.message : "error"}`);
        }
        // Always 200 after a valid signature, so Meta does not keep re-sending the same event.
        return new Response("ok", { status: 200 });
      },
    },
  },
});
