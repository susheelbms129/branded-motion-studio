import { clearAuthCache } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";
import { useUi } from "@/lib/ui-store";

/**
 * Onboarding, browser side. The browser only asks and displays. What may be saved, what counts as
 * complete, and which company gets created are all decided inside the database (see
 * supabase/migrations/20261114000003_onboarding_profiles.sql):
 *   - answers are saved on every Continue (save_onboarding_progress), so a person can resume anywhere;
 *   - the real company, profile and product rows are created only on Launch, in one all-or-nothing call
 *     that re-checks every answer, so a half-built company or a duplicate can never exist.
 */

export type OnboardingKind = "buyer" | "supplier";

export interface SavedProgress {
  /** Where the person left off. */
  step: number;
  /** The answers so far. Untrusted shape: the pages sanitise it with restoreBuyerDraft / restoreSupplierDraft. */
  data: unknown;
}

type PgError = { code?: string; message?: string } | null;

const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env;

// Raw database errors are never shown to people: they can reveal internals. Map to safe messages.
function friendly(error: PgError, fallback: string): string {
  if (env.DEV && error) console.warn("[onboarding]", error.code, error.message);
  const m = (error?.message ?? "").toLowerCase();
  if (m.includes("too_many_companies")) return "This account has reached its limit of companies. Contact support if you need more.";
  if (m.includes("wrong_account_type")) return "This account can't use this setup. Please sign in with the right account.";
  if (m.includes("already_completed")) return "Your workspace is already set up.";
  if (m.includes("no_progress")) return "We couldn't find your saved answers. Go back one step, press Continue, and try again.";
  if (m.includes("too_large")) return "Your answers and images are too large to save. Remove a few images and try again.";
  if (m.includes("invalid_")) return "Some details are missing or not valid. Please go back and check each step.";
  if (m.includes("not_authenticated") || m.includes("jwt")) return "Your session has ended. Please sign in again.";
  return fallback;
}

/**
 * The saved answers for this person, or null if they have not started. Throws if the lookup FAILS:
 * starting from a blank form on a failed lookup would overwrite their saved answers on the next Continue.
 */
export async function loadOnboardingProgress(kind: OnboardingKind): Promise<SavedProgress | null> {
  const { data, error } = await getSupabase()
    .from("onboarding_progress")
    .select("current_step, status, data")
    .eq("kind", kind) // Row Level Security already limits this to the caller's own row
    .maybeSingle();
  if (error) throw new Error(friendly(error, "We couldn't load your saved progress. Please refresh and try again."));
  const row = data as { current_step: number; status: string; data: unknown } | null;
  if (!row || row.status !== "in_progress") return null;
  return { step: Number.isFinite(row.current_step) ? row.current_step : 0, data: row.data };
}

/** Saves the answers so far. Throws an Error with a message that is safe to show. */
export async function saveOnboardingProgress(kind: OnboardingKind, step: number, data: unknown): Promise<void> {
  const { error } = await getSupabase().rpc("save_onboarding_progress", { p_kind: kind, p_step: step, p_data: data });
  if (error) throw new Error(friendly(error, "We couldn't save your progress. Check your connection and try again."));
}

/**
 * Launch in one go: save the final answers, then create everything from what the database holds.
 * A double click or a second tab after a successful launch is fine: the saved row is already marked complete,
 * and completing again returns the same company instead of creating another.
 */
export async function launchOnboarding(kind: OnboardingKind, step: number, data: unknown, companyName?: string): Promise<void> {
  const { error } = await getSupabase().rpc("save_onboarding_progress", { p_kind: kind, p_step: step, p_data: data });
  if (error && !(error.message ?? "").includes("already_completed")) {
    throw new Error(friendly(error, "We couldn't save your answers. Check your connection and try again."));
  }
  await completeOnboarding(kind, companyName);
}

/** Launch. Creates the company, its owner and the profile together, from the answers already saved. */
export async function completeOnboarding(kind: OnboardingKind, companyName?: string): Promise<void> {
  const { error } = await getSupabase().rpc(kind === "buyer" ? "complete_buyer_onboarding" : "complete_supplier_onboarding");
  if (error) throw new Error(friendly(error, "We couldn't create your workspace. Please try again."));
  // Re-read from the database so the UI role / company are exactly what the database says.
  clearAuthCache();
  const name = companyName?.trim();
  if (name) useUi.setState((s) => ({ onboarded: true, user: s.user ? { ...s.user, company: name } : s.user }));
}

export type VerificationStatus = "not_submitted" | "submitted" | "in_review" | "verified" | "rejected";

export interface SupplierSummary {
  name: string;
  verification: VerificationStatus;
  products: number;
}

const VERIFICATION: readonly string[] = ["not_submitted", "submitted", "in_review", "verified", "rejected"];

/** What the supplier dashboard shows. Returns null if it can't be read; the page then shows safe defaults. */
export async function loadSupplierSummary(): Promise<SupplierSummary | null> {
  const sb = getSupabase();
  const { data: auth } = await sb.auth.getSession();
  const uid = auth.session?.user.id;
  if (!uid) return null;
  const { data: rows, error } = await sb
    .from("memberships")
    .select("businesses!inner ( id, name, kind )")
    .eq("user_id", uid)
    .eq("status", "active")
    .eq("businesses.kind", "supplier")
    .order("joined_at", { ascending: true })
    .limit(1);
  if (error || !rows || rows.length === 0) return null;
  type Org = { id: string; name: string };
  const first = (rows[0] as unknown as { businesses: Org | Org[] | null }).businesses;
  const org = Array.isArray(first) ? first[0] : first;
  if (!org) return null;

  const [ver, prods] = await Promise.all([
    sb.from("supplier_verifications").select("status").eq("org_id", org.id).maybeSingle(),
    sb.from("supplier_products").select("id", { count: "exact", head: true }).eq("org_id", org.id),
  ]);
  const status = (ver.data as { status?: string } | null)?.status ?? "not_submitted";
  return {
    name: org.name,
    verification: (VERIFICATION.includes(status) ? status : "not_submitted") as VerificationStatus,
    products: prods.count ?? 0,
  };
}
