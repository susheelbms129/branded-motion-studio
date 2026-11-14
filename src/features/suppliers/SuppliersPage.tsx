import { useNavigate } from "@tanstack/react-router";
import { SearchCheck, Truck } from "lucide-react";

import { SavedSuppliersList } from "@/features/directory/SavedSuppliersList";
import { useUi } from "@/lib/ui-store";

import { Button } from "@/components/ui/button";
import {
  type Column,
  DataTable,
  EmptyState,
  PageHeader,
  StatusBadge,
} from "@/components/vendora/kit";
import { AppLink, appPath } from "@/lib/nav";
import { nameOf } from "@/lib/selectors";
import { usePerf } from "@/lib/use-perf";
import { useWs } from "@/lib/ws-store";
import type { Supplier } from "@/types/domain";

/** Real company workspace: the saved shortlist. The demo workspace keeps its sample vendor table. */
export function SuppliersPage() {
  const demo = useUi((s) => s.demo);
  return demo ? <DemoSuppliers /> : <SavedSuppliers />;
}

function SavedSuppliers() {
  return (
    <>
      <PageHeader
        title="Saved suppliers"
        accent="amber"
        crumbs={[{ label: "Saved suppliers" }]}
        description="Your shortlist of verified suppliers, shared with your whole team."
        actions={
          <Button asChild>
            <AppLink to="find-suppliers">
              <SearchCheck />
              Find suppliers on Vendora
            </AppLink>
          </Button>
        }
      />
      <SavedSuppliersList />
    </>
  );
}

function DemoSuppliers() {
  const ws = useWs();
  const perf = usePerf();
  const nav = useNavigate();
  const columns: Column<Supplier>[] = [
    {
      key: "n",
      header: "Supplier",
      sort: (a, b) => a.name.localeCompare(b.name),
      cell: (s) => (
        <div>
          <div className="font-medium">{s.name}</div>
          <div className="text-xs text-muted-foreground">
            {s.city}, {s.state}
          </div>
        </div>
      ),
    },
    {
      key: "c",
      header: "Categories",
      cell: (s) => (
        <span className="text-xs">
          {s.categoryIds.map((c) => nameOf(ws.categories, c)).join(", ")}
        </span>
      ),
    },
    {
      key: "t",
      header: "Terms",
      cell: (s) => <span className="tabular">{s.paymentTermsDays} days</span>,
    },
    {
      key: "o",
      header: "On-time",
      sort: (a, b) => (perf[a.id]?.onTimeRate ?? -1) - (perf[b.id]?.onTimeRate ?? -1),
      cell: (s) =>
        perf[s.id]?.onTimeRate != null ? (
          <span className="tabular">{Math.round((perf[s.id]?.onTimeRate ?? 0) * 100)}%</span>
        ) : (
          <span className="text-xs text-muted-foreground">Not enough data</span>
        ),
    },
    {
      key: "sc",
      header: "Score",
      sort: (a, b) => (perf[a.id]?.score ?? -1) - (perf[b.id]?.score ?? -1),
      cell: (s) =>
        perf[s.id]?.score != null ? (
          <span className="font-semibold tabular">{perf[s.id]?.score}</span>
        ) : (
          "—"
        ),
    },
    { key: "st", header: "Status", cell: (s) => <StatusBadge kind="supplier" value={s.status} /> },
  ];
  return (
    <>
      <PageHeader
        title="My Suppliers"
        accent="amber"
        crumbs={[{ label: "My Suppliers" }]}
        description="The suppliers you buy from, with performance scored purely from real orders and quotes."
        actions={
          <Button asChild>
            <AppLink to="find-suppliers">
              <SearchCheck />
              Find suppliers on Vendora
            </AppLink>
          </Button>
        }
      />
      <DataTable
        rows={ws.suppliers}
        columns={columns}
        getId={(s) => s.id}
        searchText={(s) => `${s.name} ${s.city} ${s.gstin}`}
        searchPlaceholder="Search suppliers…"
        onRowClick={(s) => void nav({ to: appPath(`suppliers/${s.id}`) as never })}
        empty={
          <EmptyState
            icon={Truck}
            accent="amber"
            title="No suppliers here yet"
            body="Browse verified suppliers on Vendora. Scores appear after a few deliveries."
            action={
              <Button asChild>
                <AppLink to="find-suppliers">
                  <SearchCheck />
                  Find suppliers
                </AppLink>
              </Button>
            }
            className="border-0"
          />
        }
      />
    </>
  );
}
