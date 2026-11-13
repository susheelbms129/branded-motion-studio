// Buyer onboarding answers are kept in this browser only (front-end for now), the same way the
// supplier draft is. Nothing here is sent to the database; only the company name, industry and
// city go through the existing createWorkspace call when the buyer launches their workspace.

export type NextAction = "suppliers" | "rfq" | "team";

export interface BuyerDraft {
  // Step 2: business information
  companyName: string;
  businessType: string;
  industry: string;
  country: string;
  state: string;
  city: string;
  website: string;
  companySize: string;
  // Step 3: procurement needs
  categories: string[];
  frequency: string;
  budget: string;
  budgetCurrency: string;
  // Step 4: workspace setup (all optional)
  priorities: string[];
  sourcing: string[];
  delivery: string;
  nextAction: NextAction | null;
  // Where the buyer left off, so "Save and finish later" resumes in the right place.
  step: number;
}

export const BUSINESS_TYPES = ["Manufacturer", "Distributor", "Wholesaler", "Retailer", "Service business", "Other"] as const;

export const INDUSTRIES = [
  "Manufacturing",
  "Construction",
  "Automotive",
  "Electronics",
  "Healthcare",
  "Food & Beverage",
  "Retail & E-commerce",
  "Agriculture",
  "Logistics",
  "Other",
] as const;

export const COMPANY_SIZES = ["1–10 employees", "11–50 employees", "51–200 employees", "201–500 employees", "500+ employees"] as const;

export const PURCHASE_CATEGORIES = [
  "Raw Materials",
  "Industrial Machinery",
  "Electrical Equipment",
  "Packaging Materials",
  "Chemicals",
  "Construction Materials",
  "Electronics",
  "Office Supplies",
  "Logistics & Transport",
  "Other",
] as const;

export const FREQUENCIES = ["Daily", "Weekly", "Monthly", "Occasionally", "Based on project requirements"] as const;

export const PREFER_NOT_TO_SAY = "Prefer not to say";

/** Budget ranges per order. Labels follow the currency of the buyer's country; the draft stores the currency with the range. */
export function budgetOptions(currency: string): string[] {
  if (currency === "INR") {
    return ["Below ₹10,000", "₹10,000–₹50,000", "₹50,000–₹1 lakh", "₹1–5 lakh", "₹5–10 lakh", "Above ₹10 lakh", PREFER_NOT_TO_SAY];
  }
  // Other currencies: a neutral set so the list never shows the wrong symbol.
  return [`Below ${currency} 1,000`, `${currency} 1,000–5,000`, `${currency} 5,000–25,000`, `${currency} 25,000–100,000`, `Above ${currency} 100,000`, PREFER_NOT_TO_SAY];
}

export const SUPPLIER_PRIORITIES = [
  "Competitive pricing",
  "Product quality",
  "Fast delivery",
  "Supplier reliability",
  "Certifications and compliance",
  "After-sales support",
] as const;

export const SOURCING_AREAS = ["Within my city", "Within my state", "Anywhere in India", "International suppliers"] as const;

export const DELIVERY_TIMELINES = ["Within 1–3 days", "Within one week", "Within 2–4 weeks", "Flexible"] as const;

export const EMPTY_DRAFT: BuyerDraft = {
  companyName: "",
  businessType: "",
  industry: "",
  country: "India",
  state: "",
  city: "",
  website: "",
  companySize: "",
  categories: [],
  frequency: "",
  budget: "",
  budgetCurrency: "INR",
  priorities: [],
  sourcing: [],
  delivery: "",
  nextAction: null,
  step: 0,
};

const KEY = "vendora-buyer-draft";

export function loadBuyerDraft(): BuyerDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const v = JSON.parse(window.localStorage.getItem(KEY) ?? "null") as Partial<BuyerDraft> | null;
    if (!v || typeof v.companyName !== "string") return null;
    // Merge over the defaults so a draft saved by an older version can't leave a field undefined.
    return { ...EMPTY_DRAFT, ...v, step: Math.min(Math.max(Number(v.step) || 0, 0), 4) };
  } catch {
    return null;
  }
}

export function saveBuyerDraft(d: BuyerDraft) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    /* private mode: the answers just won't be remembered if the page is closed */
  }
}

export function clearBuyerDraft() {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}

/** Where the buyer goes after launching: the action they picked, otherwise the dashboard. */
export function landingPathFor(a: NextAction | null): "/app" | "/app/suppliers" | "/app/rfqs" | "/app/team" {
  if (a === "suppliers") return "/app/suppliers";
  if (a === "rfq") return "/app/rfqs";
  if (a === "team") return "/app/team";
  return "/app";
}

/** Light check for the optional website field. Empty is fine. */
export function websiteError(v: string): string | undefined {
  const s = v.trim();
  if (!s) return undefined;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    return u.hostname.includes(".") ? undefined : "Enter a valid website, like example.com";
  } catch {
    return "Enter a valid website, like example.com";
  }
}
