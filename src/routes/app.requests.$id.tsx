import { createFileRoute } from "@tanstack/react-router";

import { RequestDetailPage } from "@/features/requests/RequestDetailPage";

export const Route = createFileRoute("/app/requests/$id")({ component: RequestDetailPage });
