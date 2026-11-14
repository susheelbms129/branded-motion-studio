import { getSupabase } from "@/lib/supabase";
import type { TrustPassport } from "@/lib/verification-api";

/**
 * The shareable Trust Passport, browser and server side. The database decides everything that matters
 * (supabase/migrations/20261128000017_public_passport.sql): a page is public only after the supplier's OWNER switched it
 * on, it shows only what buyers already see, and it always reads today's passport, so it can never show an old "Verified".
 */

export interface PublicPassport {
  slug: string;
  name: string;
  city: string;
  state: string;
  country: string;
  business_type: string;
  year_established: number | null;
  description: string;
  logo: string | null;
  categories: string[];
  /** The database's today, yyyy-MM-dd: the day this page was true. */
  as_of: string;
  passport: TrustPassport;
}

export interface PassportSharing {
  enabled: boolean;
  slug: string;
  level: number;
  /** Only the owner of the supplier company may switch sharing on or off. */
  can_change: boolean;
}

const ERRORS: Record<string, string> = {
  not_authenticated: "Please sign in again.",
  not_allowed: "Only the owner of your company can change this.",
  not_verified: "Get at least one proof verified first, then you can share your Trust Passport.",
  not_found: "We couldn't find your supplier profile.",
};

const message = (e: unknown) => (e instanceof Error ? e.message : e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : "");

export function passportError(e: unknown): string {
  const m = message(e);
  if (m.includes("Could not find the function")) {
    return "Sharing isn't set up yet. Run migration 17 (20261128000017_public_passport.sql) in Supabase.";
  }
  const k = Object.keys(ERRORS).find((x) => m.includes(x));
  return k ? ERRORS[k]! : "Something went wrong. Please check your connection and try again.";
}

/** The public passport, or null when the page is not shared / does not exist. Throws only when the lookup itself failed. */
export async function getPublicPassport(slug: string): Promise<PublicPassport | null> {
  const { data, error } = await getSupabase().rpc("get_public_passport", { p_slug: slug });
  if (error) {
    if (message(error).includes("not_found")) return null;
    throw new Error(passportError(error));
  }
  const d = data as PublicPassport | null;
  if (!d) return null;
  return { ...d, categories: d.categories ?? [], logo: d.logo ?? null, description: d.description ?? "" };
}

export async function getPassportSharing(orgId: string): Promise<PassportSharing> {
  const { data, error } = await getSupabase().rpc("get_passport_sharing", { p_org: orgId });
  if (error) throw new Error(passportError(error));
  const d = (data ?? {}) as Partial<PassportSharing>;
  return { enabled: d.enabled === true, slug: d.slug ?? "", level: Number(d.level ?? 0), can_change: d.can_change === true };
}

export async function setPassportSharing(orgId: string, enabled: boolean): Promise<void> {
  const { error } = await getSupabase().rpc("set_passport_sharing", { p_org: orgId, p_enabled: enabled });
  if (error) throw new Error(passportError(error));
}

// links the supplier shares
export const passportPath = (slug: string) => `/verified/${slug}`;
export const badgePath = (slug: string) => `/api/public/badge/${slug}`;
export const passportUrl = (origin: string, slug: string) => `${origin}${passportPath(slug)}`;

/** Paste-ready HTML for a website or email signature. */
export function badgeHtml(origin: string, slug: string): string {
  return `<a href="${passportUrl(origin, slug)}" target="_blank" rel="noopener"><img src="${origin}${badgePath(slug)}" alt="Vendora Trust Passport" height="32"></a>`;
}

/** One line for the bottom of a quotation, invoice or email. */
export function quoteFooter(origin: string, slug: string): string {
  return `Verified on Vendora. See what was checked and until when: ${passportUrl(origin, slug)}`;
}

/** A WhatsApp share link with a ready message. */
export function whatsappUrl(origin: string, slug: string, companyName: string): string {
  const text = `${companyName} is verified on Vendora. See what was checked and until when: ${passportUrl(origin, slug)}`;
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
