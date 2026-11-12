import {
  AlertTriangle,
  ClipboardCheck,
  FileSpreadsheet,
  IndianRupee,
  Plus,
  Sparkles,
  Timer,
  Truck,
} from "lucide-react";
import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { differenceInCalendarDays, parseISO } from "date-fns";

import { Button } from "@/components/ui/button";
import {
  ChartTip,
  EmptyState,
  KpiCard,
  PageHeader,
  Panel,
  Person,
  StatusBadge,
} from "@/components/vendora/kit";
import { ACCENT } from "@/lib/accents";
import { formatMoney, formatMoneyCompact, formatRelative, greeting } from "@/lib/format";
import { AppLink } from "@/lib/nav";
import { useUi } from "@/lib/ui-store";
import { nameOf, spendBy, spendByMonth } from "@/lib/selectors";
import { useWs } from "@/lib/ws-store";
import { CHART_COLORS } from "@/lib/accents";

export function DashboardPage() {
  const ws = useWs();
  const user = useUi((s) => s.user);
  const insights = useMemo(() => ws.insights().filter((i) => i.status === "open"), [ws]);
  const months = useMemo(() => spendByMonth(ws.purchaseOrders), [ws.purchaseOrders]);
  const cur = months.at(-1)?.spend ?? 0,
    prev = months.at(-2)?.spend ?? 0;
  const pendingReq = ws.requests.filter((r) => r.status === "pending_approval");
  const openRfq = ws.rfqs.filter((r) => r.status === "sent" || r.status === "evaluating");
  const openPo = ws.purchaseOrders.filter((p) =>
    ["issued", "acknowledged", "partially_received"].includes(p.status),
  );
  const overdue = openPo.filter(
    (p) => differenceInCalendarDays(new Date(), parseISO(p.expectedAt)) > 0,
  );
  const byCat = Object.entries(spendBy(ws.purchaseOrders, (p) => p.categoryId))
    .map(([id, v]) => ({ name: nameOf(ws.categories, id), spend: Math.round(v) }))
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 6);
  const empty = ws.purchaseOrders.length === 0 && ws.requests.length === 0;
  const checklist = [
    { label: "Add your suppliers", done: ws.suppliers.length > 0, to: "suppliers" },
    { label: "Add products & materials", done: ws.materials.length > 0, to: "materials" },
    {
      label: "Raise your first purchase request",
      done: ws.requests.length > 0,
      to: "requests/new",
    },
    {
      label: "Invite your team",
      done: ws.members.length > 1 || ws.invitations.length > 0,
      to: "team",
    },
  ];

  return (
    <>
      <PageHeader
        title={`${greeting()}, ${(user?.name ?? "there").split(" ")[0]}`}
        description="Here's what needs your attention across purchasing today."
        accent="blue"
        actions={
          <>
            <Button variant="outline" asChild>
              <AppLink to="rfqs">
                <FileSpreadsheet />
                RFQs
              </AppLink>
            </Button>
            <Button asChild>
              <AppLink to="requests/new">
                <Plus />
                New request
              </AppLink>
            </Button>
          </>
        }
      />

      {empty ? (
        <Panel
          title="Get started"
          description="Four quick steps to a working procurement flow"
          className="mb-6"
        >
          <ul className="grid gap-2 sm:grid-cols-2">
            {checklist.map((c) => (
              <li key={c.label}>
                <AppLink
                  to={c.to}
                  className="flex items-center gap-3 rounded-xl border p-3 text-sm transition hover:bg-accent/50"
                >
                  <span
                    className={`grid size-5 place-items-center rounded-full border text-[11px] ${c.done ? "border-success bg-success text-success-foreground" : ""}`}
                  >
                    {c.done ? "✓" : ""}
                  </span>
                  {c.label}
                </AppLink>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Spend this month"
          value={cur}
          format={(n) => formatMoneyCompact(n)}
          icon={IndianRupee}
          accent="indigo"
          trend={prev ? { pct: (cur - prev) / prev, goodWhenUp: false } : null}
          spark={months.map((m) => m.spend)}
          hint="vs last month"
        />
        <KpiCard
          label="Awaiting approval"
          value={pendingReq.length}
          format={(n) => String(Math.round(n))}
          icon={ClipboardCheck}
          accent="blue"
          hint="purchase requests"
        />
        <KpiCard
          label="Open RFQs"
          value={openRfq.length}
          format={(n) => String(Math.round(n))}
          icon={FileSpreadsheet}
          accent="violet"
          hint="collecting or evaluating quotes"
        />
        <KpiCard
          label="Overdue deliveries"
          value={overdue.length}
          format={(n) => String(Math.round(n))}
          icon={Timer}
          accent="coral"
          hint={`${openPo.length} open orders`}
        />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Panel
          title="Monthly spend"
          description="Purchase orders issued, last 12 months"
          className="xl:col-span-2"
        >
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={months}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis
                  dataKey="month"
                  tickLine={false}
                  axisLine={false}
                  fontSize={11}
                  stroke="var(--muted-foreground)"
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  fontSize={11}
                  width={52}
                  tickFormatter={(v) => formatMoneyCompact(v)}
                  stroke="var(--muted-foreground)"
                />
                <Tooltip
                  content={<ChartTip format={(n) => formatMoney(n)} />}
                  cursor={{ fill: "var(--accent)" }}
                />
                <Bar dataKey="spend" name="Spend" fill="var(--brand-blue)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel
          title="Needs your attention"
          action={
            <AppLink to="requests?status=pending_approval" className="text-xs text-primary">
              View all
            </AppLink>
          }
        >
          {pendingReq.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">You're all caught up.</p>
          ) : (
            <ul className="space-y-2">
              {pendingReq.slice(0, 5).map((r) => (
                <li key={r.id}>
                  <AppLink
                    to={`requests/${r.id}`}
                    className="flex items-center gap-3 rounded-xl border p-3 transition hover:bg-accent/50"
                  >
                    <Person name={nameOf(ws.members, r.requesterId)} accent="blue" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{r.title}</div>
                      <div className="text-xs text-muted-foreground tabular">{r.number}</div>
                    </div>
                    <StatusBadge kind="priority" value={r.priority} />
                  </AppLink>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Panel title="Spend by category" description="All time">
          {byCat.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No spend recorded yet.</p>
          ) : (
            <ul className="space-y-3">
              {byCat.map((c, i) => (
                <li key={c.name}>
                  <div className="mb-1 flex justify-between text-xs">
                    <span>{c.name}</span>
                    <span className="tabular text-muted-foreground">
                      {formatMoneyCompact(c.spend)}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${(c.spend / (byCat[0]?.spend || 1)) * 100}%`,
                        background: CHART_COLORS[i % CHART_COLORS.length],
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel
          title="AI insights"
          action={
            <AppLink to="insights" className="text-xs text-primary">
              Open
            </AppLink>
          }
        >
          {insights.length === 0 ? (
            <EmptyState
              icon={Sparkles}
              accent="ai"
              title="No insights yet"
              body="Insights appear once there's enough purchase history to analyse."
              className="border-0 py-6"
            />
          ) : (
            <ul className="space-y-2">
              {insights.slice(0, 4).map((i) => (
                <li key={i.id}>
                  <AppLink
                    to="insights"
                    className="flex items-start gap-3 rounded-xl border p-3 transition hover:bg-accent/50"
                  >
                    <span
                      className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg text-on-brand ${ACCENT.ai.chip}`}
                    >
                      {i.type === "repeated_delay" ? (
                        <Truck className="size-4" />
                      ) : i.type === "possible_duplicate" ? (
                        <AlertTriangle className="size-4" />
                      ) : (
                        <Sparkles className="size-4" />
                      )}
                    </span>
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{i.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {i.impactAmount
                          ? `Impact ≈ ${formatMoneyCompact(i.impactAmount)}`
                          : "Based on your records"}
                      </div>
                    </div>
                  </AppLink>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Recent activity">
          {ws.activity.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nothing yet — activity shows up as your team works.
            </p>
          ) : (
            <ul className="space-y-3">
              {ws.activity.slice(0, 6).map((a) => (
                <li key={a.id} className="flex items-start gap-3 text-sm">
                  <Person name={nameOf(ws.members, a.actorId)} accent="cyan" size={26} />
                  <div className="min-w-0">
                    <span className="font-medium">
                      {nameOf(ws.members, a.actorId).split(" ")[0]}
                    </span>{" "}
                    <span className="text-muted-foreground">{a.verb}</span>{" "}
                    <span className="tabular">{a.target}</span>
                    <div className="text-xs text-subtle-foreground">{formatRelative(a.at)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
