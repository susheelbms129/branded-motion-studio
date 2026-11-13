import { createFileRoute, redirect } from "@tanstack/react-router";

import { SupplierDashboardPage } from "@/features/supplier/SupplierDashboardPage";
import { requireSession } from "@/lib/auth";

export const Route = createFileRoute("/supplier/dashboard")({
  ssr: false,
  beforeLoad: async () => {
    if (!(await requireSession())) throw redirect({ to: "/signin" });
  },
  head: () => ({ meta: [{ title: "Supplier workspace — Vendora" }] }),
  component: SupplierDashboardPage,
});
