import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { addDays, format } from "date-fns";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
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
import { PageHeader, Panel } from "@/components/vendora/kit";
import { formatMoney } from "@/lib/format";
import { useAppNavigate } from "@/lib/nav";
import { APPROVAL_LIMIT, createRequest, REQUEST_CATEGORIES, requestError } from "@/lib/requests-api";
import { REQUESTS_KEY } from "./use-requests";

/**
 * A real purchase request. Items are typed in (name, quantity, unit, estimated price), so a new company can raise its
 * first request straight away without building a materials catalogue first. The database re-checks every field.
 */
const UNITS = ["pcs", "kg", "tonne", "litre", "metre", "box", "set", "sheet", "roll", "bag"];

const schema = z.object({
  title: z.string().trim().min(3, "Give the request a short title").max(120, "Keep the title under 120 characters"),
  category: z.string().trim().min(2, "Choose or type a category").max(60),
  department: z.string().trim().min(2, "Enter a department").max(60),
  priority: z.enum(["low", "medium", "high", "urgent"]),
  neededBy: z.string().min(1, "Pick a delivery date"),
  justification: z.string().trim().min(10, "Add a short justification (10+ characters)").max(2000),
  items: z
    .array(
      z.object({
        description: z.string().trim().min(2, "Name the item").max(200),
        unit: z.string().trim().min(1, "Add a unit").max(20),
        qty: z.coerce.number().positive("Qty must be above 0"),
        unitPrice: z.coerce.number().min(0, "Price can't be negative"),
      }),
    )
    .min(1)
    .max(50),
});
type FormValues = {
  title: string;
  category: string;
  department: string;
  priority: "low" | "medium" | "high" | "urgent";
  neededBy: string;
  justification: string;
  items: { description: string; unit: string; qty: number; unitPrice: number }[];
};

const blankItem = { description: "", unit: "pcs", qty: 1, unitPrice: 0 };

export function NewRequestReal({ orgId }: { orgId: string }) {
  const go = useAppNavigate();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const form = useForm<FormValues>({
    resolver: zodResolver(schema) as never,
    defaultValues: {
      title: "",
      category: "",
      department: "",
      priority: "medium",
      neededBy: format(addDays(new Date(), 14), "yyyy-MM-dd"),
      justification: "",
      items: [blankItem],
    },
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "items" });
  const { errors } = form.formState;
  const items = form.watch("items");
  const total = items.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.unitPrice) || 0), 0);
  const err = (m?: string) => (m ? <p className="mt-1 text-xs text-destructive">{m}</p> : null);

  const submit = (flag: boolean) =>
    form.handleSubmit(async (v) => {
      if (busy) return;
      setBusy(true);
      try {
        const r = await createRequest(
          orgId,
          {
            title: v.title.trim(),
            category: v.category.trim(),
            department: v.department.trim(),
            priority: v.priority,
            neededBy: v.neededBy,
            justification: v.justification.trim(),
            items: v.items.map((i) => ({
              description: i.description.trim(),
              unit: i.unit.trim(),
              qty: Number(i.qty),
              unitPrice: Number(i.unitPrice) || 0,
            })),
          },
          flag,
        );
        void qc.invalidateQueries({ queryKey: [REQUESTS_KEY] });
        toast.success(
          r.status === "approved"
            ? `${r.number} approved automatically: nobody else can approve yet`
            : `${r.number} ${flag ? "submitted for approval" : "saved as draft"}`,
        );
        go(`requests/${r.id}`);
      } catch (e) {
        toast.error(requestError(e));
        setBusy(false);
      }
    })();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit(true);
      }}
    >
      <PageHeader
        title="New purchase request"
        description="Describe what you need. Your approver is chosen for you."
        crumbs={[{ label: "Purchase Requests", to: "requests" }, { label: "New request" }]}
        actions={
          <>
            <Button type="button" variant="outline" disabled={busy} onClick={() => void submit(false)}>
              Save draft
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Submit for approval"}
            </Button>
          </>
        }
      />
      <datalist id="req-categories">
        {REQUEST_CATEGORIES.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <datalist id="req-units">
        {UNITS.map((u) => (
          <option key={u} value={u} />
        ))}
      </datalist>
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Panel title="Request details">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label htmlFor="title">Title</Label>
                <Input
                  id="title"
                  className="mt-1.5"
                  maxLength={120}
                  placeholder="e.g. MS plates for Line 3 fabrication"
                  {...form.register("title")}
                />
                {err(errors.title?.message)}
              </div>
              <div>
                <Label htmlFor="category">Category</Label>
                <Input
                  id="category"
                  className="mt-1.5"
                  list="req-categories"
                  maxLength={60}
                  placeholder="Pick one or type your own"
                  {...form.register("category")}
                />
                {err(errors.category?.message)}
              </div>
              <div>
                <Label htmlFor="dept">Department</Label>
                <Input
                  id="dept"
                  className="mt-1.5"
                  maxLength={60}
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
                <Input
                  id="needed"
                  type="date"
                  className="mt-1.5"
                  min={format(new Date(), "yyyy-MM-dd")}
                  {...form.register("neededBy")}
                />
                {err(errors.neededBy?.message)}
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="just">Justification</Label>
                <Textarea
                  id="just"
                  rows={3}
                  maxLength={2000}
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
                disabled={fields.length >= 50}
                onClick={() => append(blankItem)}
              >
                <Plus />
                Add item
              </Button>
            }
          >
            <div className="space-y-3">
              {fields.map((f, i) => (
                <div
                  key={f.id}
                  className="grid items-end gap-3 rounded-xl border bg-muted/30 p-3 sm:grid-cols-[1fr_90px_100px_130px_auto]"
                >
                  <div>
                    <Label className="text-xs">Item</Label>
                    <Input
                      className="mt-1 bg-card"
                      maxLength={200}
                      placeholder="e.g. MS plate 10mm"
                      {...form.register(`items.${i}.description`)}
                    />
                    {err(errors.items?.[i]?.description?.message)}
                  </div>
                  <div>
                    <Label className="text-xs">Qty</Label>
                    <Input type="number" step="any" min="0" className="mt-1 bg-card" {...form.register(`items.${i}.qty`)} />
                    {err(errors.items?.[i]?.qty?.message)}
                  </div>
                  <div>
                    <Label className="text-xs">Unit</Label>
                    <Input
                      className="mt-1 bg-card"
                      list="req-units"
                      maxLength={20}
                      {...form.register(`items.${i}.unit`)}
                    />
                    {err(errors.items?.[i]?.unit?.message)}
                  </div>
                  <div>
                    <Label className="text-xs">Est. unit price (₹)</Label>
                    <Input
                      type="number"
                      step="any"
                      min="0"
                      className="mt-1 bg-card"
                      {...form.register(`items.${i}.unitPrice`)}
                    />
                    {err(errors.items?.[i]?.unitPrice?.message)}
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
              ))}
            </div>
          </Panel>
        </div>
        <div>
          <Panel title="Estimated total">
            <div className="text-3xl font-semibold tracking-tight tabular">{formatMoney(total)}</div>
            <p className="mt-1 text-xs text-muted-foreground">
              Before GST and freight. Requests above {formatMoney(APPROVAL_LIMIT)} need a second (finance) approval.
              Suppliers quote the real prices later.
            </p>
          </Panel>
        </div>
      </div>
    </form>
  );
}
