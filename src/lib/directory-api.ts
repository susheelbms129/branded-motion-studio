import { getSupabase } from "@/lib/supabase";

/**
 * The supplier directory, browser side. The browser only asks and displays. WHO may browse (signed-in buyers and
 * reviewers), WHAT comes back (public facts only) and whether a proof still counts (expired ones never do) are all
 * enforced by list_suppliers() in supabase/migrations/20261118000007_supplier_directory.sql.
 */

export const PAGE_SIZE = 24;

export interface DirectorySupplier {
  org_id: string;
  name: string;
  city: string;
  state: string;
  categories: string[];
  description: string;
  /** 0 = not verified, 1 = Registered, 2 = Verified, 3 = Verified + Certificates */
  level: 0 | 1 | 2 | 3;
  level_name: string;
  /** The date the earliest-expiring proof stops counting. Null when nothing is verified. */
  valid_through: string | null;
  /** How many proofs currently count. */
  proofs: number;
  /** True when the GST registration was matched against the live government record, not just a document. */
  government_checked: boolean;
}

export interface DirectoryFilters {
  search: string;
  state: string;
  category: string;
  verifiedOnly: boolean;
}

export interface DirectoryPage {
  total: number;
  items: DirectorySupplier[];
  states: string[];
  categories: string[];
}

export const NO_FILTERS: DirectoryFilters = { search: "", state: "", category: "", verifiedOnly: false };

function friendly(err: { message?: string } | null): string {
  const m = err?.message ?? "";
  if (m.includes("not_authenticated")) return "Please sign in again to browse suppliers.";
  if (m.includes("not_allowed")) return "Only buyer accounts can browse the supplier directory.";
  if (m.includes("Could not find the function") || m.includes("list_suppliers")) {
    return "The supplier directory isn't set up yet. Run migration 7 (20261118000007_supplier_directory.sql) in Supabase.";
  }
  return "We couldn't load suppliers. Please check your connection and try again.";
}

export async function listSuppliers(f: DirectoryFilters, offset = 0): Promise<DirectoryPage> {
  const { data, error } = await getSupabase().rpc("list_suppliers", {
    p_search: f.search,
    p_state: f.state,
    p_category: f.category,
    p_verified_only: f.verifiedOnly,
    p_limit: PAGE_SIZE,
    p_offset: offset,
  });
  if (error) throw new Error(friendly(error));
  const d = (data ?? {}) as Partial<DirectoryPage>;
  return {
    total: Number(d.total ?? 0),
    items: d.items ?? [],
    states: d.states ?? [],
    categories: d.categories ?? [],
  };
}

// ───────── one supplier's profile ─────────

export interface ProfileProduct {
  name: string;
  category: string;
  description: string;
  unit: string;
  moq: number | null;
  price: number | null;
  currency: string;
  availability: "Available" | "Made to order" | "Temporarily unavailable";
  /** One small photo (a validated data URL), or null. */
  image: string | null;
}

export interface SupplierCapabilities {
  coverage: string[];
  delivery_time: string;
  min_order_value: number | null;
  currency: string;
  delivery_options: string[];
  pickup: "" | "Yes" | "No";
  /** Answers that depend on the business type. Only a fixed set of keys is ever stored. */
  details: Record<string, string | string[] | undefined>;
}

export interface SupplierProfile {
  org_id: string;
  name: string;
  city: string;
  state: string;
  country: string;
  business_type: string;
  company_size: string;
  year_established: number | null;
  description: string;
  logo: string | null;
  categories: string[];
  products: ProfileProduct[];
  capabilities: SupplierCapabilities | null;
  locations: { country: string; state: string; city: string }[];
  passport: import("@/lib/verification-api").TrustPassport;
}

export const isOrgId = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

/** Thrown when this supplier can't be opened (not found, not launched yet, or not a supplier). */
export class SupplierNotFound extends Error {}

export async function getSupplierProfile(orgId: string): Promise<SupplierProfile> {
  if (!isOrgId(orgId)) throw new SupplierNotFound("This supplier isn't available.");
  const { data, error } = await getSupabase().rpc("get_supplier_profile", { p_org: orgId });
  if (error) {
    if ((error.message ?? "").includes("not_found")) throw new SupplierNotFound("This supplier isn't available.");
    if ((error.message ?? "").includes("Could not find the function")) {
      throw new Error("Supplier profiles aren't set up yet. Run migration 8 (20261119000008_supplier_profile_view.sql) in Supabase.");
    }
    throw new Error(friendly(error));
  }
  return data as SupplierProfile;
}
