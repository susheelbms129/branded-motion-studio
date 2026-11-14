import { Link } from "@tanstack/react-router";
import { AlertCircle, ArrowRight, CalendarClock, MapPin, ReceiptText, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { asCurrency } from "@/features/pos/OrderParts";
import { SupplierShell, useSupplier } from "@/components/supplier/SupplierShell";
import { formatDate, formatMoney } from "@/lib/format";
import {
  listSupplierOrders,
  type OrderFilter,
  type OrderState,
  orderError,
  type SupplierOrderList,
  type SupplierOrderRow,
} from "@/lib/orders-api";
import { placeLine } from "@/lib/quote-form";
import { cn } from "@/lib/utils";

const card = "rounded-2xl border border-border bg-card shadow-card";
const TINT: Record<OrderState, string> = { new: "tint-violet", confirmed: "tint-green", declined: "tint-slate" };
const LABEL: Record<OrderState, string> = { new: "Needs your confirmation", confirmed: "Confirmed", declined: "Declined" };
const TABS: { key: OrderFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "new", label: "To confirm" },
  { key: "confirmed", label: "Confirmed" },
  { key: "declined", label: "Declined" },
];

export function SupplierOrdersPage() {
  return (
    <SupplierShell>
      <OrdersContent />
    </SupplierShell>
  );
}

function OrdersContent() {
  const { summary, status: shell } = useSupplier();
  const orgId = summary?.id ?? null;
  const [data, setData] = useState<SupplierOrderList | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [tab, setTab] = useState<OrderFilter>("all");

  const load = useCallback(async () => {
    if (!orgId) return;
    setStatus("loading");
    try {
      setData(await listSupplierOrders(orgId, "all"));
      setStatus("ready");
    } catch (e) {
      setError(orderError(e));
      setStatus("error");
    }
  }, [orgId]);
  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => (data?.items ?? []).filter((r) => tab === "all" || r.state === tab), [data, tab]);
  const counts = data?.counts ?? {};
  const loading = shell === "loading" || status === "loading";

  if (shell === "error" || status === "error") {
    return (
      <div className={cn(card, "p-8 text-center")}>
        <AlertCircle className="mx-auto size-8 text-amber" aria-hidden />
        <h1 className="mt-3 text-xl font-semibold">We couldn't load your orders</h1>
        <p className="mt-1 text-sm text-muted-foreground">{error || "Please check your connection and try again."}</p>
        <button
          onClick={() => void load()}
          className="mt-5 inline-flex items-center gap-2 rounded-md bg-gradient-cta px-4 py-2 text-sm font-semibold text-white"
        >
          <RefreshCw className="size-4" aria-hidden /> Try again
        </button>
      </div>
    );
  }

  const waiting = counts.new ?? 0;
  return (
    <div className="space-y-6">
      <header className="relative overflow-hidden rounded-3xl bg-gradient-navy p-6 text-white shadow-card sm:p-8">
        <div className="relative">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-white/70">
            <ReceiptText className="size-4" aria-hidden /> Orders received
          </p>
          <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">
            {loading
              ? "Checking your orders"
              : waiting > 0
                ? `${waiting} ${waiting === 1 ? "order is" : "orders are"} waiting for your confirmation`
                : "No orders waiting"}
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-white/80">
            Each order is built from the quote you sent, so the price and terms match exactly. Receiving orders is always free.
          </p>
        </div>
      </header>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter orders">
        {TABS.map((t) => {
          const n = t.key === "all" ? (data?.items.length ?? 0) : (counts[t.key as OrderState] ?? 0);
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.key)}
              className={cn(
                "inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-medium transition",
                active ? "border-primary bg-primary/10 text-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground",
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
          {[0, 1].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-2xl bg-muted" />
          ))}
        </div>
      ) : (data?.items.length ?? 0) === 0 ? (
        <div className={cn(card, "p-8 text-center")}>
          <ReceiptText className="mx-auto size-9 text-primary" aria-hidden />
          <h2 className="mt-3 text-lg font-semibold">No orders yet</h2>
          <p className="mx-auto mt-1 max-w-xl text-sm text-muted-foreground">
            When a buyer awards you their RFQ, the order lands here for you to confirm. Send sharp quotes from{" "}
            <Link to="/supplier/quote-requests" className="font-medium text-primary underline">
              Quote requests
            </Link>{" "}
            to win more.
          </p>
        </div>
      ) : rows.length === 0 ? (
        <div className={cn(card, "p-8 text-center text-sm text-muted-foreground")}>Nothing here right now.</div>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.id}>
              <OrderCard r={r} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function OrderCard({ r }: { r: SupplierOrderRow }) {
  const place = placeLine(r.buyer_city, r.buyer_state);
  return (
    <Link
      to="/supplier/orders/$id"
      params={{ id: r.id }}
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
        <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", TINT[r.state])}>{LABEL[r.state]}</span>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full tint-green px-2.5 py-1 font-semibold">
            Order value {formatMoney(r.total, { currency: asCurrency(r.currency) })}
          </span>
          {r.expected_at ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 font-medium">
              <CalendarClock className="size-3.5" aria-hidden /> Deliver by {formatDate(r.expected_at)}
            </span>
          ) : null}
        </div>
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary transition group-hover:gap-2.5">
          {r.state === "new" ? "Review & confirm" : "View"} <ArrowRight className="size-4" aria-hidden />
        </span>
      </div>
    </Link>
  );
}
