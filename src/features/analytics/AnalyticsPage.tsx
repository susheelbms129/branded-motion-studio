import { BarChart3, Download } from "lucide-react";
import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
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
import { ChartTip, EmptyState, PageHeader, Panel } from "@/components/vendora/kit";
import { CHART_COLORS } from "@/lib/accents";
import { formatMoney, formatMoneyCompact } from "@/lib/format";
import { downloadCsv, isSpend, nameOf, poTotals, spendBy, spendByMonth } from "@/lib/selectors";
import { useWs } from "@/lib/ws-store";

export function AnalyticsPage() {
  const ws = useWs();
  const [months, setMonths] = useState("12");
  const [matId, setMatId] = useState("");
  const pos = useMemo(() => {
    const from = new Date();
    from.setMonth(from.getMonth() - Number(months));
    return ws.purchaseOrders.filter((p) => parseISO(p.createdAt) >= from);
  }, [ws.purchaseOrders, months]);
  const monthly = spendByMonth(pos, Number(months));
  const total = pos.filter(isSpend).reduce((s, p) => s + poTotals(p).total, 0);
  const bySupplier = Object.entries(spendBy(pos, (p) => p.supplierId))
    .map(([id, v]) => ({ name: nameOf(ws.suppliers, id), value: Math.round(v) }))
    .sort((a, b) => b.value - a.value);
  const byCat = Object.entries(spendBy(pos, (p) => p.categoryId))
    .map(([id, v]) => ({ name: nameOf(ws.categories, id), value: Math.round(v) }))
    .sort((a, b) => b.value - a.value);
  const material = matId || ws.materials[0]?.id || "";
  const price = useMemo(
    () =>
      ws.purchaseOrders
        .filter(isSpend)
        .flatMap((p) =>
          p.lines
            .filter((l) => l.materialId === material)
            .map((l) => ({
              at: p.createdAt,
              d: format(parseISO(p.createdAt), "dd MMM yy"),
              price: l.unitPrice,
            })),
        )
        .sort((a, b) => a.at.localeCompare(b.at)),
    [ws.purchaseOrders, material],
  );
  const budgetRows = ws.categories.map((c) => {
    const spent =
      spendBy(
        spendByMonth(pos, 1).length
          ? ws.purchaseOrders.filter(
              (p) => format(parseISO(p.createdAt), "yyyy-MM") === format(new Date(), "yyyy-MM"),
            )
          : [],
        (p) => p.categoryId,
      )[c.id] ?? 0;
    return { name: c.name, budget: c.monthlyBudget, spent: Math.round(spent) };
  });

  if (ws.purchaseOrders.length === 0)
    return (
      <>
        <PageHeader
          title="Spend Analytics"
          accent="indigo"
          crumbs={[{ label: "Spend Analytics" }]}
        />
        <EmptyState
          icon={BarChart3}
          accent="indigo"
          title="No spend to analyse yet"
          body="Charts appear as purchase orders are issued."
        />
      </>
    );

  return (
    <>
      <PageHeader
        title="Spend Analytics"
        accent="indigo"
        crumbs={[{ label: "Spend Analytics" }]}
        description={`${formatMoney(total)} across ${pos.filter(isSpend).length} orders in the selected period.`}
        actions={
          <>
            <Select value={months} onValueChange={setMonths}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="3">Last 3 months</SelectItem>
                <SelectItem value="6">Last 6 months</SelectItem>
                <SelectItem value="12">Last 12 months</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              onClick={() =>
                downloadCsv("spend-by-supplier.csv", [
                  ["Supplier", "Spend"],
                  ...bySupplier.map((s) => [s.name, s.value]),
                ])
              }
            >
              <Download />
              Export
            </Button>
          </>
        }
      />
      <div className="grid gap-4 xl:grid-cols-3">
        <Panel title="Spend trend" className="xl:col-span-2">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthly}>
                <defs>
                  <linearGradient id="bar-brand-a" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--brand-cyan)" />
                    <stop offset="55%" stopColor="var(--brand-blue)" />
                    <stop offset="100%" stopColor="var(--brand-violet)" />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="month" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis
                  fontSize={11}
                  width={52}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => formatMoneyCompact(v)}
                />
                <Tooltip
                  content={<ChartTip format={(n) => formatMoney(n)} />}
                  cursor={{ fill: "var(--accent)" }}
                />
                <Bar
                  dataKey="spend"
                  name="Spend"
                  fill="url(#bar-brand-a)"
                  radius={[6, 6, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="By category">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={byCat}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={52}
                  outerRadius={84}
                  paddingAngle={2}
                >
                  {byCat.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip content={<ChartTip format={(n) => formatMoney(n)} />} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            {byCat.slice(0, 6).map((c, i) => (
              <li key={c.name} className="flex items-center gap-1.5 truncate">
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ background: CHART_COLORS[i % CHART_COLORS.length] }}
                />
                {c.name}
              </li>
            ))}
          </ul>
        </Panel>
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Panel title="Top suppliers by spend">
          <ul className="space-y-3">
            {bySupplier.slice(0, 8).map((s, i) => (
              <li key={s.name}>
                <div className="mb-1 flex justify-between text-xs">
                  <span>{s.name}</span>
                  <span className="tabular text-muted-foreground">
                    {formatMoneyCompact(s.value)}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${(s.value / (bySupplier[0]?.value || 1)) * 100}%`,
                      background: CHART_COLORS[i % CHART_COLORS.length],
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel
          title="Price history"
          action={
            <Select value={material} onValueChange={setMatId}>
              <SelectTrigger className="h-8 w-52 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ws.materials.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        >
          {price.length < 2 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Not enough purchases of this material.
            </p>
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={price}>
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis
                    dataKey="d"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    minTickGap={24}
                  />
                  <YAxis
                    fontSize={11}
                    width={52}
                    tickLine={false}
                    axisLine={false}
                    domain={["auto", "auto"]}
                  />
                  <Tooltip content={<ChartTip format={(n) => formatMoney(n, { decimals: 2 })} />} />
                  <Line
                    type="monotone"
                    dataKey="price"
                    name="Unit price"
                    stroke="var(--brand-violet)"
                    strokeWidth={2.2}
                    dot={{ r: 2 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>
      </div>
      <Panel title="This month vs budget" className="mt-4">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {budgetRows.map((b) => {
            const pct = b.budget ? b.spent / b.budget : 0;
            return (
              <div key={b.name} className="rounded-xl border p-3">
                <div className="flex justify-between text-sm">
                  <span className="font-medium">{b.name}</span>
                  <span className="tabular text-xs text-muted-foreground">
                    {Math.round(pct * 100)}%
                  </span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.min(100, pct * 100)}%`,
                      background:
                        pct > 1
                          ? "var(--destructive)"
                          : pct > 0.8
                            ? "var(--brand-amber)"
                            : "var(--brand-emerald)",
                    }}
                  />
                </div>
                <div className="mt-1.5 text-[11px] text-muted-foreground tabular">
                  {formatMoneyCompact(b.spent)} of {formatMoneyCompact(b.budget)}
                </div>
              </div>
            );
          })}
        </div>
      </Panel>
    </>
  );
}
