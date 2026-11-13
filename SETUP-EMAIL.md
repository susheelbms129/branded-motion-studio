# Vendora email setup (Resend)

## 1. Resend (5 minutes)
1. Sign in at https://resend.com → **Domains → Add domain** → add the DNS records it shows (SPF, DKIM) at your DNS provider → wait for **Verified**.
2. **API Keys → Create** a key with *Sending access* → copy it (`re_...`).
3. Quick test without a domain: skip step 1; mails are sent from `onboarding@resend.dev` and Resend only delivers to **your own Resend account email**.

## 2. Environment variables / secrets
Add these where your app is hosted (Lovable → project **Secrets**, or Cloudflare Worker → Settings → Variables and Secrets). Template: `.env.example`.

| Name | Required | Value |
|---|---|---|
| `RESEND_API_KEY` | yes | `re_...` |
| `INVITE_SIGNING_SECRET` | yes | `openssl rand -hex 32` |
| `APP_URL` | yes | `https://your-app-domain` (no trailing slash) |
| `MAIL_FROM` | after domain verified | `Vendora <notifications@yourdomain.com>` |
| `MAIL_SUPPORT_EMAIL` | optional | `support@yourdomain.com` |
| `RESEND_WEBHOOK_SECRET` | for webhook | `whsec_...` |

Local dev: export them in the same terminal before starting, e.g. `RESEND_API_KEY=re_... INVITE_SIGNING_SECRET=... npm run dev`.

## 3. Webhook (bounces / complaints)
Resend → **Webhooks → Add endpoint**
- URL: `https://your-app-domain/api/public/resend-webhook`
- Events: `email.delivered`, `email.bounced`, `email.complained`, `email.delivery_delayed`
- Copy the signing secret into `RESEND_WEBHOOK_SECRET`. Requests with a bad signature or old timestamp are rejected (401).

## 4. Try it
1. Sign in with **your real email** (the same one as your Resend account while testing).
2. **Team → Invite member** → enter an email → Send. The invite arrives from Vendora; the link opens `/accept-invite`.
3. Accepting signs the person in with the role fixed by the invitation and emails the inviter a confirmation.
4. Create/submit/approve a request, award an RFQ (PO), add a supplier, change a role, suspend someone → emails arrive (in the demo workspace they go to you only, subject prefixed `[Demo]`).
5. **Team → Announcement** emails all active members individually.
6. **Notifications** page → toggle email categories and see the delivery log.

## What was built (and why)
- All sending is server-side (`src/lib/mail.functions.ts`); the key never reaches the browser.
- Reliability: 3 attempts with exponential backoff on 429/5xx/network errors, an `Idempotency-Key` per email so retries/double-clicks never duplicate, errors returned (never thrown) so business actions are never blocked.
- Invitations: HMAC-signed, 7-day expiry, role/email/org locked inside the signature (tamper = rejected), resend creates a fresh link, expired/invalid/used links show clear screens.
- Safety: rate limits per IP and per recipient, strict input validation, HTML escaping, display-name sanitising, real sender is always your verified domain, links limited to in-app paths.
- Reusable branded template system in `src/server/mail/templates.server.ts`, with plain-text versions.
- Event emails are driven by `src/lib/mail-events.ts` watching workspace changes, so existing logic and tests are untouched.

## Known limits (because the app has no real backend/auth yet)
These need a real database + auth (e.g. Supabase/Lovable Cloud) to fully close:
1. **No server-side identity.** Any caller of the email endpoints is limited only by rate limits and validation. Add auth checks (and RLS) when real accounts exist.
2. **Invitations aren't stored server-side**, so "single-use", revoke-after-send, and adding the employee to the *inviter's* workspace can't be enforced across browsers. Today: single-use is tracked per browser, and the accepted employee gets the demo workspace with the invited role.
3. **No shared outbox/audit tables.** Delivery log and preferences live in the browser; bounce suppression is in server memory (resets on redeploy). Resend's dashboard is the system of record.
4. **Invoices/finance emails** aren't implemented because invoices don't exist in the app yet.
