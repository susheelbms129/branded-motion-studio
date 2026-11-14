import { AlertTriangle, Check, Clock, ExternalLink, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { TYPE_TITLE, fmtDate } from "@/components/trust/TrustPassport";
import { fieldClass } from "@/components/onboarding/fields";
import { cn } from "@/lib/utils";
import { claimProof, decideProof, loadOpsStats, loadQueue, openDocument, releaseProof, releaseStaleClaims, requestGstLookup, type GstLookup, type OpsStats, type QueueItem } from "@/lib/verification-api";

const ctaBtn = "btn-shine rounded-md bg-gradient-cta px-4 py-2 text-sm font-semibold text-white shadow-glow transition disabled:opacity-60";
const outlineBtn = "rounded-md border border-input bg-white px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-muted/60 disabled:opacity-60";

/** Reviewer screen. Oldest first, with what the database already checked, so a reviewer only does the human part. */
export function AdminVerificationPage() {
  const [scope, setScope] = useState<"open" | "done">("open");
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [stats, setStats] = useState<OpsStats | null>(null);

  const refresh = useCallback(async () => {
    try {
      setItems(await loadQueue(scope));
      setStats(await loadOpsStats().catch(() => null));   // health numbers never block the queue
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "We couldn't load the queue.");
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <main className="mx-auto max-w-4xl p-6 sm:p-10">
        <h1 className="text-3xl font-semibold">Verification review</h1>
        <p className="mt-1 text-muted-foreground">Oldest first. Take a proof, check the document against the details, then verify or reject with a reason.</p>
        {stats ? <OpsBar stats={stats} onChanged={refresh} /> : null}
        <div className="mt-6 flex gap-2" role="tablist">
          {(["open", "done"] as const).map((s) => (
            <button key={s} type="button" role="tab" aria-selected={scope === s} onClick={() => setScope(s)}
              className={cn("rounded-full px-4 py-1.5 text-sm font-semibold", scope === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
              {s === "open" ? "To review" : "Decided (30 days)"}
            </button>
          ))}
        </div>
        {loading ? <p className="mt-8 flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>
          : error ? <p role="alert" className="mt-8 text-destructive">{error}</p>
          : items.length === 0 ? <p className="mt-8 rounded-xl border border-border bg-card p-6 text-muted-foreground">{scope === "open" ? "The queue is empty. Nothing is waiting." : "Nothing decided in the last 30 days."}</p>
          : <ul className="mt-6 space-y-4">{items.map((it) => <Row key={it.id} it={it} onChanged={refresh} />)}</ul>}
      </main>
    </div>
  );
}

/** Health of the review operation: what is late, what is stuck, whether the nightly expiry job is alive. */
function OpsBar({ stats, onChanged }: { stats: OpsStats; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const problems = stats.waiting_over_24h > 0 || stats.stale_claims > 0 || !stats.expiry_job_healthy || stats.lookup_failures_24h > 0;
  const release = async () => {
    setBusy(true); setMsg("");
    try { const n = await releaseStaleClaims(24); setMsg(`${n} claim${n === 1 ? "" : "s"} given back to the queue.`); await onChanged(); }
    catch (e) { setMsg(e instanceof Error ? e.message : "Something went wrong."); }
    finally { setBusy(false); }
  };
  return (
    <section aria-label="Review health" className={cn("mt-6 rounded-xl border p-4 text-sm", problems ? "border-amber-300 bg-amber-50 text-amber-900" : "border-border bg-card")}>
      <p className="font-semibold">{problems ? "Needs attention" : "All healthy"}</p>
      <ul className="mt-1 grid gap-x-6 gap-y-0.5 sm:grid-cols-2">
        <li>{stats.open} open{stats.oldest_waiting_hours != null ? ` · oldest waiting ${Math.round(stats.oldest_waiting_hours)} h` : ""}</li>
        <li>{stats.waiting_over_24h} waiting more than 24 h</li>
        <li>{stats.stale_claims} claimed but untouched for 24 h</li>
        <li>{stats.lookup_failures_24h} live GST check{stats.lookup_failures_24h === 1 ? "" : "s"} failed in 24 h{stats.no_live_result > 0 ? ` · ${stats.no_live_result} without a live result` : ""}</li>
        <li>{stats.expiring_30d} proof{stats.expiring_30d === 1 ? "" : "s"} expiring within 30 days</li>
        <li className={stats.expiry_job_healthy ? "" : "font-semibold"}>
          Daily expiry job: {stats.expiry_job_last_run ? `last ran ${fmtDate(stats.expiry_job_last_run)}` : "has never run"}{stats.expiry_job_healthy ? "" : " (check your cron)"}
        </li>
      </ul>
      {stats.reviewers.length > 0 ? <p className="mt-1 text-muted-foreground">Workload: {stats.reviewers.map((r) => `${r.name} ${r.open_claims}`).join(" · ")}</p> : null}
      {stats.stale_claims > 0 ? <button type="button" disabled={busy} onClick={release} className="mt-2 font-semibold text-primary hover:underline">Give stale claims back to the queue</button> : null}
      {msg ? <p role="status" className="mt-1">{msg}</p> : null}
    </section>
  );
}

function Row({ it, onChanged }: { it: QueueItem; onChanged: () => Promise<void> }) {
  const [note, setNote] = useState("");
  const [expires, setExpires] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const mine = it.status === "in_review" && it.claimed_by_me;
  const taken = it.status === "in_review" && !it.claimed_by_me;
  const run = async (fn: () => Promise<unknown>) => {
    setErr(""); setBusy(true);
    try { await fn(); await onChanged(); } catch (e) { setErr(e instanceof Error ? e.message : "Something went wrong."); } finally { setBusy(false); }
  };
  const f = it.auto_flags;
  const late = (it.waiting_hours ?? 0) > 24;

  return (
    <li className="rounded-2xl border border-border bg-card p-5 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold">{it.org_name} <span className="font-normal text-muted-foreground">· {it.org_state || "state not set"}</span></p>
          <p className="text-sm text-muted-foreground">{it.type === "certificate" ? it.label : TYPE_TITLE[it.type]}</p>
        </div>
        {it.status === "verified" || it.status === "rejected" ? (
          <span className={cn("rounded-full px-3 py-1 text-xs font-semibold", it.status === "verified" ? "tint-emerald" : "tint-amber")}>{it.status === "verified" ? "Verified" : "Rejected"} {fmtDate(it.reviewed_at)}</span>
        ) : (
          <span className={cn("flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold", late ? "tint-amber" : "bg-muted text-muted-foreground")}><Clock className="h-3.5 w-3.5" /> waiting {Math.round(it.waiting_hours ?? 0)} h</span>
        )}
      </div>

      <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <div><dt className="inline text-muted-foreground">{it.type === "address" ? "Address: " : it.type === "bank" ? "IFSC: " : it.type === "certificate" ? "Certificate no.: " : "GST number: "}</dt><dd className="inline font-medium">{it.reference}</dd></div>
        {it.type === "bank" ? <div><dt className="inline text-muted-foreground">Account: </dt><dd className="inline font-medium">{it.label}</dd></div> : null}
        {it.type === "certificate" ? <div><dt className="inline text-muted-foreground">Issued by: </dt><dd className="inline font-medium">{it.issuer}</dd></div> : null}
        {it.expires_at && it.type === "certificate" ? <div><dt className="inline text-muted-foreground">Expires: </dt><dd className="inline font-medium">{fmtDate(it.expires_at)}</dd></div> : null}
      </dl>

      {it.type === "registration" ? (
        <ul className="mt-3 space-y-1 rounded-xl bg-muted/40 p-3 text-sm" aria-label="Automatic checks">
          <Flag ok={f.checksum_ok === true} text="Number format and checksum are valid" />
          <Flag ok={!!f.state_name} text={f.state_name ? `State code: ${f.state_name}` : "Unknown state code"} />
          <Flag ok={f.state_matches !== false} warn={f.state_matches === false} text={f.state_matches === false ? `State differs from the company profile (${it.org_state})` : "State matches the company profile"} />
          <Flag ok={!it.duplicate_gstin} text={it.duplicate_gstin ? "Another company has submitted this same GST number. Be careful." : "Not used by any other company"} />
          {f.pan ? <li className="text-muted-foreground">PAN inside the number: {f.pan}</li> : null}
        </ul>
      ) : null}

      {it.type === "registration" ? (
        <LiveCheck
          lookup={it.lookup ?? null}
          canRun={it.status === "submitted" || it.status === "in_review"}
          company={it.org_name}
          onRun={() => run(async () => { await requestGstLookup(it.id); })}
          busy={busy}
        />
      ) : null}

      {it.status === "rejected" && it.review_note ? <p className="mt-3 text-sm text-muted-foreground">Reason given: {it.review_note}</p> : null}

      {it.status === "submitted" || mine || taken ? (
        <div className="mt-4 space-y-3">
          {it.doc_name ? (
            <button type="button" disabled={busy} className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
              onClick={() => run(async () => window.open(await openDocument(it.id), "_blank", "noopener,noreferrer"))}>
              <ExternalLink className="h-4 w-4" /> Open document ({it.doc_name})
            </button>
          ) : null}
          {taken ? <p className="text-sm text-muted-foreground">{it.claimed_by_name ?? "Another reviewer"} is reviewing this.</p> : null}
          {it.status === "submitted" ? <button type="button" disabled={busy} className={ctaBtn} onClick={() => run(() => claimProof(it.id))}>Take this proof</button> : null}
          {mine ? (
            <>
              <label className="block text-sm font-medium">Note (the supplier can see it). Required to reject, and to verify when the live check shows a name mismatch, an unknown status or no record
                <textarea className={cn(fieldClass, "mt-1 min-h-16")} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="For example: the address on the bill does not match." />
              </label>
              {it.type !== "certificate" ? (
                <label className="block text-sm font-medium">Valid until (optional, default {it.type === "bank" ? "6 months" : "1 year"})
                  <input type="date" className={cn(fieldClass, "mt-1 max-w-48")} value={expires} onChange={(e) => setExpires(e.target.value)} />
                </label>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={busy} className={ctaBtn} onClick={() => run(() => decideProof(it.id, "verify", note, expires))}><Check className="mr-1 inline h-4 w-4" />Verify</button>
                <button type="button" disabled={busy || note.trim().length < 10} className={outlineBtn} onClick={() => run(() => decideProof(it.id, "reject", note))}>Reject</button>
                <button type="button" disabled={busy} className={outlineBtn} onClick={() => run(() => releaseProof(it.id))}>Give back</button>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
      {err ? <p role="alert" className="mt-3 text-sm text-destructive">{err}</p> : null}
    </li>
  );
}

function Flag({ ok, warn, text }: { ok: boolean; warn?: boolean; text: string }) {
  return (
    <li className={cn("flex items-start gap-2", ok ? "text-foreground" : warn ? "text-amber-800" : "text-destructive")}>
      {ok ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />} {text}
    </li>
  );
}

type MatchText = { t: string; ok: boolean; warn: boolean };
const UNKNOWN_MATCH: MatchText = { t: "could not be compared", ok: false, warn: true };
const MATCH_TEXT: Record<string, MatchText> = {
  match: { t: "matches the company name", ok: true, warn: false },
  partial: { t: "partly matches the company name. Check the document.", ok: false, warn: true },
  mismatch: { t: "does NOT match the company name", ok: false, warn: false },
};

/** The government record, fetched live. Absent or unavailable is fine: the reviewer checks by hand as before. */
function LiveCheck({ lookup, canRun, company, onRun, busy }: { lookup: GstLookup | null; canRun: boolean; company: string; onRun: () => void; busy: boolean }) {
  const final = lookup?.outcome === "ok" || lookup?.outcome === "not_found";
  const runBtn = canRun && !final ? (
    <button type="button" disabled={busy} onClick={onRun} className="text-sm font-semibold text-primary hover:underline">
      {lookup ? "Try the live check again" : "Run live check"}
    </button>
  ) : null;

  if (!lookup || lookup.outcome === "unavailable") {
    return (
      <div className="mt-3 rounded-xl bg-muted/40 p-3 text-sm" aria-label="Live government check">
        <p className="text-muted-foreground">Live government check: not available. Compare the document by hand.</p>
        {runBtn}
      </div>
    );
  }
  if (lookup.outcome === "not_found") {
    return (
      <div className="mt-3 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" aria-label="Live government check">
        <p className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> The government record has no taxpayer with this GST number. To verify anyway you must write a reason in the note.</p>
      </div>
    );
  }
  const active = (lookup.gst_status ?? "").toLowerCase() === "active";
  const unknownStatus = !lookup.gst_status || lookup.gst_status.toLowerCase() === "unknown";
  const m = MATCH_TEXT[lookup.name_match ?? "unknown"] ?? UNKNOWN_MATCH;
  return (
    <ul className="mt-3 space-y-1 rounded-xl bg-muted/40 p-3 text-sm" aria-label="Live government check">
      <li className="font-medium">Live government record{lookup.fetched_at ? ` (checked ${fmtDate(lookup.fetched_at)})` : ""}</li>
      <Flag ok={active} warn={unknownStatus} text={active ? "Registration is Active" : unknownStatus ? "The record gave no registration status. Check the GST portal and explain in the note." : `Registration is ${lookup.gst_status}${lookup.cancelled_on ? ` (since ${fmtDate(lookup.cancelled_on)})` : ""}. It cannot be verified.`} />
      <Flag ok={m.ok} warn={m.warn} text={`${lookup.legal_name || lookup.trade_name || "The registered name"} ${m.t}${m.ok ? "" : ` (${company})`}`} />
      {lookup.trade_name && lookup.legal_name ? <li className="text-muted-foreground">Trade name: {lookup.trade_name}</li> : null}
      {lookup.registered_on ? <li className="text-muted-foreground">Registered on {fmtDate(lookup.registered_on)}{lookup.constitution ? ` · ${lookup.constitution}` : ""}</li> : null}
    </ul>
  );
}
