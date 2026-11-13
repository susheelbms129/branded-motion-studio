import { createFileRoute, redirect } from "@tanstack/react-router";

import { SupplierDashboardPage } from "@/features/supplier/SupplierDashboardPage";
import { loadDraft } from "@/features/supplier/draft";
import { requireSupplier } from "@/lib/auth";

export const Route = createFileRoute("/supplier/dashboard")({
  ssr: false,
  beforeLoad: async () => {
    const r = await requireSupplier();
    if (r === "signin") throw redirect({ to: "/supplier/signin" });
    if (r === "buyer") throw redirect({ to: "/app" });
    // A supplier who hasn't set up their business yet finishes setup first.
    if (!loadDraft()) throw redirect({ to: "/supplier/onboarding" });
  },
  head: () => ({ meta: [{ title: "Supplier workspace — Vendora" }] }),
  component: SupplierDashboardPage,
});
