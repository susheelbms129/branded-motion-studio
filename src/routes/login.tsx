import { createFileRoute, redirect } from "@tanstack/react-router";

// Legacy URL: buyer sign-in lives at /buyer/signin.
export const Route = createFileRoute("/login")({
  beforeLoad: () => {
    throw redirect({ to: "/buyer/signin" });
  },
});
