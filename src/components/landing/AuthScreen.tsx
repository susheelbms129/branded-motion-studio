import { ArrowRight, Check, Eye, EyeOff, Loader2, Sparkles, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { formatMoneyCompact } from "@/lib/format";

import { Logo } from "./Logo";

type Mode = "signup" | "signin";

const BARS = [38, 52, 44, 66, 58, 78, 70, 92];
const APPROVALS = [
  ["PO-2026-722", "Packaging film", 112500],
  ["PR-0412", "Hydraulic hose", 38400],
  ["PO-2026-725", "Servo drives", 326000],
] as const;

function Preview() {
  return (
    <div className="relative mt-10 w-full max-w-[440px]">
      <div className="glow-violet animate-orb absolute -inset-10 -z-10 opacity-70" />
      <div className="overflow-hidden rounded-3xl border border-white/20 bg-white shadow-[0_40px_100px_-20px_oklch(0.55_0.25_285/60%)]">
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <div>
            <p className="text-xs text-subtle-foreground">Spend this month</p>
            <p className="text-2xl font-semibold tabular text-foreground">{formatMoneyCompact(1920000)}</p>
          </div>
          <span className="tint-emerald rounded-full px-3 py-1 text-xs font-semibold">Within budget</span>
        </div>
        <div className="flex h-28 items-end gap-2 px-5 pt-4">
          {BARS.map((h, i) => (
            <span key={i} className={`bar-grow flex-1 rounded-t-lg ${i === BARS.length - 1 ? "bg-gradient-primary" : "bg-primary/20"}`} style={{ height: `${h}%`, animationDelay: `${0.3 + i * 0.07}s` }} />
          ))}
        </div>
        <ul className="mt-3 divide-y divide-border border-t border-border">
          {APPROVALS.map(([id, name, amt], i) => (
            <li key={id} className="pop-in flex items-center gap-3 px-5 py-3" style={{ animationDelay: `${0.8 + i * 0.15}s` }}>
              <span className="font-mono text-xs text-subtle-foreground">{id}</span>
              <span className="flex-1 truncate text-sm font-medium text-foreground">{name}</span>
              <span className="text-sm font-semibold tabular text-foreground">{formatMoneyCompact(amt)}</span>
              <span className="tint-amber rounded-full px-2.5 py-0.5 text-[11px] font-semibold">Review</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="animate-float absolute -right-4 -top-5 rounded-2xl border border-white/20 bg-white px-4 py-2.5 shadow-lift">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald">Saved on this order</p>
        <p className="text-xl font-semibold tabular text-foreground">₹27,370</p>
      </div>
      <div className="animate-float-slow absolute -bottom-5 -left-2 flex items-center gap-2.5 rounded-2xl border border-white/20 bg-white px-4 py-2.5 shadow-lift">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-ai text-white">
          <Sparkles className="h-4 w-4" />
        </span>
        <p className="text-sm font-semibold text-foreground">Price creep spotted</p>
      </div>
    </div>
  );
}

const input = "w-full rounded-xl border border-input bg-white px-4 py-3.5 text-base text-foreground outline-none transition placeholder:text-subtle-foreground focus:border-primary focus:ring-4 focus:ring-primary/15";

export function AuthScreen({ open, onClose, initial = "signup" }: { open: boolean; onClose: () => void; initial?: Mode }) {
  const [mode, setMode] = useState<Mode>(initial);
  const [show, setShow] = useState(false);
  const [vals, setVals] = useState({ first: "", last: "", email: "", password: "" });
  const [err, setErr] = useState<Record<string, string>>({});
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");

  useEffect(() => {
    if (open) {
      setMode(initial);
      setState("idle");
      setErr({});
    }
  }, [open, initial]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  const set = (k: keyof typeof vals) => (e: { target: { value: string } }) => setVals((v) => ({ ...v, [k]: e.target.value }));
  const pw = vals.password;
  const checks = [
    { label: "Min 12 characters", ok: pw.length >= 12 },
    { label: "Min 1 number", ok: /\d/.test(pw) },
    { label: "Mixed case", ok: /[a-z]/.test(pw) && /[A-Z]/.test(pw) },
  ];

  function submit(e: FormEvent) {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (mode === "signup") {
      if (vals.first.trim().length < 2) next.first = "Required";
      if (vals.last.trim().length < 1) next.last = "Required";
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(vals.email.trim())) next.email = "Enter a valid email address";
    if (mode === "signup" ? !checks.every((c) => c.ok) : pw.length < 1) next.password = mode === "signup" ? "Meet all three password rules" : "Enter your password";
    setErr(next);
    if (Object.keys(next).length) return;
    setState("sending");
    window.setTimeout(() => setState("done"), 900);
  }

  return (
    <div className="menu-in fixed inset-0 z-[70] flex bg-navy" role="dialog" aria-modal="true" aria-label={mode === "signup" ? "Create your Vendora account" : "Sign in to Vendora"}>
      {/* left: brand */}
      <aside className="relative hidden shrink-0 flex-col justify-center overflow-hidden bg-gradient-to-br from-navy via-navy-2 to-indigo/40 px-10 py-10 lg:flex lg:w-[40%] xl:px-14">
        <div className="bg-grid-dark mask-radial pointer-events-none absolute inset-0 opacity-60" />
        <div className="glow-blue animate-orb-slow pointer-events-none absolute -bottom-40 -left-40 h-[560px] w-[560px] opacity-60" />
        <div className="relative z-10 flex w-full max-w-[500px] flex-col items-start text-left">
          <Logo className="-ml-1 h-20 xl:h-24" />
          <h2 className="mt-8 text-4xl font-semibold leading-[1.08] text-white xl:text-5xl">
            Take <span className="grad-rupee" style={{ animation: "gradient-pan 6s ease infinite" }}>control</span> of your procurement.
          </h2>
          <p className="mt-5 max-w-md text-base leading-relaxed text-navy-muted xl:text-lg">
            Vendora brings requests, suppliers, approvals and purchase orders into one place, so you compare real landed costs and see where every rupee goes.
          </p>
          <Preview />
        </div>
      </aside>

      {/* right: form */}
      <main className="relative flex w-full flex-1 flex-col overflow-y-auto bg-white">
        <button type="button" onClick={onClose} aria-label="Close" className="absolute right-5 top-5 flex h-11 w-11 items-center justify-center rounded-full bg-muted text-foreground transition hover:rotate-90 hover:bg-accent">
          <X className="h-5 w-5" />
        </button>
        <div className="mx-auto my-auto w-full max-w-[640px] px-6 py-14 sm:px-12">
          {state === "done" ? (
            <div className="pop-in text-center">
              <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-gradient-emerald text-white shadow-glow">
                <Check className="h-8 w-8" strokeWidth={3} />
              </span>
              <h3 className="mt-6 text-3xl font-semibold text-foreground">{mode === "signup" ? `Welcome, ${vals.first.trim() || "there"}.` : "You're almost in."}</h3>
              <p className="mt-3 text-lg text-muted-foreground">
                The Vendora app opens soon. We'll email <b className="text-foreground">{vals.email}</b> the moment your workspace is ready.
              </p>
              <button type="button" onClick={onClose} className="mt-8 rounded-full bg-gradient-primary px-8 py-3.5 text-lg font-semibold text-white shadow-glow transition hover:scale-105">
                Back to the site
              </button>
            </div>
          ) : (
            <>
              <div className="lg:hidden">
                <div className="mb-8 rounded-2xl bg-navy p-3">
                  <Logo className="mx-auto h-16" />
                </div>
              </div>
              <h3 className="text-4xl font-semibold text-foreground">{mode === "signup" ? "Get Started" : "Welcome back"}</h3>
              <p className="mt-2 text-lg text-muted-foreground">{mode === "signup" ? "Create your Vendora account in under a minute." : "Sign in to pick up where you left off."}</p>

              <div className="mt-7 grid grid-cols-2 rounded-2xl bg-muted p-1.5" role="tablist">
                {(["signup", "signin"] as const).map((m) => (
                  <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => { setMode(m); setErr({}); }} className={`rounded-xl py-3 text-base font-semibold transition ${mode === m ? "bg-white text-foreground shadow-card" : "text-muted-foreground hover:text-foreground"}`}>
                    {m === "signup" ? "Sign up" : "Sign in"}
                  </button>
                ))}
              </div>

              <form onSubmit={submit} noValidate className="mt-7 space-y-5">
                {mode === "signup" ? (
                  <div className="grid grid-cols-2 gap-4">
                    <label className="block">
                      <span className="mb-1.5 block text-sm font-medium text-foreground">First name</span>
                      <input className={input} value={vals.first} onChange={set("first")} autoComplete="given-name" />
                      {err.first ? <span className="mt-1 block text-sm text-destructive">{err.first}</span> : null}
                    </label>
                    <label className="block">
                      <span className="mb-1.5 block text-sm font-medium text-foreground">Last name</span>
                      <input className={input} value={vals.last} onChange={set("last")} autoComplete="family-name" />
                      {err.last ? <span className="mt-1 block text-sm text-destructive">{err.last}</span> : null}
                    </label>
                  </div>
                ) : null}
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium text-foreground">Work email</span>
                  <input className={input} type="email" value={vals.email} onChange={set("email")} placeholder="you@company.in" autoComplete="email" />
                  {err.email ? <span className="mt-1 block text-sm text-destructive">{err.email}</span> : null}
                </label>
                <label className="block">
                  <span className="mb-1.5 flex justify-between text-sm font-medium text-foreground">
                    Password
                    {mode === "signin" ? <span className="font-normal text-primary">Forgot password?</span> : null}
                  </span>
                  <span className="relative block">
                    <input className={`${input} pr-12`} type={show ? "text" : "password"} value={vals.password} onChange={set("password")} autoComplete={mode === "signup" ? "new-password" : "current-password"} />
                    <button type="button" aria-label={show ? "Hide password" : "Show password"} onClick={() => setShow((s) => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-subtle-foreground transition hover:text-foreground">
                      {show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                    </button>
                  </span>
                  {err.password ? <span className="mt-1 block text-sm text-destructive">{err.password}</span> : null}
                </label>

                {mode === "signup" ? (
                  <div className="grid grid-cols-3 gap-3">
                    {checks.map((c) => (
                      <div key={c.label}>
                        <span className={`block h-1.5 rounded-full transition-colors duration-300 ${c.ok ? "bg-emerald" : "bg-muted"}`} />
                        <span className={`mt-1.5 block text-[11px] transition-colors ${c.ok ? "text-emerald" : "text-subtle-foreground"}`}>{c.label}</span>
                      </div>
                    ))}
                  </div>
                ) : null}

                {mode === "signup" ? <p className="text-sm text-muted-foreground">By signing up, you agree to our <span className="text-primary">Terms</span> and <span className="text-primary">Privacy Policy</span>.</p> : null}

                <button type="submit" disabled={state === "sending"} className="btn-shine group flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-cta py-4 text-lg font-semibold text-white shadow-glow transition hover:scale-[1.01] disabled:opacity-70">
                  {state === "sending" ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
                  {mode === "signup" ? "Create account" : "Sign in"}
                  {state === "sending" ? null : <ArrowRight className="h-5 w-5 transition group-hover:translate-x-1" />}
                </button>
              </form>

              <p className="mt-6 text-center text-muted-foreground">
                {mode === "signup" ? "Already have an account? " : "New to Vendora? "}
                <button type="button" onClick={() => { setMode(mode === "signup" ? "signin" : "signup"); setErr({}); }} className="font-semibold text-primary hover:underline">
                  {mode === "signup" ? "Sign in" : "Create one"}
                </button>
              </p>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
