import { createFileRoute } from "@tanstack/react-router";

import { LandingPage } from "@/components/landing/LandingPage";

// The sign-in panel itself is drawn by the root route (see AuthRoute in __root.tsx).
// Buyers sign in here; suppliers sign in at /supplier/signin. The two sides never share a sign-in.
export const Route = createFileRoute("/buyer/signin")({
  head: () => ({ meta: [{ title: "Buyer sign in — Vendora" }] }),
  component: LandingPage,
});
