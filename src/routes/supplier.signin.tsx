import { createFileRoute } from "@tanstack/react-router";

import { LandingPage } from "@/components/landing/LandingPage";

// The sign-in panel itself is drawn by the root route (see AuthRoute in __root.tsx).
// Suppliers sign in here; buyers sign in at /signin. The two sides never share a sign-in.
export const Route = createFileRoute("/supplier/signin")({
  head: () => ({ meta: [{ title: "Supplier sign in — Vendora" }] }),
  component: LandingPage,
});
