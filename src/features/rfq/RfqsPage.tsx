import { useNavigate } from "@tanstack/react-router";
import { FileSpreadsheet } from "lucide-react";
import { useState } from "react";

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
import { formatDate } from "@/lib/format";
import { AppLink, appPath } from "@/lib/nav";
import { nameOf } from "@/lib/selectors";
import { useWs } from "@/lib/ws-store";
import type { Rfq } from "@/types/domain";

const TABS = ["all", "draft", "sent", "evaluating", "awarded"] as const;

export function RfqsPage() {
  const ws = useWs();
  const nav = useNavigate();
  const [tab, setTab] = useState("all");
  const rows = ws.rfqs.filter((r) => tab === "all" || r.status === tab);
  const columns: Column<Rfq>[] = [
    {
      key: "n",
      header: "RFQ",
      sort: (a, b) => a.createdAt.localeCompare(b.createdAt),
      cell: (r) => (
        <div>
          <div className="font-medium tabular">{r.number}</div>
          <div className="max-w-[280px] truncate text-xs text-muted-foreground">{r.title}</div>
        </div>
      ),
    },
    { key: "cat", header: "Category", cell: (r) => nameOf(ws.categories, r.categoryId) },
    {
      key: "inv",
      header: "Suppliers",
      cell: (r) => (
        <span className="tabular">
          {r.invites.filter((i) => i.status === "quoted").length} / {r.invites.length} quoted
        </span>
      ),
    },
    {
      key: "due",
      header: "Due",
      sort: (a, b) => a.dueDate.localeCompare(b.dueDate),
      cell: (r) => <span className="tabular">{formatDate(r.dueDate)}</span>,
    },
    { key: "st", header: "Status", cell: (r) => <StatusBadge kind="rfq" value={r.status} /> },
  ];
  return (
    <>
      <PageHeader
        title="RFQs & Quotations"
        accent="violet"
        crumbs={[{ label: "RFQs" }]}
        description="Collect quotes from suppliers, compare total landed cost and award the best offer."
      />
      <FilterTabs
        value={tab}
        onChange={setTab}
        tabs={TABS.map((t) => ({
          key: t,
          label: t === "all" ? "All" : statusLabel("rfq", t),
          count: t === "all" ? ws.rfqs.length : ws.rfqs.filter((r) => r.status === t).length,
        }))}
      />
      <DataTable
        rows={rows}
        columns={columns}
        getId={(r) => r.id}
        searchText={(r) => `${r.number} ${r.title}`}
        searchPlaceholder="Search RFQs…"
        initialSort={{ key: "n", dir: "desc" }}
        onRowClick={(r) => void nav({ to: appPath(`rfqs/${r.id}`) as never })}
        empty={
          <EmptyState
            icon={FileSpreadsheet}
            accent="violet"
            title="No RFQs yet"
            body="Approve a purchase request, then convert it to an RFQ to invite suppliers to quote."
            action={
              <Button asChild>
                <AppLink to="requests">Go to requests</AppLink>
              </Button>
            }
            className="border-0"
          />
        }
      />
    </>
  );
}
