import { animate, motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Search,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";

import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ACCENT } from "@/lib/accents";
import { formatDateTime, initials } from "@/lib/format";
import { AppLink } from "@/lib/nav";
import { can, type Permission } from "@/lib/permissions";
import { useUi } from "@/lib/ui-store";
import { cn } from "@/lib/utils";
import type { Accent, TimelineEvent } from "@/types/domain";
import { ChevronRight as Chev } from "lucide-react";

export function Can({ permission, children }: { permission: Permission; children: ReactNode }) {
  const role = useUi((s) => s.role);
  return can(role, permission) ? <>{children}</> : null;
}
export const useCan = () => {
  const role = useUi((s) => s.role);
  return (p: Permission) => can(role, p);
};

const MAP: Record<string, Record<string, [string, BadgeVariant]>> = {
  request: {
    draft: ["Draft", "slate"],
    pending_approval: ["Pending approval", "amber"],
    approved: ["Approved", "green"],
    rejected: ["Rejected", "red"],
    converted_to_rfq: ["Converted to RFQ", "violet"],
    completed: ["Completed", "emerald"],
  },
  rfq: {
    draft: ["Draft", "slate"],
    sent: ["Sent", "blue"],
    evaluating: ["Evaluating", "violet"],
    awarded: ["Awarded", "emerald"],
    closed: ["Closed", "slate"],
  },
  invite: {
    sent: ["Sent", "blue"],
    viewed: ["Viewed", "amber"],
    quoted: ["Quoted", "green"],
    declined: ["Declined", "red"],
  },
  po: {
    draft: ["Draft", "slate"],
    issued: ["Issued", "blue"],
    acknowledged: ["Acknowledged", "cyan"],
    partially_received: ["Partially received", "amber"],
    received: ["Received", "green"],
    closed: ["Closed", "slate"],
    cancelled: ["Cancelled", "red"],
  },
  severity: { high: ["High", "red"], medium: ["Medium", "amber"], low: ["Low", "blue"] },
  member: {
    active: ["Active", "green"],
    invited: ["Invited", "amber"],
    suspended: ["Suspended", "red"],
  },
  supplier: {
    active: ["Active", "green"],
    inactive: ["Inactive", "slate"],
    under_review: ["Under review", "amber"],
  },
  priority: {
    low: ["Low", "slate"],
    medium: ["Medium", "blue"],
    high: ["High", "amber"],
    urgent: ["Urgent", "red"],
  },
  approval: {
    pending: ["Pending", "amber"],
    approved: ["Approved", "green"],
    rejected: ["Rejected", "red"],
    waiting: ["Waiting", "slate"],
  },
  insight: {
    open: ["Open", "blue"],
    dismissed: ["Dismissed", "slate"],
    snoozed: ["Snoozed", "amber"],
    resolved: ["Resolved", "green"],
  },
};
export const statusLabel = (kind: string, v: string) => MAP[kind]?.[v]?.[0] ?? v;
export function StatusBadge({ kind, value }: { kind: keyof typeof MAP; value: string }) {
  const [label, variant] = MAP[kind]?.[value] ?? [value, "slate" as BadgeVariant];
  return (
    <Badge variant={variant}>
      <span className="size-1.5 rounded-full bg-current opacity-70" />
      {label}
    </Badge>
  );
}

export function Person({
  name,
  accent = "blue",
  size = 28,
}: {
  name: string;
  accent?: Accent;
  size?: number;
}) {
  return (
    <span
      className={cn(
        "inline-grid shrink-0 place-items-center rounded-full font-medium text-on-brand",
        ACCENT[accent].chip,
      )}
      style={{ width: size, height: size, fontSize: size * 0.38 }}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

export function PageHeader({
  title,
  description,
  crumbs = [],
  actions,
  accent = "blue",
  meta,
}: {
  title: ReactNode;
  description?: ReactNode;
  crumbs?: { label: string; to?: string }[];
  actions?: ReactNode;
  accent?: Accent;
  meta?: ReactNode;
}) {
  return (
    <div className="relative mb-6">
      <div
        className={cn(
          "pointer-events-none absolute -left-10 -top-16 h-40 w-80 opacity-40 blur-3xl",
          ACCENT[accent].glow,
        )}
        aria-hidden
      />
      <nav
        aria-label="Breadcrumb"
        className="relative mb-2 flex items-center gap-1 text-xs text-muted-foreground"
      >
        <AppLink to="" className="hover:text-foreground">
          Home
        </AppLink>
        {crumbs.map((c, i) => (
          <span key={c.label} className="flex items-center gap-1">
            <Chev className="size-3" />
            {c.to !== undefined && i < crumbs.length - 1 ? (
              <AppLink to={c.to} className="hover:text-foreground">
                {c.label}
              </AppLink>
            ) : (
              <span className="text-foreground/80">{c.label}</span>
            )}
          </span>
        ))}
      </nav>
      <div className="relative flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="flex flex-wrap items-center gap-3 text-2xl font-semibold tracking-tight sm:text-[30px]">
            <span className="title-gradient">{title}</span>
            {meta}
          </h1>
          {description ? (
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

export function Panel({
  title,
  description,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-2xl border border-white/10 bg-card shadow-card backdrop-blur-xl light:border-border",
        className,
      )}
    >
      {title ? (
        <header className="flex items-start justify-between gap-3 px-5 pt-4">
          <div>
            <h2 className="text-[15px] font-semibold">{title}</h2>
            {description ? (
              <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
            ) : null}
          </div>
          {action}
        </header>
      ) : null}
      <div className={cn("p-5", title ? "pt-3" : "", bodyClassName)}>{children}</div>
    </section>
  );
}

export function ChartTip({
  active,
  payload,
  label,
  format,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number; color?: string; dataKey?: string }[];
  label?: string;
  format?: (n: number) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border bg-popover/95 px-3 py-2 text-xs shadow-lift backdrop-blur">
      {label ? <div className="mb-1 font-medium">{label}</div> : null}
      {payload.map((p) => (
        <div key={String(p.dataKey)} className="flex items-center gap-2 text-muted-foreground">
          <span className="size-2 rounded-full" style={{ background: p.color }} />
          {p.name}:{" "}
          <span className="font-medium text-foreground tabular">
            {format ? format(p.value ?? 0) : p.value}
          </span>
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  body,
  accent = "blue",
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  accent?: Accent;
  action?: ReactNode;
  className?: string;
}) {
  const a = ACCENT[accent];
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-2xl border border-dashed bg-card/60 px-6 py-14 text-center",
        className,
      )}
    >
      <div className="relative mb-5 grid size-24 place-items-center">
        <div className={cn("absolute inset-0 rounded-full opacity-70 blur-xl", a.glow)} />
        <svg
          className="absolute inset-0 size-full text-border"
          viewBox="0 0 96 96"
          fill="none"
          aria-hidden
        >
          <circle cx="48" cy="48" r="46" stroke="currentColor" strokeDasharray="3 5" />
          <circle cx="48" cy="48" r="32" stroke="currentColor" />
        </svg>
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 260, damping: 18 }}
          className={cn(
            "relative grid size-14 place-items-center rounded-2xl text-on-brand shadow-lift",
            a.chip,
          )}
        >
          <Icon className="size-6" />
        </motion.div>
      </div>
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">{body}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ onRetry, message }: { onRetry?: () => void; message?: string }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border bg-card px-6 py-14 text-center shadow-card">
      <div className="mb-4 grid size-12 place-items-center rounded-2xl tint-red">
        <AlertTriangle className="size-6" />
      </div>
      <h3 className="font-semibold">We couldn't load this</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        {message ?? "Something went wrong. Your data is safe — try again."}
      </p>
      {onRetry ? (
        <Button variant="outline" className="mt-5" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

export function CountUp({ value, format }: { value: number; format: (n: number) => string }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    const c = animate(0, value, { duration: 0.9, ease: [0.2, 0.8, 0.2, 1], onUpdate: setV });
    return () => c.stop();
  }, [value]);
  return <span className="tabular">{format(v)}</span>;
}

export function KpiCard({
  label,
  value,
  format,
  icon: Icon,
  accent,
  trend,
  spark,
  hint,
}: {
  label: string;
  value: number;
  format: (n: number) => string;
  icon: LucideIcon;
  accent: Accent;
  trend?: { pct: number; goodWhenUp?: boolean } | null;
  spark?: number[];
  hint?: string;
}) {
  const a = ACCENT[accent];
  const up = (trend?.pct ?? 0) >= 0;
  const good = trend ? (trend.goodWhenUp === false ? !up : up) : true;
  return (
    <div className="card-lift group relative overflow-hidden rounded-2xl border border-white/10 bg-card p-4 shadow-card backdrop-blur-xl">
      <div
        className={cn(
          "pointer-events-none absolute -right-10 -top-10 size-32 rounded-full opacity-30 blur-2xl transition-opacity group-hover:opacity-70",
          a.glow,
        )}
      />
      <div className="flex items-start justify-between">
        <div
          className={cn(
            "grid size-9 place-items-center rounded-xl text-on-brand shadow-glow",
            a.chip,
          )}
        >
          <Icon className="size-[18px]" />
        </div>
        {trend ? (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-medium tabular",
              good ? "tint-green" : "tint-red",
            )}
          >
            {up ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
            {Math.abs(trend.pct * 100).toFixed(1)}%
          </span>
        ) : null}
      </div>
      <div className="mt-3 text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-2xl font-semibold tracking-tight">
        <CountUp value={value} format={format} />
      </div>
      {hint ? <div className="mt-1 text-xs text-subtle-foreground">{hint}</div> : null}
      {spark && spark.length > 1 ? (
        <div className="-mx-1 mt-2 h-9">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={spark.map((v, i) => ({ i, v }))}>
              <defs>
                <linearGradient id={`sp-${accent}-${label.length}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={a.color} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={a.color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="v"
                stroke={a.color}
                strokeWidth={1.8}
                fill={`url(#sp-${accent}-${label.length})`}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : null}
    </div>
  );
}

const DOT: Record<string, string> = {
  approved: "bg-success",
  rejected: "bg-destructive",
  converted: "bg-violet",
  issued: "bg-blue",
  received: "bg-emerald",
  closed: "bg-muted-foreground",
};
export function Timeline({
  events,
  nameOf,
}: {
  events: TimelineEvent[];
  nameOf: (id: string) => string;
}) {
  return (
    <ol className="relative space-y-4 border-l pl-5">
      {events.map((e, i) => (
        <motion.li
          key={e.id}
          initial={{ opacity: 0, x: -6 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * 0.04 }}
          className="relative"
        >
          <span
            className={`absolute -left-[27px] top-1 size-3 rounded-full ring-4 ring-card ${DOT[e.type] ?? "bg-primary"}`}
          />
          <div className="text-sm">{e.text}</div>
          <div className="text-xs text-muted-foreground">
            {nameOf(e.actorId)} · {formatDateTime(e.at)}
          </div>
        </motion.li>
      ))}
    </ol>
  );
}

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  sort?: (a: T, b: T) => number;
  align?: "right";
}

export function DataTable<T>({
  rows,
  columns,
  getId,
  searchText,
  searchPlaceholder = "Search…",
  onRowClick,
  pageSize = 10,
  toolbar,
  empty,
  initialSort,
}: {
  rows: T[];
  columns: Column<T>[];
  getId: (r: T) => string;
  searchText?: (r: T) => string;
  searchPlaceholder?: string;
  onRowClick?: (r: T) => void;
  pageSize?: number;
  toolbar?: ReactNode;
  empty?: ReactNode;
  initialSort?: { key: string; dir: "asc" | "desc" };
}) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(
    initialSort ?? null,
  );
  const [page, setPage] = useState(0);
  const data = useMemo(() => {
    let r = rows;
    if (q && searchText) r = r.filter((x) => searchText(x).toLowerCase().includes(q.toLowerCase()));
    const col = columns.find((c) => c.key === sort?.key);
    if (col?.sort && sort) {
      const f = col.sort;
      r = [...r].sort((a, b) => (sort.dir === "asc" ? 1 : -1) * f(a, b));
    }
    return r;
  }, [rows, q, sort, columns, searchText]);
  const pages = Math.max(1, Math.ceil(data.length / pageSize));
  const cur = Math.min(page, pages - 1);
  const view = data.slice(cur * pageSize, cur * pageSize + pageSize);
  return (
    <div className="rounded-2xl border bg-card shadow-card">
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        {searchText ? (
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-subtle-foreground" />
            <Input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(0);
              }}
              placeholder={searchPlaceholder}
              className="h-9 pl-8"
              aria-label="Search table"
            />
          </div>
        ) : null}
        {toolbar}
      </div>
      {data.length === 0 ? (
        <div className="p-6">
          {empty ?? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No results match your filters.
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                  {columns.map((c) => (
                    <th
                      key={c.key}
                      className={cn(
                        "px-3 py-2.5 text-left font-medium",
                        c.align === "right" && "text-right",
                      )}
                    >
                      {c.sort ? (
                        <button
                          className="inline-flex items-center gap-1 hover:text-foreground"
                          onClick={() =>
                            setSort((s) =>
                              s?.key === c.key
                                ? s.dir === "asc"
                                  ? { key: c.key, dir: "desc" }
                                  : null
                                : { key: c.key, dir: "asc" },
                            )
                          }
                        >
                          {c.header}
                          <ChevronsUpDown className="size-3 opacity-60" />
                        </button>
                      ) : (
                        c.header
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {view.map((r) => (
                  <tr
                    key={getId(r)}
                    onClick={() => onRowClick?.(r)}
                    className={cn(
                      "border-b last:border-0 transition-colors hover:bg-accent/50",
                      onRowClick && "cursor-pointer",
                    )}
                  >
                    {columns.map((c) => (
                      <td
                        key={c.key}
                        className={cn("px-3 py-3", c.align === "right" && "text-right tabular")}
                      >
                        {c.cell(r)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="divide-y md:hidden">
            {view.map((r) => (
              <li key={getId(r)} onClick={() => onRowClick?.(r)} className="space-y-1.5 p-4">
                {columns.map((c, i) => (
                  <div
                    key={c.key}
                    className={cn(
                      "flex items-center justify-between gap-3 text-sm",
                      i === 0 && "font-medium",
                    )}
                  >
                    {i === 0 ? null : (
                      <span className="text-xs text-muted-foreground">{c.header}</span>
                    )}
                    <span className={i === 0 ? "" : "text-right"}>{c.cell(r)}</span>
                  </div>
                ))}
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between border-t px-4 py-2.5 text-xs text-muted-foreground">
            <span className="tabular">
              {cur * pageSize + 1}–{Math.min(data.length, cur * pageSize + pageSize)} of{" "}
              {data.length}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={cur === 0}
                onClick={() => setPage(cur - 1)}
                aria-label="Previous page"
              >
                <ChevronLeft />
              </Button>
              <span className="px-1 tabular">
                {cur + 1} / {pages}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={cur >= pages - 1}
                onClick={() => setPage(cur + 1)}
                aria-label="Next page"
              >
                <ChevronRight />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function FilterTabs({
  tabs,
  value,
  onChange,
}: {
  tabs: { key: string; label: string; count: number }[];
  value: string;
  onChange: (k: string) => void;
}) {
  return (
    <div className="mb-3 flex flex-wrap gap-1.5" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={value === t.key}
          onClick={() => onChange(t.key)}
          className={cn(
            "rounded-full border px-3 py-1.5 text-xs font-medium transition",
            value === t.key
              ? "border-primary/30 bg-primary/10 text-primary"
              : "bg-card text-muted-foreground hover:text-foreground",
          )}
        >
          {t.label} <span className="ml-1 tabular opacity-70">{t.count}</span>
        </button>
      ))}
    </div>
  );
}

export function useOnce<T>(fn: () => T): T {
  const r = useRef<T | null>(null);
  if (r.current === null) r.current = fn();
  return r.current;
}
