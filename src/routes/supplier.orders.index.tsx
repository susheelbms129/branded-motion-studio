import { createFileRoute } from "@tanstack/react-router";

import { SupplierOrdersPage } from "@/features/supplier/SupplierOrdersPage";
import { supplierPageGuard } from "@/lib/route-guards";

export const Route = createFileRoute("/supplier/orders/")({
  ssr: false,
  beforeLoad: supplierPageGuard,
  head: () => ({ meta: [{ title: "Orders received — Vendora" }] }),
  component: SupplierOrdersPage,
});
