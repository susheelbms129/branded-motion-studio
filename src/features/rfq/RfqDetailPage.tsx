import { useParams } from "@tanstack/react-router";
import { Award, FileSpreadsheet, Plus, Trophy } from "lucide-react";
import { useMemo, useState } from "react";
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
import { Slider } from "@/components/ui/slider";
import { Can, EmptyState, PageHeader, Panel, StatusBadge } from "@/components/vendora/kit";
import {
  type ComparisonWeights,
  DEFAULT_WEIGHTS,
  rankQuotations,
  calculateLandedCost,
} from "@/lib/landed-cost";
import { formatDate, formatMoney } from "@/lib/format";
import { AppLink, useAppNavigate } from "@/lib/nav";
import { nameOf } from "@/lib/selectors";
import { usePerf } from "@/lib/use-perf";
import { cn } from "@/lib/utils";
import { useActor, useWs } from "@/lib/ws-store";

export function RfqDetailPage() {
  const { id } = useParams({ strict: false }) as { id: string };
  const ws = useWs();
  const actor = useActor();
  const go = useAppNavigate();
  const perf = usePerf();
  const [weights, setWeights] = useState<ComparisonWeights>(DEFAULT_WEIGHTS);
  const [open, setOpen] = useState(false);
  const rfq = ws.rfqs.find((r) => r.id === id);
  const quotes = useMemo(() => ws.quotations.filter((q) => q.rfqId === id), [ws.quotations, id]);
  const ranked = useMemo(
    () =>
      rankQuotations(
        quotes,
        Object.fromEntries(Object.entries(perf).map(([k, v]) => [k, v.score])),
        weights,
        (sid) => nameOf(ws.suppliers, sid),
      ),
    [quotes, perf, weights, ws.suppliers],
  );
  if (!rfq)
    return (
      <EmptyState
        icon={FileSpreadsheet}
        accent="violet"
        title="RFQ not found"
        body="It may have been removed."
        action={
          <Button asChild>
            <AppLink to="rfqs">Back to RFQs</AppLink>
          </Button>
        }
      />
    );
  const awarded = rfq.status === "awarded";

  const award = (qid: string) => {
    const po = ws.awardRfq(rfq.id, qid, { actorId: actor });
    if (po) {
      toast.success(`${po.number} issued`);
      go(`purchase-orders/${po.id}`);
    }
  };

  return (
    <>
      <PageHeader
        title={<span className="tabular">{rfq.number}</span>}
        meta={<StatusBadge kind="rfq" value={rfq.status} />}
        description={rfq.title}
        accent="violet"
        crumbs={[{ label: "RFQs", to: "rfqs" }, { label: rfq.number }]}
        actions={
          <>
            {rfq.requestId ? (
              <Button variant="outline" asChild>
                <AppLink to={`requests/${rfq.requestId}`}>Source request</AppLink>
              </Button>
            ) : null}
            {!awarded ? (
              <Can permission="quotation.manage">
                <Button onClick={() => setOpen(true)}>
                  <Plus />
                  Enter quotation
                </Button>
              </Can>
            ) : null}
          </>
        }
      />
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Panel title="Items requested" bodyClassName="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-y bg-muted/40 text-xs text-muted-foreground">
                    <th className="px-5 py-2 text-left font-medium">Material</th>
                    <th className="px-5 py-2 text-right font-medium">Quantity</th>
                  </tr>
                </thead>
                <tbody>
                  {rfq.items.map((i) => (
                    <tr key={i.id} className="border-b last:border-0">
                      <td className="px-5 py-3">{i.description}</td>
                      <td className="px-5 py-3 text-right tabular">
                        {i.qty} {i.unit}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel
            title="Quote comparison"
            description="Ranked on total landed cost = price × qty + GST + shipping + other charges, plus your weights"
          >
            {ranked.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No quotations yet. Enter one as suppliers respond.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b text-xs text-muted-foreground">
                      <th className="py-2 text-left font-medium">Supplier</th>
                      <th className="px-2 text-right font-medium">Goods</th>
                      <th className="px-2 text-right font-medium">GST</th>
                      <th className="px-2 text-right font-medium">Freight+other</th>
                      <th className="px-2 text-right font-medium">Landed cost</th>
                      <th className="px-2 text-right font-medium">Lead time</th>
                      <th className="px-2 text-right font-medium">Score</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {ranked.map((r) => (
                      <tr
                        key={r.quotation.id}
                        className={cn(
                          "border-b last:border-0 align-top",
                          r.rank === 1 && "bg-emerald/5",
                        )}
                      >
                        <td className="py-3">
                          <div className="flex items-center gap-1.5 font-medium">
                            {r.rank === 1 ? <Trophy className="size-4 text-amber" /> : null}
                            {nameOf(ws.suppliers, r.quotation.supplierId)}
                          </div>
                          <ul className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
                            {r.reasons.slice(0, 3).map((x) => (
                              <li key={x}>• {x}</li>
                            ))}
                          </ul>
                        </td>
                        <td className="px-2 py-3 text-right tabular">
                          {formatMoney(r.landed.subtotal)}
                        </td>
                        <td className="px-2 py-3 text-right tabular">
                          {formatMoney(r.landed.gst)}
                        </td>
                        <td className="px-2 py-3 text-right tabular">
                          {formatMoney(r.landed.shipping + r.landed.otherCharges)}
                        </td>
                        <td className="px-2 py-3 text-right font-semibold tabular">
                          {formatMoney(r.landed.total)}
                        </td>
                        <td className="px-2 py-3 text-right tabular">
                          {r.quotation.deliveryDays}d
                        </td>
                        <td className="px-2 py-3 text-right tabular">{r.total.toFixed(0)}</td>
                        <td className="py-3 pl-2 text-right">
                          {awarded ? (
                            rfq.awardedQuotationId === r.quotation.id ? (
                              <span className="tint-emerald rounded-full px-2 py-0.5 text-xs">
                                Awarded
                              </span>
                            ) : null
                          ) : (
                            <Can permission="quotation.manage">
                              <Button
                                size="sm"
                                variant={r.rank === 1 ? "default" : "outline"}
                                onClick={() => award(r.quotation.id)}
                              >
                                <Award />
                                Award
                              </Button>
                            </Can>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>
        <div className="space-y-4">
          <Panel title="Invited suppliers">
            <ul className="space-y-2">
              {rfq.invites.map((i) => (
                <li key={i.supplierId} className="flex items-center justify-between gap-2 text-sm">
                  <AppLink to={`suppliers/${i.supplierId}`} className="truncate hover:text-primary">
                    {nameOf(ws.suppliers, i.supplierId)}
                  </AppLink>
                  <StatusBadge kind="invite" value={i.status} />
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">Due {formatDate(rfq.dueDate)}</p>
          </Panel>
          <Panel title="Scoring weights" description="Tune what matters to you">
            <div className="space-y-4">
              {(["cost", "delivery", "paymentTerms", "performance"] as const).map((k) => (
                <div key={k}>
                  <div className="mb-1.5 flex justify-between text-xs">
                    <span className="capitalize">{k === "paymentTerms" ? "Payment terms" : k}</span>
                    <span className="tabular text-muted-foreground">{weights[k]}%</span>
                  </div>
                  <Slider
                    value={[weights[k]]}
                    min={0}
                    max={100}
                    step={5}
                    onValueChange={([v]) => setWeights((w) => ({ ...w, [k]: v ?? 0 }))}
                    aria-label={k}
                  />
                </div>
              ))}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="mt-3"
              onClick={() => setWeights(DEFAULT_WEIGHTS)}
            >
              Reset
            </Button>
          </Panel>
        </div>
      </div>
      <QuoteDialog open={open} onClose={() => setOpen(false)} rfqId={rfq.id} />
    </>
  );
}

function QuoteDialog({
  open,
  onClose,
  rfqId,
}: {
  open: boolean;
  onClose: () => void;
  rfqId: string;
}) {
  const ws = useWs();
  const rfq = ws.rfqs.find((r) => r.id === rfqId);
  const [supplierId, setSupplierId] = useState("");
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [f, setF] = useState({
    gstRate: "18",
    shipping: "0",
    otherCharges: "0",
    deliveryDays: "7",
    paymentTermsDays: "30",
  });
  if (!rfq) return null;
  const lines = rfq.items.map((i) => ({
    materialId: i.materialId,
    qty: i.qty,
    unitPrice: Number(prices[i.id]) || 0,
  }));
  const landed = calculateLandedCost({
    lines,
    gstRate: Number(f.gstRate) || 0,
    shipping: Number(f.shipping) || 0,
    otherCharges: Number(f.otherCharges) || 0,
  });
  const valid = supplierId && lines.every((l) => l.unitPrice > 0);
  const field = (k: keyof typeof f, label: string) => (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        className="mt-1"
        value={f[k]}
        onChange={(e) => setF({ ...f, [k]: e.target.value })}
      />
    </div>
  );
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Enter quotation</DialogTitle>
          <DialogDescription>
            Record what the supplier quoted. Landed cost updates as you type.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Supplier</Label>
            <Select
              value={supplierId}
              onValueChange={(v) => {
                setSupplierId(v);
                const s = ws.suppliers.find((x) => x.id === v);
                if (s) setF((p) => ({ ...p, paymentTermsDays: String(s.paymentTermsDays) }));
              }}
            >
              <SelectTrigger className="mt-1.5">
                <SelectValue placeholder="Choose supplier" />
              </SelectTrigger>
              <SelectContent>
                {ws.suppliers
                  .filter((s) => s.status !== "inactive")
                  .map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          {rfq.items.map((i) => (
            <div key={i.id} className="grid grid-cols-[1fr_130px] items-end gap-3">
              <div className="text-sm">
                {i.description}
                <div className="text-xs text-muted-foreground tabular">
                  {i.qty} {i.unit}
                </div>
              </div>
              <div>
                <Label className="text-xs">Unit price (₹)</Label>
                <Input
                  type="number"
                  step="any"
                  className="mt-1"
                  value={prices[i.id] ?? ""}
                  onChange={(e) => setPrices({ ...prices, [i.id]: e.target.value })}
                />
              </div>
            </div>
          ))}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {field("gstRate", "GST %")}
            {field("shipping", "Shipping (₹)")}
            {field("otherCharges", "Other (₹)")}
            {field("deliveryDays", "Lead time (days)")}
            {field("paymentTermsDays", "Payment terms (days)")}
          </div>
          <div className="rounded-xl bg-muted/50 p-3 text-sm">
            <div className="flex justify-between text-muted-foreground">
              <span>Goods + GST</span>
              <span className="tabular">{formatMoney(landed.subtotal + landed.gst)}</span>
            </div>
            <div className="mt-1 flex justify-between font-semibold">
              <span>Total landed cost</span>
              <span className="tabular">{formatMoney(landed.total)}</span>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!valid}
            onClick={() => {
              ws.addQuotation({
                rfqId,
                supplierId,
                lines,
                gstRate: Number(f.gstRate) || 0,
                shipping: Number(f.shipping) || 0,
                otherCharges: Number(f.otherCharges) || 0,
                deliveryDays: Number(f.deliveryDays) || 7,
                paymentTermsDays: Number(f.paymentTermsDays) || 30,
                validUntil: new Date(Date.now() + 30 * 864e5).toISOString(),
                notes: "",
              });
              toast.success("Quotation recorded");
              setSupplierId("");
              setPrices({});
              onClose();
            }}
          >
            Save quotation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
