import { createFileRoute } from "@tanstack/react-router";

import { SupplierVerificationPage } from "@/features/supplier/SupplierVerificationPage";
import { supplierPageGuard } from "@/lib/route-guards";

export const Route = createFileRoute("/supplier/verification")({
  ssr: false,
  beforeLoad: supplierPageGuard,
  head: () => ({ meta: [{ title: "Trust Passport — Vendora" }] }),
  component: SupplierVerificationPage,
});
