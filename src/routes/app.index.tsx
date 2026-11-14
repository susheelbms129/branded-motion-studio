import { createFileRoute, redirect } from "@tanstack/react-router";

// The buyer workspace used to live at /app. Old bookmarks and old emails still land here, so send them on.
export const Route = createFileRoute("/app/")({
  beforeLoad: () => {
    throw redirect({ to: "/buyer/dashboard", replace: true });
  },
});
