import { createFileRoute } from "@tanstack/react-router";

import { PurchaseOrderDetailPage } from "@/features/pos/PurchaseOrderDetailPage";

export const Route = createFileRoute("/app/purchase-orders/$id")({
  component: PurchaseOrderDetailPage,
});
