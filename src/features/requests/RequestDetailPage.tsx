import { useParams } from "@tanstack/react-router";
import { addDays, format } from "date-fns";
import { Check, ClipboardList, Send, X } from "lucide-react";
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
import {
  Can,
  EmptyState,
  PageHeader,
  Panel,
  Person,
  StatusBadge,
  Timeline,
} from "@/components/vendora/kit";
import { formatDate, formatMoney } from "@/lib/format";
import { AppLink, useAppNavigate } from "@/lib/nav";
import { nameOf, requestTotal } from "@/lib/selectors";
import { cn } from "@/lib/utils";
import { useActor, useWs } from "@/lib/ws-store";

export function RequestDetailPage() {
  const { id } = useParams({ strict: false }) as { id: string };
  const ws = useWs();
  const actor = useActor();
  const go = useAppNavigate();
  const [dlg, setDlg] = useState<"approve" | "reject" | "rfq" | null>(null);
  const [comment, setComment] = useState("");
  const [picked, setPicked] = useState<string[] | null>(null);
  const [due, setDue] = useState(format(addDays(new Date(), 7), "yyyy-MM-dd"));
  const r = ws.requests.find((x) => x.id === id);
  if (!r)
    return (
      <EmptyState
        icon={ClipboardList}
        title="Request not found"
        body="It may have been removed, or you may be in a different workspace."
        action={
          <Button asChild>
            <AppLink to="requests">Back to requests</AppLink>
          </Button>
        }
      />
    );
  const total = requestTotal(r.items);
  const candidates = ws.suppliers.filter((s) => s.status !== "inactive");
  const suggested = candidates.filter((s) => s.categoryIds.includes(r.categoryId)).map((s) => s.id);
  const selected = picked ?? suggested;
  const pending = r.approvals.find((a) => a.status === "pending");

  return (
    <>
      <PageHeader
        title={<span className="tabular">{r.number}</span>}
        meta={<StatusBadge kind="request" value={r.status} />}
        description={r.title}
        crumbs={[{ label: "Purchase Requests", to: "requests" }, { label: r.number }]}
        actions={
          <>
            {r.status === "draft" ? (
              <Can permission="request.create">
                <Button
                  onClick={() => {
                    ws.submitRequest(r.id, { actorId: actor });
                    toast.success("Submitted for approval");
                  }}
                >
                  <Send />
                  Submit for approval
                </Button>
              </Can>
            ) : null}
            {pending ? (
              <Can permission="request.approve">
                <Button variant="outline" onClick={() => setDlg("reject")}>
                  <X />
                  Reject
                </Button>
                <Button onClick={() => setDlg("approve")}>
                  <Check />
                  Approve
                </Button>
              </Can>
            ) : null}
            {r.status === "approved" ? (
              <Can permission="rfq.manage">
                <Button variant="hero" size="lg" onClick={() => setDlg("rfq")}>
                  Convert to RFQ
                </Button>
              </Can>
            ) : null}
            {r.rfqId ? (
              <Button asChild variant="outline">
                <AppLink to={`rfqs/${r.rfqId}`}>View RFQ</AppLink>
              </Button>
            ) : null}
          </>
        }
      />
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Panel
            title="Items"
            action={<span className="text-sm font-semibold tabular">{formatMoney(total)}</span>}
            bodyClassName="p-0"
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-y bg-muted/40 text-xs text-muted-foreground">
                    <th className="px-5 py-2 text-left font-medium">Material</th>
                    <th className="px-3 py-2 text-right font-medium">Qty</th>
                    <th className="px-3 py-2 text-right font-medium">Est. unit</th>
                    <th className="px-5 py-2 text-right font-medium">Est. amount</th>
                  </tr>
                </thead>
                <tbody>
                  {r.items.map((i) => (
                    <tr key={i.id} className="border-b last:border-0">
                      <td className="px-5 py-3">{i.description}</td>
                      <td className="px-3 py-3 text-right tabular">
                        {i.qty} {i.unit}
                      </td>
                      <td className="px-3 py-3 text-right tabular">
                        {formatMoney(i.unitPrice, { decimals: 2 })}
                      </td>
                      <td className="px-5 py-3 text-right tabular">
                        {formatMoney(i.qty * i.unitPrice)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
          <Panel title="Justification">
            <p className="text-sm text-muted-foreground">{r.justification}</p>
          </Panel>
          {r.approvals.length ? (
            <Panel
              title="Approval chain"
              description="Requests above ₹2,00,000 require a second level"
            >
              <ol className="space-y-3">
                {r.approvals.map((a) => (
                  <li
                    key={a.id}
                    className={cn(
                      "flex items-start gap-3 rounded-xl border p-3",
                      a.status === "pending" && "border-amber/40 bg-amber/5",
                    )}
                  >
                    <Person name={nameOf(ws.members, a.approverId)} accent="violet" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">
                          Level {a.level} · {nameOf(ws.members, a.approverId)}
                        </span>
                        <StatusBadge kind="approval" value={a.status} />
                      </div>
                      {a.comment ? (
                        <p className="mt-1 text-xs text-muted-foreground">“{a.comment}”</p>
                      ) : null}
                      {a.at ? (
                        <p className="text-[11px] text-subtle-foreground">{formatDate(a.at)}</p>
                      ) : null}
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
                ["Requester", nameOf(ws.members, r.requesterId)],
                ["Department", r.department],
                ["Category", nameOf(ws.categories, r.categoryId)],
                ["Raised on", formatDate(r.createdAt)],
                ["Needed by", formatDate(r.neededBy)],
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
            </dl>
          </Panel>
          <Panel title="Status timeline">
            <Timeline events={r.timeline} nameOf={(x) => nameOf(ws.members, x)} />
          </Panel>
        </div>
      </div>

      <Dialog open={dlg === "approve" || dlg === "reject"} onOpenChange={(o) => !o && setDlg(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dlg === "approve" ? "Approve request" : "Reject request"}</DialogTitle>
            <DialogDescription>
              {r.number} · {formatMoney(total)}
            </DialogDescription>
          </DialogHeader>
          <Label htmlFor="cm">Comment {dlg === "reject" ? "(recommended)" : "(optional)"}</Label>
          <Textarea id="cm" value={comment} onChange={(e) => setComment(e.target.value)} rows={3} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDlg(null)}>
              Cancel
            </Button>
            <Button
              variant={dlg === "reject" ? "destructive" : "default"}
              onClick={() => {
                ws.decideRequest(r.id, dlg === "approve" ? "approved" : "rejected", comment, {
                  actorId: actor,
                });
                toast.success("Decision recorded");
                setDlg(null);
                setComment("");
              }}
            >
              {dlg === "approve" ? "Approve" : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={dlg === "rfq"} onOpenChange={(o) => !o && setDlg(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Convert to RFQ</DialogTitle>
            <DialogDescription>
              Choose suppliers to invite. Suppliers in this category are pre-selected.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-64 space-y-1.5 overflow-y-auto">
            {candidates.map((s) => (
              <label
                key={s.id}
                className="flex cursor-pointer items-center gap-3 rounded-lg border p-2.5 text-sm hover:bg-accent/50"
              >
                <Checkbox
                  checked={selected.includes(s.id)}
                  onCheckedChange={(v) =>
                    setPicked(v ? [...selected, s.id] : selected.filter((x) => x !== s.id))
                  }
                />
                <span className="flex-1">
                  {s.name}
                  <span className="block text-xs text-muted-foreground">{s.city}</span>
                </span>
                {suggested.includes(s.id) ? (
                  <span className="tint-emerald rounded-full px-2 py-0.5 text-[10px]">
                    Category match
                  </span>
                ) : null}
              </label>
            ))}
          </div>
          <div>
            <Label htmlFor="due">Quotation deadline</Label>
            <Input
              id="due"
              type="date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
              className="mt-1.5"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDlg(null)}>
              Cancel
            </Button>
            <Button
              disabled={selected.length === 0}
              onClick={() => {
                const rfq = ws.createRfq(r.id, selected, due, { actorId: actor });
                setDlg(null);
                if (rfq) {
                  toast.success(`${rfq.number} sent`);
                  go(`rfqs/${rfq.id}`);
                }
              }}
            >
              Send RFQ to {selected.length} supplier{selected.length === 1 ? "" : "s"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
