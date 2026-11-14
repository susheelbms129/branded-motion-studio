#!/usr/bin/env python3
"""
Tests for the shareable public Trust Passport (migration 17).
Builds a THROWAWAY database `vendora_passport_test`, applies every migration, then sends RFQs and attacks the flow:
who may send, which requests may be sent, which suppliers may be invited (verified only, checked at send time), input checks,
numbering, notifications, what suppliers can and cannot see, direct table writes and races.
Never point it at a real project.

    PGHOST=localhost PGUSER=postgres python3 supabase/tests/passport/run_tests.py
    (set PSQL_BIN if psql is not on your PATH)
"""
import glob, json, os, subprocess, sys, uuid
from datetime import date, timedelta
HERE = os.path.dirname(os.path.abspath(__file__))
MIG = os.path.join(HERE, "..", "..", "migrations")
BOOT = os.path.join(HERE, "..", "invite_only", "bootstrap_local_supabase.sql")
DB = "vendora_passport_test"
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
pp_mig = [f for f in files if f.endswith("_public_passport.sql")]
assert pp_mig, "the public passport migration (17) is missing"
for f in files: apply(f)
apply(pp_mig[0])  # safe to run twice

# ── people ──  Buyer A: O owner, P procurement, F finance, AP approver, E employee, SU suspended procurement manager
#              Buyer D: DO solo owner.  X: stranger buyer owner.  Z: no company.
#              Suppliers: S1 (owner S1 + member S1B + suspended S1S), S2 (level 2), S3 (unverified), S4 (proof expired), S5 (no profile)
names = "O P F AP E SU DO XO Z S1 S1B S1S S2 S3 S4 S5".split()
ids = {k: str(uuid.uuid4()) for k in names}
for k in names:
    sh(f"insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values ('{ids[k]}','{k.lower()}@t.in',now(),'{json.dumps({'name': k + ' Person'})}')")
oA, oD, oX, s1, s2, s3, s4, s5 = (str(uuid.uuid4()) for _ in range(8))
for o, n, kind in [(oA, "Alpha Mills", "buyer"), (oD, "Delta Mills", "buyer"), (oX, "Xeno Foods", "buyer"), (s1, "Kaveri Industrial", "supplier"),
                   (s2, "Bharat Steels", "supplier"), (s3, "Newbie Traders", "supplier"), (s4, "Lapsed Metals", "supplier"), (s5, "Unfinished Co", "supplier")]:
    sh(f"insert into businesses(id,slug,name,kind) values ('{o}','{n.lower().replace(' ', '-')}','{n}','{kind}')")
    if kind == "supplier" and o != s5: sh(f"insert into supplier_profiles(org_id) values ('{o}'); insert into supplier_verifications(org_id) values ('{o}')")
# supplier accounts may only join supplier companies (a database guard), so mark them before they join
sh("update profiles set account_type='supplier' where user_id in (" + ",".join(f"'{ids[k]}'" for k in "S1 S1B S1S S2 S3 S4 S5".split()) + ")")
for k, o, role, st in [("O", oA, "owner", "active"), ("P", oA, "procurement_manager", "active"), ("F", oA, "finance_manager", "active"),
                       ("AP", oA, "approver", "active"), ("E", oA, "employee", "active"), ("SU", oA, "procurement_manager", "suspended"),
                       ("DO", oD, "owner", "active"), ("XO", oX, "owner", "active"), ("S1", s1, "owner", "active"), ("S1B", s1, "employee", "active"),
                       ("S1S", s1, "employee", "suspended"), ("S2", s2, "owner", "active"), ("S3", s3, "owner", "active"),
                       ("S4", s4, "owner", "active"), ("S5", s5, "owner", "active")]:
    ok(f"(setup) {k} joins", sh(f"insert into memberships(org_id,user_id,role,status) values ('{o}','{ids[k]}','{role}','{st}')"))
# trust: S1 registered (level 1), S2 registered + address + bank (level 2), S3 nothing, S4 a registration proof that has expired
def proof(org, typ, days):
    sh(f"insert into verification_checks(org_id,type,reference,status,reviewed_at,expires_at) values ('{org}','{typ}','ref-{typ}-{org[:8]}','verified',now(),current_date+({days}))")
proof(s1, "registration", 300)
for t in ("registration", "address", "bank"): proof(s2, t, 300)
sh(f"insert into verification_checks(org_id,type,reference,status,reviewed_at,expires_at) values ('{s4}','registration','ref-{s4[:8]}','verified',now(),current_date-1)")
sh(f"insert into verification_checks(org_id,type,reference,status) values ('{s3}','registration','ref-{s3[:8]}','in_review')")

U = lambda k, sql: sh(sql, "authenticated", ids[k])
ANON = lambda sql: sh(sql, "anon")
def call(who, fn, *args): return U(who, f"select {fn}({', '.join(args)})")
def J(res):
    try: return json.loads(res[1])
    except Exception: return {}
def q(s): return "'" + str(s).replace("'", "''") + "'"
def jb(d): return "$j$" + json.dumps(d) + "$j$::jsonb"
SQL = lambda sql: sh(sql)[1]
NEEDED = (date.today() + timedelta(days=14)).isoformat()
DUE = (date.today() + timedelta(days=10)).isoformat()
yr = date.today().year

def req(**kw):
    d = {"title": "MS plates for line 3", "department": "Production", "category": "Raw material", "justification": "Needed for the new fabrication line.",
         "priority": "medium", "neededBy": NEEDED,
         "items": [{"description": "MS plate 10mm", "qty": 10, "unit": "Sheet", "unitPrice": 1500}, {"description": "Welding rod", "qty": 25.5, "unit": "Kg", "unitPrice": 210.5}]}
    d.update(kw); return d
def approved(org=oA, maker="E", **kw):
    """a request raised by an employee and approved by the approver"""
    r = J(call(maker, "create_request", q(org), jb(req(**kw)), "true"))
    if org == oA: ok("(setup) approval", call("AP", "decide_request", q(r["id"]), "'approved'", "''"))
    return r["id"]
def data(sup=None, due=DUE, **kw):
    d = {"supplierIds": sup if sup is not None else [s1, s2], "dueDate": due}
    d.update(kw); return d
def send(who, rid, d): return call(who, "send_rfq", q(rid), jb(d))

PUB = lambda slug: ANON(f"select public.get_public_passport({q(slug)})")
SH = lambda who, org: call(who, "get_passport_sharing", q(org))
SET = lambda who, org, on: call(who, "set_passport_sharing", q(org), "true" if on else "false")

# 1. nothing is public until the owner switches it on
for slug, label in [("kaveri-industrial", "S1 (verified, not shared)"), ("bharat-steels", "S2"), ("newbie-traders", "S3"), ("alpha-mills", "a buyer company"),
                    ("unfinished-co", "a supplier with no profile"), ("no-such-company", "a made-up company"), ("KAVERI INDUSTRIAL", "a malformed slug"), ("", "an empty slug")]:
    denied(f"{label} is not found", PUB(slug), "not_found")
denied("null slug", ANON("select public.get_public_passport(null)"), "not_found")
check("sharing defaults to off", J(SH("S1", s1)).get("enabled") is False and J(SH("S1", s1)).get("slug") == "kaveri-industrial")

# 2. who may switch it
denied("a supplier employee cannot switch it on", SET("S1B", s1, True), "not_allowed")
denied("a suspended member cannot", SET("S1S", s1, True), "not_allowed")
denied("a buyer cannot", SET("O", s1, True), "not_allowed")
denied("another supplier cannot switch on someone else's", SET("S2", s1, True), "not_allowed")
denied("someone with no company cannot", SET("Z", s1, True), "not_allowed")
denied("signed out cannot", ANON(f"select public.set_passport_sharing('{s1}', true)"), "permission denied")
denied("signed out cannot read the setting", ANON(f"select public.get_passport_sharing('{s1}')"), "permission denied")
check("a supplier employee can read the setting but not change it", J(SH("S1B", s1)).get("can_change") is False and J(SH("S1", s1)).get("can_change") is True)
denied("a buyer cannot read a supplier's setting", SH("O", s1), "not_allowed")
denied("an unverified supplier cannot switch it on", SET("S3", s3, True), "not_verified")
denied("an expired-proof supplier cannot switch it on", SET("S4", s4, True), "not_verified")
denied("a null value is refused", call("S1", "set_passport_sharing", q(s1), "null"), "invalid_request")
check("nothing became public after the refusals", SQL("select count(*) from supplier_profiles where passport_public") == "0")
denied("a buyer company id is not a supplier", SET("O", oA, True), "not_allowed")

# 3. switched on: what the world sees
SQL(f"update supplier_profiles set email='secret@kaveri.in', phone='9876543210', contact_name='Secret Person', description='We make industrial valves.', categories=array['Valves'] where org_id='{s1}'")
SQL(f"update businesses set city='Pune', state='Maharashtra' where id='{s1}'")
ok("the owner switches it on", SET("S1", s1, True))
pub = PUB("kaveri-industrial"); ok("anyone can open it without signing in", pub); p = J(pub)
check("it shows name, place, description, categories and today's date", p.get("name") == "Kaveri Industrial" and p.get("city") == "Pune" and p.get("description") == "We make industrial valves." and p.get("categories") == ["Valves"] and p.get("as_of") == date.today().isoformat(), str(p)[:200])
check("it shows level 1 with the registration proof", p["passport"]["level"] == 1 and [c["type"] for c in p["passport"]["checks"]] == ["registration"])
raw = pub[1]
for secret in ("secret@kaveri.in", "9876543210", "Secret Person"): check(f"the page never contains {secret}", secret not in raw)
check("only the expected keys are public", set(p.keys()) == {"slug", "name", "city", "state", "country", "business_type", "year_established", "description", "logo", "categories", "as_of", "passport"}, str(sorted(p.keys())))
check("lookups are case and space insensitive", J(PUB("  Kaveri-Industrial ")).get("name") == "Kaveri Industrial")
buyer_view = J(call("O", "get_trust_passport", q(s1)))
check("the public passport equals what buyers see (same maths)", p["passport"] == buyer_view, f"{p['passport']} vs {buyer_view}")
check("a signed-in user can open it too", J(U("O", "select public.get_public_passport('kaveri-industrial')")).get("name") == "Kaveri Industrial")
denied("S2 (not switched on) is still hidden", PUB("bharat-steels"), "not_found")
check("the switch is audited", SQL(f"select count(*) from audit_log where org_id='{s1}' and action='passport_shared'") == "1")

# 4. the link always tells today's truth
SQL(f"update verification_checks set expires_at=current_date-1 where org_id='{s1}' and type='registration'")
lapsed = J(PUB("kaveri-industrial"))
check("when the proof lapses the same link shows Not verified", lapsed["passport"]["level"] == 0 and lapsed["passport"]["checks"] == [] and lapsed["passport"]["level_name"] == "Not verified", str(lapsed)[:200])
SQL(f"update verification_checks set expires_at=current_date+300 where org_id='{s1}' and type='registration'")
check("when it is renewed the link shows it again", J(PUB("kaveri-industrial"))["passport"]["level"] == 1)

# 5. switching off, and the other suppliers
ok("the owner switches it off", SET("S1", s1, False))
denied("the page is gone at once", PUB("kaveri-industrial"), "not_found")
check("the switch-off is audited", SQL(f"select count(*) from audit_log where org_id='{s1}' and action='passport_unshared'") == "1")
ok("a level 2 supplier switches it on", SET("S2", s2, True))
check("it shows three proofs", len(J(PUB("bharat-steels"))["passport"]["checks"]) == 3 and J(PUB("bharat-steels"))["passport"]["level"] == 2)
ok("switching on twice is harmless", SET("S2", s2, True))
check("the public cannot read supplier_profiles directly", not ANON("select * from supplier_profiles")[0])
check("the public cannot call the internal helper", not ANON(f"select public._passport_core('{s2}')")[0])
apply(pp_mig[0])
check("running migration 17 again keeps the setting", J(PUB("bharat-steels")).get("name") == "Bharat Steels")
print(f"{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
