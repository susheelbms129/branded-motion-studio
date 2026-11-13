/**
 * Reusable, responsive email templates. One layout, many copy variants. Server-only.
 * Every dynamic value goes through esc(), so user-entered text can never inject HTML.
 */

export const esc = (s: unknown) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export interface Rendered {
  subject: string;
  html: string;
  text: string;
}

interface LayoutArgs {
  preheader: string;
  heading: string;
  orgName: string;
  greeting?: string | undefined;
  paragraphs: string[];
  facts?: [string, string][] | undefined;
  cta?: { label: string; url: string } | undefined;
  /** Shown under the button as a copy-paste fallback */
  showFallbackUrl?: boolean | undefined;
  note?: string | undefined; // e.g. security note
  reason: string; // why the recipient got this email
  support: string;
  accent?: string | undefined;
}

const BRAND_A = "#2f6bff";
const BRAND_B = "#7c3aed";
const NAVY = "#0b1030";

function layout(a: LayoutArgs): Rendered & { _: true } {
  const accent = a.accent ?? BRAND_A;
  const paras = a.paragraphs.map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:24px;color:#374151;">${esc(p)}</p>`).join("");
  const facts = a.facts?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 18px;border:1px solid #e5e7eb;border-radius:12px;">${a.facts
        .map(
          ([k, v], i) =>
            `<tr><td style="padding:10px 14px;font-size:13px;color:#6b7280;width:38%;${i ? "border-top:1px solid #eef0f3;" : ""}">${esc(k)}</td><td style="padding:10px 14px;font-size:14px;font-weight:600;color:#111827;${i ? "border-top:1px solid #eef0f3;" : ""}">${esc(v)}</td></tr>`,
        )
        .join("")}</table>`
    : "";
  const cta = a.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 18px;"><tr><td style="border-radius:12px;background:${accent};background-image:linear-gradient(90deg,${BRAND_A},${BRAND_B});"><a href="${esc(a.cta.url)}" style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:12px;">${esc(a.cta.label)}</a></td></tr></table>`
    : "";
  const fallback =
    a.cta && a.showFallbackUrl
      ? `<p style="margin:0 0 16px;font-size:12px;line-height:18px;color:#6b7280;">If the button doesn't work, copy and paste this link into your browser:<br><a href="${esc(a.cta.url)}" style="color:${BRAND_A};word-break:break-all;">${esc(a.cta.url)}</a></p>`
      : "";
  const note = a.note
    ? `<p style="margin:0;padding:12px 14px;font-size:12px;line-height:18px;color:#6b7280;background:#f6f7fb;border-radius:10px;">${esc(a.note)}</p>`
    : "";

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(a.heading)}</title></head>
<body style="margin:0;padding:0;background:#f3f4f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${esc(a.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f8;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;">
<tr><td style="background:${NAVY};border-radius:18px 18px 0 0;padding:22px 28px;">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="width:34px;height:34px;border-radius:9px;background:${BRAND_A};background-image:linear-gradient(135deg,${BRAND_A},${BRAND_B});text-align:center;font-size:19px;font-weight:700;color:#fff;line-height:34px;">V</td>
<td style="padding-left:10px;font-size:20px;font-weight:600;color:#ffffff;letter-spacing:-0.2px;">Vendora</td>
<td style="padding-left:14px;font-size:12px;color:#9aa3c7;">${esc(a.orgName)}</td>
</tr></table></td></tr>
<tr><td style="background:#ffffff;padding:30px 28px 26px;border-radius:0 0 18px 18px;">
<h1 style="margin:0 0 14px;font-size:22px;line-height:30px;color:#111827;">${esc(a.heading)}</h1>
${a.greeting ? `<p style="margin:0 0 14px;font-size:15px;line-height:24px;color:#374151;">${esc(a.greeting)}</p>` : ""}
${paras}${facts}${cta}${fallback}${note}
</td></tr>
<tr><td style="padding:18px 8px 0;text-align:center;font-size:12px;line-height:18px;color:#8a90a2;">
${esc(a.reason)}<br>Questions? Contact <a href="mailto:${esc(a.support)}" style="color:#6b7280;">${esc(a.support)}</a><br>&copy; ${new Date().getFullYear()} Vendora. Smarter Buying. Greater Business.
</td></tr></table></td></tr></table></body></html>`;

  const text = [
    a.heading,
    "",
    a.greeting ?? "",
    ...a.paragraphs,
    ...(a.facts ?? []).map(([k, v]) => `${k}: ${v}`),
    a.cta ? `\n${a.cta.label}: ${a.cta.url}` : "",
    a.note ?? "",
    "",
    `— ${a.reason}`,
    `Support: ${a.support}`,
  ]
    .filter((l, i, arr) => l !== "" || arr[i - 1] !== "")
    .join("\n");

  return { subject: "", html, text, _: true };
}

const cap = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

// ---------------------------------------------------------------------------------------------
// Invitation emails
// ---------------------------------------------------------------------------------------------

export function inviteEmail(p: {
  orgName: string;
  inviterName: string;
  roleLabel: string;
  url: string;
  expiresAt: number;
  support: string;
}): Rendered {
  const exp = new Date(p.expiresAt).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
  const l = layout({
    preheader: `${p.inviterName} invited you to join ${p.orgName} on Vendora`,
    heading: `Join ${p.orgName} on Vendora`,
    orgName: p.orgName,
    greeting: "Hi there,",
    paragraphs: [
      `${p.inviterName} has invited you to join ${p.orgName} on Vendora, where your team manages purchase requests, approvals and purchase orders in one place.`,
    ],
    facts: [
      ["Organization", p.orgName],
      ["Invited by", p.inviterName],
      ["Your role", p.roleLabel],
      ["Link expires", exp],
    ],
    cta: { label: "Accept invitation", url: p.url },
    showFallbackUrl: true,
    note: "If you weren't expecting this invitation, you can safely ignore this email. No account is created until you accept, and the link works for one person only.",
    reason: `You received this email because ${p.inviterName} invited this address to ${p.orgName} on Vendora.`,
    support: p.support,
  });
  return { subject: `${p.inviterName} invited you to join ${p.orgName} on Vendora`, html: l.html, text: l.text };
}

// ---------------------------------------------------------------------------------------------
// Business notifications (one template, driven by `kind`)
// ---------------------------------------------------------------------------------------------

export type NotifyKind =
  | "invite_accepted"
  | "role_changed"
  | "member_suspended"
  | "request_submitted"
  | "request_assigned"
  | "request_decided"
  | "po_issued"
  | "po_status"
  | "supplier_added";

export interface NotifyData {
  kind: NotifyKind;
  recipientName?: string | undefined;
  orgName: string;
  actorName?: string | undefined;
  title: string;
  detail?: string | undefined;
  status?: string | undefined;
  link?: string | undefined; // absolute URL (already validated)
  support: string;
  demo?: boolean | undefined;
}

export function notifyEmail(d: NotifyData): Rendered {
  const actor = d.actorName ?? "A teammate";
  const st = d.status ? cap(d.status) : "";
  const decided = d.status === "approved" ? "approved" : "rejected";
  const C: Record<NotifyKind, { subject: string; heading: string; body: string; cta: string; reason: string; accent?: string }> = {
    invite_accepted: {
      subject: `${d.title} joined ${d.orgName}`,
      heading: `${d.title} accepted your invitation`,
      body: `${d.title} has accepted the invitation and joined ${d.orgName} with the role ${d.detail ?? "assigned"}.`,
      cta: "View team",
      reason: `You received this because you invited ${d.title} to ${d.orgName}.`,
    },
    role_changed: {
      subject: `Your role in ${d.orgName} was updated`,
      heading: "Your role was updated",
      body: `Your role in ${d.orgName} is now ${d.title}. Your permissions in Vendora have changed to match.`,
      cta: "Open Vendora",
      reason: `You received this because your role in ${d.orgName} changed.`,
    },
    member_suspended: {
      subject: `Your access to ${d.orgName} was suspended`,
      heading: "Your access was suspended",
      body: `An administrator suspended your access to ${d.orgName} on Vendora. If you think this is a mistake, please contact your organization's administrator.`,
      cta: "Open Vendora",
      reason: `You received this because your access to ${d.orgName} changed.`,
      accent: "#d9480f",
    },
    request_submitted: {
      subject: `Purchase request submitted: ${d.title}`,
      heading: "Purchase request submitted",
      body: `Your purchase request was submitted and is waiting for approval.`,
      cta: "View request",
      reason: "You received this because you created this purchase request.",
    },
    request_assigned: {
      subject: `Approval needed: ${d.title}`,
      heading: "A purchase request needs your approval",
      body: `${actor} submitted a purchase request that is now assigned to you for review.`,
      cta: "Review request",
      reason: "You received this because you are an approver for this request.",
    },
    request_decided: {
      subject: `Purchase request ${decided}: ${d.title}`,
      heading: `Purchase request ${decided}`,
      body: d.status === "approved" ? "Good news, your purchase request has been approved." : "Your purchase request was rejected. Open it to see the reviewer's comment.",
      cta: "View request",
      reason: "You received this because you created this purchase request.",
      accent: d.status === "approved" ? "#12945c" : "#d92d20",
    },
    po_issued: {
      subject: `Purchase order issued: ${d.title}`,
      heading: "Purchase order issued",
      body: "A purchase order was created and issued to the supplier.",
      cta: "View purchase order",
      reason: `You received this because you follow purchase orders in ${d.orgName}.`,
    },
    po_status: {
      subject: `Purchase order ${st.toLowerCase()}: ${d.title}`,
      heading: "Purchase order status updated",
      body: `The status of this purchase order changed to ${st}.`,
      cta: "View purchase order",
      reason: `You received this because you follow purchase orders in ${d.orgName}.`,
    },
    supplier_added: {
      subject: `New supplier added: ${d.title}`,
      heading: "A new supplier was added",
      body: `${actor} added a new supplier to ${d.orgName}.`,
      cta: "View supplier",
      reason: `You received this because you manage suppliers in ${d.orgName}.`,
    },
  };
  const c = C[d.kind];
  const facts: [string, string][] = [];
  if (!["role_changed", "member_suspended", "invite_accepted"].includes(d.kind)) facts.push(["Item", d.title]);
  if (d.status && d.kind !== "role_changed") facts.push(["Status", cap(d.status)]);
  if (d.detail && d.kind !== "invite_accepted") facts.push(["Details", d.detail]);
  facts.push(["Organization", d.orgName]);
  const l = layout({
    preheader: c.heading,
    heading: c.heading,
    orgName: d.orgName,
    greeting: d.recipientName ? `Hi ${d.recipientName},` : "Hi,",
    paragraphs: [c.body, ...(d.demo ? ["This is a demo workspace, so this email was delivered to you instead of the sample teammate."] : [])],
    facts,
    cta: d.link ? { label: c.cta, url: d.link } : undefined,
    reason: c.reason,
    support: d.support,
    accent: c.accent,
  });
  return { subject: `${d.demo ? "[Demo] " : ""}${c.subject}`, html: l.html, text: l.text };
}

// ---------------------------------------------------------------------------------------------
// Owner/Admin announcement
// ---------------------------------------------------------------------------------------------

export function announcementEmail(p: {
  orgName: string;
  senderName: string;
  recipientName?: string | undefined;
  subject: string;
  message: string;
  link?: string | undefined;
  support: string;
}): Rendered {
  const paragraphs = p.message.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
  const l = layout({
    preheader: `${p.senderName} sent an announcement to ${p.orgName}`,
    heading: p.subject,
    orgName: p.orgName,
    greeting: p.recipientName ? `Hi ${p.recipientName},` : "Hi,",
    paragraphs,
    facts: [["From", p.senderName]],
    cta: p.link ? { label: "Open Vendora", url: p.link } : undefined,
    reason: `You received this because you are a member of ${p.orgName} on Vendora. This message was sent by ${p.senderName}, an administrator of your organization.`,
    support: p.support,
  });
  return { subject: `[${p.orgName}] ${p.subject}`, html: l.html, text: l.text };
}
