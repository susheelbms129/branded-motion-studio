# Free GST live-check test (gstinapi.in), Windows PowerShell

Free signup credits are small (sources I found say between 10 and 100 lookups, no card). Check the signup page for the real number.
Nobody here has used this account for you, so treat the first run as a test.

## 1. Get the key (2 min)
1. Open https://www.gstinapi.in/register and sign up.
2. Create/copy your API key (dashboard -> API keys). Keep it secret: never paste it in chat, git or the app code.

## 2. Give the key to Supabase (2 min)
In the project folder, create a file called `gst.env.local` (Notepad) with exactly these 3 lines, your key in place of YOUR_KEY:
```
GST_API_URL=https://www.gstinapi.in/v1/gstin/{{gstin}}
GST_API_METHOD=GET
GST_API_HEADERS={"x-api-key":"YOUR_KEY"}
```
Then run:
```
supabase secrets set --env-file ./gst.env.local --project-ref ztamzxzmgohjlxgtyvsl
```
Delete `gst.env.local` afterwards (it holds your key). The name ends in .local so git ignores it, but still delete it.

## 3. Deploy the function (1 min). It must be redeployed: the reader of the provider's answer changed
```
supabase functions deploy gst-lookup --project-ref ztamzxzmgohjlxgtyvsl
```
If it says "not logged in": `supabase login`. If it complains about Docker: add `--use-api`.

## 4. Test (5 min)
1. Sign in as a supplier -> Trust Passport -> submit a GST number with a document. Use a number that really exists
   (your own, or a public company's, for example 33AAACC1206D1ZN, Central Warehousing Corporation, passes our checksum).
2. Sign in as reviewer -> /admin/verification -> the "Live government record" box shows legal name, status and name match
   within seconds (refresh once). If it says "not available", click "Run live check" (wait 30 seconds between tries).
3. If it stays unavailable: Supabase -> Edge Functions -> gst-lookup -> Logs. 401 = wrong key, 402 = out of credits, 429 = too fast.
4. A GST number that passes the checksum but does not exist should show "no taxpayer with this GST number".
