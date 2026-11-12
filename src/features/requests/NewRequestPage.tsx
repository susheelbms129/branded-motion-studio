import { zodResolver } from "@hookform/resolvers/zod";
import { addDays, format } from "date-fns";
import { Package, Plus, Trash2 } from "lucide-react";
import { useFieldArray, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, PageHeader, Panel } from "@/components/vendora/kit";
import { formatMoney } from "@/lib/format";
import { AppLink, useAppNavigate } from "@/lib/nav";
import { useActor, useWs } from "@/lib/ws-store";

const schema = z.object({
  title: z.string().min(3, "Give the request a short title"),
  categoryId: z.string().min(1, "Choose a category"),
  department: z.string().min(2, "Enter a department"),
  priority: z.enum(["low", "medium", "high", "urgent"]),
  neededBy: z.string().min(1, "Pick a delivery date"),
  justification: z.string().min(10, "Add a short justification (10+ characters)"),
  items: z
    .array(
      z.object({
        materialId: z.string().min(1, "Choose a material"),
        qty: z.coerce.number().positive("Qty must be above 0"),
        unitPrice: z.coerce.number().min(0, "Price can't be negative"),
      }),
    )
    .min(1),
});
type FormValues = {
  title: string;
  categoryId: string;
  department: string;
  priority: "low" | "medium" | "high" | "urgent";
  neededBy: string;
  justification: string;
  items: { materialId: string; qty: number; unitPrice: number }[];
};

export function NewRequestPage() {
  const ws = useWs();
  const actor = useActor();
  const go = useAppNavigate();
  const form = useForm<FormValues>({
    resolver: zodResolver(schema) as never,
    defaultValues: {
      title: "",
      categoryId: "",
      department: "",
      priority: "medium",
      neededBy: format(addDays(new Date(), 14), "yyyy-MM-dd"),
      justification: "",
      items: [{ materialId: "", qty: 1, unitPrice: 0 }],
    },
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "items" });
  const { errors } = form.formState;

  if (ws.materials.length === 0)
    return (
      <>
        <PageHeader
          title="New purchase request"
          crumbs={[{ label: "Purchase Requests", to: "requests" }, { label: "New" }]}
        />
        <EmptyState
          icon={Package}
          accent="pink"
          title="Add a material first"
          body="Requests are built from your products & materials catalogue so units and GST stay consistent."
          action={
            <Button asChild>
              <AppLink to="materials">Go to materials</AppLink>
            </Button>
          }
        />
      </>
    );

  const items = form.watch("items"),
    cat = form.watch("categoryId");
  const total = items.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.unitPrice) || 0), 0);
  const mats = ws.materials.filter((m) => !cat || m.categoryId === cat);
  const lastPrice = (mid: string) =>
    ws.purchaseOrders
      .filter((p) => p.status !== "draft")
      .flatMap((p) =>
        p.lines
          .filter((l) => l.materialId === mid)
          .map((l) => ({ d: p.createdAt, v: l.unitPrice })),
      )
      .sort((a, b) => b.d.localeCompare(a.d))[0]?.v;

  const submit = (flag: boolean) =>
    form.handleSubmit((v) => {
      const r = ws.createRequest(
        {
          ...v,
          submit: flag,
          items: v.items.map((i) => {
            const m = ws.materials.find((x) => x.id === i.materialId);
            return {
              materialId: i.materialId,
              description: m?.name ?? "",
              unit: m?.unit ?? "pcs",
              qty: i.qty,
              unitPrice: i.unitPrice,
            };
          }),
        },
        { actorId: actor },
      );
      toast.success(`${r.number} ${flag ? "submitted for approval" : "saved as draft"}`);
      go(`requests/${r.id}`);
    })();
  const err = (m?: string) => (m ? <p className="mt-1 text-xs text-destructive">{m}</p> : null);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit(true);
      }}
    >
      <PageHeader
        title="New purchase request"
        description="Estimated prices default to your last purchase price — edit if needed."
        crumbs={[{ label: "Purchase Requests", to: "requests" }, { label: "New request" }]}
        actions={
          <>
            <Button type="button" variant="outline" onClick={() => void submit(false)}>
              Save draft
            </Button>
            <Button type="submit">Submit for approval</Button>
          </>
        }
      />
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Panel title="Request details">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label htmlFor="title">Title</Label>
                <Input
                  id="title"
                  className="mt-1.5"
                  placeholder="e.g. MS plates for Line 3 fabrication"
                  {...form.register("title")}
                />
                {err(errors.title?.message)}
              </div>
              <div>
                <Label>Category</Label>
                <Select
                  value={form.watch("categoryId")}
                  onValueChange={(v) => form.setValue("categoryId", v, { shouldValidate: true })}
                >
                  <SelectTrigger className="mt-1.5">
                    <SelectValue placeholder="Choose category" />
                  </SelectTrigger>
                  <SelectContent>
                    {ws.categories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {err(errors.categoryId?.message)}
              </div>
              <div>
                <Label htmlFor="dept">Department</Label>
                <Input
                  id="dept"
                  className="mt-1.5"
                  placeholder="Production"
                  {...form.register("department")}
                />
                {err(errors.department?.message)}
              </div>
              <div>
                <Label>Priority</Label>
                <Select
                  value={form.watch("priority")}
                  onValueChange={(v) => form.setValue("priority", v as FormValues["priority"])}
                >
                  <SelectTrigger className="mt-1.5">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["low", "medium", "high", "urgent"].map((p) => (
                      <SelectItem key={p} value={p} className="capitalize">
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="needed">Delivery needed by</Label>
                <Input id="needed" type="date" className="mt-1.5" {...form.register("neededBy")} />
                {err(errors.neededBy?.message)}
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="just">Justification</Label>
                <Textarea
                  id="just"
                  rows={3}
                  className="mt-1.5"
                  placeholder="Why is this needed and how were quantities decided?"
                  {...form.register("justification")}
                />
                {err(errors.justification?.message)}
              </div>
            </div>
          </Panel>
          <Panel
            title="Items"
            action={
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => append({ materialId: "", qty: 1, unitPrice: 0 })}
              >
                <Plus />
                Add item
              </Button>
            }
          >
            <div className="space-y-3">
              {fields.map((f, i) => {
                const mid = items[i]?.materialId ?? "";
                const m = ws.materials.find((x) => x.id === mid);
                return (
                  <div
                    key={f.id}
                    className="grid items-end gap-3 rounded-xl border bg-muted/30 p-3 sm:grid-cols-[1fr_110px_140px_auto]"
                  >
                    <div>
                      <Label className="text-xs">Material</Label>
                      <Select
                        value={mid}
                        onValueChange={(v) => {
                          form.setValue(`items.${i}.materialId`, v, { shouldValidate: true });
                          const p = lastPrice(v);
                          if (p) form.setValue(`items.${i}.unitPrice`, p);
                        }}
                      >
                        <SelectTrigger className="mt-1 bg-card">
                          <SelectValue placeholder="Select material" />
                        </SelectTrigger>
                        <SelectContent>
                          {mats.map((x) => (
                            <SelectItem key={x.id} value={x.id}>
                              {x.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {err(errors.items?.[i]?.materialId?.message)}
                    </div>
                    <div>
                      <Label className="text-xs">Qty {m ? `(${m.unit})` : ""}</Label>
                      <Input
                        type="number"
                        step="any"
                        className="mt-1 bg-card"
                        {...form.register(`items.${i}.qty`)}
                      />
                      {err(errors.items?.[i]?.qty?.message)}
                    </div>
                    <div>
                      <Label className="text-xs">Est. unit price (₹)</Label>
                      <Input
                        type="number"
                        step="any"
                        className="mt-1 bg-card"
                        {...form.register(`items.${i}.unitPrice`)}
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => remove(i)}
                      disabled={fields.length === 1}
                      aria-label="Remove item"
                    >
                      <Trash2 />
                    </Button>
                  </div>
                );
              })}
            </div>
          </Panel>
        </div>
        <div>
          <Panel title="Estimated total">
            <div className="text-3xl font-semibold tracking-tight tabular">
              {formatMoney(total)}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Before GST and freight. Requests above ₹2,00,000 need a second (finance) approval.
            </p>
          </Panel>
        </div>
      </div>
    </form>
  );
}
