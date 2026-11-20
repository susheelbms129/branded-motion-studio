import { ScorecardView } from "@/features/scorecard/ScorecardView";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowRight, Building2, CalendarDays, MapPin, ShieldQuestion } from "lucide-react";

import { Logo } from "@/components/landing/Logo";
import { TrustPassport } from "@/components/trust/TrustPassport";
import type { PublicPassport } from "@/lib/passport-api";

const card = "rounded-2xl border border-border bg-card p-6 shadow-card";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });

/**
 * What anyone sees when a supplier shares their Trust Passport link. No sign-in. It is read live from the database, so it
 * is only ever as good as today: an expired proof is gone from it, and the date says when it was true.
 */
export function PublicPassportPage({ data, failed }: { data: PublicPassport | null; failed: boolean }) {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="bg-gradient-navy text-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <Link to="/" aria-label="Vendora home">
            <Logo className="h-9" />
          </Link>
          <span className="text-xs font-medium text-white/70">Trust Passport</span>
        </div>
      </header>
      <main className="mx-auto max-w-3xl space-y-5 px-4 py-8">{data ? <Found data={data} /> : <Missing failed={failed} />}</main>
      <footer className="mx-auto max-w-3xl px-4 pb-10 text-center text-xs text-muted-foreground">
        Vendora checks identity and documents. It does not guarantee a supplier's quality, delivery or finances.
      </footer>
    </div>
  );
}

function Found({ data }: { data: PublicPassport }) {
  const place = [data.city, data.state].filter(Boolean).join(", ");
  const none = data.passport.level === 0;
  return (
    <>
      <section className={card}>
        <div className="flex items-start gap-4">
          {data.logo ? (
            <img src={data.logo} alt="" className="size-16 shrink-0 rounded-xl border border-border object-contain" />
          ) : (
            <span className="grid size-16 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground">
              <Building2 className="size-7" aria-hidden />
            </span>
          )}
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold">{data.name}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              {place ? (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="size-3.5" aria-hidden /> {place}
                </span>
              ) : null}
              {data.business_type ? <span>{data.business_type}</span> : null}
              {data.year_established ? <span>Since {data.year_established}</span> : null}
            </p>
          </div>
        </div>
        {data.description ? <p className="mt-4 text-sm text-muted-foreground">{data.description}</p> : null}
        {data.categories.length > 0 ? (
          <ul className="mt-4 flex flex-wrap gap-2">
            {data.categories.map((c) => (
              <li key={c} className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">
                {c}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <CalendarDays className="size-4" aria-hidden /> Read live from Vendora on {day(data.as_of)}. Expired proofs never appear here.
      </p>

      {none ? (
        <p role="status" className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
          <span>
            This supplier has no valid verified proof today. A proof may have expired and is being renewed. Ask the supplier for an
            update before you rely on this page.
          </span>
        </p>
      ) : null}

      <TrustPassport passport={data.passport} />

      {data.scorecard ? <ScorecardView card={data.scorecard} variant="public" /> : null}

      <section className={card}>
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <ShieldQuestion className="size-4" aria-hidden /> How to check it yourself
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The registration number above is a public GST number. You can look it up on the government GST portal and compare the name
          and status. Each proof shows whether Vendora checked a government record or reviewed a document, and until when.
        </p>
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <Link to="/buyer/signup" className="group rounded-2xl border border-border bg-card p-5 shadow-card transition hover:border-primary/40">
          <p className="font-semibold">Buying something?</p>
          <p className="mt-1 text-sm text-muted-foreground">Send an RFQ to verified suppliers and compare real landed cost. Free for buyers.</p>
          <span className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-primary transition group-hover:gap-2.5">
            Start as a buyer <ArrowRight className="size-4" aria-hidden />
          </span>
        </Link>
        <Link to="/supplier/signup" className="group rounded-2xl border border-border bg-card p-5 shadow-card transition hover:border-primary/40">
          <p className="font-semibold">Run a business like this?</p>
          <p className="mt-1 text-sm text-muted-foreground">Get your own Trust Passport. Verification is free and never pay-to-rank.</p>
          <span className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-primary transition group-hover:gap-2.5">
            Get verified <ArrowRight className="size-4" aria-hidden />
          </span>
        </Link>
      </section>
    </>
  );
}

function Missing({ failed }: { failed: boolean }) {
  return (
    <section className={`${card} text-center`}>
      <ShieldQuestion className="mx-auto size-9 text-muted-foreground" aria-hidden />
      <h1 className="mt-3 text-xl font-semibold">{failed ? "We couldn't load this page" : "This Trust Passport isn't available"}</h1>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        {failed
          ? "Please check your connection and try again in a moment."
          : "The supplier may have switched sharing off, or the link may be wrong. Ask the supplier for a fresh link."}
      </p>
      <Link to="/" className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-primary">
        Go to Vendora <ArrowRight className="size-4" aria-hidden />
      </Link>
    </section>
  );
}
