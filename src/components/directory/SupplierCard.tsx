import { BadgeCheck, CalendarClock, FileCheck2, Landmark, MapPin, ShieldQuestion } from "lucide-react";

import { SaveButton } from "@/components/directory/SaveButton";
import { fmtDate } from "@/components/trust/TrustPassport";
import type { DirectorySupplier } from "@/lib/directory-api";
import { AppLink } from "@/lib/nav";
import { cn } from "@/lib/utils";

/** How this supplier was checked, in one honest line. Never blur a government record with a reviewed document. */
function evidenceOf(s: DirectorySupplier): { text: string; icon: typeof Landmark } | null {
  if (s.level === 0) return null;
  return s.government_checked
    ? { text: "Government record checked", icon: Landmark }
    : { text: "Document reviewed", icon: FileCheck2 };
}

export function SupplierCard({ s }: { s: DirectorySupplier }) {
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

      <div className="mt-auto flex items-end justify-between gap-3 pt-4">
        {shown.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5" aria-label="Categories">
            {shown.map((c) => <li key={c} className="rounded-full tint-slate px-2.5 py-0.5 text-xs font-medium">{c}</li>)}
            {s.categories.length > shown.length ? <li className="px-1 py-0.5 text-xs text-muted-foreground">+{s.categories.length - shown.length} more</li> : null}
          </ul>
        ) : <span />}
        <SaveButton supplierId={s.org_id} name={s.name} />
      </div>
    </article>
  );
}
