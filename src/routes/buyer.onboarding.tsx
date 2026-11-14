import { createFileRoute } from "@tanstack/react-router";

import { BuyerOnboardingPage } from "@/features/buyer/BuyerOnboardingPage";
import { loadOnboardingProgress } from "@/lib/onboarding-api";
import { buyerOnboardingGuard } from "@/lib/route-guards";

export const Route = createFileRoute("/buyer/onboarding")({
  ssr: false,
  beforeLoad: buyerOnboardingGuard,
  // The saved answers come from the database, so a buyer resumes where they left off on any device.
  // Always fresh: an old cached copy could overwrite newer answers on the next Continue.
  loader: () => loadOnboardingProgress("buyer"),
  staleTime: 0,
  gcTime: 0,
  head: () => ({ meta: [{ title: "Set up your procurement workspace — Vendora" }] }),
  component: BuyerOnboardingRoute,
});

function BuyerOnboardingRoute() {
  const initial = Route.useLoaderData();
  return <BuyerOnboardingPage initial={initial} />;
}
