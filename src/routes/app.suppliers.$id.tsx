import { createFileRoute } from "@tanstack/react-router";

import { SupplierDetailPage } from "@/features/suppliers/SupplierDetailPage";

export const Route = createFileRoute("/app/suppliers/$id")({ component: SupplierDetailPage });
