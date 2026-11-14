// Buyer onboarding answers. They are saved to the database on every Continue (see lib/onboarding-api.ts)
// and the company itself is created, in one checked step, when the buyer launches their workspace.
// Nothing is kept in browser storage any more: a shared computer can never show one person's answers to another.

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

const NEXT_ACTIONS: readonly string[] = ["suppliers", "rfq", "team"];

/**
 * Turns whatever came back from the database into a complete, correctly typed draft. Anything missing or
 * of the wrong type falls back to the default, so a half-filled or older save can never crash the form.
 */
export function restoreBuyerDraft(raw: unknown, step: number): BuyerDraft {
  const r = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const str = (k: string, fallback: string) => (typeof r[k] === "string" ? (r[k] as string) : fallback);
  const list = (k: string) => (Array.isArray(r[k]) ? (r[k] as unknown[]).filter((x): x is string => typeof x === "string") : []);
  const next = r.nextAction;
  return {
    companyName: str("companyName", ""),
    businessType: str("businessType", ""),
    industry: str("industry", ""),
    country: str("country", EMPTY_DRAFT.country),
    state: str("state", ""),
    city: str("city", ""),
    website: str("website", ""),
    companySize: str("companySize", ""),
    categories: list("categories"),
    frequency: str("frequency", ""),
    budget: str("budget", ""),
    budgetCurrency: str("budgetCurrency", EMPTY_DRAFT.budgetCurrency),
    priorities: list("priorities"),
    sourcing: list("sourcing"),
    delivery: str("delivery", ""),
    nextAction: typeof next === "string" && NEXT_ACTIONS.includes(next) ? (next as NextAction) : null,
    step: Math.min(Math.max(Math.trunc(step) || 0, 0), 4),
  };
}

/**
 * Earlier versions kept drafts in this browser. Remove them: they hold personal details, and they were
 * shared by everyone who used the same browser. (The database now holds the answers.)
 */
export function forgetLocalDrafts() {
  try {
    window.localStorage.removeItem("vendora-buyer-draft");
    window.localStorage.removeItem("vendora-supplier-draft");
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
