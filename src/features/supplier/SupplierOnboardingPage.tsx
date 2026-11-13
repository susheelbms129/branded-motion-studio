import { useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowRight,
  Briefcase,
  Building2,
  ClipboardCheck,
  Clock,
  Cog,
  Cpu,
  Ellipsis,
  Factory,
  FlaskConical,
  HardHat,
  HeartPulse,
  ImagePlus,
  Inbox,
  Layers,
  Package,
  Paperclip,
  Pencil,
  Plus,
  Rocket,
  ShieldAlert,
  Store,
  Trash2,
  Truck,
  UserRound,
  Users,
  UtensilsCrossed,
  Wheat,
  X,
  Zap,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Field, OptionCard, SearchSelect, SectionTitle, SelectField, fieldClass } from "@/components/onboarding/fields";
import { OnboardingShell, type OnboardingStep } from "@/components/onboarding/OnboardingShell";
import { COUNTRIES, CURRENCY_BY_COUNTRY, INDIA_CITIES, INDIA_STATES } from "@/features/buyer/locations";
import { useUi } from "@/lib/ui-store";
import { cn } from "@/lib/utils";

import {
  AVAILABILITY,
  BUSINESS_TYPES,
  COMPANY_SIZES,
  COVERAGE_OPTIONS,
  DELIVERY_OPTIONS,
  DELIVERY_TIMES,
  EMPTY_DRAFT,
  IMAGE_TYPES,
  INDUSTRIES,
  MFG_CAPABILITIES,
  PHONE_CODES,
  PRODUCT_UNITS,
  SERVICE_CATEGORIES,
  SERVICE_COVERAGE,
  SERVICE_TYPES,
  SERVICE_UNITS,
  SUPPLY_CATEGORIES,
  capabilityGroup,
  establishedYears,
  imageToDataUrl,
  loadDraft,
  newOffering,
  saveDraft,
  websiteError,
  type Offering,
  type SupplierDraft,
} from "./draft";

const STEPS: OnboardingStep[] = [
  { title: "Getting started", description: "Welcome to Vendora", icon: Rocket },
  { title: "Business information", description: "Tell us about your company", icon: Building2 },
  { title: "Supplier profile", description: "Your business identity and contact details", icon: UserRound },
  { title: "Products & services", description: "What you offer to buyers", icon: Package },
  { title: "Supply capabilities", description: "Delivery locations and business capabilities", icon: Truck },
  { title: "Review & launch", description: "Review your profile and launch your workspace", icon: ClipboardCheck },
];

const CATEGORY_ICONS: Record<(typeof SUPPLY_CATEGORIES)[number], LucideIcon> = {
  "Raw Materials": Layers,
  "Industrial Machinery": Cog,
  "Electrical Equipment": Zap,
  "Packaging Materials": Package,
  Chemicals: FlaskConical,
  "Construction Materials": HardHat,
  Electronics: Cpu,
  "Office Supplies": Paperclip,
  "Logistics & Transport": Truck,
  "Professional Services": Briefcase,
  Agriculture: Wheat,
  "Food & Beverage": UtensilsCrossed,
  Healthcare: HeartPulse,
  Other: Ellipsis,
};

type Errors = Record<string, string>;
type YesNoValue = "" | "Yes" | "No";

const toggle = <T extends string>(list: T[], item: T): T[] => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

const outlineBtn =
  "flex items-center gap-1.5 rounded-md border border-input bg-white px-4 py-2.5 text-sm font-semibold text-foreground transition hover:bg-muted/60 disabled:opacity-60";
const ctaBtn =
  "btn-shine group flex items-center justify-center gap-1.5 rounded-md bg-gradient-cta px-5 py-2.5 text-sm font-semibold text-white shadow-glow transition hover:scale-[1.01] disabled:opacity-60 disabled:hover:scale-100";
const linkBtn = "rounded-md px-3 py-2 text-sm font-semibold text-muted-foreground transition hover:text-foreground disabled:opacity-60";
const textareaClass = cn(fieldClass, "min-h-28 resize-y leading-relaxed");

const MIN_DESCRIPTION = 50;
const MAX_DESCRIPTION = 500;

function businessErrors(d: SupplierDraft): Errors {
  const e: Errors = {};
  if (d.name.trim().length < 2) e.name = "Enter your business name";
  if (!d.businessType) e.businessType = "Select your business type";
  if (!d.industry) e.industry = "Select your industry";
  if (!d.country) e.country = "Select your country";
  if (!d.state.trim()) e.state = "Select your state";
  if (!d.city.trim()) e.city = "Select your city";
  const w = websiteError(d.website);
  if (w) e.website = w;
  return e;
}

function profileErrors(d: SupplierDraft): Errors {
  const e: Errors = {};
  if (d.description.trim().length < MIN_DESCRIPTION) e.description = `Add at least ${MIN_DESCRIPTION} characters so buyers know who you are`;
  if (d.contactName.trim().length < 2) e.contactName = "Enter the contact person's name";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email.trim())) e.email = "Enter a valid business email";
  if (d.phone.replace(/\D/g, "").length < 7) e.phone = "Enter a valid phone number";
  return e;
}

/** An extra offering that's still empty is ignored; the first one is always required. */
function isTouched(o: Offering) {
  return !!(o.name.trim() || o.description.trim());
}

function offeringErrors(o: Offering): Errors {
  const e: Errors = {};
  if (o.name.trim().length < 2) e.name = "Enter a name";
  if (!o.category) e.category = "Select a category";
  if (o.description.trim().length < 10) e.description = "Add a short description";
  if (!o.availability) e.availability = "Select availability";
  if (!SERVICE_CATEGORIES.includes(o.category) && !o.unit) e.unit = "Select a unit";
  return e;
}

function productErrors(d: SupplierDraft): { categories?: string; offerings: Record<string, Errors> } {
  const out: { categories?: string; offerings: Record<string, Errors> } = { offerings: {} };
  if (d.categories.length === 0) out.categories = "Pick at least one category";
  d.offerings.forEach((o, i) => {
    if (i === 0 || isTouched(o)) {
      const e = offeringErrors(o);
      if (Object.keys(e).length) out.offerings[o.id] = e;
    }
  });
  return out;
}

function supplyErrors(d: SupplierDraft): Errors {
  const e: Errors = {};
  if (d.coverage.length === 0) e.coverage = "Pick at least one option";
  const g = capabilityGroup(d.businessType);
  if (g === "manufacturer" && !d.inHouse) e.inHouse = "Please answer this";
  if (g === "service") {
    if (d.servicesOffered.length === 0) e.servicesOffered = "Pick at least one service";
    if (!d.serviceCoverage) e.serviceCoverage = "Select your service coverage";
  }
  return e;
}

export function SupplierOnboardingPage() {
  const nav = useNavigate();
  const { user } = useUi();

  const [d, setD] = useState<SupplierDraft>(() => {
    const saved = loadDraft();
    const base = saved ?? { ...EMPTY_DRAFT, name: user?.company ?? "" };
    return { ...base, email: base.email || user?.email || "", offerings: base.offerings.length ? base.offerings : [newOffering()] };
  });
  const [step, setStep] = useState(() => d.step);
  const [tried, setTried] = useState(false);
  const [loc, setLoc] = useState({ country: "India", state: "", city: "" });

  // Answers are remembered in this browser, so closing the tab or choosing "Save and finish later" loses nothing.
  useEffect(() => {
    saveDraft({ ...d, step });
  }, [d, step]);

  const set = <K extends keyof SupplierDraft>(k: K, v: SupplierDraft[K]) => setD((x) => ({ ...x, [k]: v }));
  const go = (i: number) => {
    setTried(false);
    setStep(i);
  };

  const validate = () => {
    if (step === 1) return Object.keys(businessErrors(d)).length === 0;
    if (step === 2) return Object.keys(profileErrors(d)).length === 0;
    if (step === 3) {
      const p = productErrors(d);
      return !p.categories && Object.keys(p.offerings).length === 0;
    }
    if (step === 4) return Object.keys(supplyErrors(d)).length === 0;
    return true;
  };
  const next = () => {
    if (!validate()) {
      setTried(true);
      return;
    }
    go(step + 1);
  };

  const onCountry = (country: string) => setD((x) => ({ ...x, country, state: "", city: "" }));

  const launch = () => {
    saveDraft({ ...d, step: 5 });
    void nav({ to: "/supplier/dashboard" });
  };
  const saveForLater = () => {
    saveDraft({ ...d, step });
    void nav({ to: "/" });
  };

  const be = tried && step === 1 ? businessErrors(d) : {};
  const pe = tried && step === 2 ? profileErrors(d) : {};
  const prod = tried && step === 3 ? productErrors(d) : { categories: undefined, offerings: {} as Record<string, Errors> };
  const se = tried && step === 4 ? supplyErrors(d) : {};

  const stateOptions = d.country === "India" ? INDIA_STATES : [];
  const cityOptions = d.country === "India" ? (INDIA_CITIES[d.state] ?? []) : [];
  const currency = CURRENCY_BY_COUNTRY[d.country] ?? "USD";
  const group = capabilityGroup(d.businessType);

  const setOffering = (id: string, patch: Partial<Offering>) => setD((x) => ({ ...x, offerings: x.offerings.map((o) => (o.id === id ? { ...o, ...patch } : o)) }));
  const toggleCategory = (c: string) =>
    setD((x) => {
      const on = x.categories.includes(c);
      return {
        ...x,
        categories: on ? x.categories.filter((v) => v !== c) : [...x.categories, c],
        // An offering can't keep a category the supplier has just removed.
        offerings: on ? x.offerings.map((o) => (o.category === c ? { ...o, category: "", unit: "" } : o)) : x.offerings,
      };
    });

  const needsLocations = d.coverage.includes("Across India") || d.coverage.includes("Internationally");
  const locStates = loc.country === "India" ? INDIA_STATES : [];
  const locCities = loc.country === "India" ? (INDIA_CITIES[loc.state] ?? []) : [];
  const addLocation = () => {
    if (!loc.country) return;
    const entry = { country: loc.country, state: loc.state.trim(), city: loc.city.trim() };
    const exists = d.locations.some((l) => l.country === entry.country && l.state === entry.state && l.city === entry.city);
    if (!exists) set("locations", [...d.locations, entry]);
    setLoc((x) => ({ ...x, state: "", city: "" }));
  };

  const footer =
    step === 0 ? (
      <>
        <span />
        <button type="button" className={ctaBtn} onClick={() => go(1)}>
          Set up my supplier account
          <ArrowRight className="size-4 transition group-hover:translate-x-1" />
        </button>
      </>
    ) : step < 5 ? (
      <>
        <button type="button" className={outlineBtn} onClick={() => go(step - 1)}>
          <ArrowLeft className="size-4" /> Previous
        </button>
        <div className="flex items-center gap-2">
          <button type="button" className={linkBtn} onClick={saveForLater}>
            Save and finish later
          </button>
          <button type="button" className={ctaBtn} onClick={next}>
            Continue
            <ArrowRight className="size-4 transition group-hover:translate-x-1" />
          </button>
        </div>
      </>
    ) : (
      <>
        <button type="button" className={outlineBtn} onClick={() => go(4)}>
          <ArrowLeft className="size-4" /> Previous
        </button>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button type="button" className={linkBtn} onClick={saveForLater}>
            Save and finish later
          </button>
          <button type="button" className={ctaBtn} onClick={launch}>
            Launch Supplier Workspace
            <ArrowRight className="size-4 transition group-hover:translate-x-1" />
          </button>
        </div>
      </>
    );

  const listedOfferings = d.offerings.filter((o) => o.name.trim());

  return (
    <OnboardingShell
      steps={STEPS}
      current={step}
      onSelect={go}
      heading="Supplier onboarding"
      stepLabel={step > 0 ? `Step ${String(step).padStart(2, "0")} of 05` : undefined}
      footer={footer}
    >
      {step === 0 ? <Welcome /> : null}

      {/* Step 1: business information */}
      {step === 1 ? (
        <>
          <h1 className="text-2xl font-semibold text-foreground">Tell us about your business.</h1>
          <p className="mt-1 text-sm text-muted-foreground">Let's start with some basic information about your company.</p>
          <p className="mt-3 rounded-md bg-primary/5 px-3.5 py-2.5 text-sm text-foreground">
            Joining a supplier team? Use the invitation link your owner sent instead of creating a new business here.
          </p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label="Company / business name" required error={be.name}>
                <input className={cn(fieldClass, be.name && "border-destructive")} value={d.name} onChange={(e) => set("name", e.target.value)} autoComplete="organization" aria-label="Company name" />
              </Field>
            </div>
            <Field label="Business type" required error={be.businessType}>
              <SelectField label="Business type" value={d.businessType} onChange={(v) => set("businessType", v)} options={BUSINESS_TYPES} invalid={!!be.businessType} />
            </Field>
            <Field label="Industry" required error={be.industry}>
              <SelectField label="Industry" value={d.industry} onChange={(v) => set("industry", v)} options={INDUSTRIES} invalid={!!be.industry} />
            </Field>
            <Field label="Country" required error={be.country}>
              <SelectField label="Country" value={d.country} onChange={onCountry} options={COUNTRIES} invalid={!!be.country} />
            </Field>
            <Field label="State" required error={be.state}>
              {d.country === "India" ? (
                <SelectField label="State" value={d.state} onChange={(v) => setD((x) => ({ ...x, state: v, city: "" }))} options={stateOptions} invalid={!!be.state} />
              ) : (
                <SearchSelect label="State" value={d.state} onChange={(v) => setD((x) => ({ ...x, state: v, city: "" }))} options={stateOptions} allowCustom placeholder="State or region" invalid={!!be.state} disabled={!d.country} />
              )}
            </Field>
            <Field label="City" required error={be.city}>
              <SearchSelect label="City" value={d.city} onChange={(v) => set("city", v)} options={cityOptions} allowCustom placeholder={d.state ? "Search your city" : "Select a state first"} invalid={!!be.city} disabled={!d.state} />
            </Field>
            <Field label="Company website" error={be.website}>
              <input className={cn(fieldClass, be.website && "border-destructive")} type="url" inputMode="url" placeholder="www.example.com" value={d.website} onChange={(e) => set("website", e.target.value)} autoComplete="url" aria-label="Company website" />
            </Field>
            <Field label="Company size">
              <SelectField label="Company size" value={d.companySize} onChange={(v) => set("companySize", v)} options={COMPANY_SIZES} />
            </Field>
            <Field label="Year established">
              <SelectField label="Year established" value={d.yearEstablished} onChange={(v) => set("yearEstablished", v)} options={establishedYears()} />
            </Field>
          </div>
        </>
      ) : null}

      {/* Step 2: supplier profile */}
      {step === 2 ? (
        <>
          <h1 className="text-2xl font-semibold text-foreground">Let's build your supplier profile.</h1>
          <p className="mt-1 text-sm text-muted-foreground">Give buyers a better understanding of your business and who they are working with.</p>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label="Company description" required error={pe.description} hint={`Suggested ${MIN_DESCRIPTION}–${MAX_DESCRIPTION} characters.`}>
                <textarea
                  className={cn(textareaClass, "min-h-36", pe.description && "border-destructive")}
                  value={d.description}
                  maxLength={MAX_DESCRIPTION}
                  onChange={(e) => set("description", e.target.value)}
                  placeholder="Tell buyers about your business, your expertise, the products or services you provide, and what makes your company a reliable supplier."
                  aria-label="Company description"
                />
              </Field>
              <p className={cn("mt-1 text-right text-xs", d.description.trim().length >= MIN_DESCRIPTION ? "text-muted-foreground" : "text-subtle-foreground")}>
                {d.description.length} / {MAX_DESCRIPTION}
              </p>
            </div>

            <div className="sm:col-span-2">
              <Field label="Company logo" hint="JPG, PNG or WebP, up to 2 MB.">
                <ImagePicker images={d.logo ? [d.logo] : []} max={1} maxPx={360} onChange={(imgs) => set("logo", imgs[0] ?? "")} label="logo" />
              </Field>
            </div>

            <Field label="Contact person's full name" required error={pe.contactName}>
              <input className={cn(fieldClass, pe.contactName && "border-destructive")} value={d.contactName} onChange={(e) => set("contactName", e.target.value)} autoComplete="name" aria-label="Contact person's full name" />
            </Field>
            <Field label="Designation / job title">
              <input className={fieldClass} value={d.designation} onChange={(e) => set("designation", e.target.value)} autoComplete="organization-title" aria-label="Designation" />
            </Field>
            <div className="sm:col-span-2">
              <Field
                label="Business contact email"
                required
                error={pe.email}
                hint={d.email.trim() && d.email.trim() !== (user?.email ?? "") ? "You changed this email, so we'll ask you to verify it before it's shown to buyers as verified." : "Pre-filled from your sign-up email. You can change it."}
              >
                <input className={cn(fieldClass, pe.email && "border-destructive")} type="email" value={d.email} onChange={(e) => set("email", e.target.value)} autoComplete="email" aria-label="Business contact email" />
              </Field>
            </div>
            <Field label="Business phone number" required error={pe.phone}>
              <PhoneInput code={d.phoneCode} value={d.phone} onCode={(v) => set("phoneCode", v)} onValue={(v) => set("phone", v)} invalid={!!pe.phone} label="Business phone number" />
            </Field>
            <Field label="Alternate contact number">
              <PhoneInput code={d.phoneCode} value={d.altPhone} onCode={(v) => set("phoneCode", v)} onValue={(v) => set("altPhone", v)} label="Alternate contact number" />
            </Field>
          </div>
        </>
      ) : null}

      {/* Step 3: products & services */}
      {step === 3 ? (
        <>
          <h1 className="text-2xl font-semibold text-foreground">What do you offer to buyers?</h1>
          <p className="mt-1 text-sm text-muted-foreground">Add the products or services your business supplies so buyers can find relevant offerings.</p>

          <div className="mt-6">
            <SectionTitle hint="Select all that apply.">Which categories best describe what your business supplies?</SectionTitle>
            <div role="group" aria-label="Supply categories" className="grid grid-cols-2 gap-2.5 lg:grid-cols-3">
              {SUPPLY_CATEGORIES.map((c) => (
                <OptionCard key={c} multi icon={CATEGORY_ICONS[c]} title={c} selected={d.categories.includes(c)} onClick={() => toggleCategory(c)} />
              ))}
            </div>
            {prod.categories ? (
              <p role="alert" className="mt-2 text-xs text-destructive">
                {prod.categories}
              </p>
            ) : null}
          </div>

          <div className="mt-8">
            <SectionTitle hint="Start with one. You can add your full catalogue after onboarding.">Add your first product or service</SectionTitle>
            <div className="space-y-4">
              {d.offerings.map((o, i) => {
                const oe = prod.offerings[o.id] ?? {};
                const isService = SERVICE_CATEGORIES.includes(o.category);
                return (
                  <div key={o.id} className="rounded-lg border border-border bg-white/80 p-4 shadow-card sm:p-5">
                    <div className="mb-3 flex items-center justify-between">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Offering {i + 1}</p>
                      {d.offerings.length > 1 ? (
                        <button type="button" onClick={() => set("offerings", d.offerings.filter((x) => x.id !== o.id))} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive">
                          <Trash2 className="size-3.5" /> Remove
                        </button>
                      ) : null}
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="sm:col-span-2">
                        <Field label="Product / service name" required error={oe.name}>
                          <input className={cn(fieldClass, oe.name && "border-destructive")} value={o.name} onChange={(e) => setOffering(o.id, { name: e.target.value })} aria-label="Product or service name" />
                        </Field>
                      </div>
                      <Field label="Category" required error={oe.category} hint={d.categories.length === 0 ? "Pick a category above first." : undefined}>
                        <SelectField label="Category" value={o.category} onChange={(v) => setOffering(o.id, { category: v, unit: "" })} options={d.categories} invalid={!!oe.category} disabled={d.categories.length === 0} />
                      </Field>
                      <Field label="Availability" required error={oe.availability}>
                        <SelectField label="Availability" value={o.availability} onChange={(v) => setOffering(o.id, { availability: v })} options={AVAILABILITY} invalid={!!oe.availability} />
                      </Field>
                      <div className="sm:col-span-2">
                        <Field label="Description" required error={oe.description}>
                          <textarea className={cn(textareaClass, oe.description && "border-destructive")} value={o.description} onChange={(e) => setOffering(o.id, { description: e.target.value })} aria-label="Description" />
                        </Field>
                      </div>
                      <div className="sm:col-span-2">
                        <Field label="Product images" hint="Up to 4 images. JPG, PNG or WebP.">
                          <ImagePicker images={o.images} max={4} maxPx={520} onChange={(imgs) => setOffering(o.id, { images: imgs })} label="product image" />
                        </Field>
                      </div>
                      <Field label="Unit of measurement" required={!isService} error={oe.unit}>
                        <SelectField label="Unit of measurement" value={o.unit} onChange={(v) => setOffering(o.id, { unit: v })} options={isService ? SERVICE_UNITS : PRODUCT_UNITS} invalid={!!oe.unit} />
                      </Field>
                      <Field label="Minimum order quantity (MOQ)">
                        <input className={fieldClass} type="number" min={0} inputMode="numeric" value={o.moq} onChange={(e) => setOffering(o.id, { moq: e.target.value })} aria-label="Minimum order quantity" />
                      </Field>
                      <Field label="Indicative price" hint="A starting price is enough. Detailed pricing is agreed with buyers.">
                        <MoneyInput currency={currency} value={o.price} onChange={(v) => setOffering(o.id, { price: v })} label="Indicative price" />
                      </Field>
                    </div>
                  </div>
                );
              })}
            </div>
            <button type="button" onClick={() => set("offerings", [...d.offerings, newOffering()])} className="mt-4 flex items-center gap-1.5 rounded-md border border-dashed border-primary/40 bg-primary/5 px-4 py-2.5 text-sm font-semibold text-primary transition hover:bg-primary/10">
              <Plus className="size-4" /> Add another product/service
            </button>
          </div>
        </>
      ) : null}

      {/* Step 4: supply capabilities */}
      {step === 4 ? (
        <>
          <h1 className="text-2xl font-semibold text-foreground">Tell us where and how you can supply.</h1>
          <p className="mt-1 text-sm text-muted-foreground">Help buyers understand your delivery reach and supply capabilities.</p>

          <div className="mt-6">
            <SectionTitle hint="Select all that apply.">Where can you deliver your products or provide services?</SectionTitle>
            <div role="group" aria-label="Delivery coverage" className="grid gap-2.5 sm:grid-cols-2">
              {COVERAGE_OPTIONS.map((c) => (
                <OptionCard key={c} multi title={c} selected={d.coverage.includes(c)} onClick={() => set("coverage", toggle(d.coverage, c))} />
              ))}
            </div>
            {se.coverage ? (
              <p role="alert" className="mt-2 text-xs text-destructive">
                {se.coverage}
              </p>
            ) : null}
          </div>

          {needsLocations ? (
            <div className="mt-7">
              <SectionTitle hint="Optional. Add as many places as you like.">Which locations do you serve?</SectionTitle>
              <div className="rounded-lg border border-border bg-white/80 p-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <SelectField label="Country" value={loc.country} onChange={(v) => setLoc({ country: v, state: "", city: "" })} options={COUNTRIES} />
                  <SearchSelect label="State" value={loc.state} onChange={(v) => setLoc((x) => ({ ...x, state: v, city: "" }))} options={locStates} allowCustom placeholder="State (optional)" disabled={!loc.country} />
                  <SearchSelect label="City" value={loc.city} onChange={(v) => setLoc((x) => ({ ...x, city: v }))} options={locCities} allowCustom placeholder="City (optional)" disabled={!loc.state} />
                </div>
                <button type="button" onClick={addLocation} disabled={!loc.country} className="mt-3 flex items-center gap-1.5 rounded-md border border-input bg-white px-3.5 py-2 text-sm font-semibold text-foreground transition hover:bg-muted/60 disabled:opacity-60">
                  <Plus className="size-4" /> Add location
                </button>
                {d.locations.length ? (
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {d.locations.map((l) => {
                      const text = [l.city, l.state, l.country].filter(Boolean).join(", ");
                      return (
                        <li key={text} className="flex items-center gap-1.5 rounded-full bg-primary/10 py-1 pl-3 pr-1.5 text-xs font-medium text-primary">
                          {text}
                          <button type="button" aria-label={`Remove ${text}`} onClick={() => set("locations", d.locations.filter((x) => x !== l))} className="grid size-5 place-items-center rounded-full transition hover:bg-primary/15">
                            <X className="size-3" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="mt-8">
            <SectionTitle>Fulfilment information</SectionTitle>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Typical delivery / fulfilment time">
                <SelectField label="Delivery time" value={d.deliveryTime} onChange={(v) => set("deliveryTime", v)} options={DELIVERY_TIMES} />
              </Field>
              <Field label="Minimum order value">
                <MoneyInput currency={currency} value={d.minOrderValue} onChange={(v) => set("minOrderValue", v)} label="Minimum order value" />
              </Field>
            </div>
            <div className="mt-4">
              <Field label="Shipping / delivery options">
                <div role="group" aria-label="Delivery options" className="grid gap-2.5 sm:grid-cols-2">
                  {DELIVERY_OPTIONS.map((o) => (
                    <OptionCard key={o} multi title={o} selected={d.deliveryOptions.includes(o)} onClick={() => set("deliveryOptions", toggle(d.deliveryOptions, o))} />
                  ))}
                </div>
              </Field>
            </div>
            <div className="mt-4">
              <Field label="Can buyers arrange their own pickup?">
                <YesNo value={d.pickup} onChange={(v) => set("pickup", v)} label="Buyer pickup" />
              </Field>
            </div>
          </div>

          {group ? (
            <div className="mt-8">
              <SectionTitle hint={`Based on your business type: ${d.businessType}.`}>Business capabilities</SectionTitle>
              <div className="space-y-4">
                {group === "manufacturer" ? (
                  <>
                    <Field label="Do you manufacture products in-house?" required error={se.inHouse}>
                      <YesNo value={d.inHouse} onChange={(v) => set("inHouse", v)} label="In-house manufacturing" />
                    </Field>
                    <div className="sm:max-w-sm">
                      <Field label="Monthly production capacity">
                        <input className={fieldClass} value={d.monthlyCapacity} onChange={(e) => set("monthlyCapacity", e.target.value)} placeholder="e.g. 5,000 units" aria-label="Monthly production capacity" />
                      </Field>
                    </div>
                    <Field label="Manufacturing capabilities">
                      <div role="group" aria-label="Manufacturing capabilities" className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                        {MFG_CAPABILITIES.map((c) => (
                          <OptionCard key={c} multi title={c} selected={d.mfgCapabilities.includes(c)} onClick={() => set("mfgCapabilities", toggle(d.mfgCapabilities, c))} />
                        ))}
                      </div>
                    </Field>
                    <Field label="Custom manufacturing available?">
                      <YesNo value={d.customMfg} onChange={(v) => set("customMfg", v)} label="Custom manufacturing" />
                    </Field>
                  </>
                ) : null}

                {group === "distributor" ? (
                  <>
                    <Field label="Do you source from multiple manufacturers?">
                      <YesNo value={d.multiSource} onChange={(v) => set("multiSource", v)} label="Multiple manufacturers" />
                    </Field>
                    <Field label="Do you maintain ready stock?">
                      <YesNo value={d.readyStock} onChange={(v) => set("readyStock", v)} label="Ready stock" />
                    </Field>
                    <Field label="Can you supply bulk orders?">
                      <YesNo value={d.bulkOrders} onChange={(v) => set("bulkOrders", v)} label="Bulk orders" />
                    </Field>
                  </>
                ) : null}

                {group === "service" ? (
                  <>
                    <Field label="Types of services offered" required error={se.servicesOffered}>
                      <div role="group" aria-label="Services offered" className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                        {SERVICE_TYPES.map((s) => (
                          <OptionCard key={s} multi title={s} selected={d.servicesOffered.includes(s)} onClick={() => set("servicesOffered", toggle(d.servicesOffered, s))} />
                        ))}
                      </div>
                    </Field>
                    <div className="sm:max-w-sm">
                      <Field label="Service coverage" required error={se.serviceCoverage}>
                        <SelectField label="Service coverage" value={d.serviceCoverage} onChange={(v) => set("serviceCoverage", v)} options={SERVICE_COVERAGE} invalid={!!se.serviceCoverage} />
                      </Field>
                    </div>
                    <Field label="Can you handle large projects?">
                      <YesNo value={d.largeProjects} onChange={(v) => set("largeProjects", v)} label="Large projects" />
                    </Field>
                  </>
                ) : null}

                {group === "trade" ? (
                  <>
                    <div className="sm:max-w-lg">
                      <Field label="Countries you source from / export to">
                        <input className={fieldClass} value={d.tradeCountries} onChange={(e) => set("tradeCountries", e.target.value)} placeholder="e.g. UAE, Germany, Singapore" aria-label="Countries you source from or export to" />
                      </Field>
                    </div>
                    <Field label="International shipping capability">
                      <YesNo value={d.intlShipping} onChange={(v) => set("intlShipping", v)} label="International shipping" />
                    </Field>
                  </>
                ) : null}
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      {/* Step 5: review & launch */}
      {step === 5 ? (
        <>
          <h1 className="text-2xl font-semibold text-foreground">Your supplier profile is almost ready!</h1>
          <p className="mt-1 text-sm text-muted-foreground">Review your business details before launching your supplier workspace.</p>

          <div className="mt-6 divide-y divide-border overflow-hidden rounded-lg border border-border bg-white shadow-card">
            <ReviewRow icon={Building2} label="Business information" onEdit={() => go(1)}>
              <p>{[d.name, d.businessType, d.industry].filter(Boolean).join(" · ") || "—"}</p>
              <p className="mt-0.5 text-muted-foreground">{[d.city, d.state, d.country].filter(Boolean).join(", ") || "—"}</p>
            </ReviewRow>
            <ReviewRow icon={UserRound} label="Supplier profile" onEdit={() => go(2)}>
              <div className="flex items-start gap-3">
                {d.logo ? <img src={d.logo} alt="Company logo" className="size-12 shrink-0 rounded-md border border-border bg-white object-contain" /> : null}
                <div className="min-w-0">
                  <p className="line-clamp-2 text-muted-foreground">{d.description || "—"}</p>
                  <p className="mt-1">{[d.contactName, d.designation].filter(Boolean).join(" · ") || "—"}</p>
                  <p className="text-muted-foreground">{[d.email, d.phone ? `${d.phoneCode} ${d.phone}` : ""].filter(Boolean).join(" · ")}</p>
                </div>
              </div>
            </ReviewRow>
            <ReviewRow icon={Package} label="Products & services" onEdit={() => go(3)}>
              {d.categories.length ? <Chips items={d.categories} /> : "—"}
              {listedOfferings.length ? (
                <p className="mt-2 text-muted-foreground">
                  {listedOfferings.length} {listedOfferings.length === 1 ? "offering" : "offerings"}: {listedOfferings.map((o) => o.name).join(", ")}
                </p>
              ) : null}
            </ReviewRow>
            <ReviewRow icon={Truck} label="Supply capabilities" onEdit={() => go(4)}>
              {d.coverage.length ? <Chips items={d.coverage} /> : "—"}
              <p className="mt-2 text-muted-foreground">
                {[d.deliveryTime ? `Delivery: ${d.deliveryTime}` : "", d.locations.length ? `${d.locations.length} service ${d.locations.length === 1 ? "location" : "locations"}` : ""].filter(Boolean).join(" · ")}
              </p>
            </ReviewRow>
            <div className="flex items-start gap-3 bg-white p-4">
              <span className="grid size-8 shrink-0 place-items-center rounded-md bg-amber/15 text-amber">
                <ShieldAlert className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Verification status</p>
                <p className="mt-0.5 text-sm font-medium text-foreground">Not verified</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Verification can be completed separately. Launching your workspace doesn't verify your business.</p>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </OnboardingShell>
  );
}

function Welcome() {
  const nodes: { icon: LucideIcon; label: string }[] = [
    { icon: Factory, label: "Your business" },
    { icon: Package, label: "Your products" },
    { icon: Truck, label: "Your reach" },
    { icon: Store, label: "Your buyers" },
  ];
  const benefits: { icon: LucideIcon; title: string; text: string }[] = [
    { icon: Users, title: "Reach business buyers", text: "Get discovered by companies looking for suppliers like you." },
    { icon: Inbox, title: "Receive enquiries", text: "Buyers contact you directly about what they need." },
    { icon: Sparkles, title: "Showcase your offerings", text: "Present your products and services in one place." },
  ];
  return (
    <div className="flex h-full flex-col justify-center py-4">
      <p className="text-sm font-semibold text-primary">Welcome to Vendora</p>
      <h1 className="mt-1.5 text-3xl font-semibold text-foreground lg:text-4xl">Let's get your business ready to grow.</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Create your supplier profile, showcase your products and services, and connect with businesses looking for reliable suppliers.</p>

      <div aria-hidden className="mt-8 flex items-center rounded-lg border border-border bg-white/70 p-5 shadow-card">
        {nodes.map((n, i) => (
          <div key={n.label} className="flex flex-1 items-center">
            <div className="flex flex-col items-center gap-2">
              <span className="grid size-12 place-items-center rounded-md bg-gradient-primary text-on-brand shadow-glow">
                <n.icon className="size-5" />
              </span>
              <span className="text-xs font-medium text-muted-foreground">{n.label}</span>
            </div>
            {i < nodes.length - 1 ? <span className="mx-2 mb-6 h-px flex-1 border-t-2 border-dashed border-primary/30" /> : null}
          </div>
        ))}
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        {benefits.map((b) => (
          <div key={b.title} className="rounded-lg border border-border bg-white/70 p-4">
            <span className="grid size-9 place-items-center rounded-md bg-primary/10 text-primary">
              <b.icon className="size-4.5" />
            </span>
            <p className="mt-3 text-sm font-semibold text-foreground">{b.title}</p>
            <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{b.text}</p>
          </div>
        ))}
      </div>

      <p className="mt-5 flex items-center gap-2 text-sm text-muted-foreground">
        <Clock className="size-4" /> Estimated time: 5–7 minutes
      </p>
    </div>
  );
}

function YesNo({ value, onChange, label }: { value: YesNoValue; onChange: (v: YesNoValue) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex gap-2">
      {(["Yes", "No"] as const).map((o) => (
        <button
          key={o}
          type="button"
          role="radio"
          aria-checked={value === o}
          onClick={() => onChange(value === o ? "" : o)}
          className={cn(
            "min-w-20 rounded-md border px-4 py-2 text-sm font-semibold transition",
            value === o ? "border-primary/50 bg-primary/5 text-primary ring-4 ring-primary/10" : "border-input bg-white text-foreground hover:border-primary/40 hover:bg-muted/60",
          )}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

function PhoneInput({ code, value, onCode, onValue, invalid, label }: { code: string; value: string; onCode: (v: string) => void; onValue: (v: string) => void; invalid?: boolean; label: string }) {
  return (
    <div className="flex gap-2">
      <select aria-label={`${label} country code`} value={code} onChange={(e) => onCode(e.target.value)} className={cn(fieldClass, "w-24 shrink-0 px-2.5")}>
        {PHONE_CODES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <input
        className={cn(fieldClass, invalid && "border-destructive")}
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        value={value}
        onChange={(e) => onValue(e.target.value.replace(/[^\d\s-]/g, ""))}
        aria-label={label}
        aria-invalid={invalid || undefined}
      />
    </div>
  );
}

function MoneyInput({ currency, value, onChange, label }: { currency: string; value: string; onChange: (v: string) => void; label: string }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted-foreground">{currency}</span>
      <input className={cn(fieldClass, "pl-14")} type="number" min={0} inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} />
    </div>
  );
}

/** Upload with previews and remove/replace. One slot replaces the image; several slots add up to `max`. */
function ImagePicker({ images, max, maxPx, onChange, label }: { images: string[]; max: number; maxPx: number; onChange: (imgs: string[]) => void; label: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setError(null);
    const room = max === 1 ? 1 : max - images.length;
    const added: string[] = [];
    for (const f of Array.from(files).slice(0, room)) {
      if (!IMAGE_TYPES.includes(f.type)) {
        setError("Use a JPG, PNG or WebP image.");
        continue;
      }
      if (f.size > 2 * 1024 * 1024) {
        setError("Each image must be 2 MB or smaller.");
        continue;
      }
      try {
        added.push(await imageToDataUrl(f, maxPx));
      } catch {
        setError("We couldn't read that image. Try another one.");
      }
    }
    if (added.length) onChange(max === 1 ? [added[0]] : [...images, ...added]);
    if (input.current) input.current.value = "";
  };

  const full = max > 1 && images.length >= max;
  return (
    <div>
      <input ref={input} type="file" accept={IMAGE_TYPES.join(",")} multiple={max > 1} className="sr-only" aria-label={`Upload ${label}`} onChange={(e) => void onFiles(e.target.files)} />
      <div className="flex flex-wrap items-center gap-3">
        {images.map((src, i) => (
          <div key={i} className="group relative size-20 overflow-hidden rounded-md border border-border bg-white">
            <img src={src} alt={`${label} preview ${i + 1}`} className="size-full object-contain" />
            <button type="button" aria-label={`Remove ${label}`} onClick={() => onChange(images.filter((_, j) => j !== i))} className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-foreground/70 text-white opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100">
              <X className="size-3" />
            </button>
          </div>
        ))}
        {full ? null : (
          <button type="button" onClick={() => input.current?.click()} className="flex size-20 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-primary/40 bg-primary/5 text-xs font-semibold text-primary transition hover:bg-primary/10">
            <ImagePlus className="size-5" />
            {max === 1 && images.length ? "Replace" : "Upload"}
          </button>
        )}
      </div>
      {error ? (
        <p role="alert" className="mt-1.5 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function Chips({ items }: { items: string[] }) {
  return (
    <span className="flex flex-wrap gap-1.5">
      {items.map((i) => (
        <span key={i} className="rounded-sm bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
          {i}
        </span>
      ))}
    </span>
  );
}

function ReviewRow({ icon: Icon, label, onEdit, children }: { icon: LucideIcon; label: string; onEdit: () => void; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 bg-white p-4">
      <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
        <div className="mt-0.5 text-sm font-medium text-foreground">{children}</div>
      </div>
      <button type="button" onClick={onEdit} aria-label={`Edit ${label}`} className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-semibold text-primary transition hover:bg-primary/10">
        <Pencil className="size-3.5" /> Edit
      </button>
    </div>
  );
}
