/**
 * Who may open which part of the site. Pure rules with no browser and no database, so a test can prove every
 * combination of (area x kind of person) and so the route guards cannot drift apart from each other.
 *
 * Buyers and suppliers are two separate products on one site:
 *   - a buyer never reaches /supplier/...  and is sent to their own dashboard
 *   - a supplier never reaches /buyer/...  and is sent to their own dashboard
 *   - nobody reaches a workspace before signing in, or before finishing setup
 * The database enforces the same split (row level security and checked functions). This file decides what is DISPLAYED.
 */

export type AccountType = "buyer" | "supplier";
export type Area = "buyer-app" | "buyer-onboarding" | "supplier-page" | "supplier-onboarding";

export interface Who {
  signedIn: boolean;
  type: AccountType;
  hasBuyerWorkspace: boolean;
  hasSupplierWorkspace: boolean;
}

export type Access = { ok: true } | { ok: false; redirect: string };

export const PATHS = {
  buyerSignIn: "/buyer/signin",
  buyerOnboarding: "/buyer/onboarding",
  buyerHome: "/buyer/dashboard",
  supplierSignIn: "/supplier/signin",
  supplierOnboarding: "/supplier/onboarding",
  supplierHome: "/supplier/dashboard",
} as const;

const go = (redirect: string): Access => ({ ok: false, redirect });

export function decideAccess(area: Area, w: Who): Access {
  switch (area) {
    case "buyer-app":
      if (!w.signedIn) return go(PATHS.buyerSignIn);
      if (w.type === "supplier") return go(PATHS.supplierHome);
      if (!w.hasBuyerWorkspace) return go(PATHS.buyerOnboarding);
      return { ok: true };
    case "buyer-onboarding":
      if (!w.signedIn) return go(PATHS.buyerSignIn);
      if (w.type === "supplier") return go(PATHS.supplierHome);
      if (w.hasBuyerWorkspace) return go(PATHS.buyerHome);
      return { ok: true };
    case "supplier-page":
      if (!w.signedIn) return go(PATHS.supplierSignIn);
      if (w.type === "buyer") return go(PATHS.buyerHome);
      if (!w.hasSupplierWorkspace) return go(PATHS.supplierOnboarding);
      return { ok: true };
    case "supplier-onboarding":
      if (!w.signedIn) return go(PATHS.supplierSignIn);
      if (w.type === "buyer") return go(PATHS.buyerHome);
      if (w.hasSupplierWorkspace) return go(PATHS.supplierHome);
      return { ok: true };
  }
}

/**
 * Where to send someone who signs out (here or in another tab) while a private page is open, so private data never
 * stays on screen. Returns null on public pages. Every page under a private area counts, including pages added later.
 */
export function signedOutDestination(pathname: string): string | null {
  const p = pathname.replace(/\/+$/, "") || "/";
  const under = (base: string) => p === base || p.startsWith(`${base}/`);
  if (under("/buyer/dashboard") || under("/buyer/onboarding") || under("/app"))
    return PATHS.buyerSignIn;
  if (under("/supplier") && !under("/supplier/signin") && !under("/supplier/signup"))
    return PATHS.supplierSignIn;
  return null;
}
