import { createFileRoute, redirect } from "@tanstack/react-router";

import { SupplierVerificationPage } from "@/features/supplier/SupplierVerificationPage";
import { hasSupplierWorkspace, requireSupplier } from "@/lib/auth";

export const Route = createFileRoute("/supplier/verification")({
  ssr: false,
  beforeLoad: async () => {
    const r = await requireSupplier();
    if (r === "signin") throw redirect({ to: "/supplier/signin" });
    if (r === "buyer") throw redirect({ to: "/buyer/dashboard" });
    if (!(await hasSupplierWorkspace())) throw redirect({ to: "/supplier/onboarding" });
  },
  head: () => ({ meta: [{ title: "Trust Passport — Vendora" }] }),
  component: SupplierVerificationPage,
});
