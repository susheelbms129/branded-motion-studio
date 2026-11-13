import { createFileRoute } from "@tanstack/react-router";

import { LandingPage } from "@/components/landing/LandingPage";

// The home route ships no og:image, so serve-time hosting can inject the
// project's social preview (explicit og:image or latest screenshot).
export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Vendora — Every rupee you spend, finally accounted for" },
      { name: "description", content: "Vendora is AI-native procurement for growing Indian businesses: purchase requests, RFQs, landed-cost comparison, approvals, purchase orders and supplier scorecards in one trail." },
      { property: "og:title", content: "Vendora — Every rupee you spend, finally accounted for" },
      { property: "og:description", content: "Real landed costs, approvals that move, and AI that shows its evidence." },
    ],
  }),
  component: LandingPage,
});
