import { createFileRoute } from "@tanstack/react-router";

import { PurchaseOrderDetailPage } from "@/features/pos/PurchaseOrderDetailPage";

export const Route = createFileRoute("/buyer/dashboard/purchase-orders/$id")({
  component: PurchaseOrderDetailPage,
});
