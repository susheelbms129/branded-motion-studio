import { useQuery } from "@tanstack/react-query";
import {
  Clock,
  Download,
  Hourglass,
  Lightbulb,
  ShieldAlert,
  ShieldCheck,
  Trophy,
} from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Panel } from "@/components/vendora/kit";
import { formatDate, formatMoney, type CurrencyCode } from "@/lib/format";
import {
  comparisonCsv,
  compareQuotes,
  PRIORITIES,
  type Priority,
  type QuoteView,
} from "@/lib/quote-compare";
import { getRfqQuotes } from "@/lib/rfq-quotes-api";
import { LEVEL_NAMES, RFQ_KEY, type RfqItem } from "@/lib/rfqs-api";
import { cn } from "@/lib/utils";

const CURRENCIES: CurrencyCode[] = ["INR", "USD", "EUR", "AED"];
const GOOD = "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";

/**
 * Real quotes for one RFQ, compared on TOTAL LANDED COST (items + GST + freight + other charges), not the sticker price.
 * Nothing here can be bought: the order is cost, speed, payment terms and Trust Passport level. Expired quotes are shown
 * but never recommended. Reads only; turning a winner into a purchase order is the next task.
 */
export function RfqQuotesComparison({
  rfqId,
  rfqNumber,
  items,
  waiting,
}: {
  rfqId: string;
  rfqNumber: string;
  items: RfqItem[];
  /** Suppliers invited who have not answered yet. */
  waiting: number;
}) {
  const [priority, setPriority] = useState<Priority>("balanced");
  const q = useQuery({
    queryKey: [RFQ_KEY, "quotes", rfqId],
    queryFn: () => getRfqQuotes(rfqId),
    retry: false,
    refetchInterval: 30_000,
  });
  const currency = (CURRENCIES as string[]).includes(q.data?.currency ?? "")
    ? (q.data!.currency as CurrencyCode)
    : "INR";
  const money = (n: number, decimals = 0) => formatMoney(n, { currency, decimals });
  const cmp = useMemo(
    () =>
      q.data
        ? compareQuotes(q.data.quotes, q.data.today, priority, (n) => formatMoney(n, { currency }))
        : null,
    [q.data, priority, currency],
  );

  if (q.isLoading)
    return (
      <Panel title="Quotations">
        <p className="text-sm text-muted-foreground">Loading quotes…</p>
      </Panel>
    );
  if (q.error || !cmp)
    return (
      <Panel title="Quotations">
        <p className="text-sm text-red-600 dark:text-red-400">
          {q.error instanceof Error ? q.error.message : "Could not load quotes."}
        </p>
      </Panel>
    );
  if (cmp.views.length === 0)
    return (
      <Panel title="Quotations">
        <div className="flex items-start gap-3 text-sm text-muted-foreground">
          <Hourglass className="mt-0.5 size-4 shrink-0" />
          <p>
            No quotes yet.{" "}
            {waiting > 0
              ? `${waiting} supplier${waiting === 1 ? " has" : "s have"} not replied.`
              : "Every invited supplier has replied without a quote."}{" "}
            Quotes appear here the moment a supplier sends one, compared on total landed cost.
          </p>
        </div>
      </Panel>
    );

  const { views, pick, insights, stats, bestLinePrice } = cmp;
  const best = (f: (v: QuoteView) => number, lower: boolean) => {
    const vals = views.filter((v) => !v.expired).map(f);
    return vals.length > 1 ? (lower ? Math.min(...vals) : Math.max(...vals)) : null;
  };
  const bestTotal = best((v) => v.landed.total, true);
  const bestDays = best((v) => v.quote.delivery_days, true);
  const bestTerms = best((v) => v.quote.payment_terms_days, false);

  const download = () => {
    const blob = new Blob([comparisonCsv(items, cmp)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${rfqNumber}-quote-comparison.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const cell = (v: QuoteView, good: boolean, content: React.ReactNode, strong = false) => (
    <td
      key={v.quote.quote_id}
      className={cn(
        "px-4 py-2.5 text-right tabular align-top",
        v.expired && "opacity-50",
        strong && "font-semibold",
        good && !v.expired && GOOD,
      )}
    >
      {content}
    </td>
  );
  const th =
    "sticky left-0 z-10 bg-card px-4 py-2.5 text-left text-xs font-medium text-muted-foreground";

  return (
    <Panel
      title="Quotations"
      description={`${views.length} quote${views.length === 1 ? "" : "s"} compared on total landed cost${
        waiting > 0 ? ` · ${waiting} still waiting` : ""
      }`}
      action={
        <Button variant="outline" size="sm" onClick={download}>
          <Download className="mr-1.5 size-4" /> CSV
        </Button>
      }
      bodyClassName="space-y-4 p-0 pt-4"
    >
      <div className="space-y-4 px-6">
        <div className="flex flex-wrap gap-2" role="group" aria-label="What matters most">
          {PRIORITIES.map((p) => (
            <button
              key={p.id}
              type="button"
              title={p.hint}
              aria-pressed={priority === p.id}
              onClick={() => setPriority(p.id)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                priority === p.id
                  ? "border-primary bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>

        {pick ? (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                  <Trophy className="size-3.5" />
                  {views.length === 1 ? "Only quote so far" : "Best match for your priority"}
                </p>
                <p className="mt-1 truncate text-base font-semibold">{pick.quote.name}</p>
                <p className="text-xs text-muted-foreground">
                  {[pick.quote.city, pick.quote.state].filter(Boolean).join(", ") || "—"}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xl font-semibold tabular">{money(pick.landed.total)}</p>
                <p className="text-xs text-muted-foreground">total landed cost</p>
              </div>
            </div>
            {pick.reasons.length > 0 || stats.pickSavesVsAverage > 0 ? (
              <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                {stats.pickSavesVsAverage > 0 && views.length > 1 ? (
                  <li>{money(stats.pickSavesVsAverage)} below the average quote</li>
                ) : null}
                {pick.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-800 dark:text-amber-300">
            Every quote received has expired. Ask suppliers to send a revised quote.
          </p>
        )}

        {insights.length > 0 ? (
          <ul className="space-y-2">
            {insights.map((t) => (
              <li key={t} className="flex items-start gap-2 text-sm text-muted-foreground">
                <Lightbulb className="mt-0.5 size-4 shrink-0 text-amber-500" />
                <span>{t}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="overflow-x-auto border-t">
        <table className="w-full min-w-max text-sm">
          <thead>
            <tr className="border-b bg-muted/40 align-top">
              <th className={cn(th, "bg-muted")}>Supplier</th>
              {views.map((v) => (
                <th
                  key={v.quote.quote_id}
                  className={cn("min-w-44 px-4 py-3 text-right", v.expired && "opacity-60")}
                >
                  <p className="text-xs font-medium text-muted-foreground">
                    {v.expired ? "Expired" : `#${v.rank}`}
                    {v.fit !== null ? ` · ${v.fit} fit` : ""}
                  </p>
                  <p className="font-semibold">{v.quote.name}</p>
                  <p className="text-xs font-normal text-muted-foreground">
                    {[v.quote.city, v.quote.state].filter(Boolean).join(", ") || "—"}
                  </p>
                  <p
                    className={cn(
                      "mt-1 flex items-center justify-end gap-1 text-xs font-normal",
                      v.lapsed
                        ? "text-amber-700 dark:text-amber-400"
                        : "text-emerald-700 dark:text-emerald-400",
                    )}
                  >
                    {v.lapsed ? (
                      <ShieldAlert className="size-3.5" />
                    ) : (
                      <ShieldCheck className="size-3.5" />
                    )}
                    {v.quote.level_now > 0 ? LEVEL_NAMES[v.quote.level_now] : "Proof lapsed"}
                  </p>
                  {v.quote.revision > 1 ? (
                    <p className="text-xs font-normal text-muted-foreground">
                      Revised ×{v.quote.revision - 1}
                    </p>
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {items.map((it) => (
              <tr key={it.id}>
                <th className={th}>
                  {it.description}
                  <span className="block font-normal">
                    {it.qty} {it.unit}
                  </span>
                </th>
                {views.map((v) => {
                  const price = v.quote.lines.find((l) => l.item_id === it.id)?.unit_price;
                  return cell(
                    v,
                    price !== undefined && views.length > 1 && price === bestLinePrice[it.id],
                    price === undefined ? "—" : `${money(price, 2)} / ${it.unit}`,
                  );
                })}
              </tr>
            ))}
            <tr>
              <th className={th}>Items subtotal</th>
              {views.map((v) => cell(v, false, money(v.landed.subtotal, 2)))}
            </tr>
            <tr>
              <th className={th}>GST</th>
              {views.map((v) => cell(v, false, `${money(v.landed.gst, 2)} (${v.quote.gst_rate}%)`))}
            </tr>
            <tr>
              <th className={th}>Freight</th>
              {views.map((v) => cell(v, false, money(v.landed.shipping, 2)))}
            </tr>
            <tr>
              <th className={th}>Other charges</th>
              {views.map((v) => cell(v, false, money(v.landed.otherCharges, 2)))}
            </tr>
            <tr className="bg-muted/30">
              <th className={cn(th, "bg-muted text-foreground")}>Total landed cost</th>
              {views.map((v) =>
                cell(
                  v,
                  bestTotal !== null && v.landed.total === bestTotal,
                  <>
                    {money(v.landed.total, 2)}
                    {!v.expired && v.aboveLowest > 0 ? (
                      <span className="block text-xs font-normal text-muted-foreground">
                        +{money(v.aboveLowest)} ({v.aboveLowestPct}%) vs lowest
                      </span>
                    ) : null}
                  </>,
                  true,
                ),
              )}
            </tr>
            <tr>
              <th className={th}>Delivery</th>
              {views.map((v) =>
                cell(
                  v,
                  bestDays !== null && v.quote.delivery_days === bestDays,
                  `${v.quote.delivery_days} days`,
                ),
              )}
            </tr>
            <tr>
              <th className={th}>Payment terms</th>
              {views.map((v) =>
                cell(
                  v,
                  bestTerms !== null && v.quote.payment_terms_days === bestTerms,
                  `${v.quote.payment_terms_days} days`,
                ),
              )}
            </tr>
            <tr>
              <th className={th}>Valid until</th>
              {views.map((v) =>
                cell(
                  v,
                  false,
                  <span
                    className={cn(
                      v.expired && "text-red-600 dark:text-red-400",
                      v.expiresSoon && "text-amber-700 dark:text-amber-400",
                    )}
                  >
                    {formatDate(v.quote.valid_until)}
                    {v.expired
                      ? " · expired"
                      : v.expiresSoon
                        ? ` · ${v.daysLeft} day${v.daysLeft === 1 ? "" : "s"} left`
                        : ""}
                  </span>,
                ),
              )}
            </tr>
            <tr>
              <th className={th}>Replied</th>
              {views.map((v) =>
                cell(
                  v,
                  false,
                  <span className="inline-flex items-center gap-1">
                    <Clock className="size-3.5 text-muted-foreground" />
                    {v.replyHours === null
                      ? formatDate(v.quote.received_at)
                      : v.replyHours < 1
                        ? "within an hour"
                        : v.replyHours < 48
                          ? `after ${Math.round(v.replyHours)} h`
                          : `after ${Math.round(v.replyHours / 24)} days`}
                  </span>,
                ),
              )}
            </tr>
            {views.some((v) => v.quote.notes) ? (
              <tr>
                <th className={th}>Supplier note</th>
                {views.map((v) => (
                  <td
                    key={v.quote.quote_id}
                    className="max-w-56 whitespace-pre-wrap px-4 py-2.5 text-right align-top text-xs text-muted-foreground"
                  >
                    {v.quote.notes || "—"}
                  </td>
                ))}
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <p className="px-6 pb-5 text-xs text-muted-foreground">
        Ranked by cost, delivery, payment terms and Trust Passport level. No supplier can pay for a
        better position.
      </p>
    </Panel>
  );
}
