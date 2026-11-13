import { Link } from "@tanstack/react-router";
import { ArrowRight, Boxes, Check, Eye, EyeOff, FileText, Loader2, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { signInWithEmail, signInWithProvider, signUpWithEmail } from "@/lib/auth";
import { formatMoneyCompact } from "@/lib/format";

import { Logo } from "./Logo";

export type AuthMode = "signup" | "signin";
export type AuthVariant = "buyer" | "supplier";

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

function SupplierPreview() {
  const rows = [
    ["RFQ-2026-118", "Hydraulic hose, 300 m", "Sharma Precision"],
    ["RFQ-2026-121", "Packaging film, 2 t", "Kaveri Foods"],
  ] as const;
  return (
    <div className="relative mt-10 w-full max-w-[440px]">
      <div className="glow-emerald animate-orb absolute -inset-10 -z-10 opacity-60" />
      <div className="overflow-hidden rounded-3xl border border-white/20 bg-white shadow-[0_40px_100px_-20px_oklch(0.6_0.15_162/50%)]">
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <div>
            <p className="text-xs text-subtle-foreground">Quote requests this week</p>
            <p className="text-2xl font-semibold tabular text-foreground">12</p>
          </div>
          <span className="tint-emerald rounded-full px-3 py-1 text-xs font-semibold">3 need a quote</span>
        </div>
        <ul className="divide-y divide-border">
          {rows.map(([id, item, buyer], i) => (
            <li key={id} className="pop-in flex items-center gap-3 px-5 py-4" style={{ animationDelay: `${0.4 + i * 0.15}s` }}>
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-emerald text-white">
                <FileText className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-foreground">{item}</span>
                <span className="block truncate text-xs text-subtle-foreground">{id} from {buyer}</span>
              </span>
              <span className="tint-amber rounded-full px-2.5 py-0.5 text-[11px] font-semibold">Open</span>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-3 border-t border-border bg-muted/50 px-5 py-3.5">
          <Boxes className="h-5 w-5 text-emerald" />
          <p className="text-sm text-muted-foreground">Your catalogue is visible to verified buyers.</p>
        </div>
      </div>
    </div>
  );
}

function AppleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="currentColor">
      <path d="M16.37 12.62c-.02-2.18 1.78-3.23 1.86-3.28-1.01-1.48-2.59-1.69-3.15-1.71-1.34-.14-2.62.79-3.3.79-.68 0-1.73-.77-2.84-.75-1.46.02-2.81.85-3.56 2.16-1.52 2.64-.39 6.55 1.09 8.69.72 1.05 1.59 2.22 2.72 2.18 1.09-.04 1.5-.7 2.82-.7 1.31 0 1.69.7 2.84.68 1.17-.02 1.92-1.07 2.64-2.12.83-1.21 1.17-2.38 1.19-2.44-.03-.01-2.28-.88-2.31-3.5ZM14.2 6.2c.6-.73 1-1.74.89-2.75-.86.04-1.9.57-2.52 1.3-.55.64-1.04 1.67-.91 2.66.96.07 1.94-.49 2.54-1.21Z" />
    </svg>
  );
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path fill="#4285F4" d="M23.04 12.26c0-.82-.07-1.6-.21-2.36H12v4.46h6.19a5.3 5.3 0 0 1-2.3 3.48v2.89h3.72c2.18-2 3.43-4.96 3.43-8.47Z" />
      <path fill="#34A853" d="M12 23.5c3.1 0 5.7-1.03 7.6-2.79l-3.72-2.89c-1.03.69-2.35 1.1-3.88 1.1-2.98 0-5.5-2.01-6.4-4.72H1.76v2.98A11.5 11.5 0 0 0 12 23.5Z" />
      <path fill="#FBBC05" d="M5.6 14.2a6.9 6.9 0 0 1 0-4.4V6.82H1.76a11.5 11.5 0 0 0 0 10.36L5.6 14.2Z" />
      <path fill="#EA4335" d="M12 5.08c1.69 0 3.2.58 4.39 1.72l3.3-3.3C17.7 1.64 15.1.5 12 .5A11.5 11.5 0 0 0 1.76 6.82L5.6 9.8c.9-2.71 3.42-4.72 6.4-4.72Z" />
    </svg>
  );
}

const input = "w-full rounded-xl border border-input bg-white px-4 py-3.5 text-base text-foreground outline-none transition placeholder:text-subtle-foreground focus:border-primary focus:ring-4 focus:ring-primary/15";
/** Shared by the signup panel and onboarding so every input looks identical. */
export const authInputClass = input;

export function AuthScreen({ open, mode, variant = "buyer", onModeChange, onClose, onAuthed }: { open: boolean; mode: AuthMode; variant?: AuthVariant; onModeChange: (m: AuthMode) => void; onClose: () => void; onAuthed: () => void }) {
  const supplier = variant === "supplier";
  const [show, setShow] = useState(false);
  const [vals, setVals] = useState({ first: "", last: "", email: "", password: "" });
  const [err, setErr] = useState<Record<string, string>>({});
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [via, setVia] = useState<"Apple" | "Google" | null>(null);

  useEffect(() => {
    if (open) {
      setState("idle");
      setVia(null);
      setErr({});
    }
  }, [open]);

  // Desktop: the form never scrolls. If it is taller than the window it is scaled down to fit.
  const box = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(1);
  useEffect(() => {
    if (!open) return;
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const h = el.offsetHeight;
      setFit(window.innerWidth >= 1024 && h > 0 ? Math.min(1, window.innerHeight / h) : 1);
    };
    measure();
    window.addEventListener("resize", measure);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      window.removeEventListener("resize", measure);
      ro.disconnect();
    };
  }, [open, mode, state]);

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
    { label: "Min 8 characters", ok: pw.length >= 8 },
    { label: "Min 1 number", ok: /\d/.test(pw) },
    { label: "Mixed case", ok: /[a-z]/.test(pw) && /[A-Z]/.test(pw) },
  ];

  async function submit(e: FormEvent) {
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
    setVia(null);
    setState("sending");
    const email = vals.email.trim();
    const res =
      mode === "signup"
        ? await signUpWithEmail(
            { name: `${vals.first.trim()} ${vals.last.trim()}`.trim(), email, password: vals.password, accountType: variant },
            { redirectPath: supplier ? "/supplier/onboarding" : "/buyer/onboarding" },
          )
        : await signInWithEmail(email, vals.password, variant);
    if (!res.ok) {
      setState("idle");
      setErr({ form: res.message });
      return;
    }
    if (res.needsConfirm) {
      setState("done");
      return;
    }
    onAuthed();
  }

  async function social(provider: "Apple" | "Google") {
    if (state === "sending") return;
    setErr({});
    setVia(provider);
    setState("sending");
    const res = await signInWithProvider(
      provider === "Apple" ? "apple" : "google",
      supplier ? (mode === "signup" ? "/supplier/onboarding" : "/supplier/dashboard") : mode === "signup" ? "/buyer/onboarding" : "/app",
      // Only a brand-new sign-up records which kind of account this is.
      mode === "signup" ? variant : undefined,
    );
    if (!res.ok) {
      setState("idle");
      setVia(null);
      setErr({ form: res.message });
    }
  }

  return (
    <div className="menu-in fixed inset-0 z-[70] flex bg-navy" role="dialog" aria-modal="true" aria-label={mode === "signup" ? (supplier ? "Create your Vendora supplier account" : "Create your Vendora account") : "Sign in to Vendora"}>
      {/* left: brand */}
      <aside className="relative hidden shrink-0 flex-col justify-center overflow-hidden bg-gradient-to-br from-navy via-navy-2 to-indigo/40 px-10 py-10 lg:flex lg:w-1/2 xl:px-16">
        <div className="bg-grid-dark mask-radial pointer-events-none absolute inset-0 opacity-60" />
        <div className="glow-blue animate-orb-slow pointer-events-none absolute -bottom-40 -left-40 h-[560px] w-[560px] opacity-60" />
        <div className="relative z-10 mx-auto flex w-full max-w-[480px] flex-col items-start text-left">
          <Logo className="-ml-1 h-20 xl:h-24" />
          {supplier ? (
            <>
              <h2 className="mt-8 text-4xl font-semibold leading-[1.08] text-white xl:text-5xl">
                Win <span className="grad-rupee" style={{ animation: "gradient-pan 6s ease infinite" }}>orders</span> from businesses that are ready to buy.
              </h2>
              <p className="mt-5 max-w-md text-base leading-relaxed text-navy-muted xl:text-lg">
                List your products, answer quote requests and track purchase orders from the buyers you work with, all in one supplier workspace.
              </p>
              <SupplierPreview />
            </>
          ) : (
            <>
              <h2 className="mt-8 text-4xl font-semibold leading-[1.08] text-white xl:text-5xl">
                Take <span className="grad-rupee" style={{ animation: "gradient-pan 6s ease infinite" }}>control</span> of your procurement.
              </h2>
              <p className="mt-5 max-w-md text-base leading-relaxed text-navy-muted xl:text-lg">
                Vendora brings requests, suppliers, approvals and purchase orders into one place, so you compare real landed costs and see where every rupee goes.
              </p>
              <Preview />
            </>
          )}
        </div>
      </aside>

      {/* right: form */}
      <main className="relative flex w-full flex-1 flex-col overflow-y-auto bg-white lg:w-1/2 lg:flex-none lg:items-center lg:justify-center lg:overflow-hidden xl:px-16">
        <button type="button" onClick={onClose} aria-label="Close" className="absolute right-5 top-5 flex h-11 w-11 items-center justify-center rounded-full bg-muted text-foreground transition hover:rotate-90 hover:bg-accent">
          <X className="h-5 w-5" />
        </button>
        <div ref={box} className="mx-auto my-auto w-full max-w-[480px] px-6 py-10 sm:px-0 lg:my-0" style={{ transform: fit < 1 ? `scale(${fit})` : undefined, transformOrigin: "center" }}>
          {state === "done" ? (
            <div className="pop-in text-center">
              <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-gradient-emerald text-white shadow-glow">
                <Check className="h-8 w-8" strokeWidth={3} />
              </span>
              <h3 className="mt-6 text-3xl font-semibold text-foreground">Check your email</h3>
              <p className="mt-3 text-lg text-muted-foreground">
                If this address can be registered, we've sent a confirmation link to <b className="text-foreground">{vals.email.trim()}</b>. Open it to activate your account, then sign in.
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
              <span className={`mb-4 inline-block rounded-full px-3 py-1 text-sm font-semibold ${supplier ? "tint-emerald" : "tint-violet"}`}>{supplier ? "Supplier account" : "Buyer account"}</span>
              <h3 className="text-4xl font-semibold text-foreground">{mode === "signup" ? (supplier ? "Create your supplier account" : "Create your buyer account") : (supplier ? "Welcome back, supplier" : "Welcome back")}</h3>
              <p className="mt-2 text-lg text-muted-foreground">{mode === "signup" ? "Takes under a minute. You'll set up your business next." : (supplier ? "Sign in to your supplier workspace." : "Sign in to your business workspace.")}</p>

              <div className="mt-7 grid grid-cols-2 rounded-2xl bg-muted p-1.5" role="tablist">
                {(["signup", "signin"] as const).map((m) => (
                  <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => { onModeChange(m); setErr({}); }} className={`rounded-xl py-3 text-base font-semibold transition ${mode === m ? "bg-white text-foreground shadow-card" : "text-muted-foreground hover:text-foreground"}`}>
                    {m === "signup" ? "Sign up" : "Sign in"}
                  </button>
                ))}
              </div>

              <div className="mt-6 space-y-3">
                {(
                  [
                    ["Apple", AppleIcon],
                    ["Google", GoogleIcon],
                  ] as const
                ).map(([name, Icon]) => (
                  <button
                    key={name}
                    type="button"
                    disabled={state === "sending"}
                    onClick={() => social(name)}
                    className="flex w-full items-center justify-center gap-3 rounded-xl border border-input bg-white py-3.5 text-base font-medium text-foreground shadow-card transition hover:-translate-y-0.5 hover:border-primary/40 hover:bg-muted/60 disabled:opacity-60"
                  >
                    <Icon className="h-5 w-5" />
                    Continue with {name}
                  </button>
                ))}
              </div>

              <div className="my-6 flex items-center gap-4 text-sm text-subtle-foreground">
                <span className="h-px flex-1 bg-border" />
                or
                <span className="h-px flex-1 bg-border" />
              </div>

              <form onSubmit={submit} noValidate className="space-y-5">
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
                  <span className="mb-1.5 block text-sm font-medium text-foreground">{supplier ? "Business email" : "Work email"}</span>
                  <input className={input} type="email" value={vals.email} onChange={set("email")} placeholder={supplier ? "you@yourbusiness.in" : "you@company.in"} autoComplete="email" />
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

                {err.form ? <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">{err.form}</p> : null}

                <button type="submit" disabled={state === "sending"} className={`btn-shine group flex w-full items-center justify-center gap-2 rounded-xl ${supplier ? "bg-gradient-emerald" : "bg-gradient-cta"} py-4 text-lg font-semibold text-white shadow-glow transition hover:scale-[1.01] disabled:opacity-70`}>
                  {state === "sending" ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
                  {mode === "signup" ? "Create account" : "Sign in"}
                  {state === "sending" ? null : <ArrowRight className="h-5 w-5 transition group-hover:translate-x-1" />}
                </button>
              </form>

              <p className="mt-6 text-center text-muted-foreground">
                {mode === "signup" ? "Already have an account? " : "New to Vendora? "}
                <button type="button" onClick={() => { onModeChange(mode === "signup" ? "signin" : "signup"); setErr({}); }} className="font-semibold text-primary hover:underline">
                  {mode === "signup" ? "Sign in" : "Create one"}
                </button>
              </p>
              <p className="mt-3 text-center text-sm text-muted-foreground">
                {supplier ? "Looking to buy? " : "Selling to businesses? "}
                <Link to={supplier ? (mode === "signup" ? "/buyer/signup" : "/buyer/signin") : mode === "signup" ? "/supplier/signup" : "/supplier/signin"} replace className="font-semibold text-primary hover:underline">
                  {supplier ? (mode === "signup" ? "Create a buyer account" : "Buyer sign in") : mode === "signup" ? "Create a supplier account" : "Supplier sign in"}
                </Link>
              </p>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
