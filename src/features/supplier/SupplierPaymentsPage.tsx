import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Landmark, ShieldCheck } from "lucide-react";
import { useState } from "react";

import { PageHero } from "@/components/supplier/PageHero";
import { SupplierShell, useSupplier } from "@/components/supplier/SupplierShell";
import { DueLine, money, moneyShort, PayBadge, Stat } from "@/features/payments/PayParts";
import { listReceivables, matchesFilter, MSME_DISCLAIMER, PAYMENTS_KEY, type PayFilter } from "@/lib/msme-payments";
import { cn } from "@/lib/utils";

const card = "rounded-2xl border border-border bg-card p-6 shadow-card";
const TABS: { key: PayFilter; label: string }[] = [
  { key: "attention", label: "Needs attention" },
  { key: "open", label: "Open" },
  { key: "paid", label: "Paid" },
  { key: "all", label: "All" },
];

export function SupplierPaymentsPage() {
  return (
    <SupplierShell>
      <Inner />
    </SupplierShell>
  );
}

function Inner() {
  const { status, summary } = useSupplier();
  const orgId = summary?.id ?? "";
  const [tab, setTab] = useState<PayFilter>("open");
  const q = useQuery({ queryKey: [PAYMENTS_KEY, "receivables", orgId], queryFn: () => listReceivables(orgId, "all"), enabled: !!orgId });

  if (status === "loading" || (q.isLoading && !!orgId)) return <p className="py-16 text-center text-sm text-muted-foreground">Loading…</p>;
  if (!orgId || q.isError || !q.data) {
    return <p role="alert" className="py-16 text-center text-sm text-red-600">{q.error instanceof Error ? q.error.message : "We couldn't load your payments."}</p>;
  }
  const { summary: s, items, rules } = q.data;
  const rows = items.filter((i) => matchesFilter(i.state, tab, "supplier"));
  const count = (f: PayFilter) => items.filter((i) => matchesFilter(i.state, f, "supplier")).length;

  return (
    <div className="space-y-6">
      <PageHero label="Payments" icon={Landmark} title="When you'll be paid" glow="glow-emerald">
        Every confirmed order, with the date the buyer must pay by. Buyers don't pay anything to be on Vendora's payment tracker, and neither do you.
      </PageHero>

      {s.covered ? (
        <div className={cn(card, "flex gap-3 border-emerald-500/30 bg-emerald-500/5")}>
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-emerald-600" aria-hidden />
          <p className="text-sm">
            <strong>You're protected by the {rules.max_days}-day rule.</strong> Your Udyam registration ({s.udyam?.number}) is verified as {s.udyam?.size} · {s.udyam?.activity}.
            Buyers must pay you within the agreed time, never more than {rules.max_days} days after accepting the goods, or lose their tax deduction until they pay.
            You can claim interest on late payment.
          </p>
        </div>
      ) : s.udyam ? (
        <div className={card}>
          <p className="text-sm">Your verified Udyam registration shows a <strong>{s.udyam.size}</strong> enterprise doing <strong>{s.udyam.activity}</strong>. The {rules.max_days}-day rule covers micro and small manufacturers and service providers only, so the payment terms in each order apply to you.</p>
        </div>
      ) : (
        <div className={cn(card, "border-amber-500/30 bg-amber-500/5")}>
          <p className="text-sm">
            <strong>Switch on the {rules.max_days}-day protection.</strong> Add your Udyam registration to your Trust Passport. Once a reviewer verifies it, buyers are reminded before every
            deadline and lose their tax deduction if they pay you late. It's free.
          </p>
          <Link to="/supplier/verification" className="mt-3 inline-block text-sm font-semibold text-primary hover:underline">Add Udyam proof →</Link>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Expected to receive" value={moneyShort(s.expected_amount)} sub="across open orders" tone="blue" />
        <Stat label="Overdue" value={moneyShort(s.overdue_amount)} sub={`${s.overdue_count} order${s.overdue_count === 1 ? "" : "s"}`} tone={s.overdue_count ? "red" : "grey"} />
        <Stat label="Due within 7 days" value={moneyShort(s.due_soon_amount)} sub={`${s.due_soon_count} order${s.due_soon_count === 1 ? "" : "s"}`} tone={s.due_soon_count ? "amber" : "grey"} />
        <Stat label="Interest you can claim" value={moneyShort(s.interest_estimate)} sub="estimate" tone={s.interest_estimate > 0 ? "red" : "grey"} />
      </div>
      {s.to_confirm > 0 ? (
        <p className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-3 text-sm">
          {s.to_confirm} payment{s.to_confirm === 1 ? " is" : "s are"} waiting for you to confirm that the money arrived. Open the order and confirm it.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-1.5" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
            className={cn("rounded-full border px-3 py-1.5 text-xs font-medium transition", tab === t.key ? "border-primary/30 bg-primary/10 text-primary" : "bg-card text-muted-foreground hover:text-foreground")}>
            {t.label} <span className="ml-1 tabular opacity-70">{count(t.key)}</span>
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className={cn(card, "text-center text-sm text-muted-foreground")}>
          {items.length === 0 ? "When you confirm an order, the date you'll be paid appears here." : "Nothing here right now."}
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.id}>
              <Link to="/supplier/orders/$id" params={{ id: r.id }} className={cn(card, "flex flex-wrap items-center justify-between gap-3 py-4 transition hover:border-primary/40")}>
                <span>
                  <span className="block font-medium tabular">{r.number} · {r.buyer_name}</span>
                  <span className="block text-sm text-muted-foreground">{r.title}</span>
                  <span className="mt-1 block text-sm"><DueLine s={r.state} side="supplier" /></span>
                </span>
                <span className="text-right">
                  <span className="block text-lg font-semibold tabular">{money(r.state.balance)}</span>
                  <PayBadge status={r.state.status} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">{MSME_DISCLAIMER}</p>
    </div>
  );
}
