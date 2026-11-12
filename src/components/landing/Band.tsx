import { BarChart3, ClipboardList, FileSpreadsheet, History, Package, ReceiptText, Scale, ShieldCheck, Sparkles, Truck, Users, type LucideIcon } from "lucide-react";

import { PERMISSION_LABEL, ROLES } from "@/lib/permissions";

import { FLOW_STEPS } from "./content";
import { CountUp, Reveal } from "./motion";

const ITEMS: [string, LucideIcon][] = [
  ["Purchase requests", ClipboardList],
  ["RFQs", FileSpreadsheet],
  ["Landed-cost comparison", Scale],
  ["Purchase orders", ReceiptText],
  ["Supplier scorecards", Truck],
  ["Products & materials", Package],
  ["Spend analytics", BarChart3],
  ["AI Insights", Sparkles],
  ["Team & permissions", Users],
  ["Approval rules", ShieldCheck],
  ["Audit trail", History],
];

function Row({ rev }: { rev?: boolean }) {
  const list = rev ? [...ITEMS].reverse() : ITEMS;
  return (
    <div className="flex overflow-hidden">
      <div className={`flex shrink-0 gap-4 pr-4 ${rev ? "animate-marquee-rev" : "animate-marquee"}`}>
        {[...list, ...list].map(([label, Icon], i) => (
          <span key={`${label}-${i}`} className="flex items-center gap-3 whitespace-nowrap rounded-full border border-white/10 bg-white/5 px-6 py-3.5 text-lg font-medium text-white/90">
            <Icon className="h-5 w-5 text-cyan" />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

const STATS = [
  { value: ROLES.length, label: "roles, each with its own limits" },
  { value: Object.keys(PERMISSION_LABEL).length, label: "permissions you can actually point at" },
  { value: 4, label: "kinds of AI insight, all with evidence" },
  { value: FLOW_STEPS.length, label: "stages from request to review" },
];

export function Band() {
  return (
    <section className="relative bg-navy pb-24 pt-32 sm:pt-40">
      <div className="marquee-pause space-y-4 [mask-image:linear-gradient(90deg,transparent,black_12%,black_88%,transparent)]">
        <Row />
        <Row rev />
      </div>

      <div className="mx-auto mt-24 max-w-[1400px] px-5 sm:px-8">
        <Reveal>
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-[32px] border border-white/10 bg-white/10 lg:grid-cols-4">
            {STATS.map((s) => (
              <div key={s.label} className="bg-navy px-6 py-12 text-center sm:py-16">
                <dd>
                  <CountUp to={s.value} className="animate-gradient-pan text-gradient-brand-dark block text-7xl font-semibold leading-none sm:text-8xl" />
                </dd>
                <dt className="mx-auto mt-5 max-w-[16rem] text-base leading-snug text-navy-muted sm:text-lg">{s.label}</dt>
              </div>
            ))}
          </dl>
        </Reveal>
      </div>
    </section>
  );
}
