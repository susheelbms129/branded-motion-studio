import { createFileRoute } from "@tanstack/react-router";

import { serviceClient } from "@/server/supabase.server";
import { isConfigured, sendTemplate, waEnv } from "@/server/whatsapp/cloud.server";
import { compose, type ClaimedRow } from "@/server/whatsapp/message.server";
import { verifyBearer } from "@/server/whatsapp/verify.server";

/**
 * The sender job. Call it every minute from any scheduler (Supabase cron, cron-job.org, a Cloudflare cron trigger):
 *   POST https://<your-domain>/api/public/whatsapp-drain      Authorization: Bearer <WHATSAPP_CRON_SECRET>
 * It takes the messages that are due (the database decides who is opted out, who is in quiet hours and what is stale),
 * sends each one as an approved WhatsApp template and records the result. Safe to call twice at once: the database hands each
 * message to one caller only. Setup is in SETUP-WHATSAPP.md.
 */

const BATCH = 20;
const MAX_ROUNDS = 3;

export const Route = createFileRoute("/api/public/whatsapp-drain")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        if (!verifyBearer(process.env.WHATSAPP_CRON_SECRET ?? "", request.headers.get("authorization"))) {
          return new Response("Unauthorized", { status: 401 });
        }
        // Nothing is claimed unless we could actually send, so a missing token never burns an attempt.
        if (!isConfigured()) return Response.json({ ok: false, error: "whatsapp_not_configured" }, { status: 503 });

        let db;
        try {
          db = serviceClient();
        } catch {
          return Response.json({ ok: false, error: "database_not_configured" }, { status: 503 });
        }
        const env = waEnv();
        const tally = { sent: 0, retry: 0, hold: 0, failed: 0 };

        for (let round = 0; round < MAX_ROUNDS; round++) {
          const { data, error } = await db.rpc("wa_claim_batch", { p_limit: BATCH });
          if (error) return Response.json({ ok: false, error: "claim_failed", ...tally }, { status: 500 });
          const rows = (data ?? []) as ClaimedRow[];
          if (rows.length === 0) break;
          let stop = false;
          for (const row of rows) {
            let outcome: "sent" | "retry" | "hold" | "failed";
            let providerId: string | null = null;
            let reason = "";
            const msg = compose(row, env);
            if (!msg.ok) {
              outcome = msg.error === "app_url_missing" ? "hold" : "failed";
              reason = msg.error;
            } else {
              const r = await sendTemplate(msg.message);
              outcome = r.outcome;
              if (r.outcome === "sent") providerId = r.id;
              else reason = r.error;
            }
            tally[outcome]++;
            // The record is the source of truth: a failure to record leaves the row 'sending', and the database hands it out again after 10 minutes.
            await db.rpc("wa_mark_result", { p_id: row.id, p_outcome: outcome, p_provider_id: providerId, p_error: reason });
            if (outcome === "hold" && (reason === "not_configured" || reason.startsWith("401") || reason.startsWith("403") || reason.includes("/190"))) stop = true;
          }
          if (stop || rows.length < BATCH) break;
        }
        console.log(`[whatsapp-drain] sent=${tally.sent} retry=${tally.retry} hold=${tally.hold} failed=${tally.failed}`);
        return Response.json({ ok: true, ...tally });
      },
    },
  },
});
