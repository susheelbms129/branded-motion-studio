import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Panel } from "@/components/vendora/kit";
import { Textarea } from "@/components/ui/textarea";
import {
  appliesText, clearObjection, confirmPayment, deductionText, disputePayment, getPoPayment, getSupplierPoPayment, MSME_DISCLAIMER,
  PAY_METHODS, PAYMENTS_CHANGED, PAYMENTS_KEY, payError, raiseObjection, recordPayment, voidPayment, type PayMethod,
} from "@/lib/msme-payments";
import { formatDate } from "@/lib/format";
import { DueLine, money, PayBadge, RuleNote, dayText } from "./PayParts";

type Props = { side: "buyer"; poId: string; currency?: string } | { side: "supplier"; poId: string; orgId: string; currency?: string };

/**
 * "When is this paid?" for one order. The buyer records payments and may raise a written objection; the supplier confirms or
 * disputes each payment. Dates, interest and the tax-year warning come from the database, never from this file.
 */
export function PaymentPanel(p: Props) {
  const qc = useQueryClient();
  const supplierOrg = p.side === "supplier" ? p.orgId : "";
  const key = [PAYMENTS_KEY, "po", p.side, p.poId];
  const q = useQuery({
    queryKey: key,
    queryFn: () => (p.side === "buyer" ? getPoPayment(p.poId) : getSupplierPoPayment(p.orgId, p.poId)),
  });
  const [dlg, setDlg] = useState<"" | "pay" | "object" | "dispute">("");
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState("");
  const [method, setMethod] = useState<PayMethod>("bank_transfer");
  const [ref, setRef] = useState("");
  const [note, setNote] = useState("");
  const today = new Date().toISOString().slice(0, 10);

  if (q.isLoading) return <Panel title="Payment"><p className="text-sm text-muted-foreground">Loading…</p></Panel>;
  if (q.isError || !q.data) {
    return (
      <Panel title="Payment">
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">{q.error instanceof Error ? q.error.message : "We couldn't load the payment details."}</p>
        <Button size="sm" variant="outline" className="mt-3" onClick={() => void q.refetch()}>Try again</Button>
      </Panel>
    );
  }
  const d = q.data;
  const s = d.state;
  if (s.status === "none") return null;
  const cur = p.currency;

  const done = async (msg: string) => {
    toast.success(msg);
    setDlg(""); setNote(""); setAmount(""); setRef(""); setPaidOn(""); setErr("");
    await qc.invalidateQueries({ queryKey: [PAYMENTS_KEY] });
    window.dispatchEvent(new Event(PAYMENTS_CHANGED));
  };
  const run = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true); setErr("");
    try { await fn(); await done(msg); } catch (e) { setErr(e instanceof Error ? e.message : payError(e)); } finally { setBusy(false); }
  };
  const covered = s.applies === "yes";

  return (
    <>
      <Panel title="Payment" description={covered ? "MSME 45-day rule applies" : undefined} action={<PayBadge status={s.status} />}>
        <div className="space-y-4 text-sm">
          <p className="text-base"><DueLine s={s} side={p.side} /></p>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
            <dt className="text-muted-foreground">Order value</dt><dd className="text-right tabular">{money(s.total, cur)}</dd>
            <dt className="text-muted-foreground">Paid so far</dt><dd className="text-right tabular">{money(s.paid, cur)}</dd>
            <dt className="text-muted-foreground">Still owed</dt><dd className="text-right font-semibold tabular">{money(s.balance, cur)}</dd>
            <dt className="text-muted-foreground">Agreed terms</dt>
            <dd className="text-right">{s.agreed_days} days{s.capped ? ` → ${s.due_days} by law` : ""}</dd>
            {s.accepted_on ? (<><dt className="text-muted-foreground">Goods accepted</dt><dd className="text-right">{dayText(s.accepted_on)}</dd></>) : null}
          </dl>

          <RuleNote>{appliesText(s, p.side)}</RuleNote>

          {s.on_hold ? (
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
              <strong>Objection raised</strong> {s.objection_at ? `on ${formatDate(s.objection_at)}` : ""}: {s.objection_note}
              <span className="mt-1 block text-muted-foreground">The payment period starts from the day the objection is settled.</span>
            </p>
          ) : null}

          {p.side === "buyer" && covered && s.deduction !== "na" ? (
            <p className={s.deduction === "at_risk" || s.deduction === "deferred" ? "rounded-lg border border-amber-500/30 bg-amber-500/5 p-3" : "text-muted-foreground"}>
              <strong>Tax:</strong> {deductionText(s, (n) => money(n, cur), (x) => formatDate(x))}
            </p>
          ) : null}

          {covered && s.interest_estimate > 0 ? (
            <p className="rounded-lg border border-red-500/30 bg-red-500/5 p-3">
              {p.side === "buyer" ? "Interest the supplier can claim (estimate): " : "Interest you can claim (estimate): "}
              <strong className="tabular">{money(s.interest_estimate, cur)}</strong>
              <span className="mt-1 block text-xs text-muted-foreground">Three times the RBI bank rate ({s.bank_rate}%), compounded monthly.</span>
            </p>
          ) : null}

          {d.payments.length > 0 ? (
            <div>
              <h3 className="mb-1 font-medium">Payments</h3>
              <ul className="divide-y divide-border rounded-lg border border-border">
                {d.payments.map((x) => (
                  <li key={x.id} className="space-y-1 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium tabular">{money(x.amount, cur)}</span>
                      <span className="text-muted-foreground">{formatDate(x.paid_on)} · {PAY_METHODS.find((m) => m.value === x.method)?.label.split(" (")[0]}</span>
                    </div>
                    {x.reference ? <p className="text-xs text-muted-foreground">Ref {x.reference}</p> : null}
                    <p className="text-xs">
                      {x.confirmed_at ? <span className="text-emerald-700 dark:text-emerald-400">✓ Supplier confirmed {formatDate(x.confirmed_at)}</span>
                        : x.disputed_at ? <span className="text-red-700 dark:text-red-400">Supplier says it did not arrive: {x.dispute_note}</span>
                        : <span className="text-muted-foreground">Waiting for the supplier to confirm</span>}
                    </p>
                    <div className="flex gap-3">
                      {p.side === "supplier" && x.can_respond ? (
                        <>
                          <button type="button" className="text-xs font-semibold text-primary hover:underline" disabled={busy}
                            onClick={() => void run(() => confirmPayment(supplierOrg, x.id), "Payment confirmed")}>Yes, we received it</button>
                          <button type="button" className="text-xs font-semibold text-red-600 hover:underline" disabled={busy}
                            onClick={() => { setTarget(x.id); setNote(""); setErr(""); setDlg("dispute"); }}>It did not arrive</button>
                        </>
                      ) : null}
                      {p.side === "buyer" && x.can_void ? (
                        <button type="button" className="text-xs font-semibold text-muted-foreground hover:text-foreground" disabled={busy}
                          onClick={() => void run(() => voidPayment(x.id), "Payment removed")}>Remove (mistake)</button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {p.side === "buyer" ? (
            <div className="flex flex-wrap gap-2 no-print">
              {d.can_record ? <Button size="sm" onClick={() => { setErr(""); setAmount(String(s.balance)); setDlg("pay"); }}>Record a payment</Button> : null}
              {d.can_object ? <Button size="sm" variant="outline" onClick={() => { setErr(""); setNote(""); setDlg("object"); }}>Raise an objection</Button> : null}
              {d.can_clear_objection ? <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => clearObjection(p.poId), "Objection settled")}>Settle the objection</Button> : null}
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground">{MSME_DISCLAIMER}</p>
        </div>
      </Panel>

      <Dialog open={dlg === "pay"} onOpenChange={(v) => !busy && setDlg(v ? "pay" : "")}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record a payment</DialogTitle>
            <DialogDescription>Only record money that has actually left your account. The supplier is asked to confirm it.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label htmlFor="pay-amt">Amount (still owed {money(s.balance, cur)})</Label>
              <Input id="pay-amt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
            <div><Label htmlFor="pay-date">Paid on</Label>
              <Input id="pay-date" type="date" max={today} value={paidOn || today} onChange={(e) => setPaidOn(e.target.value)} /></div>
            <div><Label htmlFor="pay-method">How</Label>
              <select id="pay-method" className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={method} onChange={(e) => setMethod(e.target.value as PayMethod)}>
                {PAY_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select></div>
            <div><Label htmlFor="pay-ref">Reference or UTR (optional)</Label>
              <Input id="pay-ref" maxLength={100} value={ref} onChange={(e) => setRef(e.target.value)} /></div>
          </div>
          {err ? <p role="alert" className="text-sm text-red-600 dark:text-red-400">{err}</p> : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDlg("")} disabled={busy}>Cancel</Button>
            <Button disabled={busy} onClick={() => {
              const a = Number(amount);
              if (!Number.isFinite(a) || a <= 0) return setErr("Enter an amount greater than zero.");
              void run(() => recordPayment(p.poId, { amount: a, paidOn: paidOn || today, method, reference: ref, note: "" }), "Payment recorded");
            }}>{busy ? "Saving…" : "Record payment"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dlg === "object"} onOpenChange={(v) => !busy && setDlg(v ? "object" : "")}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Raise a written objection</DialogTitle>
            <DialogDescription>
              Use this only if the goods are not as ordered. You have 15 days from delivery. The payment period then starts when you settle it.
              The supplier sees your reason.
            </DialogDescription>
          </DialogHeader>
          <Label htmlFor="obj-note">What is wrong?</Label>
          <Textarea id="obj-note" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          {err ? <p role="alert" className="text-sm text-red-600 dark:text-red-400">{err}</p> : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDlg("")} disabled={busy}>Cancel</Button>
            <Button disabled={busy} onClick={() => void run(() => raiseObjection(p.poId, note), "Objection raised")}>Raise objection</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dlg === "dispute"} onOpenChange={(v) => !busy && setDlg(v ? "dispute" : "")}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>The money did not arrive</DialogTitle>
            <DialogDescription>The buyer is told and can correct the record.</DialogDescription>
          </DialogHeader>
          <Label htmlFor="dis-note">What do you see?</Label>
          <Textarea id="dis-note" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          {err ? <p role="alert" className="text-sm text-red-600 dark:text-red-400">{err}</p> : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDlg("")} disabled={busy}>Cancel</Button>
            <Button disabled={busy || !supplierOrg} onClick={() => void run(() => disputePayment(supplierOrg, target, note), "The buyer has been told")}>Send</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
