import { Check, Lock } from "lucide-react";
import { useState } from "react";

import { PERMISSION_LABEL, ROLES, ROLE_LABEL, ROLE_PERMISSIONS, can, type Permission } from "@/lib/permissions";

import { Reveal, SectionHead } from "./motion";

const BLURB: Record<string, string> = {
  owner: "Sees and controls everything, including billing and team.",
  procurement_manager: "Runs sourcing end to end, from RFQ to purchase order.",
  finance_manager: "Guards budgets, approves orders and owns billing.",
  approver: "Makes fast, informed yes-or-no calls on requests.",
  employee: "Raises what is needed, nothing more.",
};

export function Roles() {
  const [role, setRole] = useState(ROLES[1] ?? ROLES[0]!);
  const perms = Object.keys(PERMISSION_LABEL) as Permission[];
  const has = ROLE_PERMISSIONS[role].length;
  return (
    <section id="roles" className="relative overflow-hidden bg-navy py-28 sm:py-40">
      <div className="glow-blue pointer-events-none absolute -left-40 top-40 h-[600px] w-[600px] opacity-40" />
      <div className="relative mx-auto max-w-[1400px] px-5 sm:px-8">
        <SectionHead eyebrow="Role explorer" title={<>Everyone sees <span className="text-gradient-brand-dark animate-gradient-pan">exactly enough.</span></>} body="Pick a role. The permissions below are read straight from Vendora's own access rules, not a marketing mock-up." />

        <Reveal className="mt-14 flex flex-wrap justify-center gap-3">
          {ROLES.map((r) => (
            <button key={r} type="button" onClick={() => setRole(r)} className={`rounded-full px-6 py-3 text-base font-semibold transition ${r === role ? "bg-gradient-cta text-white shadow-glow" : "border border-white/15 bg-white/5 text-white/80 hover:bg-white/10"}`}>
              {ROLE_LABEL[r]}
            </button>
          ))}
        </Reveal>

        <Reveal className="mt-10" delay={0.1}>
          <div className="mx-auto max-w-5xl rounded-[32px] border border-white/10 bg-white/[0.04] p-6 sm:p-10">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h3 className="text-3xl font-semibold text-white sm:text-4xl">{ROLE_LABEL[role]}</h3>
                <p className="mt-2 text-lg text-navy-muted">{BLURB[role]}</p>
              </div>
              <p className="text-5xl font-semibold tabular text-white">
                {has}
                <span className="text-2xl text-navy-muted"> / {perms.length}</span>
              </p>
            </div>
            <ul key={role} className="mt-8 grid gap-3 sm:grid-cols-2">
              {perms.map((p, i) => {
                const ok = can(role, p);
                return (
                  <li key={p} className={`slide-in-r flex items-center gap-3 rounded-2xl border px-4 py-3.5 ${ok ? "border-emerald/30 bg-emerald/10 text-white" : "border-white/5 bg-white/[0.02] text-white/40"}`} style={{ animationDelay: `${i * 0.035}s` }}>
                    <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${ok ? "bg-emerald text-white" : "bg-white/10"}`}>{ok ? <Check className="h-4 w-4" strokeWidth={3} /> : <Lock className="h-3.5 w-3.5" />}</span>
                    {PERMISSION_LABEL[p]}
                  </li>
                );
              })}
            </ul>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
