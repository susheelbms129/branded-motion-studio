import { createFileRoute } from "@tanstack/react-router";

import { SupplierDashboardPage } from "@/features/supplier/SupplierDashboardPage";
import { supplierPageGuard } from "@/lib/route-guards";

export const Route = createFileRoute("/supplier/dashboard")({
  ssr: false,
  beforeLoad: supplierPageGuard,
  head: () => ({ meta: [{ title: "Supplier workspace — Vendora" }] }),
  component: SupplierDashboardPage,
});
