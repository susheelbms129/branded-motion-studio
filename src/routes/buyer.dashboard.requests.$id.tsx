import { createFileRoute } from "@tanstack/react-router";

import { RequestDetailPage } from "@/features/requests/RequestDetailPage";

export const Route = createFileRoute("/buyer/dashboard/requests/$id")({ component: RequestDetailPage });
