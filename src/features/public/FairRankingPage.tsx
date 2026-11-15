import { Link } from "@tanstack/react-router";
import { ArrowRight, Ban, Scale, ShieldCheck, Sprout, Truck, Zap } from "lucide-react";

import { Logo } from "@/components/landing/Logo";
import { FAIR_PROMISES, type FairRankRules } from "@/lib/fair-rank-api";

const card = "rounded-2xl border border-border bg-card p-6 shadow-card";

const LEVEL_NAME: Record<string, string> = { "0": "Not verified", "1": "Registered", "2": "Verified", "3": "Verified + Certificates" };

/**
 * How Vendora ranks suppliers, in the open. The numbers come from the same database function the ranking runs
 * (get_fair_rank_rules), so this page can never describe a formula the ranking does not use. If the rules can't be loaded,
 * the page still states the promises but shows no numbers rather than a guess.
 */
export function FairRankingPage({ rules }: { rules: FairRankRules | null }) {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="bg-gradient-navy text-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <Link to="/" aria-label="Vendora home">
            <Logo className="h-9" />
          </Link>
          <span className="text-xs font-medium text-white/70">How ranking works</span>
        </div>
      </header>
      <main className="mx-auto max-w-3xl space-y-5 px-4 py-8">
        <section className={card}>
          <p className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            <Scale className="size-4" aria-hidden /> Fair Rank
          </p>
          <h1 className="mt-1 text-3xl font-semibold">Position is earned. Never bought.</h1>
          <p className="mt-3 text-muted-foreground">
            On most B2B marketplaces, suppliers pay for visibility and for access to buyers. On Vendora they cannot. Suppliers are
            ordered by three things that really happened: how well they are verified, how fast they answer, and whether they deliver
            when they promised.
          </p>
        </section>

        <section className={card}>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Ban className="size-5" aria-hidden /> Our promises
          </h2>
          <ul className="mt-3 space-y-3">
            {FAIR_PROMISES.map((p) => (
              <li key={p.title}>
                <p className="text-sm font-semibold">{p.title}</p>
                <p className="text-sm text-muted-foreground">{p.body}</p>
              </li>
            ))}
          </ul>
        </section>

        {rules ? (
          <>
            <section className={card}>
              <h2 className="text-lg font-semibold">The formula: {rules.max} points</h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <Part icon={ShieldCheck} title="Trust" pts={rules.trust.max}>
                  The Trust Passport level that counts today. Expired proofs count for nothing.
                </Part>
                <Part icon={Zap} title="Response" pts={rules.response.max}>
                  Half for answering RFQs (a clear no counts), half for how fast a real quote arrives.
                </Part>
                <Part icon={Truck} title="Delivery" pts={rules.delivery.max}>
                  Confirmed orders that arrived on or before the promised date, as recorded by the buyer.
                </Part>
              </div>
              <h3 className="mt-6 text-sm font-semibold">Trust points by level</h3>
              <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                {Object.entries(rules.trust.by_level).map(([lvl, pts]) => (
                  <li key={lvl} className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-sm">
                    <span>{LEVEL_NAME[lvl] ?? `Level ${lvl}`}</span>
                    <span className="tabular font-semibold">{pts} points</span>
                  </li>
                ))}
              </ul>
              <h3 className="mt-6 text-sm font-semibold">Speed of a quote</h3>
              <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                {rules.response.speed_bands.map((b) => (
                  <li key={b.within_hours} className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-sm">
                    <span>Within {b.within_hours} hours</span>
                    <span className="tabular font-semibold">{Math.round(b.score * 100)}% of speed points</span>
                  </li>
                ))}
                <li className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-sm">
                  <span>Slower than that</span>
                  <span className="tabular font-semibold">{Math.round(rules.response.slower_score * 100)}%</span>
                </li>
              </ul>
            </section>

            <section className={card}>
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                <Sprout className="size-5" aria-hidden /> Fairness rules
              </h2>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
                <li>
                  Only the last {rules.window_days} days count, so a bad month is not a life sentence and an old name cannot coast.
                </li>
                <li>
                  No history means a neutral middle, not a low score. Small samples are pulled towards the middle, so one lucky or
                  unlucky order cannot make or break a supplier.
                </li>
                <li>Numbers on a supplier&apos;s card appear only after {rules.min_samples} real RFQs or orders.</li>
                <li>
                  Suppliers whose scores fall in the same {rules.tie_band}-point band are treated as equal and take turns. The order changes each day
                  and is steady within a day.
                </li>
                <li>
                  Ignoring RFQs until their due date counts against a supplier. Confirming an order and then cancelling it counts as a
                  missed delivery.
                </li>
                <li>Suppliers without a valid proof are not ranked and are listed after every verified supplier.</li>
              </ul>
            </section>
          </>
        ) : (
          <p role="status" className={`${card} text-sm text-muted-foreground`}>
            The exact numbers couldn&apos;t be loaded right now. The promises above always hold. Please try again in a moment.
          </p>
        )}

        <section className="grid gap-3 sm:grid-cols-2">
          <Link to="/buyer/signup" className="group rounded-2xl border border-border bg-card p-5 shadow-card transition hover:border-primary/40">
            <p className="font-semibold">Buying something?</p>
            <p className="mt-1 text-sm text-muted-foreground">Find suppliers ranked on what they have really done. Free for buyers.</p>
            <span className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-primary transition group-hover:gap-2.5">
              Start as a buyer <ArrowRight className="size-4" aria-hidden />
            </span>
          </Link>
          <Link to="/supplier/signup" className="group rounded-2xl border border-border bg-card p-5 shadow-card transition hover:border-primary/40">
            <p className="font-semibold">Selling something?</p>
            <p className="mt-1 text-sm text-muted-foreground">Be found because you are good, not because you paid. Free to join, free to be verified.</p>
            <span className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-primary transition group-hover:gap-2.5">
              Get verified <ArrowRight className="size-4" aria-hidden />
            </span>
          </Link>
        </section>
      </main>
      <footer className="mx-auto max-w-3xl px-4 pb-10 text-center text-xs text-muted-foreground">
        Vendora checks identity and documents and measures replies and deliveries. It does not guarantee a supplier&apos;s quality or finances.
      </footer>
    </div>
  );
}

function Part({ icon: Icon, title, pts, children }: { icon: typeof Zap; title: string; pts: number; children: string }) {
  return (
    <div className="rounded-xl bg-muted/50 p-4">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <Icon className="size-4" aria-hidden /> {title}
      </p>
      <p className="tabular mt-1 text-2xl font-semibold">{pts}</p>
      <p className="mt-1 text-xs text-muted-foreground">{children}</p>
    </div>
  );
}
