import { useNavigate } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { ArrowRight, Check, ShieldCheck } from "lucide-react";
import { useState } from "react";

import { authInputClass } from "@/components/landing/AuthScreen";
import { cn } from "@/lib/utils";

import { BUSINESS_TYPES, SUPPLY_CATEGORIES, loadDraft, saveDraft, type SupplierDraft } from "./draft";

const STEPS = ["Your business", "What you supply", "Verification"];

const EMPTY: SupplierDraft = {
  name: "",
  businessType: "Manufacturer",
  industry: "",
  country: "India",
  city: "",
  address: "",
  phone: "",
  categories: [],
  registrationNo: "",
};

export function SupplierOnboardingPage() {
  const nav = useNavigate();
  const [step, setStep] = useState(0);
  const [d, setD] = useState<SupplierDraft>(() => loadDraft() ?? EMPTY);
  const set = (k: keyof SupplierDraft) => (e: { target: { value: string } }) => setD((v) => ({ ...v, [k]: e.target.value }));

  const canContinue = step === 0 ? d.name.trim().length >= 2 && d.city.trim().length >= 2 : true;
  const finish = () => {
    saveDraft(d);
    void nav({ to: "/supplier/dashboard" });
  };

  const label = "mb-1.5 block text-sm font-medium text-foreground";
  const cta =
    "btn-shine group flex items-center justify-center gap-1.5 rounded-lg bg-gradient-emerald px-5 py-2.5 text-sm font-semibold text-white shadow-glow transition hover:scale-[1.01] disabled:opacity-60 disabled:hover:scale-100";

  return (
    <div className="relative flex min-h-dvh flex-col items-center gap-6 overflow-hidden bg-gradient-lavender px-5 pb-8 pt-6">
      <div className="glow-emerald animate-orb pointer-events-none absolute -right-32 -top-20 size-[34rem] opacity-30" />
      <div className="glow-cyan animate-orb-slow pointer-events-none absolute -bottom-32 -left-32 size-[34rem] opacity-25" />

      <img src="/brand/vendora-logo-light.png" alt="Vendora" className="relative h-20 w-auto shrink-0" />

      <div className="relative w-full max-w-3xl">
        <p className="mb-3 text-center text-sm font-semibold text-emerald">Supplier setup</p>
        <ol className="mb-6 flex items-center gap-3" aria-label="Progress">
          {STEPS.map((s, i) => (
            <li key={s} className="flex flex-1 items-center gap-3">
              <span className={cn("grid size-10 shrink-0 place-items-center rounded-full text-sm font-semibold transition", i <= step ? "bg-gradient-emerald text-white shadow-glow" : "bg-white text-muted-foreground shadow-card")}>
                {i < step ? <Check className="size-5" strokeWidth={3} /> : i + 1}
              </span>
              <span className={cn("hidden text-base sm:block", i === step ? "font-semibold text-foreground" : "text-muted-foreground")}>{s}</span>
              {i < 2 ? <span className={cn("h-0.5 flex-1 rounded-full", i < step ? "bg-emerald/60" : "bg-border")} /> : null}
            </li>
          ))}
        </ol>

        <motion.div key={step} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} className="rounded-[2rem] border border-white/60 bg-white p-6 shadow-lift sm:p-9">
          {step === 0 ? (
            <>
              <h1 className="text-3xl font-semibold text-foreground">Tell buyers about your business</h1>
              <p className="mt-1.5 text-base text-muted-foreground">This is your public supplier profile. Buyers see it when they search for suppliers.</p>
              <p className="mt-3 rounded-xl bg-emerald/10 px-4 py-3 text-sm text-foreground">
                Joining a supplier team? Use the invitation link your owner sent instead of creating a new business here.
              </p>
              <div className="mt-6 space-y-4">
                <label className="block">
                  <span className={label}>Business name</span>
                  <input className={authInputClass} value={d.name} onChange={set("name")} autoComplete="organization" />
                </label>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className={label}>Business type</span>
                    <select className={authInputClass} value={d.businessType} onChange={set("businessType")}>
                      {BUSINESS_TYPES.map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className={label}>Industry</span>
                    <input className={authInputClass} placeholder="Industrial hoses and fittings" value={d.industry} onChange={set("industry")} />
                  </label>
                  <label className="block">
                    <span className={label}>Country</span>
                    <input className={authInputClass} value={d.country} onChange={set("country")} autoComplete="country-name" />
                  </label>
                  <label className="block">
                    <span className={label}>City</span>
                    <input className={authInputClass} placeholder="Pune" value={d.city} onChange={set("city")} autoComplete="address-level2" />
                  </label>
                </div>
                <label className="block">
                  <span className={label}>Business address</span>
                  <input className={authInputClass} value={d.address} onChange={set("address")} autoComplete="street-address" />
                </label>
                <label className="block">
                  <span className={label}>Contact phone</span>
                  <input className={authInputClass} type="tel" value={d.phone} onChange={set("phone")} autoComplete="tel" />
                </label>
              </div>
            </>
          ) : null}

          {step === 1 ? (
            <>
              <h1 className="text-3xl font-semibold text-foreground">What do you supply?</h1>
              <p className="mt-1.5 text-base text-muted-foreground">Pick your main categories so the right buyers find you. You can add individual products from your dashboard.</p>
              <div className="mt-6 flex flex-wrap gap-2.5">
                {SUPPLY_CATEGORIES.map((c) => {
                  const on = d.categories.includes(c);
                  return (
                    <button
                      key={c}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setD((v) => ({ ...v, categories: on ? v.categories.filter((x) => x !== c) : [...v.categories, c] }))}
                      className={cn("rounded-full border px-5 py-2.5 text-sm font-medium transition", on ? "border-emerald/50 bg-emerald/10 text-foreground" : "border-input bg-white text-foreground hover:border-emerald/40 hover:bg-muted/60")}
                    >
                      {on ? "✓ " : ""}
                      {c}
                    </button>
                  );
                })}
              </div>
            </>
          ) : null}

          {step === 2 ? (
            <>
              <h1 className="text-3xl font-semibold text-foreground">Get your business verified</h1>
              <p className="mt-1.5 text-base text-muted-foreground">Confirming your email proves the address is yours. It does not prove the business is real, so buyers see a verified badge only after we check your registration.</p>
              <div className="mt-6 flex gap-3 rounded-2xl bg-muted/60 p-4">
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald" />
                <p className="text-sm text-muted-foreground">Optional for now. Until you are verified, buyers can still find you but your profile is marked “Not yet verified”.</p>
              </div>
              <label className="mt-6 block">
                <span className={label}>GSTIN or business registration number</span>
                <input className={authInputClass} value={d.registrationNo} onChange={set("registrationNo")} placeholder="Optional" />
              </label>
              <p className="mt-3 text-sm text-muted-foreground">Document upload and team invitations are available from your dashboard once your workspace is ready.</p>
            </>
          ) : null}

          <div className="mt-6 flex items-center justify-between">
            <button type="button" disabled={step === 0} onClick={() => setStep(step - 1)} className="rounded-lg px-4 py-2 text-sm font-semibold text-muted-foreground transition hover:text-foreground disabled:invisible">
              Back
            </button>
            {step < 2 ? (
              <button type="button" className={cta} onClick={() => setStep(step + 1)} disabled={!canContinue}>
                Continue
                <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
              </button>
            ) : (
              <button type="button" className={cta} onClick={finish}>
                Go to my workspace
                <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
              </button>
            )}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
