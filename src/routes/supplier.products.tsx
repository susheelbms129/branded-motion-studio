import { createFileRoute } from "@tanstack/react-router";

import { SupplierProductsPage } from "@/features/supplier/SupplierProductsPage";
import { supplierPageGuard } from "@/lib/route-guards";

export const Route = createFileRoute("/supplier/products")({
  ssr: false,
  beforeLoad: supplierPageGuard,
  head: () => ({ meta: [{ title: "Products — Vendora" }] }),
  component: SupplierProductsPage,
});
