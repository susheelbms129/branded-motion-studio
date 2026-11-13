import { createFileRoute, redirect } from "@tanstack/react-router";

import { SupplierOnboardingPage } from "@/features/supplier/SupplierOnboardingPage";
import { requireSession } from "@/lib/auth";

export const Route = createFileRoute("/supplier/onboarding")({
  ssr: false,
  beforeLoad: async () => {
    if (!(await requireSession())) throw redirect({ to: "/signin" });
  },
  head: () => ({ meta: [{ title: "Set up your supplier business — Vendora" }] }),
  component: SupplierOnboardingPage,
});
