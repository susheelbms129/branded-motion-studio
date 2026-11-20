import { AlertTriangle, CalendarClock, CheckCircle2, Hourglass, PauseCircle, ShieldQuestion } from "lucide-react";
import type { ReactNode } from "react";

import { formatDate, formatMoney } from "@/lib/format";
import { daysText, STATUS_LABEL, statusTone, type PayState, type PayStatus } from "@/lib/msme-payments";
import { cn } from "@/lib/utils";
import { asCurrency } from "@/features/pos/OrderParts";

export const money = (n: number, currency?: string) => formatMoney(n, { currency: asCurrency(currency), decimals: 2 });
export const moneyShort = (n: number, currency?: string) => formatMoney(n, { currency: asCurrency(currency), decimals: 0 });
export const dayText = (d: string | null | undefined) => (d ? formatDate(d) : "—");

const TONE: Record<ReturnType<typeof statusTone>, string> = {
  red: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30",
  amber: "bg-amber-500/10 text-amber-800 dark:text-amber-300 border-amber-500/30",
  green: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  blue: "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30",
  grey: "bg-muted text-muted-foreground border-border",
};

const ICON: Record<PayStatus, typeof CheckCircle2> = {
  none: Hourglass,
  not_started: Hourglass,
  on_hold: PauseCircle,
  on_track: CalendarClock,
  due_soon: CalendarClock,
  due_today: AlertTriangle,
  overdue: AlertTriangle,
  paid: CheckCircle2,
  paid_late: CheckCircle2,
};

/** Status in words AND colour AND an icon, so it never relies on colour alone. */
export function PayBadge({ status }: { status: PayStatus }) {
  const Icon = ICON[status];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold", TONE[statusTone(status)])}>
      <Icon className="size-3.5" aria-hidden />
      {STATUS_LABEL[status]}
    </span>
  );
}

/** The one line that answers "when": the deadline, how many days are left and whether it is a forecast. */
export function DueLine({ s, side }: { s: PayState; side: "buyer" | "supplier" }) {
  if (s.status === "none") return <span className="text-muted-foreground">—</span>;
  if (s.status === "paid" || s.status === "paid_late") return <span>Paid {dayText(s.last_paid_on)}</span>;
  if (s.status === "on_hold") return <span>Paused until the objection is settled</span>;
  if (!s.due_date) return <span className="text-muted-foreground">Starts at delivery</span>;
  if (s.projected) {
    return (
      <span>
        {side === "supplier" ? "Expected by " : "Would fall due "}
        <strong>{dayText(s.due_date)}</strong> <span className="text-muted-foreground">(if delivered on time)</span>
      </span>
    );
  }
  return (
    <span>
      <strong>{dayText(s.due_date)}</strong> <span className="text-muted-foreground">· {daysText(s.days_left)}</span>
    </span>
  );
}

export function Stat({ label, value, sub, tone = "grey" }: { label: string; value: ReactNode; sub?: ReactNode; tone?: keyof typeof TONE }) {
  return (
    <div className={cn("rounded-xl border p-4", TONE[tone])}>
      <p className="text-xs font-medium uppercase tracking-wide opacity-80">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular text-foreground">{value}</p>
      {sub ? <p className="mt-0.5 text-xs opacity-80">{sub}</p> : null}
    </div>
  );
}

export function RuleNote({ children }: { children: ReactNode }) {
  return (
    <p className="flex gap-2 rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
      <ShieldQuestion className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}
