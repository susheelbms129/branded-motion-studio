// TEMPORARY: supplier onboarding answers are kept in this browser only. They move to the database
// (organizations / suppliers tables) in the next step, when the migrations are updated.
export interface SupplierDraft {
  name: string;
  businessType: string;
  industry: string;
  country: string;
  city: string;
  address: string;
  phone: string;
  categories: string[];
  registrationNo: string;
}

const KEY = "vendora-supplier-draft";

export const BUSINESS_TYPES = ["Manufacturer", "Distributor", "Wholesaler", "Trader", "Service provider"];
export const SUPPLY_CATEGORIES = [
  "Raw Materials",
  "Electrical",
  "Packaging",
  "IT & Electronics",
  "Office Supplies",
  "MRO & Tools",
  "Safety & PPE",
  "Logistics",
];

export function loadDraft(): SupplierDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const v = JSON.parse(window.localStorage.getItem(KEY) ?? "null") as SupplierDraft | null;
    return v && typeof v.name === "string" ? v : null;
  } catch {
    return null;
  }
}

export function saveDraft(d: SupplierDraft) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    /* private mode: the dashboard just shows the default name */
  }
}
