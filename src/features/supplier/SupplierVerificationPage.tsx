import { Check, Clock, FileUp, Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import { PageHero } from "@/components/supplier/PageHero";
import { SupplierShell, useSupplier } from "@/components/supplier/SupplierShell";
import { SharePassportPanel } from "./SharePassportPanel";
import { TrustPassport, TYPE_TITLE, fmtDate } from "@/components/trust/TrustPassport";
import { fieldClass } from "@/components/onboarding/fields";
import { checkGstin, gstinProblem } from "@/lib/gstin";
import {
  ALLOWED_MIME, MAX_FILE_BYTES, loadPassport, loadProofs, openDocument, submitProof, withdrawProof,
  type CheckType, type ProofRow, type TrustPassport as Passport, type UdyamActivity, type UdyamSize,
} from "@/lib/verification-api";
import { udyamProblem } from "@/lib/msme-payments";
import { cn } from "@/lib/utils";

const ctaBtn =
  "btn-shine flex items-center justify-center gap-1.5 rounded-md bg-gradient-cta px-5 py-2.5 text-sm font-semibold text-white shadow-glow transition hover:scale-[1.01] disabled:opacity-60 disabled:hover:scale-100";
const outlineBtn = "rounded-md border border-input bg-white px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-muted/60 disabled:opacity-60";

const INTRO: Record<CheckType, { title: string; why: string }> = {
  registration: { title: "Business registration (GST)", why: "Buyers check this first. We verify the number instantly, so typos are caught before you wait." },
  address: { title: "Business address", why: "Upload an electricity bill, rent agreement or property tax receipt that shows this address." },
  bank: { title: "Bank account", why: "Upload a cancelled cheque or bank letter. We keep only the IFSC and the last 4 digits." },
  certificate: { title: "Quality certificates", why: "ISO, BIS, FSSAI and others. Each certificate is checked on its own and shown with its expiry." },
  udyam: { title: "Udyam (MSME) registration", why: "Free to add. It shows buyers you are a micro or small enterprise, and switches on the 45-day payment protection: buyers must pay you within 45 days or lose their tax deduction." },
};

const STATUS_TEXT: Record<string, { t: string; cls: string }> = {
  submitted: { t: "Waiting for review", cls: "tint-amber" },
  in_review: { t: "Being reviewed now", cls: "tint-blue" },
  verified: { t: "Verified", cls: "tint-emerald" },
  rejected: { t: "Needs a fix", cls: "tint-amber" },
  expired: { t: "Expired", cls: "tint-amber" },
};

export function SupplierVerificationPage() {
  return (
    <SupplierShell>
      <PassportContent />
    </SupplierShell>
  );
}

function PassportContent() {
  // The supplier's own company comes from the shell, which reads it from the database for the signed-in supplier.
  const { status, summary, reload: reloadShell } = useSupplier();
  const orgId = summary?.id ?? null;
  const [proofs, setProofs] = useState<ProofRow[]>([]);
  const [passport, setPassport] = useState<Passport | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async (id: string) => {
    const [p, pp] = await Promise.all([loadProofs(id), loadPassport(id)]);
    setProofs(p);
    setPassport(pp);
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
        await reload(orgId);
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : "Something went wrong. Please refresh.");
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [status, orgId, reload]);

  const latest = (t: CheckType) => proofs.filter((p) => p.type === t);

  return (
    <div className="space-y-6">
      <PageHero label="Trust Passport" icon={ShieldCheck} title="Your Trust Passport" glow="glow-emerald">
        Each proof is checked separately and shown to buyers with its date. The more you prove, the higher buyers rank you.
      </PageHero>
      <div>

        {loading ? (
          <p className="mt-10 flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>
        ) : error ? (
          <p role="alert" className="mt-8 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</p>
        ) : summary && passport ? (
          <>
            <p className="mt-8 text-sm font-semibold text-muted-foreground">This is what buyers see</p>
            <TrustPassport passport={passport} className="mt-2" />
            <SharePassportPanel orgId={summary.id} name={summary.name} level={passport.level} />

            <div className="mt-8 space-y-5">
              {(["registration", "address", "bank", "udyam", "certificate"] as CheckType[]).map((t) => (
                <ProofCard key={t} type={t} rows={latest(t)} orgId={summary.id} orgState={summary.state} onChanged={async () => { await reload(summary.id); reloadShell(); }} />
              ))}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

function ProofCard({ type, rows, orgId, orgState, onChanged }: { type: CheckType; rows: ProofRow[]; orgId: string; orgState: string; onChanged: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const intro = INTRO[type];
  // for single-proof types the newest row decides the headline; certificates list all
  const head = type === "certificate" ? null : rows[0];
  const busy = rows.some((r) => r.status === "submitted" || r.status === "in_review");
  const canAdd = type === "certificate" ? true : !busy;
  const needsAction = !head || head.status === "rejected" || head.status === "expired";
  const soon = head?.status === "verified" && head.expires_at && new Date(head.expires_at).getTime() - Date.now() < 30 * 86400_000;

  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{intro.title}</h2>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">{intro.why}</p>
        </div>
        {head ? <Badge status={head.status} /> : null}
      </div>

      {head ? <ProofLine row={head} onChanged={onChanged} /> : null}
      {type === "certificate" ? rows.map((r) => <ProofLine key={r.id} row={r} onChanged={onChanged} />) : null}
      {soon ? <p className="mt-3 flex items-center gap-1.5 text-sm text-amber-700"><Clock className="h-4 w-4" /> Expires {fmtDate(head!.expires_at)}. Renew it to stay visible to buyers.</p> : null}

      {canAdd && !open ? (
        <button type="button" onClick={() => setOpen(true)} className={cn("mt-4", needsAction || type === "certificate" || soon ? ctaBtn : outlineBtn)}>
          {type === "certificate" ? "Add a certificate" : head?.status === "verified" ? "Renew" : head?.status === "rejected" ? "Fix and resubmit" : "Start"}
        </button>
      ) : null}
      {open ? <ProofForm type={type} orgId={orgId} orgState={orgState} onDone={async () => { setOpen(false); await onChanged(); }} onCancel={() => setOpen(false)} /> : null}
    </section>
  );
}

function Badge({ status }: { status: string }) {
  const s = STATUS_TEXT[status];
  return s ? <span className={cn("rounded-full px-3 py-1 text-xs font-semibold", s.cls)}>{s.t}</span> : null;
}

function ProofLine({ row, onChanged }: { row: ProofRow; onChanged: () => Promise<void> }) {
  const [err, setErr] = useState("");
  const [working, setWorking] = useState(false);
  const act = async (fn: () => Promise<unknown>) => {
    setErr(""); setWorking(true);
    try { await fn(); } catch (e) { setErr(e instanceof Error ? e.message : "Something went wrong."); } finally { setWorking(false); }
  };
  return (
    <div className="mt-4 rounded-xl border border-border bg-muted/30 p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{row.type === "certificate" || row.type === "bank" || row.type === "udyam" ? row.label : TYPE_TITLE[row.type]}{row.reference && row.type !== "address" ? ` · ${row.reference}` : ""}</span>
        <Badge status={row.status} />
      </div>
      {row.status === "verified" ? <p className="mt-1 text-muted-foreground">Verified {fmtDate(row.reviewed_at)} · valid until {fmtDate(row.expires_at)}</p> : null}
      {row.status === "rejected" && row.review_note ? (
        <p className="mt-2 flex gap-1.5 rounded-lg bg-amber-50 p-2.5 text-amber-900"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" /> {row.review_note}</p>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2">
        {row.doc_name ? <button type="button" disabled={working} className="text-sm font-semibold text-primary hover:underline" onClick={() => act(async () => window.open(await openDocument(row.id), "_blank", "noopener,noreferrer"))}>View document</button> : null}
        {row.status === "submitted" ? <button type="button" disabled={working} className="text-sm font-semibold text-muted-foreground hover:text-foreground" onClick={() => act(async () => { await withdrawProof(row.id); await onChanged(); })}>Withdraw</button> : null}
      </div>
      {err ? <p role="alert" className="mt-2 text-destructive">{err}</p> : null}
    </div>
  );
}

function ProofForm({ type, orgId, orgState, onDone, onCancel }: { type: CheckType; orgId: string; orgState: string; onDone: () => Promise<void>; onCancel: () => void }) {
  const [v, setV] = useState({ reference: "", label: "", issuer: "", issuedOn: "", expiresOn: "" });
  const [udSize, setUdSize] = useState<UdyamSize | "">("");
  const [udAct, setUdAct] = useState<UdyamActivity | "">("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));

  const gst = useMemo(() => (type === "registration" ? checkGstin(v.reference, orgState) : null), [type, v.reference, orgState]);
  const gstMsg = type === "registration" ? gstinProblem(v.reference) : "";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr("");
    if (!file) return setErr("Please choose the document to upload.");
    if (type === "registration" && gstMsg) return setErr(gstMsg || "Enter your GST number.");
    if (type === "udyam" && udyamProblem(v.reference)) return setErr(udyamProblem(v.reference));
    if (type === "udyam" && (!udSize || !udAct)) return setErr("Choose your enterprise size and what you do, exactly as on your Udyam certificate.");
    setBusy(true);
    try {
      await submitProof({
        orgId, type, file, ...v, label: type === "certificate" || type === "bank" ? v.label : "",
        ...(type === "udyam" ? { udyamSize: udSize as UdyamSize, udyamActivity: udAct as UdyamActivity } : {}),
      });
      await onDone();
    } catch (x) {
      setErr(x instanceof Error ? x.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-4 space-y-3 rounded-xl border border-border p-4">
      {type === "registration" ? (
        <label className="block text-sm font-medium">GST number
          <input className={cn(fieldClass, "mt-1 uppercase")} value={v.reference} onChange={set("reference")} maxLength={15} placeholder="29ABCDE1234F1Z5" autoComplete="off" />
          {gstMsg ? <span className="mt-1 block text-sm text-destructive">{gstMsg}</span> : null}
          {gst?.checksumOk && gst.stateName ? (
            <span className="mt-1 flex items-center gap-1 text-sm text-emerald-700"><Check className="h-4 w-4" /> Valid number · registered in {gst.stateName}
              {gst.stateMatches === false ? <span className="ml-1 text-amber-700">(your profile says {orgState}; a reviewer will confirm)</span> : null}</span>
          ) : null}
        </label>
      ) : null}
      {type === "address" ? (
        <label className="block text-sm font-medium">Full business address
          <textarea className={cn(fieldClass, "mt-1 min-h-20")} value={v.reference} onChange={set("reference")} maxLength={300} />
        </label>
      ) : null}
      {type === "bank" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium">IFSC code
            <input className={cn(fieldClass, "mt-1 uppercase")} value={v.reference} onChange={set("reference")} maxLength={11} placeholder="HDFC0001234" />
          </label>
          <label className="block text-sm font-medium">Last 4 digits of the account number
            <input className={cn(fieldClass, "mt-1")} value={v.label} onChange={set("label")} maxLength={4} inputMode="numeric" placeholder="1234" />
          </label>
        </div>
      ) : null}
      {type === "udyam" ? (
        <div className="space-y-3">
          <label className="block text-sm font-medium">Udyam registration number
            <input className={cn(fieldClass, "mt-1 uppercase")} value={v.reference} onChange={set("reference")} maxLength={19} placeholder="UDYAM-MH-12-1234567" autoComplete="off" />
            {udyamProblem(v.reference) && v.reference ? <span className="mt-1 block text-sm text-destructive">{udyamProblem(v.reference)}</span> : null}
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-medium">Enterprise size
              <select className={cn(fieldClass, "mt-1")} value={udSize} onChange={(e) => setUdSize(e.target.value as UdyamSize | "")}>
                <option value="">Choose…</option>
                <option value="micro">Micro</option>
                <option value="small">Small</option>
                <option value="medium">Medium</option>
              </select>
            </label>
            <label className="block text-sm font-medium">Main activity
              <select className={cn(fieldClass, "mt-1")} value={udAct} onChange={(e) => setUdAct(e.target.value as UdyamActivity | "")}>
                <option value="">Choose…</option>
                <option value="manufacturing">Manufacturing</option>
                <option value="services">Services</option>
                <option value="trade">Trading</option>
              </select>
            </label>
          </div>
          <p className="text-xs text-muted-foreground">Upload your Udyam certificate. A reviewer checks the number, size and activity against it. Be accurate: buyers' tax rules depend on this, and a wrong answer is rejected.</p>
        </div>
      ) : null}
      {type === "certificate" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium">Certificate name
            <input className={cn(fieldClass, "mt-1")} value={v.label} onChange={set("label")} maxLength={80} placeholder="ISO 9001:2015" />
          </label>
          <label className="block text-sm font-medium">Certificate number
            <input className={cn(fieldClass, "mt-1")} value={v.reference} onChange={set("reference")} maxLength={80} />
          </label>
          <label className="block text-sm font-medium">Issued by
            <input className={cn(fieldClass, "mt-1")} value={v.issuer} onChange={set("issuer")} maxLength={120} placeholder="TÜV SÜD" />
          </label>
          <label className="block text-sm font-medium">Expires on
            <input type="date" className={cn(fieldClass, "mt-1")} value={v.expiresOn} onChange={set("expiresOn")} />
          </label>
        </div>
      ) : null}

      <label className="block text-sm font-medium">Document (PDF, JPG or PNG, up to {MAX_FILE_BYTES / 1024 / 1024} MB)
        <span className="mt-1 flex items-center gap-2">
          <FileUp className="h-4 w-4 text-muted-foreground" />
          <input type="file" accept={ALLOWED_MIME.join(",")} onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm" />
        </span>
      </label>
      <p className="text-xs text-muted-foreground">Your document is stored privately. Only our review team can open it, and every viewing is logged.</p>
      {err ? <p role="alert" className="text-sm text-destructive">{err}</p> : null}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className={ctaBtn}>{busy ? "Submitting…" : "Submit for review"}</button>
        <button type="button" onClick={onCancel} disabled={busy} className={outlineBtn}>Cancel</button>
      </div>
    </form>
  );
}
