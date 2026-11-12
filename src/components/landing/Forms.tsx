import { ArrowRight, Check, Loader2 } from "lucide-react";
import { useState, type FormEvent } from "react";

const SIZES = ["1–10 people", "11–50 people", "51–200 people", "200+ people"];

interface Errors {
  name?: string;
  email?: string;
  company?: string;
}

const field =
  "w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3.5 text-base text-white placeholder:text-white/40 outline-none transition focus:border-violet focus:bg-white/10 focus:ring-4 focus:ring-violet/20";

export function DemoForm({ intent = "demo", compact = false }: { intent?: "demo" | "login"; compact?: boolean }) {
  const [vals, setVals] = useState({ name: "", email: "", company: "", size: SIZES[1] ?? "" });
  const [errors, setErrors] = useState<Errors>({});
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");

  const set = (k: keyof typeof vals) => (e: { target: { value: string } }) => setVals((v) => ({ ...v, [k]: e.target.value }));

  function submit(e: FormEvent) {
    e.preventDefault();
    const next: Errors = {};
    if (vals.name.trim().length < 2) next.name = "Please tell us your name.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(vals.email.trim())) next.email = "That email doesn't look right.";
    if (vals.company.trim().length < 2) next.company = "Which company are you buying for?";
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setState("sending");
    window.setTimeout(() => setState("done"), 900);
  }

  if (state === "done") {
    return (
      <div className="pop-in flex flex-col items-center py-10 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-emerald text-white shadow-glow">
          <Check className="h-8 w-8" strokeWidth={3} />
        </span>
        <h3 className="mt-6 text-2xl font-semibold text-white">You're on the list, {vals.name.split(" ")[0]}.</h3>
        <p className="mt-2 max-w-sm text-navy-muted">
          {intent === "login" ? "Sign-in opens with the app launch. We'll write to " : "We'll reach out to "}
          <span className="text-white">{vals.email}</span> to set up your walkthrough.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4 text-left">
      <div className={compact ? "space-y-4" : "grid gap-4 sm:grid-cols-2"}>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-white/80">Your name</span>
          <input className={field} value={vals.name} onChange={set("name")} placeholder="Priya Nair" autoComplete="name" aria-invalid={!!errors.name} />
          {errors.name ? <span className="mt-1 block text-sm text-coral">{errors.name}</span> : null}
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-white/80">Work email</span>
          <input className={field} type="email" value={vals.email} onChange={set("email")} placeholder="priya@company.in" autoComplete="email" aria-invalid={!!errors.email} />
          {errors.email ? <span className="mt-1 block text-sm text-coral">{errors.email}</span> : null}
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-white/80">Company</span>
          <input className={field} value={vals.company} onChange={set("company")} placeholder="Your company name" autoComplete="organization" aria-invalid={!!errors.company} />
          {errors.company ? <span className="mt-1 block text-sm text-coral">{errors.company}</span> : null}
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-white/80">Team size</span>
          <select className={`${field} appearance-none`} value={vals.size} onChange={set("size")}>
            {SIZES.map((s) => (
              <option key={s} value={s} className="bg-navy-2 text-white">
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>
      <button
        type="submit"
        disabled={state === "sending"}
        className="btn-shine group inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-cta px-6 py-4 text-lg font-semibold text-white shadow-glow transition hover:scale-[1.01] disabled:opacity-70"
      >
        {state === "sending" ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
        {intent === "login" ? "Join the early-access list" : "Book my walkthrough"}
        {state === "sending" ? null : <ArrowRight className="h-5 w-5 transition group-hover:translate-x-1" />}
      </button>
    </form>
  );
}
