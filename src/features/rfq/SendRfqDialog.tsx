import { useQuery, useQueryClient } from "@tanstack/react-query";
import { addDays, format } from "date-fns";
import { Landmark, FileCheck2, Search, ShieldCheck } from "lucide-react";
import { useState } from "react";
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
import { fmtDate } from "@/components/trust/TrustPassport";
import {
  listSavedSuppliers,
  listSuppliers,
  NO_FILTERS,
  type DirectorySupplier,
} from "@/lib/directory-api";
import {
  LEVEL_NAMES,
  MAX_DUE_DAYS,
  MAX_RFQ_NOTE,
  MAX_RFQ_SUPPLIERS,
  RFQ_KEY,
  rfqError,
  sendRfq,
} from "@/lib/rfqs-api";
import { cn } from "@/lib/utils";
import { useUi } from "@/lib/ui-store";
import { REQUESTS_KEY } from "@/features/requests/use-requests";

type Source = "saved" | "directory";

/** One supplier row. Suppliers without a currently valid proof are shown but cannot be picked. */
function Row({
  s,
  on,
  disabled,
  onToggle,
}: {
  s: DirectorySupplier;
  on: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const verified = s.level >= 1;
  const place = [s.city, s.state].filter(Boolean).join(", ");
  return (
    <li>
      <label
        className={cn(
          "flex items-start gap-3 rounded-xl border p-3 transition",
          verified ? "cursor-pointer hover:bg-muted/40" : "cursor-not-allowed opacity-60",
          on && "border-primary/50 bg-primary/5",
        )}
      >
        <Checkbox
          className="mt-1"
          checked={on}
          disabled={!verified || (disabled && !on)}
          onCheckedChange={onToggle}
          aria-label={`Invite ${s.name}`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-x-3">
            <span className="truncate text-sm font-semibold">{s.name}</span>
            <span
              className={cn(
                "text-xs font-medium",
                verified ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground",
              )}
            >
              {verified ? `${s.level_name} · Level ${s.level} of 3` : "Not verified yet"}
            </span>
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {[place, s.categories.slice(0, 3).join(", ")].filter(Boolean).join(" · ")}
          </p>
          {verified ? (
            <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              {s.government_checked ? (
                <Landmark className="size-3.5" />
              ) : (
                <FileCheck2 className="size-3.5" />
              )}
              {s.government_checked ? "Government record checked" : "Document reviewed"}
              {s.valid_through ? ` · valid through ${fmtDate(s.valid_through)}` : ""}
            </p>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">
              Can't be invited until their registration proof is verified.
            </p>
          )}
        </div>
      </label>
    </li>
  );
}

/**
 * Sends one approved request to chosen suppliers as an RFQ. The picker is a convenience: the database re-checks every
 * supplier's Trust Passport at the moment of sending, so a stale list can never invite an unverified supplier.
 */
export function SendRfqDialog({
  requestId,
  requestTitle,
  category,
  open,
  onOpenChange,
  onSent,
}: {
  requestId: string;
  requestTitle: string;
  category: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSent: (rfq: { id: string; number: string; invited: number }) => void;
}) {
  const qc = useQueryClient();
  const orgId = useUi((s) => s.orgId);
  const [source, setSource] = useState<Source>("saved");
  const [term, setTerm] = useState("");
  const [search, setSearch] = useState("");
  const [sameCategory, setSameCategory] = useState(false);
  const [picked, setPicked] = useState<Map<string, string>>(new Map());
  const [due, setDue] = useState(format(addDays(new Date(), 7), "yyyy-MM-dd"));
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const saved = useQuery({
    queryKey: [RFQ_KEY, "picker-saved", orgId],
    queryFn: () => listSavedSuppliers(orgId!, 0),
    enabled: open && !!orgId && source === "saved",
  });
  const dir = useQuery({
    queryKey: [RFQ_KEY, "picker-directory", search, sameCategory ? category : ""],
    queryFn: () =>
      listSuppliers(
        { ...NO_FILTERS, search, category: sameCategory ? category : "", verifiedOnly: true },
        0,
      ),
    enabled: open && source === "directory",
  });
  const active = source === "saved" ? saved : dir;
  const list = active.data?.items ?? [];

  const tomorrow = format(addDays(new Date(), 1), "yyyy-MM-dd");
  const latest = format(addDays(new Date(), MAX_DUE_DAYS), "yyyy-MM-dd");
  const dueOk = due >= tomorrow && due <= latest;
  const full = picked.size >= MAX_RFQ_SUPPLIERS;
  const canSend = picked.size > 0 && dueOk && notes.length <= MAX_RFQ_NOTE && !busy;

  const toggle = (s: DirectorySupplier) =>
    setPicked((m) => {
      const n = new Map(m);
      if (n.has(s.org_id)) n.delete(s.org_id);
      else if (n.size < MAX_RFQ_SUPPLIERS) n.set(s.org_id, s.name);
      return n;
    });

  const submit = async () => {
    if (!canSend) return;
    setBusy(true);
    try {
      const res = await sendRfq(requestId, {
        supplierIds: [...picked.keys()],
        dueDate: due,
        notes: notes.trim(),
      });
      toast.success(
        `${res.number} sent to ${res.invited} verified supplier${res.invited === 1 ? "" : "s"}`,
      );
      void qc.invalidateQueries({ queryKey: [REQUESTS_KEY] });
      void qc.invalidateQueries({ queryKey: [RFQ_KEY] });
      onOpenChange(false);
      onSent(res);
    } catch (e) {
      toast.error(rfqError(e));
      // a supplier may have lapsed since the list loaded: refresh it so the buyer sees the truth
      void qc.invalidateQueries({ queryKey: [RFQ_KEY, "picker-saved"] });
      void qc.invalidateQueries({ queryKey: [RFQ_KEY, "picker-directory"] });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Send to suppliers for quotation</DialogTitle>
          <DialogDescription>
            <span className="font-medium text-foreground">{requestTitle}</span>. Only suppliers
            whose Trust Passport is verified and still valid can be invited. Suppliers see what you
            need and how much, never your estimated prices.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="rfq-due">Quotes due by</Label>
              <Input
                id="rfq-due"
                type="date"
                value={due}
                min={tomorrow}
                max={latest}
                onChange={(e) => setDue(e.target.value)}
              />
              {!dueOk ? (
                <p className="text-xs text-destructive">
                  Pick a date from tomorrow up to {MAX_DUE_DAYS} days away.
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rfq-notes">Note for suppliers (optional)</Label>
              <Textarea
                id="rfq-notes"
                rows={2}
                value={notes}
                maxLength={MAX_RFQ_NOTE}
                placeholder="Delivery address, packing, certificates needed…"
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div
                className="inline-flex rounded-lg border p-0.5 text-sm"
                role="tablist"
                aria-label="Where to pick suppliers from"
              >
                {(["saved", "directory"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    role="tab"
                    aria-selected={source === k}
                    onClick={() => setSource(k)}
                    className={cn(
                      "rounded-md px-3 py-1.5 font-medium transition",
                      source === k
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {k === "saved" ? "Saved suppliers" : "Find in directory"}
                  </button>
                ))}
              </div>
              <span className="text-sm text-muted-foreground tabular">
                {picked.size} of {MAX_RFQ_SUPPLIERS} chosen
              </span>
            </div>

            {source === "directory" ? (
              <div className="space-y-2">
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    setSearch(term.trim());
                  }}
                >
                  <Input
                    value={term}
                    onChange={(e) => setTerm(e.target.value)}
                    placeholder="Search by name, city or category"
                    aria-label="Search verified suppliers"
                  />
                  <Button type="submit" variant="outline">
                    <Search />
                    Search
                  </Button>
                </form>
                {category ? (
                  <label className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Checkbox
                      checked={sameCategory}
                      onCheckedChange={(v) => setSameCategory(v === true)}
                    />
                    Only suppliers in “{category}”
                  </label>
                ) : null}
              </div>
            ) : null}

            {active.isLoading ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Loading suppliers…</p>
            ) : active.isError ? (
              <p className="py-8 text-center text-sm text-destructive">
                {active.error instanceof Error
                  ? active.error.message
                  : "We couldn't load suppliers."}
              </p>
            ) : list.length === 0 ? (
              <p className="rounded-xl border border-dashed py-8 text-center text-sm text-muted-foreground">
                {source === "saved"
                  ? "You haven't saved any suppliers yet. Switch to “Find in directory” to pick verified suppliers."
                  : "No verified suppliers match. Try a different search."}
              </p>
            ) : (
              <ul className="max-h-72 space-y-2 overflow-y-auto pr-1">
                {list.map((s) => (
                  <Row
                    key={s.org_id}
                    s={s}
                    on={picked.has(s.org_id)}
                    disabled={full}
                    onToggle={() => toggle(s)}
                  />
                ))}
              </ul>
            )}
            {full ? (
              <p className="text-xs text-muted-foreground">
                You've reached the limit of {MAX_RFQ_SUPPLIERS} suppliers per RFQ.
              </p>
            ) : null}
          </div>

          {picked.size ? (
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Chosen: </span>
              {[...picked.values()].join(", ")}
            </p>
          ) : null}
          <p className="flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" />
            Vendora re-checks each supplier's Trust Passport ({LEVEL_NAMES[1]} or higher) at the
            moment you send, and records the level on the RFQ as proof.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!canSend} onClick={() => void submit()}>
            {busy
              ? "Sending…"
              : `Send RFQ to ${picked.size} supplier${picked.size === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
