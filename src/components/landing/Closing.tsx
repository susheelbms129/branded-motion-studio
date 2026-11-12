import { ArrowRight, Check, Plus } from "lucide-react";

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { ACCENT } from "@/lib/accents";

import { FAQ, PLANS } from "./content";
import { DemoForm } from "./Forms";
import { Reveal, SectionHead, Spot } from "./motion";

export function Plans() {
  return (
    <section id="plans" className="relative overflow-hidden bg-navy py-28 sm:py-40">
      <div className="glow-magenta pointer-events-none absolute left-1/2 top-10 h-[600px] w-[800px] -translate-x-1/2 opacity-30" />
      <div className="relative mx-auto max-w-[1400px] px-5 sm:px-8">
        <SectionHead eyebrow="Plans" title={<>Start small. <span className="text-gradient-brand-dark animate-gradient-pan">Grow into the rest.</span></>} body="Pricing is shaped around your team and purchase volume. Tell us about both and we'll give you a clear number, in rupees." />
        <div className="mt-16 grid gap-6 lg:grid-cols-3">
          {PLANS.map((p, i) => {
            const featured = "featured" in p && p.featured;
            return (
              <Reveal key={p.name} delay={i * 0.12} scale>
                <Spot className={`h-full rounded-[32px] ${featured ? "gradient-border lg:-translate-y-4" : "border border-white/10"}`}>
                  <div className={`flex h-full flex-col p-8 sm:p-10 ${featured ? "bg-navy-2" : "bg-white/[0.04]"}`}>
                    <div className="flex items-center justify-between">
                      <h3 className="text-3xl font-semibold text-white">{p.name}</h3>
                      {featured ? <span className="rounded-full bg-gradient-cta px-3 py-1 text-xs font-bold uppercase tracking-wider text-white">Most chosen</span> : null}
                    </div>
                    <p className="mt-2 text-lg text-navy-muted">{p.who}</p>
                    <ul className="mt-8 flex-1 space-y-3.5">
                      {p.points.map((pt) => (
                        <li key={pt} className="flex items-start gap-3 text-lg text-white/90">
                          <span className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${ACCENT[p.accent].chip} text-white`}>
                            <Check className="h-3 w-3" strokeWidth={3} />
                          </span>
                          {pt}
                        </li>
                      ))}
                    </ul>
                    <a href="#demo" className={`btn-shine mt-10 inline-flex items-center justify-center gap-2 rounded-full px-6 py-4 text-lg font-semibold text-white transition hover:scale-[1.03] ${featured ? "bg-gradient-cta shadow-glow" : "border border-white/20 hover:bg-white/10"}`}>
                      Get {p.name} pricing <ArrowRight className="h-5 w-5" />
                    </a>
                  </div>
                </Spot>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export function Faq() {
  return (
    <section id="faq" className="relative bg-gradient-lavender py-28 sm:py-40">
      <div className="mx-auto max-w-4xl px-5 sm:px-8">
        <SectionHead dark={false} eyebrow="Questions" title={<>Straight answers, <span className="text-gradient-brand animate-gradient-pan">no sales dance.</span></>} />
        <Reveal className="mt-14" delay={0.1}>
          <Accordion type="single" collapsible defaultValue="item-0" className="space-y-3">
            {FAQ.map((f, i) => (
              <AccordionItem key={f.q} value={`item-${i}`} className="rounded-3xl border border-border bg-white px-6 shadow-card transition data-[state=open]:shadow-lift sm:px-8">
                <AccordionTrigger className="group py-6 text-left text-lg font-semibold text-foreground hover:no-underline sm:text-xl [&>svg]:hidden">
                  <span className="flex-1 pr-4">{f.q}</span>
                  <Plus className="h-6 w-6 shrink-0 text-violet transition-transform duration-300 group-data-[state=open]:rotate-45" />
                </AccordionTrigger>
                <AccordionContent className="pb-6 text-base leading-relaxed text-muted-foreground sm:text-lg">{f.a}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </Reveal>
      </div>
    </section>
  );
}

export function Demo() {
  return (
    <section id="demo" className="relative isolate overflow-hidden bg-navy py-28 sm:py-40">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="bg-grid-dark mask-radial absolute inset-0" />
        <div className="glow-violet animate-orb absolute -left-32 top-0 h-[600px] w-[600px] opacity-70" />
        <div className="glow-blue animate-orb-slow absolute -right-32 bottom-0 h-[600px] w-[600px] opacity-60" />
      </div>
      <div className="mx-auto grid max-w-[1300px] items-center gap-14 px-5 sm:px-8 lg:grid-cols-2">
        <Reveal>
          <h2 className="text-5xl font-semibold leading-[1.02] text-white sm:text-6xl lg:text-7xl">
            See your purchasing <span className="text-gradient-brand-dark animate-gradient-pan">with the lights on.</span>
          </h2>
          <p className="mt-7 max-w-xl text-xl leading-relaxed text-navy-muted">Thirty minutes. We load a workspace shaped like your categories, suppliers and approval chain, then walk one real purchase through it.</p>
          <ul className="mt-9 space-y-4">
            {["No slide deck. A working product.", "Your approval rules, modelled live.", "A clear price in rupees before we hang up."].map((t) => (
              <li key={t} className="flex items-center gap-3 text-lg text-white">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-emerald">
                  <Check className="h-4 w-4" strokeWidth={3} />
                </span>
                {t}
              </li>
            ))}
          </ul>
        </Reveal>
        <Reveal delay={0.15} scale>
          <div className="gradient-border rounded-[32px]">
            <div className="rounded-[31px] bg-navy-2 p-7 sm:p-10">
              <h3 className="mb-6 text-2xl font-semibold text-white">Book your walkthrough</h3>
              <DemoForm />
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
