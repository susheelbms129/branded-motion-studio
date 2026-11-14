import { redirect } from "@tanstack/react-router";

import {
  hasSupplierWorkspace,
  requireSupplier,
  requireWorkspace,
  signedInAccountType,
} from "@/lib/auth";
import { decideAccess, type Access, type Area } from "@/lib/route-access";

/**
 * The ONLY guards for private pages. Every private route uses one of these four by name (a test checks that, and that
 * every route is either public or guarded), so a new page cannot go live unguarded by accident.
 *
 * Each guard reads the facts from the database (never from anything stored in the browser) and hands them to
 * decideAccess(). If a lookup fails, the error is thrown and the page does not open: the guards never guess.
 */

function enforce(a: Access): void {
  // `as never`: the target is one of our own fixed paths (see PATHS), chosen by decideAccess().
  if (!a.ok) throw redirect({ to: a.redirect as never });
}

async function buyerFacts(area: Extract<Area, "buyer-app" | "buyer-onboarding">): Promise<void> {
  const r = await requireWorkspace();
  const signedIn = r !== "signin";
  const type = signedIn ? await signedInAccountType() : "buyer";
  enforce(
    decideAccess(area, {
      signedIn,
      type,
      hasBuyerWorkspace: r === "ok",
      hasSupplierWorkspace: false,
    }),
  );
}

async function supplierFacts(
  area: Extract<Area, "supplier-page" | "supplier-onboarding">,
): Promise<void> {
  const r = await requireSupplier();
  const has = r === "ok" ? await hasSupplierWorkspace() : false;
  enforce(
    decideAccess(area, {
      signedIn: r !== "signin",
      type: r === "buyer" ? "buyer" : "supplier",
      hasBuyerWorkspace: false,
      hasSupplierWorkspace: has,
    }),
  );
}

/** The buyer workspace (/buyer/dashboard/... and the older /app/...). */
export const buyerAppGuard = () => buyerFacts("buyer-app");
export const buyerOnboardingGuard = () => buyerFacts("buyer-onboarding");
/** Every supplier page after setup: dashboard, products, Trust Passport and whatever comes next. */
export const supplierPageGuard = () => supplierFacts("supplier-page");
export const supplierOnboardingGuard = () => supplierFacts("supplier-onboarding");
