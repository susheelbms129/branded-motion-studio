#!/usr/bin/env python3
"""
Tests for supabase/migrations/20261118000007_supplier_directory.sql (buyer supplier directory)
Builds a THROWAWAY database `vendora_directory_test`, applies migrations 1-4 (with a stand-in for Supabase storage),
then attacks them as suppliers, buyers, a reviewer and strangers. Never point it at a real project.

    PGHOST=localhost PGUSER=postgres python3 supabase/tests/verification/run_tests.py
"""
import json, os, subprocess, sys, uuid
HERE = os.path.dirname(os.path.abspath(__file__))
MIG = os.path.join(HERE, "..", "..", "migrations")
BOOT = os.path.join(HERE, "..", "invite_only", "bootstrap_local_supabase.sql")
DB = "vendora_directory_test"
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
apply(M6)
M7 = os.path.join(MIG, "20261118000007_supplier_directory.sql")
apply(M7); apply(M7)   # safe to run twice
M8 = os.path.join(MIG, "20261119000008_supplier_profile_view.sql")
apply(M8); apply(M8)   # safe to run twice
M9 = os.path.join(MIG, "20261120000009_saved_suppliers.sql")
apply(M9); apply(M9)   # safe to run twice

ids = {k: str(uuid.uuid4()) for k in "SFXBMAZEYW"}  # S owner, F finance, X other supplier owner, B buyer, M member-employee, A admin, Z stranger
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


# ───────── the supplier directory ─────────
org3 = str(uuid.uuid4())
sh(f"insert into businesses(id,slug,name,kind,state,city) values ('{org3}','no-profile-co','No Profile Co','supplier','Karnataka','Mysuru')")
sh(f"update businesses set city='Bengaluru' where id='{org1}'"); sh(f"update businesses set city='Pune' where id='{org2}'")
sh(f"insert into supplier_profiles(org_id,description,categories,email,phone,contact_name) values ('{org1}','Industrial fasteners and fittings from Peenya.', array['Fasteners','Hardware'],'private@kaveri.in','9880011223','Ravi Kumar')")
sh(f"insert into supplier_profiles(org_id,description,categories) values ('{org2}', repeat('x', 500), array['Packaging'])")
LS = lambda k, *a: U(k, "select list_suppliers(" + ",".join(a) + ")::text")
res = lambda k, *a: json.loads(LS(k, *a)[1])
names = lambda r: [i["name"] for i in r["items"]]

denied("anonymous cannot list", sh("select list_suppliers()", "anon"))
denied("a supplier cannot browse competitors", LS("S"), "not_allowed")
denied("a supplier employee cannot either", LS("M"), "not_allowed")
ok("a buyer can list", LS("B")); ok("a reviewer can list", LS("A"))
r = res("B")
check("only suppliers that finished onboarding appear", sorted(names(r)) == ["Kaveri Industrial", "Other Supplies"] and r["total"] == 2, str(names(r)))
check("a buyer company is never listed", "Buyer Co" not in names(r))
check("unverified suppliers show level 0 / Not verified", all(i["level"] == 0 and i["level_name"] == "Not verified" and i["government_checked"] is False for i in r["items"]))
check("description is cut to 200 characters", max(len(i["description"]) for i in r["items"]) <= 200)
check("filters offered: states and categories", r["states"] == ["Karnataka", "Maharashtra"] and r["categories"] == ["Fasteners", "Hardware", "Packaging"], str(r["states"]) + str(r["categories"]))

# verify org1 for real (government record + address + bank, private details included)
sh(f"insert into verification_checks(org_id,type,reference,status,reviewed_at,expires_at,lookup) values ('{org1}','registration','{GST_KA}','verified',now(),current_date+300, jsonb_build_object('outcome','ok','gst_status','Active','name_match','match','fetched_at',now()))")
sh(f"insert into verification_checks(org_id,type,reference,status,reviewed_at,expires_at) values ('{org1}','address','No. 14, 3rd Cross, Peenya Industrial Area, Bengaluru','verified',now(),current_date+300)")
sh(f"insert into verification_checks(org_id,type,label,reference,status,reviewed_at,expires_at,doc_path) values ('{org1}','bank','Account ending 1234','HDFC0001234','verified',now(),current_date+100,'{org1}/x/secret.pdf')")
r = res("B")
k = r["items"][0]
check("verified supplier sorts first, with level, proofs and government-record flag", k["name"] == "Kaveri Industrial" and k["level"] == 2 and k["level_name"] == "Verified" and k["proofs"] == 3 and k["government_checked"] is True, str(k))
raw = LS("B")[1]
for secret in ["Peenya Industrial", "HDFC0001234", "secret.pdf", "Account ending", "private@kaveri.in", "9880011223", "Ravi Kumar", "1234"]:
    check(f"private detail never returned: {secret}", secret not in raw.replace("Industrial fasteners and fittings from Peenya.", ""))
check("verified-only filter", names(res("B", "''", "''", "''", "true")) == ["Kaveri Industrial"])
sh(f"update verification_checks set expires_at = current_date - 1 where org_id='{org1}'")
check("an expired proof stops counting at once (no cron needed)", names(res("B", "''", "''", "''", "true")) == [] and all(i["level"] == 0 for i in res("B")["items"]))
sh(f"update verification_checks set expires_at = current_date + 300 where org_id='{org1}' and type <> 'bank'"); sh(f"update verification_checks set expires_at = current_date + 100 where org_id='{org1}' and type = 'bank'")

# search and filters
check("search by name (case-insensitive)", names(res("B", "'kaveri'")) == ["Kaveri Industrial"])
check("search by city", names(res("B", "'pune'")) == ["Other Supplies"])
check("search by category word", names(res("B", "'fasten'")) == ["Kaveri Industrial"])
check("wildcard characters are plain text", res("B", "'%'")["total"] == 0 and res("B", "'_'")["total"] == 0 and res("B", "'\\'")["total"] == 0)
check("state filter", names(res("B", "''", "'maharashtra'")) == ["Other Supplies"])
check("category filter is exact, case-insensitive", names(res("B", "''", "''", "'HARDWARE'")) == ["Kaveri Industrial"] and res("B", "''", "''", "'Hard'")["total"] == 0)
check("filters combine", res("B", "'kaveri'", "'maharashtra'")["total"] == 0)
check("injection-looking text is harmless", res("B", "$q$'; drop table businesses; --$q$")["total"] == 0 and sh("select count(*) from businesses")[1] != "0")

# paging
p1 = res("B", "''", "''", "''", "false", "1", "0"); p2 = res("B", "''", "''", "''", "false", "1", "1")
check("paging: total stays, pages differ", p1["total"] == 2 and len(p1["items"]) == 1 and len(p2["items"]) == 1 and p1["items"][0]["org_id"] != p2["items"][0]["org_id"])
check("page size is capped and bad numbers are tamed", res("B", "''", "''", "''", "false", "100000", "-5")["total"] == 2 and len(res("B", "''", "''", "''", "false", "0", "0")["items"]) == 1)
check("listing never changes anything", sh("select count(*) from audit_log where action like 'directory%'")[1] == "0")

# ───────── the supplier profile (migration 8) ─────────
GP = lambda k, o: U(k, f"select get_supplier_profile('{o}')::text")
prof = lambda k, o: json.loads(GP(k, o)[1])
big = "data:image/png;base64," + "A" * 120000
small = "data:image/png;base64,iVBORw0KGgo="
sh(f"update supplier_profiles set description='Industrial fasteners and fittings from Peenya.', logo='{small}' where org_id='{org1}'")
sh(f"update businesses set country='India', business_type='Manufacturer', company_size='11-50', year_established=2009, website='kaveri.example.in' where id='{org1}'")
sh(f"insert into supplier_capabilities(org_id,coverage,delivery_time,min_order_value,delivery_options,pickup,details) values ('{org1}', array['Pan India'], '3-5 days', 5000, array['Courier'], 'Yes', '{{\"inHouse\":\"Yes\",\"monthlyCapacity\":\"50 tonnes\"}}'::jsonb)")
sh(f"insert into supplier_locations(org_id,country,state,city) values ('{org1}','India','Karnataka','Bengaluru'), ('{org1}','India','Tamil Nadu','Hosur')")
sh(f"insert into supplier_products(org_id,name,category,description,images,unit,moq,price,availability,sort_order) values ('{org1}','Hex bolt M8','Fasteners','Zinc plated hex bolt, 8.8 grade.', array['{small}'], 'pcs', 500, 4.5, 'Available', 1), ('{org1}','Anchor set','Hardware','Heavy duty anchors.', array['{big}'], 'box', 10, 220, 'Made to order', 2)")

denied("anonymous cannot open a profile", sh(f"select get_supplier_profile('{org1}')", "anon"))
denied("a supplier cannot open a competitor's profile", GP("X", org1), "not_allowed")
denied("a supplier cannot open their own through the buyer view either", GP("S", org1), "not_allowed")
ok("a buyer can open a profile", GP("B", org1)); ok("a reviewer can open a profile", GP("A", org1))
p = prof("B", org1)
check("profile carries the public company facts", p["name"] == "Kaveri Industrial" and p["city"] == "Bengaluru" and p["state"] == "Karnataka" and p["country"] == "India" and p["business_type"] == "Manufacturer" and p["year_established"] == 2009 and p["company_size"] == "11-50", str(p))
check("full description and categories", p["description"].startswith("Industrial fasteners") and p["categories"] == ["Fasteners", "Hardware"])
check("products are listed in order", [x["name"] for x in p["products"]] == ["Hex bolt M8", "Anchor set"] and p["products"][0]["price"] == 4.5 and p["products"][0]["availability"] == "Available")
check("one small photo per product, a large one is left out", p["products"][0]["image"] == small and p["products"][1]["image"] is None)
check("capabilities and service areas", p["capabilities"]["delivery_time"] == "3-5 days" and p["capabilities"]["details"]["monthlyCapacity"] == "50 tonnes" and len(p["locations"]) == 2)
check("passport is included (level 2, proofs counted)", p["passport"]["level"] == 2 and len(p["passport"]["checks"]) == 3)
raw = GP("B", org1)[1]
for secret in ["private@kaveri.in", "9880011223", "Ravi Kumar", "kaveri.example.in", "HDFC0001234", "secret.pdf", "Account ending", "No. 14, 3rd Cross"]:
    check(f"private detail never returned: {secret}", secret not in raw)
denied("an unfinished supplier cannot be opened", GP("B", org3), "not_found")
denied("a buyer company cannot be opened", GP("B", orgB), "not_found")
denied("a made-up id cannot be opened", GP("B", str(uuid.uuid4())), "not_found")
denied("a missing id is refused", U("B", "select get_supplier_profile(null)"), "not_found")
sh(f"update verification_checks set expires_at = current_date - 1 where org_id='{org1}'")
check("an expired proof stops counting on the profile too", prof("B", org1)["passport"]["level"] == 0)
sh(f"update verification_checks set expires_at = current_date + 300 where org_id='{org1}' and type <> 'bank'"); sh(f"update verification_checks set expires_at = current_date + 100 where org_id='{org1}' and type = 'bank'")
check("reading a profile never changes anything", sh("select count(*) from audit_log where action like 'directory%' or action like 'supplier_profile%'")[1] == "0")
check("only buyers and reviewers hold execute on the function", sh("select count(*) from information_schema.routine_privileges where routine_name='get_supplier_profile' and grantee in ('anon','public')")[1] == "0")

# ───────── saved suppliers (migration 9) ─────────
# E = employee of buyer company B, Y = owner of ANOTHER buyer company, W = procurement manager of buyer company B
for k, t in [("E", "buyer"), ("Y", "buyer"), ("W", "buyer")]:
    add_user(k, f"{k.lower()}@t.in", t)
orgB2 = str(uuid.uuid4())
sh(f"insert into businesses(id,slug,name,kind,state) values ('{orgB2}','buyer-two','Buyer Two','buyer','Kerala')")
for k, o, role in [("E", orgB, "employee"), ("W", orgB, "procurement_manager"), ("Y", orgB2, "owner")]:
    sh(f"insert into memberships(org_id,user_id,role) values ('{o}','{ids[k]}','{role}')")
SV = lambda k, b, s_: U(k, f"select save_supplier('{b}','{s_}')::text")
UN = lambda k, b, s_: U(k, f"select unsave_supplier('{b}','{s_}')::text")
IDS = lambda k, b: json.loads(U(k, f"select saved_supplier_ids('{b}')::text")[1])
LST = lambda k, b, *a: json.loads(U(k, f"select list_saved_suppliers('{b}'" + "".join("," + x for x in a) + ")::text")[1])

denied("anonymous cannot save", sh(f"select save_supplier('{orgB}','{org1}')", "anon"))
denied("anonymous cannot list saved", sh(f"select list_saved_suppliers('{orgB}')", "anon"))
denied("a supplier cannot save (not a buyer member)", SV("S", orgB, org1), "not_allowed")
denied("a supplier cannot save using its own company as the buyer", SV("S", org1, org2), "not_allowed")
denied("a stranger buyer cannot save into someone else's list", SV("Y", orgB, org1), "not_allowed")
denied("a reviewer is not a member, so cannot save", SV("A", orgB, org1), "not_allowed")
denied("an employee can see but not change the list", SV("E", orgB, org1), "not_allowed")
denied("an employee cannot remove either", UN("E", orgB, org1), "not_allowed")
denied("a null company is refused", U("B", f"select save_supplier(null,'{org1}')"), "not_allowed")
ok("the owner can save a supplier", SV("B", orgB, org1))
ok("saving twice is harmless", SV("B", orgB, org1))
ok("a procurement manager can save too", SV("W", orgB, org2))
check("one row per supplier, total counted", sh(f"select count(*) from saved_suppliers where buyer_org='{orgB}'")[1] == "2")
denied("a buyer company cannot be saved as a supplier", SV("B", orgB, orgB2), "not_found")
denied("an unfinished supplier cannot be saved", SV("B", orgB, org3), "not_found")
denied("a made-up supplier id cannot be saved", SV("B", orgB, str(uuid.uuid4())), "not_found")
denied("a null supplier id is refused", U("B", f"select save_supplier('{orgB}', null)"), "not_found")
check("saved ids list", sorted(IDS("E", orgB)) == sorted([org1, org2]), str(IDS("E", orgB)))
check("any team member can read the shortlist", LST("E", orgB)["total"] == 2)
denied("another company cannot read this list", U("Y", f"select list_saved_suppliers('{orgB}')"), "not_allowed")
denied("another company cannot read these ids", U("Y", f"select saved_supplier_ids('{orgB}')"), "not_allowed")
denied("a supplier cannot read any list", U("S", f"select list_saved_suppliers('{orgB}')"), "not_allowed")
denied("a supplier cannot read a list with its own company id", U("S", f"select list_saved_suppliers('{org1}')"), "not_allowed")
check("the other company has an empty list of its own", LST("Y", orgB2)["total"] == 0 and IDS("Y", orgB2) == [])
l = LST("B", orgB)
check("newest saved first, directory-shaped cards", [i["name"] for i in l["items"]] == ["Other Supplies", "Kaveri Industrial"] and l["items"][1]["level"] == 2 and l["items"][1]["government_checked"] is True, str([i["name"] for i in l["items"]]))
raw = U("B", f"select list_saved_suppliers('{orgB}')::text")[1]
for secret in ["private@kaveri.in", "9880011223", "Ravi Kumar", "kaveri.example.in", "HDFC0001234", "secret.pdf", "Account ending", "No. 14, 3rd Cross"]:
    check(f"private detail never returned in the shortlist: {secret}", secret not in raw)
check("saved_by is never returned", "saved_by" not in raw)
sh(f"update verification_checks set expires_at = current_date - 1 where org_id='{org1}'")
check("an expired proof stops counting in the shortlist", [i["level"] for i in LST("B", orgB)["items"]] == [0, 0])
sh(f"update verification_checks set expires_at = current_date + 300 where org_id='{org1}' and type <> 'bank'"); sh(f"update verification_checks set expires_at = current_date + 100 where org_id='{org1}' and type = 'bank'")
p1 = LST("B", orgB, "1", "0"); p2 = LST("B", orgB, "1", "1")
check("paging works and the total stays", p1["total"] == 2 and len(p1["items"]) == 1 and len(p2["items"]) == 1 and p1["items"][0]["org_id"] != p2["items"][0]["org_id"])
check("bad paging numbers are tamed", len(LST("B", orgB, "100000", "-5")["items"]) == 2 and len(LST("B", orgB, "0", "0")["items"]) == 1)
# the browser can never touch the table
for who, label in [("authenticated", "a signed-in user"), ("anon", "an anonymous visitor")]:
    for q in ["select * from saved_suppliers", f"insert into saved_suppliers(buyer_org,supplier_org) values ('{orgB2}','{org1}')", "delete from saved_suppliers", "update saved_suppliers set saved_at = now()"]:
        r = sh(q, who, ids["B"] if who == "authenticated" else None)
        check(f"{label} cannot run: {q.split(' ')[0]} on the table", not r[0] and "permission denied" in r[2], r[2])
check("no function is open to anonymous or public visitors", sh("select count(*) from information_schema.routine_privileges where routine_name in ('save_supplier','unsave_supplier','saved_supplier_ids','list_saved_suppliers','_saved_guard') and grantee in ('anon','public')")[1] == "0")
check("the guard helper is not callable from the browser", not sh(f"select _saved_guard('{orgB}', false)", "authenticated", ids["B"])[0])
check("saves are audited with ids only", sh(f"select count(*) from audit_log where org_id='{orgB}' and action='supplier_saved'")[1] == "2" and sh("select count(*) from audit_log where action like 'supplier_%saved' and detail <> '{}'::jsonb")[1] == "0")
ok("the owner can remove a supplier", UN("B", orgB, org2))
ok("removing twice is harmless", UN("B", orgB, org2))
check("removal is audited once", sh(f"select count(*) from audit_log where org_id='{orgB}' and action='supplier_unsaved'")[1] == "1")
check("the list shrinks and the other company is unaffected", IDS("B", orgB) == [org1])
ok("a supplier who leaves takes their saves with them", sh(f"delete from businesses where id='{org2}'"))
check("saves are gone with the supplier", sh("select count(*) from saved_suppliers where supplier_org not in (select id from businesses)")[1] == "0")
# the per-company limit (500), last because it fills the database with filler suppliers
sh(f"""insert into businesses(id,slug,name,kind) select gen_random_uuid(), 'filler-'||g, 'Filler '||g, 'supplier' from generate_series(1,500) g;
       insert into supplier_profiles(org_id) select id from businesses where slug like 'filler-%';
       insert into saved_suppliers(buyer_org,supplier_org) select '{orgB}', id from businesses where slug like 'filler-%' limit 499;""")
fill = sh("select id from businesses where slug like 'filler-%' order by slug offset 499 limit 1")[1]
ok("the 500th supplier fits", SV("B", orgB, fill))
extra = sh(f"insert into businesses(id,slug,name,kind) values (gen_random_uuid(),'filler-extra','Filler extra','supplier'); insert into supplier_profiles(org_id) select id from businesses where slug='filler-extra'; select id from businesses where slug='filler-extra'")[1]
denied("the 501st is refused", SV("B", orgB, extra), "too_many_saved")
ok("saving one that is already saved still works at the limit", SV("B", orgB, fill))

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
