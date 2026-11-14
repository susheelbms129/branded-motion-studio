import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ReceiptText } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  type Column,
  DataTable,
  EmptyState,
  ErrorState,
  FilterTabs,
  PageHeader,
  StatusBadge,
  statusLabel,
} from "@/components/vendora/kit";
import { formatDate, formatMoney } from "@/lib/format";
import { AppLink, appPath } from "@/lib/nav";
import { type BuyerOrderRow, listPurchaseOrders, ORDERS_KEY } from "@/lib/orders-api";
import { asCurrency } from "./OrderParts";

const TABS = ["all", "issued", "acknowledged", "partially_received", "received", "closed", "cancelled"] as const;

/** A real company: every order comes from the database. */
export function PurchaseOrdersReal({ orgId }: { orgId: string }) {
  const nav = useNavigate();
  const [tab, setTab] = useState("all");
  const q = useQuery({
    queryKey: [ORDERS_KEY, "list", orgId, tab],
    queryFn: () => listPurchaseOrders(orgId, tab),
  });
  const counts = q.data?.counts ?? {};
  const all = Object.values(counts).reduce((a, b) => a + (b ?? 0), 0);
  const columns: Column<BuyerOrderRow>[] = [
    {
      key: "n",
      header: "PO",
      sort: (a, b) => a.number.localeCompare(b.number),
      cell: (r) => (
        <div>
          <div className="font-medium tabular">{r.number}</div>
          <div className="max-w-[260px] truncate text-xs text-muted-foreground">{r.title}</div>
        </div>
      ),
    },
    { key: "s", header: "Supplier", cell: (r) => r.supplier_name },
    {
      key: "e",
      header: "Expected",
      sort: (a, b) => (a.expected_at ?? "").localeCompare(b.expected_at ?? ""),
      cell: (r) => <span className="tabular">{formatDate(r.expected_at)}</span>,
    },
    {
      key: "t",
      header: "Total",
      align: "right",
      sort: (a, b) => a.total - b.total,
      cell: (r) => formatMoney(r.total, { currency: asCurrency(r.currency) }),
    },
    { key: "st", header: "Status", cell: (r) => <StatusBadge kind="po" value={r.status} /> },
  ];
  return (
    <>
      <PageHeader
        title="Purchase Orders"
        accent="emerald"
        crumbs={[{ label: "Purchase Orders" }]}
        description="Orders awarded from your RFQs. Suppliers confirm or decline each one, and you are told straight away."
      />
      <FilterTabs
        value={tab}
        onChange={setTab}
        tabs={TABS.map((t) => ({
          key: t,
          label: t === "all" ? "All" : statusLabel("po", t),
          count: t === "all" ? all : (counts[t] ?? 0),
        }))}
      />
      {q.isError ? (
        <ErrorState
          {...(q.error instanceof Error ? { message: q.error.message } : {})}
          onRetry={() => void q.refetch()}
        />
      ) : q.isLoading ? (
        <p className="py-16 text-center text-sm text-muted-foreground">Loading orders…</p>
      ) : (
        <DataTable
          rows={q.data?.items ?? []}
          columns={columns}
          getId={(r) => r.id}
          searchText={(r) => `${r.number} ${r.title} ${r.supplier_name}`}
          searchPlaceholder="Search orders…"
          initialSort={{ key: "n", dir: "desc" }}
          onRowClick={(r) => void nav({ to: appPath(`purchase-orders/${r.id}`) as never })}
          empty={
            <EmptyState
              icon={ReceiptText}
              accent="emerald"
              title="No purchase orders yet"
              body="Compare the quotes on an RFQ and award the best one. The order is created from the supplier's own quote."
              action={
                <Button asChild>
                  <AppLink to="rfqs">Go to RFQs</AppLink>
                </Button>
              }
              className="border-0"
            />
          }
        />
      )}
    </>
  );
}
