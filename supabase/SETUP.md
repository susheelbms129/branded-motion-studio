# Supabase setup for Vendora

## 1. Create the project
1. supabase.com -> New project. Pick region **Mumbai (ap-south-1)** so customer data stays in India.
2. Save the database password in a password manager (not in git).

## 2. Run the schema
Dashboard -> SQL Editor -> New query -> paste all of
`supabase/migrations/20261113000001_core_schema.sql` -> Run.
It creates every table, turns on Row Level Security on all of them, and adds the roles and audit log.

## 3. Auth settings (Authentication -> Providers / Settings)
- Email provider on, **Confirm email = ON**.
- Minimum password length **12**, and turn on **leaked password protection** (Pro plan) if available.
- Site URL = your app URL. Add redirect URLs for local dev (http://localhost:8081) and production.
- Apple / Google: enable later, each needs its own developer credentials.
- Turn on MFA (TOTP) under Authentication -> Multi-Factor.

## 4. Keys
Project Settings -> API. Copy into your `.env` (see `.env.example`):
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (copy `.env.example` to `.env`, fill in, restart `npm run dev`)
- `SUPABASE_SERVICE_ROLE_KEY` is server-only. Never in frontend code, never in git.

## 5. Safety switches (do these before real customers)
- Database -> Backups: enable **Point-in-time recovery** (paid plan) and test one restore.
- Settings -> API: keep the service-role key out of chat, tickets and screenshots. Rotate it if it ever leaks.
- Make **separate projects** for dev, staging and production.
- Run Database -> Advisors (Security) and fix everything it reports.
- Add Auth rate limits (Authentication -> Rate Limits).

## 6. How tenant isolation works
Every business table has `org_id`. RLS policies call `is_member(org_id)` / `has_role(org_id, ...)`,
so a logged-in user only ever sees rows of organisations they belong to, and writes are limited by role.
Creating a workspace is done through `create_organization(name, slug)`, which makes the caller the owner.
The `audit_log` table is append-only: nobody can update or delete rows.

## 7. Install the package
`npm install` (adds `@supabase/supabase-js`, already listed in package.json).

## 8. Auth flow in the app
- `/signup` creates the account. With "Confirm email" on, the user gets a link, clicks it, lands on `/app`.
- `/signin` signs in. `/app` and `/onboarding` check the real session; no session -> `/signin`.
- First login with no company -> `/onboarding` -> `create_organization()` makes the workspace and the owner.
- Sign out (account menu) ends the session; signing out in another tab also logs this tab out.
- Google / Apple buttons work only after you enable them in Authentication -> Providers and add the
  redirect URL `https://<your-project>.supabase.co/auth/v1/callback` in the Google / Apple console.

## Not done yet
Forgot-password page, invitation acceptance, and replacing the mock business data (requests, RFQs,
POs...) with database reads and writes.
