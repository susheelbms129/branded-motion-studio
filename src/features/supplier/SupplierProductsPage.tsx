import { AlertCircle, Package, Plus, RefreshCw, Search, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { SupplierShell, useSupplier } from "@/components/supplier/SupplierShell";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ProductCard } from "@/features/supplier/ProductCard";
import { ProductDialog } from "@/features/supplier/ProductDialog";
import { EMPTY_PRODUCT, catalogHealth, type ProductDraft } from "@/lib/product-quality";
import {
  deleteProduct,
  loadCatalog,
  saveProduct,
  toDraft,
  type Catalog,
  type MyProduct,
} from "@/lib/supplier-products-api";

const GAP_TEXT: Record<string, string> = {
  price: "Add prices. Buyers compare priced products first.",
  description: "Add descriptions with grade or size. Buyers compare these before they ask.",
  unit: "Say what each price is per (kg, piece, box).",
  moq: "Add minimum order quantities, so buyers don't have to ask.",
  name: "Use more specific names.",
  category: "Pick categories, so buyers searching them find you.",
  availability: "Some products show as unavailable.",
};

export function SupplierProductsPage() {
  return (
    <SupplierShell>
      <ProductsContent />
    </SupplierShell>
  );
}

function ProductsContent() {
  const { summary, status: shell, reload: reloadShell } = useSupplier();
  const orgId = summary?.id ?? null;
  const [cat, setCat] = useState<Catalog | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<{ id?: string; draft: ProductDraft } | null>(null);
  const [removing, setRemoving] = useState<MyProduct | null>(null);

  const load = useCallback(async () => {
    if (!orgId) return;
    try {
      setCat(await loadCatalog(orgId));
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, [orgId]);

  useEffect(() => {
    if (shell === "loading") return;
    if (!orgId) {
      setStatus("error");
      return;
    }
    void load();
  }, [shell, orgId, load]);

  const items = useMemo(() => cat?.items ?? [], [cat]);
  const health = useMemo(() => catalogHealth(items.map(toDraft)), [items]);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t
      ? items.filter(
          (p) => p.name.toLowerCase().includes(t) || p.category.toLowerCase().includes(t),
        )
      : items;
  }, [items, q]);

  async function onSave(d: ProductDraft) {
    if (!orgId) return;
    await saveProduct(orgId, d, editing?.id);
    toast.success(editing?.id ? "Product updated" : "Product added");
    setEditing(null);
    await load();
    reloadShell();
  }

  async function onRemove() {
    if (!orgId || !removing) return;
    const p = removing;
    setRemoving(null);
    try {
      await deleteProduct(orgId, p.id);
      toast.success("Product removed");
      await load();
      reloadShell();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "We couldn't remove that.");
    }
  }

  if (status === "error") {
    return (
      <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-card">
        <AlertCircle className="mx-auto size-8 text-amber" aria-hidden />
        <h1 className="mt-3 text-xl font-semibold">We couldn't load your products</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Please check your connection and try again.
        </p>
        <button
          onClick={() => {
            setStatus("loading");
            void load();
          }}
          className="mt-5 inline-flex items-center gap-2 rounded-md bg-gradient-cta px-4 py-2 text-sm font-semibold text-white"
        >
          <RefreshCw className="size-4" aria-hidden /> Try again
        </button>
      </div>
    );
  }

  const canEdit = cat?.canEdit ?? false;
  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-3xl bg-gradient-navy p-6 text-white shadow-card sm:p-8">
        <div
          className="pointer-events-none absolute -right-24 -top-24 size-80 glow-pink opacity-40"
          aria-hidden
        />
        <div className="relative flex flex-wrap items-center justify-between gap-6">
          <div className="min-w-0 basis-72">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-navy-muted">
              Your catalogue
            </p>
            <h1 className="mt-1 text-3xl font-semibold">Products buyers can find</h1>
            <p className="mt-2 max-w-xl text-navy-muted">
              {health.total === 0
                ? "Buyers search by what they need to buy. Add your first product and it shows in the supplier directory the moment you save."
                : health.topGap
                  ? `${health.ready} of ${health.total} ready for buyers. Biggest win: ${GAP_TEXT[health.topGap.key] ?? "Complete the details."}`
                  : "Every product has everything buyers look for. Keep prices and availability current."}
            </p>
          </div>
          <div className="flex items-center gap-6">
            <Stat label="Products" value={String(health.total)} />
            <Stat label="Ready" value={String(health.ready)} />
            <Stat label="Avg. readiness" value={String(health.average)} />
          </div>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <label className="relative min-w-56 flex-1">
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search your products"
            aria-label="Search your products"
            className="w-full rounded-md border border-input bg-white py-2.5 pl-10 pr-3.5 text-sm outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/15"
          />
        </label>
        {canEdit ? (
          <button
            onClick={() => setEditing({ draft: EMPTY_PRODUCT })}
            className="btn-shine inline-flex items-center gap-1.5 rounded-md bg-gradient-cta px-5 py-2.5 text-sm font-semibold text-white shadow-glow transition hover:scale-[1.01]"
          >
            <Plus className="size-4" aria-hidden /> Add product
          </button>
        ) : null}
      </div>

      {status === "loading" ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy>
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-56 animate-pulse rounded-2xl bg-muted" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center shadow-card">
          <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-gradient-pink text-white">
            <Package className="size-7" aria-hidden />
          </div>
          <h2 className="mt-4 text-xl font-semibold">No products yet</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Suppliers with at least 3 priced products get found far more often. Start with your best
            seller.
          </p>
          {canEdit ? (
            <button
              onClick={() => setEditing({ draft: EMPTY_PRODUCT })}
              className="mt-5 inline-flex items-center gap-1.5 rounded-md bg-gradient-cta px-5 py-2.5 text-sm font-semibold text-white"
            >
              <Plus className="size-4" aria-hidden /> Add your first product
            </button>
          ) : null}
        </div>
      ) : shown.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          No product matches “{q.trim()}”.
        </p>
      ) : (
        <>
          {health.total < 3 ? (
            <p className="tint-violet flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium">
              <Sparkles className="size-4 shrink-0" aria-hidden /> Add {3 - health.total} more to
              reach the 3 products that make a storefront look complete.
            </p>
          ) : null}
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {shown.map((p) => (
              <ProductCard
                key={p.id}
                p={p}
                canEdit={canEdit}
                onEdit={() => setEditing({ id: p.id, draft: toDraft(p) })}
                onDelete={() => setRemoving(p)}
              />
            ))}
          </ul>
        </>
      )}

      <ProductDialog
        open={editing !== null}
        initial={editing?.draft ?? EMPTY_PRODUCT}
        currency={cat?.currency ?? "INR"}
        onClose={() => setEditing(null)}
        onSave={onSave}
      />

      <AlertDialog
        open={removing !== null}
        onOpenChange={(o) => (!o ? setRemoving(null) : undefined)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this product?</AlertDialogTitle>
            <AlertDialogDescription>
              {removing?.name} will disappear from the supplier directory and your profile. This
              can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={() => void onRemove()}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <div className="text-3xl font-semibold tabular">{value}</div>
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-navy-muted">
        {label}
      </div>
    </div>
  );
}
