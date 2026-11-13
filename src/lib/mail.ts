import { toast } from "sonner";
import { create } from "zustand";
import { persist } from "zustand/middleware";

import { createSeed } from "@/mocks/seed";
import { useUi } from "@/lib/ui-store";
import { useWs } from "@/lib/ws-store";
import { sendAnnouncement, sendInvite, sendNotification } from "@/lib/mail.functions";
import type { Role } from "@/types/domain";

/**
 * Client-side email helpers. They only ever call server functions (the Resend key never reaches the
 * browser), they never throw, and a failure never blocks the business action that triggered it.
 */

// ---- Notification preferences (optional categories only) ---------------------------------------
export const MAIL_CATEGORIES = {
  requests: { label: "Purchase requests", hint: "A request is submitted or assigned to you for approval" },
  approvals: { label: "Approval decisions", hint: "Your request is approved or rejected" },
  orders: { label: "Purchase orders", hint: "Orders are issued or their status changes" },
  suppliers: { label: "Supplier updates", hint: "A new supplier is added" },
  team: { label: "Team & access", hint: "Your role changes or your access is suspended" },
} as const;
export type MailCategory = keyof typeof MAIL_CATEGORIES;

interface PrefsState {
  prefs: Record<MailCategory, boolean>;
  set: (k: MailCategory, v: boolean) => void;
}
export const useMailPrefs = create<PrefsState>()(
  persist(
    (set) => ({
      prefs: { requests: true, approvals: true, orders: true, suppliers: true, team: true },
      set: (k, v) => set((s) => ({ prefs: { ...s.prefs, [k]: v } })),
    }),
    { name: "vendora-mail-prefs" },
  ),
);

// ---- Delivery log (last 40 attempts, kept in this browser) -------------------------------------
export interface MailLogEntry {
  id: string;
  at: string;
  kind: string;
  to: string;
  status: "sent" | "failed";
  error?: string | undefined;
}
interface LogState {
  entries: MailLogEntry[];
  add: (e: Omit<MailLogEntry, "id" | "at">) => void;
  clear: () => void;
}
export const useMailLog = create<LogState>()(
  persist(
    (set) => ({
      entries: [],
      add: (e) =>
        set((s) => ({
          entries: [{ ...e, id: Math.random().toString(36).slice(2, 9), at: new Date().toISOString() }, ...s.entries].slice(0, 40),
        })),
      clear: () => set({ entries: [] }),
    }),
    { name: "vendora-mail-log" },
  ),
);

// ---- Recipient safety --------------------------------------------------------------------------
// Demo/sample teammates have invented addresses on real-looking domains. We must never email them.
let seedEmails: Set<string> | null = null;
const PLACEHOLDER = "you@yourcompany.in";
export function isDeliverable(email: string | undefined | null): email is string {
  if (!email) return false;
  seedEmails ??= new Set(createSeed().members.map((m) => m.email.toLowerCase()));
  const e = email.trim().toLowerCase();
  return /^\S+@\S+\.\S+$/.test(e) && !seedEmails.has(e) && e !== PLACEHOLDER;
}

const first = (n: string) => n.trim().split(/\s+/)[0] ?? n;

/** Who should actually receive an email meant for these members. */
export function resolveRecipients(memberIds: string[]): { email: string; name: string }[] {
  const ui = useUi.getState();
  const ws = useWs.getState();
  const me = isDeliverable(ui.user?.email) ? { email: ui.user!.email.toLowerCase(), name: first(ui.user!.name) } : null;
  if (ui.demo) return me ? [me] : []; // demo workspace: everything goes to the signed-in user only
  const out = new Map<string, { email: string; name: string }>();
  for (const id of memberIds) {
    const m = ws.members.find((x) => x.id === id);
    if (!m) continue;
    if (isDeliverable(m.email)) out.set(m.email.toLowerCase(), { email: m.email.toLowerCase(), name: first(m.name) });
    else if (me) out.set(me.email, me);
  }
  return [...out.values()];
}

export const orgName = () => useWs.getState().organizations[0]?.name ?? "Your organization";

// ---- Senders -----------------------------------------------------------------------------------
let warnedNotConfigured = false;
const notConfigured = (e: string) => /not configured|RESEND_API_KEY/i.test(e);

type NotifyKind = Parameters<typeof sendNotification>[0]["data"]["kind"];

export async function notify(
  kind: NotifyKind,
  category: MailCategory,
  to: { email: string; name: string },
  ctx: { title: string; detail?: string | undefined; status?: string | undefined; path?: string | undefined; actorName?: string | undefined; key: string },
): Promise<void> {
  if (!useMailPrefs.getState().prefs[category]) return;
  try {
    const r = await sendNotification({
      data: {
        kind,
        to: to.email,
        recipientName: to.name,
        orgName: orgName(),
        title: ctx.title,
        ...(ctx.detail ? { detail: ctx.detail } : {}),
        ...(ctx.status ? { status: ctx.status } : {}),
        ...(ctx.path ? { path: ctx.path } : {}),
        ...(ctx.actorName ? { actorName: ctx.actorName } : {}),
        idempotencyKey: `${ctx.key}:${to.email}`,
        demo: useUi.getState().demo,
      },
    });
    useMailLog.getState().add({ kind, to: to.email, status: r.ok ? "sent" : "failed", ...(r.ok ? {} : { error: r.error }) });
    if (!r.ok && notConfigured(r.error) && !warnedNotConfigured) {
      warnedNotConfigured = true;
      toast.info("Email isn't configured yet, so notification emails are paused.");
    }
  } catch (e) {
    useMailLog.getState().add({ kind, to: to.email, status: "failed", error: e instanceof Error ? e.message : "Request failed" });
  }
}

export interface InviteArgs {
  id: string;
  email: string;
  role: Role;
  invitedById: string;
}

export async function deliverInvite(inv: InviteArgs, attempt = 0): Promise<boolean> {
  const ws = useWs.getState();
  const ui = useUi.getState();
  const inviter = ws.members.find((m) => m.id === inv.invitedById);
  const inviterName = inviter?.name ?? ui.user?.name ?? "A teammate";
  // Confirmation email back to the inviter only if we have a real address for them.
  const inviterEmail = isDeliverable(ui.user?.email) ? ui.user!.email.toLowerCase() : undefined;
  try {
    const r = await sendInvite({
      data: {
        invitationId: inv.id,
        email: inv.email.trim().toLowerCase(),
        role: inv.role,
        orgName: orgName(),
        inviterName,
        ...(inviterEmail ? { inviterEmail } : {}),
        attempt,
      },
    });
    useMailLog.getState().add({ kind: "invite", to: inv.email, status: r.ok ? "sent" : "failed", ...(r.ok ? {} : { error: r.error }) });
    if (r.ok) toast.success(`Invitation email sent to ${inv.email}`);
    else toast.error(notConfigured(r.error) ? "Invitation saved, but email isn't configured yet." : `Invitation saved, but the email failed: ${r.error}`);
    return r.ok;
  } catch (e) {
    useMailLog.getState().add({ kind: "invite", to: inv.email, status: "failed", error: e instanceof Error ? e.message : "Request failed" });
    toast.error("Invitation saved, but the email could not be sent. Use Resend to try again.");
    return false;
  }
}

export async function deliverAnnouncement(
  recipients: { email: string; name: string }[],
  subject: string,
  message: string,
): Promise<{ sent: number; failed: number; error?: string | undefined }> {
  const ui = useUi.getState();
  const senderEmail = isDeliverable(ui.user?.email) ? ui.user!.email.toLowerCase() : undefined;
  try {
    const r = await sendAnnouncement({
      data: {
        orgName: orgName(),
        senderName: ui.user?.name ?? "Your administrator",
        ...(senderEmail ? { senderEmail } : {}),
        subject,
        message,
        recipients,
        idempotencyKey: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      },
    });
    for (const rc of recipients) useMailLog.getState().add({ kind: "announcement", to: rc.email, status: r.failed ? "failed" : "sent" });
    return { sent: r.sent, failed: r.failed, error: r.error };
  } catch {
    return { sent: 0, failed: recipients.length, error: "Request failed" };
  }
}
