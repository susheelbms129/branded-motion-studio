import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PackageCheck, Printer, ReceiptText, Repeat } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, ErrorState, PageHeader, Panel, StatusBadge } from "@/components/vendora/kit";
import { PaymentPanel } from "@/features/payments/PaymentPanel";
import { ReorderDialog } from "@/features/reorder/ReorderDialog";
import { getReorderContext, REORDER_KEY } from "@/lib/reorder-api";
import { AppLink } from "@/lib/nav";
import {
  cancelPurchaseOrder,
  getPurchaseOrder,
  MAX_RESPONSE_NOTE,
  ORDERS_KEY,
  orderError,
  receivePurchaseOrder,
} from "@/lib/orders-api";
import { FAIR_RANK_KEY } from "@/lib/fair-rank-api";
import { RFQ_KEY } from "@/lib/rfqs-api";
import { asCurrency, day, DetailList, OrderLines } from "./OrderParts";

/** A real company's order, read from the database. The buyer can take it back until the supplier confirms. */
export function PurchaseOrderDetailReal({ id }: { id: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: [ORDERS_KEY, "detail", id], queryFn: () => getPurchaseOrder(id) });
  const ctx = useQuery({ queryKey: [REORDER_KEY, "context", id], queryFn: () => getReorderContext(id) });
  const [reorderOpen, setReorderOpen] = useState(false);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [recOpen, setRecOpen] = useState(false);
  const [recDate, setRecDate] = useState("");

  if (q.isError)
    return (
      <ErrorState
        {...(q.error instanceof Error ? { message: q.error.message } : {})}
        onRetry={() => void q.refetch()}
      />
    );
  if (q.isLoading) return <p className="py-16 text-center text-sm text-muted-foreground">Loading order…</p>;
  if (!q.data)
    return (
      <EmptyState
        icon={ReceiptText}
        accent="emerald"
        title="Purchase order not found"
        body="It may have been removed."
        action={
          <Button asChild>
            <AppLink to="purchase-orders">Back to orders</AppLink>
          </Button>
        }
      />
    );

  const { po, supplier, lines, amounts, can_cancel } = q.data;
  const cur = asCurrency(po.currency);
  const cancel = async () => {
    setBusy(true);
    setError("");
    try {
      await cancelPurchaseOrder(po.id, reason);
      await Promise.all([
        qc.invalidateQueries({ queryKey: [ORDERS_KEY] }),
        qc.invalidateQueries({ queryKey: [RFQ_KEY] }),
      ]);
      toast.success(po.rfq_id ? "Order cancelled. The RFQ is open again." : "Order cancelled.");
      setOpen(false);
      setReason("");
    } catch (e) {
      setError(e instanceof Error ? e.message : orderError(e));
    } finally {
      setBusy(false);
    }
  };
  const today = new Date().toISOString().slice(0, 10);
  const receive = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await receivePurchaseOrder(po.id, recDate || undefined);
      await Promise.all([
        qc.invalidateQueries({ queryKey: [ORDERS_KEY] }),
        qc.invalidateQueries({ queryKey: [FAIR_RANK_KEY] }),
      ]);
      toast.success(r.on_time ? "Delivery recorded: on time. Thank you for keeping the record honest." : "Delivery recorded: after the promised date.");
      setRecOpen(false);
      setRecDate("");
    } catch (e) {
      setError(e instanceof Error ? e.message : orderError(e));
    } finally {
      setBusy(false);
    }
  };
  const place = [supplier.city, supplier.state].filter(Boolean).join(", ");
  return (
    <>
      <PageHeader
        title={<span className="tabular">{po.number}</span>}
        meta={<StatusBadge kind="po" value={po.status} />}
        description={`${supplier.name}${place ? ` · ${place}` : ""}`}
        accent="emerald"
        crumbs={[{ label: "Purchase Orders", to: "purchase-orders" }, { label: po.number }]}
        actions={
          <>
            <Button variant="outline" onClick={() => window.print()} className="no-print">
              <Printer />
              Print
            </Button>
            {can_cancel ? (
              <Button variant="destructive" className="no-print" onClick={() => setOpen(true)}>
                Cancel order
              </Button>
            ) : null}
            {po.status === "received" || po.status === "closed" ? (
              <Button className="no-print" onClick={() => setReorderOpen(true)}>
                <Repeat />
                Reorder
              </Button>
            ) : null}
            {q.data.can_receive ? (
              <Button className="no-print" onClick={() => setRecOpen(true)}>
                <PackageCheck />
                Record delivery
              </Button>
            ) : null}
          </>
        }
      />
      {ctx.data?.reordered_from ? (
        <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
          A reorder of{" "}
          <AppLink to={`purchase-orders/${ctx.data.reordered_from.id}`} className="font-medium underline">
            {ctx.data.reordered_from.number}
          </AppLink>{" "}
          at the same prices.
        </p>
      ) : null}
      {po.status === "issued" ? (
        <p className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-3 text-sm">
          Waiting for {supplier.name} to confirm. You can cancel until they do.
        </p>
      ) : null}
      {po.status === "acknowledged" ? (
        <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm">
          {supplier.name} confirmed this order on {day(po.acknowledged_at)}.
          {po.supplier_note ? ` Their note: ${po.supplier_note}` : ""}
        </p>
      ) : null}
      {po.status === "received" && po.delivered_at ? (
        <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm">
          Delivered on {day(po.delivered_at)}{po.expected_at ? (po.delivered_at.slice(0, 10) <= po.expected_at ? ", on time" : ", after the promised date") : ""}. This is part of {supplier.name}'s public delivery record.
        </p>
      ) : null}
      {po.status === "cancelled" ? (
        <p className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-sm">
          {po.cancelled_by === "supplier" ? `${supplier.name} declined this order` : "You cancelled this order"}
          {po.cancelled_at ? ` on ${day(po.cancelled_at)}` : ""}.
          {po.decline_reason ? ` Reason: ${po.decline_reason}` : ""} {po.rfq_id ? " The RFQ is open again, so you can award another quote." : ""}
        </p>
      ) : null}
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <OrderLines lines={lines} amounts={amounts} currency={cur} />
          <Panel title="Delivery">
            <p className="whitespace-pre-line text-sm text-muted-foreground">{po.delivery_address}</p>
            {po.notes ? <p className="mt-3 text-sm">Your note: {po.notes}</p> : null}
          </Panel>
        </div>
        <div className="space-y-4">
          <PaymentPanel side="buyer" poId={po.id} currency={cur} />
          <Panel title="Details">
            <DetailList
              rows={[
                ["Supplier", supplier.name],
                ["GSTIN", supplier.gstin || "—"],
                ["Created by", po.created_by_name || "—"],
                ["Issued", day(po.issued_at)],
                ["Expected", day(po.expected_at)],
                ["Payment terms", `${po.payment_terms_days} days`],
              ]}
            />
            {po.rfq_id ? (
              <Button asChild variant="outline" size="sm" className="mt-4 w-full">
                <AppLink to={`rfqs/${po.rfq_id}`}>View source RFQ{po.rfq_number ? ` · ${po.rfq_number}` : ""}</AppLink>
              </Button>
            ) : null}
          </Panel>
          {ctx.data && ctx.data.reorders.length > 0 ? (
            <Panel title="Reorders of this order">
              <ul className="space-y-2 text-sm">
                {ctx.data.reorders.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3">
                    <AppLink to={`purchase-orders/${r.id}`} className="font-medium tabular underline">
                      {r.number}
                    </AppLink>
                    <StatusBadge kind="po" value={r.status} />
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </div>
      </div>
      <ReorderDialog poId={po.id} open={reorderOpen} onOpenChange={setReorderOpen} />
      <Dialog open={recOpen} onOpenChange={(v) => !busy && setRecOpen(v)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record delivery of {po.number}</DialogTitle>
            <DialogDescription>
              Confirm the goods arrived. Only you can record this, so the supplier's delivery record stays honest. It cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <Label htmlFor="rec-date">Delivered on</Label>
          <Input id="rec-date" type="date" max={today} value={recDate || today} onChange={(e) => setRecDate(e.target.value)} />
          {error ? (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRecOpen(false)} disabled={busy}>
              Not yet
            </Button>
            <Button onClick={() => void receive()} disabled={busy}>
              {busy ? "Saving…" : "Record delivery"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={open} onOpenChange={(v) => !busy && setOpen(v)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel {po.number}?</DialogTitle>
            <DialogDescription>
              The supplier is told and the RFQ opens again so you can award another quote.
            </DialogDescription>
          </DialogHeader>
          <Label htmlFor="cancel-reason">Reason (optional)</Label>
          <Textarea
            id="cancel-reason"
            rows={3}
            maxLength={MAX_RESPONSE_NOTE}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          {error ? (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Keep order
            </Button>
            <Button variant="destructive" onClick={() => void cancel()} disabled={busy}>
              {busy ? "Cancelling…" : "Cancel order"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
