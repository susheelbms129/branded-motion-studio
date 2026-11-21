// Supabase Edge Function: gst-preview
//
// "GST Instant Identity". While a supplier types their GST number, the form shows the government record
// (legal name, trade name, status, type, address, ...) so they can confirm it is really their business BEFORE submitting.
//
// 1. Asks the database AS THE CALLER (request_gst_preview): only the owner / finance manager of that supplier company,
//    with cost limits. A fresh cached answer (6 h) is returned without calling the provider, so repeat typing is free.
// 2. Otherwise asks the provider (same secrets as gst-lookup). The key never reaches the browser.
// 3. Stores the answer with the service role (record_gst_preview) and returns it with the name / state comparison.
// Never blocks anything: if it fails, the form simply shows no live record and the normal review path still works.

import { createClient } from "jsr:@supabase/supabase-js@2";

import { fetchTaxpayer } from "../_shared/gst-provider.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { status: "error", message: "POST only" });
  if (!Deno.env.get("GST_API_URL")) return reply(200, { status: "not_configured" });

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return reply(401, { status: "error", message: "Sign in first." });

  let orgId = "";
  let gstin = "";
  try {
    const b = (await req.json()) as { org_id?: unknown; gstin?: unknown };
    orgId = String(b.org_id ?? "");
    gstin = String(b.gstin ?? "").trim().toUpperCase();
  } catch {
    return reply(400, { status: "error", message: "Bad request." });
  }
  if (!UUID.test(orgId) || !GSTIN.test(gstin)) return reply(400, { status: "error", message: "Bad request." });

  const url = Deno.env.get("SUPABASE_URL")!;
  const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const gate = await asUser.rpc("request_gst_preview", { p_org: orgId, p_gstin: gstin });
  if (gate.error || !gate.data || typeof gate.data !== "object") {
    const m = gate.error?.message ?? "";
    const code = /too_soon|daily_limit|bad_gstin/.exec(m)?.[0];
    return reply(code ? 200 : 403, { status: code ?? "not_allowed" });
  }
  const g = gate.data as { cached?: Record<string, unknown> };
  if (g.cached) return reply(200, { status: g.cached.outcome === "not_found" ? "not_found" : "ok", data: g.cached });

  const answer = await fetchTaxpayer(gstin);
  if (answer.kind === "unavailable") return reply(200, { status: "unavailable" }); // nothing stored: it may work a minute later

  const asService = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const result = answer.kind === "ok" ? { outcome: "ok", ...answer.taxpayer } : { outcome: "not_found" };
  const saved = await asService.rpc("record_gst_preview", { p_org: orgId, p_gstin: gstin, p_result: result });
  if (saved.error || !saved.data) return reply(200, { status: "unavailable" });
  return reply(200, { status: answer.kind === "ok" ? "ok" : "not_found", data: saved.data });
});
