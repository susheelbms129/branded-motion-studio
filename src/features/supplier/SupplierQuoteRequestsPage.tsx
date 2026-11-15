import { Link } from "@tanstack/react-router";
import {
  AlertCircle,
  ArrowRight,
  CalendarClock,
  Inbox,
  MapPin,
  Package,
  RefreshCw,
  ShieldCheck,
  Users,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { SupplierShell, useSupplier } from "@/components/supplier/SupplierShell";
import { formatDate, formatMoney, type CurrencyCode } from "@/lib/format";
import { deadline, placeLine, STATE_LABEL } from "@/lib/quote-form";
import {
  listQuoteRequests,
  quoteError,
  type QuoteFilter,
  type QuoteRequestList,
  type QuoteRequestRow,
  type QuoteState,
} from "@/lib/quote-requests-api";
import { cn } from "@/lib/utils";

const card = "rounded-2xl border border-border bg-card shadow-card";

const STATE_TINT: Record<QuoteState, string> = {
  open: "tint-violet",
  quoted: "tint-green",
  declined: "tint-slate",
  closed: "tint-slate",
};
const DEADLINE_TINT = {
  none: "tint-slate",
  ok: "tint-emerald",
  soon: "tint-amber",
  late: "tint-red",
} as const;

const TABS: { key: QuoteFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "open", label: "Needs your quote" },
  { key: "quoted", label: "Quote sent" },
  { key: "declined", label: "Declined" },
  { key: "closed", label: "Closed" },
];

export function SupplierQuoteRequestsPage() {
  return (
    <SupplierShell>
      <InboxContent />
    </SupplierShell>
  );
}

function InboxContent() {
  const { summary, status: shell } = useSupplier();
  const orgId = summary?.id ?? null;
  const [data, setData] = useState<QuoteRequestList | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [tab, setTab] = useState<QuoteFilter>("all");

  const load = useCallback(async () => {
    if (!orgId) return;
    setStatus("loading");
    try {
      setData(await listQuoteRequests(orgId, "all"));
      setStatus("ready");
    } catch (e) {
      setError(quoteError(e));
      setStatus("error");
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(
    () => (data?.items ?? []).filter((r) => tab === "all" || r.state === tab),
    [data, tab],
  );
  const counts = data?.counts ?? {};
  const loading = shell === "loading" || status === "loading";

  if (shell === "error" || status === "error") {
    return (
      <div className={cn(card, "p-8 text-center")}>
        <AlertCircle className="mx-auto size-8 text-amber" aria-hidden />
        <h1 className="mt-3 text-xl font-semibold">We couldn't load your quote requests</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {error || "Please check your connection and try again."}
        </p>
        <button
          onClick={() => void load()}
          className="mt-5 inline-flex items-center gap-2 rounded-md bg-gradient-cta px-4 py-2 text-sm font-semibold text-white"
        >
          <RefreshCw className="size-4" aria-hidden /> Try again
        </button>
      </div>
    );
  }

  const open = counts.open ?? 0;
  const readyCount = (data?.items ?? []).filter((r) => r.ready === true).length;
  return (
    <div className="space-y-6">
      <header className="relative overflow-hidden rounded-3xl bg-gradient-navy p-6 text-white shadow-card sm:p-8">
        <div
          className="pointer-events-none absolute -right-20 -top-20 size-64 glow-violet opacity-40"
          aria-hidden
        />
        <div className="relative">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-white/70">
            <Inbox className="size-4" aria-hidden /> Quote requests
          </p>
          <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">
            {loading
              ? "Checking your inbox"
              : open > 0
                ? `${open} ${open === 1 ? "buyer is" : "buyers are"} waiting for your quote`
                : "You're all caught up"}
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-white/80">
            You're here because buyers can see your verified Trust Passport. Answering is always
            free: no lead fees, no paying to be seen.
          </p>
          {readyCount > 0 ? (
            <p className="mt-3 inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1.5 text-sm font-semibold">
              <Zap className="size-4" aria-hidden /> {readyCount} {readyCount === 1 ? "request is" : "requests are"} ready to send in one tap
            </p>
          ) : null}
        </div>
      </header>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter quote requests">
        {TABS.map((t) => {
          const n =
            t.key === "all" ? (data?.items.length ?? 0) : (counts[t.key as QuoteState] ?? 0);
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.key)}
              className={cn(
                "inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-medium transition",
                active
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold">{n}</span>
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="space-y-3" aria-busy>
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-2xl bg-muted" />
          ))}
        </div>
      ) : (data?.items.length ?? 0) === 0 ? (
        <EmptyInbox />
      ) : rows.length === 0 ? (
        <div className={cn(card, "p-8 text-center text-sm text-muted-foreground")}>
          Nothing here right now.
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.rfq_id}>
              <RequestCard r={r} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RequestCard({ r }: { r: QuoteRequestRow }) {
  const d = deadline(r.due_date);
  const place = placeLine(r.buyer_city, r.buyer_state);
  const cur = (
    ["INR", "USD", "EUR", "AED"].includes(r.currency) ? r.currency : "INR"
  ) as CurrencyCode;
  return (
    <Link
      to="/supplier/quote-requests/$id"
      params={{ id: r.rfq_id }}
      className={cn(card, "group block p-5 transition hover:border-primary/40 hover:shadow-glow")}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">{r.number}</p>
          <h2 className="mt-0.5 truncate text-lg font-semibold">{r.title}</h2>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{r.buyer_name}</span>
            {place ? (
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3.5" aria-hidden /> {place}
              </span>
            ) : null}
          </p>
        </div>
        <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", STATE_TINT[r.state])}>
          {STATE_LABEL[r.state]}
        </span>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 font-medium">
            <Package className="size-3.5" aria-hidden /> {r.item_count}{" "}
            {r.item_count === 1 ? "item" : "items"}
          </span>
          {r.state === "open" || r.state === "closed" ? (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-semibold",
                DEADLINE_TINT[d.tone],
              )}
            >
              <CalendarClock className="size-3.5" aria-hidden /> {d.label}
              {r.due_date ? ` · ${formatDate(r.due_date)}` : ""}
            </span>
          ) : null}
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 font-medium">
            <Users className="size-3.5" aria-hidden /> {r.invited}{" "}
            {r.invited === 1 ? "supplier" : "suppliers"} invited
          </span>
          {r.ready ? (
            <span className="inline-flex items-center gap-1 rounded-full tint-emerald px-2.5 py-1 font-semibold">
              <Zap className="size-3.5" aria-hidden /> Ready in one tap
            </span>
          ) : null}
          {r.my_total !== null ? (
            <span className="rounded-full tint-green px-2.5 py-1 font-semibold">
              Your landed price {formatMoney(r.my_total, { currency: cur })}
            </span>
          ) : null}
        </div>
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary transition group-hover:gap-2.5">
          {r.state === "open" ? "Send your quote" : "View"}{" "}
          <ArrowRight className="size-4" aria-hidden />
        </span>
      </div>
    </Link>
  );
}

function EmptyInbox() {
  return (
    <div className={cn(card, "p-8 text-center")}>
      <Inbox className="mx-auto size-9 text-primary" aria-hidden />
      <h2 className="mt-3 text-lg font-semibold">No quote requests yet</h2>
      <p className="mx-auto mt-1 max-w-xl text-sm text-muted-foreground">
        When a buyer sends you an RFQ, it lands here with the items, quantity and deadline. Buyers
        only invite suppliers whose Trust Passport is verified, so a stronger passport means more
        requests.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-3">
        <Link
          to="/supplier/verification"
          className="inline-flex items-center gap-2 rounded-md bg-gradient-cta px-4 py-2 text-sm font-semibold text-white shadow-glow"
        >
          <ShieldCheck className="size-4" aria-hidden /> Strengthen your Trust Passport
        </Link>
        <Link
          to="/supplier/products"
          className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2 text-sm font-semibold"
        >
          <Package className="size-4" aria-hidden /> Add products so quotes pre-fill
        </Link>
      </div>
    </div>
  );
}
