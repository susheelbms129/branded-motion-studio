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
| `APP_URL` | yes | `https://your-app-domain` (no trailing slash) |
| `MAIL_FROM` | after domain verified | `Vendora <notifications@yourdomain.com>` |
| `MAIL_SUPPORT_EMAIL` | optional | `support@yourdomain.com` |
| `RESEND_WEBHOOK_SECRET` | for webhook | `whsec_...` |

Local dev: export them in the same terminal before starting, e.g. `RESEND_API_KEY=re_... npm run dev`.

## 3. Webhook (bounces / complaints)
Resend → **Webhooks → Add endpoint**
- URL: `https://your-app-domain/api/public/resend-webhook`
- Events: `email.delivered`, `email.bounced`, `email.complained`, `email.delivery_delayed`
- Copy the signing secret into `RESEND_WEBHOOK_SECRET`. Requests with a bad signature or old timestamp are rejected (401).

## 4. Try it
1. Sign in with **your real email** (the same one as your Resend account while testing).
2. **Team → Invite member** → enter an email → Send. The invite arrives from Vendora; the link opens `/accept-invite`.
3. The person signs in (or signs up) with the invited email and confirms it; accepting adds them to your company with the role fixed by the invitation. A different or unverified email is refused.
4. Create/submit/approve a request, award an RFQ (PO), add a supplier, change a role, suspend someone → emails arrive (in the demo workspace they go to you only, subject prefixed `[Demo]`).
5. **Team → Announcement** emails all active members individually.
6. **Notifications** page → toggle email categories and see the delivery log.

## What was built (and why)
- All sending is server-side (`src/lib/mail.functions.ts`); the key never reaches the browser.
- Reliability: 3 attempts with exponential backoff on 429/5xx/network errors, an `Idempotency-Key` per email so retries/double-clicks never duplicate, errors returned (never thrown) so business actions are never blocked.
- Invitations: stored in the database (see `supabase/SETUP.md`, section 9). Hashed single-use token, 7-day expiry, tied to one email and one role; sending again cancels the older link; expired, used and cancelled links show clear screens. Only the company owner can invite, checked by the database.
- Safety: rate limits per IP and per recipient, strict input validation, HTML escaping, display-name sanitising, real sender is always your verified domain, links limited to in-app paths.
- Reusable branded template system in `src/server/mail/templates.server.ts`, with plain-text versions.
- Event emails are driven by `src/lib/mail-events.ts` watching workspace changes, so existing logic and tests are untouched.

## Known limits (because the app has no real backend/auth yet)
These need a real database + auth (e.g. Supabase/Lovable Cloud) to fully close:
1. **Only invitations check identity.** The invitation endpoint forwards the caller's login to the database, which decides. The business-notification and announcement endpoints are still limited only by rate limits and validation; add the same check when those move to real data.
2. **No shared outbox/audit tables.** Delivery log and preferences live in the browser; bounce suppression is in server memory (resets on redeploy). Resend's dashboard is the system of record.
3. **Invoices/finance emails** aren't implemented because invoices don't exist in the app yet.
