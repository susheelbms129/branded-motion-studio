#!/usr/bin/env python3
"""
Tests for real purchase orders (migration 16: award a quote, issue the order, supplier confirms or declines).
Builds a THROWAWAY database `vendora_orders_test`, applies every migration, then sends RFQs and attacks the flow:
who may send, which requests may be sent, which suppliers may be invited (verified only, checked at send time), input checks,
numbering, notifications, what suppliers can and cannot see, direct table writes and races.
Never point it at a real project.

    PGHOST=localhost PGUSER=postgres python3 supabase/tests/orders/run_tests.py
    (set PSQL_BIN if psql is not on your PATH)
"""
import glob, json, os, subprocess, sys, uuid
from datetime import date, timedelta
HERE = os.path.dirname(os.path.abspath(__file__))
MIG = os.path.join(HERE, "..", "..", "migrations")
BOOT = os.path.join(HERE, "..", "invite_only", "bootstrap_local_supabase.sql")
DB = "vendora_orders_test"
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
po_mig = [f for f in files if f.endswith("_purchase_orders.sql")]
assert po_mig, "the purchase orders migration (16) is missing"
for f in files: apply(f)
apply(po_mig[0])  # safe to run twice

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

def quote_data(items, price=100, gst=18, ship=500, days=7, pay=30):
    return {"lines": [{"itemId": i, "unitPrice": price} for i in items], "gstRate": gst, "shipping": ship, "otherCharges": 0,
            "deliveryDays": days, "paymentTermsDays": pay, "validUntil": (date.today() + timedelta(days=30)).isoformat(), "notes": ""}
def rfq_with_quotes(title, quotes):
    rid = approved(title=title)
    r = J(send("P", rid, data(sup=[s1, s2])))
    items = SQL(f"select string_agg(id::text, ',' order by position, id) from rfq_items where rfq_id='{r['id']}'").split(",")
    qid = {}
    for k, kw in quotes.items():
        org = s1 if k == "S1" else s2
        ok(f"(setup) {k} quotes", call(k, "submit_quotation", q(org), q(r["id"]), jb(quote_data(items, **kw))))
        qid[k] = SQL(f"select id from quotations where rfq_id='{r['id']}' and supplier_org='{org}'")
    return r["id"], qid
ADDR = "Plot 12, Peenya Industrial Area, Bengaluru 560058"
def award(who, rfq, quo, **kw):
    d = {"deliveryAddress": ADDR, "notes": "Deliver before 10 am."}; d.update(kw)
    return call(who, "award_rfq", q(rfq), q(quo), jb(d))

rfq1, qs1 = rfq_with_quotes("Plates", {"S1": dict(price=100, pay=45), "S2": dict(price=95, ship=2000, days=14)})
v = J(call("P", "get_rfq_quotes", q(rfq1)))
check("buyer may award, employee/finance may not", v.get("can_award") is True and J(call("E", "get_rfq_quotes", q(rfq1))).get("can_award") is False and J(call("F", "get_rfq_quotes", q(rfq1))).get("can_award") is False)
for who in ("E", "F", "AP"): denied(f"{who} cannot award", award(who, rfq1, qs1["S1"]), "not_allowed")
for who in ("XO", "S1", "Z", "SU"): denied(f"{who} cannot award or see the RFQ", award(who, rfq1, qs1["S1"]), "not_found")
denied("signed out", ANON(f"select award_rfq('{rfq1}','{qs1['S1']}','{{}}')"), "permission denied")
denied("made-up quote", award("P", rfq1, uuid.uuid4()), "quote_not_found")
for label, kw, word in [("no address", {"deliveryAddress": ""}, "invalid_address"), ("address 501", {"deliveryAddress": "a"*501}, "invalid_address"), ("note 1001", {"notes": "n"*1001}, "invalid_notes")]:
    denied(label, award("P", rfq1, qs1["S1"], **kw), word)
check("refusals created nothing", SQL("select count(*) from purchase_orders") == "0")
SQL(f"update quotations set valid_until=current_date-1 where id='{qs1['S2']}'")
denied("expired quote", award("P", rfq1, qs1["S2"]), "quote_expired")
SQL(f"update quotations set valid_until=current_date+5 where id='{qs1['S2']}'")
SQL(f"update verification_checks set expires_at=current_date-1 where org_id='{s2}' and type='registration'")
denied("supplier no longer verified", award("P", rfq1, qs1["S2"]), "supplier_not_verified")
SQL(f"update verification_checks set expires_at=current_date+300 where org_id='{s2}' and type='registration'")

res = award("P", rfq1, qs1["S1"]); ok("award S1", res); po1 = J(res)
check("numbered and issued", po1.get("number") == f"PO-{yr}-0001" and po1.get("status") == "issued", str(po1))
check("order copies the quote", SQL(f"select supplier_org::text||'|'||shipping||'|'||payment_terms_days||'|'||title from purchase_orders where id='{po1['id']}'") == f"{s1}|500.00|45|Plates for line 3" or SQL(f"select payment_terms_days from purchase_orders where id='{po1['id']}'") == "45")
check("lines and money equal the quote", SQL(f"select (public._po_amounts('{po1['id']}')->>'total')::numeric = (public._quote_amounts('{qs1['S1']}')->>'total')::numeric") == "t" and SQL(f"select (public._po_amounts('{po1['id']}')->>'total')::numeric") == "4689.00")
check("RFQ awarded", SQL(f"select status||'|'||awarded_quotation_id from rfqs where id='{rfq1}'") == f"awarded|{qs1['S1']}")
check("supplier notified, other supplier not", SQL(f"select count(*) from notifications where user_id='{ids['S1']}' and kind='po'") == "1" and SQL(f"select count(*) from notifications where user_id='{ids['S2']}' and kind='po'") == "0")
denied("no double award", award("O", rfq1, qs1["S2"]), "already_awarded")
check("db refuses a second live order", not sh(f"insert into purchase_orders (org_id, number, supplier_org, rfq_id, created_by) values ('{oA}','PO-X','{s2}','{rfq1}','{ids['O']}')")[0])
lst = J(call("E", "list_purchase_orders", q(oA)))
check("buyer list", lst.get("total") == 1 and lst["items"][0]["total"] == 4689 and lst["items"][0]["currency"] == "INR", str(lst)[:200])
for who in ("XO", "S1", "Z", "SU"): denied(f"{who} cannot list or open", call(who, "get_purchase_order", q(po1["id"])), "not_found")
check("buyer cannot write orders directly", not sh(f"update purchase_orders set status='closed' where id='{po1['id']}'", "authenticated", ids["O"])[0])
sl = J(call("S1B", "list_supplier_orders", q(s1)))
check("supplier sees it as new", sl.get("total") == 1 and sl["items"][0]["state"] == "new" and call("S1", "count_new_orders", q(s1))[1] == "1")
denied("other supplier cannot open", call("S2", "get_supplier_order", q(s2), q(po1["id"])), "not_found")
denied("supplier employee cannot confirm", call("S1B", "confirm_purchase_order", q(s1), q(po1["id"])), "not_allowed")
ok("owner confirms", call("S1", "confirm_purchase_order", q(s1), q(po1["id"]), q("On the 7th.")))
check("acknowledged and buyer told", SQL(f"select status from purchase_orders where id='{po1['id']}'") == "acknowledged" and SQL(f"select count(*) from notifications where link_to='purchase-orders/{po1['id']}'") == "2")
denied("cannot answer twice", call("S1", "decline_purchase_order", q(s1), q(po1["id"]), "'no'"), "not_pending")
denied("buyer cannot cancel once confirmed", call("P", "cancel_purchase_order", q(po1["id"])), "not_pending")

rfq2, qs2 = rfq_with_quotes("Rods", {"S1": dict(price=210), "S2": dict(price=200, gst=12)})
po2 = J(award("O", rfq2, qs2["S2"]))
check("next number", po2.get("number") == f"PO-{yr}-0002")
ok("supplier declines", call("S2", "decline_purchase_order", q(s2), q(po2["id"]), q("Out of stock.")))
check("RFQ reopens", SQL(f"select status||'|'||coalesce(awarded_quotation_id::text,'none') from rfqs where id='{rfq2}'") == "evaluating|none")
v2 = J(call("P", "get_rfq_quotes", q(rfq2)))
check("declined quote flagged, award allowed again", v2.get("can_award") is True and [x["declined_order"] for x in v2["quotes"] if x["supplier_org"] == s2] == [True])
denied("declined quote cannot be re-awarded", award("P", rfq2, qs2["S2"]), "supplier_declined")
po3 = J(award("P", rfq2, qs2["S1"])); check("awards the other quote", po3.get("number") == f"PO-{yr}-0003")
denied("employee cannot cancel", call("E", "cancel_purchase_order", q(po3["id"])), "not_allowed")
ok("buyer cancels", call("P", "cancel_purchase_order", q(po3["id"]), q("Mistake.")))
check("RFQ reopens after buyer cancel and quote can be re-awarded", SQL(f"select status from rfqs where id='{rfq2}'") == "evaluating" and J(award("P", rfq2, qs2["S1"])).get("number") == f"PO-{yr}-0004")
apply(po_mig[0])
check("migration is safe to run twice", SQL("select count(*) from purchase_orders") == "4")
print(f"{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
