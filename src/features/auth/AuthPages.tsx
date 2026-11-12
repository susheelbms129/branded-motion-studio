import { zodResolver } from "@hookform/resolvers/zod";
import { Link, useNavigate } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { ArrowRight, Check, Sparkles } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { VendoraLogo } from "@/components/vendora/Logo";
import { cn } from "@/lib/utils";
import { useUi } from "@/lib/ui-store";
import { useWs } from "@/lib/ws-store";

function AuthFrame({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-gradient-navy bg-grid-dark p-12 text-navy-foreground lg:flex lg:flex-col lg:justify-between">
        <div className="glow-violet absolute -right-20 top-10 size-96 animate-orb opacity-60" />
        <div className="glow-blue absolute -left-20 bottom-0 size-96 animate-orb-slow opacity-60" />
        <Link to="/" className="relative">
          <VendoraLogo height={34} />
        </Link>
        <div className="relative max-w-md">
          <h2 className="text-4xl font-semibold leading-tight tracking-tight">
            Smarter buying.
            <br />
            <span className="text-gradient-brand-dark">Greater business.</span>
          </h2>
          <ul className="mt-8 space-y-3 text-sm text-navy-muted">
            {[
              "Approvals, RFQs and POs in one flow",
              "Compare quotes on true landed cost",
              "Supplier scores from real delivery records",
            ].map((t) => (
              <li key={t} className="flex items-center gap-2">
                <span className="grid size-5 place-items-center rounded-full bg-emerald/20 text-emerald">
                  <Check className="size-3" />
                </span>
                {t}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-navy-muted">© {new Date().getFullYear()} Vendora</p>
      </div>
      <div className="flex items-center justify-center bg-background px-6 py-12">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-sm"
        >
          <Link to="/" className="mb-8 inline-flex rounded-lg bg-navy px-3 py-2 lg:hidden">
            <VendoraLogo height={26} />
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
          <div className="mt-6">{children}</div>
          <p className="mt-6 text-center text-sm text-muted-foreground">{footer}</p>
        </motion.div>
      </div>
    </div>
  );
}

const Err = ({ m }: { m?: string | undefined }) =>
  m ? <p className="mt-1 text-xs text-destructive">{m}</p> : null;

export function LoginPage() {
  const nav = useNavigate();
  const { signIn, onboarded, finishOnboarding } = useUi();
  const reset = useWs((s) => s.reset);
  const f = useForm<{ email: string; password: string }>({
    resolver: zodResolver(
      z.object({
        email: z.string().email("Enter a valid email"),
        password: z.string().min(6, "At least 6 characters"),
      }),
    ) as never,
  });
  const demo = () => {
    signIn({
      name: "Aarav Sharma",
      email: "aarav@sharmaprecision.in",
      company: "Sharma Precision Industries",
    });
    finishOnboarding(true);
    reset(true);
    void nav({ to: "/app" });
  };
  return (
    <AuthFrame
      title="Welcome back"
      subtitle="Sign in to your procurement workspace."
      footer={
        <>
          New to Vendora?{" "}
          <Link to="/signup" className="font-medium text-primary hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={f.handleSubmit((v) => {
          signIn({
            name: v.email.split("@")[0]!.replace(/[._]/g, " "),
            email: v.email,
            company: "My Company",
          });
          void nav({ to: onboarded ? "/app" : "/onboarding" });
        })}
      >
        <div>
          <Label htmlFor="email">Work email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            className="mt-1.5"
            {...f.register("email")}
          />
          <Err m={f.formState.errors.email?.message} />
        </div>
        <div>
          <Label htmlFor="pw">Password</Label>
          <Input
            id="pw"
            type="password"
            autoComplete="current-password"
            className="mt-1.5"
            {...f.register("password")}
          />
          <Err m={f.formState.errors.password?.message} />
        </div>
        <Button type="submit" className="w-full" size="lg">
          Sign in
        </Button>
      </form>
      <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        or
        <span className="h-px flex-1 bg-border" />
      </div>
      <Button variant="outline" className="w-full" size="lg" onClick={demo}>
        <Sparkles />
        Explore the demo workspace
      </Button>
    </AuthFrame>
  );
}

export function SignupPage() {
  const nav = useNavigate();
  const signIn = useUi((s) => s.signIn);
  const f = useForm<{ name: string; company: string; email: string; password: string }>({
    resolver: zodResolver(
      z.object({
        name: z.string().min(2, "Enter your name"),
        company: z.string().min(2, "Enter your company"),
        email: z.string().email("Enter a valid email"),
        password: z.string().min(8, "At least 8 characters"),
      }),
    ) as never,
  });
  const e = f.formState.errors;
  return (
    <AuthFrame
      title="Create your account"
      subtitle="Free to start. No card required."
      footer={
        <>
          Already have an account?{" "}
          <Link to="/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={f.handleSubmit((v) => {
          signIn({ name: v.name, email: v.email, company: v.company });
          void nav({ to: "/onboarding" });
        })}
      >
        <div>
          <Label htmlFor="n">Full name</Label>
          <Input id="n" className="mt-1.5" {...f.register("name")} />
          <Err m={e.name?.message} />
        </div>
        <div>
          <Label htmlFor="c">Company</Label>
          <Input id="c" className="mt-1.5" {...f.register("company")} />
          <Err m={e.company?.message} />
        </div>
        <div>
          <Label htmlFor="e">Work email</Label>
          <Input id="e" type="email" className="mt-1.5" {...f.register("email")} />
          <Err m={e.email?.message} />
        </div>
        <div>
          <Label htmlFor="p">Password</Label>
          <Input
            id="p"
            type="password"
            autoComplete="new-password"
            className="mt-1.5"
            {...f.register("password")}
          />
          <Err m={e.password?.message} />
        </div>
        <Button type="submit" className="w-full" size="lg">
          Create account
          <ArrowRight />
        </Button>
      </form>
    </AuthFrame>
  );
}

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
  const finish = () => {
    finishOnboarding(demo);
    reset(demo);
    if (!demo) updateOrg({ name: co.name || "My Workspace", industry: co.industry, city: co.city });
    void nav({ to: "/app" });
  };
  return (
    <div className="flex min-h-screen flex-col items-center bg-gradient-lavender px-4 py-10">
      <Link to="/" className="mb-8 rounded-xl bg-navy px-4 py-2">
        <VendoraLogo height={28} />
      </Link>
      <div className="w-full max-w-xl">
        <ol className="mb-6 flex items-center gap-2" aria-label="Progress">
          {STEPS.map((s, i) => (
            <li key={s} className="flex flex-1 items-center gap-2">
              <span
                className={cn(
                  "grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold",
                  i <= step
                    ? "bg-gradient-primary text-on-brand"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {i < step ? <Check className="size-3.5" /> : i + 1}
              </span>
              <span
                className={cn(
                  "hidden text-xs sm:block",
                  i === step ? "font-medium" : "text-muted-foreground",
                )}
              >
                {s}
              </span>
              {i < 2 ? <span className="h-px flex-1 bg-border" /> : null}
            </li>
          ))}
        </ol>
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          className="rounded-3xl border bg-card p-6 shadow-lift sm:p-8"
        >
          {step === 0 ? (
            <>
              <h1 className="text-xl font-semibold">Tell us about your company</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                This appears on your purchase orders.
              </p>
              <div className="mt-5 space-y-4">
                <div>
                  <Label htmlFor="co">Company name</Label>
                  <Input
                    id="co"
                    className="mt-1.5"
                    value={co.name}
                    onChange={(e) => setCo({ ...co, name: e.target.value })}
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="ind">Industry</Label>
                    <Input
                      id="ind"
                      className="mt-1.5"
                      value={co.industry}
                      onChange={(e) => setCo({ ...co, industry: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label htmlFor="city">City</Label>
                    <Input
                      id="city"
                      className="mt-1.5"
                      placeholder="Pune"
                      value={co.city}
                      onChange={(e) => setCo({ ...co, city: e.target.value })}
                    />
                  </div>
                </div>
              </div>
            </>
          ) : null}
          {step === 1 ? (
            <>
              <h1 className="text-xl font-semibold">What do you mostly buy?</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Pick your main categories — we'll set up budgets and suppliers around them.
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                {CATS.map((c) => {
                  const on = cats.includes(c);
                  return (
                    <button
                      key={c}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setCats(on ? cats.filter((x) => x !== c) : [...cats, c])}
                      className={cn(
                        "rounded-full border px-4 py-2 text-sm transition",
                        on ? "border-primary/40 bg-primary/10 text-primary" : "hover:bg-accent",
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
              <h1 className="text-xl font-semibold">How would you like to start?</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                You can switch any time from the top bar.
              </p>
              <div className="mt-5 grid gap-3">
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
                      demo === o.v
                        ? "border-primary/50 bg-primary/5 ring-2 ring-primary/20"
                        : "hover:bg-accent/50",
                    )}
                  >
                    <div className="font-medium">{o.t}</div>
                    <div className="mt-0.5 text-sm text-muted-foreground">{o.d}</div>
                  </button>
                ))}
              </div>
            </>
          ) : null}
          <div className="mt-8 flex items-center justify-between">
            <Button variant="ghost" disabled={step === 0} onClick={() => setStep(step - 1)}>
              Back
            </Button>
            {step < 2 ? (
              <Button
                onClick={() => setStep(step + 1)}
                disabled={step === 0 && co.name.trim().length < 2}
              >
                Continue
                <ArrowRight />
              </Button>
            ) : (
              <Button variant="hero" size="lg" onClick={finish}>
                Enter workspace
                <ArrowRight />
              </Button>
            )}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
