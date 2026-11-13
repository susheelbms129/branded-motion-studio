import { createFileRoute, redirect } from "@tanstack/react-router";

import { BuyerOnboardingPage } from "@/features/buyer/BuyerOnboardingPage";
import { requireWorkspace, signedInAccountType } from "@/lib/auth";

export const Route = createFileRoute("/buyer/onboarding")({
  ssr: false,
  beforeLoad: async () => {
    const r = await requireWorkspace();
    if (r === "signin") throw redirect({ to: "/buyer/signin" });
    // Supplier accounts never use the buyer workspace.
    if ((await signedInAccountType()) === "supplier") throw redirect({ to: "/supplier/dashboard" });
    // Already has a company workspace: nothing left to set up.
    if (r === "ok") throw redirect({ to: "/app" });
  },
  head: () => ({ meta: [{ title: "Set up your procurement workspace — Vendora" }] }),
  component: BuyerOnboardingPage,
});
