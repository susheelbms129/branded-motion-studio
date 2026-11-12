import { useParams } from "@tanstack/react-router";
import { Printer, ReceiptText } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Can,
  EmptyState,
  PageHeader,
  Panel,
  StatusBadge,
  Timeline,
} from "@/components/vendora/kit";
import { formatDate, formatMoney } from "@/lib/format";
import { AppLink } from "@/lib/nav";
import { nameOf, poTotals } from "@/lib/selectors";
import { useActor, useWs } from "@/lib/ws-store";
import type { PoStatus } from "@/types/domain";

const NEXT: Partial<Record<PoStatus, { to: PoStatus; label: string }[]>> = {
  draft: [{ to: "issued", label: "Issue to supplier" }],
  issued: [
    { to: "acknowledged", label: "Mark acknowledged" },
    { to: "received", label: "Mark received" },
  ],
  acknowledged: [
    { to: "partially_received", label: "Partial receipt" },
    { to: "received", label: "Mark received" },
  ],
  partially_received: [{ to: "received", label: "Mark fully received" }],
  received: [{ to: "closed", label: "Match invoice & close" }],
};

export function PurchaseOrderDetailPage() {
  const { id } = useParams({ strict: false }) as { id: string };
  const ws = useWs();
  const actor = useActor();
  const po = ws.purchaseOrders.find((p) => p.id === id);
  if (!po)
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
  const t = poTotals(po);
  const sup = ws.suppliers.find((s) => s.id === po.supplierId);
  const step = (to: PoStatus, label: string) => {
    ws.advancePo(po.id, to, { actorId: actor });
    toast.success(label);
  };
  return (
    <>
      <PageHeader
        title={<span className="tabular">{po.number}</span>}
        meta={<StatusBadge kind="po" value={po.status} />}
        description={sup?.name}
        accent="emerald"
        crumbs={[{ label: "Purchase Orders", to: "purchase-orders" }, { label: po.number }]}
        actions={
          <>
            <Button variant="outline" onClick={() => window.print()} className="no-print">
              <Printer />
              Print
            </Button>
            <Can permission="po.create">
              <>
                {(NEXT[po.status] ?? []).map((n, i) => (
                  <Button
                    key={n.to}
                    variant={i === 0 ? "default" : "outline"}
                    onClick={() => step(n.to, n.label)}
                  >
                    {n.label}
                  </Button>
                ))}
                {["issued", "acknowledged", "draft"].includes(po.status) ? (
                  <Button
                    variant="destructive"
                    onClick={() => step("cancelled", "Order cancelled")}
                  >
                    Cancel
                  </Button>
                ) : null}
              </>
            </Can>
          </>
        }
      />
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Panel title="Line items" bodyClassName="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-y bg-muted/40 text-xs text-muted-foreground">
                    <th className="px-5 py-2 text-left font-medium">Material</th>
                    <th className="px-3 py-2 text-right font-medium">Qty</th>
                    <th className="px-3 py-2 text-right font-medium">Unit price</th>
                    <th className="px-3 py-2 text-right font-medium">GST</th>
                    <th className="px-5 py-2 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {po.lines.map((l) => (
                    <tr key={l.id} className="border-b last:border-0">
                      <td className="px-5 py-3">{l.description}</td>
                      <td className="px-3 py-3 text-right tabular">
                        {l.qty} {l.unit}
                      </td>
                      <td className="px-3 py-3 text-right tabular">
                        {formatMoney(l.unitPrice, { decimals: 2 })}
                      </td>
                      <td className="px-3 py-3 text-right tabular">{l.gstRate}%</td>
                      <td className="px-5 py-3 text-right tabular">
                        {formatMoney(l.qty * l.unitPrice)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <dl className="space-y-1.5 border-t p-5 text-sm">
              {[
                ["Subtotal", t.subtotal],
                ["GST", t.gst],
                ["Shipping", t.shipping],
                ["Other charges", t.otherCharges],
              ].map(([k, v]) => (
                <div key={k as string} className="flex justify-between text-muted-foreground">
                  <dt>{k}</dt>
                  <dd className="tabular">{formatMoney(v as number)}</dd>
                </div>
              ))}
              <div className="flex justify-between border-t pt-2 text-base font-semibold">
                <dt>Total landed cost</dt>
                <dd className="tabular">{formatMoney(t.total)}</dd>
              </div>
            </dl>
          </Panel>
          <Panel title="Delivery">
            <p className="text-sm text-muted-foreground">{po.deliveryAddress}</p>
          </Panel>
        </div>
        <div className="space-y-4">
          <Panel title="Details">
            <dl className="space-y-3 text-sm">
              {[
                ["Supplier", sup?.name ?? "—"],
                ["Created by", nameOf(ws.members, po.createdById)],
                ["Issued", formatDate(po.issuedAt)],
                ["Expected", formatDate(po.expectedAt)],
                ["Delivered", formatDate(po.deliveredAt)],
                ["Payment terms", `${po.paymentTermsDays} days`],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="text-right tabular">{v}</dd>
                </div>
              ))}
            </dl>
            {po.rfqId ? (
              <Button asChild variant="outline" size="sm" className="mt-4 w-full">
                <AppLink to={`rfqs/${po.rfqId}`}>View source RFQ</AppLink>
              </Button>
            ) : null}
          </Panel>
          <Panel title="History">
            <Timeline events={po.history} nameOf={(x) => nameOf(ws.members, x)} />
          </Panel>
        </div>
      </div>
    </>
  );
}
