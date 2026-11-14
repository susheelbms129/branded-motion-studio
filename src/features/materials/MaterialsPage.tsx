import { Package, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
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
import { Can, type Column, DataTable, EmptyState, PageHeader } from "@/components/vendora/kit";
import { formatMoney } from "@/lib/format";
import { nameOf } from "@/lib/selectors";
import { useWs } from "@/lib/ws-store";
import type { Material } from "@/types/domain";

export function MaterialsPage() {
  const ws = useWs();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", categoryId: "", unit: "pcs", gstRate: "18", hsn: "" });
  const last = (id: string) =>
    ws.purchaseOrders
      .filter((p) => p.status !== "draft")
      .flatMap((p) =>
        p.lines.filter((l) => l.materialId === id).map((l) => ({ d: p.createdAt, v: l.unitPrice })),
      )
      .sort((a, b) => b.d.localeCompare(a.d))[0]?.v;
  const columns: Column<Material>[] = [
    {
      key: "n",
      header: "Material",
      sort: (a, b) => a.name.localeCompare(b.name),
      cell: (m) => (
        <div>
          <div className="font-medium">{m.name}</div>
          <div className="text-xs text-muted-foreground tabular">{m.sku}</div>
        </div>
      ),
    },
    { key: "c", header: "Category", cell: (m) => nameOf(ws.categories, m.categoryId) },
    { key: "u", header: "Unit", cell: (m) => m.unit },
    { key: "g", header: "GST", cell: (m) => <span className="tabular">{m.gstRate}%</span> },
    { key: "h", header: "HSN", cell: (m) => <span className="tabular">{m.hsn || "—"}</span> },
    {
      key: "p",
      header: "Last price",
      align: "right",
      cell: (m) => {
        const v = last(m.id);
        return v ? formatMoney(v, { decimals: 2 }) : "—";
      },
    },
    {
      key: "s",
      header: "Preferred supplier",
      cell: (m) => (m.preferredSupplierId ? nameOf(ws.suppliers, m.preferredSupplierId) : "—"),
    },
    {
      key: "x",
      header: "",
      cell: (m) => (
        <Can permission="material.manage">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Delete ${m.name}`}
            onClick={() => {
              ws.deleteMaterial(m.id);
              toast.success("Material removed");
            }}
          >
            <Trash2 />
          </Button>
        </Can>
      ),
    },
  ];
  return (
    <>
      <PageHeader
        title="Materials"
        accent="pink"
        crumbs={[{ label: "Materials" }]}
        description="What your company buys: the list every request, RFQ and order is built from, with units, HSN and GST rate."
        actions={
          <Can permission="material.manage">
            <Button onClick={() => setOpen(true)}>
              <Plus />
              Add material
            </Button>
          </Can>
        }
      />
      <DataTable
        rows={ws.materials}
        columns={columns}
        getId={(m) => m.id}
        searchText={(m) => `${m.name} ${m.sku} ${m.hsn}`}
        searchPlaceholder="Search materials…"
        empty={
          <EmptyState
            icon={Package}
            accent="pink"
            title="No materials yet"
            body="Add what you buy so requests stay consistent."
            action={
              <Can permission="material.manage">
                <Button onClick={() => setOpen(true)}>
                  <Plus />
                  Add material
                </Button>
              </Can>
            }
            className="border-0"
          />
        }
      />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add material</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label>Name</Label>
              <Input
                className="mt-1.5"
                value={f.name}
                onChange={(e) => setF({ ...f, name: e.target.value })}
              />
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
              <Label>Unit</Label>
              <Input
                className="mt-1.5"
                value={f.unit}
                onChange={(e) => setF({ ...f, unit: e.target.value })}
              />
            </div>
            <div>
              <Label>GST %</Label>
              <Select value={f.gstRate} onValueChange={(v) => setF({ ...f, gstRate: v })}>
                <SelectTrigger className="mt-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["0", "5", "12", "18", "28"].map((g) => (
                    <SelectItem key={g} value={g}>
                      {g}%
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>HSN</Label>
              <Input
                className="mt-1.5"
                value={f.hsn}
                onChange={(e) => setF({ ...f, hsn: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={f.name.trim().length < 2 || !f.categoryId}
              onClick={() => {
                ws.upsertMaterial({
                  name: f.name.trim(),
                  categoryId: f.categoryId,
                  unit: f.unit || "pcs",
                  gstRate: Number(f.gstRate),
                  hsn: f.hsn,
                });
                toast.success("Material added");
                setF({ name: "", categoryId: "", unit: "pcs", gstRate: "18", hsn: "" });
                setOpen(false);
              }}
            >
              Add material
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
