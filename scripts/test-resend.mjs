#!/usr/bin/env node
/**
 * Standalone Resend check. No login, no dev server, no app code involved.
 *
 *   node scripts/test-resend.mjs you@your-resend-account-email.com
 *
 * - Reads RESEND_API_KEY from .env (or the shell environment).
 * - Always sends from onboarding@resend.dev, which Resend only allows to YOUR OWN account email.
 * - Then asks Resend for the message status so you see "delivered" without opening the dashboard.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// --- tiny .env loader (shell variables win) ---
try {
  for (const raw of readFileSync(resolve(process.cwd(), ".env"), "utf8").split(/\r?\n/)) {
    const m = raw.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || raw.trim().startsWith("#")) continue;
    let v = m[2];
    if (/^(".*"|'.*')$/.test(v)) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
} catch {
  console.log("(no .env file found in this folder, using shell environment only)");
}

const to = (process.argv[2] ?? process.env.TEST_EMAIL_TO ?? "").trim();
const key = process.env.RESEND_API_KEY ?? "";
const say = (icon, msg) => console.log(`${icon}  ${msg}`);

if (!key) {
  say("✗", "RESEND_API_KEY is missing. Add it to .env (no quotes needed), e.g. RESEND_API_KEY=re_xxxxxxxx");
  process.exit(1);
}
if (!key.startsWith("re_")) say("!", "RESEND_API_KEY doesn't start with re_ — double-check you copied the key, not a secret/ID.");
if (!/^\S+@\S+\.\S+$/.test(to)) {
  say("✗", "Give your Resend account email:  node scripts/test-resend.mjs you@example.com");
  process.exit(1);
}
say("•", `Key found (${key.slice(0, 5)}…${key.slice(-3)}), sending to ${to} from onboarding@resend.dev`);

const res = await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    "Idempotency-Key": `vendora-test-${Date.now()}`,
  },
  body: JSON.stringify({
    from: "Vendora <onboarding@resend.dev>",
    to: [to],
    subject: "Vendora test email ✔",
    text: "If you can read this, Resend is configured correctly for Vendora.",
    html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:24px auto;padding:24px;border:1px solid #e5e7eb;border-radius:14px">
      <div style="font-size:20px;font-weight:700;color:#2f6bff">Vendora</div>
      <h2 style="margin:12px 0 8px">Resend is working 🎉</h2>
      <p style="color:#374151;line-height:1.5">This test email was sent at ${new Date().toISOString()} using your RESEND_API_KEY.</p></div>`,
  }),
}).catch((e) => {
  say("✗", `Could not reach Resend: ${e.message}`);
  process.exit(1);
});

const body = await res.json().catch(() => ({}));
if (!res.ok) {
  say("✗", `Resend rejected the request (${res.status}): ${body.message ?? JSON.stringify(body)}`);
  if (res.status === 401 || /api key/i.test(body.message ?? "")) say("→", "Invalid/restricted API key. Create one with 'Sending access' at resend.com/api-keys.");
  if (/own email|testing emails|verify a domain/i.test(body.message ?? "")) say("→", "onboarding@resend.dev only delivers to the email you signed up to Resend with. Use that exact address.");
  process.exit(1);
}
say("✓", `Accepted by Resend. Message id: ${body.id}`);

// Poll the delivery status for ~15s.
let last = "";
for (let i = 0; i < 8; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  const s = await fetch(`https://api.resend.com/emails/${body.id}`, { headers: { Authorization: `Bearer ${key}` } })
    .then((r) => r.json())
    .catch(() => ({}));
  last = s.last_event ?? last;
  if (last) say("•", `Status: ${last}`);
  if (["delivered", "bounced", "complained", "failed"].includes(last)) break;
}
if (last === "delivered") say("✓", "Delivered. Check your inbox (and Spam). Resend is working.");
else if (last === "bounced" || last === "failed" || last === "complained") say("✗", `Final status: ${last}. See resend.com/emails for the reason.`);
else say("•", "Still processing. Check resend.com/emails — it should show 'Delivered' shortly.");
