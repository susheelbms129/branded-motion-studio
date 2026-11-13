import { createFileRoute, redirect } from "@tanstack/react-router";

// Legacy URL: buyer sign-in now lives at /buyer/signin.
export const Route = createFileRoute("/signin")({
  beforeLoad: () => {
    throw redirect({ to: "/buyer/signin" });
  },
});
