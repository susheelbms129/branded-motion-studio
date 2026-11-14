import { createFileRoute, redirect } from "@tanstack/react-router";

import { SupplierDashboardPage } from "@/features/supplier/SupplierDashboardPage";
import { hasSupplierWorkspace, requireSupplier } from "@/lib/auth";

export const Route = createFileRoute("/supplier/dashboard")({
  ssr: false,
  beforeLoad: async () => {
    const r = await requireSupplier();
    if (r === "signin") throw redirect({ to: "/supplier/signin" });
    if (r === "buyer") throw redirect({ to: "/buyer/dashboard" });
    // A supplier who hasn't launched their business yet finishes setup first. This is decided by the
    // database (do they belong to a supplier company?), never by anything stored in the browser.
    if (!(await hasSupplierWorkspace())) throw redirect({ to: "/supplier/onboarding" });
  },
  head: () => ({ meta: [{ title: "Supplier workspace — Vendora" }] }),
  component: SupplierDashboardPage,
});
