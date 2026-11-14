import { useSaved } from "@/lib/saved-store";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { useUi } from "@/lib/ui-store";
import type { Role } from "@/types/domain";

export type AccountType = "buyer" | "supplier";

export type AuthResult = { ok: true; needsConfirm: boolean } | { ok: false; message: string };

const NOT_CONFIGURED = "Sign-in isn't available right now. Please try again later.";
const origin = () => (typeof window === "undefined" ? "" : window.location.origin);

// Raw provider errors are never shown to users: they can reveal internals. Map to safe messages.
function friendly(message: string, fallback: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials")) return "Incorrect email or password.";
  if (m.includes("email not confirmed")) return "Please confirm your email first. Check your inbox for the link.";
  if (m.includes("rate limit") || m.includes("too many")) return "Too many attempts. Please wait a few minutes and try again.";
  if (m.includes("password") && (m.includes("weak") || m.includes("short") || m.includes("least")))
    return "That password is too weak. Use 8+ characters with a number and mixed case.";
  return fallback;
}

export async function signUpWithEmail(
  input: { name: string; email: string; password: string; accountType?: AccountType },
  // Only our own code passes this (the invitation page). It must be an in-app path.
  opts?: { redirectPath?: string },
): Promise<AuthResult> {
  if (!isSupabaseConfigured) return { ok: false, message: NOT_CONFIGURED };
  const path = opts?.redirectPath && /^\/(accept-invite\?token=[0-9a-f]{64}|[A-Za-z0-9/_-]*)$/.test(opts.redirectPath) ? opts.redirectPath : "/buyer/dashboard";
  try {
    // `account_type` is only the choice made on the sign-up form. The database reads it ONCE, when the
    // account is created, and stores it on the profile where the browser cannot change it afterwards.
    const { data, error } = await getSupabase().auth.signUp({
      email: input.email,
      password: input.password,
      options: { data: { name: input.name, account_type: input.accountType ?? "buyer" }, emailRedirectTo: `${origin()}${path}` },
    });
    if (error) return { ok: false, message: friendly(error.message, "We couldn't create your account. Please try again.") };
    // With "Confirm email" on, there is no session yet. We say the same thing whether or not the
    // address already exists, so signup can't be used to discover who has an account.
    return { ok: true, needsConfirm: !data.session };
  } catch {
    return { ok: false, message: "Network problem. Check your connection and try again." };
  }
}

/**
 * Only used while the database has not had the account-type upgrade yet (see isMissingColumn).
 * Sign-up metadata is editable by the signed-in user, so it is never trusted once the upgrade is in.
 */
function accountTypeOf(meta: unknown): AccountType {
  return (meta as { account_type?: string } | undefined)?.account_type === "supplier" ? "supplier" : "buyer";
}

type PgError = { code?: string; message?: string } | null;
/** True when the database simply doesn't have the newer column / function yet (the SQL upgrade hasn't been run). */
const isMissingColumn = (e: PgError) =>
  !!e && (e.code === "42703" || e.code === "PGRST200" || e.code === "PGRST204" || /column .* does not exist|could not find .* column/i.test(e.message ?? ""));
const isMissingFunction = (e: PgError) => !!e && (e.code === "PGRST202" || e.code === "42883");

// Remembered per signed-in user so route changes don't re-query. A convenience only: the database decides what a person may do.
let typeCache: { userId: string; type: AccountType } | null = null;

/** The account type stored on the person's profile. The browser cannot edit it. */
async function readAccountType(user: { id: string; user_metadata?: unknown }): Promise<AccountType> {
  if (typeCache?.userId === user.id) return typeCache.type;
  const { data, error } = await getSupabase().from("profiles").select("account_type").eq("user_id", user.id).maybeSingle();
  // Database not upgraded yet: behave exactly as before, without remembering the answer.
  if (error && isMissingColumn(error)) return accountTypeOf(user.user_metadata);
  // Never guess on a failed lookup: a supplier must not be treated as a buyer because of a network blip.
  if (error) throw new Error("We couldn't check your account. Please try again.");
  const type: AccountType = (data as { account_type?: string } | null)?.account_type === "supplier" ? "supplier" : "buyer";
  typeCache = { userId: user.id, type };
  return type;
}

/** Where each kind of account lives. Buyers and suppliers never share a workspace or a sign-in page. */
export const homePathFor = (t: AccountType) => (t === "supplier" ? "/supplier/dashboard" : "/buyer/dashboard");
export const signInPathFor = (t: AccountType) => (t === "supplier" ? "/supplier/signin" : "/buyer/signin");

/**
 * `expected` is the side of the site the person is signing in on. If the account is the other kind,
 * we sign them straight back out and say which sign-in to use, so the two sides stay separate.
 */
export async function signInWithEmail(email: string, password: string, expected?: AccountType): Promise<AuthResult> {
  if (!isSupabaseConfigured) return { ok: false, message: NOT_CONFIGURED };
  try {
    const { data, error } = await getSupabase().auth.signInWithPassword({ email, password });
    if (error) return { ok: false, message: friendly(error.message, "We couldn't sign you in. Please try again.") };
    if (!expected || !data.user) return { ok: true, needsConfirm: false };
    let actual: AccountType;
    try {
      actual = await readAccountType(data.user);
    } catch {
      await getSupabase().auth.signOut();
      clearAuthCache();
      return { ok: false, message: "We couldn't check your account. Please try again." };
    }
    if (actual !== expected) {
      await getSupabase().auth.signOut();
      clearAuthCache();
      return {
        ok: false,
        message:
          actual === "supplier"
            ? "This email is registered as a supplier account. Please use the supplier sign-in."
            : "This email is registered as a buyer account. Please use the buyer sign-in.",
      };
    }
    return { ok: true, needsConfirm: false };
  } catch {
    return { ok: false, message: "Network problem. Check your connection and try again." };
  }
}

const INTENT_KEY = "vendora-signup-intent";

// Google / Apple can't carry our "buyer or supplier" choice, so for a brand-new sign-up we remember it
// here and record it on the account when the person returns (see claimSignupIntent).
function rememberSignupIntent(t: AccountType | null) {
  try {
    if (t) window.sessionStorage.setItem(INTENT_KEY, t);
    else window.sessionStorage.removeItem(INTENT_KEY);
  } catch {
    /* private mode: the account stays a buyer account */
  }
}

async function claimSignupIntent(user: { user_metadata?: unknown }): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const intent = window.sessionStorage.getItem(INTENT_KEY);
    if (!intent) return;
    window.sessionStorage.removeItem(INTENT_KEY);
    if (intent !== "buyer" && intent !== "supplier") return;
    // The database only ever FILLS IN a missing choice: an account that has chosen, started onboarding or
    // joined a company is never converted, whatever this says.
    const { error } = await getSupabase().rpc("claim_account_type", { p_type: intent });
    typeCache = null;
    if (error && isMissingFunction(error) && !(user.user_metadata as { account_type?: string } | undefined)?.account_type) {
      // Database not upgraded yet: old behaviour.
      await getSupabase().auth.updateUser({ data: { account_type: intent } });
    }
  } catch {
    /* fall back to a buyer account */
  }
}

// Redirects the browser to Google / Apple; the session is picked up when the user returns.
export async function signInWithProvider(
  provider: "google" | "apple",
  redirectPath = "/buyer/dashboard",
  signup?: AccountType,
): Promise<AuthResult> {
  if (!isSupabaseConfigured) return { ok: false, message: NOT_CONFIGURED };
  try {
    rememberSignupIntent(signup ?? null);
    const { error } = await getSupabase().auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${origin()}${redirectPath}` },
    });
    if (error) return { ok: false, message: "That sign-in option isn't available yet." };
    return { ok: true, needsConfirm: false };
  } catch {
    return { ok: false, message: "Network problem. Check your connection and try again." };
  }
}

// ───────────────────────── workspace + session guard ─────────────────────────

interface Workspace {
  orgId: string;
  company: string;
  role: Role;
}

// Remembers, per signed-in user, whether they already belong to a workspace, so route changes
// inside /buyer/dashboard don't query the database every time.
let cache: { userId: string; hasOrg: boolean } | null = null;
let supplierCache: { userId: string; has: boolean } | null = null;

export function clearAuthCache() {
  cache = null;
  supplierCache = null;
  typeCache = null;
}

const ACTIVE_ORG_KEY = "vendora-active-org";

function readActiveOrgs(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const v = JSON.parse(window.localStorage.getItem(ACTIVE_ORG_KEY) ?? "{}") as unknown;
    return v && typeof v === "object" ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/**
 * A person can belong to several companies (e.g. an accountant); the app shows one at a time.
 * This only remembers which one to open first. It is a convenience: the database still decides
 * what the person can see, and an id that isn't theirs is simply ignored below.
 */
export function setActiveOrg(userId: string, orgId: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ACTIVE_ORG_KEY, JSON.stringify({ ...readActiveOrgs(), [userId]: orgId }));
  } catch {
    /* private mode: fall back to the earliest company */
  }
}

async function fetchWorkspace(userId: string, kind: AccountType = "buyer"): Promise<Workspace | null> {
  // Row Level Security already limits this to the caller's own active memberships.
  // `kind` keeps the two sides apart: the buyer app only ever opens a buyer company, the supplier area a supplier company.
  const sb = getSupabase();
  let { data, error } = await sb
    .from("memberships")
    .select("role, businesses!inner ( id, name, kind )")
    .eq("user_id", userId)
    .eq("status", "active")
    .eq("businesses.kind", kind)
    .order("joined_at", { ascending: true });
  if (error && isMissingColumn(error)) {
    // Database not upgraded yet: every company is a buyer company, as before.
    if (kind === "supplier") return null;
    ({ data, error } = await sb
      .from("memberships")
      .select("role, businesses ( id, name )")
      .eq("user_id", userId)
      .eq("status", "active")
      .order("joined_at", { ascending: true }));
  }
  if (error || !data || data.length === 0) return null;
  type Org = { id: string; name: string };
  const rows = (data as unknown as { role: Role; businesses: Org | Org[] | null }[])
    .map((r) => ({ role: r.role, org: Array.isArray(r.businesses) ? r.businesses[0] : r.businesses }))
    .filter((r): r is { role: Role; org: Org } => !!r.org);
  if (rows.length === 0) return null;
  const wanted = readActiveOrgs()[userId];
  const pick = rows.find((r) => r.org.id === wanted) ?? rows[0]!;
  return { orgId: pick.org.id, company: pick.org.name, role: pick.role };
}

/** Used by route guards: "signin" = no session, "onboarding" = signed in but no workspace yet. */
export async function requireWorkspace(): Promise<"signin" | "onboarding" | "ok"> {
  if (!isSupabaseConfigured) return "signin";
  const { data } = await getSupabase().auth.getSession();
  const user = data.session?.user;
  if (!user) {
    cache = null;
    return "signin";
  }
  if (!cache || cache.userId !== user.id) {
    const ws = await fetchWorkspace(user.id);
    cache = { userId: user.id, hasOrg: ws !== null };
    const meta = user.user_metadata as { name?: string } | undefined;
    const email = user.email ?? "";
    useUi.getState().signIn({
      name: meta?.name?.trim() || email.split("@")[0] || "You",
      email,
      company: ws?.company ?? "",
    });
    useUi.getState().setWorkspace(ws ? { orgId: ws.orgId, role: ws.role } : null);
    useUi.setState({ onboarded: ws !== null });
  }
  return cache.hasOrg ? "ok" : "onboarding";
}

/** Which kind of account this person chose at sign-up. Anyone without the choice recorded is a buyer. */
export async function signedInAccountType(): Promise<AccountType> {
  if (!isSupabaseConfigured) return "buyer";
  const { data } = await getSupabase().auth.getSession();
  const user = data.session?.user;
  if (!user) return "buyer";
  await claimSignupIntent(user);
  return readAccountType(user);
}

/**
 * True once the signed-in supplier has launched their business (they belong to a supplier company).
 * The answer comes from the database, so a supplier cannot skip onboarding by opening the dashboard.
 */
export async function hasSupplierWorkspace(): Promise<boolean> {
  if (!isSupabaseConfigured) return false;
  const { data } = await getSupabase().auth.getSession();
  const user = data.session?.user;
  if (!user) return false;
  if (!supplierCache || supplierCache.userId !== user.id) {
    supplierCache = { userId: user.id, has: (await fetchWorkspace(user.id, "supplier")) !== null };
  }
  return supplierCache.has;
}

/**
 * Guard for the supplier area. "signin" = no session, "buyer" = signed in but with a buyer account
 * (they belong in /buyer/dashboard, never here), "ok" = a supplier.
 */
export async function requireSupplier(): Promise<"signin" | "buyer" | "ok"> {
  if (!isSupabaseConfigured) return "signin";
  const { data } = await getSupabase().auth.getSession();
  if (!data.session?.user) return "signin";
  return (await signedInAccountType()) === "supplier" ? "ok" : "buyer";
}

function slugify(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${base.length >= 2 ? base : "workspace"}-${suffix}`;
}

/** Creates the company workspace and makes the signed-in user its owner (done in one database call). */
export async function createWorkspace(input: { name: string; industry: string; city: string }): Promise<void> {
  const name = input.name.trim();
  if (name.length < 2) throw new Error("Enter your company name.");
  const { error } = await getSupabase().rpc("create_organization", {
    p_name: name,
    p_slug: slugify(name),
    p_industry: input.industry,
    p_city: input.city,
  });
  if (error) throw new Error("We couldn't create your workspace. Please try again.");
  // Re-read from the database so the UI role/company are exactly what the database says.
  cache = null;
  useUi.setState((s) => ({ onboarded: true, user: s.user ? { ...s.user, company: name } : s.user }));
}

export async function signOutUser(): Promise<void> {
  try {
    if (isSupabaseConfigured) await getSupabase().auth.signOut();
  } finally {
    clearAuthCache();
    useSaved.getState().reset();
    useUi.getState().signOut();
    useUi.setState({ onboarded: false });
  }
}
