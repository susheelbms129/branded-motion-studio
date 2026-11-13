import { useNavigate } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { ArrowRight, Check, Loader2 } from "lucide-react";
import { useState } from "react";

import { authInputClass } from "@/components/landing/AuthScreen";
import { createWorkspace } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { useUi } from "@/lib/ui-store";
import { useWs } from "@/lib/ws-store";

const STEPS = ["Your company", "What you buy", "Starting point"];
const CATS = [
  "Raw Materials",
  "Electrical",
  "Packaging",
  "IT & Electronics",
  "Office Supplies",
  "MRO & Tools",
  "Safety & PPE",
  "Logistics",
];

export function OnboardingPage() {
  const nav = useNavigate();
  const { user, finishOnboarding } = useUi();
  const reset = useWs((s) => s.reset);
  const updateOrg = useWs((s) => s.updateOrg);
  const [step, setStep] = useState(0);
  const [co, setCo] = useState({ name: user?.company ?? "", industry: "Manufacturing", city: "" });
  const [cats, setCats] = useState<string[]>(["Raw Materials", "Packaging"]);
  const [demo, setDemo] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const finish = async () => {
    setBusy(true);
    setError(null);
    try {
      await createWorkspace({ name: co.name, industry: co.industry, city: co.city.trim() });
    } catch (e) {
      setError(e instanceof Error ? e.message : "We couldn't create your workspace. Please try again.");
      setBusy(false);
      return;
    }
    finishOnboarding(demo);
    reset(demo);
    if (!demo) updateOrg({ name: co.name || "My Workspace", industry: co.industry, city: co.city });
    void nav({ to: "/app" });
  };
  const label = "mb-1.5 block text-sm font-medium text-foreground";
  const cta =
    "btn-shine group flex items-center justify-center gap-1.5 rounded-lg bg-gradient-cta px-5 py-2.5 text-sm font-semibold text-white shadow-glow transition hover:scale-[1.01] disabled:opacity-60 disabled:hover:scale-100";
  return (
    <div className="relative flex h-dvh flex-col items-center justify-start gap-[clamp(0.75rem,2.5vh,1.75rem)] overflow-hidden bg-gradient-lavender px-5 pb-4 pt-[clamp(0.75rem,2.5vh,1.75rem)]">
      <div className="glow-violet animate-orb pointer-events-none absolute -right-32 -top-20 size-[34rem] opacity-30" />
      <div className="glow-blue animate-orb-slow pointer-events-none absolute -bottom-32 -left-32 size-[34rem] opacity-30" />
      <div className="glow-magenta animate-orb pointer-events-none absolute bottom-10 right-1/4 size-80 opacity-15" />

      {/* Brand logo on the light page (no dark box). Light-background version: white lettering recoloured navy, V + swoosh unchanged. */}
      <img
        src="/brand/vendora-logo-light.png"
        alt="Vendora — Smarter Buying. Greater Business."
        className="relative h-[clamp(3.5rem,10vh,5.5rem)] w-auto shrink-0"
      />

      <div className="relative w-full max-w-3xl">
        <ol className="mb-[clamp(0.75rem,2.5vh,1.5rem)] flex shrink-0 items-center gap-3" aria-label="Progress">
          {STEPS.map((s, i) => (
            <li key={s} className="flex flex-1 items-center gap-3">
              <span
                className={cn(
                  "grid size-10 shrink-0 place-items-center rounded-full text-sm font-semibold transition",
                  i <= step ? "bg-gradient-primary text-on-brand shadow-glow" : "bg-white text-muted-foreground shadow-card",
                )}
              >
                {i < step ? <Check className="size-5" strokeWidth={3} /> : i + 1}
              </span>
              <span className={cn("hidden text-base sm:block", i === step ? "font-semibold text-foreground" : "text-muted-foreground")}>
                {s}
              </span>
              {i < 2 ? <span className={cn("h-0.5 flex-1 rounded-full", i < step ? "bg-primary/60" : "bg-border")} /> : null}
            </li>
          ))}
        </ol>

        <motion.div
          key={step}
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          className="rounded-[2rem] border border-white/60 bg-white p-6 shadow-lift sm:p-9"
        >
          {step === 0 ? (
            <>
              <h1 className="text-3xl font-semibold text-foreground">Tell us about your company</h1>
              <p className="mt-1.5 text-base text-muted-foreground">This appears on your purchase orders.</p>
              <div className="mt-6 space-y-4">
                <label className="block">
                  <span className={label}>Company name</span>
                  <input
                    className={authInputClass}
                    value={co.name}
                    onChange={(e) => setCo({ ...co, name: e.target.value })}
                    autoComplete="organization"
                  />
                </label>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className={label}>Industry</span>
                    <input className={authInputClass} value={co.industry} onChange={(e) => setCo({ ...co, industry: e.target.value })} />
                  </label>
                  <label className="block">
                    <span className={label}>City</span>
                    <input className={authInputClass} placeholder="Pune" value={co.city} onChange={(e) => setCo({ ...co, city: e.target.value })} />
                  </label>
                </div>
              </div>
            </>
          ) : null}

          {step === 1 ? (
            <>
              <h1 className="text-3xl font-semibold text-foreground">What do you mostly buy?</h1>
              <p className="mt-1.5 text-base text-muted-foreground">
                Pick your main categories — we'll set up budgets and suppliers around them.
              </p>
              <div className="mt-6 flex flex-wrap gap-2.5">
                {CATS.map((c) => {
                  const on = cats.includes(c);
                  return (
                    <button
                      key={c}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setCats(on ? cats.filter((x) => x !== c) : [...cats, c])}
                      className={cn(
                        "rounded-full border px-5 py-2.5 text-sm font-medium transition",
                        on ? "border-primary/40 bg-primary/10 text-primary" : "border-input bg-white text-foreground hover:border-primary/40 hover:bg-muted/60",
                      )}
                    >
                      {on ? "✓ " : ""}
                      {c}
                    </button>
                  );
                })}
              </div>
            </>
          ) : null}

          {step === 2 ? (
            <>
              <h1 className="text-3xl font-semibold text-foreground">How would you like to start?</h1>
              <p className="mt-1.5 text-base text-muted-foreground">You can switch any time from the top bar.</p>
              <div className="mt-6 grid gap-3">
                {[
                  {
                    v: true,
                    t: "Explore with sample data",
                    d: "A year of invented data for a Pune manufacturer: 13 suppliers, ~80 purchase orders, insights.",
                  },
                  {
                    v: false,
                    t: "Start with an empty workspace",
                    d: "Add your own suppliers, materials and requests from scratch.",
                  },
                ].map((o) => (
                  <button
                    key={String(o.v)}
                    type="button"
                    onClick={() => setDemo(o.v)}
                    aria-pressed={demo === o.v}
                    className={cn(
                      "rounded-2xl border p-4 text-left transition",
                      demo === o.v ? "border-primary/50 bg-primary/5 ring-4 ring-primary/15" : "border-input bg-white hover:border-primary/40 hover:bg-muted/60",
                    )}
                  >
                    <div className="text-lg font-semibold text-foreground">{o.t}</div>
                    <div className="mt-0.5 text-sm text-muted-foreground">{o.d}</div>
                  </button>
                ))}
              </div>
            </>
          ) : null}

          {error ? <p role="alert" className="mt-6 rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p> : null}

          <div className="mt-6 flex shrink-0 items-center justify-between">
            <button
              type="button"
              disabled={step === 0 || busy}
              onClick={() => setStep(step - 1)}
              className="rounded-lg px-4 py-2 text-sm font-semibold text-muted-foreground transition hover:text-foreground disabled:invisible"
            >
              Back
            </button>
            {step < 2 ? (
              <button type="button" className={cta} onClick={() => setStep(step + 1)} disabled={step === 0 && co.name.trim().length < 2}>
                Continue
                <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
              </button>
            ) : (
              <button type="button" className={cta} disabled={busy} onClick={() => void finish()}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Enter workspace
                {busy ? null : <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />}
              </button>
            )}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
