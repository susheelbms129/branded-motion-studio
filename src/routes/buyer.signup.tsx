import { createFileRoute } from "@tanstack/react-router";

import { LandingPage } from "@/components/landing/LandingPage";

// The sign-up panel itself is drawn by the root route (see AuthRoute in __root.tsx), same as /supplier/signup.
export const Route = createFileRoute("/buyer/signup")({
  head: () => ({ meta: [{ title: "Buyer sign up — Vendora" }] }),
  component: LandingPage,
});
