import { BookmarkPlus, SearchCheck } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { SupplierCard } from "@/components/directory/SupplierCard";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState } from "@/components/vendora/kit";
import { listSavedSuppliers, PAGE_SIZE, type DirectorySupplier } from "@/lib/directory-api";
import { AppLink } from "@/lib/nav";
import { useSaved } from "@/lib/saved-store";
import { useUi } from "@/lib/ui-store";

/** The company's shortlist. What is shown comes from the database; removing a card (and Undo) happens on screen at once. */
export function SavedSuppliersList() {
  const orgId = useUi((s) => s.orgId);
  const stillSaved = useSaved((s) => s.ids);
  const [items, setItems] = useState<DirectorySupplier[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState("");
  const ticket = useRef(0);

  const load = useCallback(async () => {
    if (!orgId) return;
    const mine = ++ticket.current;
    setLoading(true);
    setError("");
    try {
      const page = await listSavedSuppliers(orgId, 0);
      if (mine !== ticket.current) return;
      setItems(page.items);
      setTotal(page.total);
    } catch (e) {
      if (mine === ticket.current) setError(e instanceof Error ? e.message : "We couldn't load your saved suppliers.");
    } finally {
      if (mine === ticket.current) setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function loadMore() {
    if (!orgId) return;
    setMore(true);
    try {
      const page = await listSavedSuppliers(orgId, items.length);
      setItems((cur) => {
        const seen = new Set(cur.map((s) => s.org_id));
        return [...cur, ...page.items.filter((s) => !seen.has(s.org_id))];
      });
      setTotal(page.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "We couldn't load more.");
    } finally {
      setMore(false);
    }
  }

  const find = (
    <Button asChild>
      <AppLink to="find-suppliers"><SearchCheck /> Find suppliers</AppLink>
    </Button>
  );

  if (!orgId) {
    return <EmptyState icon={BookmarkPlus} accent="amber" title="Saved suppliers need a company workspace" body="Turn off demo data to use your own shortlist." />;
  }
  if (error) return <ErrorState message={error} onRetry={() => void load()} />;
  if (loading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-busy="true" aria-label="Loading saved suppliers">
        {Array.from({ length: 3 }, (_, i) => <div key={i} className="h-56 animate-pulse rounded-2xl border border-border bg-muted/40" />)}
      </div>
    );
  }
  // A supplier removed on this page disappears at once; Undo brings it back (it is still in `items`).
  const shown = items.filter((s) => stillSaved.has(s.org_id));
  if (total === 0) {
    return (
      <EmptyState
        icon={BookmarkPlus}
        accent="amber"
        title="Your shortlist is empty"
        body="Save suppliers you like from the directory. Your whole team will see them here."
        action={find}
      />
    );
  }
  return (
    <>
      <p className="mb-4 text-sm text-muted-foreground" aria-live="polite">
        <span className="font-semibold text-foreground">{shown.length}</span> saved {shown.length === 1 ? "supplier" : "suppliers"}
      </p>
      {shown.length === 0 ? (
        <EmptyState icon={BookmarkPlus} accent="amber" title="You removed them all" body="Use Undo on the message above, or find more suppliers." action={find} />
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((s) => <li key={s.org_id}><SupplierCard s={s} /></li>)}
        </ul>
      )}
      {items.length < total ? (
        <div className="mt-8 flex justify-center">
          <Button variant="outline" onClick={() => void loadMore()} disabled={more}>
            {more ? "Loading…" : `Show more (${Math.min(PAGE_SIZE, total - items.length)} of ${total - items.length} left)`}
          </Button>
        </div>
      ) : null}
    </>
  );
}
