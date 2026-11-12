import { createFileRoute } from "@tanstack/react-router";

import { RfqDetailPage } from "@/features/rfq/RfqDetailPage";

export const Route = createFileRoute("/app/rfqs/$id")({ component: RfqDetailPage });
