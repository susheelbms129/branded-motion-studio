import { useQuery } from "@tanstack/react-query";
import { Repeat } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Panel } from "@/components/vendora/kit";
import { formatDate, formatMoney } from "@/lib/format";
import { AppLink } from "@/lib/nav";
import {
  dueText,
  dueTone,
  listReorderSuggestions,
  REORDER_KEY,
  type ReorderSuggestion,
} from "@/lib/reorder-api";
import { cn } from "@/lib/utils";
import { ReorderDialog } from "./ReorderDialog";

const TONE = {
  late: "bg-red-500/10 text-red-700 dark:text-red-300",
  soon: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  later: "bg-muted text-muted-foreground",
  none: "bg-muted text-muted-foreground",
} as const;

/**
 * "Reorder in one click": the purchases the buyer keeps repeating, most due first. Vendora learns the usual gap between orders
 * of the same things from the same supplier. It never blocks the page: if it can't load, it simply isn't shown.
 */
export function ReorderSuggestions({ orgId }: { orgId: string }) {
  const [poId, setPoId] = useState<string | null>(null);
  const q = useQuery({
    queryKey: [REORDER_KEY, "suggestions", orgId],
    queryFn: () => listReorderSuggestions(orgId, 6),
  });
  const items: ReorderSuggestion[] = q.data?.items ?? [];
  if (q.isLoading || q.isError || items.length === 0) return null;
  const can = q.data?.can_reorder === true;
  return (
    <>
      <Panel
        title="Reorder in one click"
        description="What you keep buying, most due first. Prices stay the ones your supplier agreed last time."
        bodyClassName="p-0"
      >
        <ul className="divide-y">
          {items.map((s) => {
            const due = dueText(s.days_until);
            return (
              <li
                key={s.po_id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{s.title || s.number}</p>
                  <p className="text-xs text-muted-foreground">
                    {s.supplier_name} · last delivered {formatDate(s.delivered_at)} ·{" "}
                    {formatMoney(s.total)}
                    {s.gap_days !== null ? ` · usually every ${s.gap_days} days` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {due ? (
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-xs font-medium",
                        TONE[dueTone(s.days_until)],
                      )}
                    >
                      {due}
                    </span>
                  ) : null}
                  {s.open_order ? (
                    <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-xs font-medium text-blue-700 dark:text-blue-300">
                      Order on its way
                    </span>
                  ) : null}
                  {!s.verified_today ? (
                    <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-700 dark:text-red-300">
                      Supplier not verified
                    </span>
                  ) : null}
                  <Button variant="outline" size="sm" asChild>
                    <AppLink to={`purchase-orders/${s.po_id}`}>View</AppLink>
                  </Button>
                  {can ? (
                    <Button size="sm" disabled={!s.verified_today} onClick={() => setPoId(s.po_id)}>
                      <Repeat />
                      Reorder
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </Panel>
      {poId ? <ReorderDialog poId={poId} open onOpenChange={(v) => !v && setPoId(null)} /> : null}
    </>
  );
}
