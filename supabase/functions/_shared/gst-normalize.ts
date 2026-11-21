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
  /** Extra identity fields. Only present when the provider returned them (so older callers and tests are unaffected). */
  taxpayer_type?: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  nature_of_business?: string;
  block_status?: string;
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


const STATES: Record<string, string> = {
  "01": "Jammu and Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh", "05": "Uttarakhand",
  "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh", "10": "Bihar", "11": "Sikkim",
  "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur", "15": "Mizoram", "16": "Tripura", "17": "Meghalaya",
  "18": "Assam", "19": "West Bengal", "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh",
  "24": "Gujarat", "26": "Dadra and Nagar Haveli and Daman and Diu", "27": "Maharashtra", "29": "Karnataka", "30": "Goa",
  "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu", "34": "Puducherry", "35": "Andaman and Nicobar Islands",
  "36": "Telangana", "37": "Andhra Pradesh", "38": "Ladakh",
};

/** Providers sometimes send a stand-in like "Registered business address" instead of the real one. Never show that as an address. */
const isPlaceholderAddress = (a: string) => a.length < 8 || /^(registered|principal)?\s*(place of )?(business )?address$/i.test(a.trim());

/** Joins address parts with ", ", dropping blanks and immediate repeats ("Chennai, Chennai"). */
function joinParts(parts: string[]): string {
  const out: string[] = [];
  for (const p of parts.map((x) => x.trim()).filter(Boolean)) {
    if (out.at(-1)?.toLowerCase() === p.toLowerCase()) continue;
    out.push(p);
  }
  return out.join(", ");
}

interface Where { address: string; city: string; state: string; pincode: string }

/**
 * The registered (principal) place of business. Understands both our provider's shape (address_details + top-level
 * city/pincode) and the raw GSTN shape (pradr.addr with bno, bnm, flno, st, loc, dst, stcd, city, pncd, or pradr.adr).
 */
function readAddress(rec: Record<string, Json>, gstin: string): Where {
  const det = asObj(rec["address_details"]) ?? asObj(asObj(rec["pradr"])?.["addr"]) ?? {};
  const flat = pick(rec, ["address", "principal_place_address", "adr"]) || str(asObj(rec["pradr"])?.["adr"]);
  const city = pick(det, ["city", "loc_city", "dst"]) || pick(rec, ["city"]) || pick(det, ["district"]);
  const code = (pick(rec, ["state_code"]) || gstin.slice(0, 2)).padStart(2, "0");
  const state = pick(det, ["state"]) || pick(rec, ["state"]) || STATES[code] || "";
  const pincode = (pick(det, ["pincode", "pncd"]) || pick(rec, ["pincode"])).replace(/\D/g, "").slice(0, 6);
  const street = joinParts([
    pick(det, ["building_number", "bno"]), pick(det, ["building_name", "bnm"]), pick(det, ["floor", "flno"]),
    pick(det, ["street", "st"]), pick(det, ["locality", "loc"]), pick(det, ["landmark"]),
  ]);
  let address = "";
  if (street) {
    address = joinParts([street, pick(det, ["district", "dst"]), city, state]) + (pincode ? ` ${pincode}` : "");
  } else if (flat && !isPlaceholderAddress(flat)) {
    address = flat;
  }
  return { address: address.slice(0, 300), city: city.slice(0, 80), state: state.slice(0, 60), pincode };
}

const natureOf = (rec: Record<string, Json>): string => {
  const v = rec["nature_of_business"] ?? rec["nba"] ?? rec["nature_of_business_activities"];
  const list = Array.isArray(v) ? v.map(str).filter(Boolean) : str(v) ? [str(v)] : [];
  return list.join(", ").slice(0, 200);
};

export function normalizeTaxpayer(body: Json, gstin = ""): Taxpayer | null {
  const rec = findRecord(body);
  if (!rec) return null;
  const where = readAddress(rec, (gstin || pick(rec, ["gstin", "gstin_number"])).toUpperCase());
  const extra: Partial<Taxpayer> = {
    taxpayer_type: pick(rec, ["taxpayer_type", "taxpayerType", "dty"]).slice(0, 40),
    address: where.address, city: where.city, state: where.state, pincode: where.pincode,
    nature_of_business: natureOf(rec),
    block_status: pick(rec, ["block_status", "blockStatus"]).slice(0, 40),
  };
  const base: Taxpayer = {
    legal_name: pick(rec, LEGAL).slice(0, 200),
    trade_name: pick(rec, ["tradeNam", "trade_name", "tradeName"]).slice(0, 200),
    gst_status: normalizeStatus(pick(rec, ["sts", "gstin_status", "registration_status", "status"])).slice(0, 40),
    registered_on: toIsoDate(pick(rec, ["rgdt", "registration_date", "registrationDate"])),
    cancelled_on: toIsoDate(pick(rec, ["cxdt", "cancellation_date", "cancellationDate"])),
    constitution: pick(rec, ["ctb", "constitution", "constitution_of_business", "business_constitution"]).slice(0, 80),
  };
  // keep only the extra fields that actually have a value
  for (const [k, v] of Object.entries(extra)) if (v) (base as unknown as Record<string, string>)[k] = v as string;
  return base;
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
