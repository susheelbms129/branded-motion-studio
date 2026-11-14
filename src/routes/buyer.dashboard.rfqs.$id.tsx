import { createFileRoute } from "@tanstack/react-router";

import { RfqDetailPage } from "@/features/rfq/RfqDetailPage";

export const Route = createFileRoute("/buyer/dashboard/rfqs/$id")({ component: RfqDetailPage });
