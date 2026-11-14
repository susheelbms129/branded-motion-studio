import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Check,
  Clock,
  Eye,
  Inbox,
  Lock,
  MapPin,
  Package,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import type { StorefrontPreview } from "@/lib/supplier-dashboard-api";
import { TRUST_LADDER, type Step, type Strength, type TrustLevel } from "@/lib/supplier-strength";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

const card = "rounded-2xl border border-border bg-card p-6 shadow-card";

/** The score ring. Pure SVG, so it needs no chart library and nothing outside the page. */
export function StrengthRing({ score, size = 148 }: { score: number; size?: number }) {
  const r = (size - 16) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Storefront strength ${score} out of 100`}
    >
      <svg width={size} height={size} className="-rotate-90">
        <defs>
          <linearGradient id="ring-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--brand-cyan)" />
            <stop offset="55%" stopColor="var(--brand-violet)" />
            <stop offset="100%" stopColor="var(--brand-magenta)" />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          className="text-white/15"
          strokeWidth={10}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="url(#ring-grad)"
          strokeWidth={10}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - score / 100)}
          className="transition-[stroke-dashoffset] duration-1000 ease-out"
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <div className="text-4xl font-semibold tabular text-white">{score}</div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-navy-muted">
            of 100
          </div>
        </div>
      </div>
    </div>
  );
}

/** The top of the page: who you are, where you stand, and the one thing to do next. */
export function Hero({
  name,
  strength,
  loading,
}: {
  name: string;
  strength: Strength | null;
  loading: boolean;
}) {
  const top = strength?.next[0];
  return (
    <section className="relative overflow-hidden rounded-3xl bg-gradient-navy p-6 text-white shadow-card sm:p-8">
      <div
        className="pointer-events-none absolute -right-24 -top-24 size-80 glow-violet opacity-50"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -bottom-32 left-1/3 size-72 glow-blue opacity-30"
        aria-hidden
      />
      <div className="relative flex flex-wrap items-center gap-8">
        {loading || !strength ? (
          <div
            className="size-[148px] shrink-0 animate-pulse rounded-full bg-white/10"
            aria-hidden
          />
        ) : (
          <StrengthRing score={strength.score} />
        )}
        <div className="min-w-0 flex-1 basis-72">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-navy-muted">
            Storefront strength
          </p>
          <h1 className="mt-1 text-3xl font-semibold leading-tight">
            {strength ? `${strength.tier}, ` : ""}
            <span className="text-gradient-brand-dark">{name}</span>
          </h1>
          {top ? (
            <>
              <p className="mt-3 max-w-xl text-navy-muted">
                <span className="font-semibold text-white">Next best move: {top.title}.</span>{" "}
                {top.why}
              </p>
              {top.to ? (
                <Link
                  to={top.to}
                  className="btn-shine mt-5 inline-flex items-center gap-2 rounded-md bg-gradient-cta px-5 py-2.5 text-sm font-semibold text-white shadow-glow transition hover:scale-[1.01]"
                >
                  {top.cta}{" "}
                  <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs">
                    +{top.points} points
                  </span>{" "}
                  <ArrowRight className="size-4" aria-hidden />
                </Link>
              ) : (
                <p className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-navy-muted">
                  <Clock className="size-3.5" aria-hidden /> This page is being built
                </p>
              )}
            </>
          ) : strength ? (
            <p className="mt-3 max-w-xl text-navy-muted">
              Your storefront is complete. Buyers who search for what you sell see a full, verified
              company.
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

/** What a buyer sees in the directory. Built from the supplier's own saved data, so what they see here is what buyers see. */
export function StorefrontPreviewCard({ p, level }: { p: StorefrontPreview; level: TrustLevel }) {
  const badge = TRUST_LADDER[level] ?? TRUST_LADDER[0]!;
  const where = [p.city, p.state].filter(Boolean).join(", ");
  return (
    <section className={card}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Eye className="size-5 text-violet" aria-hidden /> How buyers see you
        </h2>
        <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">
          Live preview
        </span>
      </div>
      <div className="mt-4 rounded-xl border border-border bg-background p-5">
        <div className="flex items-start gap-4">
          {p.logo ? (
            <img
              src={p.logo}
              alt=""
              className="size-14 shrink-0 rounded-xl border border-border object-contain bg-white"
            />
          ) : (
            <div
              className="grid size-14 shrink-0 place-items-center rounded-xl bg-gradient-primary text-lg font-semibold text-white"
              aria-hidden
            >
              {initials(p.name)}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold">{p.name}</p>
            {where ? (
              <p className="mt-0.5 flex items-center gap-1 text-sm text-muted-foreground">
                <MapPin className="size-3.5" aria-hidden />
                {where}
              </p>
            ) : null}
          </div>
          <span
            className={cn(
              "flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold",
              level > 0 ? "tint-emerald" : "tint-slate",
            )}
          >
            <ShieldCheck className="size-3.5" aria-hidden /> {badge.name}
          </span>
        </div>
        <p
          className={cn(
            "mt-4 line-clamp-3 text-sm leading-relaxed",
            p.description ? "text-foreground/80" : "italic text-muted-foreground",
          )}
        >
          {p.description ||
            "No description yet. Buyers see an empty card, and an empty card gets skipped."}
        </p>
        <div className="mt-4 flex flex-wrap gap-1.5">
          {p.categories.length > 0 ? (
            p.categories.slice(0, 4).map((c) => (
              <span key={c} className="tint-blue rounded-full px-2.5 py-1 text-xs font-medium">
                {c}
              </span>
            ))
          ) : (
            <span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
              No categories yet
            </span>
          )}
        </div>
      </div>
    </section>
  );
}

/** The four Trust Passport levels as a ladder: where you are, what the next rung needs. */
export function TrustLadder({
  level,
  inReview,
  needsFix,
}: {
  level: TrustLevel;
  inReview: number;
  needsFix: number;
}) {
  const next = TRUST_LADDER[Math.min(level + 1, 3)] ?? TRUST_LADDER[3]!;
  return (
    <section className={card}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <ShieldCheck className="size-5 text-emerald" aria-hidden /> Trust Passport
        </h2>
        <Link
          to="/supplier/verification"
          className="text-sm font-semibold text-primary hover:underline"
        >
          Open
        </Link>
      </div>
      <ol className="mt-4 space-y-1">
        {TRUST_LADDER.map((s) => {
          const reached = level >= s.level;
          const current = level === s.level;
          return (
            <li
              key={s.level}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5",
                current && "bg-primary/5 ring-1 ring-primary/20",
              )}
            >
              <span
                className={cn(
                  "grid size-7 shrink-0 place-items-center rounded-full",
                  reached ? "bg-gradient-emerald text-white" : "bg-muted text-muted-foreground",
                )}
              >
                {reached ? (
                  <Check className="size-4" strokeWidth={3} aria-hidden />
                ) : (
                  <Lock className="size-3.5" aria-hidden />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={cn("block text-sm font-semibold", !reached && "text-muted-foreground")}
                >
                  {s.name}
                </span>
                <span className="block text-xs text-muted-foreground">{s.needs}</span>
              </span>
              {current ? (
                <span className="tint-blue rounded-full px-2 py-0.5 text-[11px] font-semibold">
                  You are here
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
      {needsFix > 0 ? (
        <p className="tint-amber mt-4 rounded-lg px-3 py-2 text-sm font-medium">
          {needsFix === 1 ? "1 proof needs a fix" : `${needsFix} proofs need a fix`} before it
          counts for buyers.
        </p>
      ) : inReview > 0 ? (
        <p className="tint-blue mt-4 rounded-lg px-3 py-2 text-sm font-medium">
          {inReview === 1 ? "1 proof is" : `${inReview} proofs are`} with a reviewer now.
        </p>
      ) : level < 3 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Next rung: <span className="font-semibold text-foreground">{next.name}</span>.{" "}
          {next.needs}.
        </p>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">
          Top level. Watch expiry dates: an expired proof stops counting.
        </p>
      )}
    </section>
  );
}

/** The ranked checklist. Each line says why it matters to a buyer and what it adds to the score. */
export function NextSteps({ strength }: { strength: Strength }) {
  const done = strength.steps.filter((s) => s.done);
  return (
    <section className={card}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Sparkles className="size-5 text-magenta" aria-hidden /> Grow your storefront
        </h2>
        <span className="text-sm text-muted-foreground tabular">
          {done.length} of {strength.steps.length} done
        </span>
      </div>
      {strength.next.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">Everything is done. Nice work.</p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {strength.next.map((s) => (
            <StepRow key={s.key} s={s} />
          ))}
        </ul>
      )}
    </section>
  );
}

function StepRow({ s }: { s: Step }) {
  return (
    <li className="flex items-start gap-4 py-4">
      <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold text-muted-foreground tabular">
        +{s.points}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{s.title}</span>
        <span className="mt-0.5 block text-sm text-muted-foreground">{s.why}</span>
      </span>
      {s.to ? (
        <Link
          to={s.to}
          className="shrink-0 rounded-md bg-gradient-cta px-3.5 py-2 text-sm font-semibold text-white"
        >
          {s.cta}
        </Link>
      ) : (
        <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">
          Soon
        </span>
      )}
    </li>
  );
}

export function ProductsPanel({
  products,
}: {
  products: { id: string; name: string; category: string; availability: string; priced: boolean }[];
}) {
  return (
    <section className={card}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Package className="size-5 text-pink" aria-hidden /> Your products
        </h2>
        <Link
          to="/supplier/products"
          className="text-sm font-semibold text-primary hover:underline"
        >
          {products.length === 0 ? "Add products" : "Manage"}
        </Link>
      </div>
      {products.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          No products yet. Buyers search by product, so this is what gets you found.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {products.slice(0, 5).map((p) => (
            <li key={p.id} className="flex items-center gap-3 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{p.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{p.category}</span>
              </span>
              {!p.priced ? (
                <span className="tint-amber rounded-full px-2 py-0.5 text-[11px] font-semibold">
                  No price
                </span>
              ) : null}
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                  p.availability === "Available"
                    ? "tint-emerald"
                    : p.availability === "Made to order"
                      ? "tint-blue"
                      : "tint-slate",
                )}
              >
                {p.availability}
              </span>
            </li>
          ))}
        </ul>
      )}
      {products.length > 5 ? (
        <p className="mt-2 text-xs text-muted-foreground">and {products.length - 5} more</p>
      ) : null}
    </section>
  );
}

/** Honest placeholder: no invented numbers. It tells the supplier what is coming and what to do now to be ready. */
export function QuoteInbox({ level }: { level: TrustLevel }) {
  return (
    <section className={cn(card, "relative overflow-hidden")}>
      <div
        className="pointer-events-none absolute -right-16 -top-16 size-48 glow-cyan opacity-30"
        aria-hidden
      />
      <div className="relative flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Inbox className="size-5 text-blue" aria-hidden /> Quote requests
        </h2>
        <span className="tint-violet rounded-full px-2.5 py-1 text-xs font-semibold">
          Coming soon
        </span>
      </div>
      <p className="relative mt-3 text-sm text-muted-foreground">
        When a buyer asks for a quote, it will land here with the items, quantity and delivery date,
        and you reply from this page.
      </p>
      <p className="relative mt-3 text-sm">
        {level >= 2 ? (
          <span className="font-medium">
            You are ready: verified suppliers are the first to get requests.
          </span>
        ) : (
          <span className="font-medium">
            Get ready now: verified suppliers are the first to get requests.
          </span>
        )}
      </p>
    </section>
  );
}
