import { Pencil, Trash2 } from "lucide-react";

import { formatMoney } from "@/lib/format";
import { productReadiness } from "@/lib/product-quality";
import { toDraft, type MyProduct } from "@/lib/supplier-products-api";
import { cn } from "@/lib/utils";

const TIER_STYLE = {
  "Ready for buyers": "tint-emerald",
  "Almost there": "tint-amber",
  "Needs details": "tint-coral",
} as const;
const AVAIL_STYLE = {
  Available: "tint-emerald",
  "Made to order": "tint-blue",
  "Temporarily unavailable": "tint-slate",
} as const;
const CURRENCIES = ["INR", "USD", "EUR", "AED"] as const;
type Cur = (typeof CURRENCIES)[number];
export const asCurrency = (c: string): Cur =>
  (CURRENCIES as readonly string[]).includes(c) ? (c as Cur) : "INR";

export function priceLine(price: number | null, unit: string, currency: string) {
  if (price === null) return null;
  return `${formatMoney(price, { currency: asCurrency(currency), decimals: price % 1 === 0 ? 0 : 2 })}${unit ? ` / ${unit.toLowerCase()}` : ""}`;
}

/** One product as a card. The ring is its buyer-search readiness; the line under it says the single best thing to add. */
export function ProductCard({
  p,
  canEdit,
  onEdit,
  onDelete,
}: {
  p: MyProduct;
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const r = productReadiness(toDraft(p));
  const price = priceLine(p.price, p.unit, p.currency);
  const c = 2 * Math.PI * 18;
  return (
    <li className="group flex flex-col rounded-2xl border border-border bg-card p-5 shadow-card transition hover:-translate-y-0.5 hover:shadow-glow">
      <div className="flex items-start gap-3">
        <div
          className="relative size-11 shrink-0"
          role="img"
          aria-label={`Readiness ${r.score} out of 100`}
        >
          <svg viewBox="0 0 44 44" className="-rotate-90 size-11">
            <circle
              cx="22"
              cy="22"
              r="18"
              fill="none"
              stroke="currentColor"
              className="text-muted"
              strokeWidth="4"
            />
            <circle
              cx="22"
              cy="22"
              r="18"
              fill="none"
              strokeWidth="4"
              strokeLinecap="round"
              stroke={
                r.score >= 85
                  ? "var(--brand-emerald)"
                  : r.score >= 60
                    ? "var(--brand-amber)"
                    : "var(--brand-coral)"
              }
              strokeDasharray={c}
              strokeDashoffset={c * (1 - r.score / 100)}
            />
          </svg>
          <span className="absolute inset-0 grid place-items-center text-[11px] font-semibold tabular">
            {r.score}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold">{p.name}</h3>
          <p className="truncate text-xs text-muted-foreground">{p.category}</p>
        </div>
        {canEdit ? (
          <div className="flex shrink-0 gap-0.5 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
            <button
              onClick={onEdit}
              aria-label={`Edit ${p.name}`}
              className="grid size-8 place-items-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              <Pencil className="size-4" aria-hidden />
            </button>
            <button
              onClick={onDelete}
              aria-label={`Remove ${p.name}`}
              className="grid size-8 place-items-center rounded-md text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="size-4" aria-hidden />
            </button>
          </div>
        ) : null}
      </div>
      <p
        className={cn(
          "mt-3 line-clamp-2 min-h-10 text-sm",
          p.description ? "text-foreground/75" : "italic text-muted-foreground",
        )}
      >
        {p.description || "No description yet."}
      </p>
      <div className="mt-4 flex items-end justify-between gap-2">
        <div>
          {price ? (
            <p className="text-lg font-semibold tabular">{price}</p>
          ) : (
            <p className="tint-amber rounded-full px-2.5 py-0.5 text-xs font-semibold">
              Add a price
            </p>
          )}
          {p.moq !== null ? (
            <p className="mt-0.5 text-xs text-muted-foreground tabular">Min. order {p.moq}</p>
          ) : null}
        </div>
        <span
          className={cn(
            "rounded-full px-2.5 py-1 text-[11px] font-semibold",
            AVAIL_STYLE[p.availability],
          )}
        >
          {p.availability}
        </span>
      </div>
      <div className="mt-4 border-t border-border pt-3">
        <span
          className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", TIER_STYLE[r.tier])}
        >
          {r.tier}
        </span>
        {r.tips[0] ? (
          <p className="mt-1.5 text-xs text-muted-foreground">Next: {r.tips[0].text}</p>
        ) : null}
      </div>
    </li>
  );
}
