#!/usr/bin/env python3
"""
Tests for the buyer / supplier separation in the database (migrations 1-11, mostly 11: database lock).
Builds a THROWAWAY database `vendora_separation_test`, applies every migration, then attacks it from the WRONG side:
buyers trying to write supplier data, suppliers trying to use buyer tools, and both trying to flip sides.
Never point it at a real project.

    PGHOST=localhost PGUSER=postgres python3 supabase/tests/separation/run_tests.py
    (set PSQL_BIN if psql is not on your PATH)
"""
import glob, json, os, subprocess, sys, uuid
HERE = os.path.dirname(os.path.abspath(__file__))
MIG = os.path.join(HERE, "..", "..", "migrations")
BOOT = os.path.join(HERE, "..", "invite_only", "bootstrap_local_supabase.sql")
DB = "vendora_separation_test"
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
r = run([], """create schema storage;
create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, metadata jsonb default '{}'::jsonb);
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to authenticated;"""); assert r.returncode == 0, r.stderr
files = sorted(glob.glob(os.path.join(MIG, "*.sql")))
assert files[-1].endswith("_database_lock.sql"), "the newest migration should be the database lock (11)"
for f in files: apply(f)
apply(files[-1])  # the lock must be safe to run twice

# people: B buyer owner, E buyer employee, Z buyer account with no company, S supplier owner, T supplier employee, X other supplier owner
ids = {k: str(uuid.uuid4()) for k in "BEZSTX"}
for k, t in [("B", "buyer"), ("E", "buyer"), ("Z", "buyer"), ("S", "supplier"), ("T", "supplier"), ("X", "supplier")]:
    sh(f"insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values ('{ids[k]}','{k.lower()}@t.in',now(),'{json.dumps({'name': k + ' user', 'account_type': t})}')")
oB, oS, oX = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
for o, n, kind in [(oB, "Buyer Co", "buyer"), (oS, "Kaveri Industrial", "supplier"), (oX, "Other Supplies", "supplier")]:
    sh(f"insert into businesses(id,slug,name,kind,state,gstin) values ('{o}','{n.lower().replace(' ', '-')}','{n}','{kind}','Karnataka','29AABCT1332L1Z7')")
    if kind == "supplier": sh(f"insert into supplier_profiles(org_id) values ('{o}'); insert into supplier_verifications(org_id) values ('{o}')")
for k, o, role in [("B", oB, "owner"), ("E", oB, "employee"), ("S", oS, "owner"), ("T", oS, "employee"), ("X", oX, "owner")]:
    sh(f"insert into memberships(org_id,user_id,role) values ('{o}','{ids[k]}','{role}')")
U = lambda k, sql: sh(sql, "authenticated", ids[k])
ANON = lambda sql: sh(sql, "anon")

BUYER_TABLES = ["categories", "suppliers", "supplier_contacts", "materials", "rfqs", "rfq_items", "rfq_invites", "quotations", "quotation_lines",
                "purchase_orders", "po_lines", "purchase_requests", "request_items", "approval_steps", "approval_rules", "insights"]
SHARED_ORG_TABLES = ["audit_log", "notifications"]   # written by both sides on purpose (as themselves)

# ═══ 1. a supplier company cannot write the buyer tables ═══
# Row level security is checked BEFORE the not-null rules, so an empty insert tells us which gate stopped it:
# "row-level security" = the side lock; anything else = the side lock let it through (and a normal rule stopped the empty row).
# Each insert is made as valid as the table's own rules need (a purchase request needs the caller as requester), so the
# ONLY thing that can stop the supplier is the side lock, and the error must name it.
extra = {"purchase_requests": lambda who, o: f"insert into purchase_requests(org_id,requester_id) values ('{o}','{ids[who]}')"}
for t in BUYER_TABLES:
    q = lambda who, o: extra[t](who, o) if t in extra else f"insert into {t}(org_id) values ('{o}')"
    r = U("S", q("S", oS))
    if t == "insights":   # nobody can insert insights from the browser at all; the policy count below proves the lock is there
        check("supplier owner cannot insert into insights", not r[0], r[2][:120])
    else:
        check(f"supplier owner is stopped by the side lock on {t}", not r[0] and "buyer_side_only" in r[2], r[2][:120])
    r = U("B", q("B", oB))
    check(f"the buyer owner is NOT stopped by the side lock on {t}", "buyer_side_only" not in r[2], r[2][:120])
    r = U("B", q("B", oS))
    check(f"the buyer owner cannot write {t} into a supplier company either", not r[0] and ("row-level security" in r[2] or "permission denied" in r[2]), r[2][:120])
# real rows: the buyer's normal work still works, the supplier's attempts change nothing
ok("a buyer owner can add a category", U("B", f"insert into categories(org_id,name) values ('{oB}','Packaging')"))
ok("a buyer owner can add a supplier to their own list", U("B", f"insert into suppliers(org_id,name) values ('{oB}','My Vendor')"))
sh(f"insert into categories(org_id,name) values ('{oS}','Planted'); insert into suppliers(org_id,name) values ('{oS}','Planted')")
for t in ["categories", "suppliers"]:
    U("S", f"update {t} set name='HACKED' where org_id='{oS}'"); U("S", f"delete from {t} where org_id='{oS}'")
    check(f"supplier cannot edit or delete rows in {t}", sh(f"select count(*) from {t} where org_id='{oS}' and name='Planted'")[1] == "1")
    check(f"supplier cannot even read buyer-tool rows in {t}", U("S", f"select count(*) from {t}")[1] == "0")

# ═══ 2. a buyer company cannot write supplier data ═══
sh(f"insert into supplier_products(org_id,name,category,description,unit,availability,currency) values ('{oS}','Cement','Construction Materials','','Bags','Available','INR')")
chk = sh(f"insert into verification_checks(org_id,type,reference,status) values ('{oS}','registration','29AABCT1332L1Z7','draft') returning id")[1]
for t, cols in [("supplier_profiles", "org_id"), ("supplier_products", "org_id,name,category,description,unit,availability"), ("supplier_capabilities", "org_id"),
                ("supplier_locations", "org_id"), ("supplier_verifications", "org_id"), ("verification_checks", "org_id,type")]:
    for who, o in [("B", oB), ("B", oS)]:
        denied(f"buyer cannot insert into {t} (org {'own' if o == oB else 'supplier'})", U(who, f"insert into {t}({cols}) values ('{o}'" + ("" if cols == "org_id" else (",'x','Other','','kg','Available'" if t == "supplier_products" else ",'registration'")) + ")"), "permission denied")
    denied(f"buyer cannot update {t}", U("B", f"update {t} set org_id=org_id"), "permission denied")
    denied(f"buyer cannot delete from {t}", U("B", f"delete from {t}"), "permission denied")
check("buyer cannot read a supplier's private proofs", U("B", "select count(*) from verification_checks")[1] == "0")
check("buyer cannot read a supplier's product table directly", U("B", "select count(*) from supplier_products")[1] == "0")
U("B", f"update businesses set name='HACKED' where id='{oS}'"); U("B", f"delete from businesses where id='{oS}'")
check("buyer cannot rename or delete a supplier company", sh(f"select name from businesses where id='{oS}'")[1] == "Kaveri Industrial")
denied("buyer cannot add a product to a supplier", U("B", f"select save_supplier_product('{oS}','{{\"name\":\"zz\",\"category\":\"Other\",\"availability\":\"Available\"}}'::jsonb)"), "not_allowed")
denied("buyer cannot delete a supplier's product", U("B", f"select delete_supplier_product('{oS}','{uuid.uuid4()}')"), "not_allowed")
for label, sql in [("start a proof", f"select start_check('{oS}','registration','','29AABCT1332L1Z7','',null,null)"),
                   ("start a proof in their own company", f"select start_check('{oB}','registration','','29AABCT1332L1Z7','',null,null)"),
                   ("submit a proof", f"select submit_check('{chk}')"), ("withdraw a proof", f"select withdraw_check('{chk}')"),
                   ("attach a document", f"select attach_document('{chk}','{oS}/a.pdf','a.pdf')"),
                   ("ask for a government lookup", f"select request_gst_lookup('{chk}')"), ("open a proof document", f"select record_document_view('{chk}')")]:
    denied(f"buyer cannot {label}", U("B", sql), "not_")   # not_allowed, or not_found (which hides whether the proof exists)
denied("buyer cannot finish supplier onboarding", U("B", "select complete_supplier_onboarding()"), "wrong_account_type")
denied("buyer cannot save supplier onboarding", U("B", "select save_onboarding_progress('supplier',1,'{}'::jsonb)"), "wrong_account_type")
denied("buyer cannot invite people into a supplier company", U("B", f"select create_invitation('{oS}','n@t.in','employee')"), "not_allowed")
ok("(control) the supplier owner CAN add a product through the checked function", U("S", f"select save_supplier_product('{oS}','{{\"name\":\"Steel Bar Fe500\",\"category\":\"Raw Materials\",\"availability\":\"Available\"}}'::jsonb)"))

# ═══ 3. a supplier company cannot use the buyer tools ═══
for org, label in [(oB, "a buyer company"), (oS, "their own company")]:
    denied(f"supplier cannot save a supplier into {label}'s shortlist", U("S", f"select save_supplier('{org}','{oX}')"), "not_allowed")
    denied(f"supplier cannot remove from {label}'s shortlist", U("S", f"select unsave_supplier('{org}','{oX}')"), "not_allowed")
    denied(f"supplier cannot read {label}'s shortlist ids", U("S", f"select saved_supplier_ids('{org}')"), "not_allowed")
    denied(f"supplier cannot list {label}'s shortlist", U("S", f"select list_saved_suppliers('{org}',50,0)"), "not_allowed")
denied("supplier cannot browse the buyer directory", U("S", "select list_suppliers('','','',false,20,0)"), "not_allowed")
denied("supplier cannot open another supplier's buyer-facing profile", U("S", f"select get_supplier_profile('{oX}')"), "not_allowed")
denied("supplier cannot finish buyer onboarding", U("S", "select complete_buyer_onboarding()"), "wrong_account_type")
denied("supplier cannot save buyer onboarding", U("S", "select save_onboarding_progress('buyer',1,'{}'::jsonb)"), "wrong_account_type")
denied("supplier cannot create a buyer company", U("S", "select create_organization('Sneaky Buyer','sneaky','Mfg','Pune')"), "account_type_mismatch")
ok("(control) a buyer CAN browse the directory", U("B", "select list_suppliers('','','',false,20,0)"))
ok("(control) a buyer CAN shortlist a supplier", U("B", f"select save_supplier('{oB}','{oS}')"))
denied("a buyer team member cannot change the shortlist (owner and procurement manager only)", U("E", f"select save_supplier('{oB}','{oX}')"), "not_allowed")
# a supplier cannot touch another supplier either
denied("supplier cannot add products to another supplier", U("S", f"select save_supplier_product('{oX}','{{\"name\":\"zz\",\"category\":\"Other\",\"availability\":\"Available\"}}'::jsonb)"), "not_allowed")
denied("a supplier employee cannot change products (owner / procurement manager only)", U("T", f"select save_supplier_product('{oS}','{{\"name\":\"zz\",\"category\":\"Other\",\"availability\":\"Available\"}}'::jsonb)"), "not_allowed")

# ═══ 4. nobody but Vendora reviewers uses the reviewer tools ═══
for who in "BS":
    for fn in ["admin_queue('open')", "admin_ops_stats()", f"admin_claim_check('{chk}')", f"admin_release_check('{chk}')", "admin_release_stale(24)", f"admin_decide('{chk}','verify','',null)"]:
        denied(f"{who} cannot use {fn.split('(')[0]}", U(who, f"select {fn}"), "not_allowed")

# ═══ 5. nobody can flip sides or sneak into the other side ═══
for who, org in [("B", oB), ("S", oS)]:
    denied(f"{who} cannot change their company's kind", U(who, f"update businesses set kind='{'supplier' if who == 'B' else 'buyer'}' where id='{org}'"), "permission denied")
    denied(f"{who} cannot change their account type", U(who, f"update profiles set account_type='{'supplier' if who == 'B' else 'buyer'}' where user_id='{ids[who]}'"), "permission denied")
    denied(f"{who} cannot write memberships directly", U(who, f"insert into memberships(org_id,user_id,role) values ('{org}','{ids['Z']}','owner')"), "permission denied")
    denied(f"{who} cannot promote themselves", U(who, f"update memberships set role='owner' where user_id='{ids[who]}'"), "permission denied")
denied("not even a server tool can change a company's kind", sh(f"update businesses set kind='buyer' where id='{oS}'"), "kind_immutable")
inv = json.loads(U("S", f"select create_invitation('{oS}','z@t.in','employee')")[1])
r = U("Z", f"select accept_invitation('{inv['token']}')")
check("a BUYER account cannot accept an invitation into a SUPPLIER company", "account_type_mismatch" in r[2] or ('"state": "ok"' not in r[1]), r[1] + r[2])
check("...and no membership was created", sh(f"select count(*) from memberships where user_id='{ids['Z']}'")[1] == "0")

# ═══ 6. a verified supplier cannot change who they are (trust passport integrity) ═══
ok("an unverified supplier can still fix their name", U("S", f"update businesses set name='Kaveri Industrial Pvt Ltd' where id='{oS}'"))
sh(f"insert into verification_checks(org_id,type,reference,status,reviewed_at,expires_at) values ('{oS}','registration','29AABCT1332L1Z7','verified',now(),current_date+300)")
check("the supplier now shows as Registered", U("B", f"select get_trust_passport('{oS}')->>'level_name'")[1] == "Registered")
for col, val in [("name", "Tata Steel Limited"), ("gstin", "27AAPFU0939F1ZV"), ("state", "Maharashtra")]:
    denied(f"a verified supplier cannot change {col}", U("S", f"update businesses set {col}='{val}' where id='{oS}'"), "identity_locked")
denied("...not even several fields at once", U("S", f"update businesses set name='Other', website='https://x.in' where id='{oS}'"), "identity_locked")
ok("a verified supplier can still edit other details", U("S", f"update businesses set website='https://kaveri.example', city='Mysuru' where id='{oS}'"))
ok("saving the same name again is harmless", U("S", f"update businesses set name=name where id='{oS}'"))
check("the name and the Registered badge are unchanged", sh(f"select name from businesses where id='{oS}'")[1] == "Kaveri Industrial Pvt Ltd" and U("B", f"select get_trust_passport('{oS}')->>'level_name'")[1] == "Registered")
ok("a buyer owner is not affected by the identity lock", U("B", f"update businesses set name='Buyer Co Ltd', state='Goa' where id='{oB}'"))
ok("a server-side tool (no signed-in user) can correct a verified supplier after a re-check", sh(f"update businesses set name='Kaveri Industrial (corrected)' where id='{oS}'"))
sh(f"update verification_checks set expires_at = current_date - 1 where org_id='{oS}' and status='verified'")
ok("once the proof has expired the supplier can change details again (and must re-verify)", U("S", f"update businesses set state='Karnataka' where id='{oS}'"))

# ═══ 7. the whole database, structurally: new tables and functions cannot slip through ═══
check("every table in public has row level security", sh("select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity")[1] == "0")
check("a visitor who is not signed in has no table access at all", sh("select count(*) from information_schema.table_privileges where grantee='anon' and table_schema='public'")[1] == "0")
check("signed-in users have no TRUNCATE, REFERENCES or TRIGGER on any table", sh("select count(*) from information_schema.table_privileges where grantee='authenticated' and table_schema='public' and privilege_type in ('TRUNCATE','REFERENCES','TRIGGER')")[1] == "0")
denied("a signed-in user cannot truncate a table", U("B", "truncate categories"), "permission denied")
check("a visitor who is not signed in can call only the three invitation / membership helpers",
      sh("select string_agg(p.proname, ',' order by p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f' and has_function_privilege('anon', p.oid, 'execute')")[1] == "has_role,is_member,peek_invitation")
check("every buyer tool table carries the side lock", sh("select count(*) from pg_policies where schemaname='public' and policyname='buyer_side_only' and permissive='RESTRICTIVE'")[1] == str(len(BUYER_TABLES)))
r = run([], """select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
             join pg_attribute a on a.attrelid=c.oid and a.attname='org_id' and not a.attisdropped
             where n.nspname='public' and c.relkind='r'
               and (has_table_privilege('authenticated',c.oid,'insert') or has_table_privilege('authenticated',c.oid,'update') or has_table_privilege('authenticated',c.oid,'delete')) order by 1""")
unclassified = sorted(set(r.stdout.split()) - set(BUYER_TABLES) - set(SHARED_ORG_TABLES))
check("every table the browser can write is a buyer tool (side-locked) or deliberately shared; a new one must be classified here", unclassified == [], f"unclassified: {unclassified}")
r = run([], """select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
             where n.nspname='public' and p.prokind='f' and p.prosecdef and not exists (select 1 from unnest(coalesce(p.proconfig,'{}')) c where c like 'search_path=%')""")
check("every security-definer function pins its search_path", r.stdout.strip() == "", r.stdout)
r = run([], """select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
             where n.nspname='public' and p.prokind='f' and p.proname like '\\_%' and has_function_privilege('authenticated', p.oid, 'execute')
               and p.proname not in ('_is_buyer_org','_can_manage_proofs')""")
check("private helper functions (named _something) are not callable from the browser", r.stdout.strip() == "", r.stdout)

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
