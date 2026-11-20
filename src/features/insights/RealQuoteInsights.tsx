import { useQuery } from "@tanstack/react-query";
import { Scale } from "lucide-react";

import { AppLink } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { detail, getQuoteInsights, headline, inr, nextStep, toneOf, type Tone } from "@/lib/quote-insights";

const TONE: Record<Tone, string> = {
  high: "bg-destructive/10 text-destructive",
  medium: "bg-amber-500/10 text-amber-700",
  good: "bg-emerald-500/10 text-emerald-700",
  neutral: "bg-muted text-muted-foreground",
};

/** Real insights from the buyer's own awarded RFQs: what they paid against every real quote they received. */
export function RealQuoteInsights({ orgId }: { orgId: string }) {
  const q = useQuery({ queryKey: ["quote-insights", orgId], queryFn: () => getQuoteInsights(orgId) });
  if (q.isLoading)
    return (
      <p className="mb-4 text-sm text-muted-foreground" role="status">
        Reading your quotes…
      </p>
    );
  if (q.isError || !q.data)
    return (
      <p role="alert" className="mb-4 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
        {q.error instanceof Error ? q.error.message : "We couldn't load your insights."}
      </p>
    );
  const d = q.data;
  const s = d.summary;
  const more = s.vs_average_total > 0;
  return (
    <section className="mb-6 rounded-2xl border bg-card p-5 shadow-card" aria-label="Paid versus quotes">
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <Scale className="size-4" aria-hidden /> What you paid vs the quotes you received
      </h2>
      {d.items.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          This fills in after you award an RFQ that received at least 2 quotes. Then you will see how your price compares with the
          market, from your own real quotes.
        </p>
      ) : (
        <>
          <p className="mt-2 text-sm text-muted-foreground">
            Across {s.orders} awarded {s.orders === 1 ? "order" : "orders"} you paid{" "}
            <strong className={cn(more ? "text-destructive" : "text-emerald-700")}>
              {inr(s.vs_average_total)} {more ? "more" : "less"}
            </strong>{" "}
            than the average quote ({s.below_average} below average, {s.above_average} above).
            {s.saved_vs_dearest_total > 0 ? ` Against the most expensive quotes you avoided ${inr(s.saved_vs_dearest_total)}.` : ""}
          </p>
          <ul className="mt-4 space-y-3">
            {d.items.map((r) => {
              const next = nextStep(r);
              return (
                <li key={r.po_id} className="rounded-xl border p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{headline(r)}</span>
                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", TONE[toneOf(r)])}>
                      {r.pct_vs_average > 0 ? "+" : ""}
                      {r.pct_vs_average}%
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {r.title} · {r.po_number} · you paid {inr(r.paid)}
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">{detail(r)}</p>
                  {next ? <p className="mt-2 text-sm">{next}</p> : null}
                  <AppLink to={`purchase-orders/${r.po_id}`} className="mt-2 inline-block text-xs font-semibold text-primary">
                    Open {r.po_number}
                  </AppLink>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
