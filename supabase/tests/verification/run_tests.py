#!/usr/bin/env python3
"""
Security + behaviour tests for supabase/migrations/20261115000004_trust_passport.sql
Builds a THROWAWAY database `vendora_verification_test`, applies migrations 1-4 (with a stand-in for Supabase storage),
then attacks them as suppliers, buyers, a reviewer and strangers. Never point it at a real project.

    PGHOST=localhost PGUSER=postgres python3 supabase/tests/verification/run_tests.py
"""
import json, os, subprocess, sys, uuid
HERE = os.path.dirname(os.path.abspath(__file__))
MIG = os.path.join(HERE, "..", "..", "migrations")
BOOT = os.path.join(HERE, "..", "invite_only", "bootstrap_local_supabase.sql")
DB = "vendora_verification_test"
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
apply(M4); apply(M4)   # must be safe to run twice
M5 = os.path.join(MIG, "20261116000005_gst_lookup.sql")
if os.path.exists(M5): apply(M5)   # the whole suite must still pass with the GST lookup installed
M6 = os.path.join(MIG, "20261117000006_trust_hardening.sql")
if os.path.exists(M6): apply(M6); apply(M6)   # hardening: safe to run twice

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

# ───────── GST pre-check ─────────
rep = lambda g, s="": json.loads(sh(f"select check_gstin('{g}','{s}')::text")[1])
for g in [GST_MH, "07AAGFF2194N1Z1", "24AAACC1206D1ZM", "27AAACR5055K1Z7", GST_KA]:
    check(f"valid GSTIN accepted: {g}", rep(g)["format_ok"] and rep(g)["checksum_ok"])
check("typo caught by checksum", rep(BAD_SUM)["format_ok"] and not rep(BAD_SUM)["checksum_ok"])
check("wrong length rejected", not rep("27AAPFU0939F1Z")["format_ok"])
check("lowercase and spaces tolerated", rep(" " + GST_MH.lower() + " ")["checksum_ok"])
check("state recognised", rep(GST_MH)["state_name"] == "Maharashtra")
check("state match flagged", rep(GST_MH, "Maharashtra")["state_matches"] is True and rep(GST_MH, "Karnataka")["state_matches"] is False)
check("anonymous cannot call the checker's internal helper", not sh("select _gstin_report('x')", "anon")[0])

# ───────── starting proofs ─────────
start = lambda k, org, typ, label="", ref="", iss="", iss_on="null", exp="null": U(k, f"select start_check('{org}','{typ}','{label}','{ref}','{iss}',{iss_on},{exp})")
denied("a buyer account cannot start a proof for a supplier", start("B", org1, "registration", "", GST_KA), "not_allowed")
denied("another supplier cannot start proofs for my company", start("X", org1, "registration", "", GST_KA), "not_allowed")
denied("an employee (not owner/finance) cannot start proofs", start("M", org1, "registration", "", GST_KA), "not_allowed")
denied("a buyer company is not a valid target", start("B", orgB, "registration", "", GST_KA), "not_allowed")
denied("stranger cannot", start("Z", org1, "registration", "", GST_KA), "not_allowed")
denied("bad checksum never reaches a reviewer", start("S", org1, "registration", "", BAD_SUM), "checksum")
denied("bad format rejected", start("S", org1, "registration", "", "HELLO"), "invalid_gstin")
denied("unknown type rejected", start("S", org1, "passport", "", GST_KA), "invalid_type")
denied("bank needs valid IFSC", start("S", org1, "bank", "1234", "BADIFSC"), "invalid_ifsc")
denied("bank takes only last 4 digits", start("S", org1, "bank", "123456789012", "HDFC0001234"), "invalid_account")
denied("address too short", start("S", org1, "address", "", "Bengaluru"), "invalid_address")
denied("certificate needs expiry", start("S", org1, "certificate", "ISO 9001", "C-1234", "TUV"), "invalid_expiry")
denied("expired certificate rejected", start("S", org1, "certificate", "ISO 9001", "C-1234", "TUV", exp="'2020-01-01'"), "expired")
denied("certificate expiry absurdly far", start("S", org1, "certificate", "ISO 9001", "C-1234", "TUV", exp="'2099-01-01'"), "too far")
r = start("S", org1, "registration", "", GST_KA); ok("owner starts a GST proof", r); c_reg = r[1]
r = start("F", org1, "bank", "1234", "hdfc0001234"); ok("finance manager starts a bank proof", r); c_bank = r[1]
check("bank label stores last 4 only", sh(f"select label||'|'||reference from verification_checks where id='{c_bank}'")[1] == "Account ending 1234|HDFC0001234")
check("GST flags saved (state matches)", sh(f"select auto_flags->>'state_matches' from verification_checks where id='{c_reg}'")[1] == "true")
check("starting again replaces the draft", start("S", org1, "registration", "", GST_KA)[0] and sh(f"select count(*) from verification_checks where org_id='{org1}' and type='registration'")[1] == "1")
c_reg = sh(f"select id from verification_checks where org_id='{org1}' and type='registration'")[1]

# ───────── submit needs a real, correctly-placed document ─────────
denied("cannot submit without a document", U("S", f"select submit_check('{c_reg}')"), "document_required")
denied("path outside this check's folder rejected", U("S", f"select attach_document('{c_reg}','{org2}/{c_reg}/a.pdf','a.pdf')"), "invalid_path")
denied("path traversal rejected", U("S", f"select attach_document('{c_reg}','{org1}/{c_reg}/../x.pdf','a.pdf')"), "invalid_path")
denied("file must exist in the bucket", U("S", f"select attach_document('{c_reg}','{org1}/{c_reg}/a.pdf','a.pdf')"), "file_missing")
def put(k, path, size=1000, mime="application/pdf"):
    return U(k, f"insert into storage.objects(bucket_id,name,metadata) values ('verification-docs','{path}','{json.dumps({'size': size, 'mimetype': mime})}'::jsonb)")
ok("owner uploads into own draft folder", put("S", f"{org1}/{c_reg}/a.pdf"))
denied("cannot upload into another company's folder", put("X", f"{org1}/{c_reg}/b.pdf"), "row-level security")
denied("employee cannot upload", put("M", f"{org1}/{c_reg}/c.pdf"), "row-level security")
denied("buyer cannot upload", put("B", f"{org1}/{c_reg}/c.pdf"), "row-level security")
denied("cannot upload to a check that does not exist", put("S", f"{org1}/{uuid.uuid4()}/c.pdf"), "row-level security")
denied("cannot upload with a wrong-depth path", put("S", f"{org1}/{c_reg}/x/y.pdf"), "row-level security")
ok("second file ok", put("S", f"{org1}/{c_reg}/b.pdf")); ok("third file ok", put("S", f"{org1}/{c_reg}/c.pdf"))
denied("at most 3 files per proof", put("S", f"{org1}/{c_reg}/d.pdf"), "row-level security")
denied("storage cannot be deleted from the browser", U("S", f"delete from storage.objects where bucket_id='verification-docs'"), "row-level security") if False else None
check("browser delete removes nothing", U("S", "with d as (delete from storage.objects where bucket_id='verification-docs' returning 1) select count(*) from d")[1] == "0")
check("browser update changes nothing", U("S", "with u as (update storage.objects set name='x' where bucket_id='verification-docs' returning 1) select count(*) from u")[1] == "0")
check("stranger cannot read documents", U("Z", "select count(*) from storage.objects")[1] == "0" and U("X", "select count(*) from storage.objects")[1] == "0")
check("owner and admin can read documents", U("S", "select count(*) from storage.objects")[1] == "3" and U("A", "select count(*) from storage.objects")[1] == "3")
sh(f"insert into storage.objects(bucket_id,name,metadata) values ('verification-docs','{org1}/{c_reg}/big.pdf','{{\"size\": 20000000, \"mimetype\": \"application/pdf\"}}')")
sh(f"insert into storage.objects(bucket_id,name,metadata) values ('verification-docs','{org1}/{c_reg}/evil.exe','{{\"size\": 100, \"mimetype\": \"application/x-msdownload\"}}')")
denied("oversize file rejected", U("S", f"select attach_document('{c_reg}','{org1}/{c_reg}/big.pdf','big.pdf')"), "file_too_large")
denied("wrong file type rejected", U("S", f"select attach_document('{c_reg}','{org1}/{c_reg}/evil.exe','evil.exe')"), "file_type")
ok("attach a good file", U("S", f"select attach_document('{c_reg}','{org1}/{c_reg}/a.pdf','GST certificate.pdf')"))
denied("another supplier cannot submit it", U("X", f"select submit_check('{c_reg}')"), "not_allowed")
ok("owner submits", U("S", f"select submit_check('{c_reg}')"))
denied("cannot submit twice", U("S", f"select submit_check('{c_reg}')"), "not_a_draft")
check("summary shows submitted", sh(f"select status from supplier_verifications where org_id='{org1}'")[1] == "submitted")
check("submission audited", sh(f"select count(*) from audit_log where entity_id='{c_reg}' and action='proof_submitted'")[1] == "1")
# no direct writes at all
denied("no direct insert", U("S", f"insert into verification_checks(org_id,type) values ('{org1}','bank')"), "permission denied")
denied("no direct status change", U("S", f"update verification_checks set status='verified' where id='{c_reg}'"), "permission denied")
denied("no direct delete", U("S", f"delete from verification_checks where id='{c_reg}'"), "permission denied")
denied("cannot self-promote to admin", U("S", f"insert into platform_admins(user_id) values ('{ids['S']}')"), "permission denied")
check("platform_admins invisible", not U("S", "select count(*) from platform_admins")[0])
# who sees what
check("owner sees own proofs; an ordinary employee sees none (address/bank evidence is owner/finance only)", U("S", "select count(*) from verification_checks")[1] == "2" and U("F", "select count(*) from verification_checks")[1] == "2" and U("M", "select count(*) from verification_checks")[1] == "0")
check("other suppliers/buyers/strangers see none", all(U(k, "select count(*) from verification_checks")[1] == "0" for k in "XBZ"))
check("reviewer sees all", U("A", "select count(*) from verification_checks")[1] == "2")

# ───────── review ─────────
denied("non-admin cannot read the queue", U("S", "select admin_queue()"), "not_allowed")
denied("buyer cannot read the queue", U("B", "select admin_queue()"), "not_allowed")
denied("non-admin cannot claim", U("S", f"select admin_claim_check('{c_reg}')"), "not_allowed")
q = json.loads(U("A", "select admin_queue()::text")[1])
check("queue shows the submitted proof with flags", len(q) == 1 and q[0]["org_name"] == "Kaveri Industrial" and q[0]["auto_flags"]["checksum_ok"] is True)
denied("cannot decide before claiming", U("A", f"select admin_decide('{c_reg}','verify')"), "not_yours")
ok("reviewer claims", U("A", f"select admin_claim_check('{c_reg}')"))
check("summary shows in_review", sh(f"select status from supplier_verifications where org_id='{org1}'")[1] == "in_review")
sh(f"insert into memberships(org_id,user_id,role) values ('{org2}','{ids['A']}','employee')")
for k in "SX": pass
add_user_b = str(uuid.uuid4()); sh(f"insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values ('{add_user_b}','a2@t.in',now(),'{{\"account_type\":\"supplier\"}}')")
sh(f"insert into platform_admins(user_id) values ('{add_user_b}')"); ids["A2"] = add_user_b
denied("a second reviewer cannot grab it", U("A2", f"select admin_claim_check('{c_reg}')"), "not_claimable")
denied("a second reviewer cannot decide it", U("A2", f"select admin_decide('{c_reg}','verify')"), "not_yours")
denied("reject needs a reason", U("A", f"select admin_decide('{c_reg}','reject','no')"), "note_required")
denied("bad decision word", U("A", f"select admin_decide('{c_reg}','maybe')"), "invalid_decision")
ok("document view is allowed and logged", U("A", f"select record_document_view('{c_reg}')"))
denied("stranger cannot log/open a document", U("Z", f"select record_document_view('{c_reg}')"), "not_allowed")
check("view audited", sh(f"select count(*) from audit_log where entity_id='{c_reg}' and action='document_viewed'")[1] == "1")
ok("reviewer verifies", U("A", f"select admin_decide('{c_reg}','verify','Matches the portal')"))
check("verified with a 1-year expiry by default", sh(f"select (expires_at = current_date + 365)::text from verification_checks where id='{c_reg}'")[1] == "true")
check("summary shows verified", sh(f"select status||'|'||registration_no from supplier_verifications where org_id='{org1}'")[1] == f"verified|{GST_KA}")
check("owner was notified", sh(f"select count(*) from notifications where user_id='{ids['S']}' and kind='proof_verified'")[1] == "1")
denied("decided proofs cannot be decided again", U("A", f"select admin_decide('{c_reg}','reject','changed my mind please')"), "not_yours")
# the same GST number cannot be taken by another company
r = U("X", f"select start_check('{org2}','registration','','{GST_KA}','',null,null)")
denied("verified GST number cannot be reused by another company", r, "gstin_in_use")

# ───────── passport for buyers ─────────
pp = lambda k, o: json.loads(U(k, f"select get_trust_passport('{o}')::text")[1])
p = pp("B", org1)
check("level 1 = Registered", p["level"] == 1 and p["level_name"] == "Registered")
check("buyer sees the GST number but not bank details", p["checks"][0]["reference"] == GST_KA and len(p["checks"]) == 1)
denied("anonymous cannot read passports", sh(f"select get_trust_passport('{org1}')", "anon"))
denied("buyer company is not a passport", U("B", f"select get_trust_passport('{orgB}')"), "not_found")
# bank + address
def full(k, typ, label, ref, iss="", exp="null"):
    cid = start(k, org1, typ, label, ref, iss, exp=exp)[1]
    put(k, f"{org1}/{cid}/d.pdf"); U(k, f"select attach_document('{cid}','{org1}/{cid}/d.pdf','d.pdf')"); U(k, f"select submit_check('{cid}')")
    U("A", f"select admin_claim_check('{cid}')"); return cid
cb = c_bank; put("F", f"{org1}/{cb}/d.pdf"); U("F", f"select attach_document('{cb}','{org1}/{cb}/d.pdf','cheque.pdf')"); U("F", f"select submit_check('{cb}')")
U("A", f"select admin_claim_check('{cb}')"); ok("verify bank", U("A", f"select admin_decide('{cb}','verify')"))
ca = full("S", "address", "", "No. 14, 3rd Cross, Peenya Industrial Area, Bengaluru 560058"); ok("verify address", U("A", f"select admin_decide('{ca}','verify')"))
p = pp("B", org1)
check("level 2 = Verified", p["level"] == 2)
check("bank and address details hidden from buyers", all(c["reference"] == "" for c in p["checks"] if c["type"] in ("bank", "address")) and "Peenya" not in json.dumps(p) and "HDFC" not in json.dumps(p))
cc = full("S", "certificate", "ISO 9001", "C-778", "TUV SUD", exp="current_date + 400")
ok("reject then fix works", U("A", f"select admin_decide('{cc}','reject','The certificate number is not readable in the scan')"))
check("rejection reason reaches the supplier", sh(f"select count(*) from notifications where user_id='{ids['S']}' and kind='proof_rejected' and body like '%not readable%'")[1] == "1")
check("rejected certificate does not count", pp("B", org1)["level"] == 2)
cc = full("S", "certificate", "ISO 9001", "C-778", "TUV SUD", exp="current_date + 400")
ok("verify certificate", U("A", f"select admin_decide('{cc}','verify')"))
p = pp("B", org1)
check("level 3 = Verified + Certificates", p["level"] == 3 and p["level_name"] == "Verified + Certificates" and any(c["label"] == "ISO 9001" and c["reference"] == "C-778" for c in p["checks"]))
check("certificate keeps the printed expiry (cannot be extended)", sh(f"select (expires_at = current_date + 400)::text from verification_checks where id='{cc}'")[1] == "true")

# ───────── automatic lapse ─────────
sh(f"update verification_checks set expires_at = current_date - 1 where id='{cb}'")   # time passes
check("expired proof stops counting even BEFORE the daily job runs", pp("B", org1)["level"] == 1 and len(pp("B", org1)["checks"]) == 3)
denied("only the system can run the daily refresh", U("S", "select refresh_trust_passports()"), "permission denied")
check("daily refresh expires it and notifies", sh("select refresh_trust_passports()")[1] == "1" and sh(f"select status from verification_checks where id='{cb}'")[1] == "expired")
check("expiry notice sent", sh(f"select count(*) from notifications where user_id='{ids['S']}' and kind='proof_expired'")[1] == "1")
sh(f"update verification_checks set expires_at = current_date + 10 where id='{cc}'")
sh("select refresh_trust_passports()"); sh("select refresh_trust_passports()")
check("expiry warning sent once only", sh(f"select count(*) from notifications where user_id='{ids['S']}' and kind='proof_expiring'")[1] == "1")
sh(f"update verification_checks set expires_at = current_date - 1 where id='{c_reg}'"); sh("select refresh_trust_passports()")
check("registration lapse drops the whole passport to 0 and the badge", pp("B", org1)["level"] == 0 and sh(f"select status from supplier_verifications where org_id='{org1}'")[1] == "not_submitted")
# renewing replaces the old proof
cn = start("S", org1, "registration", "", GST_KA)[1]; put("S", f"{org1}/{cn}/n.pdf"); U("S", f"select attach_document('{cn}','{org1}/{cn}/n.pdf','n.pdf')"); U("S", f"select submit_check('{cn}')")
U("A", f"select admin_claim_check('{cn}')"); ok("renewal verified", U("A", f"select admin_decide('{cn}','verify')"))
check("renewal restores the level and supersedes the old proof", pp("B", org1)["level"] >= 1 and sh(f"select status from verification_checks where id='{c_reg}'")[1] == "superseded")
# withdraw
cw = start("S", org1, "bank", "5678", "SBIN0001234")[1]
ok("withdraw a draft", U("S", f"select withdraw_check('{cw}')"))
cw = full("S", "bank", "5678", "SBIN0001234")
denied("cannot withdraw while a reviewer has it", U("S", f"select withdraw_check('{cw}')"), "cannot_withdraw")
denied("a reviewer cannot review their own company", (lambda: (sh(f"insert into memberships(org_id,user_id,role) values ('{org1}','{ids['A']}','employee')"), U("A", f"select admin_decide('{cw}','verify')"))[1])(), "conflict_of_interest")
check("at most one open GST/bank proof (unique index)", not sh(f"insert into verification_checks(org_id,type,status) values ('{org1}','bank','draft')")[0])

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
