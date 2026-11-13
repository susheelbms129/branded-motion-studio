import { motion } from "framer-motion";
import { Check } from "lucide-react";
import type { ComponentType, ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface OnboardingStep {
  title: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
}

/**
 * Shared onboarding layout: a vertical timeline on the left, the current step's details on the right.
 * Used by buyer onboarding now and meant to be reused by supplier onboarding.
 * Completed steps can be clicked to go back; later steps can't be skipped to.
 */
export function OnboardingShell({
  steps,
  current,
  onSelect,
  stepLabel,
  children,
  footer,
}: {
  steps: OnboardingStep[];
  current: number;
  onSelect: (i: number) => void;
  /** e.g. "Step 01 of 04". Left out on the welcome screen. */
  stepLabel?: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="relative flex min-h-dvh flex-col items-center overflow-hidden bg-gradient-lavender px-4 py-6 sm:px-6 sm:py-8">
      <div className="glow-violet animate-orb pointer-events-none absolute -right-32 -top-20 size-[34rem] opacity-30" />
      <div className="glow-blue animate-orb-slow pointer-events-none absolute -bottom-32 -left-32 size-[34rem] opacity-30" />

      <div className="relative flex w-full max-w-6xl flex-1 flex-col">
        <img src="/brand/vendora-logo-light.png" alt="Vendora" className="mb-4 h-14 w-auto self-start sm:h-16" />

        <div className="flex flex-1 flex-col overflow-hidden rounded-lg border border-border bg-white shadow-lift md:min-h-[36rem] md:flex-row">
          {/* Left: vertical timeline (desktop) */}
          <aside className="hidden w-72 shrink-0 border-r border-border bg-muted/40 p-6 md:block" aria-label="Setup progress">
            <ol>
              {steps.map((s, i) => {
                const done = i < current;
                const active = i === current;
                const Icon = s.icon;
                const last = i === steps.length - 1;
                return (
                  <li key={s.title} className="relative flex gap-3 pb-6 last:pb-0">
                    {last ? null : (
                      <span aria-hidden className={cn("absolute left-[1.0625rem] top-9 h-[calc(100%-2.25rem)] w-0.5 rounded-full", done ? "bg-primary/60" : "bg-border")} />
                    )}
                    <button
                      type="button"
                      disabled={!done}
                      onClick={() => onSelect(i)}
                      aria-current={active ? "step" : undefined}
                      className={cn("flex min-w-0 items-start gap-3 rounded-md text-left", done ? "cursor-pointer" : "cursor-default")}
                    >
                      <span
                        className={cn(
                          "relative grid size-[2.125rem] shrink-0 place-items-center rounded-md border text-sm font-semibold transition",
                          done && "border-transparent bg-gradient-primary text-on-brand shadow-glow",
                          active && "border-primary bg-primary/10 text-primary ring-4 ring-primary/15",
                          !done && !active && "border-border bg-white text-muted-foreground",
                        )}
                      >
                        {done ? <Check className="size-4" strokeWidth={3} /> : <Icon className="size-4" />}
                      </span>
                      <span className="min-w-0 pt-0.5">
                        <span className={cn("block text-sm font-semibold", active || done ? "text-foreground" : "text-muted-foreground")}>{s.title}</span>
                        <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{s.description}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </aside>

          {/* Mobile: compact progress bar instead of the timeline */}
          <div className="border-b border-border bg-muted/40 px-5 py-3 md:hidden">
            <div className="flex items-center justify-between text-xs font-semibold">
              <span className="text-foreground">{steps[current]?.title}</span>
              <span className="text-muted-foreground">
                {current + 1} / {steps.length}
              </span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border">
              <div className="h-full rounded-full bg-gradient-primary transition-all" style={{ width: `${((current + 1) / steps.length) * 100}%` }} />
            </div>
          </div>

          {/* Right: step details */}
          <section className="flex min-w-0 flex-1 flex-col p-5 sm:p-8 lg:p-10">
            <motion.div key={current} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} className="flex-1">
              {stepLabel ? <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-primary">{stepLabel}</p> : null}
              {children}
            </motion.div>
            <div className="mt-8 flex items-center justify-between gap-3 border-t border-border pt-5">{footer}</div>
          </section>
        </div>
      </div>
    </div>
  );
}
