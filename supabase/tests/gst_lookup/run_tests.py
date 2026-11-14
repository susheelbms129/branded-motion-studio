#!/usr/bin/env python3
"""
Tests for supabase/migrations/20261116000005_gst_lookup.sql (live GST lookup)
Builds a THROWAWAY database `vendora_gst_lookup_test`, applies migrations 1-4 (with a stand-in for Supabase storage),
then attacks them as suppliers, buyers, a reviewer and strangers. Never point it at a real project.

    PGHOST=localhost PGUSER=postgres python3 supabase/tests/verification/run_tests.py
"""
import json, os, subprocess, sys, uuid
HERE = os.path.dirname(os.path.abspath(__file__))
MIG = os.path.join(HERE, "..", "..", "migrations")
BOOT = os.path.join(HERE, "..", "invite_only", "bootstrap_local_supabase.sql")
DB = "vendora_gst_lookup_test"
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
def denied(name, res, word=""): check(name, (not res[0]) and word in res[2], res[2])

subprocess.run([PSQL, "-q", "-d", "postgres", "-c", f"drop database if exists {DB}"], check=True)
subprocess.run([PSQL, "-q", "-d", "postgres", "-c", f"create database {DB}"], check=True)
def apply(path):
    r = run(["-f", path])
    if r.returncode: print(r.stderr); sys.exit("failed: " + path)
apply(BOOT)
# stand-in for Supabase storage (only the parts the policies touch)
apply_sql = """
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, metadata jsonb default '{}'::jsonb);
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to authenticated;
"""
r = run([], apply_sql); assert r.returncode == 0, r.stderr
for m in ["20261113000001_core_schema", "20261113000002_invite_only_onboarding", "20261114000003_onboarding_profiles"]:
    apply(os.path.join(MIG, m + ".sql"))
M4 = os.path.join(MIG, "20261115000004_trust_passport.sql")
apply(M4)
M5 = os.path.join(MIG, "20261116000005_gst_lookup.sql")
apply(M5); apply(M5)   # must be safe to run twice
M6 = os.path.join(MIG, "20261117000006_trust_hardening.sql")
apply(M6); apply(M6)   # hardening: safe to run twice

ids = {k: str(uuid.uuid4()) for k in "SFXBMAZ"}  # S owner, F finance, X other supplier owner, B buyer, M member-employee, A admin, Z stranger
def add_user(k, email, typ):
    sh(f"insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values ('{ids[k]}','{email}',now(),'{json.dumps({'name': k + ' user', 'account_type': typ})}')")
for k, t in [("S", "supplier"), ("F", "supplier"), ("X", "supplier"), ("B", "buyer"), ("M", "supplier"), ("A", "supplier"), ("Z", "supplier")]:
    add_user(k, f"{k.lower()}@t.in", t)
org1, org2, orgB = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
for o, n, kind, st in [(org1, "Kaveri Industrial", "supplier", "Karnataka"), (org2, "Other Supplies", "supplier", "Maharashtra"), (orgB, "Buyer Co", "buyer", "Karnataka")]:
    sh(f"insert into businesses(id,slug,name,kind,state) values ('{o}','{n.lower().replace(' ', '-')}','{n}','{kind}','{st}')")
    if kind == "supplier": sh(f"insert into supplier_verifications(org_id) values ('{o}')")
for k, o, role in [("S", org1, "owner"), ("F", org1, "finance_manager"), ("M", org1, "employee"), ("X", org2, "owner"), ("B", orgB, "owner")]:
    sh(f"insert into memberships(org_id,user_id,role) values ('{o}','{ids[k]}','{role}')")
sh(f"insert into platform_admins(user_id) values ('{ids['A']}')")
U = lambda k, sql: sh(sql, "authenticated", ids[k])

def cs(n=3):
    C = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    def chk(g):
        s = 0
        for i, ch in enumerate(g[:14]):
            v = C.index(ch) * (1 if i % 2 == 0 else 2); s += v // 36 + v % 36
        return C[(36 - s % 36) % 36]
    return chk
chk = cs()
mk = lambda base: base + chk(base + "0")
GST_KA = mk("29AABCT1332L1Z")      # Karnataka, valid checksum
GST_MH = "27AAPFU0939F1ZV"          # Maharashtra, real-world vector
BAD_SUM = GST_KA[:-1] + ("0" if GST_KA[-1] != "0" else "1")


SVC = lambda sql: sh(sql)                       # the Edge Function (service role) is stood in for by the superuser
rec = lambda cid, res: SVC(f"select record_gst_lookup('{cid}', $j${json.dumps(res)}$j$::jsonb)")
look = lambda cid: json.loads(sh(f"select coalesce(lookup,'null'::jsonb)::text from verification_checks where id='{cid}'")[1])
def submitted_gst(k, org, gst):
    cid = start(k, org, "registration", "", gst)[1]
    put(k, f"{org}/{cid}/a.pdf"); U(k, f"select attach_document('{cid}','{org}/{cid}/a.pdf','a.pdf')"); U(k, f"select submit_check('{cid}')")
    return cid
start = lambda k, org, typ, label="", ref="": U(k, f"select start_check('{org}','{typ}','{label}','{ref}','',null,null)")
def put(k, path, size=1000, mime="application/pdf"):
    return U(k, f"insert into storage.objects(bucket_id,name,metadata) values ('verification-docs','{path}','{json.dumps({'size': size, 'mimetype': mime})}'::jsonb)")

# ───────── name comparison ─────────
nm = lambda a, b: sh(f"select _name_match($j${a}$j$, $j${b}$j$)")[1]
check("same name with different suffix = match", nm("Kaveri Industries Pvt Ltd", "KAVERI INDUSTRIES PRIVATE LIMITED") == "match")
check("punctuation and M/s ignored", nm("M/s. Kaveri & Sons", "KAVERI AND SONS LTD") == "match")
check("partly different = partial", nm("Kaveri Industrial Supplies", "Kaveri Industries Pvt Ltd") == "partial")
check("different company = mismatch", nm("Kaveri Industries", "Sharma Textiles Pvt Ltd") == "mismatch")
check("empty = unknown", nm("", "Kaveri") == "unknown" and nm("Kaveri", "Pvt Ltd") == "unknown")
check("name helpers are not callable from the browser", not U("S", "select _name_match('a','b')")[0])

# ───────── asking for a lookup ─────────
g1 = submitted_gst("S", org1, GST_KA)
denied("anonymous cannot ask", sh(f"select request_gst_lookup('{g1}')", "anon"))
denied("another supplier cannot ask", U("X", f"select request_gst_lookup('{g1}')"), "not_allowed")
denied("a buyer cannot ask", U("B", f"select request_gst_lookup('{g1}')"), "not_allowed")
denied("an employee (not owner/finance) cannot ask", U("M", f"select request_gst_lookup('{g1}')"), "not_allowed")
denied("unknown check", U("S", f"select request_gst_lookup('{uuid.uuid4()}')"), "not_found")
r = U("S", f"select request_gst_lookup('{g1}')"); check("owner gets the GST number back", r[0] and r[1] == GST_KA, r[2])
cb = start("F", org1, "bank", "1234", "HDFC0001234")[1]
denied("only GST proofs have a live check", U("F", f"select request_gst_lookup('{cb}')"), "not_applicable")
draft = start("S", org1, "address", "", "No. 14, 3rd Cross, Peenya Industrial Area, Bengaluru")[1]
denied("nobody can write a result from the browser", U("S", f"select record_gst_lookup('{g1}', '{{\"outcome\":\"ok\"}}'::jsonb)"), "permission denied")
denied("anonymous cannot write a result", sh(f"select record_gst_lookup('{g1}', '{{\"outcome\":\"ok\"}}'::jsonb)", "anon"))
denied("the lookup columns cannot be edited directly", U("S", f"update verification_checks set lookup='{{}}' where id='{g1}'"), "permission denied")

# ───────── a failed lookup never blocks, retries are limited ─────────
ok("provider down is recorded as unavailable", rec(g1, {"outcome": "unavailable", "reason": "provider_http_500"}))
check("unavailable is not final", look(g1)["outcome"] == "unavailable" and sh(f"select lookup_at is null from verification_checks where id='{g1}'")[1] == "t")
age = lambda cid: sh(f"update verification_checks set lookup_last_try = now() - interval '1 minute' where id='{cid}'")
denied("double-click protection: a retry within 30 seconds is refused", U("S", f"select request_gst_lookup('{g1}')"), "too_soon")
age(g1); ok("2nd try allowed", U("S", f"select request_gst_lookup('{g1}')")); age(g1); ok("3rd try allowed", U("S", f"select request_gst_lookup('{g1}')"))
age(g1)
denied("supplier limited to 3 tries per proof", U("S", f"select request_gst_lookup('{g1}')"), "too_many_tries")
ok("a reviewer may still retry", U("A", f"select request_gst_lookup('{g1}')"))
age(g1); U("A", f"select request_gst_lookup('{g1}')"); age(g1); U("A", f"select request_gst_lookup('{g1}')"); age(g1)
denied("a reviewer is capped too (6 tries per proof)", U("A", f"select request_gst_lookup('{g1}')"), "too_many_tries")

# ───────── a good answer ─────────
bad_kind = rec(g1, {"outcome": "weird"}); denied("unknown outcome rejected", bad_kind, "invalid_outcome")
ok("good answer recorded", rec(g1, {"outcome": "ok", "legal_name": "KAVERI INDUSTRIAL SUPPLIES PRIVATE LIMITED", "trade_name": "", "gst_status": "Active",
                                    "registered_on": "2017-07-01", "constitution": "Private Limited Company"}))
l = look(g1)
check("name match computed by the database (contained name is only partial)", l["name_match"] == "partial" and l["gst_status"] == "Active" and l["registered_on"] == "2017-07-01")
check("answer is final", sh(f"select lookup_at is not null from verification_checks where id='{g1}'")[1] == "t")
denied("cannot ask again once checked", U("A", f"select request_gst_lookup('{g1}')"), "already_checked")
ok("a late/duplicate answer is ignored quietly", rec(g1, {"outcome": "ok", "legal_name": "EVIL CO", "gst_status": "Cancelled"}))
check("the final answer was not overwritten", look(g1)["legal_name"].startswith("KAVERI"))
check("lookup audited", int(sh(f"select count(*) from audit_log where entity_id='{g1}' and action='gst_lookup'")[1]) >= 2)
# junk dates are dropped (checked on a second company)
g2 = submitted_gst("X", org2, GST_MH)
ok("answer with junk dates still recorded", rec(g2, {"outcome": "ok", "legal_name": "Other Supplies Pvt Ltd", "gst_status": "Active", "registered_on": "2020-02-31", "cancelled_on": "31/02/2020"}))
check("impossible/foreign-format dates are dropped, not stored", look(g2)["registered_on"] is None and look(g2)["cancelled_on"] is None and look(g2)["name_match"] == "match")

# ───────── the reviewer sees it; an inactive registration cannot be verified ─────────
q = {x["id"]: x for x in json.loads(U("A", "select admin_queue()::text")[1])}
check("queue carries the live result", q[g1]["lookup"]["name_match"] == "partial" and "duplicate_gstin" in q[g1] and "auto_flags" in q[g1])
check("buyers still cannot read the queue", not U("B", "select admin_queue()")[0])
U("A", f"select admin_claim_check('{g1}')")
sh(f"update verification_checks set lookup = jsonb_set(lookup,'{{gst_status}}','\"Cancelled\"') where id='{g1}'")
denied("a Cancelled registration cannot be verified", U("A", f"select admin_decide('{g1}','verify')"), "gst_not_active")
check("it stays in review after the refusal", sh(f"select status from verification_checks where id='{g1}'")[1] == "in_review")
ok("but it can be rejected with a reason", U("A", f"select admin_decide('{g1}','reject','The government record shows this registration as cancelled')"))
denied("a decided proof cannot be looked up any more", U("A", f"select request_gst_lookup('{g1}')"), "not_pending")
check("rejection reached the supplier", int(sh(f"select count(*) from notifications where user_id='{ids['S']}' and kind='proof_rejected'")[1]) == 1)

# an Active one, a not-found one and a never-looked-up one can all be verified (human stays in charge)
g3 = submitted_gst("S", org1, GST_KA); rec(g3, {"outcome": "ok", "legal_name": "KAVERI INDUSTRIAL SUPPLIES", "gst_status": "Active"})
U("A", f"select admin_claim_check('{g3}')"); ok("Active registration verifies normally", U("A", f"select admin_decide('{g3}','verify')"))
check("summary badge updated", sh(f"select status from supplier_verifications where org_id='{org1}'")[1] == "verified")
# not_found: shown to the reviewer, final, but does not auto-block (the human decides). Uses the second company's proof.
sh(f"update verification_checks set lookup=null, lookup_at=null where id='{g2}'")
rec(g2, {"outcome": "not_found"})
check("not_found is final and shown", look(g2)["outcome"] == "not_found" and look(g2)["name_match"] == "unknown")
U("A", f"select admin_claim_check('{g2}')")
denied("not_found needs a written reason to verify", U("A", f"select admin_decide('{g2}','verify')"), "gst_not_found")
ok("not_found can be overridden with a reason (audited)", U("A", f"select admin_decide('{g2}','verify','Checked the GST portal certificate: new number, not in provider cache yet')"))

# ───────── daily cost cap ─────────
org3 = str(uuid.uuid4()); sh(f"insert into businesses(id,slug,name,kind,state) values ('{org3}','cap-co','Cap Co','supplier','Karnataka')"); sh(f"insert into supplier_verifications(org_id) values ('{org3}')")
sh(f"insert into memberships(org_id,user_id,role) values ('{org3}','{ids['Z']}','owner')")
sh(f"insert into verification_checks(org_id,type,reference,status,lookup_last_try,lookup_tries) select '{org3}','certificate','c'||g,'superseded',now(), 2 from generate_series(1,10) g")
sh(f"update verification_checks set label = 'l'||id where org_id='{org3}'")
cz = start("Z", org3, "registration", "", mk("29AAACR5055K1Z"))[1]
put("Z", f"{org3}/{cz}/a.pdf"); U("Z", f"select attach_document('{cz}','{org3}/{cz}/a.pdf','a.pdf')"); U("Z", f"select submit_check('{cz}')")
denied("daily cost cap per company", U("Z", f"select request_gst_lookup('{cz}')"), "daily_limit")

# ═════════════ migration 6 (hardening) ═════════════
check("short name is never a full match", nm("Sri Ltd", "Sri Lakshmi Steel Industries") == "partial")
check("generic words (Enterprises, Traders...) do not create a match", nm("Sharma Enterprises", "Verma Enterprises") == "mismatch" and nm("Sharma Traders", "Verma Trading Co") == "mismatch")
check("same name with generic suffix still matches", nm("Kaveri Industries", "Kaveri Industries Pvt Ltd") == "match")

# one explicit rule per GST outcome (org1's business is "Kaveri Industrial")
GST_4, GST_5, GST_6 = mk("29AABCU9603R1Z"), mk("29AAACB2894G1Z"), mk("29AAECK1234A1Z")
def pending_with(k, org, gst, res):
    cid = submitted_gst(k, org, gst); rec(cid, res); U("A", f"select admin_claim_check('{cid}')"); return cid
g4 = pending_with("S", org1, GST_4, {"outcome": "ok", "legal_name": "Totally Different Traders", "gst_status": "Active"})
check("different company name is recorded as mismatch", look(g4)["name_match"] == "mismatch")
denied("Active + MISMATCH needs a written reason", U("A", f"select admin_decide('{g4}','verify')"), "name_mismatch")
denied("a one-word note is not a reason", U("A", f"select admin_decide('{g4}','verify','ok')"), "name_mismatch")
ok("Active + mismatch verifies with a reason", U("A", f"select admin_decide('{g4}','verify','Trade name differs; GST certificate shows same PAN as company registration')"))
g5 = pending_with("S", org1, GST_5, {"outcome": "ok", "legal_name": "Kaveri Industrial Pvt Ltd"})   # provider gave no status
check("a missing status is treated as Unknown by the guard (null in the record)", look(g5)["gst_status"] is None)
denied("status Unknown needs a written reason", U("A", f"select admin_decide('{g5}','verify')"), "gst_status_unknown")
ok("status Unknown verifies with a reason", U("A", f"select admin_decide('{g5}','verify','Checked the GST portal manually: Active as of today')"))
g6 = pending_with("S", org1, GST_6, {"outcome": "ok", "legal_name": "Kaveri Industrial Pvt Ltd", "gst_status": "Active"})
ok("Active + matching name verifies with no note", U("A", f"select admin_decide('{g6}','verify')"))
g7 = pending_with("X", org2, GST_MH, {"outcome": "unavailable", "reason": "provider_http_503"})
ok("provider down: verifying by hand is still allowed", U("A", f"select admin_decide('{g7}','verify')"))

# the passport says HOW each proof was checked
pp = json.loads(U("B", f"select get_trust_passport('{org1}')::text")[1])
reg = [c for c in pp["checks"] if c["type"] == "registration"]
today = sh("select current_date::text")[1]
check("government record + matching name -> evidence government_record, with the check date", len(reg) == 1 and reg[0]["evidence"] == "government_record" and reg[0]["record_checked_on"] == today, str(reg))
pp2 = json.loads(U("B", f"select get_trust_passport('{org2}')::text")[1])
r2 = [c for c in pp2["checks"] if c["type"] == "registration"]
check("no live record -> evidence document_reviewed, no record date", len(r2) == 1 and r2[0]["evidence"] == "document_reviewed" and r2[0]["record_checked_on"] is None, str(r2))
check("level names: no 'Certified' any more", json.loads(U("B", f"select get_trust_passport('{org1}')::text")[1])["level_name"] == "Registered")
check("passport still hides bank and address details", "HDFC" not in json.dumps(pp) and "Peenya" not in json.dumps(pp))

# sensitive evidence: owner / finance manager / reviewer only
doc_check = sh(f"select id from verification_checks where org_id='{org1}' and doc_path is not null limit 1")[1]
denied("an ordinary employee cannot open a document", U("M", f"select record_document_view('{doc_check}')"), "not_allowed")
ok("the owner can", U("S", f"select record_document_view('{doc_check}')")); ok("the finance manager can", U("F", f"select record_document_view('{doc_check}')")); ok("a reviewer can", U("A", f"select record_document_view('{doc_check}')"))
check("an employee cannot list the proofs (address, IFSC)", U("M", "select count(*) from verification_checks")[1] == "0")
check("an employee cannot list stored documents", U("M", "select count(*) from storage.objects")[1] == "0" and int(U("S", "select count(*) from storage.objects")[1]) > 0)
check("a buyer cannot list stored documents", U("B", "select count(*) from storage.objects")[1] == "0")

# reviewer operations
denied("a supplier cannot read the ops stats", U("S", "select admin_ops_stats()"), "not_allowed")
denied("anonymous cannot read the ops stats", sh("select admin_ops_stats()", "anon"))
st = json.loads(U("A", "select admin_ops_stats()::text")[1])
check("no heartbeat yet = expiry job reported unhealthy", st["expiry_job_healthy"] is False and st["expiry_job_last_run"] is None)
SVC("select refresh_trust_passports()")
st = json.loads(U("A", "select admin_ops_stats()::text")[1])
check("after the job runs the heartbeat is recorded and healthy", st["expiry_job_healthy"] is True and st["expiry_job_last_run"] is not None)
check("heartbeat table is invisible to the API", not U("A", "select count(*) from ops_heartbeats")[0])
g8 = submitted_gst("X", org2, mk("27AAACI1681G1Z")); U("A", f"select admin_claim_check('{g8}')")
sh(f"update verification_checks set claimed_at = now() - interval '30 hours', submitted_at = now() - interval '40 hours' where id='{g8}'")
st = json.loads(U("A", "select admin_ops_stats()::text")[1])
check("stale claim and 24h+ waiting are counted", st["stale_claims"] >= 1 and st["waiting_over_24h"] >= 1 and st["oldest_waiting_hours"] >= 39 and st["open"] >= 1)
check("reviewer workload is listed", any(r["open_claims"] >= 1 for r in st["reviewers"]))
check("missing live result is counted", st["no_live_result"] >= 0 and "lookup_failures_24h" in st and "expiring_30d" in st)
denied("a supplier cannot release claims", U("S", "select admin_release_stale(24)"), "not_allowed")
denied("hours must be sensible", U("A", "select admin_release_stale(0)"), "invalid_hours")
check("stale claims go back to the queue", U("A", "select admin_release_stale(24)")[1] == "1" and sh(f"select status || coalesce(claimed_by::text,'') from verification_checks where id='{g8}'")[1] == "submitted")
check("release is audited", int(sh(f"select count(*) from audit_log where entity_id='{g8}' and action='proof_claim_released'")[1]) == 1)

# platform-wide kill switch
sh(f"insert into verification_checks(org_id,type,reference,status,lookup_last_try,lookup_tries) values ('{org3}','certificate','killswitch','superseded',now(),600)")
denied("platform-wide daily cap pauses live checks", U("A", f"select request_gst_lookup('{g8}')"), "platform_limit")
sh("delete from verification_checks where reference='killswitch'")
ok("and they resume once the count drops", U("A", f"select request_gst_lookup('{g8}')"))

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
