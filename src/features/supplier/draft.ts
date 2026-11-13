// Supplier onboarding answers are kept in this browser only (front-end for now), the same way the buyer
// draft is. They move to the database (organizations / suppliers tables) in a later step.
// `name` and `registrationNo` keep their original names because the supplier dashboard reads them.

export interface Offering {
  id: string;
  name: string;
  category: string;
  description: string;
  /** Small downscaled previews (data URLs). */
  images: string[];
  unit: string;
  moq: string;
  price: string;
  availability: string;
}

export interface ServiceLocation {
  country: string;
  state: string;
  city: string;
}

export interface SupplierDraft {
  // Step 1: business information
  name: string;
  businessType: string;
  industry: string;
  country: string;
  state: string;
  city: string;
  website: string;
  companySize: string;
  yearEstablished: string;
  // Step 2: supplier profile
  description: string;
  logo: string;
  contactName: string;
  designation: string;
  email: string;
  phoneCode: string;
  phone: string;
  altPhone: string;
  // Step 3: products & services
  categories: string[];
  offerings: Offering[];
  // Step 4: supply capabilities
  coverage: string[];
  locations: ServiceLocation[];
  deliveryTime: string;
  minOrderValue: string;
  deliveryOptions: string[];
  pickup: "" | "Yes" | "No";
  //   manufacturer
  inHouse: "" | "Yes" | "No";
  monthlyCapacity: string;
  mfgCapabilities: string[];
  customMfg: "" | "Yes" | "No";
  //   distributor / wholesaler
  multiSource: "" | "Yes" | "No";
  readyStock: "" | "Yes" | "No";
  bulkOrders: "" | "Yes" | "No";
  //   service provider
  servicesOffered: string[];
  serviceCoverage: string;
  largeProjects: "" | "Yes" | "No";
  //   importer / exporter
  tradeCountries: string;
  intlShipping: "" | "Yes" | "No";
  // Kept for the dashboard's "Verify your business" task. Verification is separate from onboarding.
  registrationNo: string;
  // Where the supplier left off.
  step: number;
}

export const BUSINESS_TYPES = ["Manufacturer", "Distributor", "Wholesaler", "Retailer", "Importer", "Exporter", "Trading Company", "Service Provider", "Other"] as const;

export const INDUSTRIES = [
  "Manufacturing",
  "Industrial Equipment",
  "Electrical & Electronics",
  "Automotive",
  "Construction",
  "Chemicals",
  "Packaging",
  "Healthcare",
  "Agriculture",
  "Food & Beverage",
  "Logistics",
  "Other",
] as const;

export const COMPANY_SIZES = ["1–10 employees", "11–50 employees", "51–200 employees", "201–500 employees", "500+ employees"] as const;

export function establishedYears(): string[] {
  const now = new Date().getFullYear();
  return Array.from({ length: now - 1949 }, (_, i) => String(now - i));
}

/** Same master taxonomy as buyers (PURCHASE_CATEGORIES) so buyer needs can be matched to supplier offerings later. */
export const SUPPLY_CATEGORIES = [
  "Raw Materials",
  "Industrial Machinery",
  "Electrical Equipment",
  "Packaging Materials",
  "Chemicals",
  "Construction Materials",
  "Electronics",
  "Office Supplies",
  "Logistics & Transport",
  "Professional Services",
  "Agriculture",
  "Food & Beverage",
  "Healthcare",
  "Other",
] as const;

/** Categories whose offerings are services, so they use service units and don't need a unit. */
export const SERVICE_CATEGORIES: readonly string[] = ["Professional Services", "Logistics & Transport"];

export const PRODUCT_UNITS = ["Pieces", "Kilograms", "Tonnes", "Litres", "Metres", "Boxes", "Sets", "Units", "Other"] as const;
export const SERVICE_UNITS = ["Hours", "Days", "Projects", "Other"] as const;

export const AVAILABILITY = ["Available", "Made to order", "Temporarily unavailable"] as const;

export const COVERAGE_OPTIONS = ["Within my city", "Within my state", "Across India", "Internationally"] as const;
export const DELIVERY_TIMES = ["1–3 days", "4–7 days", "1–2 weeks", "2–4 weeks", "More than 4 weeks", "Depends on order"] as const;
export const DELIVERY_OPTIONS = ["Supplier-arranged delivery", "Third-party logistics", "Buyer-arranged pickup", "Depends on location"] as const;

export const MFG_CAPABILITIES = ["CNC machining", "Injection moulding", "Casting & forging", "Fabrication & welding", "Assembly", "Packaging & finishing", "Other"] as const;
export const SERVICE_TYPES = ["Installation", "Maintenance & repair", "Consulting", "Testing & inspection", "Training", "Transport & logistics", "Other"] as const;
export const SERVICE_COVERAGE = ["Local", "Within my state", "Across India", "International"] as const;

export const PHONE_CODES = ["+91", "+1", "+44", "+971", "+65", "+61", "+49", "+880", "+977", "+94"] as const;

export type CapabilityGroup = "manufacturer" | "distributor" | "service" | "trade" | null;

/** Which "business capabilities" questions apply. Retailers and "Other" have none. */
export function capabilityGroup(businessType: string): CapabilityGroup {
  if (businessType === "Manufacturer") return "manufacturer";
  if (businessType === "Distributor" || businessType === "Wholesaler" || businessType === "Trading Company") return "distributor";
  if (businessType === "Service Provider") return "service";
  if (businessType === "Importer" || businessType === "Exporter") return "trade";
  return null;
}

export function newOffering(): Offering {
  return { id: Math.random().toString(36).slice(2, 10), name: "", category: "", description: "", images: [], unit: "", moq: "", price: "", availability: "" };
}

export const EMPTY_DRAFT: SupplierDraft = {
  name: "",
  businessType: "",
  industry: "",
  country: "India",
  state: "",
  city: "",
  website: "",
  companySize: "",
  yearEstablished: "",
  description: "",
  logo: "",
  contactName: "",
  designation: "",
  email: "",
  phoneCode: "+91",
  phone: "",
  altPhone: "",
  categories: [],
  offerings: [],
  coverage: [],
  locations: [],
  deliveryTime: "",
  minOrderValue: "",
  deliveryOptions: [],
  pickup: "",
  inHouse: "",
  monthlyCapacity: "",
  mfgCapabilities: [],
  customMfg: "",
  multiSource: "",
  readyStock: "",
  bulkOrders: "",
  servicesOffered: [],
  serviceCoverage: "",
  largeProjects: "",
  tradeCountries: "",
  intlShipping: "",
  registrationNo: "",
  step: 0,
};

const KEY = "vendora-supplier-draft";

export function loadDraft(): SupplierDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const v = JSON.parse(window.localStorage.getItem(KEY) ?? "null") as Partial<SupplierDraft> | null;
    if (!v || typeof v.name !== "string") return null;
    // Merge over the defaults so a draft saved by an older version can't leave a field undefined.
    return { ...EMPTY_DRAFT, ...v, step: Math.min(Math.max(Number(v.step) || 0, 0), 5) };
  } catch {
    return null;
  }
}

export function saveDraft(d: SupplierDraft) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    /* private mode or full storage: the answers just won't be remembered if the page is closed */
  }
}

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

export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** Reads an image and shrinks it so it can be previewed and kept in the draft without filling browser storage. */
export function imageToDataUrl(file: File, maxPx: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(img.width * scale));
      c.height = Math.max(1, Math.round(img.height * scale));
      c.getContext("2d")?.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL(file.type === "image/png" ? "image/png" : "image/jpeg", 0.82));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Couldn't read that image"));
    };
    img.src = url;
  });
}
