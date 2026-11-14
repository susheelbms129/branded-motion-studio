import { useQuery } from "@tanstack/react-query";
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
import { listRequests, type RequestRow } from "@/lib/requests-api";
import { downloadCsv, nameOf, requestTotal } from "@/lib/selectors";
import { useUi } from "@/lib/ui-store";
import { useWs } from "@/lib/ws-store";
import { REQUESTS_KEY } from "./use-requests";
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

/** Demo workspace only (nobody signed in to a real company): sample data held in memory. */
function RequestsDemo() {
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

/** A real company: every request comes from the database. */
function RequestsReal({ orgId }: { orgId: string }) {
  const status = (useSearch({ strict: false }) as { status?: string }).status ?? "all";
  const nav = useNavigate();
  const q = useQuery({
    queryKey: [REQUESTS_KEY, "list", orgId, status],
    queryFn: () => listRequests(orgId, status),
  });
  const rows = q.data?.items ?? [];
  const counts = q.data?.counts ?? {};
  const all = Object.values(counts).reduce((a, b) => a + (b ?? 0), 0);
  const columns: Column<RequestRow>[] = [
    {
      key: "number",
      header: "Request",
      sort: (a, b) => a.created_at.localeCompare(b.created_at),
      cell: (r) => (
        <div>
          <div className="font-medium tabular">{r.number}</div>
          <div className="max-w-[280px] truncate text-xs text-muted-foreground">{r.title}</div>
        </div>
      ),
    },
    { key: "requester", header: "Requester", cell: (r) => r.requester_name },
    { key: "category", header: "Category", cell: (r) => r.category || "—" },
    { key: "priority", header: "Priority", cell: (r) => <StatusBadge kind="priority" value={r.priority} /> },
    {
      key: "needed",
      header: "Needed by",
      sort: (a, b) => (a.needed_by ?? "").localeCompare(b.needed_by ?? ""),
      cell: (r) => <span className="tabular">{formatDate(r.needed_by)}</span>,
    },
    {
      key: "amount",
      header: "Est. amount",
      align: "right",
      sort: (a, b) => a.total - b.total,
      cell: (r) => formatMoney(r.total),
    },
    {
      key: "status",
      header: "Status",
      cell: (r) => (
        <div>
          <StatusBadge kind="request" value={r.status} />
          {r.status === "pending_approval" && r.waiting_on ? (
            <div className="mt-1 text-[11px] text-muted-foreground">Waiting on {r.waiting_on}</div>
          ) : null}
        </div>
      ),
    },
  ];
  return (
    <>
      <PageHeader
        title="Purchase Requests"
        accent="blue"
        crumbs={[{ label: "Purchase Requests" }]}
        description="Raise a request, get it approved, then send it to suppliers. The status filter lives in the URL so you can share a view."
        actions={
          <>
            <Button
              variant="outline"
              disabled={rows.length === 0}
              onClick={() => {
                downloadCsv("requests.csv", [
                  ["Number", "Title", "Requester", "Status", "Amount"],
                  ...rows.map((r) => [r.number, r.title, r.requester_name, r.status, r.total]),
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
          count: t === "all" ? all : (counts[t] ?? 0),
        }))}
      />
      {q.isError ? (
        <EmptyState
          icon={ClipboardList}
          title="We couldn't load your requests"
          body={q.error instanceof Error ? q.error.message : "Please check your connection and try again."}
          action={<Button onClick={() => void q.refetch()}>Try again</Button>}
        />
      ) : q.isLoading ? (
        <p className="py-16 text-center text-sm text-muted-foreground">Loading requests…</p>
      ) : (
        <DataTable
          rows={rows}
          columns={columns}
          getId={(r) => r.id}
          searchText={(r) => `${r.number} ${r.title} ${r.requester_name} ${r.category}`}
          searchPlaceholder="Search requests…"
          initialSort={{ key: "number", dir: "desc" }}
          onRowClick={(r) => void nav({ to: appPath(`requests/${r.id}`) as never })}
          empty={
            <EmptyState
              icon={ClipboardList}
              title={all ? "No requests in this view" : "No purchase requests yet"}
              body={
                all
                  ? "Try another status tab or clear your search."
                  : "Every purchase starts as a request. Raise one, route it for approval, then send it to verified suppliers."
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
      )}
    </>
  );
}

export function RequestsPage() {
  const orgId = useUi((s) => s.orgId);
  return orgId ? <RequestsReal orgId={orgId} /> : <RequestsDemo />;
}
