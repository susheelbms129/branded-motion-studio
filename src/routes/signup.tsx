import { createFileRoute } from "@tanstack/react-router";

import { LandingPage } from "@/components/landing/LandingPage";

export const Route = createFileRoute("/signup")({
  head: () => ({ meta: [{ title: "Sign up — Vendora" }] }),
  component: LandingPage,
});
