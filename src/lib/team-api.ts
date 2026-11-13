import { getSupabase } from "@/lib/supabase";
import { sendInvites, type InviteResult } from "@/lib/mail.functions";
import type { Role } from "@/types/domain";

/**
 * The Team page's real data. Every function is a database call made as the signed-in user, so the
 * database (Row Level Security + permission checks inside the functions) is what allows or refuses
 * it. Nothing here is a security boundary; hiding a button in the browser is only for convenience.
 */

export interface TeamMember {
  userId: string;
  name: string;
  email: string;
  role: Role;
  department: string;
  status: "active" | "suspended";
  joinedAt: string;
  lastSignInAt: string | null;
}
export interface PendingInvite {
  id: string;
  email: string;
  role: Role;
  invitedBy: string;
  createdAt: string;
  expiresAt: string;
  expired: boolean;
}

const ERRORS: Record<string, string> = {
  last_owner: "A company must keep at least one active owner.",
  cannot_change_self: "You can't change your own role or access.",
  not_allowed: "Only the company owner can do that.",
  invalid_role: "That role isn't valid.",
  not_authenticated: "Please sign in again.",
};
export function teamError(e: unknown): string {
  const m =
    e instanceof Error
      ? e.message
      : typeof e === "object" && e && "message" in e
        ? String((e as { message: unknown }).message)
        : "";
  const k = Object.keys(ERRORS).find((x) => m.includes(x));
  return k ? ERRORS[k]! : "Something went wrong. Please try again.";
}

interface MemberRow {
  user_id: string;
  name: string;
  email: string;
  role: Role;
  department: string;
  status: TeamMember["status"];
  joined_at: string;
  last_sign_in_at: string | null;
}
interface InviteRow {
  id: string;
  email: string;
  role: Role;
  invited_by_name: string | null;
  created_at: string;
  expires_at: string;
  expired: boolean;
}
async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabase().rpc(fn, args);
  if (error) throw error;
  return data as T;
}

export async function listMembers(orgId: string): Promise<TeamMember[]> {
  const rows = await rpc<MemberRow[]>("list_members", { p_org: orgId });
  return rows.map((r) => ({
    userId: r.user_id,
    name: r.name,
    email: r.email,
    role: r.role,
    department: r.department ?? "",
    status: r.status,
    joinedAt: r.joined_at,
    lastSignInAt: r.last_sign_in_at,
  }));
}

export async function listInvitations(orgId: string): Promise<PendingInvite[]> {
  const rows = await rpc<InviteRow[]>("list_invitations", { p_org: orgId });
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    role: r.role,
    invitedBy: r.invited_by_name ?? "",
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    expired: r.expired,
  }));
}

export const revokeInvitation = (id: string) => rpc<void>("revoke_invitation", { p_id: id });
export const setMemberRole = (orgId: string, userId: string, role: Role) =>
  rpc<void>("set_member_role", { p_org: orgId, p_user: userId, p_role: role });
export const setMemberStatus = (orgId: string, userId: string, status: "active" | "suspended") =>
  rpc<void>("set_member_status", { p_org: orgId, p_user: userId, p_status: status });

/** Creates the invitations in the database and emails each person their own single-use link. */
export async function inviteMembers(
  orgId: string,
  invites: { email: string; role: Role }[],
): Promise<{ results: InviteResult[]; error?: string }> {
  const { data } = await getSupabase().auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) return { results: [], error: "Please sign in again." };
  const r = await sendInvites({ data: { accessToken, orgId, invites } });
  return r.error ? { results: r.results, error: r.error } : { results: r.results };
}
