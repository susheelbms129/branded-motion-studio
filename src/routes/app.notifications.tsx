import { createFileRoute } from "@tanstack/react-router";

import { NotificationsPage } from "@/features/settings/NotificationsPage";

export const Route = createFileRoute("/app/notifications")({ component: NotificationsPage });
