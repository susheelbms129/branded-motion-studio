import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Landmark } from "lucide-react";
import { useState } from "react";

import { type Column, DataTable, EmptyState, ErrorState, FilterTabs, PageHeader } from "@/components/vendora/kit";
import { formatDate } from "@/lib/format";
import { matchesFilter, listPayables, MSME_DISCLAIMER, PAYMENTS_KEY, type PayableRow, type PayFilter } from "@/lib/msme-payments";
import { appPath } from "@/lib/nav";
import { useUi } from "@/lib/ui-store";
import { DueLine, money, moneyShort, PayBadge, RuleNote, Stat } from "./PayParts";

const TABS: { key: PayFilter; label: string }[] = [
  { key: "attention", label: "Needs attention" },
  { key: "open", label: "Open" },
  { key: "paid", label: "Paid" },
  { key: "all", label: "All" },
];

/**
 * What to pay, in what order, and what it costs you if you don't. Micro and small suppliers must be paid within 45 days of
 * accepting the goods, or the expense can't be deducted until the year you actually pay. Vendora works the deadline out per order.
 */
export function PayablesPage() {
  const orgId = useUi((s) => s.orgId);
  return orgId ? <Real orgId={orgId} /> : (
    <>
      <PageHeader title="Payments" description="The 45-day payment tracker" accent="emerald" />
      <EmptyState icon={Landmark} title="Sign in with a company workspace" body="Payment tracking follows real purchase orders, so it isn't part of the demo workspace." />
    </>
  );
}

function Real({ orgId }: { orgId: string }) {
  const nav = useNavigate();
  const [tab, setTab] = useState<PayFilter>("attention");
  const q = useQuery({ queryKey: [PAYMENTS_KEY, "payables", orgId], queryFn: () => listPayables(orgId, "all") });
  if (q.isError) return <ErrorState {...(q.error instanceof Error ? { message: q.error.message } : {})} onRetry={() => void q.refetch()} />;
  if (q.isLoading || !q.data) return <p className="py-16 text-center text-sm text-muted-foreground">Loading payments…</p>;
  const { summary: s, items, rules } = q.data;
  const rows = items.filter((i) => matchesFilter(i.state, tab, "buyer"));
  const count = (f: PayFilter) => items.filter((i) => matchesFilter(i.state, f, "buyer")).length;
  const columns: Column<PayableRow>[] = [
    {
      key: "po", header: "Order", sort: (a, b) => a.number.localeCompare(b.number),
      cell: (r) => (<div><div className="font-medium tabular">{r.number}</div><div className="max-w-[240px] truncate text-xs text-muted-foreground">{r.title}</div></div>),
    },
    { key: "s", header: "Supplier", cell: (r) => (<div>{r.supplier_name}<div className="text-xs text-muted-foreground">{r.state.applies === "yes" ? `${r.state.applies_why} enterprise · ${r.state.due_days}-day limit` : r.state.applies === "no" ? "Agreed terms apply" : "Udyam not verified"}</div></div>) },
    { key: "d", header: "Deadline", cell: (r) => <DueLine s={r.state} side="buyer" /> },
    { key: "o", header: "Owed", align: "right", sort: (a, b) => a.state.balance - b.state.balance, cell: (r) => <span className="tabular">{money(r.state.balance)}</span> },
    { key: "st", header: "Status", cell: (r) => <PayBadge status={r.state.status} /> },
  ];

  return (
    <>
      <PageHeader
        title="Payments"
        description="Pay micro and small suppliers on time and keep your tax deduction"
        accent="emerald"
        crumbs={[{ label: "Payments" }]}
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Overdue" tone={s.overdue_count ? "red" : "grey"} value={moneyShort(s.overdue_amount)} sub={`${s.overdue_count} order${s.overdue_count === 1 ? "" : "s"}`} />
        <Stat label="Due within 7 days" tone={s.due_soon_count ? "amber" : "grey"} value={moneyShort(s.due_soon_amount)} sub={`${s.due_soon_count} order${s.due_soon_count === 1 ? "" : "s"}`} />
        <Stat label={`Pay before ${formatDate(s.year_end)}`} tone={s.at_risk_count ? "amber" : "grey"} value={moneyShort(s.at_risk_amount)} sub="deduction at risk this year" />
        <Stat label="Interest you may owe" tone={s.interest_estimate > 0 ? "red" : "grey"} value={moneyShort(s.interest_estimate)} sub="estimate, 3 x RBI bank rate" />
      </div>
      {s.unknown_count > 0 ? (
        <div className="mb-3"><RuleNote>
          {s.unknown_count} order{s.unknown_count === 1 ? " is" : "s are"} with suppliers who haven't verified a Udyam registration, so we can't tell whether the {rules.max_days}-day rule applies.
          The dates shown use the safe reading. Ask them to add their Udyam proof to their Trust Passport.
        </RuleNote></div>
      ) : null}
      <FilterTabs tabs={TABS.map((t) => ({ ...t, count: count(t.key) }))} value={tab} onChange={(k) => setTab(k as PayFilter)} />
      {items.length === 0 ? (
        <EmptyState icon={Landmark} title="Nothing to pay yet" body="When a supplier confirms an order and you record its delivery, the payment deadline appears here." accent="emerald" />
      ) : rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Nothing here. You're up to date.</p>
      ) : (
        <DataTable columns={columns} rows={rows} getId={(r) => r.id} onRowClick={(r) => nav({ to: appPath(`purchase-orders/${r.id}`) as never })} />
      )}
      <p className="mt-4 text-xs text-muted-foreground">{MSME_DISCLAIMER}</p>
    </>
  );
}
