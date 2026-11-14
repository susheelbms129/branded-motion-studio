import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { FileSpreadsheet } from "lucide-react";
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
import { formatDate } from "@/lib/format";
import { AppLink, appPath } from "@/lib/nav";
import { listRfqs, RFQ_KEY, type RfqRow } from "@/lib/rfqs-api";

const TABS = ["all", "sent", "evaluating", "awarded", "closed"] as const;

/** A real company: every RFQ comes from the database. */
export function RfqsReal({ orgId }: { orgId: string }) {
  const nav = useNavigate();
  const [tab, setTab] = useState("all");
  const q = useQuery({
    queryKey: [RFQ_KEY, "list", orgId, tab],
    queryFn: () => listRfqs(orgId, tab),
  });
  const counts = q.data?.counts ?? {};
  const all = Object.values(counts).reduce((a, b) => a + (b ?? 0), 0);
  const columns: Column<RfqRow>[] = [
    {
      key: "n",
      header: "RFQ",
      sort: (a, b) => a.created_at.localeCompare(b.created_at),
      cell: (r) => (
        <div>
          <div className="font-medium tabular">{r.number}</div>
          <div className="max-w-[280px] truncate text-xs text-muted-foreground">{r.title}</div>
        </div>
      ),
    },
    { key: "cat", header: "Category", cell: (r) => r.category || "—" },
    {
      key: "inv",
      header: "Suppliers",
      cell: (r) => (
        <span className="tabular">
          {r.quoted} / {r.invited} quoted
        </span>
      ),
    },
    {
      key: "due",
      header: "Due",
      sort: (a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""),
      cell: (r) => <span className="tabular">{formatDate(r.due_date)}</span>,
    },
    { key: "st", header: "Status", cell: (r) => <StatusBadge kind="rfq" value={r.status} /> },
  ];
  return (
    <>
      <PageHeader
        title="RFQs & Quotations"
        accent="violet"
        crumbs={[{ label: "RFQs" }]}
        description="Collect quotes from verified suppliers, compare total landed cost and award the best offer."
      />
      <FilterTabs
        value={tab}
        onChange={setTab}
        tabs={TABS.map((t) => ({
          key: t,
          label: t === "all" ? "All" : statusLabel("rfq", t),
          count: t === "all" ? all : (counts[t] ?? 0),
        }))}
      />
      {q.isError ? (
        <ErrorState
          {...(q.error instanceof Error ? { message: q.error.message } : {})}
          onRetry={() => void q.refetch()}
        />
      ) : q.isLoading ? (
        <p className="py-16 text-center text-sm text-muted-foreground">Loading RFQs…</p>
      ) : (
        <DataTable
          rows={q.data?.items ?? []}
          columns={columns}
          getId={(r) => r.id}
          searchText={(r) => `${r.number} ${r.title} ${r.request_number ?? ""}`}
          searchPlaceholder="Search RFQs…"
          initialSort={{ key: "n", dir: "desc" }}
          onRowClick={(r) => void nav({ to: appPath(`rfqs/${r.id}`) as never })}
          empty={
            <EmptyState
              icon={FileSpreadsheet}
              accent="violet"
              title="No RFQs yet"
              body="Approve a purchase request, then send it to verified suppliers to collect quotations."
              action={
                <Button asChild>
                  <AppLink to="requests">Go to requests</AppLink>
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
