import { useParams } from "@tanstack/react-router";
import { ArrowLeft, Building2, CalendarClock, Check, Clock, MapPin, PackageSearch, ShieldAlert, ShieldCheck, Truck, Users } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { TrustPassport, TYPE_TITLE, fmtDate } from "@/components/trust/TrustPassport";
import { EmptyState, ErrorState } from "@/components/vendora/kit";
import { getSupplierProfile, SupplierNotFound, type ProfileProduct, type SupplierProfile } from "@/lib/directory-api";
import { AppLink } from "@/lib/nav";
import { cn } from "@/lib/utils";
import type { CheckType } from "@/lib/verification-api";

const DAY = 86_400_000;
/** What a buyer is told is NOT checked yet. A gap that is stated plainly is worth more than a badge that hides it. */
const PROOFS: CheckType[] = ["registration", "address", "bank"];

const DETAIL_LABEL: Record<string, string> = {
  inHouse: "In-house manufacturing", customMfg: "Custom manufacturing", multiSource: "Sources from multiple suppliers",
  readyStock: "Ready stock", bulkOrders: "Bulk orders", largeProjects: "Large projects", intlShipping: "International shipping",
  monthlyCapacity: "Monthly capacity", serviceCoverage: "Service coverage", tradeCountries: "Trade countries",
  mfgCapabilities: "Manufacturing capabilities", servicesOffered: "Services offered",
};

function money(n: number | null, currency: string): string {
  if (n === null || n === undefined) return "";
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 2 }).format(n);
  } catch {
    return `${currency} ${n}`;
  }
}

/** One supplier, in full: who they are, what they sell, how they deliver, and the proof behind them. */
export function SupplierProfilePage() {
  const { id } = useParams({ strict: false }) as { id: string };
  const [p, setP] = useState<SupplierProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setMissing(false);
    try {
      setP(await getSupplierProfile(id));
    } catch (e) {
      setP(null);
      if (e instanceof SupplierNotFound) setMissing(true);
      else setError(e instanceof Error ? e.message : "We couldn't load this supplier.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const back = (
    <AppLink to="find-suppliers" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
      <ArrowLeft className="size-4" /> Back to Find suppliers
    </AppLink>
  );

  if (loading) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading supplier">
        {back}
        <div className="h-32 animate-pulse rounded-2xl border border-border bg-muted/40" />
        <div className="h-64 animate-pulse rounded-2xl border border-border bg-muted/40" />
      </div>
    );
  }
  if (missing) {
    return (
      <div className="space-y-4">
        {back}
        <EmptyState
          icon={PackageSearch}
          accent="amber"
          title="Supplier not found"
          body="This supplier may not have finished setting up, or the link is wrong."
          action={<Button asChild><AppLink to="find-suppliers">Browse suppliers</AppLink></Button>}
        />
      </div>
    );
  }
  if (error || !p) {
    return (
      <div className="space-y-4">
        {back}
        <ErrorState message={error} onRetry={() => void load()} />
      </div>
    );
  }

  const place = [p.city, p.state, p.country].filter(Boolean).join(", ");
  const facts = [
    p.business_type,
    p.year_established ? `Est. ${p.year_established}` : "",
    p.company_size ? `${p.company_size} people` : "",
  ].filter(Boolean);
  const verified = p.passport.level >= 1;

  return (
    <div className="space-y-6">
      {back}

      <header className="flex flex-wrap items-start gap-5 rounded-2xl border border-border bg-card p-6 shadow-card">
        {p.logo ? (
          <img src={p.logo} alt={`${p.name} logo`} className="size-20 shrink-0 rounded-xl border border-border bg-white object-contain" />
        ) : (
          <span className="grid size-20 shrink-0 place-items-center rounded-xl tint-slate" aria-hidden><Building2 className="size-9" /></span>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="text-3xl font-semibold tracking-tight">{p.name}</h1>
          {place ? <p className="mt-1 flex items-center gap-1.5 text-muted-foreground"><MapPin className="size-4 shrink-0" aria-hidden /> {place}</p> : null}
          {facts.length > 0 ? <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground"><Users className="size-4 shrink-0" aria-hidden /> {facts.join(" · ")}</p> : null}
        </div>
        <span className={cn("rounded-full px-3 py-1.5 text-sm font-semibold", verified ? "tint-emerald" : "tint-slate")}>
          {verified ? p.passport.level_name : "Not verified"}
        </span>
      </header>

      <TrustCoverage p={p} />
      <TrustPassport passport={p.passport} />

      {p.description || p.categories.length > 0 ? (
        <Section title="About">
          {p.description ? <p className="whitespace-pre-line text-[15px] leading-relaxed">{p.description}</p> : null}
          {p.categories.length > 0 ? (
            <ul className="mt-4 flex flex-wrap gap-1.5" aria-label="Categories">
              {p.categories.map((c) => <li key={c} className="rounded-full tint-slate px-2.5 py-0.5 text-xs font-medium">{c}</li>)}
            </ul>
          ) : null}
        </Section>
      ) : null}

      {p.products.length > 0 ? (
        <Section title={`Products and services (${p.products.length})`}>
          <ul className="grid gap-4 sm:grid-cols-2">
            {p.products.map((x, i) => <li key={`${x.name}-${i}`}><Product x={x} /></li>)}
          </ul>
        </Section>
      ) : null}

      <Supply p={p} />

      {p.locations.length > 0 ? (
        <Section title="Where they supply from">
          <ul className="flex flex-wrap gap-2">
            {p.locations.map((l, i) => (
              <li key={i} className="rounded-lg border border-border px-3 py-1.5 text-sm">{[l.city, l.state, l.country].filter(Boolean).join(", ")}</li>
            ))}
          </ul>
        </Section>
      ) : null}

      <p className="text-center text-xs text-muted-foreground">
        Vendora checks identity and documents. It does not guarantee a supplier's quality, delivery or finances. Contact details stay private on Vendora.
      </p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-card">
      <h2 className="mb-4 text-xl font-semibold">{title}</h2>
      {children}
    </section>
  );
}

/** The gaps, said plainly: what is proven, what is not proven yet, and what is about to lapse. */
function TrustCoverage({ p }: { p: SupplierProfile }) {
  const have = new Set(p.passport.checks.map((c) => c.type));
  const missing = PROOFS.filter((t) => !have.has(t));
  const soon = p.passport.checks.filter((c) => c.expires_at && new Date(c.expires_at).getTime() - Date.now() <= 30 * DAY);
  if (missing.length === 0 && soon.length === 0) {
    return (
      <p className="flex items-center gap-2 rounded-xl tint-emerald px-4 py-3 text-sm font-medium">
        <ShieldCheck className="size-4 shrink-0" aria-hidden /> Registration, address and bank are all verified.
      </p>
    );
  }
  return (
    <div className="space-y-2" aria-label="What is not verified yet">
      {missing.length > 0 ? (
        <p className="flex items-start gap-2 rounded-xl tint-amber px-4 py-3 text-sm font-medium">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            Not verified yet: {missing.map((t) => TYPE_TITLE[t].toLowerCase()).join(", ")}.
            {have.size === 0 ? " Treat this supplier as unverified and ask for these documents before you pay." : ""}
          </span>
        </p>
      ) : null}
      {soon.map((c, i) => (
        <p key={i} className="flex items-start gap-2 rounded-xl tint-amber px-4 py-3 text-sm font-medium">
          <CalendarClock className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{c.type === "certificate" && c.label ? c.label : TYPE_TITLE[c.type]} proof expires on {fmtDate(c.expires_at)}.</span>
        </p>
      ))}
    </div>
  );
}

const AVAIL: Record<ProfileProduct["availability"], string> = {
  Available: "tint-emerald", "Made to order": "tint-blue", "Temporarily unavailable": "tint-amber",
};

function Product({ x }: { x: ProfileProduct }) {
  const price = money(x.price, x.currency);
  return (
    <article className="flex h-full gap-4 rounded-xl border border-border p-4">
      {x.image ? <img src={x.image} alt="" className="size-20 shrink-0 rounded-lg border border-border object-cover" loading="lazy" /> : null}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h3 className="font-semibold">{x.name}</h3>
          <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", AVAIL[x.availability] ?? "tint-slate")}>{x.availability}</span>
        </div>
        <p className="text-xs text-muted-foreground">{x.category}</p>
        {x.description ? <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">{x.description}</p> : null}
        {price || x.moq !== null ? (
          <p className="mt-2 text-sm">
            {price ? <span className="font-semibold">{price}{x.unit ? ` / ${x.unit}` : ""}</span> : null}
            {x.moq !== null ? <span className="text-muted-foreground">{price ? " · " : ""}Min. order {x.moq}{x.unit ? ` ${x.unit}` : ""}</span> : null}
          </p>
        ) : null}
      </div>
    </article>
  );
}

function Supply({ p }: { p: SupplierProfile }) {
  const c = p.capabilities;
  if (!c) return null;
  const rows: [string, string][] = [];
  if (c.coverage.length) rows.push(["Delivers to", c.coverage.join(", ")]);
  if (c.delivery_time) rows.push(["Delivery time", c.delivery_time]);
  if (c.min_order_value !== null) rows.push(["Minimum order value", money(c.min_order_value, c.currency)]);
  if (c.delivery_options.length) rows.push(["Delivery options", c.delivery_options.join(", ")]);
  if (c.pickup) rows.push(["Pickup available", c.pickup]);
  for (const [k, v] of Object.entries(c.details ?? {})) {
    const text = Array.isArray(v) ? v.join(", ") : (v ?? "");
    if (text && DETAIL_LABEL[k]) rows.push([DETAIL_LABEL[k], text]);
  }
  if (rows.length === 0) return null;
  return (
    <Section title="How they supply">
      <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-start gap-2">
            {k === "Delivery time" ? <Clock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden /> : k === "Delivers to" ? <Truck className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden /> : <Check className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />}
            <div>
              <dt className="text-xs text-muted-foreground">{k}</dt>
              <dd className="text-sm font-medium">{v}</dd>
            </div>
          </div>
        ))}
      </dl>
    </Section>
  );
}
