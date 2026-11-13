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

export function LandingPage() {
  return (
    <div className="overflow-x-clip bg-navy text-navy-foreground" style={{ zoom: 0.8 }}>
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
