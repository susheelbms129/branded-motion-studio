/**
 * IFSC lookup for the bank proof form. Uses the free public Razorpay IFSC directory (no key, allows browser calls).
 * Display only: nothing from here is stored or trusted by the database, and a failure never blocks the form.
 */
export const IFSC_FORMAT = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export interface IfscBranch {
  bank: string;
  branch: string;
  address: string;
  city: string;
  state: string;
  micr: string;
  neft: boolean;
  rtgs: boolean;
  imps: boolean;
  upi: boolean;
}
export type IfscResult = { status: "ok"; data: IfscBranch } | { status: "not_found" } | { status: "unavailable" };

const cache = new Map<string, IfscResult>();
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export async function lookupIfsc(code: string): Promise<IfscResult> {
  const ifsc = code.trim().toUpperCase();
  if (!IFSC_FORMAT.test(ifsc)) return { status: "not_found" };
  const hit = cache.get(ifsc);
  if (hit) return hit;
  try {
    const res = await fetch(`https://ifsc.razorpay.com/${encodeURIComponent(ifsc)}`, { signal: AbortSignal.timeout(6000) });
    if (res.status === 404) {
      const r: IfscResult = { status: "not_found" };
      cache.set(ifsc, r);
      return r;
    }
    if (!res.ok) return { status: "unavailable" };
    const j = (await res.json()) as Record<string, unknown>;
    if (!text(j["BANK"])) return { status: "unavailable" };
    const r: IfscResult = {
      status: "ok",
      data: {
        bank: text(j["BANK"]), branch: text(j["BRANCH"]), address: text(j["ADDRESS"]), city: text(j["CITY"]), state: text(j["STATE"]),
        micr: text(j["MICR"]), neft: j["NEFT"] === true, rtgs: j["RTGS"] === true, imps: j["IMPS"] === true, upi: j["UPI"] === true,
      },
    };
    cache.set(ifsc, r);
    return r;
  } catch {
    return { status: "unavailable" };
  }
}
