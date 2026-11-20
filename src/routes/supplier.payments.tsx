import { createFileRoute } from "@tanstack/react-router";

import { SupplierPaymentsPage } from "@/features/supplier/SupplierPaymentsPage";
import { supplierPageGuard } from "@/lib/route-guards";

export const Route = createFileRoute("/supplier/payments")({
  ssr: false,
  beforeLoad: supplierPageGuard,
  head: () => ({ meta: [{ title: "When you'll be paid — Vendora" }] }),
  component: SupplierPaymentsPage,
});
