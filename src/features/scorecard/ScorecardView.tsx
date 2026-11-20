import { useQuery } from "@tanstack/react-query";
import { Award, CalendarClock, Clock, Handshake, PackageCheck, ShieldCheck, Users } from "lucide-react";

import {
  badgeProgress, deliveryHeadline, deliverySegments, getSupplierScorecard, monthLabel, monthOnTimePct, monthYear, nextBadge, outcomeText,
  replyHeadline, type Scorecard, type ScorecardBadge,
} from "@/lib/scorecard-api";
import { cn } from "@/lib/utils";

const card = "rounded-2xl border border-border bg-card p-6 shadow-card";
const SEG: Record<string, string> = {
  early: "bg-emerald-600", on_time: "bg-emerald-400", late_1_3: "bg-amber-400", late_4_plus: "bg-red-500",
};
const BADGE_ICON: Record<ScorecardBadge["key"], typeof Award> = {
  fast_replies: Clock, on_time_record: PackageCheck, repeat_buyers: Handshake, clean_record: ShieldCheck,
};

/** Loads and shows the scorecard for the profile (buyer) and the supplier's own page (self). */
export function ScorecardSection({ orgId, variant }: { orgId: string; variant: "buyer" | "self" }) {
  const q = useQuery({ queryKey: ["scorecard", orgId], queryFn: () => getSupplierScorecard(orgId), enabled: !!orgId });
  if (q.isLoading) return <p className="text-sm text-muted-foreground">Loading the scorecard…</p>;
  if (q.isError || !q.data) return null; // the scorecard is extra evidence: the page around it still works
  return <ScorecardView card={q.data} variant={variant} />;
}

/**
 * The record a supplier has EARNED from real RFQs and orders. Every number shows how many real events stand behind it,
 * percentages appear only after enough of them, and nothing here can be bought, edited or self-reported.
 */
export function ScorecardView({ card: c, variant }: { card: Scorecard; variant: "buyer" | "self" | "public" }) {
  const earned = c.badges.filter((b) => b.earned);
  const open = variant === "self" ? c.badges.filter((b) => !b.earned) : [];
  const next = variant === "self" ? nextBadge(c.badges) : null;
  const segs = deliverySegments(c.delivery);
  const segTotal = segs.reduce((a, s) => a + s.n, 0);
  const maxOrders = Math.max(1, ...c.months.map((m) => m.orders));
  return (
    <section className={card} aria-label="Supplier scorecard">
      <h2 className="flex items-center gap-2 text-lg font-semibold"><Award className="size-5" aria-hidden /> Scorecard</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Earned from real orders in the last 12 months. Vendora logs reply times, and buyers record deliveries. Nobody can pay to change or edit it.
        {c.is_new ? " This supplier is new, so there is no record yet." : ""}
      </p>

      {earned.length > 0 || open.length > 0 ? (
        <ul className="mt-4 grid gap-2 sm:grid-cols-2" aria-label="Badges">
          {earned.map((b) => {
            const Icon = BADGE_ICON[b.key];
            return (
              <li key={b.key} className="flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3">
                <Icon className="mt-0.5 size-5 shrink-0 text-emerald-600" aria-hidden />
                <span><span className="block text-sm font-semibold">{b.title} <span className="sr-only">(earned)</span></span><span className="block text-xs text-muted-foreground">{b.rule}</span></span>
              </li>
            );
          })}
          {open.map((b) => {
            const Icon = BADGE_ICON[b.key];
            const p = badgeProgress(b);
            return (
              <li key={b.key} className="flex items-start gap-3 rounded-xl border border-border bg-muted/40 p-3">
                <Icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{b.title}</span>
                  <span className="block text-xs text-muted-foreground">{b.rule}</span>
                  {p ? (
                    <>
                      <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-border" role="progressbar" aria-label={`${b.title} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.pct}>
                        <span className="block h-full rounded-full bg-primary" style={{ width: `${p.pct}%` }} />
                      </span>
                      <span className="mt-1 block text-xs">{b.have} of {b.need} {b.unit}: {p.left}</span>
                    </>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
      {next ? <p className="mt-3 text-sm">Nearest badge: <strong>{next.title}</strong>, {badgeProgress(next)?.left} to go.</p> : null}

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <div className="rounded-xl bg-muted/50 p-4">
          <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Clock className="size-4" aria-hidden /> Replies</h3>
          <p className="mt-2 text-lg font-semibold">{replyHeadline(c.replies, c.min_samples)}</p>
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
            <li>{c.replies.rfqs_counted} RFQ{c.replies.rfqs_counted === 1 ? "" : "s"} counted, {c.replies.quoted} quoted</li>
            {c.replies.answered_pct !== null ? <li>{c.replies.answered_pct}% answered (a clear "no" counts)</li> : null}
            {c.replies.within_24h_pct !== null ? <li>{c.replies.within_24h_pct}% of quotes within 24 hours</li> : null}
          </ul>
        </div>
        <div className="rounded-xl bg-muted/50 p-4">
          <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><PackageCheck className="size-4" aria-hidden /> Delivery</h3>
          <p className="mt-2 text-lg font-semibold">{deliveryHeadline(c.delivery, c.min_samples)}</p>
          {segTotal > 0 ? (
            <>
              <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-border" role="img" aria-label={segs.map((s) => `${s.n} ${s.label.toLowerCase()}`).join(", ")}>
                {segs.map((s) => <span key={s.key} className={cn("h-full", SEG[s.key])} style={{ width: `${(100 * s.n) / segTotal}%` }} />)}
              </div>
              <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                {segs.map((s) => <li key={s.key} className="flex items-center gap-2"><span className={cn("size-2 rounded-full", SEG[s.key])} aria-hidden />{s.n} {s.label.toLowerCase()}</li>)}
              </ul>
            </>
          ) : null}
          <p className={cn("mt-2 text-sm", c.delivery.cancelled_after_confirming > 0 ? "font-medium text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>
            {c.delivery.cancelled_after_confirming > 0
              ? `Confirmed, then cancelled: ${c.delivery.cancelled_after_confirming}`
              : "Never cancelled an order it had confirmed"}
          </p>
        </div>
        <div className="rounded-xl bg-muted/50 p-4">
          <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Users className="size-4" aria-hidden /> Buyers</h3>
          <p className="mt-2 text-lg font-semibold">{c.buyers.different} different buyer{c.buyers.different === 1 ? "" : "s"}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            {c.buyers.repeat > 0 ? `${c.buyers.repeat} came back for another order` : c.buyers.different > 0 ? "None has reordered yet" : "No completed orders yet"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Many orders from one buyer is still one buyer.</p>
        </div>
      </div>

      <div className="mt-5">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><CalendarClock className="size-4" aria-hidden /> Last six months</h3>
        <ol className="mt-3 grid grid-cols-6 gap-2" aria-label="Deliveries by month">
          {c.months.map((m) => {
            const pct = monthOnTimePct(m);
            return (
              <li key={m.month} className="text-center">
                <div className="mx-auto flex h-20 w-full max-w-[44px] items-end overflow-hidden rounded-md bg-muted" role="img"
                  aria-label={m.orders === 0 ? `${monthLabel(m.month)}: no deliveries` : `${monthLabel(m.month)}: ${m.on_time} of ${m.orders} on time`}>
                  {m.orders > 0 ? (
                    <div className={cn("w-full", pct !== null && pct >= 90 ? "bg-emerald-500" : pct !== null && pct >= 70 ? "bg-amber-400" : "bg-red-500")}
                      style={{ height: `${Math.max(8, (100 * m.orders) / maxOrders)}%` }} />
                  ) : null}
                </div>
                <p className="mt-1 text-xs font-medium">{monthLabel(m.month)}</p>
                <p className="text-xs text-muted-foreground">{m.orders === 0 ? "none" : `${m.on_time}/${m.orders} on time`}</p>
              </li>
            );
          })}
        </ol>
        <p className="mt-1 text-xs text-muted-foreground">Bar height is the number of deliveries that month. Colour shows the on-time share, and the words say the same.</p>
      </div>

      {c.recent.length > 0 ? (
        <div className="mt-5">
          <h3 className="text-sm font-semibold">Latest results</h3>
          <ul className="mt-2 divide-y divide-border rounded-xl border border-border">
            {c.recent.map((o, i) => (
              <li key={`${o.month}-${i}`} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span>{outcomeText(o)}</span>
                <span className="text-xs text-muted-foreground">{monthYear(o.month)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-muted-foreground">Month and result only. Buyers' names and order values are never shown.</p>
        </div>
      ) : null}

      <p className="mt-4 text-xs text-muted-foreground">
        A percentage or a typical time appears only after {c.min_samples} real events, so a thin record looks thin.
        {c.excluded_same_group > 0 ? ` ${c.excluded_same_group} order${c.excluded_same_group === 1 ? "" : "s"} between companies of the same group ${c.excluded_same_group === 1 ? "was" : "were"} not counted.` : ""}
      </p>
    </section>
  );
}
