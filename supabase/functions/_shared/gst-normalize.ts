/**
 * Turns whatever a GST data provider returns into ONE small, safe shape.
 *
 * Every GST provider ultimately relays the government (GSTN) "search taxpayer" record, whose fields are called
 * lgnm (legal name), tradeNam (trade name), sts (status), rgdt (registration date), cxdt (cancellation date)
 * and ctb (constitution). Providers wrap it differently, so we search the response for the record instead of
 * trusting one fixed wrapper. Pure functions only: no network, no secrets, easy to test.
 */

export interface Taxpayer {
  legal_name: string;
  trade_name: string;
  gst_status: string;
  registered_on: string | null;
  cancelled_on: string | null;
  constitution: string;
}

type Json = unknown;
const asObj = (v: Json): Record<string, Json> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, Json>) : null);
const str = (v: Json): string => (typeof v === "string" ? v.trim() : "");
const pick = (o: Record<string, Json>, keys: string[]): string => {
  for (const k of keys) {
    const s = str(o[k]);
    if (s) return s;
  }
  return "";
};

const LEGAL = ["lgnm", "legal_name", "legalName", "legal_name_of_business"];

/** Finds the object that holds the taxpayer's legal name, anywhere in the response (max depth 6). */
function findRecord(v: Json, depth = 0): Record<string, Json> | null {
  const o = asObj(v);
  if (!o || depth > 6) return null;
  if (pick(o, LEGAL)) return o;
  for (const child of Object.values(o)) {
    const hit = findRecord(child, depth + 1);
    if (hit) return hit;
  }
  return null;
}

/** "19/06/2023", "2023-06-19" or "19-06-2023" -> "2023-06-19"; anything else -> null. */
export function toIsoDate(s: string): string | null {
  const t = s.trim();
  let m = /^(\d{2})[/-](\d{2})[/-](\d{4})$/.exec(t);
  const [y, mo, d] = m ? [m[3], m[2], m[1]] : (m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t)) ? [m[1], m[2], m[3]] : [null, null, null];
  if (!y || !mo || !d) return null;
  const dt = new Date(`${y}-${mo}-${d}T00:00:00Z`);
  return Number.isNaN(dt.getTime()) || dt.toISOString().slice(0, 10) !== `${y}-${mo}-${d}` ? null : `${y}-${mo}-${d}`;
}

/** "ACTIVE", "active " -> "Active"; "Cancelled" stays; unknown text is kept but trimmed; empty -> "Unknown". */
export function normalizeStatus(s: string): string {
  const t = s.trim();
  if (!t) return "Unknown";
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

export function normalizeTaxpayer(body: Json): Taxpayer | null {
  const rec = findRecord(body);
  if (!rec) return null;
  return {
    legal_name: pick(rec, LEGAL).slice(0, 200),
    trade_name: pick(rec, ["tradeNam", "trade_name", "tradeName"]).slice(0, 200),
    gst_status: normalizeStatus(pick(rec, ["sts", "gstin_status", "registration_status"])).slice(0, 40),
    registered_on: toIsoDate(pick(rec, ["rgdt", "registration_date", "registrationDate"])),
    cancelled_on: toIsoDate(pick(rec, ["cxdt", "cancellation_date", "cancellationDate"])),
    constitution: pick(rec, ["ctb", "constitution", "constitution_of_business"]).slice(0, 80),
  };
}

/** True when the provider is telling us the GST number does not exist (as opposed to being broken or rejecting our key). */
export function looksLikeNotFound(httpStatus: number, bodyText: string): boolean {
  if (httpStatus === 404) return true;
  if (httpStatus === 401 || httpStatus === 403 || httpStatus === 429 || httpStatus >= 500) return false;
  return /not\s*found|no\s*record|invalid\s*gstin|gstin\s*(is\s*)?(invalid|not\s*valid)|does\s*not\s*exist/i.test(bodyText.slice(0, 2000));
}

/** Fills {{gstin}} in a URL or JSON template, with the value URL- or JSON-escaped so it can't break out. */
export function fillTemplate(template: string, gstin: string, mode: "url" | "json"): string {
  const safe = mode === "url" ? encodeURIComponent(gstin) : JSON.stringify(gstin).slice(1, -1);
  return template.replaceAll("{{gstin}}", safe);
}
