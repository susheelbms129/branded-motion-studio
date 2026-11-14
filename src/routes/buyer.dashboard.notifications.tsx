import { createFileRoute } from "@tanstack/react-router";

import { NotificationsPage } from "@/features/settings/NotificationsPage";

export const Route = createFileRoute("/buyer/dashboard/notifications")({ component: NotificationsPage });
