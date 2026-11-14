import { useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowRight,
  Boxes,
  Building2,
  Clock,
  ClipboardCheck,
  Cpu,
  Cog,
  Ellipsis,
  FlaskConical,
  Factory,
  HardHat,
  Layers,
  Loader2,
  Package,
  Paperclip,
  Pencil,
  Rocket,
  Search,
  FileText,
  ShoppingCart,
  SlidersHorizontal,
  Store,
  Truck,
  UserPlus,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { Field, OptionCard, SearchSelect, SectionTitle, SelectField, fieldClass } from "@/components/onboarding/fields";
import { OnboardingShell, type OnboardingStep } from "@/components/onboarding/OnboardingShell";
import { forgetInvite, pendingInvite } from "@/lib/invites";
import { launchOnboarding, saveOnboardingProgress, type SavedProgress } from "@/lib/onboarding-api";
import { useUi } from "@/lib/ui-store";
import { cn } from "@/lib/utils";
import { useWs } from "@/lib/ws-store";

import {
  BUSINESS_TYPES,
  COMPANY_SIZES,
  DELIVERY_TIMELINES,
  EMPTY_DRAFT,
  FREQUENCIES,
  INDUSTRIES,
  PURCHASE_CATEGORIES,
  SOURCING_AREAS,
  SUPPLIER_PRIORITIES,
  budgetOptions,
  forgetLocalDrafts,
  landingPathFor,
  restoreBuyerDraft,
  websiteError,
  type BuyerDraft,
  type NextAction,
} from "./draft";
import { COUNTRIES, CURRENCY_BY_COUNTRY, INDIA_CITIES, INDIA_STATES } from "./locations";

const STEPS: OnboardingStep[] = [
  { title: "Getting started", description: "Kick off your onboarding", icon: Rocket },
  { title: "Business information", description: "Tell us about your company", icon: Building2 },
  { title: "Procurement needs", description: "What you buy and how often", icon: ShoppingCart },
  { title: "Workspace setup", description: "Preferences and your first action", icon: SlidersHorizontal },
  { title: "Complete setup", description: "Review and launch", icon: ClipboardCheck },
];

const CATEGORY_ICONS: Record<(typeof PURCHASE_CATEGORIES)[number], LucideIcon> = {
  "Raw Materials": Layers,
  "Industrial Machinery": Cog,
  "Electrical Equipment": Zap,
  "Packaging Materials": Package,
  Chemicals: FlaskConical,
  "Construction Materials": HardHat,
  Electronics: Cpu,
  "Office Supplies": Paperclip,
  "Logistics & Transport": Truck,
  Other: Ellipsis,
};

const ACTIONS: { key: NextAction; title: string; text: string; icon: LucideIcon }[] = [
  { key: "suppliers", title: "Discover Suppliers", text: "Find businesses that supply your purchasing categories.", icon: Search },
  { key: "rfq", title: "Create Your First RFQ", text: "Request quotations from multiple suppliers.", icon: FileText },
  { key: "team", title: "Invite Your Team", text: "Add purchasing and finance colleagues.", icon: UserPlus },
];

const toggle = <T extends string>(list: T[], item: T): T[] => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

const outlineBtn =
  "flex items-center gap-1.5 rounded-md border border-input bg-white px-4 py-2.5 text-sm font-semibold text-foreground transition hover:bg-muted/60 disabled:opacity-60";
const ctaBtn =
  "btn-shine group flex items-center justify-center gap-1.5 rounded-md bg-gradient-cta px-5 py-2.5 text-sm font-semibold text-white shadow-glow transition hover:scale-[1.01] disabled:opacity-60 disabled:hover:scale-100";
const linkBtn = "rounded-md px-3 py-2 text-sm font-semibold text-muted-foreground transition hover:text-foreground disabled:opacity-60";

function businessErrors(d: BuyerDraft) {
  const e: Partial<Record<"companyName" | "businessType" | "industry" | "country" | "state" | "city" | "website", string>> = {};
  if (d.companyName.trim().length < 2) e.companyName = "Enter your company name";
  if (!d.businessType) e.businessType = "Select your business type";
  if (!d.industry) e.industry = "Select your industry";
  if (!d.country) e.country = "Select your country";
  if (!d.state.trim()) e.state = "Select your state";
  if (!d.city.trim()) e.city = "Select your city";
  const w = websiteError(d.website);
  if (w) e.website = w;
  return e;
}

function needsErrors(d: BuyerDraft) {
  const e: Partial<Record<"categories" | "frequency", string>> = {};
  if (d.categories.length === 0) e.categories = "Pick at least one category";
  if (!d.frequency) e.frequency = "Select how often you purchase";
  return e;
}

export function BuyerOnboardingPage({ initial }: { initial: SavedProgress | null }) {
  const nav = useNavigate();
  const { user, finishOnboarding } = useUi();
  const reset = useWs((s) => s.reset);
  const updateOrg = useWs((s) => s.updateOrg);

  // Where the buyer left off comes from the database (loaded by the route), so resuming works on any device.
  const [d, setD] = useState<BuyerDraft>(() => (initial ? restoreBuyerDraft(initial.data, initial.step) : { ...EMPTY_DRAFT, companyName: user?.company ?? "" }));
  const [step, setStep] = useState(() => d.step);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Answers are saved to the database each time the buyer presses Continue, so closing the tab or choosing
  // "Save and finish later" loses nothing. Drafts older versions kept in this browser are removed.
  useEffect(() => {
    forgetLocalDrafts();
  }, []);

  // Someone who confirmed their email after opening an invitation goes back to it, so they join
  // the company they were invited to instead of creating a new empty one.
  useEffect(() => {
    const t = pendingInvite();
    if (t) window.location.assign(`/accept-invite?token=${t}`);
  }, []);

  const set = <K extends keyof BuyerDraft>(k: K, v: BuyerDraft[K]) => setD((x) => ({ ...x, [k]: v }));
  const go = (i: number) => {
    setTried(false);
    setError(null);
    setStep(i);
  };
  // Saves the answers, then moves on. If saving fails the buyer stays put and is told, so nothing is lost silently.
  const advance = async (to: number) => {
    setBusy(true);
    setError(null);
    try {
      await saveOnboardingProgress("buyer", to, { ...d, step: to });
    } catch (e) {
      setError(e instanceof Error ? e.message : "We couldn't save your progress. Please try again.");
      setBusy(false);
      return;
    }
    setBusy(false);
    go(to);
  };
  const next = () => {
    const bad = step === 1 ? businessErrors(d) : step === 2 ? needsErrors(d) : {};
    if (Object.keys(bad).length > 0) {
      setTried(true);
      return;
    }
    void advance(step + 1);
  };

  const onCountry = (country: string) => {
    const currency = CURRENCY_BY_COUNTRY[country] ?? "USD";
    setD((x) => ({ ...x, country, state: "", city: "", budgetCurrency: currency, budget: currency === x.budgetCurrency ? x.budget : "" }));
  };

  const launch = async () => {
    setBusy(true);
    setError(null);
    try {
      await launchOnboarding("buyer", 4, { ...d, step: 4 }, d.companyName);
    } catch (e) {
      setError(e instanceof Error ? e.message : "We couldn't create your workspace. Please try again.");
      setBusy(false);
      return;
    }
    forgetInvite();
    finishOnboarding(false);
    reset(false);
    updateOrg({ name: d.companyName.trim() || "My Workspace", industry: d.industry, city: d.city.trim() });
    void nav({ to: landingPathFor(d.nextAction) });
  };

  const saveForLater = async () => {
    setBusy(true);
    setError(null);
    try {
      await saveOnboardingProgress("buyer", step, { ...d, step });
    } catch (e) {
      setError(e instanceof Error ? e.message : "We couldn't save your progress. Please try again.");
      setBusy(false);
      return;
    }
    void nav({ to: "/" });
  };

  const be = tried && step === 1 ? businessErrors(d) : {};
  const ne = tried && step === 2 ? needsErrors(d) : {};
  const stateOptions = d.country === "India" ? INDIA_STATES : [];
  const cityOptions = d.country === "India" ? (INDIA_CITIES[d.state] ?? []) : [];

  const footer =
    step === 0 ? (
      <>
        <span />
        <button type="button" className={ctaBtn} onClick={() => go(1)}>
          Set up my workspace
          <ArrowRight className="size-4 transition group-hover:translate-x-1" />
        </button>
      </>
    ) : step < 4 ? (
      <>
        <button type="button" className={outlineBtn} disabled={busy} onClick={() => go(step - 1)}>
          <ArrowLeft className="size-4" /> Previous
        </button>
        <div className="flex items-center gap-2">
          {step === 3 ? (
            <button type="button" className={linkBtn} disabled={busy} onClick={() => void advance(4)}>
              Skip for now
            </button>
          ) : null}
          <button type="button" className={ctaBtn} disabled={busy} onClick={next}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            Continue
            {busy ? null : <ArrowRight className="size-4 transition group-hover:translate-x-1" />}
          </button>
        </div>
      </>
    ) : (
      <>
        <button type="button" className={outlineBtn} disabled={busy} onClick={() => go(3)}>
          <ArrowLeft className="size-4" /> Previous
        </button>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button type="button" className={linkBtn} disabled={busy} onClick={() => void saveForLater()}>
            Save and finish later
          </button>
          <button type="button" className={ctaBtn} disabled={busy} onClick={() => void launch()}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            Launch My Workspace
            {busy ? null : <ArrowRight className="size-4 transition group-hover:translate-x-1" />}
          </button>
        </div>
      </>
    );

  return (
    <OnboardingShell steps={STEPS} current={step} onSelect={go} stepLabel={step > 0 ? `Step ${String(step).padStart(2, "0")} of 04` : undefined} footer={footer}>
      {step === 0 ? <Welcome /> : null}

      {step === 1 ? (
        <>
          <h1 className="text-2xl font-semibold text-foreground">Tell us about your business.</h1>
          <p className="mt-1 text-sm text-muted-foreground">Let's start with the basics about your company.</p>
          <p className="mt-3 rounded-md bg-primary/5 px-3.5 py-2.5 text-sm text-foreground">
            Joining your team? Use the invitation link your administrator sent instead of creating a new company here.
          </p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label="Company name" required error={be.companyName}>
                <input className={cn(fieldClass, be.companyName && "border-destructive")} value={d.companyName} onChange={(e) => set("companyName", e.target.value)} autoComplete="organization" aria-label="Company name" />
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
                <SelectField label="State" value={d.state} onChange={(v) => setD((x) => ({ ...x, state: v, city: "" }))} options={stateOptions} invalid={!!be.state} disabled={!d.country} />
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
            <div className="sm:col-span-2 sm:max-w-[calc(50%-0.5rem)]">
              <Field label="Company size">
                <SelectField label="Company size" value={d.companySize} onChange={(v) => set("companySize", v)} options={COMPANY_SIZES} />
              </Field>
            </div>
          </div>
        </>
      ) : null}

      {step === 2 ? (
        <>
          <h1 className="text-2xl font-semibold text-foreground">What does your business purchase?</h1>
          <p className="mt-1 text-sm text-muted-foreground">Help us understand your procurement requirements so we can connect you with relevant suppliers.</p>

          <div className="mt-6">
            <SectionTitle hint="Select all that apply.">What products or services does your business regularly purchase?</SectionTitle>
            <div role="group" aria-label="Purchasing categories" className="grid grid-cols-2 gap-2.5 lg:grid-cols-3">
              {PURCHASE_CATEGORIES.map((c) => (
                <OptionCard key={c} multi icon={CATEGORY_ICONS[c]} title={c} selected={d.categories.includes(c)} onClick={() => set("categories", toggle(d.categories, c))} />
              ))}
            </div>
            {ne.categories ? (
              <p role="alert" className="mt-2 text-xs text-destructive">
                {ne.categories}
              </p>
            ) : null}
          </div>

          <div className="mt-7">
            <SectionTitle>How frequently does your business purchase?</SectionTitle>
            <div role="radiogroup" aria-label="Purchase frequency" className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {FREQUENCIES.map((f) => (
                <OptionCard key={f} title={f} selected={d.frequency === f} onClick={() => set("frequency", f)} />
              ))}
            </div>
            {ne.frequency ? (
              <p role="alert" className="mt-2 text-xs text-destructive">
                {ne.frequency}
              </p>
            ) : null}
          </div>

          <div className="mt-7 sm:max-w-sm">
            <Field label="What is your typical purchasing budget per order?" hint={`Amounts are shown in ${d.budgetCurrency}.`}>
              <SelectField label="Budget per order" value={d.budget} onChange={(v) => set("budget", v)} options={budgetOptions(d.budgetCurrency)} />
            </Field>
          </div>
        </>
      ) : null}

      {step === 3 ? (
        <>
          <h1 className="text-2xl font-semibold text-foreground">Let's personalize your procurement workspace.</h1>
          <p className="mt-1 text-sm text-muted-foreground">Choose what you'd like to do first. You can always come back to these actions later.</p>

          <div className="mt-6">
            <SectionTitle hint="Optional. Pick as many as you like.">What matters most when selecting suppliers?</SectionTitle>
            <div role="group" aria-label="Supplier priorities" className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {SUPPLIER_PRIORITIES.map((p) => (
                <OptionCard key={p} multi title={p} selected={d.priorities.includes(p)} onClick={() => set("priorities", toggle(d.priorities, p))} />
              ))}
            </div>
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <div>
              <SectionTitle hint="Optional. Pick as many as you like.">Where would you prefer to source products from?</SectionTitle>
              <div role="group" aria-label="Sourcing location" className="grid gap-2.5 sm:grid-cols-2">
                {SOURCING_AREAS.map((s) => (
                  <OptionCard key={s} multi title={s} selected={d.sourcing.includes(s)} onClick={() => set("sourcing", toggle(d.sourcing, s))} />
                ))}
              </div>
            </div>
            <div>
              <SectionTitle hint="Optional.">What is your preferred delivery timeline?</SectionTitle>
              <div role="radiogroup" aria-label="Delivery timeline" className="grid gap-2.5 sm:grid-cols-2">
                {DELIVERY_TIMELINES.map((t) => (
                  <OptionCard key={t} title={t} selected={d.delivery === t} onClick={() => set("delivery", d.delivery === t ? "" : t)} />
                ))}
              </div>
            </div>
          </div>

          <div className="mt-7">
            <SectionTitle hint="Optional. You'll be taken there once your workspace is ready.">Choose your next action</SectionTitle>
            <div role="radiogroup" aria-label="Next action" className="grid gap-3 md:grid-cols-3">
              {ACTIONS.map((a) => {
                const on = d.nextAction === a.key;
                const Icon = a.icon;
                return (
                  <button
                    key={a.key}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => set("nextAction", on ? null : a.key)}
                    className={cn(
                      "flex flex-col items-start gap-3 rounded-md border p-4 text-left transition",
                      on ? "border-primary/50 bg-primary/5 ring-4 ring-primary/10" : "border-input bg-white hover:border-primary/40 hover:bg-muted/60",
                    )}
                  >
                    <span className={cn("grid size-11 place-items-center rounded-md transition", on ? "bg-gradient-primary text-on-brand shadow-glow" : "bg-muted text-muted-foreground")}>
                      <Icon className="size-5" />
                    </span>
                    <span>
                      <span className="block text-sm font-semibold text-foreground">{a.title}</span>
                      <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{a.text}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      ) : null}

      {step === 4 ? (
        <>
          <h1 className="text-2xl font-semibold text-foreground">Your procurement workspace is ready!</h1>
          <p className="mt-1 text-sm text-muted-foreground">Take a quick look at what you told us. Use Edit to change anything before you launch.</p>

          <div className="mt-6 divide-y divide-border overflow-hidden rounded-md border border-border">
            <ReviewRow icon={Building2} label="Business" onEdit={() => go(1)}>
              {[d.companyName, d.businessType, d.industry].filter(Boolean).join(" · ") || "—"}
            </ReviewRow>
            <ReviewRow icon={Store} label="Location" onEdit={() => go(1)}>
              {[d.city, d.state, d.country].filter(Boolean).join(", ") || "—"}
            </ReviewRow>
            <ReviewRow icon={Boxes} label="Procurement" onEdit={() => go(2)}>
              {d.categories.length ? <Chips items={d.categories} /> : "—"}
            </ReviewRow>
            <ReviewRow icon={Clock} label="Frequency" onEdit={() => go(2)}>
              {d.frequency || "—"}
            </ReviewRow>
            <ReviewRow icon={SlidersHorizontal} label="Preferences" onEdit={() => go(3)}>
              {d.priorities.length ? <Chips items={d.priorities} /> : <span className="text-muted-foreground">No priorities selected</span>}
            </ReviewRow>
          </div>

          {d.nextAction ? (
            <p className="mt-4 rounded-md bg-primary/5 px-3.5 py-2.5 text-sm text-foreground">
              Once you launch, we'll take you to <span className="font-semibold">{ACTIONS.find((a) => a.key === d.nextAction)?.title}</span>.
            </p>
          ) : null}
        </>
      ) : null}

      {error ? (
        <p role="alert" className="mt-4 rounded-md bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </OnboardingShell>
  );
}

function Welcome() {
  const nodes: { icon: LucideIcon; label: string }[] = [
    { icon: Factory, label: "Businesses" },
    { icon: Package, label: "Products" },
    { icon: Truck, label: "Supply chain" },
    { icon: Store, label: "Suppliers" },
  ];
  return (
    <div className="flex h-full flex-col justify-center">
      <p className="text-sm font-semibold text-primary">Welcome to Vendora</p>
      <h1 className="mt-1.5 text-3xl font-semibold text-foreground">Let's set up your procurement workspace.</h1>
      <p className="mt-2 max-w-xl text-sm text-muted-foreground">A few details will help us personalize your purchasing and supplier discovery experience.</p>

      <div aria-hidden className="mt-8 flex items-center rounded-md border border-border bg-muted/40 p-5">
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

      <p className="mt-5 flex items-center gap-2 text-sm text-muted-foreground">
        <Clock className="size-4" /> Estimated time: 3–4 minutes
      </p>
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
