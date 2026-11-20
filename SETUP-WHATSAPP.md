# WhatsApp alerts: setup (do this last, it needs Meta's approval)

The app is ready and safe without any of this: until the keys below are set, the WhatsApp panel says "coming soon" and nothing is ever sent.

## What people get
- **Suppliers:** a WhatsApp when a buyer asks them for a quote, and when an order arrives.
- **Buyers:** a WhatsApp when quotes arrive, with the verdict: "3 quotes in. Lowest ₹92,000, 8% below the average."
- Bursts merge into one message, quiet hours (default 9 pm to 8 am India time) are respected, a monthly cap of 300 messages per company protects your bill, and replying STOP pauses everything.

## 1. Database
Run `supabase/migrations/20261206000025_whatsapp_alerts.sql` in Supabase (safe to run twice).

## 2. Meta (WhatsApp Cloud API)
1. Create a Meta Business account and a WhatsApp Business app at developers.facebook.com. Add a phone number.
2. Create a **System User** token (never the 24 hour test token) with `whatsapp_business_messaging` permission. This is `WHATSAPP_TOKEN`.
3. Copy the **Phone number ID** → `WHATSAPP_PHONE_NUMBER_ID`. Copy the **App secret** → `WHATSAPP_APP_SECRET`.
4. Create two templates and wait for approval (usually minutes to a day):
   - `vendora_verify_code`, category **Authentication**, with the "copy code" button. The code goes in the body and the button.
   - `vendora_alert`, category **Utility**, language English, body exactly:
     `{{1}}` newline `{{2}}` newline `Open: {{3}}`
     (three variables: headline, detail, link). Example values: "3 updates on your RFQ: Steel rods" / "3 quotes in. Lowest ₹92,000, 8% below the average." / "https://yourdomain.com/buyer/dashboard/rfqs/…"
   If you use other names, set `WHATSAPP_ALERT_TEMPLATE` / `WHATSAPP_VERIFY_TEMPLATE`.
5. Webhook (WhatsApp → Configuration): callback URL `https://<your-domain>/api/public/whatsapp-webhook`, verify token = `WHATSAPP_VERIFY_TOKEN` (random, 16+ characters), subscribe to **messages**.

## 3. Your host
Set: `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_CRON_SECRET` (random, 32+ characters), `APP_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (server only, never in the browser or in VITE_ variables).

## 4. The sender job
Call this every minute from any scheduler (cron-job.org is free):

    POST https://<your-domain>/api/public/whatsapp-drain
    Authorization: Bearer <WHATSAPP_CRON_SECRET>

It is safe to run twice at once. If the token expires or a template is not approved, messages wait (they are not lost) and send once it is fixed; alerts older than 24 hours are dropped as stale.

## 5. Test
Open Notifications (buyer) or the supplier dashboard → WhatsApp alerts → enter your number → confirm the code → "Send me a test".

## Cost
Meta bills per conversation/template. Utility messages are cheap in India but not free; the 300 per company per month cap in `_wa_cap()` keeps it bounded. Verification codes count against Meta's authentication pricing.
