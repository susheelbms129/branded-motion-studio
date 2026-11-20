import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  CalendarClock,
  Repeat,
  ShieldAlert,
  ShieldCheck,
  Truck,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { asCurrency } from "@/features/pos/OrderParts";
import { formatDate, formatMoney } from "@/lib/format";
import { appPath } from "@/lib/nav";
import { ORDERS_KEY } from "@/lib/orders-api";
import {
  blockerText,
  deliveryText,
  deliveryTone,
  dueText,
  dueTone,
  estimateTotal,
  needsOwner,
  parseQty,
  previewReorder,
  priceChangePct,
  priceChangeText,
  REORDER_KEY,
  reorderError,
  reorderPurchaseOrder,
  rhythmText,
} from "@/lib/reorder-api";
import { MAX_ADDRESS, MAX_ORDER_NOTE, MIN_ADDRESS } from "@/lib/orders-api";
import { cn } from "@/lib/utils";

const toneClass = {
  good: "border-emerald-500/30 bg-emerald-500/5",
  warn: "border-amber-500/30 bg-amber-500/5",
  bad: "border-red-500/30 bg-red-500/5",
  none: "border-border bg-muted/30",
} as const;

function Check({
  tone,
  icon,
  title,
  children,
}: {
  tone: keyof typeof toneClass;
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex gap-3 rounded-lg border p-3 text-sm", toneClass[tone])}>
      <div className="mt-0.5 shrink-0" aria-hidden>
        {icon}
      </div>
      <div>
        <p className="font-medium">{title}</p>
        <p className="text-muted-foreground">{children}</p>
      </div>
    </div>
  );
}

/**
 * Reorder from a delivered order. The check-up on top is the point: nobody reorders blind. Prices are shown, never edited:
 * the database copies them from the earlier order and the supplier can decline if their price has moved.
 */
export function ReorderDialog({
  poId,
  open,
  onOpenChange,
}: {
  poId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const q = useQuery({
    queryKey: [REORDER_KEY, "preview", poId],
    queryFn: () => previewReorder(poId),
    enabled: open,
    staleTime: 0,
    gcTime: 0,
  });
  const [qty, setQty] = useState<Record<string, string>>({});
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [again, setAgain] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const data = q.data;
  useEffect(() => {
    if (!data) return;
    setQty(Object.fromEntries(data.lines.map((l) => [l.id, String(l.qty)])));
    setAddress(data.source.delivery_address);
    setNotes("");
    setAgain(false);
    setError("");
  }, [data]);

  const parsed = useMemo(
    () =>
      (data?.lines ?? []).map((l) => {
        const text = (qty[l.id] ?? "").trim();
        return {
          line: l,
          text,
          qty: text === "" ? null : parseQty(text),
          bad: text !== "" && parseQty(text) === null,
        };
      }),
    [data, qty],
  );
  const chosen = parsed.filter((p) => p.qty !== null);
  const anyBad = parsed.some((p) => p.bad);
  const cur = asCurrency(data?.source.currency);
  const total = data
    ? estimateTotal(
        parsed.map((p) => ({
          qty: p.qty,
          unit_price: p.line.unit_price,
          gst_rate: p.line.gst_rate,
        })),
        data.source.shipping,
        data.source.other_charges,
      )
    : 0;
  const ownerOnly = data
    ? needsOwner(total, data.limit.you_may_exceed, data.limit.owner_only_above)
    : false;
  const addrLen = address.trim().length;
  const addrBad = addrLen < MIN_ADDRESS || addrLen > MAX_ADDRESS;
  const dup = data?.duplicate ?? null;
  const ready =
    !!data &&
    data.can_reorder &&
    chosen.length > 0 &&
    !anyBad &&
    !addrBad &&
    !ownerOnly &&
    (!dup || again) &&
    !busy;

  const submit = async () => {
    if (!data || !ready) return;
    setBusy(true);
    setError("");
    try {
      const r = await reorderPurchaseOrder(poId, {
        lines: chosen.map((p) => ({ id: p.line.id, qty: p.qty as number })),
        deliveryAddress: address.trim(),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        ...(dup ? { allowDuplicate: again } : {}),
      });
      await Promise.all([
        qc.invalidateQueries({ queryKey: [ORDERS_KEY] }),
        qc.invalidateQueries({ queryKey: [REORDER_KEY] }),
      ]);
      toast.success(`${r.number} sent to ${data.supplier.name}. They confirm in one tap.`);
      onOpenChange(false);
      void nav({ to: appPath(`purchase-orders/${r.id}`) as never });
    } catch (e) {
      setError(e instanceof Error ? e.message : reorderError(e));
    } finally {
      setBusy(false);
    }
  };

  const place = data ? [data.supplier.city, data.supplier.state].filter(Boolean).join(", ") : "";
  const due = dueText(data?.rhythm.days_until ?? null);
  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Repeat className="size-5" aria-hidden /> Reorder {data?.source.number ?? ""}
          </DialogTitle>
          <DialogDescription>
            Same supplier, same prices as last time. First a quick check-up, so you never reorder
            blind.
          </DialogDescription>
        </DialogHeader>

        {q.isError ? (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {q.error instanceof Error ? q.error.message : reorderError(q.error)}
          </p>
        ) : !data ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Checking the supplier and your history…
          </p>
        ) : (
          <div className="space-y-4">
            {data.blockers.length > 0 ? (
              <div
                role="alert"
                className="space-y-1 rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-sm"
              >
                {data.blockers.map((b) => (
                  <p key={b}>{blockerText(b)}</p>
                ))}
              </div>
            ) : null}

            <div className="grid gap-2 sm:grid-cols-2">
              <Check
                tone={data.supplier.verified_today ? "good" : "bad"}
                icon={
                  data.supplier.verified_today ? (
                    <ShieldCheck className="size-4 text-emerald-600" />
                  ) : (
                    <ShieldAlert className="size-4 text-red-600" />
                  )
                }
                title={data.supplier.verified_today ? "Still verified today" : "Not verified today"}
              >
                {data.supplier.name}
                {place ? ` · ${place}` : ""}
                {data.supplier.verified_today ? ` · Trust level ${data.supplier.level_now}` : ""}
              </Check>
              <Check
                tone={deliveryTone(data.source.days_vs_promise)}
                icon={<Truck className="size-4" />}
                title="Last delivery"
              >
                {deliveryText(data.source.days_vs_promise)}
                {data.source.delivered_at ? ` (${formatDate(data.source.delivered_at)})` : ""}
              </Check>
              <Check
                tone={dueTone(data.rhythm.days_until) === "late" ? "warn" : "none"}
                icon={<CalendarClock className="size-4" />}
                title={due ?? "Your rhythm"}
              >
                {rhythmText(data.rhythm)}
              </Check>
              <Check
                tone="none"
                icon={<CalendarClock className="size-4" />}
                title="Terms stay the same"
              >
                You pay within {data.source.payment_terms_days} days. The supplier gets the same
                promise of about {data.source.lead_days} days to deliver.
              </Check>
            </div>

            {dup ? (
              <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                <p className="flex items-center gap-2 font-medium">
                  <AlertTriangle className="size-4 text-amber-600" aria-hidden /> You may already
                  have this on its way
                </p>
                <p className="text-muted-foreground">
                  {dup.number} to {data.supplier.name} for the same items is still open (issued{" "}
                  {formatDate(dup.issued_at)}).
                </p>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="reorder-again"
                    checked={again}
                    onCheckedChange={(v) => setAgain(v === true)}
                  />
                  <Label htmlFor="reorder-again" className="cursor-pointer">
                    Order again anyway
                  </Label>
                </div>
              </div>
            ) : null}

            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                    <th className="px-3 py-2 text-left font-medium">Item</th>
                    <th className="px-3 py-2 text-right font-medium">Quantity</th>
                    <th className="px-3 py-2 text-right font-medium">Price (locked)</th>
                    <th className="px-3 py-2 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.map(({ line: l, qty: n, bad }) => {
                    const pct = priceChangePct(l.unit_price, l.earlier_price);
                    return (
                      <tr key={l.id} className="border-b last:border-0 align-top">
                        <td className="px-3 py-2">
                          <p>{l.description}</p>
                          <p className="text-xs text-muted-foreground">
                            Last time: {l.qty} {l.unit}
                          </p>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <Input
                              aria-label={`Quantity of ${l.description}`}
                              inputMode="decimal"
                              className={cn("h-8 w-24 text-right tabular", bad && "border-red-500")}
                              value={qty[l.id] ?? ""}
                              onChange={(e) => setQty((s) => ({ ...s, [l.id]: e.target.value }))}
                              disabled={busy}
                            />
                            <span className="text-xs text-muted-foreground">{l.unit}</span>
                          </div>
                          {n === null && !bad ? (
                            <p className="mt-1 text-xs text-muted-foreground">Left out</p>
                          ) : null}
                          {bad ? (
                            <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                              Above zero, up to 3 decimals
                            </p>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-right tabular">
                          <p>{formatMoney(l.unit_price, { currency: cur, decimals: 2 })}</p>
                          <p
                            className={cn(
                              "text-xs",
                              pct === null || pct === 0
                                ? "text-muted-foreground"
                                : pct > 0
                                  ? "text-red-600 dark:text-red-400"
                                  : "text-emerald-700 dark:text-emerald-400",
                            )}
                          >
                            {priceChangeText(pct)}
                          </p>
                        </td>
                        <td className="px-3 py-2 text-right tabular">
                          {n === null ? "—" : formatMoney(n * l.unit_price, { currency: cur })}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2 text-sm">
              <span className="text-muted-foreground">
                Estimated total with GST and the same shipping
              </span>
              <span className="text-base font-semibold tabular">
                {formatMoney(total, { currency: cur })}
              </span>
            </div>
            {ownerOnly ? (
              <p
                role="alert"
                className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
              >
                Orders above {formatMoney(data.limit.owner_only_above, { currency: cur })} can only
                be placed by the company owner, so a second person always sees them. Lower a
                quantity or ask the owner.
              </p>
            ) : null}

            <div>
              <Label htmlFor="reorder-address">Deliver to</Label>
              <Textarea
                id="reorder-address"
                rows={2}
                maxLength={MAX_ADDRESS}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                disabled={busy}
              />
              {addrBad ? (
                <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                  Enter the delivery address (5 to 500 characters).
                </p>
              ) : null}
            </div>
            <div>
              <Label htmlFor="reorder-notes">Note to the supplier (optional)</Label>
              <Textarea
                id="reorder-notes"
                rows={2}
                maxLength={MAX_ORDER_NOTE}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={busy}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Prices are not editable here. The supplier sees "reorder of {data.source.number} at
              the same prices" and confirms in one tap, or declines with a reason if their price has
              moved.
            </p>
          </div>
        )}

        {error ? (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Not now
          </Button>
          <Button onClick={() => void submit()} disabled={!ready}>
            {busy ? "Sending…" : "Send reorder"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
