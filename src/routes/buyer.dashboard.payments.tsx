import { createFileRoute } from "@tanstack/react-router";

import { PayablesPage } from "@/features/payments/PayablesPage";

export const Route = createFileRoute("/buyer/dashboard/payments")({ component: PayablesPage });
