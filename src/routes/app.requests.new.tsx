import { createFileRoute } from "@tanstack/react-router";

import { NewRequestPage } from "@/features/requests/NewRequestPage";

export const Route = createFileRoute("/app/requests/new")({ component: NewRequestPage });
