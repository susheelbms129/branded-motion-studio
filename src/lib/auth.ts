import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { useUi } from "@/lib/ui-store";
import type { Role } from "@/types/domain";

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
    return "That password is too weak. Use 12+ characters with a number and mixed case.";
  return fallback;
}

export async function signUpWithEmail(input: { name: string; email: string; password: string }): Promise<AuthResult> {
  if (!isSupabaseConfigured) return { ok: false, message: NOT_CONFIGURED };
  try {
    const { data, error } = await getSupabase().auth.signUp({
      email: input.email,
      password: input.password,
      options: { data: { name: input.name }, emailRedirectTo: `${origin()}/app` },
    });
    if (error) return { ok: false, message: friendly(error.message, "We couldn't create your account. Please try again.") };
    // With "Confirm email" on, there is no session yet. We say the same thing whether or not the
    // address already exists, so signup can't be used to discover who has an account.
    return { ok: true, needsConfirm: !data.session };
  } catch {
    return { ok: false, message: "Network problem. Check your connection and try again." };
  }
}

export async function signInWithEmail(email: string, password: string): Promise<AuthResult> {
  if (!isSupabaseConfigured) return { ok: false, message: NOT_CONFIGURED };
  try {
    const { error } = await getSupabase().auth.signInWithPassword({ email, password });
    if (error) return { ok: false, message: friendly(error.message, "We couldn't sign you in. Please try again.") };
    return { ok: true, needsConfirm: false };
  } catch {
    return { ok: false, message: "Network problem. Check your connection and try again." };
  }
}

// Redirects the browser to Google / Apple; the session is picked up when the user returns to /app.
export async function signInWithProvider(provider: "google" | "apple"): Promise<AuthResult> {
  if (!isSupabaseConfigured) return { ok: false, message: NOT_CONFIGURED };
  try {
    const { error } = await getSupabase().auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${origin()}/app` },
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
// inside /app don't query the database every time.
let cache: { userId: string; hasOrg: boolean } | null = null;

export function clearAuthCache() {
  cache = null;
}

async function fetchWorkspace(userId: string): Promise<Workspace | null> {
  const { data, error } = await getSupabase()
    .from("memberships")
    .select("role, organizations ( id, name )")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("joined_at", { ascending: true })
    .limit(1);
  if (error || !data || data.length === 0) return null;
  const row = data[0] as unknown as { role: Role; organizations: { id: string; name: string } | { id: string; name: string }[] | null };
  const org = Array.isArray(row.organizations) ? row.organizations[0] : row.organizations;
  if (!org) return null;
  return { orgId: org.id, company: org.name, role: row.role };
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
    useUi.setState(ws ? { onboarded: true, role: ws.role } : { onboarded: false });
  }
  return cache.hasOrg ? "ok" : "onboarding";
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
  if (cache) cache.hasOrg = true;
  useUi.setState((s) => ({ onboarded: true, role: "owner", user: s.user ? { ...s.user, company: name } : s.user }));
}

export async function signOutUser(): Promise<void> {
  try {
    if (isSupabaseConfigured) await getSupabase().auth.signOut();
  } finally {
    cache = null;
    useUi.getState().signOut();
    useUi.setState({ onboarded: false });
  }
}
