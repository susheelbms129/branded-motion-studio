import { createFileRoute } from "@tanstack/react-router";

import { InsightsPage } from "@/features/insights/InsightsPage";

export const Route = createFileRoute("/app/insights")({ component: InsightsPage });
