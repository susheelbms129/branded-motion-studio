import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { z } from "zod";

import { ROLE_LABEL, ROLES } from "@/lib/permissions";
import type { Role } from "@/types/domain";

import { mailEnv, rateLimit, sendEmail } from "@/server/mail/resend.server";
import { announcementEmail, inviteEmail, notifyEmail } from "@/server/mail/templates.server";
import { signInvite, verifyInvite } from "@/server/mail/token.server";

/**
 * All email sending happens here, on the server. The browser never sees RESEND_API_KEY or the signing
 * secret, and every function returns a result object instead of throwing, so a mail problem can never
 * break the business action that triggered it.
 */

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export type MailResult = { ok: true; id?: string } | { ok: false; error: string };

const roleEnum = z.enum(ROLES as [Role, ...Role[]]);
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
// -------------------------------------------------------------------------------------------

export const sendInvite = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      invitationId: text(60),
      email,
      role: roleEnum,
      orgName: text(100),
      inviterName: text(80),
      inviterEmail: email.optional(),
      attempt: z.number().int().min(0).max(1_000_000_000_000_000),
    }),
  )
  .handler(async ({ data }): Promise<MailResult & { expiresAt?: number }> => {
    const ip = clientIp();
    if (!rateLimit(`inv:${ip}`, 10, 10 * 60_000) || !rateLimit(`inv-to:${data.email}`, 3, 60 * 60_000)) {
      return { ok: false, error: "Too many invitations. Please wait a few minutes and try again." };
    }
    try {
      const expiresAt = Date.now() + INVITE_TTL_MS;
      const token = await signInvite({
        jti: data.invitationId,
        e: data.email,
        r: data.role,
        o: data.orgName,
        n: data.inviterName,
        ie: data.inviterEmail,
        exp: expiresAt,
      });
      const env = mailEnv();
      const msg = inviteEmail({
        orgName: data.orgName,
        inviterName: data.inviterName,
        roleLabel: ROLE_LABEL[data.role],
        url: `${baseUrl()}/accept-invite?token=${encodeURIComponent(token)}`,
        expiresAt,
        support: env.support,
      });
      const r = await sendEmail({
        to: data.email,
        ...msg,
        idempotencyKey: `invite:${data.invitationId}:${data.attempt}`,
        fromName: data.inviterName,
        tags: [{ name: "type", value: "invite" }],
      });
      return r.ok ? { ok: true, id: r.id, expiresAt } : { ok: false, error: r.error };
    } catch (e) {
      console.error("[mail] sendInvite", e instanceof Error ? e.message : e);
      return { ok: false, error: "Could not create the invitation email" };
    }
  });

export const checkInvite = createServerFn({ method: "POST" })
  .inputValidator(z.object({ token: z.string().max(2000) }))
  .handler(async ({ data }) => {
    if (!rateLimit(`chk:${clientIp()}`, 40, 60_000)) return { valid: false as const, reason: "rate_limited" as const };
    try {
      const v = await verifyInvite(data.token);
      if (!v.ok) return { valid: false as const, reason: v.reason };
      const p = v.payload;
      const role = (ROLES as string[]).includes(p.r) ? (p.r as Role) : null;
      if (!role) return { valid: false as const, reason: "invalid" as const };
      return {
        valid: true as const,
        invitationId: p.jti,
        email: p.e,
        role,
        roleLabel: ROLE_LABEL[role],
        orgName: p.o,
        inviterName: p.n,
        expiresAt: p.exp,
      };
    } catch {
      return { valid: false as const, reason: "invalid" as const };
    }
  });

/** Re-verifies the token on the server, then tells the inviter. Idempotent per invitation. */
export const acceptInvite = createServerFn({ method: "POST" })
  .inputValidator(z.object({ token: z.string().max(2000), name: text(80) }))
  .handler(async ({ data }): Promise<MailResult & { role?: Role; orgName?: string; email?: string }> => {
    if (!rateLimit(`acc:${clientIp()}`, 15, 10 * 60_000)) return { ok: false, error: "Too many attempts. Try again shortly." };
    try {
      const v = await verifyInvite(data.token);
      if (!v.ok) return { ok: false, error: v.reason === "expired" ? "This invitation has expired." : "This invitation is not valid." };
      const p = v.payload;
      const role = (ROLES as string[]).includes(p.r) ? (p.r as Role) : null;
      if (!role) return { ok: false, error: "This invitation is not valid." };
      // The role, email and organization always come from the signed token, never from the browser.
      if (p.ie) {
        const env = mailEnv();
        const msg = notifyEmail({
          kind: "invite_accepted",
          orgName: p.o,
          title: data.name,
          detail: ROLE_LABEL[role],
          link: `${baseUrl()}/app/team`,
          recipientName: p.n,
          support: env.support,
        });
        await sendEmail({ to: p.ie, ...msg, idempotencyKey: `accepted:${p.jti}`, tags: [{ name: "type", value: "invite_accepted" }] });
      }
      return { ok: true, role, orgName: p.o, email: p.e };
    } catch (e) {
      console.error("[mail] acceptInvite", e instanceof Error ? e.message : e);
      return { ok: false, error: "Could not accept the invitation" };
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
