import { createFileRoute } from "@tanstack/react-router";

import { SupplierQuoteRequestPage } from "@/features/supplier/SupplierQuoteRequestPage";
import { supplierPageGuard } from "@/lib/route-guards";

export const Route = createFileRoute("/supplier/quote-requests/$id")({
  ssr: false,
  beforeLoad: supplierPageGuard,
  head: () => ({ meta: [{ title: "Quote request — Vendora" }] }),
  component: QuoteRequestRoute,
});

function QuoteRequestRoute() {
  const { id } = Route.useParams();
  return <SupplierQuoteRequestPage rfqId={id} />;
}
