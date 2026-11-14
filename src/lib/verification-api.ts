import { getSupabase } from "@/lib/supabase";

/**
 * The Trust Passport, browser side. The browser only asks and displays: what a proof needs, who may decide, and what
 * a buyer is allowed to see are all enforced in the database (supabase/migrations/20261115000004_trust_passport.sql).
 * Documents live in a PRIVATE bucket and open only through links that expire after a minute. There is no public URL.
 */

export type CheckType = "registration" | "address" | "bank" | "certificate";
export type CheckStatus = "draft" | "submitted" | "in_review" | "verified" | "rejected" | "superseded" | "expired";

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
}

export interface PassportCheck {
  type: CheckType;
  label: string;
  reference: string;
  issuer: string;
  verified_on: string | null;
  expires_at: string | null;
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
  name_match?: "match" | "partial" | "mismatch" | "unknown";
  fetched_at?: string;
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
    .select("id, type, label, reference, issuer, expires_at, status, doc_name, review_note, reviewed_at, submitted_at, created_at")
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
  file: File;
}

/** Create the proof, upload the file into the private bucket, attach it, submit. Each step is checked by the database. */
export async function submitProof(p: NewProof): Promise<void> {
  if (!ALLOWED_MIME.includes(p.file.type)) throw new Error("Please upload a PDF, JPG or PNG file.");
  if (p.file.size > MAX_FILE_BYTES) throw new Error("The file is larger than 10 MB. Please upload a smaller one.");
  if (p.file.size === 0) throw new Error("The file is empty.");
  const sb = getSupabase();
  const { data: id, error } = await sb.rpc("start_check", {
    p_org: p.orgId, p_type: p.type, p_label: p.label ?? "", p_reference: p.reference ?? "", p_issuer: p.issuer ?? "",
    p_issued_on: p.issuedOn || null, p_expires_on: p.expiresOn || null,
  });
  if (error || !id) throw new Error(friendly(error, "We couldn't start this proof. Please check the details."));
  const ext = p.file.type === "application/pdf" ? "pdf" : p.file.type === "image/png" ? "png" : "jpg";
  const path = `${p.orgId}/${id}/${crypto.randomUUID()}.${ext}`;
  const up = await sb.storage.from(BUCKET).upload(path, p.file, { contentType: p.file.type, upsert: false });
  if (up.error) throw new Error("The upload didn't go through. Check your connection and try again.");
  const att = await sb.rpc("attach_document", { p_check: id, p_path: path, p_name: p.file.name });
  if (att.error) throw new Error(friendly(att.error, "We couldn't attach the file."));
  const sub = await sb.rpc("submit_check", { p_check: id });
  if (sub.error) throw new Error(friendly(sub.error, "We couldn't submit this proof."));
  // The live government check runs in the background. It can never delay or fail the submission.
  if (p.type === "registration") void requestGstLookup(id as string);
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
