import { createFileRoute } from "@tanstack/react-router";

import { RfqsPage } from "@/features/rfq/RfqsPage";

export const Route = createFileRoute("/buyer/dashboard/rfqs/")({ component: RfqsPage });
