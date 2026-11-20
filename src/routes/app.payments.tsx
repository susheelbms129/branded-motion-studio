import { createFileRoute } from "@tanstack/react-router";

import { PayablesPage } from "@/features/payments/PayablesPage";

export const Route = createFileRoute("/app/payments")({ component: PayablesPage });
