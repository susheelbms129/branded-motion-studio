#!/usr/bin/env python3
"""
Tests for WhatsApp alerts (migration 25).
Builds a THROWAWAY database `vendora_whatsapp_test`, applies every migration, then checks: nobody can read phone numbers or
codes, the own-number proof (code hash, expiry, 5 tries, 3 codes an hour, one number per account), that nothing is queued
until a number is verified, merging of bursts, quiet hours (India time), the monthly cost cap, opt-outs (preferences, pause,
STOP reply, stop for good), the decision digest, the service functions the sender uses, and that a failure in the queueing hook
can never block the business action that caused the notification.
Never point it at a real project.

    PGHOST=localhost PGUSER=postgres python3 supabase/tests/whatsapp/run_tests.py
"""
import glob, json, os, subprocess, sys, uuid
HERE = os.path.dirname(os.path.abspath(__file__))
MIG = os.path.join(HERE, "..", "..", "migrations")
BOOT = os.path.join(HERE, "..", "invite_only", "bootstrap_local_supabase.sql")
DB = "vendora_whatsapp_test"
PSQL = os.environ.get("PSQL_BIN", "psql")

def run(args, sql=None, db=DB):
    return subprocess.run([PSQL, "-q", "-At", "-v", "ON_ERROR_STOP=1", "-d", db] + args, input=sql, capture_output=True, text=True)
def sh(sql, role=None, sub=None):
    if role:
        pre = f"begin; set local role {role}; "
        if sub: pre += f"select set_config('request.jwt.claims', '{json.dumps({'sub': sub})}', true); "
        sql = pre + sql + "; commit;"
    r = run([], sql)
    out = [l for l in r.stdout.strip().splitlines() if l.strip() and not l.startswith('{"sub"')]
    return r.returncode == 0, (out[-1] if out else ""), r.stderr
passed = failed = 0
def check(name, cond, extra=""):
    global passed, failed
    if cond: passed += 1
    else: failed += 1; print("FAIL:", name, extra)
def ok(name, res): check(name, res[0], res[2])
def denied(name, res, word=""): check(name, (not res[0]) and word in res[2], res[2][:200])

subprocess.run([PSQL, "-q", "-d", "postgres", "-c", f"drop database if exists {DB}"], check=True)
subprocess.run([PSQL, "-q", "-d", "postgres", "-c", f"create database {DB}"], check=True)
def apply(path):
    r = run(["-f", path])
    if r.returncode: print(r.stderr); sys.exit("failed: " + path)
apply(BOOT)
r = run([], """create schema storage;
create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, metadata jsonb default '{}'::jsonb);
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to authenticated;"""); assert r.returncode == 0, r.stderr
files = sorted(glob.glob(os.path.join(MIG, "*.sql")))
wa_mig = [f for f in files if f.endswith("_whatsapp_alerts.sql")]
assert wa_mig, "the WhatsApp migration (25) is missing"
for f in files: apply(f)
apply(wa_mig[0])  # safe to run twice

# ── people ──  B buyer owner, B2 buyer procurement manager, S supplier owner, X another buyer owner, N no company
names = "B B2 S X N".split()
ids = {k: str(uuid.uuid4()) for k in names}
for k in names:
    sh(f"insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values ('{ids[k]}','{k.lower()}@t.in',now(),'{json.dumps({'name': k + ' Person'})}')")
oB, oS, oX = (str(uuid.uuid4()) for _ in range(3))
for o, n, kind in [(oB, "Alpha Mills", "buyer"), (oS, "Kaveri Industrial", "supplier"), (oX, "Xeno Foods", "buyer")]:
    sh(f"insert into businesses(id,slug,name,kind) values ('{o}','{n.lower().replace(' ', '-')}','{n}','{kind}')")
sh(f"update profiles set account_type='supplier' where user_id = '{ids['S']}'")
for k, o, role in [("B", oB, "owner"), ("B2", oB, "procurement_manager"), ("S", oS, "owner"), ("X", oX, "owner")]:
    ok(f"(setup) {k} joins", sh(f"insert into memberships(org_id,user_id,role,status) values ('{o}','{ids[k]}','{role}','active')"))

U = lambda k, sql: sh(sql, "authenticated", ids[k])
SVC = lambda sql: sh(sql, "service_role")
ANON = lambda sql: sh(sql, "anon")
def call(who, fn, *args): return U(who, f"select {fn}({', '.join(args)})")
def J(res):
    try: return json.loads(res[1])
    except Exception: return {}
def q(s): return "'" + str(s).replace("'", "''") + "'"
SQL = lambda sql: sh(sql)[1]
PHONE, PHONE2 = "+919876543210", "+919812345678"
rfq1, rfq2 = str(uuid.uuid4()), str(uuid.uuid4())

def notify(user, org, kind, title, body, link):
    return sh(f"insert into notifications(org_id,user_id,kind,title,body,link_to) values ('{org}','{ids[user]}',{q(kind)},{q(title)},{q(body)},{q(link)})")
def outbox(user, kind=None, status=None):
    w = f"user_id='{ids[user]}'" + (f" and kind={q(kind)}" if kind else "") + (f" and status={q(status)}" if status else "")
    return int(SQL(f"select count(*) from whatsapp_outbox where {w}") or 0)
def verify(who, phone):
    ok(f"(setup) {who} gets a code", call(who, "start_whatsapp_verification", q(phone)))
    code = SQL(f"select body from whatsapp_outbox where user_id='{ids[who]}' and kind='verify' order by created_at desc limit 1")
    return code

# ── 1. nobody can reach the tables or the service functions ──
denied("tables: a signed-in user cannot read phone numbers", U("B", "select * from whatsapp_contacts"), "permission denied")
denied("tables: a signed-in user cannot read the outbox", U("B", "select * from whatsapp_outbox"), "permission denied")
denied("tables: nobody can write a verified contact directly", U("B", f"insert into whatsapp_contacts(user_id,phone,status) values ('{ids['B']}','{PHONE}','verified')"), "permission denied")
denied("tables: anon sees nothing", ANON("select * from whatsapp_contacts"), "permission denied")
for fn, args in [("wa_claim_batch", "5"), ("wa_mark_result", f"'{uuid.uuid4()}','sent'"), ("wa_provider_status", "'x','read'"), ("wa_stop_by_phone", f"'{PHONE}'")]:
    denied(f"service: a signed-in user cannot call {fn}", U("B", f"select {fn}({args})"), "permission denied")
    denied(f"service: anon cannot call {fn}", ANON(f"select {fn}({args})"), "permission denied")
denied("app: anon cannot start verification", ANON(f"select start_whatsapp_verification('{PHONE}')"), "permission denied")
denied("app: anon cannot read settings", ANON("select get_whatsapp_settings()"), "permission denied")
denied("internal: the queue hook is not callable by users", U("B", "select _wa_enqueue_from_notification()"), "permission denied")
denied("internal: the digest is not callable by users", U("B", "select _wa_rfq_digest(null)"), "permission denied")
denied("internal: the quiet-hours rule is not callable by users", U("B", "select _wa_next_allowed(now(), 1, 2)"), "permission denied")

# ── 2. before any number: nothing is queued ──
check("start: settings say none", J(call("B", "get_whatsapp_settings")).get("status") == "none")
ok("start: a notification with no WhatsApp number is just a notification", notify("B", oB, "rfq", "A quote", "x", f"rfqs/{rfq1}"))
check("start: nothing is queued", outbox("B") == 0)

# ── 3. the own-number proof ──
for bad in ["", "12345", "+0123456789", "abcdefghij", "+91 98765", "+9198765432101234567"]:
    denied(f"phone: '{bad}' is refused", call("B", "start_whatsapp_verification", q(bad)), "invalid_phone")
code = verify("B", "+91 98765-43210")
check("code: a 6 digit code is queued for the SENDER only", len(code) == 6 and code.isdigit(), code)
check("code: the number is stored cleaned (E.164)", SQL(f"select phone from whatsapp_contacts where user_id='{ids['B']}'") == PHONE)
check("code: only a hash is stored, never the code", SQL(f"select code_hash is not null and encode(code_hash,'escape') not like '%{code}%' from whatsapp_contacts where user_id='{ids['B']}'") == "t")
st = J(call("B", "get_whatsapp_settings"))
check("code: settings show pending with a masked number", st.get("status") == "pending" and st.get("phone") == "+91••••10" and st.get("code_pending") is True, str(st))
check("code: the full number never reaches the browser", PHONE not in json.dumps(st))
ok("code: pending people still get nothing", notify("B", oB, "rfq", "A quote", "x", f"rfqs/{rfq1}"))
check("code: ...nothing queued while pending", outbox("B", "rfq") == 0)
r = J(call("B", "confirm_whatsapp_verification", q("000000" if code != "000000" else "111111")))
check("code: a wrong code is refused and counted", r.get("ok") is False and r.get("error") == "wrong_code" and r.get("left") == 4, str(r))
check("code: the try was really counted", SQL(f"select code_attempts from whatsapp_contacts where user_id='{ids['B']}'") == "1")
for i in range(4): call("B", "confirm_whatsapp_verification", q("999999" if code != "999999" else "888888"))
r = J(call("B", "confirm_whatsapp_verification", q(code)))
check("code: after 5 wrong tries even the right code is refused", r.get("error") == "too_many", str(r))
# expired code
SQL(f"update whatsapp_contacts set code_attempts=0, code_expires_at=now()-interval '1 minute' where user_id='{ids['B']}'")
check("code: an expired code is refused", J(call("B", "confirm_whatsapp_verification", q(code))).get("error") == "expired")
check("code: no pending code gives a clear answer", J(call("N", "confirm_whatsapp_verification", q("123456"))).get("error") == "no_pending")
check("code: letters are refused, not crashed", J(call("B", "confirm_whatsapp_verification", q("abc"))).get("error") in ("expired", "wrong_code"))
# a second code (rate limit is 3 an hour) and the right one
code = verify("B", PHONE)
r = J(call("B", "confirm_whatsapp_verification", q(" " + code[:3] + " " + code[3:] + " ")))
check("code: the right code (with spaces) verifies", r.get("ok") is True, str(r))
check("code: the code is wiped after use", SQL(f"select code_hash is null and code_expires_at is null from whatsapp_contacts where user_id='{ids['B']}'") == "t")
check("code: settings now say verified", J(call("B", "get_whatsapp_settings")).get("status") == "verified")
check("same: starting again with the same verified number does not resend", J(call("B", "start_whatsapp_verification", q(PHONE))).get("status") == "verified")
denied("same: another account cannot claim a verified number", call("X", "start_whatsapp_verification", q(PHONE)), "phone_in_use")
ok("same: a different number is fine", call("X", "start_whatsapp_verification", q("+91 98123 45678")))

SQL(f"insert into whatsapp_outbox(user_id,kind,status) select '{ids['X']}','verify','sent' from generate_series(1,3)")
denied("rate: a 4th code in an hour is refused", call("X", "start_whatsapp_verification", q("+919833333333")), "rate_limited")
SQL(f"delete from whatsapp_outbox where user_id='{ids['X']}' and kind='verify'")

# ── 4. alerts: queued, merged, kept apart ──
ok("queue: a quote notification arrives", notify("B", oB, "rfq", "Kaveri sent a quote", "Steel rods", f"rfqs/{rfq1}"))
check("queue: it becomes one queued message", outbox("B", "rfq", "queued") == 1)
check("queue: it waits ~90 seconds (a burst can merge)", SQL(f"select send_after > now() + interval '60 seconds' from whatsapp_outbox where user_id='{ids['B']}' and kind='rfq'") == "t")
notify("B", oB, "rfq", "Bharat sent a quote", "Steel rods", f"rfqs/{rfq1}")
notify("B", oB, "rfq", "Newbie sent a quote", "Steel rods", f"rfqs/{rfq1}")
check("merge: three updates on one RFQ are still ONE message", outbox("B", "rfq", "queued") == 1)
check("merge: it says how many and keeps the newest words", SQL(f"select merged||'|'||title from whatsapp_outbox where user_id='{ids['B']}' and kind='rfq'") == "3|Newbie sent a quote")
notify("B", oB, "rfq", "Other RFQ quote", "Cement", f"rfqs/{rfq2}")
check("merge: a different RFQ is a separate message", outbox("B", "rfq", "queued") == 2)
notify("B", oB, "po", "PO acknowledged", "PO-1", f"purchase-orders/{uuid.uuid4()}")
check("queue: orders are their own kind", outbox("B", "po", "queued") == 1)
notify("B", oB, "weird", "Other kind", "x", None)
check("queue: unknown kinds never go to WhatsApp", outbox("B", "weird") == 0)
notify("B2", oB, "rfq", "Quote", "x", f"rfqs/{rfq1}")
check("queue: a teammate without WhatsApp gets nothing", outbox("B2") == 0)
check("queue: the message belongs to the right company", SQL(f"select count(*) from whatsapp_outbox where user_id='{ids['B']}' and org_id='{oB}' and kind in ('rfq','po')") == "3")

# ── 5. preferences, pause, quiet hours ──
st = J(call("B", "set_whatsapp_prefs", "$j${\"want_po\": false}$j$::jsonb"))
check("prefs: orders switched off", st.get("want_po") is False and st.get("want_rfq") is True, str(st))
notify("B", oB, "po", "PO again", "x", f"purchase-orders/{uuid.uuid4()}")
check("prefs: no new order message after switching off", outbox("B", "po", "queued") == 1)
for bad in ['{"quiet_start": 25}', '{"quiet_end": -1}', '{"want_rfq": "maybe"}', '[1]', '"x"']:
    denied(f"prefs: {bad} is refused", call("B", "set_whatsapp_prefs", f"$j${bad}$j$::jsonb"), "invalid_request")
denied("prefs: a person with no number cannot set prefs", call("N", "set_whatsapp_prefs", "$j${}$j$::jsonb"), "no_contact")
check("quiet: 11pm India time waits for 8am", SQL("select _wa_next_allowed('2026-11-20 17:30:00+00', 21, 8) at time zone 'UTC'") == "2026-11-21 02:30:00")
check("quiet: 3am India time waits for 8am the same day", SQL("select _wa_next_allowed('2026-11-19 21:30:00+00', 21, 8) at time zone 'UTC'") == "2026-11-20 02:30:00")
check("quiet: 10am is sent as is", SQL("select _wa_next_allowed('2026-11-20 04:30:00+00', 21, 8) = '2026-11-20 04:30:00+00'::timestamptz") == "t")
check("quiet: 9pm sharp is already quiet", SQL("select _wa_next_allowed('2026-11-20 15:30:00+00', 21, 8) at time zone 'UTC'") == "2026-11-21 02:30:00")
check("quiet: 8am sharp is allowed", SQL("select _wa_next_allowed('2026-11-20 02:30:00+00', 21, 8) = '2026-11-20 02:30:00+00'::timestamptz") == "t")
check("quiet: same start and end means no quiet hours", SQL("select _wa_next_allowed('2026-11-20 20:00:00+00', 9, 9) = '2026-11-20 20:00:00+00'::timestamptz") == "t")
check("quiet: a daytime window (1pm-3pm) works too", SQL("select _wa_next_allowed('2026-11-20 08:00:00+00', 13, 15) at time zone 'UTC'") == "2026-11-20 09:30:00")
call("B", "set_whatsapp_prefs", "$j${\"want_po\": true}$j$::jsonb")
SQL(f"update whatsapp_outbox set status='sent' where user_id='{ids['B']}'")

# ── 6. the cost cap ──
SQL(f"insert into whatsapp_outbox(user_id,org_id,kind,status) select '{ids['B2']}','{oB}','rfq','sent' from generate_series(1,300)")
ok("cap: another notification still saves", notify("B", oB, "rfq", "Over the cap", "x", f"rfqs/{uuid.uuid4()}"))
check("cap: but it is skipped, not sent", SQL(f"select status||'|'||last_error from whatsapp_outbox where user_id='{ids['B']}' and title='Over the cap'") == "skipped|monthly_cap")
check("cap: the other company is not affected", (lambda: (verify("X", PHONE2), call("X", "confirm_whatsapp_verification", q(SQL(f"select body from whatsapp_outbox where user_id='{ids['X']}' and kind='verify' order by created_at desc limit 1")))))() and notify("X", oX, "rfq", "X quote", "y", f"rfqs/{uuid.uuid4()}")[0] and outbox("X", "rfq", "queued") == 1)
SQL(f"delete from whatsapp_outbox where user_id='{ids['B2']}'")

# ── 7. the sender: claim, digest, results ──
# real quotes for rfq1: 100000, 92000, 108000 (no GST, no freight) => 3 quotes, lowest 92000, average 100000
sup = [str(uuid.uuid4()) for _ in range(3)]
for i, s in enumerate(sup):
    sh(f"insert into businesses(id,slug,name,kind) values ('{s}','sup{i}','Sup {i}','supplier')")
SQL(f"insert into rfqs(id,org_id,number,title,owner_id,status) values ('{rfq1}','{oB}','RFQ-1','Steel rods','{ids['B']}','evaluating')")
SQL(f"insert into rfq_items(id,org_id,rfq_id,description,qty,unit) values ('{uuid.uuid4()}','{oB}','{rfq1}','Rod',1,'Nos')")
item = SQL(f"select id from rfq_items where rfq_id='{rfq1}'")
for s, price in zip(sup, (100000, 92000, 108000)):
    qid = str(uuid.uuid4())
    ok("(setup) a quote", sh(f"insert into quotations(id,org_id,rfq_id,supplier_id,supplier_org,gst_rate,shipping,other_charges) select '{qid}','{oB}','{rfq1}',null,'{s}',0,0,0"))
    ok("(setup) a quote line", sh(f"insert into quotation_lines(org_id,quotation_id,rfq_item_id,qty,unit_price) values ('{oB}','{qid}','{item}',1,{price})"))
for t in ("Kaveri sent a quote", "Bharat sent a quote", "Newbie sent a quote"):
    notify("B", oB, "rfq", t, "Steel rods", f"rfqs/{rfq1}")
SQL("update whatsapp_outbox set send_after = now() - interval '1 minute' where status='queued'")
b = SVC("select wa_claim_batch(50)")
rows = json.loads(b[1]) if b[0] and b[1] else []
check("claim: the due messages are taken", len(rows) >= 3, b[2] or b[1][:200])
mine = [x for x in rows if x["kind"] == "rfq" and x["link_to"] == f"rfqs/{rfq1}"]
check("claim: the RFQ message carries the live digest", bool(mine) and mine[0]["digest"] == {"quotes": 3, "lowest": 92000.0, "average": 100000.0}, str(mine))
check("claim: the phone number is given to the sender", mine and mine[0]["phone"] == PHONE)
check("claim: it says how many updates were merged", mine and mine[0]["merged"] == 3)
check("claim: those rows are now 'sending' with one attempt", SQL(f"select status||attempts from whatsapp_outbox where id='{mine[0]['id']}'") == "sending1")
check("claim: nothing is handed out twice", json.loads(SVC("select wa_claim_batch(50)")[1]) == [])
check("claim: another RFQ (no quotes yet) has no digest", all(x["digest"] is None for x in rows if x["link_to"] != f"rfqs/{rfq1}"))
ok("result: sent is recorded", SVC(f"select wa_mark_result('{mine[0]['id']}','sent','wamid.AAA','')"))
check("result: ...with the provider id and time", SQL(f"select status||provider_id||(sent_at is not null) from whatsapp_outbox where id='{mine[0]['id']}'") == "sentwamid.AAAtrue")
other = [x for x in rows if x["id"] != mine[0]["id"]][0]
ok("result: a temporary failure is retried later", SVC(f"select wa_mark_result('{other['id']}','retry',null,'timeout')"))
check("result: ...queued again, a little later", SQL(f"select status||(send_after > now())||last_error from whatsapp_outbox where id='{other['id']}'") == "queuedtruetimeout")
for i in range(3):
    SQL(f"update whatsapp_outbox set send_after=now()-interval '1 minute' where id='{other['id']}'")
    SVC("select wa_claim_batch(50)")
    SVC(f"select wa_mark_result('{other['id']}','retry',null,'timeout')")
check("result: after 4 attempts it stops trying", SQL(f"select status from whatsapp_outbox where id='{other['id']}'") == "failed")
hold = [x for x in rows if x["id"] not in (mine[0]["id"], other["id"])]
if hold:
    h = hold[0]["id"]
    ok("result: 'hold' (our setup is wrong) waits without using up an attempt", SVC(f"select wa_mark_result('{h}','hold',null,'token_expired')"))
    check("result: ...queued 10 minutes later, attempts back to 0, reason kept", SQL(f"select status||attempts||(send_after > now() + interval '9 minutes')||last_error from whatsapp_outbox where id='{h}'") == "queued0truetoken_expired")
ok("result: a wrong or old id is ignored quietly", SVC(f"select wa_mark_result('{uuid.uuid4()}','sent','x','')"))
ok("provider: delivered is recorded", SVC("select wa_provider_status('wamid.AAA','delivered','')"))
check("provider: ...with a time", SQL("select delivered_at is not null from whatsapp_outbox where provider_id='wamid.AAA'") == "t")
ok("provider: a failed delivery is recorded", SVC("select wa_provider_status('wamid.AAA','failed','blocked')"))
check("provider: ...as failed with the reason", SQL("select status||last_error from whatsapp_outbox where provider_id='wamid.AAA'") == "failedblocked")

# a verification code is wiped once handled
vc = verify("X", "+919811111111")
SVC("select wa_claim_batch(50)") ; vid = SQL(f"select id from whatsapp_outbox where user_id='{ids['X']}' and kind='verify' order by created_at desc limit 1")
SQL(f"update whatsapp_outbox set status='sending' where id='{vid}'")
SVC(f"select wa_mark_result('{vid}','sent','wamid.V','')")
check("code: the verification code is wiped from the outbox once sent", SQL(f"select body from whatsapp_outbox where id='{vid}'") == "")

# ── 8. opt-outs always win, even at the last moment ──
notify("B", oB, "rfq", "Another quote", "z", f"rfqs/{uuid.uuid4()}")
check("stop: a new message is queued", outbox("B", "rfq", "queued") >= 1)
SQL("update whatsapp_outbox set send_after = now() - interval '1 minute' where status='queued'")
call("B", "set_whatsapp_prefs", "$j${\"paused\": true}$j$::jsonb")
check("pause: queued messages are dropped at once", outbox("B", "rfq", "queued") == 0)
notify("B", oB, "rfq", "While paused", "z", f"rfqs/{uuid.uuid4()}")
check("pause: nothing is queued while paused", outbox("B", "rfq", "queued") == 0)
call("B", "set_whatsapp_prefs", "$j${\"paused\": false}$j$::jsonb")
notify("B", oB, "rfq", "Resumed", "z", f"rfqs/{uuid.uuid4()}")
check("pause: resuming works", outbox("B", "rfq", "queued") == 1)
SQL("update whatsapp_outbox set send_after = now() - interval '1 minute' where status='queued'")
n = SQL(f"select wa_stop_by_phone('{PHONE}')")
check("STOP reply: queued messages are dropped", outbox("B", "rfq", "queued") == 0 and n == "1", n)
check("STOP reply: the person is paused, not deleted", SQL(f"select paused::text||status from whatsapp_contacts where user_id='{ids['B']}'") == "trueverified")
check("STOP reply: an unknown or bad number is harmless", SQL("select wa_stop_by_phone('+10000000000')") == "0" and SQL("select wa_stop_by_phone('nonsense')") == "0")
# last-moment opt-out: a message already due is skipped if the person paused after it was queued
call("B", "set_whatsapp_prefs", "$j${\"paused\": false}$j$::jsonb"); notify("B", oB, "rfq", "Late one", "z", f"rfqs/{uuid.uuid4()}")
SQL("update whatsapp_outbox set send_after = now() - interval '1 minute' where status='queued'")
SQL(f"update whatsapp_contacts set paused=true where user_id='{ids['B']}'")
check("last moment: a due message is skipped if they paused meanwhile", all(x.get("title") != "Late one" for x in json.loads(SVC("select wa_claim_batch(50)")[1])))
check("last moment: ...and it is recorded as opted out", SQL(f"select last_error from whatsapp_outbox where title='Late one'") == "opted_out")
SQL(f"update whatsapp_contacts set paused=false where user_id='{ids['B']}'")

# stale messages are dropped, not sent a day late
SQL(f"insert into whatsapp_outbox(user_id,org_id,kind,title,created_at,send_after) values ('{ids['B']}','{oB}','rfq','Ancient',now()-interval '25 hours',now()-interval '24 hours')")
SQL(f"insert into whatsapp_outbox(user_id,kind,body,created_at,send_after) values ('{ids['B']}','verify','123456',now()-interval '20 minutes',now()-interval '19 minutes')")
SVC("select wa_claim_batch(50)")
check("old: an alert queued for over a day is dropped", SQL("select status||last_error from whatsapp_outbox where title='Ancient'") == "failedtoo_old")
check("old: an unsent code older than 15 minutes is dropped and wiped", SQL(f"select status||last_error||'|'||body from whatsapp_outbox where user_id='{ids['B']}' and kind='verify' and created_at < now()-interval '15 minutes' order by created_at desc limit 1") == "failedtoo_old|")

# ── 9. test message and its limit ──
for i in range(3): ok("test: a test message", call("B", "send_whatsapp_test"))
denied("test: a 4th a day is refused", call("B", "send_whatsapp_test"), "rate_limited")
denied("test: unverified people cannot send tests", call("N", "send_whatsapp_test"), "not_verified")

# ── 10. turning it off for good ──
notify("B", oB, "rfq", "Before stop", "z", f"rfqs/{uuid.uuid4()}")
ok("off: stop", call("B", "stop_whatsapp"))
check("off: the number is deleted", SQL(f"select count(*) from whatsapp_contacts where user_id='{ids['B']}'") == "0")
check("off: anything waiting is dropped", outbox("B", "rfq", "queued") == 0)
notify("B", oB, "rfq", "After stop", "z", f"rfqs/{uuid.uuid4()}")
check("off: nothing new is queued", outbox("B", "rfq", "queued") == 0)
check("off: settings say none again", J(call("B", "get_whatsapp_settings")).get("status") == "none")
SQL(f"delete from whatsapp_outbox where user_id='{ids['X']}' and kind='verify'")  # the hourly code limit is its own test
check("off: the number can be used by someone else now", call("X", "start_whatsapp_verification", q(PHONE))[0])

# ── 11. the business action can never be blocked ──
verify("S", "+919822222222")
call("S", "confirm_whatsapp_verification", q(SQL(f"select body from whatsapp_outbox where user_id='{ids['S']}' and kind='verify' order by created_at desc limit 1")))
SQL("alter table whatsapp_outbox add constraint boom check (false) not valid")
ok("safe: a notification still saves when the queue is broken", notify("S", oS, "po", "Order", "x", f"orders/{uuid.uuid4()}"))
check("safe: the notification row exists", SQL(f"select count(*) from notifications where user_id='{ids['S']}' and title='Order'") == "1")
SQL("alter table whatsapp_outbox drop constraint boom")

# ── 12. the supplier side and the rest ──
ok("supplier: a quote request notification", notify("S", oS, "rfq", "New quote request from Alpha Mills", "Steel rods", f"quote-requests/{uuid.uuid4()}"))
check("supplier: queued, with no digest (no buyer prices)", outbox("S", "rfq", "queued") == 1 and SQL(f"select _wa_rfq_digest(link_to) is null from whatsapp_outbox where user_id='{ids['S']}' and kind='rfq'") == "t")
check("digest: a made-up or odd link gives nothing, never an error", SQL("select _wa_rfq_digest('rfqs/not-a-uuid') is null and _wa_rfq_digest(null) is null and _wa_rfq_digest('orders/" + str(uuid.uuid4()) + "') is null") == "t")
check("migration applied twice is harmless", run(["-f", wa_mig[0]]).returncode == 0)
check("settings still work after re-applying", J(call("S", "get_whatsapp_settings")).get("status") == "verified")

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
