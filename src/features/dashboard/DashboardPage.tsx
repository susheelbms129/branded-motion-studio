import {
  AlertTriangle,
  ArrowRight,
  BookmarkCheck,
  ClipboardCheck,
  FileSpreadsheet,
  IndianRupee,
  Plus,
  SearchCheck,
  ShieldCheck,
  Sparkles,
  Timer,
  Truck,
} from "lucide-react";
import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { differenceInCalendarDays, format as formatDate, parseISO } from "date-fns";

import { Button } from "@/components/ui/button";
import {
  ChartTip,
  EmptyState,
  KpiCard,
  Panel,
  Person,
  StatusBadge,
} from "@/components/vendora/kit";
import { ACCENT } from "@/lib/accents";
import { formatMoney, formatMoneyCompact, greeting } from "@/lib/format";
import { AppLink } from "@/lib/nav";
import { useUi } from "@/lib/ui-store";
import { nameOf, spendBy, spendByMonth } from "@/lib/selectors";
import { isVerified } from "@/lib/sourcing-health";
import { useWs } from "@/lib/ws-store";
import { CHART_COLORS } from "@/lib/accents";

import { ShortlistPanel, TrustWatchPanel } from "./ShortlistPanels";
import { useSavedPreview } from "./use-saved-preview";

export function DashboardPage() {
  const ws = useWs();
  const user = useUi((s) => s.user);
  const orgId = useUi((s) => s.orgId);
  // The shortlist is real data from the database. Only a signed-in company has one.
  const saved = useSavedPreview(orgId);
  const savedTotal = orgId ? saved.total : ws.suppliers.length;
  const verifiedSaved = saved.items.filter(isVerified).length;
  const companyName = ws.organizations[0]?.name;
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
  const hasSpend = ws.purchaseOrders.length > 0;
  const checklist = [
    { label: "Find verified suppliers", done: savedTotal > 0, to: "find-suppliers" },
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

  const stepsDone = checklist.filter((c) => c.done).length;

  return (
    <>
      <section className="relative isolate mb-8 overflow-hidden rounded-xl border border-white/15 bg-gradient-to-br from-[oklch(0.38_0.15_275)] via-[oklch(0.31_0.14_282)] to-[oklch(0.27_0.11_262)] px-6 py-8 shadow-lift sm:px-8 sm:py-10">
        <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden>
          <div className="bg-grid-dark mask-radial absolute inset-0 opacity-50" />
          <div className="glow-violet animate-orb absolute -left-24 -top-28 size-[26rem] opacity-90" />
          <div className="glow-blue animate-orb-slow absolute -right-24 -top-10 size-[24rem] opacity-90" />
          <div className="glow-magenta animate-orb absolute -bottom-40 left-1/3 size-[22rem] opacity-60" />
        </div>
        <div className="flex flex-wrap items-end justify-between gap-10">
          <div className="min-w-0 max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-white/90 backdrop-blur">
              <Sparkles className="size-4 text-magenta" />
              {formatDate(new Date(), "EEEE, d MMMM")}
            </div>
            {companyName ? (
              <span className="ml-3 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-xs font-semibold text-white/90 backdrop-blur">
                <ShieldCheck className="size-4 text-cyan" aria-hidden />
                {companyName}
              </span>
            ) : null}
            <h1 className="mt-6 text-4xl font-semibold leading-[1.08] text-white sm:text-5xl">
              {greeting()},{" "}
              <span className="grad-rupee animate-gradient-pan">
                {(user?.name ?? "there").split(" ")[0]}
              </span>
            </h1>
            <p className="mt-4 text-base leading-relaxed text-navy-muted sm:text-lg">
              Find verified suppliers, collect quotes and keep every order approved, all in one place.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Button asChild variant="hero" size="lg">
                <AppLink to="requests/new">
                  <Plus />
                  New request
                </AppLink>
              </Button>
              <Button asChild variant="glass" size="lg">
                <AppLink to="find-suppliers">
                  <SearchCheck />
                  Find suppliers
                </AppLink>
              </Button>
              <Button asChild variant="glass" size="lg">
                <AppLink to="rfqs">
                  <FileSpreadsheet />
                  RFQs
                </AppLink>
              </Button>
            </div>
          </div>
          <div className="grid w-full gap-3 sm:w-auto sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
            {[
              { label: "Awaiting approval", value: pendingReq.length, to: "requests?status=pending_approval" },
              { label: "Open RFQs", value: openRfq.length, to: "rfqs" },
              { label: "Overdue", value: overdue.length, to: "purchase-orders" },
            ].map((c) => (
              <AppLink
                key={c.label}
                to={c.to}
                className="glass-dark group flex min-w-[10rem] items-center justify-between gap-4 rounded-lg px-5 py-4 transition hover:bg-white/10"
              >
                <div>
                  <div className="text-3xl font-semibold tabular text-white">{c.value}</div>
                  <div className="text-sm text-navy-muted">{c.label}</div>
                </div>
                <ArrowRight className="size-5 text-navy-muted transition group-hover:translate-x-1 group-hover:text-white" />
              </AppLink>
            ))}
          </div>
        </div>
      </section>

      {empty ? (
        <Panel
          title="Get started"
          description={`${stepsDone} of ${checklist.length} done. Four quick steps to a working procurement flow`}
          className="mb-8"
        >
          <div
            className="mb-5 h-2 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={checklist.length}
            aria-valuenow={stepsDone}
            aria-label="Setup progress"
          >
            <div
              className="h-full rounded-full bg-gradient-cta transition-all"
              style={{ width: `${(stepsDone / checklist.length) * 100}%` }}
            />
          </div>
          <ul className="grid gap-4 sm:grid-cols-2">
            {checklist.map((c, i) => (
              <li key={c.label}>
                <AppLink
                  to={c.to}
                  className="card-lift flex items-center gap-4 rounded-lg border p-5 text-base font-medium"
                >
                  <span
                    className={`grid size-9 shrink-0 place-items-center rounded-full text-sm font-semibold ${c.done ? "bg-success text-success-foreground" : "bg-gradient-primary text-on-brand shadow-glow"}`}
                  >
                    {c.done ? "✓" : i + 1}
                  </span>
                  <span className="flex-1">{c.label}</span>
                  <ArrowRight className="size-5 text-muted-foreground" />
                </AppLink>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Saved suppliers"
          value={savedTotal}
          format={(n) => String(Math.round(n))}
          icon={BookmarkCheck}
          accent="emerald"
          hint={saved.status === "loading" ? "Loading your shortlist…" : "on your team's shortlist"}
        />
        <KpiCard
          label="Verified on your shortlist"
          value={verifiedSaved}
          format={(n) => String(Math.round(n))}
          icon={ShieldCheck}
          accent="cyan"
          hint={
            !orgId
              ? "sample data"
              : saved.status !== "ready"
                ? "Checking trust levels…"
                : saved.items.length < saved.total
                  ? `of your ${saved.items.length} newest saved`
                  : `of ${saved.total} saved suppliers`
          }
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
          label="Spend this month"
          value={cur}
          format={(n) => formatMoneyCompact(n)}
          icon={IndianRupee}
          accent="indigo"
          trend={prev ? { pct: (cur - prev) / prev, goodWhenUp: false } : null}
          {...(hasSpend ? { spark: months.map((m) => m.spend) } : {})}
          hint={`vs last month · ${openPo.length} open orders`}
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <ShortlistPanel saved={saved} className="xl:col-span-2" />
        <TrustWatchPanel saved={saved} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        {hasSpend ? (
        <Panel
          title="Monthly spend"
          description="Purchase orders issued, last 12 months"
          className="xl:col-span-2"
        >
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={months}>
                <defs>
                  <linearGradient id="bar-brand" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--brand-cyan)" />
                    <stop offset="55%" stopColor="var(--brand-blue)" />
                    <stop offset="100%" stopColor="var(--brand-violet)" />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis
                  dataKey="month"
                  tickLine={false}
                  axisLine={false}
                  fontSize={13}
                  stroke="var(--muted-foreground)"
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  fontSize={13}
                  width={64}
                  tickFormatter={(v) => formatMoneyCompact(v)}
                  stroke="var(--muted-foreground)"
                />
                <Tooltip
                  content={<ChartTip format={(n) => formatMoney(n)} />}
                  cursor={{ fill: "var(--accent)" }}
                />
                <Bar dataKey="spend" name="Spend" fill="url(#bar-brand)" radius={[10, 10, 0, 0]} maxBarSize={44} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        ) : (
          <Panel
            title="Spend intelligence"
            description="Your monthly spend and category breakdown appear here"
            className="xl:col-span-2"
          >
            <EmptyState
              icon={IndianRupee}
              accent="indigo"
              title="No orders yet"
              body="Raise a purchase request, collect quotes from verified suppliers and issue your first purchase order. Charts fill in on their own."
              className="border-0 py-6"
              action={
                <Button asChild>
                  <AppLink to="requests/new">
                    <Plus />
                    New request
                  </AppLink>
                </Button>
              }
            />
          </Panel>
        )}
        <Panel
          title="Needs your attention"
          action={
            <AppLink to="requests?status=pending_approval" className="text-sm font-semibold text-primary">
              View all
            </AppLink>
          }
        >
          {overdue.length > 0 ? (
            <AppLink
              to="purchase-orders"
              className="card-lift mb-3 flex items-center gap-3 rounded-lg border p-4"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-xl tint-coral">
                <Timer className="size-5" aria-hidden />
              </span>
              <div className="min-w-0 flex-1 text-[15px] font-semibold">
                {overdue.length} {overdue.length === 1 ? "delivery is" : "deliveries are"} overdue
              </div>
              <ArrowRight className="size-5 text-muted-foreground" />
            </AppLink>
          ) : null}
          {pendingReq.length === 0 && overdue.length === 0 ? (
            <p className="py-10 text-center text-base text-muted-foreground">You're all caught up.</p>
          ) : pendingReq.length === 0 ? null : (
            <ul className="space-y-3">
              {pendingReq.slice(0, 5).map((r) => (
                <li key={r.id}>
                  <AppLink
                    to={`requests/${r.id}`}
                    className="card-lift flex items-center gap-4 rounded-lg border p-4"
                  >
                    <Person name={nameOf(ws.members, r.requesterId)} accent="blue" size={42} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-base font-semibold">{r.title}</div>
                      <div className="text-sm text-muted-foreground tabular">{r.number}</div>
                    </div>
                    <StatusBadge kind="priority" value={r.priority} />
                  </AppLink>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {hasSpend || insights.length > 0 ? (
      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Panel title="Spend by category" description="All time">
          {byCat.length === 0 ? (
            <p className="py-10 text-center text-base text-muted-foreground">No spend recorded yet.</p>
          ) : (
            <ul className="space-y-5">
              {byCat.map((c, i) => (
                <li key={c.name}>
                  <div className="mb-2 flex justify-between text-[15px] font-medium">
                    <span>{c.name}</span>
                    <span className="tabular font-semibold text-muted-foreground">
                      {formatMoneyCompact(c.spend)}
                    </span>
                  </div>
                  <div className="h-3 overflow-hidden rounded-full bg-muted">
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
            <AppLink to="insights" className="text-sm font-semibold text-primary">
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
            <ul className="space-y-3">
              {insights.slice(0, 4).map((i) => (
                <li key={i.id}>
                  <AppLink
                    to="insights"
                    className="card-lift flex items-start gap-4 rounded-lg border p-4"
                  >
                    <span
                      className={`mt-0.5 grid size-10 shrink-0 place-items-center rounded-xl text-on-brand shadow-glow ${ACCENT.ai.chip}`}
                    >
                      {i.type === "repeated_delay" ? (
                        <Truck className="size-5" />
                      ) : i.type === "possible_duplicate" ? (
                        <AlertTriangle className="size-5" />
                      ) : (
                        <Sparkles className="size-5" />
                      )}
                    </span>
                    <div className="min-w-0">
                      <div className="text-[15px] font-semibold">{i.title}</div>
                      <div className="mt-0.5 text-sm text-muted-foreground">
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
      </div>
      ) : null}
    </>
  );
}
