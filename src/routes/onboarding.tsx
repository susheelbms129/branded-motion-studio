import { createFileRoute, redirect } from "@tanstack/react-router";

// Legacy URL: buyer onboarding now lives at /buyer/onboarding.
export const Route = createFileRoute("/onboarding")({
  beforeLoad: () => {
    throw redirect({ to: "/buyer/onboarding" });
  },
});
