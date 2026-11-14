import { createFileRoute } from "@tanstack/react-router";

import { RequestsPage } from "@/features/requests/RequestsPage";

export const Route = createFileRoute("/buyer/dashboard/requests/")({ component: RequestsPage });
