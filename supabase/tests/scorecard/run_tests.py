#!/usr/bin/env python3
"""
Tests for the Supplier Scorecard: a record earned from real orders (migration 21).
Builds a THROWAWAY database `vendora_scorecard_test`, applies every migration, builds order and RFQ history directly
(the tests control the clock), then checks the counts, the spread, the honesty rules (small samples, same-group orders, privacy),
the badges, who may read what, and the public Trust Passport. Never point it at a real project.

    PGHOST=localhost PGUSER=postgres python3 supabase/tests/scorecard/run_tests.py
"""
import glob, json, os, subprocess, sys, uuid
from datetime import date, timedelta
HERE = os.path.dirname(os.path.abspath(__file__))
MIG = os.path.join(HERE, "..", "..", "migrations")
BOOT = os.path.join(HERE, "..", "invite_only", "bootstrap_local_supabase.sql")
DB = "vendora_scorecard_test"
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
sc_mig = [f for f in files if f.endswith("_supplier_scorecard.sql")]
assert sc_mig, "the scorecard migration (21) is missing"
for f in files: apply(f)
apply(sc_mig[0])  # safe to run twice

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

# ── helpers: build real-looking history directly (the tests control the clock) ──
def new_sup(name, days=300):
    o = str(uuid.uuid4())
    sh(f"insert into businesses(id,slug,name,kind) values ('{o}','{name.lower().replace(' ', '-')}','{name}','supplier'); insert into supplier_profiles(org_id) values ('{o}'); insert into supplier_verifications(org_id) values ('{o}')")
    proof(o, "registration", days)
    return o
RFQS = []
for i in range(6):
    rid = str(uuid.uuid4()); RFQS.append(rid)
    sh(f"insert into rfqs(id,org_id,number,title,status,due_date,owner_id) values ('{rid}','{oA}','FR-{i}','t','sent',current_date-5,'{ids['O']}')")
def invite(org, k, status, hrs=None, age=10):
    resp = f"now() - interval '{age} days' + interval '{hrs} hours'" if hrs is not None else "null"
    sh(f"insert into rfq_invites(org_id,rfq_id,supplier_org,status,sent_at,responded_at) values ('{oA}','{RFQS[k]}','{org}','{status}', now() - interval '{age} days', {resp})")
PO_N = [0]
def mk_po(org, status="received", late=0, age=10, expd=3, cancelled_by=None, ack=True):
    PO_N[0] += 1
    exp = f"(current_date - {age} + {expd})"
    dl = f"(({exp} + {late})::timestamp + interval '12 hours') at time zone 'UTC'" if status in ("received", "closed") else "null"
    cb = f"'{cancelled_by}'" if cancelled_by else "null"
    sh(f"insert into purchase_orders(org_id,number,supplier_org,status,issued_at,expected_at,delivered_at,created_by,acknowledged_at,cancelled_by,cancelled_at) "
       f"values ('{oA}','FRP-{PO_N[0]}','{org}','{status}', now() - interval '{age} days', {exp}, {dl}, '{ids['O']}', {'now() - interval ' + repr(str(age - 1) + ' days') if ack else 'null'}, {cb}, {'now()' if cancelled_by else 'null'})")

SC = lambda who, org: J(call(who, "get_supplier_scorecard", q(org)))
N = [0]
def mk(sup, buyer=None, status="received", diff=0, age=20, cancelled_by=None, ack=True):
    """an order issued `age` days ago, promised for age-3 days after issue; delivered `diff` days after the promise"""
    buyer = buyer or oA; N[0] += 1
    owner = {oA: ids["O"], oD: ids["DO"], oX: ids["XO"]}[buyer]
    exp = f"(current_date - {age} + 3)"
    dl = f"(({exp} + {diff})::timestamp + interval '12 hours') at time zone 'UTC'" if status in ("received", "closed") else "null"
    cb = f"'{cancelled_by}'" if cancelled_by else "null"
    sh(f"insert into purchase_orders(org_id,number,supplier_org,status,issued_at,expected_at,delivered_at,created_by,acknowledged_at,cancelled_by,cancelled_at) "
       f"values ('{buyer}','SCP-{N[0]}','{sup}','{status}', now() - interval '{age} days', {exp}, {dl}, '{owner}', "
       f"{('now() - interval ' + repr(str(age - 1) + ' days')) if ack else 'null'}, {cb}, {'now() - interval ' + repr(str(age - 5) + ' days') if cancelled_by else 'null'})")
def quote(sup, hrs, age=10, k=None):
    k = N[0] % 6 if k is None else k; N[0] += 1
    rid = str(uuid.uuid4())
    sh(f"insert into rfqs(id,org_id,number,title,status,due_date,owner_id) values ('{rid}','{oA}','SCR-{N[0]}','t','sent',current_date-5,'{ids['O']}')")
    resp = f"now() - interval '{age} days' + interval '{hrs} hours'" if hrs is not None else "null"
    st = "quoted" if hrs is not None else "sent"
    sh(f"insert into rfq_invites(org_id,rfq_id,supplier_org,status,sent_at,responded_at) values ('{oA}','{rid}','{sup}','{st}', now() - interval '{age} days', {resp})")

# ═══ 1. who may read it ═══
denied("signed out cannot", ANON(f"select public.get_supplier_scorecard('{s1}')"), "permission denied")
ok("a buyer reads a supplier's scorecard", call("O", "get_supplier_scorecard", q(s1)))
ok("an employee of a buyer can too (it is public proof)", call("E", "get_supplier_scorecard", q(s1)))
ok("the supplier reads its own", call("S1", "get_supplier_scorecard", q(s1)))
ok("a member of the supplier reads it", call("S1B", "get_supplier_scorecard", q(s1)))
denied("a supplier cannot read a competitor's", call("S2", "get_supplier_scorecard", q(s1)), "not_allowed")
denied("a suspended member cannot", call("S1S", "get_supplier_scorecard", q(s1)), "not_allowed")
denied("a person with no company cannot", call("Z", "get_supplier_scorecard", q(s1)), "not_allowed")
denied("a buyer company is not a supplier", call("O", "get_supplier_scorecard", q(oA)), "not_found")
denied("a supplier without a profile is not found", call("O", "get_supplier_scorecard", q(s5)), "not_found")
denied("an unknown id is not found", call("O", "get_supplier_scorecard", q(uuid.uuid4())), "not_found")
check("internals cannot be called from the browser", not U("O", f"select public._scorecard_core('{s1}', true)")[0] and not U("O", f"select * from public._scorecard_orders('{s1}')")[0]
      and not ANON("select public._scorecard_rules()")[0])

# ═══ 2. a new supplier: thin looks thin ═══
sN = new_sup("Fresh Fabricators")
a = SC("O", sN)
check("a new supplier is marked new, with zero counts and no percentages", a["is_new"] is True and a["delivery"]["delivered"] == 0 and a["delivery"]["on_time_pct"] is None
      and a["replies"]["median_hours"] is None and a["replies"]["answered_pct"] is None and a["buyers"] == {"different": 0, "repeat": 0}, str(a)[:300])
check("six months are shown, even when empty", len(a["months"]) == 6 and all(m["orders"] == 0 for m in a["months"]) and a["recent"] == [] and a["badges"] == [])
check("the months run oldest to newest and end this month", a["months"][-1]["month"] == date.today().strftime("%Y-%m") and a["months"][0]["month"] < a["months"][-1]["month"])
check("the rules travel with the record", a["rules"]["min_samples"] == 3 and a["window_days"] == 365 and len(a["rules"]["badges"]) == 4)

# ═══ 3. deliveries: the spread, not just an average ═══
s6 = new_sup("Spread Castings")
for d in (-2, 0, 0, 2, 5): mk(s6, diff=d)
a = SC("O", s6)["delivery"]
check("5 delivered: 1 early, 2 exactly on time, 1 two days late, 1 five days late", (a["delivered"], a["early"], a["on_time"], a["late_1_3"], a["late_4_plus"]) == (5, 1, 3, 1, 1), str(a))
check("on-time counts early and exact deliveries", a["on_time_pct"] == 60)
check("the median is days against the promise", a["median_days_vs_promise"] == 0)
s7 = new_sup("Thin Tools")
mk(s7, diff=0); mk(s7, diff=0)
a = SC("O", s7)["delivery"]
check("with only 2 orders the counts show but no percentage does", a["delivered"] == 2 and a["on_time"] == 2 and a["on_time_pct"] is None and a["median_days_vs_promise"] is None, str(a))
mk(s7, diff=1)
check("the percentage appears at 3 orders", SC("O", s7)["delivery"]["on_time_pct"] == 67)

# ═══ 4. walking away is shown ═══
s8 = new_sup("Flaky Fabs")
mk(s8); mk(s8); mk(s8)
mk(s8, status="cancelled", cancelled_by="supplier")
mk(s8, status="cancelled", cancelled_by="supplier", ack=False)   # declined before confirming: not a failure
mk(s8, status="cancelled", cancelled_by="buyer")                # the buyer's choice: not the supplier's record
mk(s8, status="acknowledged", ack=True)                           # still open: not counted yet
a = SC("O", s8)["delivery"]
check("confirmed then cancelled by the supplier is counted and shown", a["cancelled_after_confirming"] == 1 and a["orders_counted"] == 4, str(a))
check("declining before confirming, buyer cancellations and open orders are not held against it", a["delivered"] == 3)
check("it appears in the recent outcomes", any(x["outcome"] == "cancelled" for x in SC("O", s8)["recent"]))

# ═══ 5. the 12-month window ═══
s9 = new_sup("Old Timers")
mk(s9, age=200); mk(s9, age=300); mk(s9, age=364); mk(s9, age=400); mk(s9, age=700)
check("orders up to a year old count; older ones do not (Fair Rank looks at 180 days, the record at 365)", SC("O", s9)["delivery"]["delivered"] == 3)

# ═══ 6. different buyers, and buyers who came back ═══
s10 = new_sup("Loyal Supplies")
for b in (oA, oA, oA, oD, oD, oX): mk(s10, buyer=b)
a = SC("O", s10)["buyers"]
check("6 orders from 3 buyers: 3 different, 2 came back", a == {"different": 3, "repeat": 2}, str(a))
s11 = new_sup("One Client Co")
for _ in range(5): mk(s11, buyer=oA)
check("5 orders from one buyer is one buyer", SC("O", s11)["buyers"] == {"different": 1, "repeat": 1})

# ═══ 7. orders between companies of the same group are not counted ═══
s12 = new_sup("Group Steel")
sh(f"update businesses set gstin='27AAACG1234F1Z5' where id='{s12}'")
sh(f"update businesses set gstin='29AAACG1234F2Z9' where id='{oD}'")   # same PAN (AAACG1234F), different state
sh(f"update businesses set gstin='27BBBBB5555B1Z1' where id='{oX}'")
for b in (oD, oD, oD, oX, oX, oX): mk(s12, buyer=b)
a = SC("O", s12)
check("the group company's orders are left out, and the number left out is disclosed", a["delivery"]["delivered"] == 3 and a["excluded_same_group"] == 3 and a["buyers"]["different"] == 1, str(a)["0:300"] if False else str(a["delivery"]))
check("with no GSTIN on either side nothing is excluded", SC("O", s10)["excluded_same_group"] == 0)
check("a failed order between group companies is left out too", (mk(s12, buyer=oD, status="cancelled", cancelled_by="supplier") or True) and SC("O", s12)["delivery"]["cancelled_after_confirming"] == 0)

# ═══ 8. replies ═══
s13 = new_sup("Quick Quotes")
for h in (1, 2, 3, 30, 50): quote(s13, h)
quote(s13, None, age=20)     # never answered, past the due date: counts against it
a = SC("O", s13)["replies"]
check("5 quotes, 1 ignored: answered share and median hours", a["quoted"] == 5 and a["rfqs_counted"] == 6 and a["answered_pct"] == 83 and a["median_hours"] == 3.0, str(a))
check("share answered within 24 hours", a["within_24h_pct"] == 60)
s14 = new_sup("Two Replies")
quote(s14, 2); quote(s14, 3)
a = SC("O", s14)["replies"]
check("under 3 replies there is no median and no percentage", a["quoted"] == 2 and a["median_hours"] is None and a["answered_pct"] is None and a["within_24h_pct"] is None, str(a))

# ═══ 9. the monthly trend ═══
s15 = new_sup("Trend Metals")
mk(s15, age=5); mk(s15, age=6, diff=3); mk(s15, age=75)
a = SC("O", s15)["months"]
this, prev2 = date.today().strftime("%Y-%m"), (date.today() - timedelta(days=75)).strftime("%Y-%m")
cur = [m for m in a if m["month"] == this][0]; old = [m for m in a if m["month"] == prev2][0]
check("this month's deliveries and on-time count are in this month", cur["orders"] + (1 if this == prev2 else 0) >= 2 and cur["on_time"] >= 1, str(a))
check("an older delivery lands in its own month", old["orders"] >= 1)
check("orders from before the six months are not in the trend", sum(m["orders"] for m in a) == 3)

# ═══ 10. recent outcomes: month and result, nothing else ═══
rec = SC("O", s6)["recent"]
check("recent outcomes carry only the month, the result and the days", all(set(x.keys()) == {"month", "outcome", "days"} for x in rec), str(rec))
check("outcomes are early, on time or late, newest first", sorted({x["outcome"] for x in rec}) == ["early", "late", "on_time"] and [x["month"] for x in rec] == sorted([x["month"] for x in rec], reverse=True))
s16 = new_sup("Many Orders")
for _ in range(9): mk(s16)
check("at most 6 recent outcomes are listed", len(SC("O", s16)["recent"]) == 6)
dump = json.dumps(SC("O", s10)) + json.dumps(SC("S1", s10))
check("no buyer name, id or value appears anywhere in the record", "Alpha" not in dump and "Delta" not in dump and oA not in dump and oD not in dump and "SCP-" not in dump and "amount" not in dump)

# ═══ 11. badges ═══
s17 = new_sup("Star Supplies")
for h in (1, 2, 2, 3, 3): quote(s17, h)
for b in (oA, oA, oD, oD, oX, oX): mk(s17, buyer=b)
for _ in range(4): mk(s17, buyer=oA)
mk(s17, buyer=oA, diff=2)
sh(f"update businesses set gstin='' where id in ('{oD}','{oX}')")  # undo the group trick: those buyers are fine here
b = {x["key"]: x for x in SC("S1B" if False else "O", s17)["badges"]}
check("a buyer sees the badges that were earned", set(b) == {"fast_replies", "on_time_record", "repeat_buyers", "clean_record"}, str(list(b)))
check("a buyer does not see progress numbers", all("have" not in x and "need" not in x for x in b.values()))
b2 = {x["key"]: x for x in SC("O", s16)["badges"]}
check("9 orders is not enough for the 10-order badges", b2 == {} or "on_time_record" not in b2)
s18 = new_sup("Almost There")
for _ in range(8): mk(s18)
mk(s18, diff=3); mk(s18, diff=3)    # 10 orders, 80% on time
check("80% on time is below the 90% bar", "on_time_record" not in {x["key"] for x in SC("O", s18)["badges"]})
s19 = new_sup("Exactly Ninety")
for _ in range(9): mk(s19)
mk(s19, diff=4)
check("exactly 90% of 10 earns the badge", "on_time_record" in {x["key"] for x in SC("O", s19)["badges"]})
check("one cancellation after confirming removes 'never walked away'", "clean_record" not in {x["key"] for x in SC("O", s8)["badges"]}
      and ((mk(s19, status="cancelled", cancelled_by="supplier") or True) and "clean_record" not in {x["key"] for x in SC("O", s19)["badges"]}))
own = {x["key"]: x for x in SC("S1", s18 if False else s1)["badges"]}
check("the supplier sees every badge with its progress, earned or not", len(own) == 4 and all("have" in x and "need" in x and "earned" in x for x in own.values()), str(own))
sc18 = {x["key"]: x for x in J(call("S1", "get_supplier_scorecard", q(s1)))["badges"]}
check("progress is counted from real events", sc18["on_time_record"]["have"] == 0 and sc18["on_time_record"]["need"] == 10)
sh(f"update businesses set gstin='' where id='{s12}'")
slow = new_sup("Slow Replies")
for h in (6, 7, 8, 9, 10): quote(slow, h)
check("slow replies do not earn 'fast replies'", "fast_replies" not in {x["key"] for x in SC("O", slow)["badges"]})
four = new_sup("Four Quotes")
for h in (1, 1, 1, 1): quote(four, h)
check("4 quotes is below the 5-quote bar", "fast_replies" not in {x["key"] for x in SC("O", four)["badges"]})

# ═══ 12. the public Trust Passport carries it ═══
sh(f"update supplier_profiles set passport_public=true where org_id in ('{s17}','{s10}')")
slug = SQL(f"select slug from businesses where id='{s10}'")
pub = J(ANON(f"select public.get_public_passport('{slug}')"))
check("an anonymous visitor sees the scorecard on a shared passport", pub.get("scorecard", {}).get("buyers") == {"different": 3, "repeat": 2}, str(pub)[:200])
check("the public copy has earned badges only, and no progress", all("need" not in x for x in pub["scorecard"]["badges"]))
check("the shared passport leaks no buyer name or id", "Alpha" not in json.dumps(pub) and oA not in json.dumps(pub))
sh(f"update supplier_profiles set passport_public=false where org_id='{s10}'")
denied("a passport that is switched off shows nothing", ANON(f"select public.get_public_passport('{slug}')"), "not_found")
check("the passport's other fields are unchanged", J(ANON(f"select public.get_public_passport('{SQL(f"select slug from businesses where id='{s17}'")}')"))["passport"]["level"] == 1)

# ═══ 13. the rules about reading it ═══
check("the data in the record cannot be changed from the browser", not U("S1", f"update purchase_orders set expected_at = current_date + 90 where supplier_org='{s1}'")[0]
      and not U("S1", f"delete from rfq_invites where supplier_org='{s1}'")[0])
check("the promised date of an issued order is never edited by the app's functions",
      int(SQL("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f' and pg_get_functiondef(p.oid) ilike '%set expected_at%'")) == 0)

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
