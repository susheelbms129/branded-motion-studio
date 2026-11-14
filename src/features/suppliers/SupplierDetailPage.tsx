import { useParams } from "@tanstack/react-router";
import { Truck } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { format, parseISO } from "date-fns";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Can,
  ChartTip,
  EmptyState,
  PageHeader,
  Panel,
  StatusBadge,
} from "@/components/vendora/kit";
import { formatDate, formatMoney, formatPercent } from "@/lib/format";
import { AppLink } from "@/lib/nav";
import { nameOf, poTotals } from "@/lib/selectors";
import { usePerf } from "@/lib/use-perf";
import { useWs } from "@/lib/ws-store";

export function SupplierDetailPage() {
  const { id } = useParams({ strict: false }) as { id: string };
  const ws = useWs();
  const perf = usePerf();
  const s = ws.suppliers.find((x) => x.id === id);
  if (!s)
    return (
      <EmptyState
        icon={Truck}
        accent="amber"
        title="Supplier not found"
        body="It may have been removed."
        action={
          <Button asChild>
            <AppLink to="suppliers">Back to suppliers</AppLink>
          </Button>
        }
      />
    );
  const p = perf[s.id];
  const pos = ws.purchaseOrders
    .filter((o) => o.supplierId === s.id && o.status !== "draft")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const trend = [...pos].reverse().map((o) => ({
    d: format(parseISO(o.createdAt), "dd MMM"),
    total: Math.round(poTotals(o).total),
  }));
  const stats: [string, string, string][] = [
    [
      "Performance score",
      p?.score != null ? `${p.score}/100` : "—",
      "50% on-time · 30% price · 20% response",
    ],
    [
      "On-time delivery",
      p?.onTimeRate != null ? formatPercent(p.onTimeRate) : "—",
      `${p?.onTimeCount ?? 0} of ${p?.deliveredCount ?? 0} deliveries`,
    ],
    [
      "Avg delay",
      p?.avgDelayDays != null ? `${p.avgDelayDays.toFixed(1)} days` : "—",
      "across delivered orders",
    ],
    [
      "Quote price vs median",
      p?.priceVariance != null
        ? `${p.priceVariance > 0 ? "+" : ""}${(p.priceVariance * 100).toFixed(1)}%`
        : "—",
      `${p?.quotesCompared ?? 0} competing quotes`,
    ],
    [
      "RFQ response rate",
      p?.responseRate != null ? formatPercent(p.responseRate) : "—",
      `${p?.respondedCount ?? 0} of ${p?.invitedCount ?? 0} invites`,
    ],
  ];
  return (
    <>
      <PageHeader
        title={s.name}
        meta={<StatusBadge kind="supplier" value={s.status} />}
        description={`${s.city}, ${s.state} · GSTIN ${s.gstin || "—"}`}
        accent="amber"
        crumbs={[{ label: "Saved Suppliers", to: "suppliers" }, { label: s.name }]}
        actions={
          <Can permission="supplier.manage">
            <Select
              value={s.status}
              onValueChange={(v) => ws.setSupplierStatus(s.id, v as typeof s.status)}
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="under_review">Under review</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </Can>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {stats.map(([k, v, h]) => (
          <div key={k} className="rounded-2xl border bg-card p-4 shadow-card">
            <div className="text-xs text-muted-foreground">{k}</div>
            <div className="mt-1 text-2xl font-semibold tabular">{v}</div>
            <div className="mt-1 text-[11px] text-subtle-foreground">{h}</div>
          </div>
        ))}
      </div>
      {p?.score == null ? (
        <p className="mt-3 rounded-xl border border-dashed p-3 text-xs text-muted-foreground">
          A score needs at least 2 delivered orders. We never estimate it.
        </p>
      ) : null}
      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Panel title="Order value over time">
            {trend.length < 2 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Not enough orders to chart yet.
              </p>
            ) : (
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trend}>
                    <CartesianGrid vertical={false} stroke="var(--border)" />
                    <XAxis dataKey="d" fontSize={11} tickLine={false} axisLine={false} />
                    <YAxis
                      fontSize={11}
                      width={60}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v) => `₹${Math.round(v / 1000)}k`}
                    />
                    <Tooltip content={<ChartTip format={(n) => formatMoney(n)} />} />
                    <Line
                      type="monotone"
                      dataKey="total"
                      name="Order"
                      stroke="var(--brand-amber)"
                      strokeWidth={2.2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </Panel>
          <Panel title="Order history" bodyClassName="p-0">
            {pos.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">
                No orders with this supplier yet.
              </p>
            ) : (
              <ul className="divide-y">
                {pos.slice(0, 10).map((o) => (
                  <li key={o.id}>
                    <AppLink
                      to={`purchase-orders/${o.id}`}
                      className="flex items-center justify-between gap-3 px-5 py-3 text-sm hover:bg-accent/50"
                    >
                      <span className="tabular font-medium">{o.number}</span>
                      <span className="text-xs text-muted-foreground tabular">
                        {formatDate(o.createdAt)}
                      </span>
                      <span className="tabular">{formatMoney(poTotals(o).total)}</span>
                      <StatusBadge kind="po" value={o.status} />
                    </AppLink>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
        <div className="space-y-4">
          <Panel title="Contacts">
            {s.contacts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No contacts added.</p>
            ) : (
              <ul className="space-y-3">
                {s.contacts.map((c) => (
                  <li key={c.id} className="text-sm">
                    <div className="font-medium">
                      {c.name}{" "}
                      {c.primary ? (
                        <span className="tint-blue ml-1 rounded-full px-1.5 py-0.5 text-[10px]">
                          Primary
                        </span>
                      ) : null}
                    </div>
                    <div className="text-xs text-muted-foreground">{c.designation}</div>
                    <div className="text-xs">
                      {c.email} · {c.phone}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="Commercials">
            <dl className="space-y-2.5 text-sm">
              {[
                ["Payment terms", `${s.paymentTermsDays} days`],
                ["Categories", s.categoryIds.map((c) => nameOf(ws.categories, c)).join(", ")],
                ["Partner since", formatDate(s.since)],
                ["Email", s.email || "—"],
                ["Phone", s.phone || "—"],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="text-right">{v}</dd>
                </div>
              ))}
            </dl>
          </Panel>
        </div>
      </div>
    </>
  );
}
