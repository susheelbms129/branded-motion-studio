import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { REQUESTS_KEY } from "@/features/requests/use-requests";
import { formatMoney, type CurrencyCode } from "@/lib/format";
import { useAppNavigate } from "@/lib/nav";
import {
  awardRfq,
  MAX_ADDRESS,
  MAX_ORDER_NOTE,
  MIN_ADDRESS,
  ORDERS_KEY,
  orderError,
} from "@/lib/orders-api";
import type { QuoteView } from "@/lib/quote-compare";
import { RFQ_KEY } from "@/lib/rfqs-api";

/** The last step: turn one supplier's quote into a purchase order. The order copies the quote, so nothing is retyped. */
export function AwardDialog({
  open,
  onOpenChange,
  rfqId,
  view,
  currency,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  rfqId: string;
  view: QuoteView | null;
  currency: CurrencyCode;
}) {
  const qc = useQueryClient();
  const go = useAppNavigate();
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) setError("");
  }, [open]);

  if (!view) return null;
  const q = view.quote;
  const addr = address.trim();
  const valid = addr.length >= MIN_ADDRESS && addr.length <= MAX_ADDRESS && notes.length <= MAX_ORDER_NOTE;

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await awardRfq(rfqId, q.quote_id, { deliveryAddress: addr, notes: notes.trim() });
      await Promise.all([
        qc.invalidateQueries({ queryKey: [RFQ_KEY] }),
        qc.invalidateQueries({ queryKey: [ORDERS_KEY] }),
        qc.invalidateQueries({ queryKey: [REQUESTS_KEY] }),
      ]);
      toast.success(`${r.number} issued to ${q.name}`);
      onOpenChange(false);
      setAddress("");
      setNotes("");
      go(`purchase-orders/${r.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : orderError(e));
    } finally {
      setBusy(false);
    }
  };

  const m = (n: number) => formatMoney(n, { currency });
  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Award to {q.name}</DialogTitle>
          <DialogDescription>
            A purchase order is created from this exact quote and sent to the supplier to confirm.
          </DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-lg border bg-muted/30 p-3 text-sm">
          <dt className="text-muted-foreground">Total landed cost</dt>
          <dd className="text-right font-semibold tabular">{m(view.landed.total)}</dd>
          <dt className="text-muted-foreground">Delivery</dt>
          <dd className="text-right tabular">{q.delivery_days} days</dd>
          <dt className="text-muted-foreground">Payment terms</dt>
          <dd className="text-right tabular">{q.payment_terms_days} days</dd>
        </dl>
        <div className="space-y-1.5">
          <Label htmlFor="award-address">Delivery address</Label>
          <Textarea
            id="award-address"
            rows={3}
            maxLength={MAX_ADDRESS}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Where should the supplier deliver?"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="award-notes">Note to supplier (optional)</Label>
          <Textarea
            id="award-notes"
            rows={2}
            maxLength={MAX_ORDER_NOTE}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        {error ? (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={!valid || busy}>
            {busy ? "Issuing…" : "Issue purchase order"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
