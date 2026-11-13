import { Link } from "@tanstack/react-router";
import { ArrowRight, Boxes, ClipboardList, FileText, Scale, X } from "lucide-react";

import { Logo } from "./Logo";

/** Small product vignette for the Buyer card: three quotes side by side, one highlighted. */
function BuyerArt() {
  const quotes = [
    ["Steelcraft", "₹1,12,500", false],
    ["Maruti Metals", "₹1,03,800", true],
    ["Anand Traders", "₹1,18,200", false],
  ] as const;
  return (
    <div className="relative h-56 overflow-hidden rounded-2xl bg-gradient-to-br from-violet/30 via-blue/20 to-navy-3 p-5">
      <div className="bg-grid-dark mask-radial absolute inset-0 opacity-50" />
      <div className="relative flex h-full flex-col justify-between rounded-xl bg-white p-4 shadow-lift">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Scale className="h-4 w-4 text-primary" /> Compare quotes
          </span>
          <span className="tint-violet rounded-full px-2.5 py-0.5 text-[11px] font-semibold">RFQ-2026-118</span>
        </div>
        <ul className="space-y-1.5">
          {quotes.map(([name, price, best]) => (
            <li key={name} className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ${best ? "bg-primary/10 font-semibold text-foreground ring-1 ring-primary/30" : "bg-muted/60 text-muted-foreground"}`}>
              <span>{name}</span>
              <span className="flex items-center gap-2 tabular">
                {price}
                {best ? <span className="tint-emerald rounded-full px-2 py-0.5 text-[10px] font-semibold">Best landed cost</span> : null}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Small product vignette for the Supplier card: an incoming request and a product listing. */
function SupplierArt() {
  return (
    <div className="relative h-56 overflow-hidden rounded-2xl bg-gradient-to-br from-emerald/30 via-cyan/20 to-navy-3 p-5">
      <div className="bg-grid-dark mask-radial absolute inset-0 opacity-50" />
      <div className="relative flex h-full flex-col justify-between gap-2">
        <div className="flex items-center gap-3 rounded-xl bg-white p-3 shadow-lift">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-emerald text-white">
            <FileText className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-foreground">New quote request</span>
            <span className="block truncate text-xs text-subtle-foreground">Hydraulic hose, 300 m, from Sharma Precision</span>
          </span>
          <span className="tint-amber rounded-full px-2.5 py-0.5 text-[11px] font-semibold">Reply</span>
        </div>
        <div className="flex items-center gap-3 rounded-xl bg-white p-3 shadow-lift">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-cyan text-white">
            <Boxes className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-foreground">Product catalogue</span>
            <span className="block truncate text-xs text-subtle-foreground">48 products listed, 6 categories</span>
          </span>
          <span className="tint-emerald rounded-full px-2.5 py-0.5 text-[11px] font-semibold">Live</span>
        </div>
      </div>
    </div>
  );
}

function Choice({ to, art, title, text, tag, tagClass, cta }: { to: "/signup" | "/supplier/signup"; art: React.ReactNode; title: string; text: string; tag: string; tagClass: string; cta: string }) {
  return (
    <Link to={to} className="group flex flex-col rounded-3xl border border-white/15 bg-white/5 p-4 backdrop-blur transition hover:-translate-y-1 hover:border-white/40 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan">
      {art}
      <div className="flex flex-1 flex-col px-2 pb-2 pt-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-2xl font-semibold text-white">{title}</h2>
          <span className={`rounded-full px-3 py-1 text-sm font-semibold ${tagClass}`}>{tag}</span>
        </div>
        <p className="mt-2 max-w-md text-base leading-relaxed text-navy-muted">{text}</p>
        <span className="mt-6 inline-flex items-center gap-2 text-base font-semibold text-white">
          {cta}
          <ArrowRight className="h-5 w-5 transition group-hover:translate-x-1.5" />
        </span>
      </div>
    </Link>
  );
}

export function AccountTypePicker() {
  return (
    <div className="fixed inset-0 z-[70] overflow-y-auto bg-navy text-navy-foreground">
      <div className="bg-grid-dark mask-radial pointer-events-none absolute inset-0 opacity-50" />
      <div className="glow-violet animate-orb pointer-events-none absolute -left-40 -top-20 h-[520px] w-[520px] opacity-50" />
      <div className="glow-emerald animate-orb-slow pointer-events-none absolute -bottom-40 -right-32 h-[520px] w-[520px] opacity-40" />

      <div className="relative mx-auto flex min-h-full max-w-6xl flex-col px-5 pb-10 sm:px-8">
        <header className="flex items-center justify-between py-4">
          <Link to="/" aria-label="Vendora home">
            <Logo className="h-16 sm:h-20" />
          </Link>
          <Link to="/" aria-label="Close" className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition hover:rotate-90 hover:bg-white/20">
            <X className="h-5 w-5" />
          </Link>
        </header>

        <main className="flex flex-1 flex-col justify-center py-6">
          <div className="text-center">
            <h1 className="text-4xl font-semibold text-white sm:text-5xl">Join Vendora</h1>
            <p className="mt-3 text-lg text-navy-muted sm:text-xl">How would you like to use Vendora?</p>
          </div>

          <div className="mt-10 grid gap-6 md:grid-cols-2">
            <Choice
              to="/signup"
              art={<BuyerArt />}
              title="I'm a Buyer"
              tag="Buyer"
              tagClass="bg-violet/25 text-white"
              text="Manage purchasing, suppliers and procurement for your company: requests, quotes, approvals and purchase orders."
              cta="Continue as a buyer"
            />
            <Choice
              to="/supplier/signup"
              art={<SupplierArt />}
              title="I'm a Supplier"
              tag="Supplier"
              tagClass="bg-emerald/25 text-white"
              text="Showcase your products, receive quote requests and orders, and work with the businesses that buy from you."
              cta="Continue as a supplier"
            />
          </div>

          <p className="mt-8 flex items-center justify-center gap-2 text-center text-navy-muted">
            <ClipboardList className="h-4 w-4 shrink-0" />
            One Vendora login. Buyers and suppliers each get their own workspace.
          </p>
        </main>

        <p className="pt-4 text-center text-base text-navy-muted">
          Already have an account?{" "}
          <Link to="/signin" className="font-semibold text-white underline-offset-4 hover:underline">
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}
