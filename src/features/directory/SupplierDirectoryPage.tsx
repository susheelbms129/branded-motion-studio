import { BadgeCheck, CalendarClock, FileCheck2, Landmark, MapPin, Search, ShieldCheck, ShieldQuestion, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { fmtDate } from "@/components/trust/TrustPassport";
import { EmptyState, ErrorState, PageHeader } from "@/components/vendora/kit";
import {
  listSuppliers, NO_FILTERS, PAGE_SIZE,
  type DirectoryFilters, type DirectorySupplier,
} from "@/lib/directory-api";
import { AppLink } from "@/lib/nav";
import { cn } from "@/lib/utils";

/** Select items cannot have an empty value, so "any" is a word that can never be a real state or category. */
const ANY = "__any__";

/**
 * Find suppliers: real suppliers, trust first. Every card says HOW the supplier was checked, because a live
 * government record and a reviewed document are not the same thing and a buyer deserves to know which one it is.
 */
export function SupplierDirectoryPage() {
  const [filters, setFilters] = useState<DirectoryFilters>(NO_FILTERS);
  const [typed, setTyped] = useState("");
  const [items, setItems] = useState<DirectorySupplier[]>([]);
  const [total, setTotal] = useState(0);
  // The choices for the state and category menus come from the first unfiltered answer, so they never shrink while filtering.
  const [states, setStates] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState("");
  const [loadMoreError, setLoadMoreError] = useState("");
  const ticket = useRef(0);

  // Typing waits a moment, so we ask the database once per pause, not once per key.
  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => (f.search === typed.trim() ? f : { ...f, search: typed.trim() })), 300);
    return () => clearTimeout(t);
  }, [typed]);

  const load = useCallback(async (f: DirectoryFilters) => {
    const mine = ++ticket.current; // an older answer arriving late must never overwrite a newer one
    setLoading(true);
    setError("");
    setLoadMoreError("");
    try {
      const page = await listSuppliers(f, 0);
      if (mine !== ticket.current) return;
      setItems(page.items);
      setTotal(page.total);
      setStates(page.states);
      setCategories(page.categories);
    } catch (e) {
      if (mine !== ticket.current) return;
      setItems([]);
      setTotal(0);
      setError(e instanceof Error ? e.message : "We couldn't load suppliers.");
    } finally {
      if (mine === ticket.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(filters);
  }, [filters, load]);

  async function loadMore() {
    const mine = ticket.current;
    setMore(true);
    setLoadMoreError("");
    try {
      const page = await listSuppliers(filters, items.length);
      if (mine !== ticket.current) return;
      setItems((cur) => {
        const seen = new Set(cur.map((s) => s.org_id));
        return [...cur, ...page.items.filter((s) => !seen.has(s.org_id))];
      });
      setTotal(page.total);
    } catch (e) {
      if (mine === ticket.current) setLoadMoreError(e instanceof Error ? e.message : "We couldn't load more suppliers.");
    } finally {
      setMore(false);
    }
  }

  const filtered = filters.search !== "" || filters.state !== "" || filters.category !== "" || filters.verifiedOnly;
  const verifiedShown = items.filter((s) => s.level >= 1).length;
  function clear() {
    setTyped("");
    setFilters(NO_FILTERS);
  }

  return (
    <>
      <PageHeader
        title="Find suppliers"
        accent="emerald"
        crumbs={[{ label: "Find suppliers" }]}
        description="Real suppliers on Vendora, with the proof behind each one. Verified suppliers come first."
      />

      <div className="mb-6 grid gap-3 rounded-2xl border border-border bg-card p-4 shadow-card lg:grid-cols-[1fr_200px_220px_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="Search by name, city or what they supply…"
            aria-label="Search suppliers"
            className="pl-9"
            maxLength={80}
          />
        </div>
        <Select value={filters.state || ANY} onValueChange={(v) => setFilters((f) => ({ ...f, state: v === ANY ? "" : v }))}>
          <SelectTrigger aria-label="Filter by state"><SelectValue placeholder="Any state" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Any state</SelectItem>
            {states.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filters.category || ANY} onValueChange={(v) => setFilters((f) => ({ ...f, category: v === ANY ? "" : v }))}>
          <SelectTrigger aria-label="Filter by category"><SelectValue placeholder="Any category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Any category</SelectItem>
            {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2.5 rounded-md border border-input px-3 py-2 text-sm font-medium">
          <Switch checked={filters.verifiedOnly} onCheckedChange={(v) => setFilters((f) => ({ ...f, verifiedOnly: v }))} aria-label="Verified only" />
          <ShieldCheck className="size-4 text-muted-foreground" aria-hidden /> Verified only
        </label>
      </div>

      {error ? (
        <ErrorState message={error} onRetry={() => void load(filters)} />
      ) : loading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-busy="true" aria-label="Loading suppliers">
          {Array.from({ length: 6 }, (_, i) => <div key={i} className="h-56 animate-pulse rounded-2xl border border-border bg-muted/40" />)}
        </div>
      ) : items.length === 0 ? (
        filtered ? (
          <EmptyState
            icon={Search}
            accent="amber"
            title="No suppliers match"
            body="Try a different word, or remove a filter. New suppliers join every day."
            action={<Button variant="outline" onClick={clear}><X /> Clear filters</Button>}
          />
        ) : (
          <EmptyState
            icon={ShieldCheck}
            accent="emerald"
            title="No suppliers have joined yet"
            body="Suppliers appear here once they finish setting up their company. Check back soon."
          />
        )
      ) : (
        <>
          <p className="mb-4 flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground" aria-live="polite">
            <span><span className="font-semibold text-foreground">{total}</span> {total === 1 ? "supplier" : "suppliers"}{filtered ? " match" : ""}</span>
            {!filters.verifiedOnly && verifiedShown < items.length ? <span>· Unverified suppliers are listed last</span> : null}
          </p>
          <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {items.map((s) => <li key={s.org_id}><SupplierCard s={s} /></li>)}
          </ul>
          {items.length < total ? (
            <div className="mt-8 flex flex-col items-center gap-2">
              <Button variant="outline" onClick={() => void loadMore()} disabled={more}>
                {more ? "Loading…" : `Show more (${Math.min(PAGE_SIZE, total - items.length)} of ${total - items.length} left)`}
              </Button>
              {loadMoreError ? <p className="text-sm text-destructive" role="alert">{loadMoreError}</p> : null}
            </div>
          ) : null}
          <p className="mt-8 text-center text-xs text-muted-foreground">
            Vendora checks identity and documents. It does not guarantee a supplier's quality, delivery or finances.
          </p>
        </>
      )}
    </>
  );
}

/** How this supplier was checked, in one honest line. Never blur a government record with a reviewed document. */
function evidenceOf(s: DirectorySupplier): { text: string; icon: typeof Landmark } | null {
  if (s.level === 0) return null;
  return s.government_checked
    ? { text: "Government record checked", icon: Landmark }
    : { text: "Document reviewed", icon: FileCheck2 };
}

function SupplierCard({ s }: { s: DirectorySupplier }) {
  const verified = s.level >= 1;
  const evidence = evidenceOf(s);
  const place = [s.city, s.state].filter(Boolean).join(", ");
  const shown = s.categories.slice(0, 3);
  return (
    <article className="group relative flex h-full flex-col rounded-2xl border border-border bg-card p-5 shadow-card transition focus-within:ring-2 focus-within:ring-ring hover:shadow-lift">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold" title={s.name}>
            {/* the whole card is the link, so it works with a click, a tap or the keyboard */}
            <AppLink to={`find-suppliers/${s.org_id}`} className="after:absolute after:inset-0 after:content-[''] focus:outline-none">{s.name}</AppLink>
          </h2>
          {place ? (
            <p className="mt-0.5 flex items-center gap-1 text-sm text-muted-foreground">
              <MapPin className="size-3.5 shrink-0" aria-hidden /> <span className="truncate">{place}</span>
            </p>
          ) : null}
        </div>
        <span className={cn("flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold", verified ? "tint-emerald" : "tint-slate")}>
          {verified ? <BadgeCheck className="size-3.5" aria-hidden /> : <ShieldQuestion className="size-3.5" aria-hidden />}
          {verified ? `Level ${s.level} of 3` : "Not verified"}
        </span>
      </div>

      <p className="mt-3 text-sm font-semibold">{verified ? s.level_name : "No proofs verified yet"}</p>
      {evidence ? (
        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <evidence.icon className="size-3.5" aria-hidden /> {evidence.text}
          {s.proofs > 0 ? ` · ${s.proofs} ${s.proofs === 1 ? "proof" : "proofs"}` : ""}
        </p>
      ) : null}
      {s.valid_through ? (
        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <CalendarClock className="size-3.5" aria-hidden /> Checked proofs valid until {fmtDate(s.valid_through)}
        </p>
      ) : null}

      {s.description ? <p className="mt-3 line-clamp-3 text-sm text-muted-foreground">{s.description}</p> : null}

      {shown.length > 0 ? (
        <ul className="mt-auto flex flex-wrap gap-1.5 pt-4" aria-label="Categories">
          {shown.map((c) => <li key={c} className="rounded-full tint-slate px-2.5 py-0.5 text-xs font-medium">{c}</li>)}
          {s.categories.length > shown.length ? <li className="px-1 py-0.5 text-xs text-muted-foreground">+{s.categories.length - shown.length} more</li> : null}
        </ul>
      ) : null}
    </article>
  );
}
