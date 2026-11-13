import { createFileRoute, redirect } from "@tanstack/react-router";

import { SupplierOnboardingPage } from "@/features/supplier/SupplierOnboardingPage";
import { requireSupplier } from "@/lib/auth";

export const Route = createFileRoute("/supplier/onboarding")({
  ssr: false,
  beforeLoad: async () => {
    const r = await requireSupplier();
    if (r === "signin") throw redirect({ to: "/supplier/signin" });
    if (r === "buyer") throw redirect({ to: "/app" });
  },
  head: () => ({ meta: [{ title: "Set up your supplier business — Vendora" }] }),
  component: SupplierOnboardingPage,
});
