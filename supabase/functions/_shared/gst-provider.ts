// Calls the GST data provider (same secrets as the gst-lookup function) and returns one of three safe answers.
// Used by gst-preview. Secrets: GST_API_URL, GST_API_METHOD, GST_API_HEADERS, GST_API_BODY (see TRUST-PASSPORT-GST.md).
import { fillTemplate, looksLikeNotFound, normalizeTaxpayer, type Taxpayer } from "./gst-normalize.ts";

export type ProviderAnswer =
  | { kind: "ok"; taxpayer: Taxpayer }
  | { kind: "not_found" }
  | { kind: "unavailable"; reason: string };

export async function fetchTaxpayer(gstin: string): Promise<ProviderAnswer> {
  const apiUrl = Deno.env.get("GST_API_URL");
  if (!apiUrl) return { kind: "unavailable", reason: "not_configured" };
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
    try { parsed = JSON.parse(text); } catch { /* not JSON: handled below */ }
    const taxpayer = res.ok && parsed ? normalizeTaxpayer(parsed, gstin) : null;
    if (taxpayer) return { kind: "ok", taxpayer };
    if (looksLikeNotFound(res.status, text)) return { kind: "not_found" };
    return { kind: "unavailable", reason: `provider_http_${res.status}` };
  } catch (e) {
    console.error("gst provider failed:", e instanceof Error ? e.name : "error"); // type only: never secrets or bodies
    return { kind: "unavailable", reason: "provider_unreachable" };
  }
}
