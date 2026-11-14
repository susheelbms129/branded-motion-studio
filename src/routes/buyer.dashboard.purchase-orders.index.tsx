import { createFileRoute } from "@tanstack/react-router";

import { PurchaseOrdersPage } from "@/features/pos/PurchaseOrdersPage";

export const Route = createFileRoute("/buyer/dashboard/purchase-orders/")({ component: PurchaseOrdersPage });
