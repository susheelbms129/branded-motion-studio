import { Link } from "@tanstack/react-router";
import { ArrowRight, ClipboardList, X } from "lucide-react";

import { Logo } from "./Logo";

/** Same-size photo for both cards (identical box, object-cover). */
function ChoiceImage({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="relative h-40 w-full shrink-0 overflow-hidden rounded-2xl sm:h-48 lg:h-[clamp(200px,34vh,300px)]">
      <img src={src} alt={alt} className="h-full w-full object-cover" draggable={false} />
    </div>
  );
}

function Choice({ to, art, title, text, tag, tagClass, cta }: { to: "/buyer/signup" | "/supplier/signup"; art: React.ReactNode; title: string; text: string; tag: string; tagClass: string; cta: string }) {
  return (
    <Link to={to} className="group flex flex-col rounded-3xl border border-white/15 bg-white/5 p-4 backdrop-blur transition hover:-translate-y-1 hover:border-white/40 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan">
      {art}
      <div className="flex flex-1 flex-col px-2 pb-1 pt-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-2xl font-semibold text-white">{title}</h2>
          <span className={`rounded-full px-3 py-1 text-sm font-semibold ${tagClass}`}>{tag}</span>
        </div>
        <p className="mt-2 max-w-md text-base leading-relaxed text-navy-muted">{text}</p>
        <span className="mt-4 inline-flex items-center gap-2 text-base font-semibold text-white">
          {cta}
          <ArrowRight className="h-5 w-5 transition group-hover:translate-x-1.5" />
        </span>
      </div>
    </Link>
  );
}

export function AccountTypePicker() {
  return (
    <div className="fixed inset-0 z-[70] overflow-hidden bg-navy text-navy-foreground">
      <div className="bg-grid-dark mask-radial pointer-events-none absolute inset-0 opacity-50" />
      <div className="glow-violet animate-orb pointer-events-none absolute -left-40 -top-20 h-[520px] w-[520px] opacity-50" />
      <div className="glow-emerald animate-orb-slow pointer-events-none absolute -bottom-40 -right-32 h-[520px] w-[520px] opacity-40" />

      <div className="relative mx-auto flex h-full max-w-6xl flex-col px-5 pb-4 sm:px-8">
        <header className="flex items-center justify-between py-4">
          <Link to="/" aria-label="Vendora home">
            <Logo className="h-14 sm:h-16" />
          </Link>
          <Link to="/" aria-label="Close" className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition hover:rotate-90 hover:bg-white/20">
            <X className="h-5 w-5" />
          </Link>
        </header>

        <main className="flex min-h-0 flex-1 flex-col justify-center py-2">
          <div className="text-center">
            <h1 className="text-4xl font-semibold text-white sm:text-5xl">Join Vendora</h1>
            <p className="mt-3 text-lg text-navy-muted sm:text-xl">How would you like to use Vendora?</p>
          </div>

          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <Choice
              to="/buyer/signup"
              art={<ChoiceImage src="/images/buyer-company.jpg" alt="Buyer team reviewing procurement on a tablet in a warehouse" />}
              title="I'm a Buyer"
              tag="Buyer"
              tagClass="bg-violet/25 text-white"
              text="Manage purchasing, suppliers and procurement for your company: requests, quotes, approvals and purchase orders."
              cta="Continue as a buyer"
            />
            <Choice
              to="/supplier/signup"
              art={<ChoiceImage src="/images/supplier.jpg" alt="Supplier with clipboard standing beside stocked cartons" />}
              title="I'm a Supplier"
              tag="Supplier"
              tagClass="bg-emerald/25 text-white"
              text="Showcase your products, receive quote requests and orders, and work with the businesses that buy from you."
              cta="Continue as a supplier"
            />
          </div>

          <p className="mt-5 flex items-center justify-center gap-2 text-center text-navy-muted">
            <ClipboardList className="h-4 w-4 shrink-0" />
            Buyers and suppliers each get their own separate account and workspace.
          </p>
        </main>

        <p className="pt-2 text-center text-base text-navy-muted">
          Already have an account? Log in as a{" "}
          <Link to="/buyer/signin" className="font-semibold text-white underline-offset-4 hover:underline">
            buyer
          </Link>{" "}
          or a{" "}
          <Link to="/supplier/signin" className="font-semibold text-white underline-offset-4 hover:underline">
            supplier
          </Link>
        </p>
      </div>
    </div>
  );
}
