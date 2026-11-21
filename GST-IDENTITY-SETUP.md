# GST Instant Identity: setup

## What it does
When a supplier types a valid GST number in **Trust Passport → Business registration (GST)**, Vendora instantly shows the government record:
legal name, trade name, status (Active / Cancelled), GST type, business type, registered address (city, state, pincode), nature of business,
registration date and whether the GST portal marks it blocked. It also says whether the legal name matches the company name on Vendora,
whether the state matches the profile, and whether another Vendora company already uses this GST number.
The supplier ticks **"this is my business"** before submitting. A Cancelled/Suspended number cannot be submitted.
The reviewer sees the same record plus the supplier's confirmation.

## Apply (4 steps)
1. Unzip into the project root (replace when asked).
2. Supabase SQL editor: run `supabase/migrations/20261207000026_gst_identity.sql` (safe to run twice).
3. Secrets for gstinapi.in (same ones gst-lookup uses; skip if already set). Auth header is `x-api-key`:
   ```
   supabase secrets set GST_API_URL="https://www.gstinapi.in/v1/gstin/{{gstin}}"
   supabase secrets set GST_API_METHOD="GET"
   supabase secrets set GST_API_HEADERS='{"x-api-key":"YOUR-GSTINAPI-KEY"}'
   ```
4. Deploy the new function (and re-deploy the old one, it shares the updated reader):
   ```
   supabase functions deploy gst-preview
   supabase functions deploy gst-lookup
   ```
   Leave "verify JWT" ON.

## Test (3 minutes)
Sign in as a supplier owner → Trust Passport → GST → type `33AAACC1206D1ZN` (gstinapi's own sample). The card should show
CENTRAL WAREHOUSING CORPORATION, Active, Regular, address with Chennai, Tamil Nadu 600015.
If nothing appears: Supabase → Edge Functions → gst-preview → Logs (error type only, never your key).

## Cost protection
Same GST number again within 6 hours is served from our own cache (free). 4 paid lookups per user per minute, 15 per company per day.
Submitting a proof still runs the normal single lookup for the reviewer.

## Honest limits
- Not run against your real key (no key here). The reader was run on the response you pasted and on two other shapes.
- gstinapi's sample returns `address: "Registered business address"` as a stand-in; we build the real address from `address_details`
  and never show the stand-in. If a real record has no address parts, the card shows city, state, pincode only.
- `nature_of_business` and `business_constitution` came back `null` in the sample, so those rows hide until the provider fills them.
