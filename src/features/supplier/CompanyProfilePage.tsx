import { Building2, Check, Copy, ExternalLink, EyeOff, Loader2, MessageCircle, Plus, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Field, SelectField } from "@/components/onboarding/fields";
import { fieldClass } from "@/components/onboarding/fields";
import { PageHero } from "@/components/supplier/PageHero";
import { SupplierShell, useSupplier } from "@/components/supplier/SupplierShell";
import {
  COVERAGE_OPTIONS,
  DELIVERY_OPTIONS,
  DELIVERY_TIMES,
  IMAGE_TYPES,
  PHONE_CODES,
  SUPPLY_CATEGORIES,
} from "@/features/supplier/draft";
import {
  getCompanyProfile,
  saveCompanyProfile,
  setStorefront,
  storefrontError,
  storefrontPath,
  storefrontUrl,
  storefrontWhatsappUrl,
  type CompanyProfile,
  type Place,
  type ProfileInput,
} from "@/lib/storefront-api";
import { cn } from "@/lib/utils";

const card = "rounded-2xl border border-border bg-card p-6 shadow-card";
const ctaBtn =
  "btn-shine inline-flex items-center justify-center gap-1.5 rounded-md bg-gradient-cta px-5 py-2.5 text-sm font-semibold text-white shadow-glow transition hover:scale-[1.01] disabled:opacity-60 disabled:hover:scale-100";
const outlineBtn =
  "inline-flex items-center justify-center gap-1.5 rounded-md border border-input bg-white px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-muted/60 disabled:opacity-60";

export const LOGO_LIMIT = 98_000; // the database accepts 100,000 characters for a logo that is shown publicly

export const ABOUT_PUBLIC_MIN = 100;

/** Pure: what the form still needs before it may be saved. Mirrors the database's own checks so the supplier sees the reason first. */
export type ProblemKey = "description" | "categories" | "contactName" | "email" | "phone" | "coverage" | "minOrderValue" | "locations";
export type Problems = Partial<Record<ProblemKey, string>>;

export function profileProblems(f: FormState): Problems {
  const e: Problems = {};
  if (f.description.trim().length < 50) e.description = "Write at least 50 characters about your company.";
  if (f.categories.length === 0) e.categories = "Pick at least one category.";
  if (f.contactName.trim().length < 2) e.contactName = "Add a contact name.";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim())) e.email = "That email address isn't valid.";
  if (f.phone.replace(/[^0-9]/g, "").length < 7) e.phone = "That phone number looks too short.";
  if (f.coverage.length === 0) e.coverage = "Pick where you deliver.";
  if (f.minOrderValue.trim() !== "" && !(Number(f.minOrderValue) >= 0)) e.minOrderValue = "Enter a number, zero or more.";
  if (f.locations.some((l) => l.country.trim() === "" && (l.state.trim() !== "" || l.city.trim() !== ""))) e.locations = "Each delivery area needs a country.";
  return e;
}

export interface FormState {
  tagline: string;
  description: string;
  categories: string[];
  logo: string | null;
  contactName: string;
  designation: string;
  email: string;
  phoneCode: string;
  phone: string;
  altPhone: string;
  coverage: string[];
  deliveryTime: string;
  minOrderValue: string;
  deliveryOptions: string[];
  pickup: string;
  locations: Place[];
}

export function toForm(p: CompanyProfile): FormState {
  const c = p.capabilities;
  return {
    tagline: p.profile.tagline,
    description: p.profile.description,
    categories: p.profile.categories,
    logo: p.profile.logo,
    contactName: p.profile.contact_name,
    designation: p.profile.designation,
    email: p.profile.email,
    phoneCode: p.profile.phone_code || "+91",
    phone: p.profile.phone,
    altPhone: p.profile.alt_phone,
    coverage: c?.coverage ?? [],
    deliveryTime: c?.delivery_time ?? "",
    minOrderValue: c?.min_order_value != null ? String(c.min_order_value) : "",
    deliveryOptions: c?.delivery_options ?? [],
    pickup: c?.pickup ?? "",
    locations: p.locations,
  };
}

export function toInput(f: FormState): ProfileInput {
  return {
    tagline: f.tagline.trim(),
    description: f.description.trim(),
    categories: f.categories,
    logo: f.logo,
    contactName: f.contactName.trim(),
    designation: f.designation.trim(),
    email: f.email.trim(),
    phoneCode: f.phoneCode,
    phone: f.phone.trim(),
    altPhone: f.altPhone.trim(),
    coverage: f.coverage,
    deliveryTime: f.deliveryTime,
    minOrderValue: f.minOrderValue.trim() === "" ? null : Number(f.minOrderValue),
    deliveryOptions: f.deliveryOptions,
    pickup: f.pickup,
    locations: f.locations.filter((l) => l.country.trim() !== "").map((l) => ({ country: l.country.trim(), state: l.state.trim(), city: l.city.trim() })),
  };
}

/** Shrinks a logo until it fits what a public page may carry. */
async function compressLogo(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => bad(new Error("That image couldn't be read."));
      i.src = url;
    });
    for (const px of [400, 300, 220, 160]) {
      const scale = Math.min(1, px / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(img.width * scale));
      c.height = Math.max(1, Math.round(img.height * scale));
      const ctx = c.getContext("2d");
      if (!ctx) throw new Error("That image couldn't be read.");
      if (file.type === "image/png") {
        ctx.drawImage(img, 0, 0, c.width, c.height);
        const png = c.toDataURL("image/png");
        if (png.length <= LOGO_LIMIT) return png;
      }
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      for (const q of [0.85, 0.7, 0.55]) {
        const jpg = c.toDataURL("image/jpeg", q);
        if (jpg.length <= LOGO_LIMIT) return jpg;
      }
    }
    throw new Error("That logo is too detailed to shrink. Try a simpler image.");
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function CompanyProfilePage() {
  return (
    <SupplierShell>
      <ProfileContent />
    </SupplierShell>
  );
}

function ProfileContent() {
  const { status, summary, reload: reloadShell } = useSupplier();
  const orgId = summary?.id ?? null;
  const [p, setP] = useState<CompanyProfile | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [saved, setSaved] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  const load = useCallback(async (id: string) => {
    const d = await getCompanyProfile(id);
    setP(d);
    const f = toForm(d);
    setForm(f);
    setSaved(JSON.stringify(f));
  }, []);

  useEffect(() => {
    if (status === "loading") return;
    if (!orgId) {
      setError("We couldn't find your supplier workspace.");
      setLoading(false);
      return;
    }
    let live = true;
    (async () => {
      try {
        await load(orgId);
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : storefrontError(e));
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [status, orgId, load]);

  const dirty = form !== null && JSON.stringify(form) !== saved;
  const problems = useMemo(() => (form ? profileProblems(form) : {}), [form]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  async function save() {
    if (!orgId || !form || saving) return;
    setShowErrors(true);
    if (Object.keys(problems).length > 0) {
      toast.error("Please fix the highlighted fields.");
      return;
    }
    setSaving(true);
    try {
      await saveCompanyProfile(orgId, toInput(form));
      await load(orgId);
      setShowErrors(false);
      toast.success("Company profile saved.");
      reloadShell();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : storefrontError(e));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
        <Loader2 className="size-4 animate-spin" aria-hidden /> Loading your company profile…
      </p>
    );
  }
  if (error || !p || !form) {
    return (
      <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        {error || "We couldn't load your company profile."}
      </p>
    );
  }

  const ro = !p.can_edit;
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const err = (k: ProblemKey): string => (showErrors ? (problems[k] ?? "") : "");
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <PageHero label="Company profile" icon={Building2} title="How buyers see your company" glow="glow-blue">
          This is what buyers read before they send you a request. Keep it honest and specific; buyers compare.
        </PageHero>
        {ro ? <p className="mt-2 rounded-lg bg-muted px-3 py-2 text-sm">You can view this page. Only the owner or a procurement manager can change it.</p> : null}
      </header>

      <StorefrontPanel orgId={orgId!} p={p} dirty={dirty} onChanged={() => load(orgId!)} />

      <section className={card}>
        <h2 className="text-base font-semibold">Your pitch</h2>
        <div className="mt-4 space-y-4">
          <Field label="Headline" hint={`${form.tagline.length}/120. One line a buyer remembers, for example "Food-grade packaging, delivered in 3 days".`}>
            <input className={fieldClass} maxLength={120} disabled={ro} value={form.tagline} onChange={(e) => set("tagline", e.target.value)} />
          </Field>
          <Field
            label="About your company"
            required
            error={err("description")}
            hint={`${form.description.trim().length}/2000. Your storefront needs at least ${ABOUT_PUBLIC_MIN} characters to appear on Google.`}
          >
            <textarea className={cn(fieldClass, "min-h-32")} maxLength={2000} disabled={ro} value={form.description} onChange={(e) => set("description", e.target.value)} />
          </Field>
          <Field label="Categories" required error={err("categories")} hint="These decide which buyer searches you appear in.">
            <ChipPicker options={SUPPLY_CATEGORIES} value={form.categories} disabled={ro} onToggle={(v) => set("categories", toggle(form.categories, v))} />
          </Field>
          <LogoField value={form.logo} disabled={ro} onChange={(v) => set("logo", v)} />
        </div>
      </section>

      <section className={card}>
        <h2 className="text-base font-semibold">Contact person</h2>
        <p className="mt-1 text-xs text-muted-foreground">Shown to buyers who are signed in. Never shown on your public storefront.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Name" required error={err("contactName")}>
            <input className={fieldClass} maxLength={120} disabled={ro} value={form.contactName} onChange={(e) => set("contactName", e.target.value)} />
          </Field>
          <Field label="Designation">
            <input className={fieldClass} maxLength={80} disabled={ro} value={form.designation} onChange={(e) => set("designation", e.target.value)} />
          </Field>
          <Field label="Email" required error={err("email")}>
            <input type="email" className={fieldClass} maxLength={254} disabled={ro} value={form.email} onChange={(e) => set("email", e.target.value)} />
          </Field>
          <div className="grid grid-cols-[6rem_1fr] gap-2">
            <Field label="Code" required>
              <SelectField label="Phone code" value={form.phoneCode} disabled={ro} options={PHONE_CODES} onChange={(v) => set("phoneCode", v)} />
            </Field>
            <Field label="Phone" required error={err("phone")}>
              <input inputMode="tel" className={fieldClass} maxLength={20} disabled={ro} value={form.phone} onChange={(e) => set("phone", e.target.value)} />
            </Field>
          </div>
          <Field label="Alternate phone">
            <input inputMode="tel" className={fieldClass} maxLength={20} disabled={ro} value={form.altPhone} onChange={(e) => set("altPhone", e.target.value)} />
          </Field>
        </div>
      </section>

      <section className={card}>
        <h2 className="text-base font-semibold">Delivery terms</h2>
        <p className="mt-1 text-xs text-muted-foreground">Answers the first questions every buyer asks, so they don't have to message you.</p>
        <div className="mt-4 space-y-4">
          <Field label="Where do you deliver?" required error={err("coverage")}>
            <ChipPicker options={COVERAGE_OPTIONS} value={form.coverage} disabled={ro} onToggle={(v) => set("coverage", toggle(form.coverage, v))} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Usual delivery time">
              <SelectField label="Usual delivery time" value={form.deliveryTime} disabled={ro} options={DELIVERY_TIMES} onChange={(v) => set("deliveryTime", v)} />
            </Field>
            <Field label="Minimum order value (₹)" error={err("minOrderValue")}>
              <input inputMode="decimal" className={fieldClass} disabled={ro} value={form.minOrderValue} onChange={(e) => set("minOrderValue", e.target.value.replace(/[^0-9.]/g, ""))} />
            </Field>
          </div>
          <Field label="How do you deliver?">
            <ChipPicker options={DELIVERY_OPTIONS} value={form.deliveryOptions} disabled={ro} onToggle={(v) => set("deliveryOptions", toggle(form.deliveryOptions, v))} />
          </Field>
          <Field label="Can buyers collect from you?">
            <SelectField label="Pickup" value={form.pickup} disabled={ro} options={["Yes", "No"]} onChange={(v) => set("pickup", v)} />
          </Field>
          <LocationsEditor value={form.locations} disabled={ro} error={err("locations")} onChange={(v) => set("locations", v)} />
        </div>
      </section>

      {!ro ? (
        <div className="sticky bottom-3 z-10 flex items-center justify-between gap-3 rounded-2xl border border-border bg-card/95 p-3 shadow-card backdrop-blur">
          <p className="text-sm text-muted-foreground" role="status">
            {dirty ? "You have unsaved changes." : "All changes saved."}
          </p>
          <button type="button" className={ctaBtn} disabled={saving || !dirty} onClick={() => void save()}>
            {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null} Save changes
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ChipPicker({ options, value, onToggle, disabled }: { options: readonly string[]; value: string[]; onToggle: (v: string) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = value.includes(o);
        return (
          <button
            key={o}
            type="button"
            disabled={disabled}
            aria-pressed={on}
            onClick={() => onToggle(o)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs font-medium transition disabled:opacity-60",
              on ? "border-primary bg-primary/10 text-primary" : "border-input bg-white hover:bg-muted/60",
            )}
          >
            {on ? <Check className="mr-1 inline size-3" aria-hidden /> : null}
            {o}
          </button>
        );
      })}
    </div>
  );
}

function LogoField({ value, onChange, disabled }: { value: string | null; onChange: (v: string | null) => void; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  async function pick(file: File | undefined) {
    if (!file) return;
    if (!IMAGE_TYPES.includes(file.type)) {
      toast.error("Use a JPG, PNG or WebP image.");
      return;
    }
    setBusy(true);
    try {
      onChange(await compressLogo(file));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That image couldn't be used.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }
  return (
    <Field label="Logo" hint="A logo makes your card the one buyers recognise. It is shown on your storefront and in Google previews.">
      <div className="flex items-center gap-3">
        {value ? (
          <img src={value} alt="Your logo" className="size-16 rounded-xl border border-border bg-white object-contain" />
        ) : (
          <span className="grid size-16 place-items-center rounded-xl bg-muted text-xs text-muted-foreground">No logo</span>
        )}
        <input ref={input} type="file" accept={IMAGE_TYPES.join(",")} className="sr-only" aria-label="Upload logo" disabled={disabled || busy} onChange={(e) => void pick(e.target.files?.[0])} />
        <button type="button" className={outlineBtn} disabled={disabled || busy} onClick={() => input.current?.click()}>
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Upload className="size-4" aria-hidden />} {value ? "Change" : "Upload"}
        </button>
        {value && !disabled ? (
          <button type="button" className={outlineBtn} onClick={() => onChange(null)}>
            Remove
          </button>
        ) : null}
      </div>
    </Field>
  );
}

function LocationsEditor({ value, onChange, disabled, error }: { value: Place[]; onChange: (v: Place[]) => void; disabled?: boolean; error: string }) {
  const upd = (i: number, k: keyof Place, v: string) => onChange(value.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  return (
    <Field label="Cities and states you serve" error={error} hint="Buyers outside your delivery area never see you. Buyers inside it see you sooner.">
      <div className="space-y-2">
        {value.map((l, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2">
            <input aria-label="Country" placeholder="Country" className={fieldClass} maxLength={80} disabled={disabled} value={l.country} onChange={(e) => upd(i, "country", e.target.value)} />
            <input aria-label="State" placeholder="State" className={fieldClass} maxLength={80} disabled={disabled} value={l.state} onChange={(e) => upd(i, "state", e.target.value)} />
            <input aria-label="City" placeholder="City" className={fieldClass} maxLength={80} disabled={disabled} value={l.city} onChange={(e) => upd(i, "city", e.target.value)} />
            {!disabled ? (
              <button type="button" aria-label="Remove this area" className={outlineBtn} onClick={() => onChange(value.filter((_, j) => j !== i))}>
                <Trash2 className="size-4" aria-hidden />
              </button>
            ) : null}
          </div>
        ))}
        {!disabled && value.length < 100 ? (
          <button type="button" className={outlineBtn} onClick={() => onChange([...value, { country: "India", state: "", city: "" }])}>
            <Plus className="size-4" aria-hidden /> Add an area
          </button>
        ) : null}
      </div>
    </Field>
  );
}

// ───────── the storefront switch and how it performs ─────────
const MISSING_TEXT: Record<string, string> = {
  verified: "Get your GST registration verified (and keep your proofs current)",
  about: `Write an "About" of at least ${ABOUT_PUBLIC_MIN} characters and save it`,
  categories: "Pick at least one category and save it",
};

function StorefrontPanel({ orgId, p, dirty, onChanged }: { orgId: string; p: CompanyProfile; dirty: boolean; onChanged: () => Promise<void> }) {
  const s = p.storefront;
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const url = storefrontUrl(origin, p.slug);
  const series = s.series ?? [];
  const max = Math.max(1, ...series.map((d) => d.views));

  async function run(enabled: boolean, prices: boolean | null, ok: string) {
    setBusy(true);
    try {
      await setStorefront(orgId, enabled, prices);
      await onChanged();
      toast.success(ok);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : storefrontError(e));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Couldn't copy. Select the link and copy it.");
    }
  }

  return (
    <section className={card} aria-label="Public storefront">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Your public storefront</h2>
          <p className="mt-1 text-sm text-muted-foreground">A page anyone can open and Google can find, with your live Trust Passport on it. It is never an old screenshot.</p>
        </div>
        <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", s.live ? "bg-emerald-500/10 text-emerald-700" : "bg-muted text-muted-foreground")}>
          {s.live ? "Live" : s.enabled ? "On, but not visible" : "Off"}
        </span>
      </div>

      {s.enabled && !s.live ? (
        <p role="status" className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
          Your storefront is switched on but hidden from buyers and Google right now, because a requirement below is no longer met. It comes back by itself once it is.
        </p>
      ) : null}

      {!s.ready.required_ok ? (
        <div className="mt-3">
          <p className="text-sm font-medium">To go live you need:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
            {s.ready.missing.map((m) => (
              <li key={m}>{MISSING_TEXT[m] ?? m}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {s.live ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-3 py-2 text-xs">{url}</code>
          <button type="button" className={outlineBtn} onClick={() => void copy()}>
            {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />} {copied ? "Copied" : "Copy"}
          </button>
          <a className={outlineBtn} href={storefrontPath(p.slug)} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="size-4" aria-hidden /> Open
          </a>
          <a className={outlineBtn} href={storefrontWhatsappUrl(origin, p.slug, p.name)} target="_blank" rel="noopener noreferrer">
            <MessageCircle className="size-4" aria-hidden /> WhatsApp
          </a>
        </div>
      ) : null}

      {p.can_publish ? (
        <div className="mt-4 flex flex-wrap items-center gap-4">
          {s.enabled ? (
            <button type="button" className={outlineBtn} disabled={busy} onClick={() => void run(false, null, "Storefront hidden.")}>
              <EyeOff className="size-4" aria-hidden /> Hide storefront
            </button>
          ) : (
            <button
              type="button"
              className={ctaBtn}
              disabled={busy || !s.ready.required_ok || dirty}
              onClick={() => void run(true, null, "Your storefront is live.")}
            >
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null} Publish storefront
            </button>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4" checked={s.show_prices} disabled={busy} onChange={(e) => void run(s.enabled, e.target.checked, e.target.checked ? "Prices are now shown." : "Prices are now hidden.")} />
            Show my product prices publicly
          </label>
          {dirty && !s.enabled ? <p className="text-xs text-muted-foreground">Save your changes first, then publish.</p> : null}
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">Only the company owner can publish or hide the storefront.</p>
      )}

      {s.live || s.views_30 > 0 ? (
        <div className="mt-5 border-t border-border pt-4">
          <p className="text-sm font-medium">Last 30 days</p>
          <p className="mt-1 text-sm text-muted-foreground">
            <strong className="text-foreground">{s.views_30}</strong> visits · <strong className="text-foreground">{s.quote_clicks_30}</strong> "Request a quote" clicks. Counts only; no visitor is identified.
          </p>
          <div className="mt-3 flex h-16 items-end gap-1" role="img" aria-label="Visits in the last 14 days">
            {series.map((d) => (
              <span
                key={d.day}
                title={`${d.day}: ${d.views} visits, ${d.quote_clicks} quote clicks`}
                className="flex-1 rounded-t bg-primary/60"
                style={{ height: `${Math.max(4, (d.views / max) * 100)}%` }}
              />
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
