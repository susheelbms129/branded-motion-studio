import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, PackageCheck } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Panel } from "@/components/vendora/kit";
import { PAYMENTS_KEY } from "@/lib/msme-payments";
import { ORDERS_KEY } from "@/lib/orders-api";
import {
  checkDraft, closeReceivingShort, fmtQty, getReceiving, initialDraft, MAX_NOTE, MAX_PHOTOS, MAX_REASON, MAX_RESPONSE_NOTE, openReceiptPhoto,
  photoProblem, progress, receivingError, recordGoodsReceipt, RECEIVING_KEY, respondGoodsReceipt, responseLabel, standing, uploadReceiptPhoto,
  voidGoodsReceipt, type DraftLine, type Receipt,
} from "@/lib/goods-receipts";
import { formatDate } from "@/lib/format";
import { useUi } from "@/lib/ui-store";
import { cn } from "@/lib/utils";

type Dlg = "" | "record" | "short" | "void" | "respond";
const TONE = { good: "text-emerald-700", bad: "text-destructive", wait: "text-amber-700" } as const;
const sel = "mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

/**
 * "Goods received" for one purchase order, for both sides. The buyer records each delivery (quantities, rejections, photos); the
 * supplier sees the same record and can agree or dispute it. Which buttons appear, and every rule, comes from the database.
 */
export function GoodsReceivedPanel({ side, poId, issuedOn }: { side: "buyer" | "supplier"; poId: string; issuedOn?: string }) {
  const qc = useQueryClient();
  const buyerOrg = useUi((s) => s.orgId) ?? "";
  const q = useQuery({ queryKey: [RECEIVING_KEY, poId], queryFn: () => getReceiving(poId) });
  const [dlg, setDlg] = useState<Dlg>("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const today = new Date().toISOString().slice(0, 10);

  const [on, setOn] = useState("");
  const [note, setNote] = useState("");
  const [draft, setDraft] = useState<DraftLine[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [text, setText] = useState("");
  const [target, setTarget] = useState<Receipt | null>(null);
  const [answer, setAnswer] = useState<"agreed" | "disputed">("agreed");
  const photoInput = useRef<HTMLInputElement>(null);
  const addPhotoFor = useRef<string>("");

  if (q.isLoading) return <Panel title="Goods received"><p className="text-sm text-muted-foreground" role="status">Loading…</p></Panel>;
  if (q.isError || !q.data) {
    return (
      <Panel title="Goods received">
        <p role="alert" className="text-sm text-destructive">{q.error instanceof Error ? q.error.message : "We couldn't load the delivery record."}</p>
      </Panel>
    );
  }
  const r = q.data;
  if (r.po_status === "issued" || r.po_status === "cancelled") return null;

  const refresh = async () => {
    await Promise.all([qc.invalidateQueries({ queryKey: [RECEIVING_KEY, poId] }), qc.invalidateQueries({ queryKey: [ORDERS_KEY] }), qc.invalidateQueries({ queryKey: [PAYMENTS_KEY] })]);
  };
  const close = () => { if (!busy) { setDlg(""); setErr(""); } };
  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true); setErr("");
    try { await fn(); await refresh(); toast.success(done); setDlg(""); }
    catch (e) { setErr(e instanceof Error ? e.message : receivingError(e)); }
    finally { setBusy(false); }
  };
  const openRecord = () => { setDraft(initialDraft(r.lines)); setOn(today); setNote(""); setFiles([]); setErr(""); setDlg("record"); };
  const chosen = checkDraft(draft, r.lines, on, today, issuedOn);
  const needsPhoto = chosen.ok && chosen.rejectedTotal > 0 && files.length === 0;
  const prog = progress(r.lines);
  const patch = (i: number, p: Partial<DraftLine>) => setDraft((d) => d.map((x, j) => (j === i ? { ...x, ...p } : x)));

  const submitRecord = async () => {
    if (!chosen.ok) return setErr(chosen.error);
    setBusy(true); setErr("");
    let saved: Awaited<ReturnType<typeof recordGoodsReceipt>> | null = null;
    try {
      saved = await recordGoodsReceipt(poId, { receivedOn: on, note, lines: chosen.lines });
    } catch (e) { setErr(e instanceof Error ? e.message : receivingError(e)); setBusy(false); return; }
    const failed: string[] = [];
    for (const f of files.slice(0, MAX_PHOTOS)) {
      try { await uploadReceiptPhoto(buyerOrg, saved.id, f); } catch { failed.push(f.name); }
    }
    await refresh();
    setBusy(false); setDlg("");
    if (failed.length) toast.warning(`Delivery saved. ${failed.length} photo${failed.length > 1 ? "s" : ""} didn't upload; you can add ${failed.length > 1 ? "them" : "it"} from the receipt.`);
    else toast.success(saved.complete ? "Delivery recorded. The order is fully received." : "Delivery recorded.");
  };

  const onPickMore = async (receiptId: string, list: FileList | null) => {
    const f = Array.from(list ?? []);
    if (!f.length) return;
    setBusy(true);
    let bad = 0;
    for (const x of f) { try { await uploadReceiptPhoto(buyerOrg, receiptId, x); } catch (e) { bad++; toast.error(e instanceof Error ? e.message : "Photo failed"); } }
    await refresh(); setBusy(false);
    if (!bad) toast.success("Photo added.");
  };
  const view = async (photoId: string) => {
    try { window.open(await openReceiptPhoto(photoId), "_blank", "noopener"); }
    catch (e) { toast.error(e instanceof Error ? e.message : "We couldn't open that photo."); }
  };

  const action = r.can_record ? (
    <Button size="sm" onClick={openRecord}><PackageCheck className="size-4" /> Record a delivery</Button>
  ) : undefined;

  return (
    <Panel title="Goods received" description={standing(r, side)} action={action}>
      {!r.legacy ? (
        <>
          <div className="mb-3">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{fmtQty(prog.accepted)} of {fmtQty(prog.ordered)} accepted</span><span>{prog.percent}%</span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={prog.percent} aria-valuemin={0} aria-valuemax={100} aria-label="Share of the order accepted">
              <div className="h-full rounded-full bg-emerald-500" style={{ width: `${prog.percent}%` }} />
            </div>
          </div>
          <ul className="divide-y text-sm">
            {r.lines.map((l) => (
              <li key={l.id} className="flex flex-wrap items-baseline justify-between gap-x-4 py-2">
                <span className="font-medium">{l.description}</span>
                <span className="text-xs text-muted-foreground tabular">
                  {fmtQty(l.accepted)} / {fmtQty(l.ordered)} {l.unit}
                  {l.rejected > 0 ? <span className="ml-2 text-destructive">{fmtQty(l.rejected)} rejected</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {r.receipts.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          {r.legacy ? `Delivered on ${formatDate(r.delivered_at ?? "")}.` : side === "buyer" ? "No delivery recorded yet. Record each delivery as it arrives, with quantities and photos." : "The buyer hasn't recorded a delivery yet."}
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {r.receipts.map((x) => {
            const resp = responseLabel(x);
            return (
              <li key={x.id} className={cn("rounded-xl border p-3 text-sm", x.voided && "opacity-60")}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium tabular">{x.number}</span>
                  <span className="text-xs text-muted-foreground">{formatDate(x.received_on)} · recorded by {x.by || "the buyer"}</span>
                  {x.voided ? <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold">Taken back</span>
                    : <span className={cn("text-xs font-medium", TONE[resp.tone])}>{resp.text}</span>}
                </div>
                <ul className="mt-2 space-y-0.5">
                  {x.lines.map((l, i) => (
                    <li key={i} className="text-xs text-muted-foreground">
                      {l.description}: <span className="text-foreground">{fmtQty(l.accepted)} accepted</span>
                      {l.rejected > 0 ? <span className="text-destructive"> · {fmtQty(l.rejected)} rejected ({l.reason})</span> : null} {l.unit}
                    </li>
                  ))}
                </ul>
                {x.note ? <p className="mt-1 text-xs">Note: {x.note}</p> : null}
                {x.voided ? <p className="mt-1 text-xs">Reason: {x.void_reason}</p> : null}
                {x.supplier_response === "disputed" && x.supplier_note ? <p className="mt-1 text-xs text-destructive">Supplier says: {x.supplier_note}</p> : null}
                {x.photos.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {x.photos.map((p, i) => (
                      <button key={p.id} type="button" onClick={() => void view(p.id)} className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted">
                        <Camera className="size-3" aria-hidden /> Photo {i + 1}
                      </button>
                    ))}
                  </div>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-2">
                  {x.can_respond ? <Button size="sm" variant="outline" onClick={() => { setTarget(x); setAnswer(x.supplier_response ?? "agreed"); setText(x.supplier_note); setErr(""); setDlg("respond"); }}>
                    {x.supplier_response ? "Change my answer" : "Agree or dispute"}</Button> : null}
                  {x.can_add_photo ? <Button size="sm" variant="outline" disabled={busy} onClick={() => { addPhotoFor.current = x.id; photoInput.current?.click(); }}><Camera className="size-4" /> Add photo</Button> : null}
                  {x.can_void ? <Button size="sm" variant="outline" onClick={() => { setTarget(x); setText(""); setErr(""); setDlg("void"); }}>Take back</Button> : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {r.can_close_short ? (
        <Button className="mt-3" variant="outline" size="sm" onClick={() => { setText(""); setErr(""); setDlg("short"); }}>Close as short-delivered</Button>
      ) : null}
      <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" aria-label="Add photos to a receipt"
        onChange={(e) => { void onPickMore(addPhotoFor.current, e.target.files); e.target.value = ""; }} />

      <Dialog open={dlg === "record"} onOpenChange={(v) => !v && close()}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Record a delivery</DialogTitle>
            <DialogDescription>Enter what you accepted and rejected today. It starts filled with everything still to come; change anything that differs. The supplier is told.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label htmlFor="grn-date">Arrived on</Label>
              <Input id="grn-date" type="date" min={issuedOn} max={today} value={on} onChange={(e) => setOn(e.target.value)} /></div>
            {r.lines.map((l, i) => {
              const d = draft[i];
              if (!d) return null;
              const rej = (parseFloat(d.rejected) || 0) > 0;
              return (
                <fieldset key={l.id} className="rounded-lg border p-3">
                  <legend className="px-1 text-sm font-medium">{l.description}</legend>
                  <p className="text-xs text-muted-foreground">Ordered {fmtQty(l.ordered)} {l.unit} · accepted so far {fmtQty(l.accepted)} · still to accept {fmtQty(l.remaining)}</p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <div><Label htmlFor={`acc-${i}`}>Accepted</Label>
                      <Input id={`acc-${i}`} inputMode="decimal" value={d.accepted} disabled={l.remaining === 0 && !rej} onChange={(e) => patch(i, { accepted: e.target.value })} /></div>
                    <div><Label htmlFor={`rej-${i}`}>Rejected</Label>
                      <Input id={`rej-${i}`} inputMode="decimal" value={d.rejected} onChange={(e) => patch(i, { rejected: e.target.value })} /></div>
                  </div>
                  {rej ? (
                    <div className="mt-2"><Label htmlFor={`why-${i}`}>Why was it rejected?</Label>
                      <Input id={`why-${i}`} maxLength={MAX_REASON} placeholder="Damaged, wrong grade, short weight…" value={d.reason} onChange={(e) => patch(i, { reason: e.target.value })} /></div>
                  ) : null}
                </fieldset>
              );
            })}
            <div><Label htmlFor="grn-note">Note (optional)</Label>
              <Textarea id="grn-note" rows={2} maxLength={MAX_NOTE} value={note} onChange={(e) => setNote(e.target.value)} /></div>
            <div>
              <Label htmlFor="grn-photos">Photos (optional, up to {MAX_PHOTOS})</Label>
              <Input id="grn-photos" type="file" accept="image/jpeg,image/png,image/webp" multiple
                onChange={(e) => {
                  const picked = Array.from(e.target.files ?? []);
                  const badOne = picked.map((f) => photoProblem(f)).find(Boolean);
                  if (badOne) { setErr(badOne); return; }
                  setErr(""); setFiles(picked.slice(0, MAX_PHOTOS));
                }} />
              {files.length > 0 ? <p className="mt-1 text-xs text-muted-foreground">{files.length} photo{files.length > 1 ? "s" : ""} chosen. They are made smaller before upload.</p> : null}
              {needsPhoto ? <p className="mt-1 text-xs text-amber-700">You rejected goods. A photo protects you if the supplier disagrees.</p> : null}
            </div>
          </div>
          {err || (draft.length > 0 && !chosen.ok) ? (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">{err || chosen.error}</p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={close} disabled={busy}>Cancel</Button>
            <Button onClick={() => void submitRecord()} disabled={busy || !chosen.ok}>{busy ? "Saving…" : "Record delivery"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dlg === "short"} onOpenChange={(v) => !v && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Close as short-delivered</DialogTitle>
            <DialogDescription>Use this when the rest will never arrive. What you accepted counts as the delivery, and the payment period starts from the last accepted delivery. The supplier is told.</DialogDescription>
          </DialogHeader>
          <Label htmlFor="short-why">Reason</Label>
          <Textarea id="short-why" rows={3} maxLength={MAX_REASON} value={text} onChange={(e) => setText(e.target.value)} />
          {err ? <p role="alert" className="text-sm text-red-600 dark:text-red-400">{err}</p> : null}
          <DialogFooter>
            <Button variant="outline" onClick={close} disabled={busy}>Cancel</Button>
            <Button disabled={busy || text.trim().length < 3} onClick={() => void run(() => closeReceivingShort(poId, text), "Order closed as short-delivered")}>{busy ? "Saving…" : "Close order"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dlg === "void"} onOpenChange={(v) => !v && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Take back {target?.number}?</DialogTitle>
            <DialogDescription>Use this for a mistake (wrong date or quantity). It stays on the record, marked as taken back, and the supplier is told. You can do this within 48 hours, and only before a payment or objection exists.</DialogDescription>
          </DialogHeader>
          <Label htmlFor="void-why">What was wrong?</Label>
          <Textarea id="void-why" rows={3} maxLength={MAX_REASON} value={text} onChange={(e) => setText(e.target.value)} />
          {err ? <p role="alert" className="text-sm text-red-600 dark:text-red-400">{err}</p> : null}
          <DialogFooter>
            <Button variant="outline" onClick={close} disabled={busy}>Cancel</Button>
            <Button variant="destructive" disabled={busy || text.trim().length < 3 || !target} onClick={() => void run(() => voidGoodsReceipt(target!.id, text), "Receipt taken back")}>{busy ? "Saving…" : "Take it back"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dlg === "respond"} onOpenChange={(v) => !v && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Is {target?.number} correct?</DialogTitle>
            <DialogDescription>Tell the buyer whether this matches what you delivered. A dispute is a record both sides can see. It does not stop the payment period; a formal objection is made in the payment section.</DialogDescription>
          </DialogHeader>
          <Label htmlFor="resp-kind">Your answer</Label>
          <select id="resp-kind" className={sel} value={answer} onChange={(e) => setAnswer(e.target.value as "agreed" | "disputed")}>
            <option value="agreed">Agree, this is correct</option>
            <option value="disputed">Dispute, something is different</option>
          </select>
          {answer === "disputed" ? (
            <>
              <Label htmlFor="resp-note" className="mt-3 block">What is different?</Label>
              <Textarea id="resp-note" rows={3} maxLength={MAX_RESPONSE_NOTE} value={text} onChange={(e) => setText(e.target.value)} />
            </>
          ) : null}
          {err ? <p role="alert" className="text-sm text-red-600 dark:text-red-400">{err}</p> : null}
          <DialogFooter>
            <Button variant="outline" onClick={close} disabled={busy}>Cancel</Button>
            <Button disabled={busy || !target || (answer === "disputed" && text.trim().length < 3)}
              onClick={() => void run(() => respondGoodsReceipt(target!.id, answer, answer === "disputed" ? text : ""), "Your answer was sent")}>{busy ? "Saving…" : "Send answer"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}
