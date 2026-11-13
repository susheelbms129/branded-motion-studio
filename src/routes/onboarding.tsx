import { createFileRoute, redirect } from "@tanstack/react-router";

import { OnboardingPage } from "@/features/auth/AuthPages";
import { requireWorkspace, signedInAccountType } from "@/lib/auth";

export const Route = createFileRoute("/onboarding")({
  ssr: false,
  beforeLoad: async () => {
    const r = await requireWorkspace();
    if (r === "signin") throw redirect({ to: "/signin" });
    // Supplier accounts never use the buyer workspace.
    if ((await signedInAccountType()) === "supplier") throw redirect({ to: "/supplier/dashboard" });
    if (r === "ok") throw redirect({ to: "/app" });
  },
  head: () => ({ meta: [{ title: "Onboarding — Vendora" }] }),
  component: OnboardingPage,
});
