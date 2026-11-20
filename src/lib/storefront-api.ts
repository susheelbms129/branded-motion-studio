import { getSupabase } from "@/lib/supabase";
import type { Scorecard } from "@/lib/scorecard-api";
import type { TrustPassport } from "@/lib/verification-api";

/**
 * The company profile and the public storefront, browser and server side. The database decides everything that matters
 * (supabase/migrations/20261204000023_storefront.sql): a storefront is public only after the supplier's OWNER switched it on,
 * only while the company is verified TODAY, and it carries only what buyers already see (never a phone, email or bank detail).
 */

export interface StorefrontProduct {
  id: string;
  name: string;
  category: string;
  description: string;
  unit: string;
  moq: number | null;
  /** null when the owner keeps prices hidden. */
  price: number | null;
  currency: string;
  availability: string;
  has_photo: boolean;
}

export interface Delivery {
  coverage: string[];
  delivery_time: string;
  min_order_value: number | null;
  currency: string;
  delivery_options: string[];
  pickup: string;
}

export interface Place {
  country: string;
  state: string;
  city: string;
}

export interface PublicStorefront {
  slug: string;
  name: string;
  city: string;
  state: string;
  country: string;
  business_type: string;
  year_established: number | null;
  tagline: string;
  description: string;
  has_logo: boolean;
  categories: string[];
  show_prices: boolean;
  products: StorefrontProduct[];
  product_count: number;
  delivery: Delivery | null;
  service_areas: Place[];
  /** The database's today, yyyy-MM-dd: the day this page was true. */
  as_of: string;
  updated_at: string;
  passport: TrustPassport;
  scorecard?: Scorecard;
}

export interface SeriesDay {
  day: string;
  views: number;
  quote_clicks: number;
}

export interface CompanyProfile {
  name: string;
  slug: string;
  city: string;
  state: string;
  country: string;
  business_type: string;
  year_established: number | null;
  role: string;
  can_edit: boolean;
  can_publish: boolean;
  profile: {
    tagline: string;
    description: string;
    logo: string | null;
    categories: string[];
    contact_name: string;
    designation: string;
    email: string;
    phone_code: string;
    phone: string;
    alt_phone: string;
  };
  capabilities: {
    coverage: string[];
    delivery_time: string;
    min_order_value: number | null;
    currency: string;
    delivery_options: string[];
    pickup: string;
  } | null;
  locations: Place[];
  storefront: {
    enabled: boolean;
    show_prices: boolean;
    published_at: string | null;
    level: number;
    ready: { required_ok: boolean; missing: ("verified" | "about" | "categories")[] };
    live: boolean;
    views_30: number;
    quote_clicks_30: number;
    series: SeriesDay[] | null;
  };
}

/** What the profile form sends. Every key is optional: a key that is not sent is left as it is. */
export interface ProfileInput {
  tagline?: string;
  description?: string;
  categories?: string[];
  logo?: string | null;
  contactName?: string;
  designation?: string;
  email?: string;
  phoneCode?: string;
  phone?: string;
  altPhone?: string;
  coverage?: string[];
  deliveryTime?: string;
  minOrderValue?: number | null;
  deliveryOptions?: string[];
  pickup?: string;
  locations?: Place[];
}

const ERRORS: Record<string, string> = {
  not_authenticated: "Please sign in again.",
  not_allowed: "Only the company owner or a procurement manager can change this. Publishing is for the owner only.",
  not_ready: "Your storefront isn't ready yet. Finish the checklist first.",
  not_found: "We couldn't find your supplier profile.",
  invalid_description: "Write at least 50 characters about your company.",
  invalid_categories: "Pick at least one category.",
  invalid_logo: "That logo can't be used. Use a JPG, PNG or WebP image.",
  invalid_contactName: "Add a contact name (at least 2 letters).",
  invalid_email: "That email address isn't valid.",
  invalid_phoneCode: "Pick a valid country code.",
  invalid_phone: "That phone number looks too short.",
  invalid_coverage: "Pick where you deliver.",
  invalid_minOrderValue: "The minimum order must be a number, zero or more.",
  invalid_locations: "Each delivery area needs at least a country.",
  invalid_tagline: "The headline can be at most 120 characters.",
};

const message = (e: unknown) =>
  e instanceof Error ? e.message : e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : "";

export function storefrontError(e: unknown): string {
  const m = message(e);
  if (m.includes("Could not find the function")) {
    return "The storefront isn't set up yet. Run migration 23 (20261204000023_storefront.sql) in Supabase.";
  }
  const k = Object.keys(ERRORS).find((x) => m.includes(x));
  return k ? ERRORS[k]! : "Something went wrong. Please check your connection and try again.";
}

export async function getCompanyProfile(orgId: string): Promise<CompanyProfile> {
  const { data, error } = await getSupabase().rpc("get_company_profile", { p_org: orgId });
  if (error) throw new Error(storefrontError(error));
  const d = data as CompanyProfile;
  return {
    ...d,
    profile: { ...d.profile, categories: d.profile.categories ?? [] },
    locations: d.locations ?? [],
    storefront: { ...d.storefront, series: d.storefront.series ?? [] },
  };
}

export async function saveCompanyProfile(orgId: string, input: ProfileInput): Promise<void> {
  const { error } = await getSupabase().rpc("save_company_profile", { p_org: orgId, p_data: input });
  if (error) throw new Error(storefrontError(error));
}

export async function setStorefront(orgId: string, enabled: boolean, showPrices: boolean | null): Promise<void> {
  const { error } = await getSupabase().rpc("set_storefront", { p_org: orgId, p_enabled: enabled, p_show_prices: showPrices });
  if (error) throw new Error(storefrontError(error));
}

/** The public storefront, or null when it is not published / not verified today / does not exist. Throws only when the lookup itself failed. */
export async function getPublicStorefront(slug: string): Promise<PublicStorefront | null> {
  const { data, error } = await getSupabase().rpc("get_public_storefront", { p_slug: slug });
  if (error) {
    if (message(error).includes("not_found")) return null;
    throw new Error(storefrontError(error));
  }
  const d = data as PublicStorefront | null;
  if (!d) return null;
  return { ...d, categories: d.categories ?? [], products: d.products ?? [], service_areas: d.service_areas ?? [], description: d.description ?? "", tagline: d.tagline ?? "" };
}

/** Anonymous counter. Never throws and never blocks the page: a lost count is better than a broken storefront. */
export async function recordStorefrontEvent(slug: string, kind: "view" | "quote_click"): Promise<void> {
  try {
    await getSupabase().rpc("record_storefront_event", { p_slug: slug, p_kind: kind });
  } catch {
    /* ignore */
  }
}

/** For a signed-in buyer: the company id behind a storefront, so "Request a quote" opens the directory profile. */
export async function storefrontOrgForBuyer(slug: string): Promise<string> {
  const { data, error } = await getSupabase().rpc("storefront_org_for_buyer", { p_slug: slug });
  if (error) throw new Error(message(error));
  return String(data);
}

/** One public storefront row for the sitemap. */
export interface SitemapEntry {
  slug: string;
  updated_at: string;
}

export async function listPublicStorefronts(limit: number, offset: number): Promise<SitemapEntry[]> {
  const { data, error } = await getSupabase().rpc("list_public_storefronts", { p_limit: limit, p_offset: offset });
  if (error) throw new Error(storefrontError(error));
  return (Array.isArray(data) ? data : []) as SitemapEntry[];
}

/** The photo behind a storefront address, as raw bytes, or null. Server side only (used by the image route). */
export async function getPublicStorefrontImage(slug: string, kind: "logo" | "product", id: string | null): Promise<string | null> {
  const { data, error } = await getSupabase().rpc("get_public_storefront_image", { p_slug: slug, p_kind: kind, p_id: id });
  if (error) {
    if (message(error).includes("not_found")) return null;
    throw new Error(storefrontError(error));
  }
  return typeof data === "string" ? data : null;
}

// ───────── links ─────────
export const storefrontPath = (slug: string) => `/s/${slug}`;
export const storefrontUrl = (origin: string, slug: string) => `${origin}${storefrontPath(slug)}`;
export const logoPath = (slug: string) => `/api/public/storefront-image/${slug}/logo`;
export const productPhotoPath = (slug: string, id: string) => `/api/public/storefront-image/${slug}/${id}`;

export function storefrontWhatsappUrl(origin: string, slug: string, companyName: string): string {
  const text = `${companyName} on Vendora: products, delivery terms and a live Trust Passport. ${storefrontUrl(origin, slug)}`;
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string) => UUID.test(s);

/** Splits `data:image/png;base64,....` into its type and bytes. Returns null for anything that is not a plain jpeg/png/webp. */
export function parseImage(dataUrl: string): { type: string; bytes: Uint8Array } | null {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+=*)$/.exec(dataUrl);
  if (!m) return null;
  try {
    const bin = atob(m[2]!);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { type: m[1]!, bytes };
  } catch {
    return null;
  }
}

// ───────── what Google reads ─────────
const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);

/** The page's description for Google and WhatsApp: the headline when there is one, else the start of the "about", plus the proof. */
export function storefrontDescription(d: PublicStorefront): string {
  const place = [d.city, d.state].filter(Boolean).join(", ");
  const lead = d.tagline || d.description;
  const proof = d.passport.level > 0 ? ` ${d.passport.level_name} on Vendora.` : "";
  return clip(`${d.name}${place ? ` in ${place}` : ""}: ${lead}${proof}`.replace(/\s+/g, " "), 300);
}

/** Structured data for Google (schema.org Organization with its offered products). Contains only what the page itself shows. */
export function storefrontJsonLd(d: PublicStorefront, origin: string): Record<string, unknown> {
  const url = storefrontUrl(origin, d.slug);
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${url}#org`,
    name: d.name,
    url,
    description: clip(d.description.replace(/\s+/g, " "), 500),
    ...(d.has_logo ? { logo: `${origin}${logoPath(d.slug)}` } : {}),
    ...(d.year_established ? { foundingDate: String(d.year_established) } : {}),
    address: { "@type": "PostalAddress", addressLocality: d.city, addressRegion: d.state, addressCountry: d.country },
    ...(d.service_areas.length > 0 ? { areaServed: d.service_areas.slice(0, 10).map((a) => [a.city, a.state, a.country].filter(Boolean).join(", ")) } : {}),
    makesOffer: d.products.slice(0, 10).map((p) => ({
      "@type": "Offer",
      itemOffered: { "@type": "Product", name: p.name, ...(p.description ? { description: clip(p.description, 200) } : {}), category: p.category },
      ...(p.price !== null ? { price: p.price, priceCurrency: p.currency } : {}),
    })),
  };
}

/** JSON for a <script type="application/ld+json">: "<" is escaped so no text can close the tag early. */
export const jsonLdText = (o: unknown) => JSON.stringify(o).replace(/</g, "\\u003c");

// ───────── the sitemap ─────────
const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

export function sitemapXml(origin: string, entries: SitemapEntry[]): string {
  const rows = entries
    .filter((e) => /^[a-z0-9-]{2,60}$/.test(e.slug))
    .map((e) => {
      const t = new Date(e.updated_at);
      const last = Number.isNaN(t.getTime()) ? "" : `<lastmod>${t.toISOString()}</lastmod>`;
      return `<url><loc>${xml(storefrontUrl(origin, e.slug))}</loc>${last}</url>`;
    });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n<url><loc>${xml(origin)}/</loc></url>\n${rows.join("\n")}\n</urlset>\n`;
}
