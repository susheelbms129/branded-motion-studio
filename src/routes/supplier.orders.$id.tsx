import { createFileRoute } from "@tanstack/react-router";

import { SupplierOrderPage } from "@/features/supplier/SupplierOrderPage";
import { supplierPageGuard } from "@/lib/route-guards";

export const Route = createFileRoute("/supplier/orders/$id")({
  ssr: false,
  beforeLoad: supplierPageGuard,
  head: () => ({ meta: [{ title: "Order — Vendora" }] }),
  component: OrderRoute,
});

function OrderRoute() {
  const { id } = Route.useParams();
  return <SupplierOrderPage poId={id} />;
}
