import { Link } from "@tanstack/react-router";
import { AlertCircle, ArrowLeft, CheckCircle2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { SupplierShell, useSupplier } from "@/components/supplier/SupplierShell";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { asCurrency, day, DetailList, OrderLines } from "@/features/pos/OrderParts";
import {
  confirmPurchaseOrder,
  declinePurchaseOrder,
  getSupplierOrder,
  MAX_RESPONSE_NOTE,
  ORDERS_CHANGED,
  orderError,
  type SupplierOrder,
} from "@/lib/orders-api";
import { placeLine } from "@/lib/quote-form";
import { cn } from "@/lib/utils";

const card = "rounded-2xl border border-border bg-card shadow-card";

export function SupplierOrderPage({ poId }: { poId: string }) {
  return (
    <SupplierShell>
      <OrderContent poId={poId} />
    </SupplierShell>
  );
}

function OrderContent({ poId }: { poId: string }) {
  const { summary, status: shell } = useSupplier();
  const orgId = summary?.id ?? null;
  const [data, setData] = useState<SupplierOrder | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"confirm" | "decline" | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");

  const load = useCallback(async () => {
    if (!orgId) return;
    setStatus("loading");
    try {
      setData(await getSupplierOrder(orgId, poId));
      setStatus("ready");
    } catch (e) {
      setError(orderError(e));
      setStatus("error");
    }
  }, [orgId, poId]);
  useEffect(() => {
    void load();
  }, [load]);

  if (shell === "error" || status === "error") {
    return (
      <div className={cn(card, "p-8 text-center")}>
        <AlertCircle className="mx-auto size-8 text-amber" aria-hidden />
        <h1 className="mt-3 text-xl font-semibold">We couldn't open this order</h1>
        <p className="mt-1 text-sm text-muted-foreground">{error || "Please check your connection and try again."}</p>
        <div className="mt-5 flex justify-center gap-3">
          <button
            onClick={() => void load()}
            className="inline-flex items-center gap-2 rounded-md bg-gradient-cta px-4 py-2 text-sm font-semibold text-white"
          >
            <RefreshCw className="size-4" aria-hidden /> Try again
          </button>
          <Link to="/supplier/orders" className="rounded-md border border-border px-4 py-2 text-sm font-semibold">
            Back to orders
          </Link>
        </div>
      </div>
    );
  }
  if (!data || shell === "loading" || status === "loading") {
    return <div className="h-64 animate-pulse rounded-2xl bg-muted" aria-busy />;
  }

  const { po, buyer, lines, amounts, can_respond } = data;
  const cur = asCurrency(po.currency);
  const submit = async () => {
    if (!orgId || !mode) return;
    setBusy(true);
    setFormError("");
    try {
      if (mode === "confirm") await confirmPurchaseOrder(orgId, po.id, text);
      else await declinePurchaseOrder(orgId, po.id, text);
      toast.success(mode === "confirm" ? "Order confirmed. The buyer has been told." : "Order declined. The buyer has been told.");
      setMode(null);
      setText("");
      window.dispatchEvent(new Event(ORDERS_CHANGED));
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : orderError(e));
    } finally {
      setBusy(false);
    }
  };
  const place = placeLine(buyer.city, buyer.state);
  return (
    <div className="space-y-6">
      <Link to="/supplier/orders" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Orders received
      </Link>
      <header className={cn(card, "flex flex-wrap items-start justify-between gap-4 p-6")}>
        <div>
          <p className="text-xs font-medium text-muted-foreground">{po.number}</p>
          <h1 className="mt-0.5 text-2xl font-semibold">{po.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            From <span className="font-medium text-foreground">{buyer.name}</span>
            {place ? ` · ${place}` : ""}
          </p>
        </div>
        {can_respond ? (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setMode("decline")}>
              Decline
            </Button>
            <Button onClick={() => setMode("confirm")}>Confirm order</Button>
          </div>
        ) : null}
      </header>

      {po.state === "new" && !can_respond ? (
        <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
          Waiting for an owner or procurement manager at your company to confirm this order.
        </p>
      ) : null}
      {po.state === "confirmed" ? (
        <p className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
          <span>
            You confirmed this order on {day(po.acknowledged_at)}.{po.supplier_note ? ` Your note: ${po.supplier_note}` : ""}
          </span>
        </p>
      ) : null}
      {po.state === "declined" ? (
        <p className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-sm">
          {po.cancelled_by === "buyer" ? "The buyer cancelled this order" : "You declined this order"}
          {po.cancelled_at ? ` on ${day(po.cancelled_at)}` : ""}.{po.decline_reason ? ` Reason: ${po.decline_reason}` : ""}
        </p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <OrderLines lines={lines} amounts={amounts} currency={cur} />
          <section className={cn(card, "p-5")}>
            <h2 className="text-sm font-semibold">Deliver to</h2>
            <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">{po.delivery_address}</p>
            {po.notes ? <p className="mt-3 text-sm">Buyer's note: {po.notes}</p> : null}
          </section>
        </div>
        <section className={cn(card, "h-fit p-5")}>
          <h2 className="mb-3 text-sm font-semibold">Details</h2>
          <DetailList
            rows={[
              ["Buyer", buyer.name],
              ["Issued", day(po.issued_at)],
              ["Deliver by", day(po.expected_at)],
              ["Payment terms", `${po.payment_terms_days} days`],
            ]}
          />
        </section>
      </div>

      <Dialog open={mode !== null} onOpenChange={(v) => !busy && !v && setMode(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{mode === "confirm" ? `Confirm ${po.number}?` : `Decline ${po.number}?`}</DialogTitle>
            <DialogDescription>
              {mode === "confirm"
                ? "You agree to deliver on the price and terms of your quote."
                : "The buyer is told and can award another supplier. Please give a short reason."}
            </DialogDescription>
          </DialogHeader>
          <Label htmlFor="order-text">{mode === "confirm" ? "Note to buyer (optional)" : "Reason (optional)"}</Label>
          <Textarea id="order-text" rows={3} maxLength={MAX_RESPONSE_NOTE} value={text} onChange={(e) => setText(e.target.value)} />
          {formError ? (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {formError}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setMode(null)} disabled={busy}>
              Back
            </Button>
            <Button variant={mode === "decline" ? "destructive" : "default"} onClick={() => void submit()} disabled={busy}>
              {busy ? "Saving…" : mode === "confirm" ? "Confirm order" : "Decline order"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
