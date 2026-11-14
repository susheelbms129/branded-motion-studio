import { createFileRoute } from "@tanstack/react-router";

import { SuppliersPage } from "@/features/suppliers/SuppliersPage";

export const Route = createFileRoute("/buyer/dashboard/suppliers/")({ component: SuppliersPage });
