#!/usr/bin/env python3
"""
Tests for Fair Rank: earned ranking, no pay-for-rank (migration 18).
Builds a THROWAWAY database `vendora_fairrank_test`, applies every migration, then sends RFQs and attacks the flow:
who may send, which requests may be sent, which suppliers may be invited (verified only, checked at send time), input checks,
numbering, notifications, what suppliers can and cannot see, direct table writes and races.
Never point it at a real project.

    PGHOST=localhost PGUSER=postgres python3 supabase/tests/fairrank/run_tests.py
    (set PSQL_BIN if psql is not on your PATH)
"""
import glob, json, os, subprocess, sys, uuid
from datetime import date, timedelta
HERE = os.path.dirname(os.path.abspath(__file__))
MIG = os.path.join(HERE, "..", "..", "migrations")
BOOT = os.path.join(HERE, "..", "invite_only", "bootstrap_local_supabase.sql")
DB = "vendora_fairrank_test"
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
fr_mig = [f for f in files if f.endswith("_fair_ranking.sql")]
assert fr_mig, "the fair ranking migration (18) is missing"
for f in files: apply(f)
apply(fr_mig[0])  # safe to run twice

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
ROW = lambda org, day="current_date": J(sh(f"select row_to_json(x)::text from _fair_rank_all({day}) x where org_id='{org}'"))
def expected(level_pts, closed, answered, quoted, speed_sum, total, ontime):
    k, pr = 5, 0.5
    resp = 25 * (0.5 * ((answered + k * pr) / (closed + k)) + 0.5 * ((speed_sum + k * pr) / (quoted + k)))
    return round(level_pts + resp + 25 * ((ontime + k * pr) / (total + k)), 1)
near = lambda a, b: a is not None and abs(float(a) - b) <= 0.11
LIST = lambda who, *a: J(call(who, "list_suppliers", *(a or ("''", "''", "''", "false", "50", "0"))))
NAMES = lambda r: [i["name"] for i in r["items"]]

# ═══ 1. the rules are public, in one place, and add up ═══
rules = J(ANON("select public.get_fair_rank_rules()"))
check("anyone can read the formula", rules.get("version") == 1, str(rules)[:120])
check("the weights add up to 100: trust 50 + response 25 + delivery 25", rules["trust"]["max"] + rules["response"]["max"] + rules["delivery"]["max"] == rules["max"] == 100)
check("a level 3 supplier earns the full trust points and an unverified one none", rules["trust"]["by_level"]["3"] == 50 and rules["trust"]["by_level"]["0"] == 0)
check("the internal ranking cannot be called from the browser", not ANON("select * from public._fair_rank_all()")[0] and not U("O", "select * from public._fair_rank_all()")[0])

# ═══ 2. who the test suppliers are ═══
cNew = new_sup("Cee Newcomer"); gOld = new_sup("Gee Oldtimer"); aTop = new_sup("Aye Reliable"); bSlow = new_sup("Bee Slowlate")
dIgn = new_sup("Dee Ignorer"); eDec = new_sup("Eee Decliner"); fCan = new_sup("Eff Canceller"); hFew = new_sup("Aitch Fewdata"); uUnv = new_sup("Uuu Lapsed Star", days=-1)
for k in range(6):
    invite(aTop, k, "quoted", 2); invite(bSlow, k, "quoted", 100); invite(dIgn, k, "sent"); invite(eDec, k, "declined", 1)
    invite(gOld, k, "quoted", 1, age=200); invite(uUnv, k, "quoted", 1)
for k in range(2): invite(hFew, k, "quoted", 3)
for _ in range(5): mk_po(aTop, late=-1); mk_po(bSlow, late=4)
for _ in range(5): mk_po(gOld, late=-1, age=200); mk_po(uUnv, late=-1)
for _ in range(4): mk_po(fCan, status="cancelled", cancelled_by="supplier", ack=True)
mk_po(fCan, status="cancelled", cancelled_by="supplier", ack=False)   # declined before confirming: not a failure
for _ in range(2): mk_po(hFew, late=0)

# ═══ 3. the score is earned from real evidence, nothing else ═══
r = ROW(cNew)
check("a newcomer gets the neutral middle, not zero (55 = trust 30 + 12.5 + 12.5)", near(r["score"], 55.0) and r["is_new"] is True and near(r["response_pts"], 12.5) and near(r["delivery_pts"], 12.5), str(r))
r = ROW(aTop)
check("fast answers and on-time deliveries earn a high score", near(r["score"], expected(30, 6, 6, 6, 6, 5, 5)) and r["is_new"] is False and r["quoted"] == 6 and r["orders_n"] == 5 and r["on_time"] == 5, str(r))
check("a median reply time is measured from real timestamps", near(r["median_hours"], 2.0), str(r))
r = ROW(bSlow)
check("slow answers and late deliveries score low", near(r["score"], expected(30, 6, 6, 6, 6 * 0.25, 5, 0)) and r["on_time"] == 0, str(r))
check("a proven-bad supplier ranks below a newcomer: trust alone does not buy a place", ROW(bSlow)["score"] < ROW(cNew)["score"] < ROW(aTop)["score"])
r = ROW(dIgn)
check("ignoring RFQs until the due date counts against a supplier", r["closed"] == 6 and r["answered"] == 0 and near(r["score"], expected(30, 6, 0, 0, 0, 0, 0)), str(r))
r = ROW(eDec)
check("declining honestly counts as answering, but earns no speed points", r["answered"] == 6 and r["quoted"] == 0 and near(r["score"], expected(30, 6, 6, 0, 0, 0, 0)), str(r))
check("declining everything fast cannot beat answering with real quotes", ROW(eDec)["score"] < ROW(aTop)["score"])
r = ROW(fCan)
check("confirming then cancelling is a missed delivery; declining before confirming is not", r["orders_n"] == 4 and r["on_time"] == 0 and near(r["delivery_pts"], 25 * 2.5 / 9), str(r))
r = ROW(gOld)
check("history older than 180 days is ignored (same as a newcomer)", r["is_new"] is True and near(r["score"], 55.0), str(r))
r = ROW(uUnv)
check("without a valid proof a supplier is not ranked at all, whatever its record", r["ranked"] is False and r["score"] is None and r["level"] == 0 and r["bucket"] == -1, str(r))
check("a level 2 supplier starts higher than a level 1 supplier with the same (empty) record", near(ROW(s2)["score"], 42 + 25), str(ROW(s2)))
check("a lapsed or unverified supplier has no score", ROW(s3)["score"] is None and ROW(s4)["score"] is None)

# ═══ 4. what buyers see ═══
lst = LIST("O"); nm = NAMES(lst)
ix = lambda n: nm.index(n)
check("the directory is in fair order: reliable, then newcomer, then proven-late", ix("Aye Reliable") < ix("Cee Newcomer") < ix("Bee Slowlate"), str(nm))
verified_names = [i["name"] for i in lst["items"] if i["level"] >= 1]
check("unverified suppliers are listed after every verified one", all(nm.index(i["name"]) > max(nm.index(v) for v in verified_names) for i in lst["items"] if i["level"] == 0), str(nm))
a = next(i for i in lst["items"] if i["name"] == "Aye Reliable"); b = next(i for i in lst["items"] if i["name"] == "Bee Slowlate")
check("cards carry the evidence: reply time, answered share, on-time share and the counts", a["reply_hours"] == 2 and a["answered_pct"] == 100 and a["on_time_pct"] == 100 and a["rfqs_counted"] == 6 and a["orders_counted"] == 5 and near(a["fair_score"], expected(30, 6, 6, 6, 6, 5, 5)), str(a))
check("a late supplier's card says so honestly", b["on_time_pct"] == 0 and b["reply_hours"] == 100, str(b))
h = next(i for i in lst["items"] if i["name"] == "Aitch Fewdata")
check("nothing is shown as a statistic until there are 3 real data points", h["reply_hours"] is None and h["answered_pct"] is None and h["on_time_pct"] is None and h["rfqs_counted"] == 2 and h["orders_counted"] == 2, str(h))
c = next(i for i in lst["items"] if i["name"] == "Cee Newcomer")
check("a newcomer is labelled new, not scored as bad", c["is_new"] is True and c["fair_score"] is not None)
check("the cards never include the internal sort keys", all(not ({"bucket", "tie_key", "ranked", "ord"} & set(i.keys())) for i in lst["items"]))
check("everyone sees the same order: another buyer gets exactly the same list", NAMES(LIST("XO")) == nm, str(NAMES(LIST("XO"))))
check("the order does not depend on who is asking inside a company either", NAMES(LIST("E")) == nm)
check("paging never repeats or skips a supplier", sum([NAMES(LIST("O", "''", "''", "''", "false", "4", str(o))) for o in range(0, len(nm), 4)], []) == nm)
check("the total counts every supplier", lst["total"] == len(nm))
nsort = NAMES(LIST("O", "''", "''", "''", "false", "50", "0", "'name'"))
check("the plain A-to-Z order is still available, verified first", [n for n in nsort if n in ("Aye Reliable", "Bee Slowlate", "Cee Newcomer")] == ["Aye Reliable", "Bee Slowlate", "Cee Newcomer"] and nsort.index("Uuu Lapsed Star") > nsort.index("Eff Canceller"), str(nsort))
denied("an unknown sort is refused", call("O", "list_suppliers", "''", "''", "''", "false", "10", "0", "'paid'"), "invalid_sort")
denied("a supplier cannot browse competitors", call("S1", "list_suppliers"), "not_allowed")
denied("signed out cannot list", ANON("select public.list_suppliers()"), "permission denied")
check("there is exactly one list_suppliers (no confusing duplicate)", SQL("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='list_suppliers'") == "1")
check("filters still work: verified only hides the unverified", "Uuu Lapsed Star" not in NAMES(LIST("O", "''", "''", "''", "true", "50", "0")))
check("search still works and treats wildcards as plain text", NAMES(LIST("O", "'Reliable'", "''", "''", "false", "50", "0")) == ["Aye Reliable"] and LIST("O", "'%'", "''", "''", "false", "50", "0")["total"] == 0)

# ═══ 5. equals take turns, and the order is steady within a day ═══
eq = [cNew, gOld, s1]
day = lambda i: f"(current_date + {i})"
def order_on(i):
    return sh(f"select string_agg(org_id::text, ',' order by bucket desc, tie_key, org_id) from _fair_rank_all({day(i)}) where org_id in ({','.join(repr(x) for x in eq)})")[1]
orders = [order_on(i) for i in range(1, 11)]
check("suppliers with equal scores take turns: the order changes from day to day", len(set(orders)) > 1, str(len(set(orders))))
check("the same day always gives the same order", order_on(3) == order_on(3))
check("equal-scored newcomers really are tied (same bucket)", len({ROW(x)["bucket"] for x in eq}) == 1)

# ═══ 6. it can never be bought: the ranking reads only earned facts ═══
src = subprocess.run([PSQL, "-q", "-At", "-d", DB, "-c", "select pg_get_functiondef('public._fair_rank_all(date)'::regprocedure)"], capture_output=True, text=True).stdout
import re
refs = set(re.findall(r"public\.([a-z_]+)", src))
allowed = {"_fair_rank_all", "businesses", "supplier_profiles", "rfq_invites", "rfqs", "purchase_orders", "get_fair_rank_rules", "_trust_level"}
check("the ranking reads only businesses, profiles, RFQ invitations, RFQs, orders and the Trust Passport", refs <= allowed and {"rfq_invites", "purchase_orders", "_trust_level"} <= refs, str(sorted(refs - allowed)))
money = SQL("select count(*) from information_schema.columns where table_schema='public' and column_name ~* '(sponsor|promot|boost|premium|featured|advert|bid_|lead_credit|paid_placement)'")
check("no table has a column for paid placement, sponsoring, boosting or lead credits", money == "0", money)
check("no table is called ads, sponsors, leads or credits", SQL("select count(*) from information_schema.tables where table_schema='public' and table_name ~* '(^ads?$|sponsor|promot|boost|lead|credit)'") == "0")

# ═══ 7. what a supplier sees about itself ═══
mine = J(call("S1", "get_my_fair_rank", q(s1)))
check("a supplier sees its own breakdown", mine.get("ranked") is True and mine["trust"]["max"] == 50 and mine["response"]["max"] == 25 and mine["delivery"]["max"] == 25 and mine["level"] == 1, str(mine)[:200])
check("the parts add up to the score", near(float(mine["trust"]["points"]) + float(mine["response"]["points"]) + float(mine["delivery"]["points"]), float(mine["score"])) or abs(float(mine["trust"]["points"]) + float(mine["response"]["points"]) + float(mine["delivery"]["points"]) - float(mine["score"])) <= 0.2)
check("it says how many verified suppliers there are and how far ahead it is, without naming anyone", mine["verified_suppliers"] >= 8 and 0 <= mine["ahead_of_pct"] <= 100 and "rules" in mine)
check("an employee of the supplier can read it too", J(call("S1B", "get_my_fair_rank", q(s1))).get("score") == mine["score"])
denied("a suspended member cannot", call("S1S", "get_my_fair_rank", q(s1)), "not_allowed")
denied("another supplier cannot read a competitor's breakdown", call("S2", "get_my_fair_rank", q(s1)), "not_allowed")
denied("a buyer cannot", call("O", "get_my_fair_rank", q(s1)), "not_allowed")
denied("someone with no company cannot", call("Z", "get_my_fair_rank", q(s1)), "not_allowed")
denied("signed out cannot", ANON(f"select public.get_my_fair_rank('{s1}')"), "permission denied")
un = J(call("S3", "get_my_fair_rank", q(s3)))
check("an unverified supplier is told it is not ranked yet", un["ranked"] is False and un["score"] is None and un["ahead_of_pct"] is None and un["level"] == 0, str(un)[:160])

# ═══ 8. what a buyer sees about one supplier ═══
rec = J(call("O", "get_supplier_record", q(aTop)))
check("a buyer can open one supplier's record", rec["on_time_pct"] == 100 and rec["reply_hours"] == 2 and rec["window_days"] == 180 and rec["orders_counted"] == 5, str(rec))
denied("a supplier cannot read another company's record", call("S1", "get_supplier_record", q(aTop)), "not_allowed")
denied("a made-up company is not found", call("O", "get_supplier_record", q(str(uuid.uuid4()))), "not_found")
denied("a buyer company id is not a supplier", call("O", "get_supplier_record", q(oA)), "not_found")
denied("signed out cannot", ANON(f"select public.get_supplier_record('{aTop}')"), "permission denied")

# ═══ 9. the buyer records the delivery (the supplier cannot mark its own homework) ═══
def mk_ack_po(status="acknowledged", expd=5, issued_days=3):
    PO_N[0] += 1
    pid = str(uuid.uuid4())
    sh(f"insert into purchase_orders(id,org_id,number,supplier_org,status,issued_at,expected_at,created_by,acknowledged_at,title) values ('{pid}','{oA}','FRR-{PO_N[0]}','{s1}','{status}', now() - interval '{issued_days} days', current_date + {expd}, '{ids['O']}', now(), 'Valves')")
    return pid
REC = lambda who, pid, d="null": call(who, "receive_purchase_order", q(pid), d)
GET = lambda who, pid: J(call(who, "get_purchase_order", q(pid)))
before = ROW(s1)["orders_n"]
p1 = mk_ack_po()
check("the buyer's order page offers 'record delivery' only to those who may", GET("P", p1)["can_receive"] is True and GET("O", p1)["can_receive"] is True and GET("E", p1)["can_receive"] is False)
for who in ("E", "F", "AP"): denied(f"{who} cannot record a delivery", REC(who, p1), "not_allowed")
for who in ("XO", "S1", "Z", "SU"): denied(f"{who} cannot see or record it", REC(who, p1), "not_found")
denied("signed out cannot", ANON(f"select public.receive_purchase_order('{p1}')"), "permission denied")
denied("an order the supplier has not confirmed cannot be received", REC("O", mk_ack_po("issued")), "not_receivable")
denied("a delivery in the future is refused", REC("O", p1, f"current_date + 1"), "invalid_date")
denied("a delivery before the order was issued is refused", REC("O", p1, "current_date - 10"), "invalid_date")
denied("a made-up order is not found", REC("O", str(uuid.uuid4())), "not_found")
r1 = REC("P", p1, "current_date - 1")
ok("a procurement manager records an on-time delivery", r1)
check("it is on time when delivered on or before the promised date", J(r1)["on_time"] is True and J(r1)["status"] == "received", str(r1[1]))
denied("it cannot be received twice", REC("O", p1), "not_receivable")
g = GET("O", p1)
check("the order now shows the delivery date and offers no further action", g["po"]["delivered_at"] is not None and g["can_receive"] is False and g["can_cancel"] is False, str(g["po"])[:200])
check("the delivery is audited without private details", SQL(f"select count(*) from audit_log where entity_id='{p1}' and action='po_goods_received'") == "2")
check("the supplier is told", int(SQL(f"select count(*) from notifications where org_id='{s1}' and link_to='orders/{p1}' and title like '% recorded delivery of an order'")) >= 1)
check("the delivery counts towards the supplier's record", ROW(s1)["orders_n"] == before + 1 and ROW(s1)["on_time"] >= 1)
p2 = mk_ack_po(expd=-1, issued_days=5)
ok("a late delivery is recorded too", REC("O", p2))
check("a late delivery is on the record as late", ROW(s1)["orders_n"] == before + 2 and ROW(s1)["on_time"] == 1, str(ROW(s1)))
denied("the supplier cannot set a delivery date on its own order", sh(f"update purchase_orders set delivered_at = now() where id = '{p2}'", "authenticated", ids["S1"]), "permission denied")
denied("a buyer cannot change an order directly either", sh(f"update purchase_orders set status = 'received' where id = '{mk_ack_po()}'", "authenticated", ids["O"]), "permission denied")

# ═══ 10. safe to run twice ═══
before_score = ROW(aTop)["score"]
apply(fr_mig[0])
check("running migration 18 again changes nothing", ROW(aTop)["score"] == before_score and NAMES(LIST("O")) == nm)
print(f"{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
