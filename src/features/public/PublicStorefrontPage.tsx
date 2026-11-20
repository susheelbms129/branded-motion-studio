import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, Building2, CalendarDays, Loader2, MapPin, MessageSquareQuote, Package, ShieldCheck, Truck } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Logo } from "@/components/landing/Logo";
import { TrustPassport } from "@/components/trust/TrustPassport";
import { ScorecardView } from "@/features/scorecard/ScorecardView";
import { passportPath } from "@/lib/passport-api";
import { getSupabase } from "@/lib/supabase";
import {
  logoPath,
  productPhotoPath,
  recordStorefrontEvent,
  storefrontOrgForBuyer,
  type PublicStorefront,
  type StorefrontProduct,
} from "@/lib/storefront-api";
import { cn } from "@/lib/utils";

const card = "rounded-2xl border border-border bg-card p-6 shadow-card";
const ctaBtn =
  "btn-shine inline-flex items-center justify-center gap-1.5 rounded-md bg-gradient-cta px-5 py-2.5 text-sm font-semibold text-white shadow-glow transition hover:scale-[1.01] disabled:opacity-60 disabled:hover:scale-100";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });

function money(n: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 2 }).format(n);
  } catch {
    return `${currency} ${n}`;
  }
}

/**
 * What anyone sees at /s/<company>. No sign-in. It is a LIVE proof page, not a brochure: the Trust Passport and the earned
 * scorecard are read from the database today, and the page disappears by itself when the company stops being verified.
 */
export function PublicStorefrontPage({ data, origin: _origin }: { data: PublicStorefront; origin: string }) {
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const place = [data.city, data.state].filter(Boolean).join(", ");

  // One anonymous count per visitor per browser session. Nothing that identifies the visitor is sent or stored.
  useEffect(() => {
    try {
      const key = `vendora:sf:${data.slug}`;
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      /* private mode: count it anyway */
    }
    void recordStorefrontEvent(data.slug, "view");
  }, [data.slug]);

  async function requestQuote() {
    if (busy) return;
    setBusy(true);
    void recordStorefrontEvent(data.slug, "quote_click");
    try {
      const { data: s } = await getSupabase().auth.getSession();
      if (!s.session) {
        await nav({ to: "/buyer/signup" });
        return;
      }
      try {
        const id = await storefrontOrgForBuyer(data.slug);
        await nav({ to: "/buyer/dashboard/find-suppliers/$id", params: { id } });
      } catch (e) {
        const m = e instanceof Error ? e.message : "";
        if (m.includes("not_allowed")) toast.error("Quotes can be requested from a buyer account. Sign up as a buyer to continue.");
        else await nav({ to: "/buyer/signup" });
      }
    } finally {
      setBusy(false);
    }
  }

  const quoteButton = (
    <button type="button" onClick={() => void requestQuote()} disabled={busy} className={ctaBtn}>
      {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <MessageSquareQuote className="size-4" aria-hidden />} Request a quote
    </button>
  );

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="bg-gradient-navy text-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <Link to="/" aria-label="Vendora home">
            <Logo className="h-9" />
          </Link>
          <span className="text-xs font-medium text-white/70">Supplier storefront</span>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-5 px-4 py-8">
        <section className={card}>
          <div className="flex flex-wrap items-start gap-4">
            {data.has_logo ? (
              <img src={logoPath(data.slug)} alt={`${data.name} logo`} width={72} height={72} className="size-[72px] shrink-0 rounded-xl border border-border bg-white object-contain" />
            ) : (
              <span className="grid size-[72px] shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground">
                <Building2 className="size-8" aria-hidden />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl font-semibold">{data.name}</h1>
              {data.tagline ? <p className="mt-1 text-base text-muted-foreground">{data.tagline}</p> : null}
              <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                {place ? (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="size-3.5" aria-hidden /> {place}
                  </span>
                ) : null}
                {data.business_type ? <span>{data.business_type}</span> : null}
                {data.year_established ? <span>Since {data.year_established}</span> : null}
              </p>
            </div>
            <div className="w-full sm:w-auto">{quoteButton}</div>
          </div>

          <p className="mt-4 flex flex-wrap items-center gap-2 rounded-xl bg-emerald-500/10 px-3 py-2 text-sm">
            <ShieldCheck className="size-4 shrink-0 text-emerald-600" aria-hidden />
            <span>
              <strong>{data.passport.level_name}</strong> on Vendora, checked live on {day(data.as_of)}.{" "}
              <Link to={passportPath(data.slug) as never} className="font-semibold text-primary underline-offset-2 hover:underline">
                See what was checked
              </Link>
            </span>
          </p>

          {data.categories.length > 0 ? (
            <ul className="mt-4 flex flex-wrap gap-2" aria-label="Categories">
              {data.categories.map((c) => (
                <li key={c} className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">
                  {c}
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <section className={card}>
          <h2 className="text-lg font-semibold">About {data.name}</h2>
          <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{data.description}</p>
        </section>

        {data.products.length > 0 ? (
          <section className={card} aria-label="Products">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <Package className="size-5" aria-hidden /> Products and services
            </h2>
            <ul className="mt-4 grid gap-4 sm:grid-cols-2">
              {data.products.map((p) => (
                <ProductCard key={p.id} p={p} slug={data.slug} />
              ))}
            </ul>
            {data.product_count > data.products.length ? (
              <p className="mt-4 text-sm text-muted-foreground">
                Showing {data.products.length} of {data.product_count} products. Request a quote to see the full range.
              </p>
            ) : null}
            {!data.show_prices ? <p className="mt-3 text-xs text-muted-foreground">Prices are shared on request. Ask for a quote and compare it with others.</p> : null}
          </section>
        ) : null}

        {data.delivery ? <DeliveryCard d={data.delivery} areas={data.service_areas} /> : null}

        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <CalendarDays className="size-4" aria-hidden /> Read live from Vendora on {day(data.as_of)}. Expired proofs never appear here.
        </p>
        <TrustPassport passport={data.passport} />
        {data.scorecard ? <ScorecardView card={data.scorecard} variant="public" /> : null}

        <section className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
            <p className="font-semibold">Interested in {data.name}?</p>
            <p className="mt-1 text-sm text-muted-foreground">Send a request and compare their quote with other verified suppliers. Free for buyers.</p>
            <div className="mt-3">{quoteButton}</div>
          </div>
          <Link to="/supplier/signup" className="group rounded-2xl border border-border bg-card p-5 shadow-card transition hover:border-primary/40">
            <p className="font-semibold">Run a business like this?</p>
            <p className="mt-1 text-sm text-muted-foreground">Get your own verified storefront. Verification is free and ranking is never for sale.</p>
            <span className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-primary transition group-hover:gap-2.5">
              Create your storefront <ArrowRight className="size-4" aria-hidden />
            </span>
          </Link>
        </section>
      </main>

      <footer className="mx-auto max-w-4xl px-4 pb-10 text-center text-xs text-muted-foreground">
        Vendora checks identity and documents. It does not guarantee a supplier's quality, delivery or finances.
      </footer>
    </div>
  );
}

function ProductCard({ p, slug }: { p: StorefrontProduct; slug: string }) {
  const unavailable = p.availability === "Temporarily unavailable";
  return (
    <li className="flex gap-3 rounded-xl border border-border p-3">
      {p.has_photo ? (
        <img src={productPhotoPath(slug, p.id)} alt={p.name} loading="lazy" width={72} height={72} className="size-[72px] shrink-0 rounded-lg border border-border bg-white object-cover" />
      ) : (
        <span className="grid size-[72px] shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
          <Package className="size-6" aria-hidden />
        </span>
      )}
      <div className="min-w-0">
        <h3 className="truncate text-sm font-semibold">{p.name}</h3>
        <p className="text-xs text-muted-foreground">{p.category}</p>
        {p.description ? <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{p.description}</p> : null}
        <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
          {p.price !== null ? (
            <span className="font-semibold">
              {money(p.price, p.currency)}
              {p.unit ? ` / ${p.unit.toLowerCase()}` : ""}
            </span>
          ) : null}
          {p.moq !== null ? (
            <span className="text-muted-foreground">
              Min. order {p.moq}
              {p.unit ? ` ${p.unit.toLowerCase()}` : ""}
            </span>
          ) : null}
          <span className={cn("rounded-full px-2 py-0.5 font-medium", unavailable ? "bg-amber-500/10 text-amber-700" : "bg-emerald-500/10 text-emerald-700")}>{p.availability}</span>
        </p>
      </div>
    </li>
  );
}

function DeliveryCard({ d, areas }: { d: NonNullable<PublicStorefront["delivery"]>; areas: PublicStorefront["service_areas"] }) {
  const rows: [string, string][] = [
    ["Delivers", d.coverage.join(", ")],
    ["Delivery time", d.delivery_time],
    ["Minimum order", d.min_order_value !== null ? money(d.min_order_value, d.currency) : ""],
    ["How", d.delivery_options.join(", ")],
    ["Pickup by buyer", d.pickup],
  ];
  const shown = rows.filter(([, v]) => v);
  if (shown.length === 0 && areas.length === 0) return null;
  return (
    <section className={card} aria-label="Delivery terms">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <Truck className="size-5" aria-hidden /> Delivery terms
      </h2>
      {shown.length > 0 ? (
        <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          {shown.map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-muted-foreground">{k}</dt>
              <dd className="font-medium">{v}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {areas.length > 0 ? (
        <>
          <h3 className="mt-4 text-sm font-semibold">Service areas</h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            {areas.map((a, i) => (
              <li key={`${a.country}-${a.state}-${a.city}-${i}`} className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">
                {[a.city, a.state, a.country].filter(Boolean).join(", ")}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
