import { AlertTriangle, Check, Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { fmtDate } from "@/components/trust/TrustPassport";
import { gstinProblem } from "@/lib/gstin";
import { previewGst, type GstPreview, type GstPreviewResult } from "@/lib/verification-api";
import { cn } from "@/lib/utils";

/** What the form needs to know to decide whether "Submit" may go ahead. */
export interface GstGate {
  checking: boolean;
  /** A live record is on screen, so the instant "registered in <state>" line can step aside. */
  hasRecord: boolean;
  /** Non-empty: this registration cannot be submitted (the government record says it is not active). */
  blockReason: string;
  /** The supplier must tick "this is my business" before submitting. */
  needsConfirm: boolean;
  confirmed: boolean;
}
export const GST_GATE_IDLE: GstGate = { checking: false, hasRecord: false, blockReason: "", needsConfirm: false, confirmed: false };

const MATCH: Record<string, { text: (yours: string) => string; tone: "ok" | "warn" | "bad" } | undefined> = {
  match: { text: () => "Matches your company name on Vendora", tone: "ok" },
  partial: { text: (y) => `Partly matches your company name on Vendora (${y}). A reviewer will compare them`, tone: "warn" },
  mismatch: { text: (y) => `Does not match your company name on Vendora (${y}). Check you entered the right GST number`, tone: "bad" },
};

function Row({ label, value, wide }: { label: string; value?: string | null | undefined; wide?: boolean }) {
  if (!value) return null;
  return (
    <div className={cn("min-w-0", wide && "sm:col-span-2")}>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-sm font-semibold text-foreground">{value}</dd>
    </div>
  );
}

/**
 * GST Instant Identity. The moment a valid GST number is typed, this fetches the government record and shows the
 * business identity (legal name, trade name, status, type, address ...) so the supplier can confirm it is theirs
 * BEFORE they submit. It only displays: the provider key, the limits and the stored result all live on the server.
 */
export function GstIdentityCard({ orgId, gstin, onGate }: { orgId: string; gstin: string; onGate: (g: GstGate) => void }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<GstPreviewResult | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const ticket = useRef(0);
  const gateRef = useRef(onGate);
  gateRef.current = onGate;

  const g = gstin.trim().toUpperCase();
  const valid = g.length === 15 && gstinProblem(g) === "";

  useEffect(() => {
    const mine = ++ticket.current;
    setConfirmed(false);
    setResult(null);
    if (!valid) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      const r = await previewGst(orgId, g);
      if (ticket.current !== mine) return; // the supplier kept typing: ignore the old answer
      setResult(r);
      setLoading(false);
    }, 350);
    return () => clearTimeout(t);
  }, [orgId, g, valid]);

  const rec: GstPreview | null = result?.status === "ok" ? result.data : null;
  const status = (rec?.gst_status ?? "").toLowerCase();
  const active = status === "active";
  const statusKnown = !!status && status !== "unknown";
  const blockReason = rec && statusKnown && !active
    ? `The government record shows this registration as ${rec.gst_status}${rec.cancelled_on ? ` since ${fmtDate(rec.cancelled_on)}` : ""}, so it cannot be verified. Use an active GST number.`
    : "";

  useEffect(() => {
    gateRef.current({ checking: loading, hasRecord: !!rec, blockReason, needsConfirm: !!rec && !blockReason, confirmed });
  }, [loading, rec, blockReason, confirmed]);

  if (!valid) return null;

  if (loading) {
    return (
      <div className="mt-3 flex items-center gap-2 rounded-xl border border-border bg-muted/30 p-3 text-sm text-muted-foreground" role="status">
        <Loader2 className="h-4 w-4 animate-spin" /> Looking up this GST number in the government records…
      </div>
    );
  }
  if (!result) return null;

  if (result.status === "not_found") {
    return (
      <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-900" role="status">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>We couldn't find a taxpayer with this GST number in the government records. Please check each character. If it is correct, you can still submit and a reviewer will check it by hand.</span>
      </div>
    );
  }
  if (!rec) {
    // unavailable, limits, not configured: stay quiet. The normal review path works exactly as before.
    return (
      <p className="mt-3 text-xs text-muted-foreground" role="status">
        {result.status === "too_soon" || result.status === "daily_limit"
          ? "Live GST lookup is busy right now. You can still submit and a reviewer will check it."
          : "Live GST lookup isn't available right now. You can still submit and a reviewer will check it."}
      </p>
    );
  }

  const m = MATCH[rec.name_match ?? "unknown"];
  const yours = rec.your_name ?? "your company";
  const warnings: { text: string; bad?: boolean }[] = [];
  if (m && m.tone !== "ok") warnings.push({ text: m.text(yours), bad: m.tone === "bad" });
  if (rec.state_matches === false) warnings.push({ text: `This GST number is registered in ${rec.state ?? "another state"}, which is different from the state on your Vendora profile.` });
  if ((rec.block_status ?? "").toLowerCase() === "blocked") warnings.push({ text: "The GST portal marks this registration as blocked for e-way bills. Buyers will see that, so sort it out with your GST officer.", bad: true });
  if (rec.already_claimed) warnings.push({ text: "This GST number is already linked to another Vendora company. If it is yours, you can still submit, but a reviewer will look at it closely.", bad: true });

  return (
    <section className="mt-3 rounded-2xl border border-border bg-card p-4 shadow-sm" aria-label="GST record from government records">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={cn("flex items-center gap-1.5 text-sm font-semibold", blockReason ? "text-destructive" : "text-emerald-700")}>
          {blockReason ? <ShieldAlert className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
          {blockReason ? "GST registration is not active" : "GST number found in government records"}
        </p>
        {rec.gst_status ? (
          <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold", active ? "tint-emerald" : "tint-amber")}>{rec.gst_status}</span>
        ) : null}
      </div>

      <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
        <Row label="Legal business name" value={rec.legal_name} wide />
        <Row label="Trade name" value={rec.trade_name && rec.trade_name !== rec.legal_name ? rec.trade_name : null} />
        <Row label="GST type" value={rec.taxpayer_type} />
        <Row label="Business type" value={rec.constitution} />
        <Row label="Registered on" value={rec.registered_on ? fmtDate(rec.registered_on) : null} />
        <Row label="Registered address" value={rec.address || [rec.city, rec.state, rec.pincode].filter(Boolean).join(", ")} wide />
        <Row label="Nature of business" value={rec.nature_of_business} wide />
        <Row label="GST number" value={rec.gstin} />
        <Row label="State" value={rec.state} />
      </dl>

      {warnings.length ? (
        <ul className="mt-3 space-y-1.5">
          {warnings.map((w) => (
            <li key={w.text} className={cn("flex items-start gap-2 rounded-lg px-3 py-2 text-sm", w.bad ? "bg-destructive/5 text-destructive" : "bg-amber-50 text-amber-900")}>
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {w.text}
            </li>
          ))}
        </ul>
      ) : m?.tone === "ok" ? (
        <p className="mt-3 flex items-center gap-1.5 text-sm text-emerald-700"><Check className="h-4 w-4" /> {m.text(yours)}</p>
      ) : null}

      {blockReason ? (
        <p role="alert" className="mt-3 text-sm text-destructive">{blockReason}</p>
      ) : (
        <label className="mt-3 flex cursor-pointer items-start gap-2.5 rounded-xl bg-muted/40 p-3 text-sm">
          <input type="checkbox" className="mt-0.5 h-4 w-4" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          <span>Yes, this is my business. This GST registration belongs to <strong>{rec.legal_name || "my company"}</strong>.</span>
        </label>
      )}
      <p className="mt-2 text-xs text-muted-foreground">Verified using GST records{rec.fetched_at ? ` · checked ${fmtDate(rec.fetched_at)}` : ""}. Upload your GST certificate below so a reviewer can complete the check.</p>
    </section>
  );
}
