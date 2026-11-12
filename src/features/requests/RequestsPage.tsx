import { useNavigate, useSearch } from "@tanstack/react-router";
import { ClipboardList, Download, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Can,
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
import { downloadCsv, nameOf, requestTotal } from "@/lib/selectors";
import { useWs } from "@/lib/ws-store";
import type { PurchaseRequest } from "@/types/domain";

const TABS = [
  "all",
  "draft",
  "pending_approval",
  "approved",
  "rejected",
  "converted_to_rfq",
  "completed",
] as const;

export function RequestsPage() {
  const ws = useWs();
  const status = (useSearch({ strict: false }) as { status?: string }).status ?? "all";
  const nav = useNavigate();
  const rows = ws.requests.filter((r) => status === "all" || r.status === status);
  const columns: Column<PurchaseRequest>[] = [
    {
      key: "number",
      header: "Request",
      sort: (a, b) => a.createdAt.localeCompare(b.createdAt),
      cell: (r) => (
        <div>
          <div className="font-medium tabular">{r.number}</div>
          <div className="max-w-[280px] truncate text-xs text-muted-foreground">{r.title}</div>
        </div>
      ),
    },
    { key: "requester", header: "Requester", cell: (r) => nameOf(ws.members, r.requesterId) },
    { key: "category", header: "Category", cell: (r) => nameOf(ws.categories, r.categoryId) },
    {
      key: "priority",
      header: "Priority",
      cell: (r) => <StatusBadge kind="priority" value={r.priority} />,
    },
    {
      key: "needed",
      header: "Needed by",
      sort: (a, b) => a.neededBy.localeCompare(b.neededBy),
      cell: (r) => <span className="tabular">{formatDate(r.neededBy)}</span>,
    },
    {
      key: "amount",
      header: "Est. amount",
      align: "right",
      sort: (a, b) => requestTotal(a.items) - requestTotal(b.items),
      cell: (r) => formatMoney(requestTotal(r.items)),
    },
    {
      key: "status",
      header: "Status",
      cell: (r) => <StatusBadge kind="request" value={r.status} />,
    },
  ];
  return (
    <>
      <PageHeader
        title="Purchase Requests"
        accent="blue"
        crumbs={[{ label: "Purchase Requests" }]}
        description="Raise, approve and convert requests into RFQs. The status filter lives in the URL so you can share a view."
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => {
                downloadCsv("requests.csv", [
                  ["Number", "Title", "Status", "Amount"],
                  ...rows.map((r) => [r.number, r.title, r.status, requestTotal(r.items)]),
                ]);
                toast.success("Exported requests");
              }}
            >
              <Download />
              CSV
            </Button>
            <Can permission="request.create">
              <Button asChild>
                <AppLink to="requests/new">
                  <Plus />
                  New request
                </AppLink>
              </Button>
            </Can>
          </>
        }
      />
      <FilterTabs
        value={status}
        onChange={(t) =>
          void nav({
            to: appPath("requests") as never,
            search: (t === "all" ? {} : { status: t }) as never,
            replace: true,
          })
        }
        tabs={TABS.map((t) => ({
          key: t,
          label: t === "all" ? "All" : statusLabel("request", t),
          count:
            t === "all" ? ws.requests.length : ws.requests.filter((r) => r.status === t).length,
        }))}
      />
      <DataTable
        rows={rows}
        columns={columns}
        getId={(r) => r.id}
        searchText={(r) => `${r.number} ${r.title} ${nameOf(ws.members, r.requesterId)}`}
        searchPlaceholder="Search requests…"
        initialSort={{ key: "number", dir: "desc" }}
        onRowClick={(r) => void nav({ to: appPath(`requests/${r.id}`) as never })}
        empty={
          <EmptyState
            icon={ClipboardList}
            title={ws.requests.length ? "No requests in this view" : "No purchase requests yet"}
            body={
              ws.requests.length
                ? "Try another status tab or clear your search."
                : "Every purchase starts as a request. Raise one, route it for approval, then convert it to an RFQ."
            }
            action={
              <Can permission="request.create">
                <Button asChild>
                  <AppLink to="requests/new">
                    <Plus />
                    Create your first request
                  </AppLink>
                </Button>
              </Can>
            }
            className="border-0"
          />
        }
      />
    </>
  );
}
