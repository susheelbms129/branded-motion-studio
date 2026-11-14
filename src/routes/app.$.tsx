import { createFileRoute, redirect } from "@tanstack/react-router";

// Old /app/... links (bookmarks, emails already sent) keep working: /app/requests/5 → /buyer/dashboard/requests/5.
export const Route = createFileRoute("/app/$")({
  beforeLoad: ({ params }) => {
    const rest = String((params as { _splat?: string })._splat ?? "").replace(/^\/+/, "");
    throw redirect({ to: `/buyer/dashboard${rest ? `/${rest}` : ""}` as never, replace: true });
  },
});
