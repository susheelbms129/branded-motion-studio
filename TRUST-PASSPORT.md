# Vendora Trust Passport: apply guide and what to build next

## What this adds
Instead of one yes/no "verified" badge, every supplier has a **Trust Passport**: separate proofs (GST registration, address,
bank, certificates), each reviewed on its own, each shown to buyers with a **verified date and an expiry date**.
A proof that goes stale **disappears from the buyer's view by itself**, with no one needing to remember.

Why buyers will prefer it: "Verified" on other platforms is a one-time badge nobody can check. Here a buyer sees WHAT was checked and
WHEN, and can check the GST/certificate numbers themselves.
Why it saves your money: the database checks the GST number (format, checksum, state, duplicate use) before any human sees it, so
reviewers only get clean cases. Typos never wait in a queue. One GST number can be verified for one company only.

## Apply it (4 steps)
1. Unzip into the ROOT of your project (replace when asked).
2. Run the new migration: Supabase dashboard → SQL editor → paste `supabase/migrations/20261115000004_trust_passport.sql` → Run.
   (It is safe to run twice. It also creates the PRIVATE bucket `verification-docs` and its rules.)
3. Make yourself a reviewer (SQL editor only, never from the app), then open /admin/verification:
   `insert into public.platform_admins (user_id) select id from auth.users where email = 'YOUR-EMAIL';`
4. Run the daily expiry job. Supabase → Database → Cron → new job, daily: `select public.refresh_trust_passports();`
   (Buyers never see an expired proof even before this runs; the job sends the "expires soon" and "expired" notices.)

Then `npm run dev`. Suppliers: dashboard → "Verify your business". Reviewers: /admin/verification.

## What was tested (all passing)
- 109 new database attack tests (supabase/tests/verification), plus your existing 112 + 106 still pass.
- Covered: strangers/buyers/other suppliers/employees cannot start, upload, read or decide anything; nobody can write
  tables directly or touch stored files; fake/typo GST numbers are blocked; oversize/wrong-type files blocked; max 3 files per proof;
  reviewers need to claim before deciding, cannot review their own company, cannot decide twice; buyers never see bank/address
  details; expiry and renewal; the daily job; audit trail.
- 21 front-end tests (GST checker agrees with the database), and a production build.
- NOT tested here: real Supabase storage and a real browser. Test one upload end to end after step 2 (see checklist below).

## First-day checklist (10 minutes)
1. Sign in as a supplier → Trust Passport → submit GST with a document.
2. In another browser sign in as yourself (reviewer) → /admin/verification → Take → open document → Verify.
3. Back as supplier: the passport shows Registered, with dates.
4. Try submitting a GST number with one wrong character: it must be refused instantly.

## Known limits (honest)
- The GST check is format + checksum + state: it proves the number is *well-formed*, not that it is *active*. The reviewer still
  compares the document. Next step below adds the real government lookup.
- Reviewers are added by SQL only (deliberate: no screen can ever grant admin).
- Documents are viewed via 60-second links. Files are never deleted from the app (evidence stays); delete old ones from the Supabase dashboard if needed.

## Build next, in this order (highest value first)
1. **Show the Passport to buyers** (1 day): on the buyer's supplier list/detail pages, render `<TrustPassport/>` using `loadPassport(orgId)`,
   add a "Verified only" filter and sort by level. This is where buyers feel the difference. (The component and function already exist.)
2. **Live GST lookup** (2 days): call a GST verification API from a Supabase Edge Function when a GST proof is submitted; store the result in
   `auto_flags` (legal name, active/cancelled). Show "name matches your company" to reviewers. Cuts review time further.
3. **Reviewer alerts** (half day): email/WhatsApp to your team when a proof has waited 12 hours. Add a "waiting > 24h" count to the queue.
4. **Supplier alerts by email** (half day): your existing mail module → send on verified / rejected / expiring (the notifications already exist in the database).
5. **Public passport link** (1 day): `vendora.in/p/<supplier>`, shareable on WhatsApp and quotations, a free marketing channel from your suppliers.
6. **Buyer feedback loop** (1 week): after each order, buyer rates delivery/quality; show "on-time 94%" next to the passport. Verification says
   "real company", performance says "good company". Together this is the moat.
7. **Dashboards, quotes, orders** as planned.
