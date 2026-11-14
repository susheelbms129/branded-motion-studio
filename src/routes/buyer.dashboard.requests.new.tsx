import { createFileRoute } from "@tanstack/react-router";

import { NewRequestPage } from "@/features/requests/NewRequestPage";

export const Route = createFileRoute("/buyer/dashboard/requests/new")({ component: NewRequestPage });
