import { createFileRoute } from "@tanstack/react-router";

import { SupplierDetailPage } from "@/features/suppliers/SupplierDetailPage";

export const Route = createFileRoute("/buyer/dashboard/suppliers/$id")({ component: SupplierDetailPage });
