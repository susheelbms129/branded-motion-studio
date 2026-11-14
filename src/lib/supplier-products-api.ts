import { getSupabase } from "@/lib/supabase";
import type { ProductDraft } from "@/lib/product-quality";

/**
 * The supplier's own catalogue, browser side. The browser only asks and displays. WHO may change products (owner or
 * procurement manager of a supplier company), what is allowed in each field and the 200-product limit are all enforced
 * by the functions in supabase/migrations/20261121000010_supplier_products.sql.
 */

export interface MyProduct {
  id: string;
  name: string;
  category: string;
  description: string;
  unit: string;
  moq: number | null;
  price: number | null;
  currency: string;
  availability: "Available" | "Made to order" | "Temporarily unavailable";
}

export interface Catalog {
  items: MyProduct[];
  currency: string;
  /** False when the signed-in person may look but not change (the database decides; this only hides the buttons). */
  canEdit: boolean;
}

function friendly(err: { message?: string } | null): string {
  const m = err?.message ?? "";
  const known: Record<string, string> = {
    not_authenticated: "Please sign in again.",
    not_allowed: "Only the owner or a procurement manager can change products.",
    not_found: "This product isn't available any more. Please refresh.",
    duplicate_name: "You already have a product with this name. Use a more specific name.",
    too_many_products: "You've reached the limit of 200 products. Remove one to add another.",
    invalid_name: "Enter the product name (at least 2 letters).",
    invalid_category: "Pick a category.",
    invalid_availability: "Pick the availability.",
    invalid_price: "Enter a valid price.",
    invalid_moq: "Enter a valid minimum order.",
  };
  const key = Object.keys(known).find((k) => m.includes(k));
  if (key) return known[key]!;
  if (m.includes("Could not find the function") && m.includes("supplier_product")) {
    return "Products aren't set up yet. Run migration 10 (20261121000010_supplier_products.sql) in Supabase.";
  }
  return "We couldn't save that. Please check your connection and try again.";
}

export async function loadCatalog(orgId: string): Promise<Catalog> {
  const sb = getSupabase();
  const [rows, org, who] = await Promise.all([
    sb
      .from("supplier_products")
      .select("id, name, category, description, unit, moq, price, currency, availability")
      .eq("org_id", orgId)
      .order("sort_order")
      .order("name")
      .limit(200),
    sb.from("businesses").select("currency").eq("id", orgId).maybeSingle(),
    sb.auth.getSession(),
  ]);
  if (rows.error) throw new Error("We couldn't load your products. Please refresh.");
  const uid = who.data.session?.user.id;
  let canEdit = false;
  if (uid) {
    const m = await sb
      .from("memberships")
      .select("role")
      .eq("org_id", orgId)
      .eq("user_id", uid)
      .eq("status", "active")
      .maybeSingle();
    const role = (m.data as { role?: string } | null)?.role;
    canEdit = role === "owner" || role === "procurement_manager";
  }
  return {
    items: (rows.data ?? []) as MyProduct[],
    currency: (org.data as { currency?: string } | null)?.currency ?? "INR",
    canEdit,
  };
}

export async function saveProduct(orgId: string, p: ProductDraft, id?: string): Promise<void> {
  const body: Record<string, string> = {
    name: p.name.trim(),
    category: p.category,
    description: p.description.trim(),
    unit: p.unit.trim(),
    moq: p.moq.trim(),
    price: p.price.trim(),
    availability: p.availability,
  };
  if (id) body["id"] = id;
  const { error } = await getSupabase().rpc("save_supplier_product", {
    p_org: orgId,
    p_product: body,
  });
  if (error) throw new Error(friendly(error));
}

export async function deleteProduct(orgId: string, id: string): Promise<void> {
  const { error } = await getSupabase().rpc("delete_supplier_product", { p_org: orgId, p_id: id });
  if (error) throw new Error(friendly(error));
}

export function toDraft(p: MyProduct): ProductDraft {
  return {
    name: p.name,
    category: p.category,
    description: p.description,
    unit: p.unit,
    moq: p.moq === null ? "" : String(p.moq),
    price: p.price === null ? "" : String(p.price),
    availability: p.availability,
  };
}
