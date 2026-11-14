# Trust Passport hardening (migration 6): apply guide

## Apply it (3 steps)
1. Unzip into the ROOT of your project (replace when asked).
2. Supabase SQL editor -> run `supabase/migrations/20261117000006_trust_hardening.sql` (after migrations 4 and 5; safe to run twice).
3. Redeploy the edge function (only a small error-code list changed): `supabase functions deploy gst-lookup`
   Make sure the daily cron from migration 4 exists: `select public.refresh_trust_passports();`
   The review screen now shows a health box; it says "Daily expiry job: has never run" until the cron fires once.

## What changed and why
| Problem found in the old SQL | Now |
|---|---|
| "Sri Ltd" matched "Sri Lakshmi Steel Industries" (overlap divided by the SHORTER name); "Sharma Enterprises" half-matched "Verma Enterprises" | The longer name counts, generic words (Enterprises, Traders, Industries, Services...) are ignored, a short name is at most "partial". It is a signal for the reviewer, never proof |
| Only an "ok" lookup could stop a bad GST proof | One rule per outcome (table below) |
| Retries: reviewers unlimited, double-clicks cost money | 30 s cooldown, suppliers 3 and reviewers 6 tries per proof, 15 tries per company per day, platform kill switch at 500 tries per day |
| Any employee of a supplier company could read address, IFSC and documents | Only owner / finance manager (and reviewers). Employees see nothing |
| `check_gstin` comment said "no login" but needs one | Comment fixed. The signup screen uses `src/lib/gstin.ts`, so no public grant is needed (a public grant would be abusable) |
| No view of stuck reviews or a dead cron | Review screen health box + `admin_ops_stats()`, `admin_release_stale()`, cron heartbeat |
| "Certified" over-claimed | Level 3 is now "Verified + Certificates". Every proof says "Government record checked" or "Document reviewed by Vendora", plus a one-line disclaimer |

## GST outcome policy (who decides what)
| Live check result | Reviewer may verify? |
|---|---|
| Active, name matches or partly matches | Yes |
| Active, name does NOT match | Only with a written note (10+ characters) |
| Status missing / unknown | Only with a written note (check the GST portal) |
| Cancelled / Suspended / anything not Active | No. Reject with a note |
| Not found in the government record | Only with a written note (new numbers can be missing for a while) |
| Provider down / not set up | Yes, by hand, as before |
The note is visible to the supplier. It is saved with the proof and the decision is in the audit log.

## Tested here
Database suites against a real PostgreSQL 16: verification 109, GST lookup 84 (40 new), onboarding 112, invite-only 106, all passing.
Front end: 28 tests pass and the production build passes. Type-check shows the same 131 old errors in files not touched here (AuthScreen, BuyerOnboarding), none in the new code.
NOT tested: real Supabase storage, your real GST provider, a real browser.

## Next (in this order)
1. Real supplier directory for buyers (Suppliers pages still use demo data) with the Trust Passport and a "Verified only" filter.
2. Plug in your GST provider and run the 5-minute test in TRUST-PASSPORT-GST.md.
3. Public passport link + supplier emails. 4. RFQ -> quote -> PO flow. 5. Delivery and quality ratings after orders.
