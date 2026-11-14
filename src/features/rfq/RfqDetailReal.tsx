import { useQuery } from "@tanstack/react-query";
import { FileSpreadsheet, Hourglass, ShieldAlert, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader, Panel, StatusBadge } from "@/components/vendora/kit";
import { formatDate, formatDateTime } from "@/lib/format";
import { AppLink } from "@/lib/nav";
import { getRfq, LEVEL_NAMES, RFQ_KEY, type InviteStatus } from "@/lib/rfqs-api";
import { cn } from "@/lib/utils";

const INVITE_LABEL: Record<InviteStatus, string> = {
  sent: "Waiting for reply",
  viewed: "Viewed",
  quoted: "Quoted",
  declined: "Declined",
};
const INVITE_LOOK: Record<InviteStatus, string> = {
  sent: "bg-muted text-muted-foreground",
  viewed: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  quoted: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  declined: "bg-red-500/10 text-red-700 dark:text-red-300",
};

/** One real RFQ, read from the database: what was asked, who was invited, and how verified each supplier was when it went out. */
export function RfqDetailReal({ id }: { id: string }) {
  const q = useQuery({
    queryKey: [RFQ_KEY, "detail", id],
    queryFn: () => getRfq(id),
    retry: false,
  });
  if (q.isLoading)
    return <p className="py-16 text-center text-sm text-muted-foreground">Loading RFQ…</p>;
  const d = q.data;
  if (!d)
    return (
      <EmptyState
        icon={FileSpreadsheet}
        title="RFQ not found"
        body={
          q.error instanceof Error && !q.error.message.includes("isn't available")
            ? q.error.message
            : "It may have been removed, or you may be in a different company."
        }
        action={
          <Button asChild>
            <AppLink to="rfqs">Back to RFQs</AppLink>
          </Button>
        }
      />
    );
  const r = d.rfq;
  const quoted = d.invites.filter((i) => i.status === "quoted").length;
  return (
    <>
      <PageHeader
        title={<span className="tabular">{r.number}</span>}
        meta={<StatusBadge kind="rfq" value={r.status} />}
        description={r.title}
        accent="violet"
        crumbs={[{ label: "RFQs", to: "rfqs" }, { label: r.number }]}
        actions={
          r.request_id ? (
            <Button asChild variant="outline">
              <AppLink to={`requests/${r.request_id}`}>
                View request {r.request_number ?? ""}
              </AppLink>
            </Button>
          ) : null
        }
      />
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Panel
            title="Suppliers invited"
            description={`${quoted} of ${d.invites.length} have quoted`}
            bodyClassName="p-0"
          >
            <ul className="divide-y">
              {d.invites.map((i) => {
                const lapsed = i.level_at_send != null && i.level_now < i.level_at_send;
                return (
                  <li
                    key={i.id}
                    className="flex flex-wrap items-start justify-between gap-3 px-5 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{i.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {[i.city, i.state].filter(Boolean).join(", ") || "—"}
                      </p>
                      <p
                        className={cn(
                          "mt-1 flex items-center gap-1.5 text-xs",
                          lapsed
                            ? "text-amber-700 dark:text-amber-400"
                            : "text-emerald-700 dark:text-emerald-400",
                        )}
                      >
                        {lapsed ? (
                          <ShieldAlert className="size-3.5" />
                        ) : (
                          <ShieldCheck className="size-3.5" />
                        )}
                        {i.level_at_send != null
                          ? `${LEVEL_NAMES[i.level_at_send] ?? "Verified"} when invited`
                          : "Verified when invited"}
                        {lapsed
                          ? ` · now ${LEVEL_NAMES[i.level_now] ?? "not verified"}: a proof has lapsed since`
                          : ""}
                      </p>
                    </div>
                    <div className="text-right">
                      <span
                        className={cn(
                          "inline-block rounded-full px-2.5 py-1 text-xs font-medium",
                          INVITE_LOOK[i.status],
                        )}
                      >
                        {INVITE_LABEL[i.status]}
                      </span>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {i.responded_at
                          ? `Replied ${formatDateTime(i.responded_at)}`
                          : `Sent ${formatDateTime(i.sent_at)}`}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Panel>
          <Panel title="Quotations">
            <div className="flex items-start gap-3 text-sm text-muted-foreground">
              <Hourglass className="mt-0.5 size-4 shrink-0" />
              <p>
                Waiting for suppliers to reply. Their quotes will appear here, compared on total
                landed cost, once suppliers can answer RFQs (coming in the next update).
              </p>
            </div>
          </Panel>
          <Panel title="Items requested" bodyClassName="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-y bg-muted/40 text-xs text-muted-foreground">
                    <th className="px-5 py-2 text-left font-medium">Item</th>
                    <th className="px-5 py-2 text-right font-medium">Quantity</th>
                  </tr>
                </thead>
                <tbody>
                  {d.items.map((i) => (
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
        </div>
        <div className="space-y-4">
          <Panel title="Details">
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Quotes due</dt>
                <dd className="tabular">{formatDate(r.due_date)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Sent by</dt>
                <dd>{r.owner_name}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Sent on</dt>
                <dd className="tabular">{formatDate(r.created_at)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Category</dt>
                <dd>{r.category || "—"}</dd>
              </div>
            </dl>
          </Panel>
          {r.notes ? (
            <Panel title="Note to suppliers">
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">{r.notes}</p>
            </Panel>
          ) : null}
        </div>
      </div>
    </>
  );
}
