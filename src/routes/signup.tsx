import { createFileRoute, redirect } from "@tanstack/react-router";

// Legacy URL: buyer sign-up now lives at /buyer/signup.
export const Route = createFileRoute("/signup")({
  beforeLoad: () => {
    throw redirect({ to: "/buyer/signup" });
  },
});
