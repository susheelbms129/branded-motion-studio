import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ClipboardList, RotateCcw, Send, Trash2, X } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, PageHeader, Panel, Person, StatusBadge, Timeline } from "@/components/vendora/kit";
import { formatDate, formatMoney } from "@/lib/format";
import { AppLink, useAppNavigate } from "@/lib/nav";
import {
  APPROVAL_LIMIT,
  decideRequest,
  deleteDraftRequest,
  getRequest,
  requestError,
  submitRequest,
  withdrawRequest,
  type RequestEvent,
} from "@/lib/requests-api";
import { cn } from "@/lib/utils";
import type { TimelineEvent } from "@/types/domain";
import { REQUESTS_KEY } from "./use-requests";

// The database records a few more event kinds than the shared timeline knows; map them to the closest look.
const EVENT_LOOK: Record<RequestEvent["type"], TimelineEvent["type"]> = {
  created: "created",
  submitted: "submitted",
  routed: "sent",
  approved: "approved",
  rejected: "rejected",
  withdrawn: "updated",
  auto_approved: "approved",
};

/** One real purchase request, read from the database. What each person may do comes from the database too. */
export function RequestDetailReal({ id }: { id: string }) {
  const qc = useQueryClient();
  const go = useAppNavigate();
  const [dlg, setDlg] = useState<"approve" | "reject" | "delete" | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const q = useQuery({ queryKey: [REQUESTS_KEY, "detail", id], queryFn: () => getRequest(id), retry: false });

  if (q.isLoading) return <p className="py-16 text-center text-sm text-muted-foreground">Loading request…</p>;
  const d = q.data;
  if (!d)
    return (
      <EmptyState
        icon={ClipboardList}
        title="Request not found"
        body={
          q.error instanceof Error && !q.error.message.includes("isn't available")
            ? q.error.message
            : "It may have been removed, or you may be in a different company."
        }
        action={
          <Button asChild>
            <AppLink to="requests">Back to requests</AppLink>
          </Button>
        }
      />
    );

  const r = d.request;
  const refresh = () => qc.invalidateQueries({ queryKey: [REQUESTS_KEY] });
  const act = async (work: () => Promise<unknown>, done: string, after?: () => void) => {
    if (busy) return;
    setBusy(true);
    try {
      await work();
      toast.success(done);
      after?.();
    } catch (e) {
      toast.error(requestError(e));
    } finally {
      setBusy(false);
      void refresh();
    }
  };
  const events: TimelineEvent[] = d.events.map((e) => ({
    id: String(e.id),
    at: e.at,
    actorId: e.actor_name,
    type: EVENT_LOOK[e.type] ?? "updated",
    text: e.text,
  }));
  const waiting = d.approvals.find((a) => a.status === "pending");

  return (
    <>
      <PageHeader
        title={<span className="tabular">{r.number}</span>}
        meta={<StatusBadge kind="request" value={r.status} />}
        description={r.title}
        crumbs={[{ label: "Purchase Requests", to: "requests" }, { label: r.number }]}
        actions={
          <>
            {r.status === "draft" && d.is_requester ? (
              <>
                <Button variant="outline" disabled={busy} onClick={() => setDlg("delete")}>
                  <Trash2 />
                  Delete draft
                </Button>
                <Button
                  disabled={busy}
                  onClick={() =>
                    void act(
                      async () => {
                        const res = await submitRequest(r.id);
                        if (res.status === "approved") toast.info("Approved automatically: nobody else can approve yet.");
                      },
                      "Submitted for approval",
                    )
                  }
                >
                  <Send />
                  Submit for approval
                </Button>
              </>
            ) : null}
            {d.can_withdraw ? (
              <Button variant="outline" disabled={busy} onClick={() => void act(() => withdrawRequest(r.id), "Withdrawn. It's a draft again.")}>
                <RotateCcw />
                Withdraw
              </Button>
            ) : null}
            {d.can_decide ? (
              <>
                <Button variant="outline" disabled={busy} onClick={() => setDlg("reject")}>
                  <X />
                  Reject
                </Button>
                <Button disabled={busy} onClick={() => setDlg("approve")}>
                  <Check />
                  Approve
                </Button>
              </>
            ) : null}
          </>
        }
      />
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          {r.status === "approved" ? (
            <Panel title="Approved">
              <p className="text-sm text-muted-foreground">
                This request is approved. The next step is sending it to verified suppliers for quotations; that arrives in the next
                update.
              </p>
            </Panel>
          ) : null}
          <Panel
            title="Items"
            action={<span className="text-sm font-semibold tabular">{formatMoney(r.total)}</span>}
            bodyClassName="p-0"
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-y bg-muted/40 text-xs text-muted-foreground">
                    <th className="px-5 py-2 text-left font-medium">Item</th>
                    <th className="px-3 py-2 text-right font-medium">Qty</th>
                    <th className="px-3 py-2 text-right font-medium">Est. unit</th>
                    <th className="px-5 py-2 text-right font-medium">Est. amount</th>
                  </tr>
                </thead>
                <tbody>
                  {d.items.map((i) => (
                    <tr key={i.id} className="border-b last:border-0">
                      <td className="px-5 py-3">{i.description}</td>
                      <td className="px-3 py-3 text-right tabular">
                        {i.qty} {i.unit}
                      </td>
                      <td className="px-3 py-3 text-right tabular">{formatMoney(i.unit_price, { decimals: 2 })}</td>
                      <td className="px-5 py-3 text-right tabular">{formatMoney(i.qty * i.unit_price)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
          <Panel title="Justification">
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">{r.justification}</p>
          </Panel>
          {d.approvals.length ? (
            <Panel
              title="Approval chain"
              description={`Requests above ${formatMoney(APPROVAL_LIMIT)} require a second level`}
            >
              <ol className="space-y-3">
                {d.approvals.map((a) => (
                  <li
                    key={a.id}
                    className={cn(
                      "flex items-start gap-3 rounded-xl border p-3",
                      a.status === "pending" && "border-amber/40 bg-amber/5",
                    )}
                  >
                    <Person name={a.approver_name} accent="violet" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">
                          Level {a.level} · {a.approver_name}
                        </span>
                        <StatusBadge kind="approval" value={a.status} />
                      </div>
                      {a.comment ? <p className="mt-1 text-xs text-muted-foreground">“{a.comment}”</p> : null}
                      {a.decided_at ? <p className="text-[11px] text-subtle-foreground">{formatDate(a.decided_at)}</p> : null}
                    </div>
                  </li>
                ))}
              </ol>
            </Panel>
          ) : null}
        </div>
        <div className="space-y-4">
          <Panel title="Details">
            <dl className="space-y-3 text-sm">
              {[
                ["Requester", r.requester_name],
                ["Department", r.department],
                ["Category", r.category || "—"],
                ["Raised on", formatDate(r.created_at)],
                ["Needed by", formatDate(r.needed_by)],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="text-right tabular">{v}</dd>
                </div>
              ))}
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Priority</dt>
                <dd>
                  <StatusBadge kind="priority" value={r.priority} />
                </dd>
              </div>
              {waiting ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Waiting on</dt>
                  <dd className="text-right">{waiting.approver_name}</dd>
                </div>
              ) : null}
            </dl>
          </Panel>
          <Panel title="Status timeline">
            <Timeline events={events} nameOf={(x) => x} />
          </Panel>
        </div>
      </div>

      <Dialog open={dlg === "approve" || dlg === "reject"} onOpenChange={(o) => !o && setDlg(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dlg === "approve" ? "Approve request" : "Reject request"}</DialogTitle>
            <DialogDescription>
              {r.number} · {formatMoney(r.total)}
            </DialogDescription>
          </DialogHeader>
          <Label htmlFor="cm">Comment {dlg === "reject" ? "(required)" : "(optional)"}</Label>
          <Textarea id="cm" value={comment} maxLength={1000} onChange={(e) => setComment(e.target.value)} rows={3} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDlg(null)}>
              Cancel
            </Button>
            <Button
              variant={dlg === "reject" ? "destructive" : "default"}
              disabled={busy || (dlg === "reject" && comment.trim().length === 0)}
              onClick={() => {
                const decision = dlg === "approve" ? "approved" : "rejected";
                void act(
                  () => decideRequest(r.id, decision, comment.trim()),
                  decision === "approved" ? "Approved" : "Rejected",
                  () => {
                    setDlg(null);
                    setComment("");
                  },
                );
              }}
            >
              {dlg === "approve" ? "Approve" : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dlg === "delete"} onOpenChange={(o) => !o && setDlg(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this draft?</DialogTitle>
            <DialogDescription>
              {r.number} will be removed for good. Submitted requests can't be deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDlg(null)}>
              Keep it
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() =>
                void act(() => deleteDraftRequest(r.id), "Draft deleted", () => {
                  setDlg(null);
                  go("requests");
                })
              }
            >
              Delete draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
