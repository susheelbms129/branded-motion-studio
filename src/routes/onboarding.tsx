import { createFileRoute } from "@tanstack/react-router";

import { OnboardingPage } from "@/features/auth/AuthPages";

export const Route = createFileRoute("/onboarding")({
  head: () => ({ meta: [{ title: "Onboarding — Vendora" }] }),
  component: OnboardingPage,
});
