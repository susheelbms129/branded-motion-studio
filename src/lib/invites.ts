import { getSupabase } from "@/lib/supabase";
import type { Role } from "@/types/domain";

/**
 * Invitation links, invited person's side. Everything that matters (is the link valid, does the
 * signed-in email match, which role is granted) is decided inside the database. The browser only
 * asks and displays. The role is never read from the URL or from anything the user can edit.
 */

export const isInviteToken = (t: string | null | undefined): t is string =>
  !!t && /^[0-9a-f]{64}$/.test(t);

export type DeadState = "invalid" | "expired" | "used" | "revoked";
export type PeekResult = { state: "valid"; maskedEmail: string } | { state: DeadState };
export type PreviewResult =
  | { state: "ok"; email: string; role: Role; orgName: string; inviterName: string }
  | { state: "wrong_email"; maskedEmail: string }
  | { state: "unverified" }
  | { state: DeadState };
export type AcceptResult =
  | { state: "ok" | "already_member"; orgId: string; orgName: string }
  | { state: "wrong_email"; maskedEmail: string }
  | { state: "unverified" }
  | { state: DeadState };

const PENDING_KEY = "vendora-pending-invite";
/** Remembered only so we can bring the person back to the invitation after they confirm their email. */
export const rememberInvite = (t: string) => {
  try {
    sessionStorage.setItem(PENDING_KEY, t);
  } catch {
    /* ignore */
  }
};
export const pendingInvite = (): string | null => {
  try {
    const t = sessionStorage.getItem(PENDING_KEY);
    return isInviteToken(t) ? t : null;
  } catch {
    return null;
  }
};
export const forgetInvite = () => {
  try {
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    /* ignore */
  }
};

async function call<T>(fn: string, token: string): Promise<T> {
  if (!isInviteToken(token)) return { state: "invalid" } as T;
  const { data, error } = await getSupabase().rpc(fn, { p_token: token });
  if (error || !data || typeof data !== "object") throw new Error("Could not check the invitation");
  return data as T;
}

export const peekInvite = (t: string) => call<PeekResult>("peek_invitation", t);
export const previewInvite = (t: string) => call<PreviewResult>("preview_invitation", t);
export const acceptInvite = (t: string) => call<AcceptResult>("accept_invitation", t);
