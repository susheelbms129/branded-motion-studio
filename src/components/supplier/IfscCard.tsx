import { AlertTriangle, Landmark, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { IFSC_FORMAT, lookupIfsc, type IfscResult } from "@/lib/ifsc";

/** Shows the bank and branch for an IFSC code as soon as it is typed, so the supplier can spot a wrong code before submitting. */
export function IfscCard({ ifsc }: { ifsc: string }) {
  const code = ifsc.trim().toUpperCase();
  const valid = IFSC_FORMAT.test(code);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<IfscResult | null>(null);

  useEffect(() => {
    setResult(null);
    if (!valid) {
      setLoading(false);
      return;
    }
    let stale = false;
    setLoading(true);
    const t = setTimeout(async () => {
      const r = await lookupIfsc(code);
      if (stale) return;
      setResult(r);
      setLoading(false);
    }, 300);
    return () => { stale = true; clearTimeout(t); };
  }, [code, valid]);

  if (!valid) return null;
  if (loading) {
    return <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Looking up this IFSC code…</p>;
  }
  if (!result || result.status === "unavailable") return null;
  if (result.status === "not_found") {
    return (
      <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900" role="status">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> We couldn't find a bank branch with this IFSC code. Please check each character. You can still submit and a reviewer will check it.
      </p>
    );
  }
  const d = result.data;
  const modes = [d.neft && "NEFT", d.rtgs && "RTGS", d.imps && "IMPS", d.upi && "UPI"].filter(Boolean) as string[];
  const Field = ({ label, value, wide }: { label: string; value: string; wide?: boolean }) =>
    value ? (
      <div className={wide ? "sm:col-span-2" : ""}>
        <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
        <dd className="mt-0.5 break-words text-sm font-semibold">{value}</dd>
      </div>
    ) : null;
  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-sm" aria-label="Bank branch for this IFSC code">
      <p className="flex items-center gap-1.5 text-sm font-semibold text-emerald-700"><Landmark className="h-4 w-4" /> Bank branch found</p>
      <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
        <Field label="Bank name" value={d.bank} />
        <Field label="Branch name" value={d.branch} />
        <Field label="Branch address" value={d.address} wide />
        <Field label="City" value={d.city} />
        <Field label="State" value={d.state} />
        <Field label="MICR code" value={d.micr} />
        <Field label="Payment modes" value={modes.join(" · ")} />
      </dl>
      <p className="mt-2 text-xs text-muted-foreground">Check this is the bank and branch on your cancelled cheque.</p>
    </section>
  );
}
