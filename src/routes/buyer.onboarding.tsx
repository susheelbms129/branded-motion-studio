import { createFileRoute, redirect } from "@tanstack/react-router";

import { BuyerOnboardingPage } from "@/features/buyer/BuyerOnboardingPage";
import { requireWorkspace, signedInAccountType } from "@/lib/auth";
import { loadOnboardingProgress } from "@/lib/onboarding-api";

export const Route = createFileRoute("/buyer/onboarding")({
  ssr: false,
  beforeLoad: async () => {
    const r = await requireWorkspace();
    if (r === "signin") throw redirect({ to: "/buyer/signin" });
    // Supplier accounts never use the buyer workspace.
    if ((await signedInAccountType()) === "supplier") throw redirect({ to: "/supplier/dashboard" });
    // Already has a company workspace: nothing left to set up.
    if (r === "ok") throw redirect({ to: "/buyer/dashboard" });
  },
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
