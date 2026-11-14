import { createFileRoute, redirect } from "@tanstack/react-router";

import { SupplierOnboardingPage } from "@/features/supplier/SupplierOnboardingPage";
import { hasSupplierWorkspace, requireSupplier } from "@/lib/auth";
import { loadOnboardingProgress } from "@/lib/onboarding-api";

export const Route = createFileRoute("/supplier/onboarding")({
  ssr: false,
  beforeLoad: async () => {
    const r = await requireSupplier();
    if (r === "signin") throw redirect({ to: "/supplier/signin" });
    if (r === "buyer") throw redirect({ to: "/buyer/dashboard" });
    // Already launched their business: nothing left to set up.
    if (await hasSupplierWorkspace()) throw redirect({ to: "/supplier/dashboard" });
  },
  // The saved answers come from the database, so a supplier resumes where they left off on any device.
  // Always fresh: an old cached copy could overwrite newer answers on the next Continue.
  loader: () => loadOnboardingProgress("supplier"),
  staleTime: 0,
  gcTime: 0,
  head: () => ({ meta: [{ title: "Set up your supplier business — Vendora" }] }),
  component: SupplierOnboardingRoute,
});

function SupplierOnboardingRoute() {
  const initial = Route.useLoaderData();
  return <SupplierOnboardingPage initial={initial} />;
}
