import { Check, ChevronDown, Clock, Sparkles, X } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Can, EmptyState, FilterTabs, PageHeader, StatusBadge } from "@/components/vendora/kit";
import { ACCENT } from "@/lib/accents";
import { formatMoney } from "@/lib/format";
import { AppLink } from "@/lib/nav";
import { useWs } from "@/lib/ws-store";
import { cn } from "@/lib/utils";

const TYPE_LABEL = {
  price_increase: "Price increase",
  repeated_delay: "Repeated delay",
  lower_landed_cost: "Lower landed cost",
  possible_duplicate: "Possible duplicate",
} as const;
const linkFor = (k: string, id: string) =>
  k === "purchase_order"
    ? `purchase-orders/${id}`
    : k === "purchase_request"
      ? `requests/${id}`
      : k === "supplier"
        ? `suppliers/${id}`
        : "";

export function InsightsPage() {
  const ws = useWs();
  const all = useMemo(() => ws.insights(), [ws]);
  const [tab, setTab] = useState("open");
  const [openId, setOpenId] = useState<string | null>(null);
  const rows = all.filter((i) => tab === "all" || i.status === tab);
  return (
    <>
      <PageHeader
        title="AI Insights"
        accent="ai"
        crumbs={[{ label: "AI Insights" }]}
        description="Every insight is computed from your own orders and requests, and shows the evidence behind it. Nothing is guessed."
      />
      <FilterTabs
        value={tab}
        onChange={setTab}
        tabs={(["open", "snoozed", "dismissed", "resolved", "all"] as const).map((t) => ({
          key: t,
          label: t === "all" ? "All" : t[0]!.toUpperCase() + t.slice(1),
          count: t === "all" ? all.length : all.filter((i) => i.status === t).length,
        }))}
      />
      {rows.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          accent="ai"
          title={all.length ? "Nothing in this view" : "No insights yet"}
          body={
            all.length
              ? "Switch tabs to see other insights."
              : "Insights show up once there is enough purchase history — at least a few orders per material or supplier."
          }
        />
      ) : (
        <ul className="space-y-3">
          {rows.map((i) => {
            const open = openId === i.id;
            return (
              <li key={i.id} className="overflow-hidden rounded-2xl border bg-card shadow-card">
                <button
                  className="flex w-full items-start gap-3 p-4 text-left"
                  onClick={() => setOpenId(open ? null : i.id)}
                  aria-expanded={open}
                >
                  <span
                    className={cn(
                      "mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl text-on-brand",
                      ACCENT.ai.chip,
                    )}
                  >
                    <Sparkles className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{i.title}</span>
                      <StatusBadge kind="severity" value={i.severity} />
                      <span className="tint-slate rounded-full px-2 py-0.5 text-[11px]">
                        {TYPE_LABEL[i.type]}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{i.whatHappened}</p>
                    <div className="mt-1.5 flex flex-wrap gap-x-4 text-xs text-subtle-foreground">
                      <span>Confidence {Math.round(i.confidence * 100)}%</span>
                      {i.impactAmount ? (
                        <span>Estimated impact {formatMoney(i.impactAmount)}</span>
                      ) : null}
                      <span>{i.evidence.length} evidence records</span>
                    </div>
                  </div>
                  <ChevronDown
                    className={cn(
                      "mt-1 size-4 shrink-0 text-muted-foreground transition",
                      open && "rotate-180",
                    )}
                  />
                </button>
                {open ? (
                  <div className="space-y-4 border-t bg-muted/30 p-4 text-sm">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Why flagged
                      </div>
                      <p className="mt-1">{i.whyFlagged}</p>
                    </div>
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Evidence
                      </div>
                      <ul className="mt-1.5 space-y-1.5">
                        {i.evidence.map((e) => (
                          <li
                            key={`${e.kind}${e.id}`}
                            className="flex items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2 text-xs"
                          >
                            <span className="tabular font-medium">{e.label}</span>
                            <span className="flex-1 truncate text-muted-foreground">
                              {e.detail}
                            </span>
                            {linkFor(e.kind, e.id) ? (
                              <AppLink to={linkFor(e.kind, e.id)} className="text-primary">
                                Open
                              </AppLink>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Suggested action
                      </div>
                      <p className="mt-1">{i.suggestedAction}</p>
                    </div>
                    <Can permission="insights.manage">
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" onClick={() => ws.setInsightStatus(i.id, "resolved")}>
                          <Check />
                          Mark resolved
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => ws.setInsightStatus(i.id, "snoozed")}
                        >
                          <Clock />
                          Snooze
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => ws.setInsightStatus(i.id, "dismissed")}
                        >
                          <X />
                          Dismiss
                        </Button>
                        {i.status !== "open" ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => ws.setInsightStatus(i.id, "open")}
                          >
                            Reopen
                          </Button>
                        ) : null}
                      </div>
                    </Can>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
