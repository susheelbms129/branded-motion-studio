import { Eye, Loader2, Sparkles } from "lucide-react";
import { useState, type ChangeEvent } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, SelectField, fieldClass } from "@/components/onboarding/fields";
import {
  AVAILABILITY,
  PRODUCT_UNITS,
  SERVICE_CATEGORIES,
  SERVICE_UNITS,
  SUPPLY_CATEGORIES,
} from "@/features/supplier/draft";
import { asCurrency, priceLine } from "@/features/supplier/ProductCard";
import { productReadiness, validateProduct, type ProductDraft } from "@/lib/product-quality";
import { cn } from "@/lib/utils";

type FieldProps = Parameters<typeof Field>[0];
/** Field takes an optional error string; this lets a possibly-undefined error be passed straight through. */
function Fld({ error, ...rest }: Omit<FieldProps, "error"> & { error?: string | undefined }) {
  return <Field {...rest} {...(error ? { error } : {})} />;
}

const ctaBtn =
  "btn-shine flex items-center justify-center gap-1.5 rounded-md bg-gradient-cta px-5 py-2.5 text-sm font-semibold text-white shadow-glow transition hover:scale-[1.01] disabled:opacity-60 disabled:hover:scale-100";

/**
 * Add or edit one product. Next to the form sits a live "what buyers see" card that updates as you type, with the
 * readiness score and the next thing to add. The form is checked here for friendliness and again by the database for safety.
 */
export function ProductDialog({
  open,
  initial,
  currency,
  onClose,
  onSave,
}: {
  open: boolean;
  initial: ProductDraft;
  currency: string;
  onClose: () => void;
  onSave: (p: ProductDraft) => Promise<void>;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent className="max-h-[92dvh] max-w-4xl overflow-y-auto">
        {/* keyed so every open starts from a clean copy of the product being edited */}
        <Form
          key={String(open) + initial.name}
          initial={initial}
          currency={currency}
          onSave={onSave}
          onClose={onClose}
        />
      </DialogContent>
    </Dialog>
  );
}

function Form({
  initial,
  currency,
  onSave,
  onClose,
}: {
  initial: ProductDraft;
  currency: string;
  onSave: (p: ProductDraft) => Promise<void>;
  onClose: () => void;
}) {
  const [p, setP] = useState<ProductDraft>(initial);
  const [errors, setErrors] = useState<Partial<Record<keyof ProductDraft, string>>>({});
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState("");
  const editing = initial.name !== "";
  const isService = SERVICE_CATEGORIES.includes(p.category);
  const units = isService ? SERVICE_UNITS : PRODUCT_UNITS;
  const set = (patch: Partial<ProductDraft>) => setP((x) => ({ ...x, ...patch }));
  const on = (k: keyof ProductDraft) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    set({ [k]: e.target.value });
  const r = productReadiness(p);
  const priceNum = p.price.trim() && !validateProduct(p).price ? Number(p.price) : null;
  const line = priceLine(priceNum, p.unit, currency);

  async function submit() {
    const e = validateProduct(p);
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    setBusy(true);
    setFail("");
    try {
      await onSave(p);
    } catch (err) {
      setFail(err instanceof Error ? err.message : "We couldn't save that. Please try again.");
      setBusy(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{editing ? "Edit product" : "Add a product"}</DialogTitle>
        <DialogDescription>
          Buyers see this in the supplier directory and on your profile the moment you save.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          <Fld label="Product or service name" required error={errors.name}>
            <input
              className={fieldClass}
              value={p.name}
              onChange={on("name")}
              maxLength={120}
              placeholder="e.g. OPC 53 Grade Cement, 50 kg bag"
            />
          </Fld>
          <Fld label="Category" required error={errors.category}>
            <SelectField
              label="Category"
              value={p.category}
              onChange={(v) => set({ category: v })}
              options={SUPPLY_CATEGORIES}
              invalid={!!errors.category}
            />
          </Fld>
          <Fld
            label="Description"
            error={errors.description}
            hint="Grade, size, standard, what it is used for. Two honest sentences beat a long list."
          >
            <textarea
              className={cn(fieldClass, "min-h-24 resize-y")}
              value={p.description}
              onChange={on("description")}
              maxLength={1000}
            />
          </Fld>
          <div className="grid gap-4 sm:grid-cols-3">
            <Fld label={`Price (${currency})`} error={errors.price}>
              <input
                className={fieldClass}
                inputMode="decimal"
                value={p.price}
                onChange={on("price")}
                placeholder="1500"
              />
            </Fld>
            <Fld label="Per" error={errors.unit}>
              <SelectField
                label="Unit"
                value={p.unit}
                onChange={(v) => set({ unit: v })}
                options={units}
                invalid={!!errors.unit}
              />
            </Fld>
            <Fld label="Min. order" error={errors.moq}>
              <input
                className={fieldClass}
                inputMode="decimal"
                value={p.moq}
                onChange={on("moq")}
                placeholder="100"
              />
            </Fld>
          </div>
          <Fld label="Availability" required error={errors.availability}>
            <SelectField
              label="Availability"
              value={p.availability}
              onChange={(v) => set({ availability: v })}
              options={AVAILABILITY}
              invalid={!!errors.availability}
            />
          </Fld>
        </div>

        <aside className="lg:col-span-2">
          <div className="sticky top-0 space-y-3">
            <p className="flex items-center gap-1.5 text-sm font-semibold">
              <Eye className="size-4 text-violet" aria-hidden /> What buyers see
            </p>
            <div className="rounded-xl border border-border bg-background p-4">
              <p className="truncate font-semibold">{p.name.trim() || "Your product name"}</p>
              <p className="text-xs text-muted-foreground">{p.category || "Category"}</p>
              <p
                className={cn(
                  "mt-2 line-clamp-3 text-sm",
                  p.description.trim() ? "text-foreground/75" : "italic text-muted-foreground",
                )}
              >
                {p.description.trim() || "Your description appears here."}
              </p>
              <div className="mt-3 flex items-end justify-between gap-2">
                <div>
                  {line ? (
                    <p className="text-lg font-semibold tabular">{line}</p>
                  ) : (
                    <p className="text-sm text-muted-foreground">Price not shown</p>
                  )}
                  {p.moq.trim() && !validateProduct(p).moq ? (
                    <p className="text-xs text-muted-foreground tabular">
                      Min. order {p.moq.trim()}
                    </p>
                  ) : null}
                </div>
                <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-semibold">
                  {p.availability}
                </span>
              </div>
            </div>
            <div className="rounded-xl bg-gradient-navy p-4 text-white">
              <div className="flex items-center justify-between">
                <p className="flex items-center gap-1.5 text-sm font-semibold">
                  <Sparkles className="size-4 text-magenta" aria-hidden /> Buyer-search readiness
                </p>
                <span className="text-2xl font-semibold tabular">{r.score}</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/15">
                <div
                  className="h-full rounded-full bg-gradient-cta transition-all duration-500"
                  style={{ width: `${r.score}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-navy-muted">
                {r.tips[0]
                  ? `Next: ${r.tips[0].text}`
                  : "This product has everything buyers look for."}
              </p>
            </div>
          </div>
        </aside>
      </div>
      {fail ? (
        <p role="alert" className="tint-red rounded-lg px-3 py-2 text-sm font-medium">
          {fail}
        </p>
      ) : null}
      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="rounded-md border border-input bg-white px-4 py-2 text-sm font-semibold transition hover:bg-muted/60 disabled:opacity-60"
        >
          Cancel
        </button>
        <button type="button" onClick={() => void submit()} disabled={busy} className={ctaBtn}>
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}{" "}
          {editing ? "Save changes" : "Add product"}
        </button>
      </div>
    </>
  );
}
