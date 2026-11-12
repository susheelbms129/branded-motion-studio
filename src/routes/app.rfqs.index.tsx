import { createFileRoute } from "@tanstack/react-router";

import { RfqsPage } from "@/features/rfq/RfqsPage";

export const Route = createFileRoute("/app/rfqs/")({ component: RfqsPage });
