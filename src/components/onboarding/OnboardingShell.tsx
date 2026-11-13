import { motion } from "framer-motion";
import { Check } from "lucide-react";
import type { ComponentType, CSSProperties, ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface OnboardingStep {
  title: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
}

/** Left panel: near-black with a faint blue glow top-left and violet glow bottom-right. */
const DARK_PANEL: CSSProperties = {
  backgroundColor: "oklch(0.125 0.03 270)",
  backgroundImage: [
    "radial-gradient(30rem 26rem at -10% -6%, oklch(0.563 0.24 263.8 / 0.30), transparent 65%)",
    "radial-gradient(28rem 28rem at 110% 104%, oklch(0.541 0.247 293 / 0.26), transparent 65%)",
  ].join(", "),
};

/** Right panel: clean white with soft brand glows, so the content reads as premium and on-brand. */
const LIGHT_PANEL: CSSProperties = {
  backgroundColor: "oklch(0.995 0.003 280)",
  backgroundImage: [
    "radial-gradient(46rem 32rem at 100% 0%, oklch(0.9 0.07 285 / 0.45), transparent 65%)",
    "radial-gradient(40rem 32rem at 0% 100%, oklch(0.92 0.06 250 / 0.45), transparent 65%)",
  ].join(", "),
};

/**
 * Shared onboarding layout. Full screen, no card: a black panel with the logo and the vertical timeline
 * fixed on the left, and the current step filling the rest of the screen on the right.
 * Used by buyer onboarding now and meant to be reused by supplier onboarding.
 * Completed steps can be clicked to go back; later steps can't be skipped to.
 *
 * The left panel is pinned to the viewport height (it never moves or stretches while the right side
 * grows or scrolls), and its timeline is centred in the space under the logo.
 */
export function OnboardingShell({
  steps,
  current,
  onSelect,
  stepLabel,
  heading = "Workspace setup",
  children,
  footer,
}: {
  steps: OnboardingStep[];
  current: number;
  onSelect: (i: number) => void;
  /** e.g. "Step 01 of 04". Left out on the welcome screen. */
  stepLabel?: string;
  /** Small caption above the timeline, e.g. "Supplier onboarding". */
  heading?: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  const percent = Math.round((current / (steps.length - 1)) * 100);

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      {/* Left: black brand panel (desktop). Pinned in place, full viewport height. */}
      <aside
        className="relative hidden shrink-0 flex-col overflow-hidden text-white md:sticky md:top-0 md:flex md:h-dvh md:w-[21rem] lg:w-[24rem]"
        style={DARK_PANEL}
        aria-label="Setup progress"
      >
        {/* faint grid, fading out toward the bottom */}
        <div
          aria-hidden
          className="bg-grid-dark pointer-events-none absolute inset-0 opacity-60"
          style={{ maskImage: "linear-gradient(180deg, black 0%, transparent 75%)", WebkitMaskImage: "linear-gradient(180deg, black 0%, transparent 75%)" }}
        />

        <div className="relative flex h-full flex-col px-8 py-9 lg:px-10">
          <img src="/brand/vendora-logo.png" alt="Vendora — Smarter Buying. Greater Business." className="h-14 w-auto self-start lg:h-16" />

          <div className="my-auto py-8">
            <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.18em] text-white/40">{heading}</p>
            <ol className="mt-6">
              {steps.map((s, i) => {
                const done = i < current;
                const active = i === current;
                const Icon = s.icon;
                const last = i === steps.length - 1;
                return (
                  <li key={s.title} className="relative flex gap-4 pb-11 last:pb-0">
                    {last ? null : (
                      <span
                        aria-hidden
                        className={cn("absolute left-[1.1875rem] top-11 h-[calc(100%-2.75rem)] w-0.5 rounded-full", done ? "bg-gradient-to-b from-blue to-violet" : "bg-white/15")}
                      />
                    )}
                    <button
                      type="button"
                      disabled={!done}
                      onClick={() => onSelect(i)}
                      aria-current={active ? "step" : undefined}
                      className={cn("flex min-w-0 items-start gap-4 rounded-md text-left", done ? "cursor-pointer" : "cursor-default")}
                    >
                      <span
                        className={cn(
                          "relative grid size-10 shrink-0 place-items-center rounded-xl border text-sm font-semibold transition",
                          done && "border-transparent bg-gradient-primary text-on-brand shadow-glow",
                          active && "border-blue/70 bg-blue/15 text-white ring-4 ring-blue/20",
                          !done && !active && "border-white/15 bg-white/5 text-white/45",
                        )}
                      >
                        {done ? <Check className="size-4" strokeWidth={3} /> : <Icon className="size-[1.125rem]" />}
                      </span>
                      <span className="min-w-0 pt-0.5">
                        <span className={cn("block text-[0.9375rem] font-semibold", active || done ? "text-white" : "text-white/50")}>{s.title}</span>
                        <span className={cn("mt-0.5 block text-xs leading-snug", active ? "text-white/70" : "text-white/40")}>{s.description}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>

          <div>
            <div className="flex items-center justify-between text-[0.6875rem] font-semibold uppercase tracking-[0.18em] text-white/40">
              <span>Progress</span>
              <span className="text-white/80">{percent}%</span>
            </div>
            <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-gradient-cta transition-all duration-500" style={{ width: `${percent}%` }} />
            </div>
          </div>
        </div>
      </aside>

      {/* Mobile: compact dark header with the logo and a progress bar instead of the side panel */}
      <header className="px-5 pb-4 pt-5 text-white md:hidden" style={DARK_PANEL}>
        <img src="/brand/vendora-logo.png" alt="Vendora" className="h-11 w-auto" />
        <div className="mt-4 flex items-center justify-between text-xs font-semibold">
          <span>{steps[current]?.title}</span>
          <span className="text-white/60">
            {current + 1} / {steps.length}
          </span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full bg-gradient-cta transition-all" style={{ width: `${((current + 1) / steps.length) * 100}%` }} />
        </div>
      </header>

      {/* Right: the step fills the rest of the screen */}
      <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden" style={LIGHT_PANEL}>
        <div aria-hidden className="h-1 w-full shrink-0 bg-gradient-cta" />
        <div aria-hidden className="bg-grid-light pointer-events-none absolute inset-0 opacity-40" style={{ maskImage: "linear-gradient(180deg, black 0%, transparent 55%)", WebkitMaskImage: "linear-gradient(180deg, black 0%, transparent 55%)" }} />

        <div className="relative flex flex-1 flex-col px-6 pt-8 sm:px-10 lg:px-16 lg:pt-12 xl:px-24">
          <motion.div key={current} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} className="mx-auto w-full max-w-5xl flex-1">
            {stepLabel ? (
              <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary/15 bg-primary/5 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-primary">
                <span className="size-1.5 rounded-full bg-gradient-primary" />
                {stepLabel}
              </p>
            ) : null}
            {children}
          </motion.div>
        </div>

        {/* Buttons stay at the bottom of the screen while a long step scrolls */}
        <div className="sticky bottom-0 z-10 mt-6 border-t border-border/80 bg-white/85 px-6 py-4 backdrop-blur-md sm:px-10 lg:px-16 xl:px-24">
          <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3">{footer}</div>
        </div>
      </main>
    </div>
  );
}
