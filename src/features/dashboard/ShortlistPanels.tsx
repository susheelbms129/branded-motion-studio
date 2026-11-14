import { BadgeCheck, BookmarkPlus, CalendarClock, Landmark, SearchCheck, ShieldCheck, ShieldQuestion } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState, Panel, Person } from "@/components/vendora/kit";
import { PAGE_SIZE, type DirectorySupplier } from "@/lib/directory-api";
import { AppLink } from "@/lib/nav";
import { trustWatch, watchLabel } from "@/lib/sourcing-health";
import { cn } from "@/lib/utils";

import type { SavedPreview } from "./use-saved-preview";

const placeOf = (s: DirectorySupplier) => [s.city, s.state].filter(Boolean).join(", ");

function TrustChip({ s }: { s: DirectorySupplier }) {
  const verified = s.level >= 1;
  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold",
        verified ? "tint-emerald" : "tint-slate",
      )}
    >
      {verified ? <BadgeCheck className="size-3.5" aria-hidden /> : <ShieldQuestion className="size-3.5" aria-hidden />}
      {verified ? `Level ${s.level} of 3` : "Not verified"}
    </span>
  );
}

function Skeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-16 animate-pulse rounded-lg border bg-muted/40" />
      ))}
    </div>
  );
}

function Problem({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center">
      <p className="max-w-sm text-sm text-muted-foreground">{message}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

/** The team's saved suppliers, newest first. */
export function ShortlistPanel({ saved, className }: { saved: SavedPreview; className?: string }) {
  return (
    <Panel
      title="Your shortlist"
      description="Suppliers your team saved from the verified directory"
      className={className}
      action={
        <AppLink to="suppliers" className="text-sm font-semibold text-primary">
          View all
        </AppLink>
      }
    >
      {saved.status === "error" ? (
        <Problem message={saved.message} onRetry={saved.reload} />
      ) : saved.status !== "ready" ? (
        <Skeleton rows={3} />
      ) : saved.total === 0 ? (
        <EmptyState
          icon={BookmarkPlus}
          accent="emerald"
          title="Build your shortlist"
          body="Save verified suppliers you like. Your whole team sees them here, with their trust status."
          className="border-0 py-6"
          action={
            <Button asChild>
              <AppLink to="find-suppliers">
                <SearchCheck />
                Find suppliers
              </AppLink>
            </Button>
          }
        />
      ) : (
        <ul className="space-y-3">
          {saved.items.slice(0, 5).map((s) => (
            <li key={s.org_id}>
              <AppLink
                to={`find-suppliers/${s.org_id}`}
                className="card-lift flex items-center gap-4 rounded-lg border p-4"
              >
                <Person name={s.name} accent="emerald" size={42} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-base font-semibold">{s.name}</div>
                  <div className="truncate text-sm text-muted-foreground">
                    {[placeOf(s), s.categories[0]].filter(Boolean).join(" · ") || "Details not added yet"}
                  </div>
                </div>
                <div className="hidden items-center gap-2 sm:flex">
                  {s.government_checked ? (
                    <span title="Government record checked" className="text-muted-foreground">
                      <Landmark className="size-4" aria-label="Government record checked" />
                    </span>
                  ) : null}
                  <TrustChip s={s} />
                </div>
              </AppLink>
            </li>
          ))}
          {saved.total > 5 ? (
            <li className="pt-1 text-center text-sm text-muted-foreground">
              and {saved.total - 5} more on your <AppLink to="suppliers" className="font-semibold text-primary">Saved suppliers</AppLink> page
            </li>
          ) : null}
        </ul>
      )}
    </Panel>
  );
}

/**
 * Trust watch: Vendora keeps an eye on the verification of everyone you saved, so a buyer finds out that a proof is about to
 * run out before they place an order, not after. It only reads the shortlist the database already returned for this company.
 */
export function TrustWatchPanel({ saved, className }: { saved: SavedPreview; className?: string }) {
  const watch = saved.status === "ready" ? trustWatch(saved.items) : [];
  // The dashboard loads one page. Say so honestly if the shortlist is longer than that.
  const partial = saved.status === "ready" && saved.items.length < saved.total;
  return (
    <Panel
      title="Trust watch"
      description="Check these before you place an order"
      className={className}
    >
      {saved.status === "error" ? (
        <Problem message={saved.message} onRetry={saved.reload} />
      ) : saved.status !== "ready" ? (
        <Skeleton rows={2} />
      ) : saved.total === 0 ? (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <span className="grid size-12 place-items-center rounded-xl bg-gradient-emerald text-on-brand shadow-glow">
            <ShieldCheck className="size-6" aria-hidden />
          </span>
          <p className="max-w-xs text-sm text-muted-foreground">
            Save a supplier and Vendora watches its verification for you, and warns you before a proof runs out.
          </p>
        </div>
      ) : watch.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <span className="grid size-12 place-items-center rounded-xl bg-gradient-emerald text-on-brand shadow-glow">
            <ShieldCheck className="size-6" aria-hidden />
          </span>
          <p className="text-base font-semibold">All clear</p>
          <p className="max-w-xs text-sm text-muted-foreground">
            {partial
              ? `None of your ${saved.items.length} newest saved suppliers need a trust check right now.`
              : "Every saved supplier is verified, with proofs valid for at least another 30 days."}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {watch.slice(0, 4).map((w) => (
            <li key={w.supplier.org_id}>
              <AppLink
                to={`find-suppliers/${w.supplier.org_id}`}
                className="card-lift flex items-center gap-3 rounded-lg border p-4"
              >
                <span
                  className={cn(
                    "grid size-10 shrink-0 place-items-center rounded-xl",
                    w.kind === "expiring" ? "tint-amber" : "tint-slate",
                  )}
                >
                  {w.kind === "expiring" ? (
                    <CalendarClock className="size-5" aria-hidden />
                  ) : (
                    <ShieldQuestion className="size-5" aria-hidden />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-semibold">{w.supplier.name}</div>
                  <div className="text-sm text-muted-foreground">{watchLabel(w)}</div>
                </div>
              </AppLink>
            </li>
          ))}
          {watch.length > 4 ? (
            <li className="pt-1 text-center text-sm text-muted-foreground">
              {watch.length - 4} more to check on your <AppLink to="suppliers" className="font-semibold text-primary">shortlist</AppLink>
            </li>
          ) : null}
          {partial ? (
            <li className="pt-1 text-center text-xs text-subtle-foreground">Checked your {Math.min(saved.items.length, PAGE_SIZE)} newest saved suppliers.</li>
          ) : null}
        </ul>
      )}
    </Panel>
  );
}
