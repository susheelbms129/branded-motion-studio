import { useNavigate } from "@tanstack/react-router";
import { Download, ReceiptText } from "lucide-react";
import { useState } from "react";
import { differenceInCalendarDays, parseISO } from "date-fns";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  type Column,
  DataTable,
  EmptyState,
  FilterTabs,
  PageHeader,
  StatusBadge,
  statusLabel,
} from "@/components/vendora/kit";
import { formatDate, formatMoney } from "@/lib/format";
import { AppLink, appPath } from "@/lib/nav";
import { downloadCsv, nameOf, poTotals } from "@/lib/selectors";
import { useWs } from "@/lib/ws-store";
import type { PurchaseOrder } from "@/types/domain";

const TABS = [
  "all",
  "issued",
  "acknowledged",
  "partially_received",
  "received",
  "closed",
  "cancelled",
] as const;

export function PurchaseOrdersPage() {
  const ws = useWs();
  const nav = useNavigate();
  const [tab, setTab] = useState("all");
  const rows = ws.purchaseOrders.filter((p) => tab === "all" || p.status === tab);
  const late = (p: PurchaseOrder) =>
    !p.deliveredAt &&
    ["issued", "acknowledged", "partially_received"].includes(p.status) &&
    differenceInCalendarDays(new Date(), parseISO(p.expectedAt)) > 0;
  const columns: Column<PurchaseOrder>[] = [
    {
      key: "n",
      header: "PO",
      sort: (a, b) => a.createdAt.localeCompare(b.createdAt),
      cell: (p) => <span className="font-medium tabular">{p.number}</span>,
    },
    { key: "s", header: "Supplier", cell: (p) => nameOf(ws.suppliers, p.supplierId) },
    { key: "c", header: "Category", cell: (p) => nameOf(ws.categories, p.categoryId) },
    {
      key: "e",
      header: "Expected",
      sort: (a, b) => a.expectedAt.localeCompare(b.expectedAt),
      cell: (p) => (
        <span className="tabular">
          {formatDate(p.expectedAt)}
          {late(p) ? (
            <span className="ml-1.5 tint-red rounded-full px-1.5 py-0.5 text-[10px]">Overdue</span>
          ) : null}
        </span>
      ),
    },
    {
      key: "t",
      header: "Total",
      align: "right",
      sort: (a, b) => poTotals(a).total - poTotals(b).total,
      cell: (p) => formatMoney(poTotals(p).total),
    },
    { key: "st", header: "Status", cell: (p) => <StatusBadge kind="po" value={p.status} /> },
  ];
  return (
    <>
      <PageHeader
        title="Purchase Orders"
        accent="emerald"
        crumbs={[{ label: "Purchase Orders" }]}
        description="Track every order from issue to delivery and invoice match."
        actions={
          <Button
            variant="outline"
            onClick={() => {
              downloadCsv("purchase-orders.csv", [
                ["PO", "Supplier", "Status", "Total"],
                ...rows.map((p) => [
                  p.number,
                  nameOf(ws.suppliers, p.supplierId),
                  p.status,
                  poTotals(p).total,
                ]),
              ]);
              toast.success("Exported purchase orders");
            }}
          >
            <Download />
            CSV
          </Button>
        }
      />
      <FilterTabs
        value={tab}
        onChange={setTab}
        tabs={TABS.map((t) => ({
          key: t,
          label: t === "all" ? "All" : statusLabel("po", t),
          count:
            t === "all"
              ? ws.purchaseOrders.length
              : ws.purchaseOrders.filter((p) => p.status === t).length,
        }))}
      />
      <DataTable
        rows={rows}
        columns={columns}
        getId={(p) => p.id}
        searchText={(p) => `${p.number} ${nameOf(ws.suppliers, p.supplierId)}`}
        searchPlaceholder="Search orders…"
        initialSort={{ key: "n", dir: "desc" }}
        onRowClick={(p) => void nav({ to: appPath(`purchase-orders/${p.id}`) as never })}
        empty={
          <EmptyState
            icon={ReceiptText}
            accent="emerald"
            title="No purchase orders yet"
            body="Orders are created when you award an RFQ to a supplier."
            action={
              <Button asChild>
                <AppLink to="rfqs">Go to RFQs</AppLink>
              </Button>
            }
            className="border-0"
          />
        }
      />
    </>
  );
}
