import { createFileRoute } from "@tanstack/react-router";

import { LandingPage } from "@/components/landing/LandingPage";

// The sign-up panel itself is drawn by the root route (see AuthRoute in __root.tsx), same as /signup.
export const Route = createFileRoute("/supplier/signup")({
  head: () => ({ meta: [{ title: "Supplier sign up — Vendora" }] }),
  component: LandingPage,
});
