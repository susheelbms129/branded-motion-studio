import { createFileRoute } from "@tanstack/react-router";

import { SupplierOnboardingPage } from "@/features/supplier/SupplierOnboardingPage";
import { loadOnboardingProgress } from "@/lib/onboarding-api";
import { supplierOnboardingGuard } from "@/lib/route-guards";

export const Route = createFileRoute("/supplier/onboarding")({
  ssr: false,
  beforeLoad: supplierOnboardingGuard,
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
