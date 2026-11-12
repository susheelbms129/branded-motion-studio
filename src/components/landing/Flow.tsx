import { Check } from "lucide-react";
import { useState, type CSSProperties } from "react";

import { ACCENT } from "@/lib/accents";

import { FLOW_STEPS } from "./content";
import { Reveal, SectionHead } from "./motion";

export function Flow() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const step = FLOW_STEPS[active] ?? FLOW_STEPS[0];
  const accent = ACCENT[step.panel.tone];

  return (
    <section id="flow" className="relative overflow-hidden bg-navy py-28 sm:py-40">
      <div className="glow-indigo pointer-events-none absolute left-1/2 top-0 h-[700px] w-[900px] -translate-x-1/2 opacity-40" />
      <div className="relative mx-auto max-w-[1400px] px-5 sm:px-8">
        <SectionHead eyebrow="Vendora Flow" title={<>One trail. <span className="text-gradient-brand-dark animate-gradient-pan">Six stages.</span> Nothing off the record.</>} body="Most purchasing leaks happen in the gaps between tools. Vendora closes the gaps, so every order has a start, a decision, and an owner." />

        <div className="mt-20 grid gap-8 lg:grid-cols-12 lg:gap-12">
          <Reveal className="lg:col-span-5">
            <ol className="space-y-3" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
              {FLOW_STEPS.map((s, i) => {
                const on = i === active;
                return (
                  <li key={s.key}>
                    <button
                      type="button"
                      onClick={() => setActive(i)}
                      aria-current={on ? "step" : undefined}
                      className={`relative w-full overflow-hidden rounded-3xl border p-6 text-left transition-all duration-500 ${on ? "border-white/25 bg-white/10 shadow-glow" : "border-white/10 bg-white/[0.03] hover:bg-white/[0.07]"}`}
                    >
                      <div className="flex items-center gap-4">
                        <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-lg font-semibold transition ${i < active ? "bg-emerald text-white" : on ? "bg-gradient-primary text-white" : "bg-white/10 text-white/70"}`}>
                          {i < active ? <Check className="h-6 w-6" /> : i + 1}
                        </span>
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan">{s.kicker}</p>
                          <p className="text-2xl font-semibold text-white">{s.title}</p>
                        </div>
                      </div>
                      <div className={`grid transition-all duration-500 ${on ? "mt-4 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
                        <p className="overflow-hidden text-base leading-relaxed text-navy-muted sm:text-lg">{s.body}</p>
                      </div>
                      {on ? (
                        <span
                          key={`${active}-bar`}
                          onAnimationEnd={() => setActive((a) => (a + 1) % FLOW_STEPS.length)}
                          className="progress-fill absolute inset-x-0 bottom-0 h-1 bg-gradient-cta"
                          style={{ "--dur": "6500ms", animationPlayState: paused ? "paused" : "running" } as CSSProperties}
                        />
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ol>
          </Reveal>

          <Reveal className="lg:col-span-7" delay={0.15} scale>
            <div className="sticky top-32">
              <div className="relative overflow-hidden rounded-[32px] border border-white/15 bg-white p-6 shadow-[0_40px_100px_-20px_oklch(0.55_0.25_285/45%)] sm:p-10">
                <div className={`${accent.glow} absolute -right-20 -top-20 h-72 w-72 opacity-50`} />
                <div key={step.key} className="relative">
                  <div className="flex items-start justify-between gap-4">
                    <h3 className="slide-in-r text-2xl font-semibold text-foreground sm:text-4xl">{step.panel.title}</h3>
                    <span className={`pop-in rounded-full px-4 py-1.5 text-sm font-semibold ${accent.tint}`}>{step.panel.tag}</span>
                  </div>
                  <dl className="mt-8 divide-y divide-border">
                    {step.panel.rows.map(([k, v], i) => (
                      <div key={k} className="slide-in-r flex items-center justify-between gap-6 py-4 sm:py-5" style={{ animationDelay: `${0.1 + i * 0.09}s` }}>
                        <dt className="text-base text-muted-foreground sm:text-lg">{k}</dt>
                        <dd className="text-right text-base font-semibold text-foreground tabular sm:text-xl">{v}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="pop-in mt-8 flex items-center gap-3 rounded-2xl bg-lavender px-5 py-4 text-base font-medium text-secondary-foreground" style={{ animationDelay: "0.5s" }}>
                    <span className={`h-2.5 w-2.5 rounded-full ${accent.dot} dot-live`} />
                    {step.panel.foot}
                  </p>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
