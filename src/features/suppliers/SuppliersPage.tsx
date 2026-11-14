import { useNavigate } from "@tanstack/react-router";
import { Plus, SearchCheck, Truck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Can,
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

export function SuppliersPage() {
  const ws = useWs();
  const perf = usePerf();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
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
        description="Your vendor directory with performance scored purely from real orders and quotes."
        actions={
          <>
            <Button variant="outline" asChild>
              <AppLink to="find-suppliers">
                <SearchCheck />
                Find suppliers on Vendora
              </AppLink>
            </Button>
            <Can permission="supplier.manage">
              <Button onClick={() => setOpen(true)}>
                <Plus />
                Add supplier
              </Button>
            </Can>
          </>
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
            title="No suppliers yet"
            body="Add the vendors you buy from. Scores appear after a few deliveries."
            action={
              <Can permission="supplier.manage">
                <Button onClick={() => setOpen(true)}>
                  <Plus />
                  Add your first supplier
                </Button>
              </Can>
            }
            className="border-0"
          />
        }
      />
      <AddSupplier open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function AddSupplier({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ws = useWs();
  const [f, setF] = useState({
    name: "",
    city: "",
    state: "",
    email: "",
    gstin: "",
    categoryId: "",
    terms: "30",
  });
  const ok = f.name.trim().length > 2 && f.categoryId;
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF({ ...f, [k]: e.target.value });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add supplier</DialogTitle>
          <DialogDescription>You can add contacts later.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label>Company name</Label>
            <Input className="mt-1.5" value={f.name} onChange={set("name")} />
          </div>
          <div>
            <Label>City</Label>
            <Input className="mt-1.5" value={f.city} onChange={set("city")} />
          </div>
          <div>
            <Label>State</Label>
            <Input className="mt-1.5" value={f.state} onChange={set("state")} />
          </div>
          <div>
            <Label>Email</Label>
            <Input type="email" className="mt-1.5" value={f.email} onChange={set("email")} />
          </div>
          <div>
            <Label>GSTIN</Label>
            <Input className="mt-1.5" value={f.gstin} onChange={set("gstin")} />
          </div>
          <div>
            <Label>Category</Label>
            <Select value={f.categoryId} onValueChange={(v) => setF({ ...f, categoryId: v })}>
              <SelectTrigger className="mt-1.5">
                <SelectValue placeholder="Choose" />
              </SelectTrigger>
              <SelectContent>
                {ws.categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Payment terms (days)</Label>
            <Input type="number" className="mt-1.5" value={f.terms} onChange={set("terms")} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!ok}
            onClick={() => {
              ws.upsertSupplier({
                name: f.name.trim(),
                city: f.city,
                state: f.state,
                email: f.email,
                gstin: f.gstin,
                categoryIds: [f.categoryId],
                paymentTermsDays: Number(f.terms) || 30,
              });
              toast.success("Supplier added");
              setF({
                name: "",
                city: "",
                state: "",
                email: "",
                gstin: "",
                categoryId: "",
                terms: "30",
              });
              onClose();
            }}
          >
            Add supplier
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
