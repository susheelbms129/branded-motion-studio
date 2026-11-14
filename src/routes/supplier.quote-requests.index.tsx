import { createFileRoute } from "@tanstack/react-router";

import { SupplierQuoteRequestsPage } from "@/features/supplier/SupplierQuoteRequestsPage";
import { supplierPageGuard } from "@/lib/route-guards";

export const Route = createFileRoute("/supplier/quote-requests/")({
  ssr: false,
  beforeLoad: supplierPageGuard,
  head: () => ({ meta: [{ title: "Quote requests — Vendora" }] }),
  component: SupplierQuoteRequestsPage,
});
