import {
  loadPassport,
  loadProofs,
  type ProofRow,
  type TrustPassport,
} from "@/lib/verification-api";
import { getSupabase } from "@/lib/supabase";
import { safeLogo, type StrengthInput, type TrustLevel } from "@/lib/supplier-strength";

/**
 * Everything the supplier dashboard shows, read in one go for the supplier's OWN company. Read-only: nothing here writes.
 * Who may read what is decided by the database (row level security: only members of the company can read these rows),
 * so a made-up company id returns nothing instead of someone else's data.
 */

export interface StorefrontPreview {
  name: string;
  city: string;
  state: string;
  description: string;
  logo: string | null;
  categories: string[];
}

export interface DashboardData {
  preview: StorefrontPreview;
  strength: StrengthInput;
  passport: TrustPassport | null;
  proofs: ProofRow[];
  products: { id: string; name: string; category: string; availability: string; priced: boolean }[];
}

export async function loadSupplierDashboard(
  orgId: string,
  name: string,
  state: string,
): Promise<DashboardData> {
  const sb = getSupabase();
  const [org, prof, prods, caps, locs, proofs, passport] = await Promise.all([
    sb.from("businesses").select("city, state").eq("id", orgId).maybeSingle(),
    sb
      .from("supplier_profiles")
      .select("description, logo, categories, contact_name, email, phone")
      .eq("org_id", orgId)
      .maybeSingle(),
    sb
      .from("supplier_products")
      .select("id, name, category, availability, price")
      .eq("org_id", orgId)
      .order("sort_order")
      .limit(200),
    sb
      .from("supplier_capabilities")
      .select("coverage, delivery_time, min_order_value")
      .eq("org_id", orgId)
      .maybeSingle(),
    sb.from("supplier_locations").select("id", { count: "exact", head: true }).eq("org_id", orgId),
    loadProofs(orgId).catch(() => [] as ProofRow[]),
    loadPassport(orgId).catch(() => null),
  ]);
  if (prof.error && org.error) throw new Error("We couldn't load your dashboard. Please refresh.");

  const p = (prof.data ?? {}) as {
    description?: string;
    logo?: string | null;
    categories?: string[];
    contact_name?: string;
    email?: string;
    phone?: string;
  };
  const c = (caps.data ?? {}) as {
    coverage?: string[];
    delivery_time?: string;
    min_order_value?: number | null;
  };
  const o = (org.data ?? {}) as { city?: string; state?: string };
  const products = (
    (prods.data ?? []) as {
      id: string;
      name: string;
      category: string;
      availability: string;
      price: number | null;
    }[]
  ).map((x) => ({
    id: x.id,
    name: x.name,
    category: x.category,
    availability: x.availability,
    priced: x.price !== null,
  }));

  const strength: StrengthInput = {
    descriptionLength: (p.description ?? "").trim().length,
    hasLogo: safeLogo(p.logo) !== null,
    categoryCount: p.categories?.length ?? 0,
    hasContact: Boolean(
      (p.contact_name ?? "").trim() && ((p.email ?? "").trim() || (p.phone ?? "").trim()),
    ),
    productCount: products.length,
    pricedProductCount: products.filter((x) => x.priced).length,
    hasCoverage: (c.coverage?.length ?? 0) > 0,
    hasDeliveryTime: Boolean((c.delivery_time ?? "").trim()),
    hasMinOrder: c.min_order_value !== null && c.min_order_value !== undefined,
    locationCount: locs.count ?? 0,
    trustLevel: ([0, 1, 2, 3].includes(passport?.level ?? 0)
      ? (passport?.level ?? 0)
      : 0) as TrustLevel,
    proofsNeedingFix: proofs.filter((x) => x.status === "rejected" || x.status === "expired")
      .length,
    proofsInReview: proofs.filter((x) => x.status === "submitted" || x.status === "in_review")
      .length,
  };

  return {
    preview: {
      name,
      city: o.city ?? "",
      state: o.state || state,
      description: (p.description ?? "").trim(),
      logo: safeLogo(p.logo),
      categories: p.categories ?? [],
    },
    strength,
    passport,
    proofs,
    products,
  };
}
