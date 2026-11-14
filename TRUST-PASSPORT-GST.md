# Live GST lookup: setup guide

## What it does
When a supplier submits a GST proof, the app quietly asks a GST data provider about that number and shows your reviewer:
- the **legal name** and **trade name** on the government record,
- whether the registration is **Active**,
- whether that name **matches the company name** the supplier gave you,
- the registration date.

A registration the government shows as **Cancelled/Suspended cannot be verified** (the database refuses), so a reviewer can't approve it by mistake.
It never blocks anything else: if the provider is down, or you haven't set it up yet, the reviewer just sees "not available" and checks by hand, exactly as before.

## Apply it (5 steps)
1. Unzip into your project root (replace when asked).
2. Supabase SQL editor → run `supabase/migrations/20261116000005_gst_lookup.sql` (after migration 4; safe to run twice).
3. **Choose a GST data provider and get an API key.** There is no free official public GST API; providers work through GST Suvidha Providers (GSPs).
   Examples that offer a "search GSTIN / taxpayer details" API: Sandbox (sandbox.co.in), HyperVerge, Masters India, ClearTax, Karza.
   Compare price per lookup and ask for a sandbox/test key first. Whatever they return, our code finds the standard GSTN fields
   (`lgnm`, `tradeNam`, `sts`, `rgdt`, `cxdt`, `ctb`) wherever the provider puts them.
4. Tell the function how to call your provider (secrets live in Supabase, never in the app):
   ```
   supabase secrets set GST_API_URL="https://PROVIDER-HOST/PATH-FROM-THEIR-DOCS"
   supabase secrets set GST_API_METHOD="POST"
   supabase secrets set GST_API_HEADERS='{"Authorization":"YOUR-KEY","x-api-key":"YOUR-KEY"}'
   supabase secrets set GST_API_BODY='{"gstin":"{{gstin}}"}'
   ```
   Copy the exact header names, URL and body shape from your provider's documentation. `{{gstin}}` is replaced with the GST number
   (safely escaped). For a GET provider: `GST_API_METHOD=GET` and put `{{gstin}}` in the URL instead of using a body.
5. Deploy: `supabase functions deploy gst-lookup`  (leave "verify JWT" ON, which is the default).

## Test it with a real number (5 minutes)
1. Submit a GST proof as a supplier, then open /admin/verification: a "Live government record" box appears within a few seconds
   (reviewer: refresh the page). If it says "not available", click **Run live check**.
2. If it stays unavailable: Supabase → Edge Functions → gst-lookup → Logs. The log shows only the error type (never your key).
   Most common causes: wrong URL/header name, wrong body shape, key not activated, provider wants a different content type.
3. Try one number that does not exist: you should see "no taxpayer with this GST number".

## Cost protection (built in)
One successful lookup per proof; max 3 tries per proof for suppliers (reviewers can retry); max 10 proofs per company per day.
A lookup only happens for a real, pending GST proof submitted by that company's owner/finance manager, or by a reviewer.
If you never set the secrets, the function does nothing and nothing is charged.

## What was tested
- 44 new database tests (name matching, permissions, limits, junk data, "cancelled cannot be verified", queue output).
- 32 behaviour tests running the REAL function code against a fake database and a fake provider (success, not found,
  provider down/blocked/rate-limited, unreadable answers, corrupt data, bad secrets, secrets never returned).
- 7 tests for the response reader. Your earlier suites still pass: verification 109, onboarding 112, invite-only 106. Build passes.
- NOT tested: your real provider (I don't have a key). That is the 5-minute test above.

## Honest limits
- The name comparison is a word-overlap check (ignores Pvt/Ltd/punctuation). "Partial" or "unknown" is a prompt for the reviewer, not a verdict.
- A GST number can be Active today and cancelled next year. Re-checking verified suppliers periodically is a good next step.
