import { getSupabase } from "@/lib/supabase";

/**
 * The Trust Passport, browser side. The browser only asks and displays: what a proof needs, who may decide, and what
 * a buyer is allowed to see are all enforced in the database (supabase/migrations/20261115000004_trust_passport.sql).
 * Documents live in a PRIVATE bucket and open only through links that expire after a minute. There is no public URL.
 */

export type CheckType = "registration" | "address" | "bank" | "certificate" | "udyam";
export type UdyamSize = "micro" | "small" | "medium";
export type UdyamActivity = "manufacturing" | "services" | "trade";
export type CheckStatus = "draft" | "submitted" | "in_review" | "verified" | "rejected" | "superseded" | "expired";

/**
 * A random file id. crypto.randomUUID only exists on https or localhost, so on a LAN address like http://192.168.1.33:8081
 * it is missing ("crypto.randomUUID is not a function"). getRandomValues works everywhere, so fall back to it.
 */
function fileId(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === "function") return c.randomUUID();
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const BUCKET = "verification-docs";
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const ALLOWED_MIME = ["application/pdf", "image/jpeg", "image/png"];

export interface ProofRow {
  id: string;
  type: CheckType;
  label: string;
  reference: string;
  issuer: string;
  expires_at: string | null;
  status: CheckStatus;
  doc_name: string | null;
  review_note: string | null;
  reviewed_at: string | null;
  submitted_at: string | null;
  created_at: string;
  udyam_size?: UdyamSize | null;
  udyam_activity?: UdyamActivity | null;
}

export interface PassportCheck {
  type: CheckType;
  label: string;
  reference: string;
  issuer: string;
  verified_on: string | null;
  expires_at: string | null;
  /** HOW it was checked: the live government record (and the name matched), or a document a Vendora reviewer read. */
  evidence?: "government_record" | "document_reviewed";
  record_checked_on?: string | null;
  /** Udyam proofs only: the size and activity a reviewer checked against the certificate. */
  size?: UdyamSize;
  activity?: UdyamActivity;
}
export interface TrustPassport {
  level: 0 | 1 | 2 | 3;
  level_name: string;
  valid_through: string | null;
  checks: PassportCheck[];
}

/** What the government record said, recorded by the gst-lookup Edge Function (never written by the browser). */
export interface GstLookup {
  outcome: "ok" | "not_found" | "unavailable";
  legal_name?: string | null;
  trade_name?: string | null;
  gst_status?: string | null;
  registered_on?: string | null;
  cancelled_on?: string | null;
  constitution?: string | null;
  taxpayer_type?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  nature_of_business?: string | null;
  block_status?: string | null;
  name_match?: "match" | "partial" | "mismatch" | "unknown";
  fetched_at?: string;
}

/** The government record shown to the supplier while they type their GST number (GST Instant Identity). */
export interface GstPreview extends GstLookup {
  gstin: string;
  /** The company name the supplier gave Vendora, so the form can say "matches" or "does not match". */
  your_name?: string | null;
  state_matches?: boolean | null;
  /** Another Vendora company already has this GST number in review or verified. */
  already_claimed?: boolean;
}
export type GstPreviewResult =
  | { status: "ok"; data: GstPreview }
  | { status: "not_found" }
  | { status: "unavailable" | "not_configured" | "too_soon" | "daily_limit" | "not_allowed" };

/** Reviewer operations: what is stuck, what failed, whether the daily expiry job is alive. */
export interface OpsStats {
  open: number;
  waiting_over_24h: number;
  oldest_waiting_hours: number | null;
  stale_claims: number;
  lookup_failures_24h: number;
  no_live_result: number;
  expiring_30d: number;
  expiry_job_last_run: string | null;
  expiry_job_healthy: boolean;
  reviewers: { name: string; open_claims: number; oldest_claim_hours: number }[];
}

export interface QueueItem {
  id: string;
  org_id: string;
  org_name: string;
  org_state: string;
  type: CheckType;
  label: string;
  reference: string;
  issuer: string;
  issued_on: string | null;
  expires_at: string | null;
  doc_name: string | null;
  status: CheckStatus;
  auto_flags: { format_ok?: boolean; checksum_ok?: boolean; state_name?: string | null; state_matches?: boolean | null; pan?: string | null };
  submitted_at: string | null;
  waiting_hours: number | null;
  claimed_by_me: boolean | null;
  claimed_by_name: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  duplicate_gstin: boolean;
  lookup?: GstLookup | null;
  /** When the supplier confirmed "this is my business" against the live record. */
  supplier_confirmed_at?: string | null;
}

/** Turns "ERROR: invalid_gstin: the GST number has a typo" into just the sentence after the code. */
function friendly(err: { message?: string } | null, fallback: string): string {
  const m = err?.message ?? "";
  const hit = m.match(/^[a-z_]+: (.+)$/);
  if (hit?.[1]) return hit[1];
  const known: Record<string, string> = {
    not_allowed: "You don't have permission to do that.",
    not_a_draft: "This proof was already submitted.",
    not_yours: "Claim this proof first.",
    not_claimable: "Someone else already has this proof.",
    invalid_path: "That file could not be linked to this proof.",
    too_many_certificates: "You have reached the limit of 20 certificates.",
    invalid_decision: "Pick verify or reject.",
    gst_not_active: "The government record shows this registration is not active, so it cannot be verified. Reject it with a note.",
  };
  const key = Object.keys(known).find((k) => m.includes(k));
  return (key && known[key]) || fallback;
}

export async function loadProofs(orgId: string): Promise<ProofRow[]> {
  const { data, error } = await getSupabase()
    .from("verification_checks")
    .select("id, type, label, reference, issuer, expires_at, status, doc_name, review_note, reviewed_at, submitted_at, created_at, udyam_size, udyam_activity")
    .eq("org_id", orgId)
    .neq("status", "superseded")
    .order("created_at", { ascending: false });
  if (error) throw new Error("We couldn't load your proofs. Please refresh.");
  return (data ?? []) as ProofRow[];
}

export async function loadPassport(orgId: string): Promise<TrustPassport> {
  const { data, error } = await getSupabase().rpc("get_trust_passport", { p_org: orgId });
  if (error) throw new Error("We couldn't load this Trust Passport.");
  return data as TrustPassport;
}

export interface NewProof {
  orgId: string;
  type: CheckType;
  label?: string;
  reference?: string;
  issuer?: string;
  issuedOn?: string;
  expiresOn?: string;
  udyamSize?: UdyamSize;
  udyamActivity?: UdyamActivity;
  /** GST proofs: the supplier saw the live government record and confirmed it is their business. */
  confirmedIdentity?: boolean;
  file: File;
}

/** Create the proof, upload the file into the private bucket, attach it, submit. Each step is checked by the database. */
export async function submitProof(p: NewProof): Promise<string> {
  if (!ALLOWED_MIME.includes(p.file.type)) throw new Error("Please upload a PDF, JPG or PNG file.");
  if (p.file.size > MAX_FILE_BYTES) throw new Error("The file is larger than 10 MB. Please upload a smaller one.");
  if (p.file.size === 0) throw new Error("The file is empty.");
  const sb = getSupabase();
  const { data: id, error } =
    p.type === "udyam"
      ? await sb.rpc("start_udyam_check", {
          p_org: p.orgId, p_number: p.reference ?? "", p_size: p.udyamSize ?? "", p_activity: p.udyamActivity ?? "",
        })
      : await sb.rpc("start_check", {
          p_org: p.orgId, p_type: p.type, p_label: p.label ?? "", p_reference: p.reference ?? "", p_issuer: p.issuer ?? "",
          p_issued_on: p.issuedOn || null, p_expires_on: p.expiresOn || null,
        });
  if (error || !id) throw new Error(friendly(error, "We couldn't start this proof. Please check the details."));
  const ext = p.file.type === "application/pdf" ? "pdf" : p.file.type === "image/png" ? "png" : "jpg";
  const path = `${p.orgId}/${id}/${fileId()}.${ext}`;
  const up = await sb.storage.from(BUCKET).upload(path, p.file, { contentType: p.file.type, upsert: false });
  if (up.error) throw new Error("The upload didn't go through. Check your connection and try again.");
  const att = await sb.rpc("attach_document", { p_check: id, p_path: path, p_name: p.file.name });
  if (att.error) throw new Error(friendly(att.error, "We couldn't attach the file."));
  const sub = await sb.rpc("submit_check", { p_check: id });
  if (sub.error) throw new Error(friendly(sub.error, "We couldn't submit this proof."));
  // The confirmation and the live government check run in the background. They can never delay or fail the submission.
  if (p.type === "registration") {
    void (async () => {
      if (p.confirmedIdentity) await confirmGstIdentity(id as string);
      await requestGstLookup(id as string);
    })();
  }
  return id as string;
}

/** Records that the supplier saw the government record and said "this is my business". Never throws. */
export async function confirmGstIdentity(checkId: string): Promise<void> {
  try {
    await getSupabase().rpc("confirm_gst_identity", { p_check: checkId });
  } catch {
    /* the reviewer still checks the proof by hand */
  }
}

/**
 * GST Instant Identity: asks the gst-preview Edge Function for the government record of a GST number while the supplier
 * is still filling in the form. Never throws: if it is not deployed or the provider is down, the form just shows no record.
 */
export async function previewGst(orgId: string, gstin: string): Promise<GstPreviewResult> {
  try {
    const { data, error } = await getSupabase().functions.invoke("gst-preview", { body: { org_id: orgId, gstin: gstin.trim().toUpperCase() } });
    if (error) return { status: "unavailable" };
    const r = data as { status?: string; data?: GstPreview } | null;
    if (r?.status === "ok" && r.data) return { status: "ok", data: r.data };
    if (r?.status === "not_found") return { status: "not_found" };
    if (r?.status === "too_soon" || r?.status === "daily_limit" || r?.status === "not_configured" || r?.status === "not_allowed") return { status: r.status };
    return { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}

/**
 * Asks the gst-lookup Edge Function to check a GST proof against the government record. Never throws:
 * if the function is not deployed, the provider is down or a limit is hit, the reviewer simply checks by hand.
 */
export async function requestGstLookup(checkId: string): Promise<string> {
  try {
    const { data, error } = await getSupabase().functions.invoke("gst-lookup", { body: { check_id: checkId } });
    if (error) return "unavailable";
    return typeof (data as { status?: unknown } | null)?.status === "string" ? (data as { status: string }).status : "unavailable";
  } catch {
    return "unavailable";
  }
}

export async function withdrawProof(id: string): Promise<void> {
  const { error } = await getSupabase().rpc("withdraw_check", { p_check: id });
  if (error) throw new Error(friendly(error, "We couldn't withdraw this proof."));
}

/** The database logs the viewing, then storage hands out a link that stops working after 60 seconds. */
export async function openDocument(checkId: string): Promise<string> {
  const sb = getSupabase();
  const { data: path, error } = await sb.rpc("record_document_view", { p_check: checkId });
  if (error || !path) throw new Error("You can't open this document.");
  const { data, error: e2 } = await sb.storage.from(BUCKET).createSignedUrl(path as string, 60);
  if (e2 || !data?.signedUrl) throw new Error("We couldn't open the document.");
  return data.signedUrl;
}

// ── reviewers ──
export async function isReviewer(): Promise<boolean> {
  const { data, error } = await getSupabase().rpc("is_platform_admin");
  return !error && data === true;
}
export async function loadQueue(scope: "open" | "done"): Promise<QueueItem[]> {
  const { data, error } = await getSupabase().rpc("admin_queue", { p_scope: scope });
  if (error) throw new Error(friendly(error, "We couldn't load the queue."));
  return (data ?? []) as QueueItem[];
}
export async function loadOpsStats(): Promise<OpsStats> {
  const { data, error } = await getSupabase().rpc("admin_ops_stats");
  if (error) throw new Error(friendly(error, "We couldn't load the review health numbers."));
  return data as OpsStats;
}
/** Gives claims that nobody touched for `hours` back to the queue. Returns how many were released. */
export async function releaseStaleClaims(hours = 24): Promise<number> {
  const { data, error } = await getSupabase().rpc("admin_release_stale", { p_hours: hours });
  if (error) throw new Error(friendly(error, "We couldn't release the stale claims."));
  return Number(data ?? 0);
}
export async function claimProof(id: string): Promise<void> {
  const { error } = await getSupabase().rpc("admin_claim_check", { p_check: id });
  if (error) throw new Error(friendly(error, "We couldn't claim this proof."));
}
export async function releaseProof(id: string): Promise<void> {
  const { error } = await getSupabase().rpc("admin_release_check", { p_check: id });
  if (error) throw new Error(friendly(error, "We couldn't release this proof."));
}
export async function decideProof(id: string, decision: "verify" | "reject", note: string, expiresOn?: string): Promise<void> {
  const { error } = await getSupabase().rpc("admin_decide", { p_check: id, p_decision: decision, p_note: note, p_expires_on: expiresOn || null });
  if (error) throw new Error(friendly(error, "We couldn't save the decision."));
}
