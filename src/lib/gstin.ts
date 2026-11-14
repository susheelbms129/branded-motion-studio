/**
 * GST number pre-check: the same maths the database runs (see _gstin_report in the trust-passport migration).
 * It only gives instant feedback while the supplier types; the database re-checks everything and is what counts.
 */
const CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

const STATES: Record<string, string> = {
  "01": "Jammu and Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh", "05": "Uttarakhand",
  "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh", "10": "Bihar", "11": "Sikkim",
  "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur", "15": "Mizoram", "16": "Tripura", "17": "Meghalaya",
  "18": "Assam", "19": "West Bengal", "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh",
  "24": "Gujarat", "26": "Dadra and Nagar Haveli and Daman and Diu", "27": "Maharashtra", "29": "Karnataka", "30": "Goa",
  "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu", "34": "Puducherry", "35": "Andaman and Nicobar Islands",
  "36": "Telangana", "37": "Andhra Pradesh", "38": "Ladakh",
};

export interface GstinReport {
  formatOk: boolean;
  checksumOk: boolean;
  stateName: string | null;
  /** null when it cannot be compared (no state on the business yet). */
  stateMatches: boolean | null;
}

export function checkGstin(input: string, businessState = ""): GstinReport {
  const g = input.trim().toUpperCase();
  const bad: GstinReport = { formatOk: false, checksumOk: false, stateName: null, stateMatches: null };
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g)) return bad;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = CHARS.indexOf(g.charAt(i)) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(v / 36) + (v % 36);
  }
  const checksumOk = CHARS[(36 - (sum % 36)) % 36] === g.charAt(14);
  const stateName = STATES[g.slice(0, 2)] ?? null;
  const bs = businessState.trim().toLowerCase();
  return { formatOk: true, checksumOk, stateName, stateMatches: !stateName || !bs ? null : stateName.toLowerCase() === bs };
}

/** One friendly sentence for the form, or "" when the number looks fine. */
export function gstinProblem(input: string): string {
  const g = input.trim();
  if (g.length === 0) return "";
  if (g.length < 15) return "A GST number has 15 characters.";
  const r = checkGstin(g);
  if (!r.formatOk) return "This is not in the GST number format (for example 29ABCDE1234F1Z5).";
  if (!r.checksumOk) return "This number has a typo. Please check each character.";
  if (!r.stateName) return "The first two digits are not a valid state code.";
  return "";
}
