import { createFileRoute } from "@tanstack/react-router";

import { LandingPage } from "@/components/landing/LandingPage";

export const Route = createFileRoute("/signin")({
  head: () => ({ meta: [{ title: "Sign in — Vendora" }] }),
  component: LandingPage,
});
