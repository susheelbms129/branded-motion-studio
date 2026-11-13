import { createFileRoute, redirect } from "@tanstack/react-router";

// Legacy URL: sign-in lives at /signin.
export const Route = createFileRoute("/login")({
  beforeLoad: () => {
    throw redirect({ to: "/signin" });
  },
});
