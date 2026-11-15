import { BadgeCheck, CalendarClock, FileCheck2, Landmark, MapPin, ShieldQuestion, Sprout } from "lucide-react";

import { SaveButton } from "@/components/directory/SaveButton";
import { fmtDate } from "@/components/trust/TrustPassport";
import type { DirectorySupplier } from "@/lib/directory-api";
import { hoursText } from "@/lib/fair-rank-api";
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

      <Record s={s} />

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

/**
 * The earned record, in plain numbers a buyer can check. A number appears only once it rests on 3 real data points; before
 * that the card says so, instead of showing a figure that means nothing.
 */
function Record({ s }: { s: DirectorySupplier }) {
  if (s.level < 1 || s.fair_score === undefined) return null;
  const facts: string[] = [];
  if (s.reply_hours !== null && s.reply_hours !== undefined) facts.push(`Replies in ${hoursText(s.reply_hours)}`);
  if (s.answered_pct !== null && s.answered_pct !== undefined) facts.push(`${s.answered_pct}% of RFQs answered`);
  if (s.on_time_pct !== null && s.on_time_pct !== undefined) facts.push(`${s.on_time_pct}% delivered on time`);
  if (facts.length === 0) {
    return (
      <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-muted/60 px-2.5 py-1.5 text-xs text-muted-foreground">
        <Sprout className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>{s.is_new ? "New on Vendora. Their record builds with real RFQs and orders." : "Record is still building. Shown once there are enough real RFQs and orders."}</span>
      </p>
    );
  }
  return (
    <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Record from real RFQs and orders">
      {facts.map((f) => (
        <li key={f} className="rounded-full tint-emerald px-2.5 py-0.5 text-xs font-medium">{f}</li>
      ))}
    </ul>
  );
}
