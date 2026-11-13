import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { z } from "zod";

import { ROLE_LABEL, ROLES } from "@/lib/permissions";
import type { Role } from "@/types/domain";

import { mailEnv, rateLimit, sendEmail } from "@/server/mail/resend.server";
import { announcementEmail, inviteEmail, notifyEmail } from "@/server/mail/templates.server";
import { userClient } from "@/server/supabase.server";

/**
 * All email sending happens here, on the server. The browser never sees RESEND_API_KEY or the signing
 * secret, and every function returns a result object instead of throwing, so a mail problem can never
 * break the business action that triggered it.
 */

export type MailResult = { ok: true; id?: string } | { ok: false; error: string };

// Invitations can never grant Owner; the database enforces it too.
const inviteRoleEnum = z.enum(ROLES.filter((r) => r !== "owner") as [Role, ...Role[]]);
const email = z.string().trim().toLowerCase().email().max(254);
const text = (max: number) => z.string().trim().min(1).max(max);

function clientIp(): string {
  return (
    getRequestHeader("cf-connecting-ip") ??
    getRequestHeader("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

function baseUrl(): string {
  const env = mailEnv();
  if (env.appUrl) return env.appUrl;
  const origin = getRequestHeader("origin");
  if (origin) return origin.replace(/\/$/, "");
  return `https://${getRequestHeader("host") ?? "localhost"}`;
}

/** Only in-app paths may be linked from an email. */
const safePath = z
  .string()
  .max(160)
  .regex(/^\/app(\/[A-Za-z0-9_\-$]+)*$/);

// -------------------------------------------------------------------------------------------
// Invitations
//
// The invitation itself lives in the database (hashed token, single use, 7-day expiry, tied to one
// email and one role). The database checks that the caller is the owner of that company. This
// function only turns a freshly created invitation into an email. The raw link token goes from the
// database to this server to the invitee's inbox, and is never returned to the browser.
// -------------------------------------------------------------------------------------------

export type InviteResult = { email: string; ok: boolean; error?: string };

const INVITE_ERRORS: Record<string, string> = {
  not_authenticated: "Please sign in again.",
  not_allowed: "Only the company owner can send invitations.",
  already_member: "This person is already on your team.",
  invalid_email: "That email address isn't valid.",
  invalid_role: "That role isn't valid.",
  rate_limited: "Too many invitations. Please try again in an hour.",
};
const inviteError = (msg: string) => INVITE_ERRORS[Object.keys(INVITE_ERRORS).find((k) => msg.includes(k)) ?? ""] ?? "The invitation could not be created.";

export const sendInvites = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      accessToken: z.string().min(20).max(4000),
      orgId: z.string().uuid(),
      invites: z.array(z.object({ email, role: inviteRoleEnum })).min(1).max(10),
    }),
  )
  .handler(async ({ data }): Promise<{ ok: boolean; results: InviteResult[]; error?: string }> => {
    if (!rateLimit(`inv:${clientIp()}`, 20, 10 * 60_000)) {
      return { ok: false, results: [], error: "Too many invitations. Please wait a few minutes and try again." };
    }
    const results: InviteResult[] = [];
    try {
      const db = userClient(data.accessToken);
      const env = mailEnv();
      for (const inv of data.invites) {
        if (!rateLimit(`inv-to:${inv.email}`, 3, 60 * 60_000)) {
          results.push({ email: inv.email, ok: false, error: "Too many invitations to this address. Try again later." });
          continue;
        }
        // The database decides whether this caller may invite into this company.
        const { data: row, error } = await db.rpc("create_invitation", { p_org: data.orgId, p_email: inv.email, p_role: inv.role });
        if (error || !row) {
          results.push({ email: inv.email, ok: false, error: inviteError(error?.message ?? "") });
          continue;
        }
        const made = row as { id: string; token: string; expiresAt: string; orgName: string; inviterName: string; role: Role };
        const msg = inviteEmail({
          orgName: made.orgName,
          inviterName: made.inviterName,
          roleLabel: ROLE_LABEL[made.role],
          url: `${baseUrl()}/accept-invite?token=${encodeURIComponent(made.token)}`,
          expiresAt: new Date(made.expiresAt).getTime(),
          support: env.support,
        });
        const r = await sendEmail({
          to: inv.email,
          ...msg,
          idempotencyKey: `invite:${made.id}`,
          fromName: made.inviterName,
          tags: [{ name: "type", value: "invite" }],
        });
        results.push(r.ok ? { email: inv.email, ok: true } : { email: inv.email, ok: false, error: `Invitation saved, but the email failed: ${r.error}` });
      }
      return { ok: results.every((r) => r.ok), results };
    } catch (e) {
      console.error("[mail] sendInvites", e instanceof Error ? e.message : e);
      return { ok: false, results, error: "Could not send invitations" };
    }
  });

// -------------------------------------------------------------------------------------------
// Business notifications
// -------------------------------------------------------------------------------------------

export const sendNotification = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      kind: z.enum([
        "role_changed",
        "member_suspended",
        "request_submitted",
        "request_assigned",
        "request_decided",
        "po_issued",
        "po_status",
        "supplier_added",
      ]),
      to: email,
      recipientName: text(80).optional(),
      orgName: text(100),
      actorName: text(80).optional(),
      title: text(160),
      detail: text(500).optional(),
      status: text(40).optional(),
      path: safePath.optional(),
      idempotencyKey: z.string().min(8).max(200),
      demo: z.boolean().optional(),
    }),
  )
  .handler(async ({ data }): Promise<MailResult> => {
    if (!rateLimit(`ntf:${clientIp()}`, 60, 60_000) || !rateLimit(`ntf-to:${data.to}`, 30, 60 * 60_000)) {
      return { ok: false, error: "Rate limit reached" };
    }
    try {
      const env = mailEnv();
      const msg = notifyEmail({
        kind: data.kind,
        recipientName: data.recipientName,
        orgName: data.orgName,
        actorName: data.actorName,
        title: data.title,
        detail: data.detail,
        status: data.status,
        link: data.path ? `${baseUrl()}${data.path}` : undefined,
        support: env.support,
        demo: data.demo,
      });
      const r = await sendEmail({
        to: data.to,
        ...msg,
        idempotencyKey: data.idempotencyKey,
        tags: [{ name: "type", value: data.kind }],
      });
      return r.ok ? { ok: true, id: r.id } : { ok: false, error: r.error };
    } catch (e) {
      console.error("[mail] sendNotification", e instanceof Error ? e.message : e);
      return { ok: false, error: "Could not send notification" };
    }
  });

// -------------------------------------------------------------------------------------------
// Owner/Admin announcements
// -------------------------------------------------------------------------------------------

export const sendAnnouncement = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      orgName: text(100),
      senderName: text(80),
      senderEmail: email.optional(),
      subject: text(120),
      message: text(3000),
      recipients: z.array(z.object({ email, name: text(80).optional() })).min(1).max(50),
      idempotencyKey: z.string().min(8).max(150),
    }),
  )
  .handler(async ({ data }): Promise<{ ok: boolean; sent: number; failed: number; error?: string }> => {
    if (!rateLimit(`ann:${clientIp()}`, 5, 10 * 60_000)) {
      return { ok: false, sent: 0, failed: 0, error: "Too many announcements. Please wait a few minutes." };
    }
    const env = mailEnv();
    const seen = new Set<string>();
    const list = data.recipients.filter((r) => (seen.has(r.email) ? false : (seen.add(r.email), true)));
    let sent = 0;
    let failed = 0;
    for (let i = 0; i < list.length; i += 5) {
      await Promise.all(
        list.slice(i, i + 5).map(async (rcp) => {
          const msg = announcementEmail({
            orgName: data.orgName,
            senderName: data.senderName,
            recipientName: rcp.name,
            subject: data.subject,
            message: data.message,
            link: `${baseUrl()}/app`,
            support: env.support,
          });
          // Each recipient gets their own email (no recipient list is exposed).
          // Actual sender is always the verified Vendora domain; the admin's name is display-only.
          const r = await sendEmail({
            to: rcp.email,
            ...msg,
            idempotencyKey: `ann:${data.idempotencyKey}:${rcp.email}`,
            fromName: data.senderName,
            replyTo: data.senderEmail,
            tags: [{ name: "type", value: "announcement" }],
          });
          r.ok ? sent++ : failed++;
        }),
      );
    }
    return { ok: failed === 0, sent, failed, ...(failed ? { error: `${failed} email(s) could not be delivered` } : {}) };
  });
