import { BadgeCheck, CalendarClock, ShieldCheck } from "lucide-react";

import { cn } from "@/lib/utils";
import type { CheckType, TrustPassport as Passport } from "@/lib/verification-api";

/**
 * The Trust Passport as a BUYER sees it: which proofs are verified, WHEN, and until when. A proof that lapses
 * disappears by itself. Registration and certificate numbers are public facts, so a buyer can check them elsewhere.
 * Bank and address details and every document stay private and never reach this component.
 */
const LEVELS = [
  { n: 1, name: "Registered", hint: "Business registration checked" },
  { n: 2, name: "Verified", hint: "+ address and bank checked" },
  { n: 3, name: "Certified", hint: "+ a quality certificate checked" },
] as const;

export const TYPE_TITLE: Record<CheckType, string> = {
  registration: "Business registration",
  address: "Business address",
  bank: "Bank account",
  certificate: "Certificate",
};

export const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "";

export function TrustPassport({ passport, className }: { passport: Passport; className?: string }) {
  const none = passport.level === 0;
  return (
    <section className={cn("rounded-2xl border border-border bg-card p-6 shadow-card", className)} aria-label="Trust Passport">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            <ShieldCheck className="h-4 w-4" /> Vendora Trust Passport
          </p>
          <h3 className="mt-1 text-2xl font-semibold">{none ? "Not verified yet" : passport.level_name}</h3>
          {passport.valid_through ? (
            <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
              <CalendarClock className="h-4 w-4" /> Checked proofs valid until {fmtDate(passport.valid_through)}
            </p>
          ) : null}
        </div>
        <span className={cn("flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold", none ? "tint-amber" : "tint-emerald")}>
          <BadgeCheck className="h-4 w-4" /> Level {passport.level} of 3
        </span>
      </div>

      <ol className="mt-5 grid gap-2 sm:grid-cols-3">
        {LEVELS.map((l) => {
          const on = passport.level >= l.n;
          return (
            <li key={l.n} className={cn("rounded-xl border p-3", on ? "border-transparent tint-emerald" : "border-border bg-muted/40 text-muted-foreground")}>
              <p className="text-sm font-semibold">{l.name}</p>
              <p className="text-xs">{l.hint}</p>
            </li>
          );
        })}
      </ol>

      {passport.checks.length > 0 ? (
        <ul className="mt-5 divide-y divide-border">
          {passport.checks.map((c, i) => (
            <li key={`${c.type}-${c.label}-${i}`} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <span>
                <span className="block font-medium">{c.type === "certificate" ? c.label : TYPE_TITLE[c.type]}</span>
                {c.reference ? <span className="block text-sm text-muted-foreground">{c.type === "certificate" && c.issuer ? `${c.issuer} · ` : ""}No. {c.reference}</span> : null}
              </span>
              <span className="text-right text-sm text-muted-foreground">
                <span className="block">Verified {fmtDate(c.verified_on)}</span>
                <span className="block">Valid until {fmtDate(c.expires_at)}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-5 text-sm text-muted-foreground">No proofs have been verified yet, so buyers see this supplier as unverified.</p>
      )}
    </section>
  );
}
