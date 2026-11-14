#!/usr/bin/env python3
"""
Security tests for supabase/migrations/20261114000003_onboarding_profiles.sql

Builds a THROWAWAY database `vendora_onboarding_test` (dropped and recreated every run), imitates the parts
of Supabase the migrations need, applies migrations 1, 2 and 3, then attacks them as different users.
Never point it at a real project.

Usage (any local Postgres 14+, using the normal libpq variables):
    PGHOST=localhost PGPORT=5432 PGUSER=postgres python3 supabase/tests/onboarding/run_tests.py
"""
import json, os, subprocess, sys, uuid
HERE = os.path.dirname(os.path.abspath(__file__))
MIG = os.path.join(HERE, "..", "..", "migrations")
BOOT = os.path.join(HERE, "..", "invite_only", "bootstrap_local_supabase.sql")
DB = "vendora_onboarding_test"
PSQL = os.environ.get("PSQL_BIN", "psql")

def run(args, sql=None, db=DB):
    return subprocess.run([PSQL, "-q", "-At", "-v", "ON_ERROR_STOP=1", "-d", db] + args, input=sql, capture_output=True, text=True)

def sh(sql, role=None, sub=None):
    """Run SQL as the superuser, or as a Supabase role (anon / authenticated) with a given user id."""
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
    if r.returncode: print(r.stderr); sys.exit("migration failed: " + path)
apply(BOOT)
apply(os.path.join(MIG, "20261113000001_core_schema.sql"))

# Users that exist BEFORE migration 3 (as in a live project): one signed up as a supplier, one with no choice recorded.
ids = {k: str(uuid.uuid4()) for k in "ABCDEFGHIJ"}
def add_user(k, email, meta, confirmed=True):
    sh(f"insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values ('{ids[k]}','{email}',{'now()' if confirmed else 'null'},'{json.dumps(meta)}')")
add_user("A", "a@buyer.in", {"name": "Asha"})
add_user("B", "b@supply.in", {"name": "Bala", "account_type": "supplier"})
apply(os.path.join(MIG, "20261113000002_invite_only_onboarding.sql"))
# A leftover table from an earlier attempt, with the wrong columns and no rows, must be replaced (the real-world error:
# 'column "org_id" does not exist'). A user whose profile row is missing must get one.
sh("create table public.supplier_profiles (id int primary key, note text)")
sh(f"delete from public.profiles where user_id='{ids['B']}'")
apply(os.path.join(MIG, "20261114000003_onboarding_profiles.sql"))
apply(os.path.join(MIG, "20261114000003_onboarding_profiles.sql"))   # must be safe to run twice
check("wrong empty leftover table was replaced", sh("select count(*) from information_schema.columns where table_name='supplier_profiles' and column_name='org_id'")[1] == "1")

# ───────── account type: backfill and sign-up ─────────
at = lambda k: sh(f"select account_type||'|'||account_type_locked from profiles where user_id='{ids[k]}'")[1]
check("existing user without a choice = locked buyer", at("A") == "buyer|true", at("A"))
check("existing supplier user = locked supplier", at("B") == "supplier|true", at("B"))
add_user("C", "c@buyer.in", {"name": "Chitra", "account_type": "buyer"})
add_user("D", "d@supply.in", {"name": "Dev", "account_type": "supplier"})
add_user("E", "e@google.in", {"name": "Esha"})                                   # Google sign-up: no choice yet
add_user("F", "f@evil.in", {"name": "Eve", "account_type": "admin"})             # junk value must not be trusted
check("new buyer sign-up locked", at("C") == "buyer|true", at("C"))
check("new supplier sign-up locked", at("D") == "supplier|true", at("D"))
check("no choice = unlocked buyer", at("E") == "buyer|false", at("E"))
check("junk account_type becomes unlocked buyer", at("F") == "buyer|false", at("F"))

U = lambda k, sql: sh(sql, "authenticated", ids[k])
for k in "ABCDEF": pass

denied("user cannot change own account_type", U("C", f"update profiles set account_type='supplier' where user_id='{ids['C']}'"), "permission denied")
denied("user cannot unlock own account_type", U("E", f"update profiles set account_type_locked=false where user_id='{ids['E']}'"), "permission denied")
denied("user cannot change own profile email", U("C", f"update profiles set email='x@y.z' where user_id='{ids['C']}'"), "permission denied")
ok("user can change own display name", U("C", f"update profiles set name='Chitra R' where user_id='{ids['C']}'"))
check("name really changed", sh(f"select name from profiles where user_id='{ids['C']}'")[1] == "Chitra R")
denied("user cannot insert a profile", U("C", f"insert into profiles(user_id,account_type) values (gen_random_uuid(),'supplier')"), "permission denied")

# claim_account_type: fills in a missing choice once, never converts
check("unlocked user can claim supplier", U("E", "select claim_account_type('supplier')")[1] == "supplier")
check("claim locked it", at("E") == "supplier|true", at("E"))
check("second claim does not convert", U("E", "select claim_account_type('buyer')")[1] == "supplier")
check("locked buyer cannot be converted by claim", U("C", "select claim_account_type('supplier')")[1] == "buyer")
denied("claim rejects junk", U("F", "select claim_account_type('admin')"), "invalid_type")
denied("anon cannot claim", sh("select claim_account_type('supplier')", "anon"), "permission denied")

# ───────── businesses: kind + column privileges ─────────
orgA = U("A", "select create_organization('Acme Buyer','acme-1','Mfg','Pune')")[1]
check("legacy create_organization still works for a buyer", len(orgA) == 36)
check("legacy org is a buyer company", sh(f"select kind from businesses where id='{orgA}'")[1] == "buyer")
denied("supplier account cannot create a buyer company", U("D", "select create_organization('Sneaky','sneaky-1')"), "account_type_mismatch")
ok("owner can rename company", U("A", f"update businesses set name='Acme Ltd' where id='{orgA}'"))
denied("owner cannot upgrade plan", U("A", f"update businesses set plan='Enterprise' where id='{orgA}'"), "permission denied")
denied("owner cannot change kind", U("A", f"update businesses set kind='supplier' where id='{orgA}'"), "permission denied")
denied("owner cannot change slug", U("A", f"update businesses set slug='hijack' where id='{orgA}'"), "permission denied")
denied("kind is immutable even for a superuser", sh(f"update businesses set kind='supplier' where id='{orgA}'"), "kind_immutable")
denied("nobody inserts businesses directly", U("A", "insert into businesses(slug,name) values ('direct-1','Direct')"), "permission denied")
denied("nobody deletes businesses directly", U("A", f"delete from businesses where id='{orgA}'"), "permission denied")

# a supplier account cannot join a buyer company through an invitation
inv = json.loads(U("A", f"select create_invitation('{orgA}','d@supply.in','employee')")[1])
r = U("D", f"select accept_invitation('{inv['token']}')")
denied("supplier account cannot accept an invitation to a buyer company", r, "account_type_mismatch")
check("no membership was created", sh(f"select count(*) from memberships where user_id='{ids['D']}'")[1] == "0")
# a buyer account still can (invite-only joining is unchanged)
add_user("G", "g@buyer.in", {"name": "Gita"})
inv2 = json.loads(U("A", f"select create_invitation('{orgA}','g@buyer.in','approver')")[1])
check("buyer account still joins a buyer company by invitation", json.loads(U("G", f"select accept_invitation('{inv2['token']}')")[1])["state"] == "ok")

# ───────── onboarding_progress ─────────
BUYER = {"companyName": "Nova Steelworks", "businessType": "Manufacturer", "industry": "Manufacturing", "country": "India",
         "state": "Maharashtra", "city": "Pune", "website": "www.nova.in", "companySize": "11–50 employees",
         "categories": ["Raw Materials", "Packaging Materials"], "frequency": "Weekly", "budget": "₹1–5 lakh", "budgetCurrency": "INR",
         "priorities": ["Fast delivery"], "sourcing": ["Anywhere in India"], "delivery": "Within one week", "nextAction": "rfq", "step": 4}
def J(o): return "$j$" + json.dumps(o) + "$j$::jsonb"
save = lambda k, kind, step, data: U(k, f"select save_onboarding_progress('{kind}', {step}, {J(data)})")

add_user("H", "h@new.in", {"name": "Hari", "account_type": "buyer"})
denied("launch before saving anything fails", U("H", "select complete_buyer_onboarding()"), "no_progress")
denied("a supplier account cannot save buyer progress", save("D", "buyer", 1, BUYER), "wrong_account_type")
denied("a buyer account cannot save supplier progress", save("H", "supplier", 1, {}), "wrong_account_type")
denied("bad step rejected", save("H", "buyer", 9, BUYER), "invalid_step")
denied("bad kind rejected", save("H", "admin", 1, BUYER), "invalid_kind")
denied("non-object data rejected", U("H", "select save_onboarding_progress('buyer', 1, '[1,2]'::jsonb)"), "invalid_data")
denied("anon cannot save", sh("select save_onboarding_progress('buyer', 1, '{}'::jsonb)", "anon"), "permission denied")
denied("huge payload rejected", U("H", "select save_onboarding_progress('buyer', 1, jsonb_build_object('x', repeat('a', 7000000)))"), "too_large")
ok("buyer can save progress", save("H", "buyer", 2, {**BUYER, "step": 2}))
check("progress is stored", sh(f"select current_step||'|'||status from onboarding_progress where user_id='{ids['H']}'")[1] == "2|in_progress")
ok("saving again overwrites (resume point moves)", save("H", "buyer", 3, {**BUYER, "step": 3}))
check("still one row", sh(f"select count(*) from onboarding_progress where user_id='{ids['H']}'")[1] == "1")
check("owner can read own progress", U("H", "select count(*) from onboarding_progress")[1] == "1")
check("others cannot read it", U("A", "select count(*) from onboarding_progress")[1] == "0")
denied("nobody writes progress directly", U("H", f"update onboarding_progress set status='completed' where user_id='{ids['H']}'"), "permission denied")
denied("nobody inserts progress directly", U("A", f"insert into onboarding_progress(user_id,kind) values ('{ids['A']}','buyer')"), "permission denied")
check("saving locked the account type", at("H") == "buyer|true")

# ───────── buyer launch ─────────
bad = {**BUYER}; del bad["city"]
ok("save invalid answers (strict checks happen at launch)", save("H", "buyer", 4, bad))
denied("launch with a missing field fails", U("H", "select complete_buyer_onboarding()"), "invalid_city")
check("a failed launch creates nothing", sh(f"select count(*) from memberships where user_id='{ids['H']}'")[1] == "0")
denied("website with a script scheme rejected", (save("H", "buyer", 4, {**BUYER, "website": "javascript:alert(1)"}), U("H", "select complete_buyer_onboarding()"))[1], "invalid_website")
denied("non-string field rejected", (save("H", "buyer", 4, {**BUYER, "industry": {"a": 1}}), U("H", "select complete_buyer_onboarding()"))[1], "invalid_industry")
denied("empty categories rejected", (save("H", "buyer", 4, {**BUYER, "categories": []}), U("H", "select complete_buyer_onboarding()"))[1], "invalid_categories")
denied("junk nextAction rejected", (save("H", "buyer", 4, {**BUYER, "nextAction": "drop table"}), U("H", "select complete_buyer_onboarding()"))[1], "invalid_nextAction")
denied("a supplier account cannot launch a buyer company", U("D", "select complete_buyer_onboarding()"), "wrong_account_type")
denied("anon cannot launch", sh("select complete_buyer_onboarding()", "anon"), "permission denied")

ok("save good answers", save("H", "buyer", 4, BUYER))
org1 = U("H", "select complete_buyer_onboarding()")[1]
check("launch returns a company id", len(org1) == 36, org1)
org2 = U("H", "select complete_buyer_onboarding()")[1]
check("launching twice returns the SAME company (no duplicate)", org1 == org2)
check("exactly one company for this person", sh(f"select count(*) from memberships where user_id='{ids['H']}'")[1] == "1")
check("company is a buyer with the right details", sh(f"select kind||'|'||name||'|'||city||'|'||state||'|'||business_type from businesses where id='{org1}'")[1] == "buyer|Nova Steelworks|Pune|Maharashtra|Manufacturer")
check("person is the owner", sh(f"select role||'|'||status from memberships where org_id='{org1}' and user_id='{ids['H']}'")[1] == "owner|active")
check("buyer profile written", sh(f"select purchase_frequency||'|'||budget_currency||'|'||next_action||'|'||cardinality(categories) from buyer_profiles where org_id='{org1}'")[1] == "Weekly|INR|rfq|2")
check("progress marked completed and cleared", sh(f"select status||'|'||(data='{{}}'::jsonb)||'|'||(org_id='{org1}') from onboarding_progress where user_id='{ids['H']}' and kind='buyer'")[1] == "completed|true|true")
check("launch is audited", int(sh(f"select count(*) from audit_log where org_id='{org1}' and action='onboarding_completed'")[1]) == 1)
denied("cannot overwrite progress after completing", save("H", "buyer", 1, BUYER), "already_completed")
check("the person's own company is visible to them", U("H", "select count(*) from businesses")[1] == "1")
check("buyer profile visible to members only", U("H", f"select count(*) from buyer_profiles where org_id='{org1}'")[1] == "1" and U("A", f"select count(*) from buyer_profiles where org_id='{org1}'")[1] == "0")
denied("nobody writes buyer_profiles directly", U("H", f"update buyer_profiles set next_action='team' where org_id='{org1}'"), "permission denied")
denied("nobody inserts buyer_profiles directly", U("A", f"insert into buyer_profiles(org_id) values ('{orgA}')"), "permission denied")

# ───────── supplier launch ─────────
PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
SUP = {"name": "Kaveri Industrial Supplies", "businessType": "Manufacturer", "industry": "Industrial Equipment", "country": "India",
       "state": "Karnataka", "city": "Bengaluru", "website": "https://kaveri.example.in", "companySize": "51–200 employees", "yearEstablished": "2008",
       "description": "We manufacture precision fasteners and fittings for industrial buyers across India, with ISO-certified processes.",
       "logo": PNG, "contactName": "Meera Rao", "designation": "Sales head", "email": "Sales@Kaveri.Example.in", "phoneCode": "+91", "phone": "98450 12345", "altPhone": "",
       "categories": ["Industrial Machinery", "Raw Materials"],
       "offerings": [{"id": "x1", "name": "Hex bolts M10", "category": "Industrial Machinery", "description": "Zinc plated hex bolts, grade 8.8.", "images": [PNG], "unit": "Pieces", "moq": "500", "price": "12.50", "availability": "Available"},
                     {"id": "x2", "name": "", "category": "", "description": "", "images": [], "unit": "", "moq": "", "price": "", "availability": ""}],
       "coverage": ["Within my state", "Across India"], "locations": [{"country": "India", "state": "Tamil Nadu", "city": "Chennai"}, {"country": "India", "state": "Tamil Nadu", "city": "Chennai"}],
       "deliveryTime": "4–7 days", "minOrderValue": "5000", "deliveryOptions": ["Third-party logistics"], "pickup": "Yes",
       "inHouse": "Yes", "monthlyCapacity": "20 tonnes", "mfgCapabilities": ["CNC machining"], "customMfg": "Yes", "multiSource": "", "readyStock": "", "bulkOrders": "",
       "servicesOffered": [], "serviceCoverage": "", "largeProjects": "", "tradeCountries": "", "intlShipping": "", "registrationNo": "", "step": 5}
launch_sup = lambda k, d: (save(k, "supplier", 5, d), U(k, "select complete_supplier_onboarding()"))[1]

denied("a buyer account cannot launch a supplier company", U("H", "select complete_supplier_onboarding()"), "wrong_account_type")
for name, patch, word in [
    ("short description", {"description": "too short"}, "invalid_description"),
    ("bad email", {"email": "nope"}, "invalid_email"),
    ("bad phone code", {"phoneCode": "91"}, "invalid_phoneCode"),
    ("short phone", {"phone": "12"}, "invalid_phone"),
    ("no categories", {"categories": []}, "invalid_categories"),
    ("no coverage", {"coverage": []}, "invalid_coverage"),
    ("svg logo", {"logo": "data:image/svg+xml;base64,PHN2Zz48c2NyaXB0PmFsZXJ0KDEpPC9zY3JpcHQ+PC9zdmc+"}, "invalid_logo"),
    ("javascript: website", {"website": "javascript:alert(1)"}, "invalid_website"),
    ("future year", {"yearEstablished": "2999"}, "invalid_yearEstablished"),
    ("no offerings", {"offerings": []}, "invalid_offerings"),
    ("manufacturer without in-house answer", {"inHouse": ""}, "invalid_inHouse"),
    ("negative price", {"offerings": [{**SUP["offerings"][0], "price": "-5"}]}, "invalid_price"),
    ("offering in a category the supplier did not pick", {"offerings": [{**SUP["offerings"][0], "category": "Chemicals"}]}, "invalid_offerings"),
    ("svg product image", {"offerings": [{**SUP["offerings"][0], "images": ["data:image/svg+xml;base64,AAAA"]}]}, "invalid_images"),
    ("bad availability", {"offerings": [{**SUP["offerings"][0], "availability": "Whenever"}]}, "invalid_offerings"),
    ("5 product images", {"offerings": [{**SUP["offerings"][0], "images": [PNG] * 5}]}, "invalid_images"),
]:
    denied(f"supplier launch rejects: {name}", launch_sup("D", {**SUP, **patch}), word)
check("failed supplier launches created nothing", sh(f"select count(*) from memberships where user_id='{ids['D']}'")[1] == "0")

sorg = launch_sup("D", SUP)[1]
check("supplier launch returns a company id", len(sorg) == 36, sorg)
check("supplier launch twice = same company", U("D", "select complete_supplier_onboarding()")[1] == sorg)
check("supplier company is kind=supplier", sh(f"select kind||'|'||name||'|'||year_established from businesses where id='{sorg}'")[1] == "supplier|Kaveri Industrial Supplies|2008")
check("owner membership", sh(f"select role from memberships where org_id='{sorg}' and user_id='{ids['D']}'")[1] == "owner")
check("profile written, email lower-cased", sh(f"select email||'|'||phone_code||'|'||cardinality(categories) from supplier_profiles where org_id='{sorg}'")[1] == "sales@kaveri.example.in|+91|2")
check("empty extra product ignored, real one kept", sh(f"select count(*)||'|'||min(name)||'|'||min(price)||'|'||min(currency)||'|'||min(cardinality(images)) from supplier_products where org_id='{sorg}'")[1] == "1|Hex bolts M10|12.50|INR|1")
check("duplicate locations collapse", sh(f"select count(*) from supplier_locations where org_id='{sorg}'")[1] == "1")
check("capabilities written", sh(f"select coverage[2]||'|'||pickup||'|'||min_order_value||'|'||(details->>'inHouse')||'|'||(details->>'monthlyCapacity') from supplier_capabilities where org_id='{sorg}'")[1] == "Across India|Yes|5000.00|Yes|20 tonnes")
check("verification starts as not_submitted", sh(f"select status from supplier_verifications where org_id='{sorg}'")[1] == "not_submitted")
check("supplier progress completed", sh(f"select status from onboarding_progress where user_id='{ids['D']}' and kind='supplier'")[1] == "completed")
check("supplier members can read their data", U("D", f"select count(*) from supplier_products where org_id='{sorg}'")[1] == "1")
check("a buyer company cannot read a supplier's data", U("H", f"select count(*) from supplier_profiles where org_id='{sorg}'")[1] == "0" and U("H", f"select count(*) from supplier_verifications where org_id='{sorg}'")[1] == "0")
denied("nobody writes supplier_verifications directly (cannot self-verify)", U("D", f"update supplier_verifications set status='verified' where org_id='{sorg}'"), "permission denied")
denied("nobody writes supplier_products directly", U("D", f"insert into supplier_products(org_id,name,category,availability) values ('{sorg}','x1','c','Available')"), "permission denied")
denied("nobody deletes supplier_locations directly", U("D", f"delete from supplier_locations where org_id='{sorg}'"), "permission denied")
denied("anon reads nothing", sh("select count(*) from supplier_profiles", "anon"), "permission denied")

# service provider needs service answers
add_user("I", "i@svc.in", {"name": "Isha", "account_type": "supplier"})
svc = {**SUP, "name": "Svc Co", "businessType": "Service Provider", "servicesOffered": [], "serviceCoverage": ""}
denied("service provider must pick services", launch_sup("I", svc), "invalid_servicesOffered")
ok("service provider with services launches", (lambda r: (r[0], r[1], r[2]))(launch_sup("I", {**svc, "servicesOffered": ["Installation"], "serviceCoverage": "Local"})))

# ───────── regression: the invite-only rules from migration 2 still hold after migration 3 ─────────
check("owner can still list members", int(U("A", f"select count(*) from list_members('{orgA}')")[1]) == 2)
denied("members still cannot write memberships directly", U("A", f"update memberships set role='owner' where org_id='{orgA}'"), "permission denied")

# ───────── a wrong leftover table that HOLDS DATA is never dropped silently ─────────
sh("drop table public.buyer_profiles cascade")
sh("create table public.buyer_profiles (x int)")
sh("insert into public.buyer_profiles values (1)")
r = run(["-f", os.path.join(MIG, "20261114000003_onboarding_profiles.sql")])
check("wrong table with data stops the migration", r.returncode != 0 and "holds 1 row" in r.stderr, r.stderr)
check("its data is still there", sh("select count(*) from public.buyer_profiles")[1] == "1")

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
