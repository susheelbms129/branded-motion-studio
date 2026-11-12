import { createFileRoute } from "@tanstack/react-router";

import { Band } from "@/components/landing/Band";
import { Demo, Faq, Plans } from "@/components/landing/Closing";
import { Flow } from "@/components/landing/Flow";
import { SiteFooter } from "@/components/landing/Footer";
import { SiteHeader } from "@/components/landing/Header";
import { Hero } from "@/components/landing/Hero";
import { Insights } from "@/components/landing/Insights";
import { Lab } from "@/components/landing/Lab";
import { Platform } from "@/components/landing/Platform";
import { Roles } from "@/components/landing/Roles";

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
  component: Index,
});

function Index() {
  return (
    <div className="overflow-x-clip bg-navy text-navy-foreground">
      <SiteHeader />
      <main>
        <Hero />
        <Band />
        <Flow />
        <Lab />
        <Platform />
        <Insights />
        <Roles />
        <Plans />
        <Faq />
        <Demo />
      </main>
      <SiteFooter />
    </div>
  );
}
