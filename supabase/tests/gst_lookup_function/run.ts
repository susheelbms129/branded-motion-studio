// Runs the REAL gst-lookup function against a fake database and a fake GST provider. No network, no real keys.
// Run:  deno run --allow-net --allow-env --allow-read --import-map=supabase/tests/gst_lookup_function/import_map.json supabase/tests/gst_lookup_function/run.ts
import { calls, script } from "./fake-supabase.ts";
const realServe = Deno.serve.bind(Deno);
let handler!: (r: Request) => Promise<Response>;
// deno-lint-ignore no-explicit-any
(Deno as any).serve = (h: typeof handler) => { handler = h; };
Deno.env.set("SUPABASE_URL", "http://x"); Deno.env.set("SUPABASE_ANON_KEY", "ANON"); Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "SERVICE");
await import("../../functions/gst-lookup/index.ts");

let pass = 0, fail = 0;
const check = (n: string, c: boolean, x = "") => { c ? pass++ : (fail++, console.log("FAIL:", n, x)); };
const ID = crypto.randomUUID();
const call = (body: unknown, auth: string | null = "Bearer jwt") => handler(new Request("http://f", { method: "POST", headers: auth ? { Authorization: auth } : {}, body: typeof body === "string" ? body : JSON.stringify(body) }));
const recorded = () => calls.filter((c) => c.fn === "record_gst_lookup").map((c) => (c.args.p_result as Record<string, unknown>));

// mock provider
let seen: { url: string; method: string; headers: Headers; body: string }[] = [];
let mode: () => Response = () => new Response("{}");
realServe({ port: 8799, onListen() {} }, async (req) => { seen.push({ url: req.url, method: req.method, headers: req.headers, body: await req.text() }); return mode(); });

const PROVIDER = "http://127.0.0.1:8799/gst?g={{gstin}}";
const reset = () => { calls.length = 0; seen = []; script.gate = { data: "29AABCT1332L1ZN", error: null }; };
const GOOD = () => new Response(JSON.stringify({ code: 200, data: { data: { lgnm: "KAVERI INDUSTRIES PRIVATE LIMITED", tradeNam: "Kaveri", sts: "Active", rgdt: "01/07/2017", ctb: "Private Limited Company" } } }), { status: 200 });

// 1. not configured: nothing recorded, nothing charged, no database call
Deno.env.delete("GST_API_URL"); reset();
let r = await call({ check_id: ID });
check("not configured -> 200 not_configured", r.status === 200 && (await r.json()).status === "not_configured");
check("not configured makes no database call", calls.length === 0 && seen.length === 0);

Deno.env.set("GST_API_URL", PROVIDER);
Deno.env.set("GST_API_METHOD", "POST");
Deno.env.set("GST_API_HEADERS", JSON.stringify({ "x-api-key": "SECRET-KEY-123" }));
Deno.env.set("GST_API_BODY", '{"gstin":"{{gstin}}","consent":"Y"}');

// 2. caller problems
reset(); r = await call({ check_id: ID }, null); check("no login -> 401", r.status === 401 && seen.length === 0);
reset(); r = await call({ check_id: "not-a-uuid" }); check("bad id -> 400, provider untouched", r.status === 400 && seen.length === 0 && calls.length === 0);
reset(); r = await call("{{{"); check("bad json -> 400", r.status === 400);
reset(); r = await handler(new Request("http://f", { method: "GET" })); check("GET -> 405", r.status === 405);
reset(); r = await handler(new Request("http://f", { method: "OPTIONS" })); check("CORS preflight ok", r.status === 200 && r.headers.get("Access-Control-Allow-Origin") === "*");

// 3. the database gate decides (runs AS THE USER)
reset(); script.gate = { data: null, error: { message: "not_allowed" } }; r = await call({ check_id: ID });
check("gate says not allowed -> 403 and provider is NOT called", r.status === 403 && seen.length === 0 && recorded().length === 0);
check("gate is called with the user's login, not the service key", calls[0]?.who === "user" && calls[0]?.fn === "request_gst_lookup");
for (const code of ["already_checked", "too_many_tries", "too_soon", "daily_limit", "platform_limit", "not_pending"]) {
  reset(); script.gate = { data: null, error: { message: `ERROR: ${code}: x` } }; r = await call({ check_id: ID });
  check(`gate limit ${code} -> no provider call`, r.status === 200 && (await r.json()).status === code && seen.length === 0);
}
reset(); script.gate = { data: "NOT-A-GSTIN", error: null }; r = await call({ check_id: ID }); check("a corrupt GST number from the db is never sent to the provider", r.status === 400 && seen.length === 0);

// 4. success
reset(); mode = GOOD; r = await call({ check_id: ID }); let j = await r.json();
check("success -> ok", r.status === 200 && j.status === "ok", JSON.stringify(j));
check("answer written with the SERVICE key", calls.at(-1)?.who === "service" && calls.at(-1)?.fn === "record_gst_lookup");
check("normalized result recorded", recorded()[0]?.outcome === "ok" && recorded()[0]?.gst_status === "Active" && recorded()[0]?.registered_on === "2017-07-01" && String(recorded()[0]?.legal_name).startsWith("KAVERI"));
check("provider got GST number in URL, in the body and the secret header", seen[0]?.url.includes("g=29AABCT1332L1ZN") && seen[0]?.body === '{"gstin":"29AABCT1332L1ZN","consent":"Y"}' && seen[0]?.headers.get("x-api-key") === "SECRET-KEY-123" && seen[0]?.headers.get("content-type") === "application/json");
check("response to the browser carries no provider data or secrets", JSON.stringify(j) === '{"status":"ok"}');

// 5. GET providers
reset(); Deno.env.set("GST_API_METHOD", "GET"); mode = GOOD; r = await call({ check_id: ID });
check("GET provider works and sends no body", (await r.json()).status === "ok" && seen[0]?.method === "GET" && seen[0]?.body === "");
Deno.env.set("GST_API_METHOD", "POST");

// 6. inactive registration is passed through faithfully (the database blocks verifying it)
reset(); mode = () => new Response(JSON.stringify({ lgnm: "X LTD", sts: "Cancelled", cxdt: "29/02/2024" })); await call({ check_id: ID });
check("Cancelled recorded as Cancelled with date", recorded()[0]?.gst_status === "Cancelled" && recorded()[0]?.cancelled_on === "2024-02-29");

// 7. not found vs broken provider
reset(); mode = () => new Response('{"error":"Invalid GSTIN"}', { status: 400 }); r = await call({ check_id: ID });
check("provider says invalid -> not_found recorded", (await r.json()).status === "not_found" && recorded()[0]?.outcome === "not_found");
reset(); mode = () => new Response("nope", { status: 404 }); await call({ check_id: ID }); check("404 -> not_found", recorded()[0]?.outcome === "not_found");
for (const st of [401, 403, 429, 500, 503]) {
  reset(); mode = () => new Response('{"message":"not found"}', { status: st }); r = await call({ check_id: ID });
  check(`provider ${st} -> unavailable, NOT not_found`, (await r.json()).status === "unavailable" && recorded()[0]?.outcome === "unavailable" && recorded()[0]?.reason === `provider_http_${st}`);
}
reset(); mode = () => new Response("<html>maintenance</html>", { status: 200 }); r = await call({ check_id: ID });
check("unreadable 200 -> unavailable (never guesses)", (await r.json()).status === "unavailable" && recorded()[0]?.outcome === "unavailable");
reset(); mode = () => new Response(JSON.stringify({ status: "success", data: {} }), { status: 200 }); await call({ check_id: ID });
check("200 without a taxpayer record -> unavailable", recorded()[0]?.outcome === "unavailable");

// 8. provider unreachable / bad secret config
reset(); Deno.env.set("GST_API_URL", "http://127.0.0.1:1/none?g={{gstin}}"); r = await call({ check_id: ID });
check("provider unreachable -> unavailable, function still answers 200", r.status === 200 && (await r.json()).status === "unavailable" && recorded()[0]?.reason === "provider_unreachable");
Deno.env.set("GST_API_URL", PROVIDER); Deno.env.set("GST_API_HEADERS", "{broken json"); reset(); r = await call({ check_id: ID });
check("broken secret config -> unavailable, no crash", r.status === 200 && (await r.json()).status === "unavailable");

console.log(`${pass} passed, ${fail} failed`);
Deno.exit(fail ? 1 : 0);
