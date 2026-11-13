import { Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import {
  ArrowRight,
  BarChart3,
  Check,
  ClipboardCheck,
  FileSpreadsheet,
  IndianRupee,
  Menu,
  ReceiptText,
  Scale,
  ShieldCheck,
  Sparkles,
  Truck,
  Users,
  X,
} from "lucide-react";
import { useState } from "react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { VendoraLogo } from "@/components/vendora/Logo";
import { cn } from "@/lib/utils";

const fade = {
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-60px" },
  transition: { duration: 0.55, ease: [0.2, 0.8, 0.2, 1] as const },
};

const NAV = [
  ["Benefits", "#benefits"],
  ["How it works", "#how"],
  ["Features", "#features"],
  ["Pricing", "#pricing"],
  ["FAQ", "#faq"],
] as const;

function Nav() {
  const [open, setOpen] = useState(false);
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-navy-foreground/10 bg-navy/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
        <Link to="/" aria-label="Vendora home">
          <VendoraLogo height={32} />
        </Link>
        <nav className="hidden items-center gap-7 md:flex" aria-label="Primary">
          {NAV.map(([l, h]) => (
            <a
              key={h}
              href={h}
              className="text-sm text-navy-muted transition hover:text-navy-foreground"
            >
              {l}
            </a>
          ))}
        </nav>
        <div className="hidden items-center gap-2 md:flex">
          <Button variant="ghost-dark" asChild>
            <Link to="/buyer/signin">Sign in</Link>
          </Button>
          <Button variant="hero" asChild>
            <Link to="/buyer/signup">Start free</Link>
          </Button>
        </div>
        <button
          className="text-navy-foreground md:hidden"
          onClick={() => setOpen(!open)}
          aria-label="Toggle menu"
          aria-expanded={open}
        >
          {open ? <X /> : <Menu />}
        </button>
      </div>
      {open ? (
        <div className="space-y-1 border-t border-navy-foreground/10 bg-navy px-4 py-3 md:hidden">
          {NAV.map(([l, h]) => (
            <a
              key={h}
              href={h}
              onClick={() => setOpen(false)}
              className="block rounded-lg px-3 py-2 text-sm text-navy-muted hover:bg-navy-foreground/5"
            >
              {l}
            </a>
          ))}
          <div className="flex gap-2 pt-2">
            <Button variant="glass" asChild className="flex-1">
              <Link to="/buyer/signin">Sign in</Link>
            </Button>
            <Button variant="hero" asChild className="flex-1">
              <Link to="/buyer/signup">Start free</Link>
            </Button>
          </div>
        </div>
      ) : null}
    </header>
  );
}

function PreviewCard() {
  const bars = [38, 52, 44, 66, 58, 74, 62, 88, 70, 96, 84, 110];
  return (
    <motion.div
      initial={{ opacity: 0, y: 40, rotateX: 12 }}
      animate={{ opacity: 1, y: 0, rotateX: 0 }}
      transition={{ duration: 0.9, delay: 0.3 }}
      className="relative mx-auto mt-14 w-full max-w-5xl [perspective:1400px]"
    >
      <div className="glow-blue absolute -inset-10 -z-10 opacity-50 blur-2xl" />
      <div className="glass-dark overflow-hidden rounded-3xl shadow-lift">
        <div className="flex items-center gap-1.5 border-b border-navy-foreground/10 px-4 py-3">
          <span className="size-2.5 rounded-full bg-coral" />
          <span className="size-2.5 rounded-full bg-amber" />
          <span className="size-2.5 rounded-full bg-emerald" />
          <span className="ml-3 text-xs text-navy-muted">vendora.app / dashboard</span>
        </div>
        <div className="grid gap-4 p-4 sm:p-6 lg:grid-cols-[1fr_260px]">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ["Spend this month", "₹18.4L", "bg-gradient-indigo"],
                ["Awaiting approval", "7", "bg-gradient-blue"],
                ["Open RFQs", "5", "bg-gradient-purple"],
                ["Overdue", "2", "bg-gradient-amber"],
              ].map(([k, v, c]) => (
                <div key={k} className="rounded-2xl bg-navy-foreground/5 p-3">
                  <div className={cn("mb-2 size-6 rounded-lg", c)} />
                  <div className="text-[11px] text-navy-muted">{k}</div>
                  <div className="text-lg font-semibold text-navy-foreground tabular">{v}</div>
                </div>
              ))}
            </div>
            <div className="rounded-2xl bg-navy-foreground/5 p-4">
              <div className="mb-3 text-xs text-navy-muted">Monthly spend</div>
              <div className="flex h-32 items-end gap-2">
                {bars.map((h, i) => (
                  <motion.div
                    key={i}
                    initial={{ height: 0 }}
                    animate={{ height: h }}
                    transition={{ delay: 0.8 + i * 0.05, duration: 0.6 }}
                    className="flex-1 rounded-t-md bg-gradient-primary"
                  />
                ))}
              </div>
            </div>
          </div>
          <div className="space-y-3">
            <div className="rounded-2xl bg-navy-foreground/5 p-3">
              <div className="mb-2 flex items-center gap-1.5 text-xs text-navy-muted">
                <Sparkles className="size-3.5 text-magenta" />
                AI insight
              </div>
              <div className="text-sm font-medium text-navy-foreground">
                MS Plate 6mm is 12% costlier
              </div>
              <div className="mt-1 text-xs text-navy-muted">
                Last 3 orders vs prior average. Evidence attached.
              </div>
            </div>
            <div className="rounded-2xl bg-navy-foreground/5 p-3">
              <div className="mb-2 text-xs text-navy-muted">Best quote</div>
              <div className="text-sm font-medium text-navy-foreground">Shree Balaji Steel</div>
              <div className="mt-1 text-lg font-semibold text-emerald tabular">₹4,82,300</div>
              <div className="text-xs text-navy-muted">Lowest landed cost · 7 days</div>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

const BENEFITS = [
  {
    icon: IndianRupee,
    t: "Save on every order",
    d: "Compare quotes on true landed cost — goods, GST, freight and charges — not just unit price.",
    c: "bg-gradient-emerald",
  },
  {
    icon: ShieldCheck,
    t: "Control without friction",
    d: "Approval rules by amount and category keep spend accountable while requests keep moving.",
    c: "bg-gradient-blue",
  },
  {
    icon: Truck,
    t: "Know your suppliers",
    d: "Scores built only from real deliveries, quotes and response times. Never invented.",
    c: "bg-gradient-amber",
  },
  {
    icon: Sparkles,
    t: "Insights with evidence",
    d: "Price spikes, repeat delays and duplicate requests — each linked to the records behind it.",
    c: "bg-gradient-ai",
  },
];
const STEPS = [
  {
    icon: ClipboardCheck,
    t: "Request",
    d: "Anyone raises a purchase request from your materials catalogue.",
  },
  {
    icon: ShieldCheck,
    t: "Approve",
    d: "Routed to the right approvers by your rules, with comments and a full trail.",
  },
  {
    icon: FileSpreadsheet,
    t: "Quote",
    d: "Convert to an RFQ, invite suppliers and record their quotations.",
  },
  {
    icon: Scale,
    t: "Compare & award",
    d: "Rank quotes on your weights and award the best offer in one click.",
  },
  {
    icon: ReceiptText,
    t: "Order & track",
    d: "A purchase order is issued and tracked through delivery and invoice match.",
  },
];
const FEATURES = [
  {
    icon: ClipboardCheck,
    t: "Purchase requests",
    d: "Multi-level approvals, priorities and attachments.",
    c: "bg-gradient-blue",
  },
  {
    icon: FileSpreadsheet,
    t: "RFQs & quote comparison",
    d: "Side-by-side landed cost with adjustable weights.",
    c: "bg-gradient-purple",
  },
  {
    icon: ReceiptText,
    t: "Purchase orders",
    d: "Issue, acknowledge, receive and close with history.",
    c: "bg-gradient-emerald",
  },
  {
    icon: Truck,
    t: "Supplier management",
    d: "Contacts, GSTIN, terms and performance scores.",
    c: "bg-gradient-amber",
  },
  {
    icon: BarChart3,
    t: "Spend analytics",
    d: "Trends, category and supplier splits, budgets, price history.",
    c: "bg-gradient-indigo",
  },
  {
    icon: Users,
    t: "Roles & permissions",
    d: "Owner, Procurement, Finance, Approver and Employee roles.",
    c: "bg-gradient-cyan",
  },
];
const PLANS = [
  {
    n: "Starter",
    p: "₹0",
    u: "forever",
    d: "For small teams getting started",
    f: ["Up to 3 users", "25 purchase orders / month", "Requests, RFQs & POs", "Basic analytics"],
    cta: "Start free",
  },
  {
    n: "Growth",
    p: "₹4,999",
    u: "per month",
    d: "For growing purchasing teams",
    f: [
      "Up to 25 users",
      "Unlimited purchase orders",
      "AI insights with evidence",
      "Approval rules & budgets",
      "Priority support",
    ],
    cta: "Start 14-day trial",
    hot: true,
  },
  {
    n: "Enterprise",
    p: "Custom",
    u: "",
    d: "For multi-plant organisations",
    f: [
      "Unlimited users",
      "SSO & audit logs",
      "ERP & Tally integrations",
      "Dedicated success manager",
    ],
    cta: "Talk to sales",
  },
];
const FAQ = [
  [
    "Is the demo data real?",
    "No. The company, people and amounts in the demo workspace are invented samples so you can explore every screen safely. You can switch to an empty workspace at any time.",
  ],
  [
    "How is total landed cost calculated?",
    "Price × quantity, plus GST on goods, plus shipping and any other charges. The comparison then ranks quotes using cost, delivery time, payment terms and supplier performance with weights you control.",
  ],
  [
    "Where do supplier scores come from?",
    "Only from your own records: on-time delivery from purchase orders, price versus competing quotes, and RFQ response rate. A supplier with too little history shows no score instead of a guess.",
  ],
  [
    "Does it handle GST?",
    "Yes. Every material carries its HSN code and GST rate, and purchase orders apply the correct rate per line. Amounts use Indian digit grouping, such as ₹1,25,000.",
  ],
  [
    "Can I control who approves what?",
    "Yes. Set rules by amount or category, add a second finance level above a threshold, and give each person a role with exactly the permissions they need.",
  ],
  [
    "Can I export my data?",
    "Requests, purchase orders and spend by supplier export to CSV from their pages.",
  ],
] as const;

export function Landing() {
  return (
    <div className="bg-background">
      <Nav />
      <section className="relative overflow-hidden bg-gradient-navy bg-grid-dark px-4 pb-24 pt-32 text-navy-foreground sm:px-6">
        <div className="glow-violet absolute -right-24 top-20 size-[28rem] animate-orb opacity-50" />
        <div className="glow-blue absolute -left-24 top-40 size-[28rem] animate-orb-slow opacity-50" />
        <div className="glow-cyan absolute bottom-0 left-1/2 size-96 -translate-x-1/2 animate-orb opacity-30" />
        <div className="relative mx-auto max-w-4xl text-center">
          <motion.span
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-dark inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs text-navy-muted"
          >
            <Sparkles className="size-3.5 text-cyan" />
            Procurement built for Indian businesses
          </motion.span>
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="mt-6 text-4xl font-semibold leading-[1.08] tracking-tight sm:text-6xl"
          >
            Smarter buying.
            <br />
            <span className="text-gradient-brand-dark animate-gradient-pan">Greater business.</span>
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="mx-auto mt-6 max-w-2xl text-base text-navy-muted sm:text-lg"
          >
            From purchase request to purchase order in one place. Compare quotes on total landed
            cost, score suppliers on real delivery data, and spot savings with insights you can
            verify.
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="mt-9 flex flex-wrap items-center justify-center gap-3"
          >
            <Button variant="hero" size="xl" asChild>
              <Link to="/buyer/signup">
                Start free
                <ArrowRight />
              </Link>
            </Button>
            <Button variant="glass" size="xl" asChild>
              <Link to="/buyer/signin">Explore demo workspace</Link>
            </Button>
          </motion.div>
        </div>
        <PreviewCard />
      </section>

      <section id="benefits" className="scroll-mt-16 px-4 py-24 sm:px-6">
        <div className="mx-auto max-w-7xl">
          <motion.div {...fade} className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Better purchasing, measurably
            </h2>
            <p className="mt-3 text-muted-foreground">
              Less chasing, fewer surprises, and numbers you can trust.
            </p>
          </motion.div>
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {BENEFITS.map((b, i) => (
              <motion.div
                key={b.t}
                {...fade}
                transition={{ ...fade.transition, delay: i * 0.08 }}
                className="card-lift rounded-3xl border bg-card p-6 shadow-card"
              >
                <div
                  className={cn(
                    "mb-4 grid size-11 place-items-center rounded-2xl text-on-brand shadow-soft",
                    b.c,
                  )}
                >
                  <b.icon className="size-5" />
                </div>
                <h3 className="font-semibold">{b.t}</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">{b.d}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section id="how" className="scroll-mt-16 bg-gradient-lavender px-4 py-24 sm:px-6">
        <div className="mx-auto max-w-7xl">
          <motion.div {...fade} className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">How it works</h2>
            <p className="mt-3 text-muted-foreground">
              Five steps from "we need this" to "it's delivered".
            </p>
          </motion.div>
          <ol className="mt-12 grid gap-5 md:grid-cols-5">
            {STEPS.map((s, i) => (
              <motion.li
                key={s.t}
                {...fade}
                transition={{ ...fade.transition, delay: i * 0.08 }}
                className="relative rounded-3xl border bg-card p-5 shadow-card"
              >
                <span className="absolute right-4 top-3 text-4xl font-semibold text-muted">
                  {i + 1}
                </span>
                <div className="mb-3 grid size-10 place-items-center rounded-xl bg-gradient-primary text-on-brand">
                  <s.icon className="size-5" />
                </div>
                <h3 className="font-semibold">{s.t}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{s.d}</p>
              </motion.li>
            ))}
          </ol>
        </div>
      </section>

      <section id="features" className="scroll-mt-16 px-4 py-24 sm:px-6">
        <div className="mx-auto max-w-7xl">
          <motion.div {...fade} className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Everything procurement needs
            </h2>
            <p className="mt-3 text-muted-foreground">
              One workspace, each area with its own colour so you always know where you are.
            </p>
          </motion.div>
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f, i) => (
              <motion.div
                key={f.t}
                {...fade}
                transition={{ ...fade.transition, delay: (i % 3) * 0.08 }}
                className="card-lift flex gap-4 rounded-3xl border bg-card p-6 shadow-card"
              >
                <div
                  className={cn(
                    "grid size-11 shrink-0 place-items-center rounded-2xl text-on-brand",
                    f.c,
                  )}
                >
                  <f.icon className="size-5" />
                </div>
                <div>
                  <h3 className="font-semibold">{f.t}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{f.d}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section id="pricing" className="scroll-mt-16 bg-gradient-lavender px-4 py-24 sm:px-6">
        <div className="mx-auto max-w-6xl">
          <motion.div {...fade} className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Simple pricing</h2>
            <p className="mt-3 text-muted-foreground">
              Start free. Upgrade when your team grows. Prices exclude GST.
            </p>
          </motion.div>
          <div className="mt-12 grid gap-5 lg:grid-cols-3">
            {PLANS.map((p) => (
              <motion.div
                key={p.n}
                {...fade}
                className={cn(
                  "relative flex flex-col rounded-3xl bg-card p-7 shadow-card",
                  p.hot ? "gradient-border shadow-lift lg:-translate-y-3" : "border",
                )}
              >
                {p.hot ? (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-gradient-cta px-3 py-1 text-xs font-medium text-on-brand">
                    Most popular
                  </span>
                ) : null}
                <h3 className="font-semibold">{p.n}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{p.d}</p>
                <div className="mt-5 flex items-baseline gap-1.5">
                  <span className="text-4xl font-semibold tracking-tight">{p.p}</span>
                  <span className="text-sm text-muted-foreground">{p.u}</span>
                </div>
                <ul className="my-6 flex-1 space-y-2.5 text-sm">
                  {p.f.map((x) => (
                    <li key={x} className="flex items-start gap-2">
                      <Check className="mt-0.5 size-4 shrink-0 text-success" />
                      {x}
                    </li>
                  ))}
                </ul>
                <Button variant={p.hot ? "hero" : "outline"} size="lg" asChild>
                  <Link to="/buyer/signup">{p.cta}</Link>
                </Button>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section id="faq" className="scroll-mt-16 px-4 py-24 sm:px-6">
        <div className="mx-auto max-w-3xl">
          <motion.div {...fade} className="text-center">
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Questions, answered
            </h2>
          </motion.div>
          <Accordion
            type="single"
            collapsible
            className="mt-10 rounded-3xl border bg-card px-6 shadow-card"
          >
            {FAQ.map(([q, a]) => (
              <AccordionItem key={q} value={q}>
                <AccordionTrigger className="text-left">{q}</AccordionTrigger>
                <AccordionContent className="text-muted-foreground">{a}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </section>

      <section className="px-4 pb-24 sm:px-6">
        <motion.div
          {...fade}
          className="relative mx-auto max-w-5xl overflow-hidden rounded-[2rem] bg-gradient-navy bg-grid-dark px-6 py-16 text-center text-navy-foreground"
        >
          <div className="glow-magenta absolute -right-10 -top-10 size-72 animate-orb opacity-50" />
          <div className="glow-cyan absolute -bottom-10 -left-10 size-72 animate-orb-slow opacity-40" />
          <h2 className="relative text-3xl font-semibold tracking-tight sm:text-4xl">
            Ready to buy smarter?
          </h2>
          <p className="relative mx-auto mt-3 max-w-xl text-navy-muted">
            Explore a full demo workspace in under a minute — no card, no setup.
          </p>
          <div className="relative mt-8 flex flex-wrap justify-center gap-3">
            <Button variant="hero" size="xl" asChild>
              <Link to="/buyer/signup">
                Create free account
                <ArrowRight />
              </Link>
            </Button>
            <Button variant="glass" size="xl" asChild>
              <Link to="/buyer/signin">Try the demo</Link>
            </Button>
          </div>
        </motion.div>
      </section>

      <footer className="bg-navy px-4 py-14 text-navy-muted sm:px-6">
        <div className="mx-auto grid max-w-7xl gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <VendoraLogo variant="lockup" height={34} />
            <p className="mt-4 max-w-xs text-sm">
              Procurement software for Indian manufacturers, distributors and retailers.
            </p>
          </div>
          {[
            [
              "Product",
              [
                ["Features", "#features"],
                ["Pricing", "#pricing"],
                ["How it works", "#how"],
              ],
            ],
            [
              "Company",
              [
                ["About", "#benefits"],
                ["Contact", "mailto:hello@vendora.app"],
                ["Careers", "#faq"],
              ],
            ],
            [
              "Get started",
              [
                ["Sign up", "/buyer/signup"],
                ["Sign in", "/buyer/signin"],
                ["Demo workspace", "/buyer/signin"],
              ],
            ],
          ].map(([h, ls]) => (
            <div key={h as string}>
              <h4 className="mb-3 text-sm font-semibold text-navy-foreground">{h as string}</h4>
              <ul className="space-y-2 text-sm">
                {(ls as string[][]).map(([l, href]) => (
                  <li key={l}>
                    <a href={href} className="transition hover:text-navy-foreground">
                      {l}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mx-auto mt-10 max-w-7xl border-t border-navy-foreground/10 pt-6 text-xs">
          © {new Date().getFullYear()} Vendora. All rights reserved. Demo data is invented for
          illustration.
        </div>
      </footer>
    </div>
  );
}
