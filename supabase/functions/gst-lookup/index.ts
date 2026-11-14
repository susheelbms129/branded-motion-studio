// Supabase Edge Function: gst-lookup
//
// Called by the app right after a supplier submits a GST proof (and by a reviewer's "Run live check" button).
// 1. Asks the database (AS THE CALLER, with their login) whether this check may be looked up. That call is the real gate:
//    only the company's owner / finance manager or a reviewer, only for a pending GST proof, with cost limits.
// 2. Asks your GST data provider about the number. The provider key stays here, in a secret. It never reaches a browser.
// 3. Writes the answer with the service role. The browser can never write it.
// The app never depends on this: if anything fails the proof simply has no live result and the reviewer checks by hand.
//
// Secrets (supabase secrets set ...). See TRUST-PASSPORT-GST.md for examples.
//   GST_API_URL            provider endpoint; may contain {{gstin}}
//   GST_API_METHOD         GET or POST (default POST)
//   GST_API_HEADERS        JSON object of headers, for example {"Authorization":"...","x-api-key":"..."}
//   GST_API_BODY           JSON body template for POST, for example {"gstin":"{{gstin}}"} (default exactly that)
// Supabase supplies SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY by itself.

import { createClient } from "jsr:@supabase/supabase-js@2";

import { fillTemplate, looksLikeNotFound, normalizeTaxpayer } from "../_shared/gst-normalize.ts";

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

  const apiUrl = Deno.env.get("GST_API_URL");
  if (!apiUrl) return reply(200, { status: "not_configured" });          // nothing to do, nothing recorded, nothing charged

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return reply(401, { status: "error", message: "Sign in first." });

  let checkId = "";
  try {
    checkId = String(((await req.json()) as { check_id?: unknown }).check_id ?? "");
  } catch {
    return reply(400, { status: "error", message: "Bad request." });
  }
  if (!UUID.test(checkId)) return reply(400, { status: "error", message: "Bad request." });

  const url = Deno.env.get("SUPABASE_URL")!;
  // 1) the gate, as the caller
  const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const gate = await asUser.rpc("request_gst_lookup", { p_check: checkId });
  if (gate.error || typeof gate.data !== "string") {
    const m = gate.error?.message ?? "";
    const code = /already_checked|not_pending|not_applicable|too_many_tries|daily_limit/.exec(m)?.[0];
    return reply(code ? 200 : 403, { status: code ?? "not_allowed" });
  }
  const gstin = gate.data.trim().toUpperCase();
  if (!GSTIN.test(gstin)) return reply(400, { status: "error", message: "Bad request." });

  // 2) the provider
  const asService = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const record = (result: Record<string, unknown>) => asService.rpc("record_gst_lookup", { p_check: checkId, p_result: result });
  try {
    const method = (Deno.env.get("GST_API_METHOD") ?? "POST").toUpperCase() === "GET" ? "GET" : "POST";
    const headers: Record<string, string> = { Accept: "application/json", ...(JSON.parse(Deno.env.get("GST_API_HEADERS") ?? "{}") as Record<string, string>) };
    const init: RequestInit = { method, headers, signal: AbortSignal.timeout(8000) };
    if (method === "POST") {
      headers["Content-Type"] ??= "application/json";
      init.body = fillTemplate(Deno.env.get("GST_API_BODY") ?? '{"gstin":"{{gstin}}"}', gstin, "json");
    }
    const res = await fetch(fillTemplate(apiUrl, gstin, "url"), init);
    const text = await res.text();

    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* not JSON: handled below */
    }
    const taxpayer = res.ok && parsed ? normalizeTaxpayer(parsed) : null;
    if (taxpayer) {
      await record({ outcome: "ok", ...taxpayer });
      return reply(200, { status: "ok" });
    }
    if (looksLikeNotFound(res.status, text)) {
      await record({ outcome: "not_found" });
      return reply(200, { status: "not_found" });
    }
    // 401/403/429/5xx or an unreadable answer: our problem or theirs, not the supplier's. Never guess.
    await record({ outcome: "unavailable", reason: `provider_http_${res.status}` });
    return reply(200, { status: "unavailable" });
  } catch (e) {
    // timeouts, DNS, bad secret JSON. Log the type only: never the secrets or the response body.
    console.error("gst-lookup failed:", e instanceof Error ? e.name : "error");
    await record({ outcome: "unavailable", reason: "provider_unreachable" });
    return reply(200, { status: "unavailable" });
  }
});
