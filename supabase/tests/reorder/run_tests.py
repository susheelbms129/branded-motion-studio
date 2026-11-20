#!/usr/bin/env python3
"""
Tests for One-click reorder with a memory (migration 22).
Builds a THROWAWAY database `vendora_reorder_test`, applies every migration, builds delivered orders directly (the tests control the clock),
then checks the check-up before ordering, who may reorder, what the browser can and cannot influence (prices never), duplicates, the
Rs 2,00,000 owner-only line, the daily limit, the reorder rhythm, both sides' views, and that other features are untouched.
Never point it at a real project.

    PGHOST=localhost PGUSER=postgres python3 supabase/tests/reorder/run_tests.py
"""
import glob, json, os, subprocess, sys, uuid
from datetime import date, timedelta
HERE = os.path.dirname(os.path.abspath(__file__))
MIG = os.path.join(HERE, "..", "..", "migrations")
BOOT = os.path.join(HERE, "..", "invite_only", "bootstrap_local_supabase.sql")
DB = "vendora_reorder_test"
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
ro_mig = [f for f in files if f.endswith("_reorder.sql")]
assert ro_mig, "the reorder migration (22) is missing"
for f in files: apply(f)
apply(ro_mig[0])  # safe to run twice

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

# ── helpers: delivered orders built directly (the tests control the clock) ──
LN = lambda desc, qty, unit, price, gst=18: (desc, qty, unit, price, gst)
BASE = [LN("MS plate 10mm", 10, "Sheet", 1500), LN("Welding rod", 25.5, "Kg", 210.5)]
OWN = {oA: "O", oD: "DO", oX: "XO"}
N = [0]
def mk(sup, buyer=None, status="received", age=30, lead=5, diff=0, lines=None, terms=30, ship=0, other=0, addr="Plot 4, MIDC, Pune 411019", title="Plates and rods"):
    """an order issued `age` days ago, promised `lead` days later, delivered `diff` days after the promise"""
    buyer = buyer or oA; N[0] += 1; pid = str(uuid.uuid4())
    dl = f"((((now() - interval '{age} days' + interval '{lead} days')::date + {diff})::timestamp + interval '12 hours') at time zone 'UTC')" if status in ("received", "closed") else "null"
    sh(f"insert into purchase_orders(id,org_id,number,supplier_org,status,issued_at,expected_at,delivered_at,created_by,shipping,other_charges,payment_terms_days,delivery_address,title) "
       f"values ('{pid}','{buyer}','SEED-{N[0]}','{sup}','{status}', now() - interval '{age} days', (now() - interval '{age} days' + interval '{lead} days')::date, {dl}, '{ids[OWN[buyer]]}', "
       f"{ship}, {other}, {terms}, {q(addr)}, {q(title)})")
    for d, qty, unit, price, gst in (lines or BASE):
        sh(f"insert into po_lines(org_id,po_id,description,qty,unit,unit_price,gst_rate) values ('{buyer}','{pid}',{q(d)},{qty},{q(unit)},{price},{gst})")
    return pid
def lids(po): return [(r.split("|")[0], float(r.split("|")[1])) for r in sh(f"select id||'|'||qty from po_lines where po_id='{po}' order by description")[1:2] + []] if False else \
    [(a, float(b)) for a, b in (x.split("|") for x in run([], f"select id||'|'||qty from po_lines where po_id='{po}' order by description").stdout.strip().splitlines())]
def reorder(who, po, qtys=None, **kw):
    ls = lids(po); qtys = qtys or [qq for _, qq in ls]
    d = {"lines": [{"id": i, "qty": qq} for (i, _), qq in zip(ls, qtys)]}; d.update(kw)
    return call(who, "reorder_purchase_order", q(po), jb(d))
def raw(who, po, d): return call(who, "reorder_purchase_order", q(po), jb(d))
def npo(org): return int(SQL(f"select count(*) from purchase_orders where org_id='{org}'"))
def row(po, cols): return SQL(f"select {cols} from purchase_orders where id='{po}'")
PV = lambda who, po: J(call(who, "preview_reorder", q(po)))

# ── sources ──
older = mk(s1, age=100, lead=5, diff=0, lines=[LN("MS plate 10mm", 10, "Sheet", 1400), LN("Welding rod", 20, "Kg", 200)])
src1 = mk(s1, age=30, lead=5, diff=2, ship=500, other=100, terms=45)

# ── 1. the check-up ──
p = PV("P", src1)
check("preview: a procurement manager may reorder", p.get("can_reorder") is True and p.get("blockers") == [], str(p)[:200])
check("preview: delivery was 2 days late", p["source"]["days_vs_promise"] == 2, str(p.get("source")))
check("preview: lead time is reused (5 days)", p["source"]["lead_days"] == 5)
check("preview: supplier is verified today", p["supplier"]["verified_today"] is True and p["supplier"]["level_now"] >= 1)
check("preview: both lines come with the price paid now", sorted(float(l["unit_price"]) for l in p["lines"]) == [210.5, 1500.0])
ep = {l["description"]: l["earlier_price"] for l in p["lines"]}
check("preview: the price paid the time before is shown", float(ep["MS plate 10mm"]) == 1400 and float(ep["Welding rod"]) == 200, str(ep))
check("preview: payment terms shown (45 days)", p["source"]["payment_terms_days"] == 45)
check("preview: shipping and other charges are the old ones", float(p["amounts"]["shipping"]) == 500 and float(p["amounts"]["other_charges"]) == 100)
check("preview: no duplicate yet", p["duplicate"] is None)
check("preview: rule line is shown", float(p["limit"]["owner_only_above"]) == 200000 and p["limit"]["you_may_exceed"] is False)
check("preview: the owner may exceed the line", PV("O", src1)["limit"]["you_may_exceed"] is True)
for k in ("F", "AP", "E"):
    pk = PV(k, src1); check(f"preview: {k} can read but is blocked by role", pk.get("can_reorder") is False and "role" in pk.get("blockers", []), str(pk)[:150])
for k in ("XO", "Z", "SU", "S1"):
    denied(f"preview: {k} cannot see another company's order", call(k, "preview_reorder", q(src1)), "not_found")
denied("preview: made-up id", call("O", "preview_reorder", q(uuid.uuid4())), "not_found")
denied("preview: anonymous", ANON(f"select preview_reorder('{src1}')"), "permission denied")
pend = mk(s1, status="issued", lines=[LN("Copper wire", 5, "Coil", 900)])
check("preview: an order not delivered yet is blocked", "not_delivered" in PV("O", pend)["blockers"])
canc = mk(s1, status="cancelled", lines=[LN("Copper wire", 5, "Coil", 900)])
check("preview: a cancelled order is blocked", "not_delivered" in PV("O", canc)["blockers"])
u3 = mk(s3); u4 = mk(s4)
check("preview: unverified supplier is blocked", "supplier_not_verified" in PV("O", u3)["blockers"])
check("preview: supplier whose proof expired is blocked", "supplier_not_verified" in PV("O", u4)["blockers"])

# ── 2. who may reorder, and what must be true ──
for k in ("F", "AP", "E"): denied(f"reorder: {k} may not", reorder(k, src1), "not_allowed")
for k in ("XO", "Z", "SU"): denied(f"reorder: {k} cannot reach it", reorder(k, src1), "not_found")
denied("reorder: made-up order", call("O", "reorder_purchase_order", q(uuid.uuid4()), jb({"lines": []})), "not_found")
denied("reorder: anonymous", ANON(f"select reorder_purchase_order('{src1}', '{{}}'::jsonb)"), "permission denied")
denied("reorder: not delivered", reorder("O", pend), "not_delivered")
denied("reorder: cancelled order", reorder("O", canc), "not_delivered")
denied("reorder: supplier never verified", reorder("O", u3), "supplier_not_verified")
denied("reorder: supplier's proof expired", reorder("O", u4), "supplier_not_verified")
before = npo(oA)
# ── 3. input is checked on the server ──
L = lids(src1); good = {"id": L[0][0], "qty": 1}
denied("input: no body", call("O", "reorder_purchase_order", q(src1), "null"), "invalid_request")
denied("input: lines missing", raw("O", src1, {}), "invalid_lines")
denied("input: lines not a list", raw("O", src1, {"lines": "x"}), "invalid_lines")
denied("input: empty lines", raw("O", src1, {"lines": []}), "invalid_lines")
denied("input: line from another order", raw("O", src1, {"lines": [{"id": lids(older)[0][0], "qty": 1}]}), "invalid_lines")
denied("input: made-up line id", raw("O", src1, {"lines": [{"id": str(uuid.uuid4()), "qty": 1}]}), "invalid_lines")
denied("input: line id not an id", raw("O", src1, {"lines": [{"id": "abc", "qty": 1}]}), "invalid_lines")
denied("input: same line twice", raw("O", src1, {"lines": [good, good]}), "invalid_lines")
for name, qv in [("zero", 0), ("negative", -3), ("text", "5"), ("4 decimals", 1.2345), ("too big", 100000000), ("null", None)]:
    denied(f"input: quantity {name}", raw("O", src1, {"lines": [{"id": good["id"], "qty": qv}]}), "invalid_quantity")
denied("input: address too short", raw("O", src1, {"lines": [good], "deliveryAddress": "abc"}), "invalid_address")
denied("input: address too long", raw("O", src1, {"lines": [good], "deliveryAddress": "x" * 501}), "invalid_address")
denied("input: address not text", raw("O", src1, {"lines": [good], "deliveryAddress": 5}), "invalid_address")
denied("input: notes too long", raw("O", src1, {"lines": [good], "notes": "n" * 1001}), "invalid_notes")
denied("input: notes not text", raw("O", src1, {"lines": [good], "notes": 7}), "invalid_notes")
denied("input: allowDuplicate must be true/false", raw("O", src1, {"lines": [good], "allowDuplicate": "yes"}), "invalid_request")
check("input: nothing was created by any refused attempt", npo(oA) == before)

# ── 4. a good reorder ──
r = J(reorder("P", src1, [20, 30.5], notes="Same as last time, please"))
check("reorder: a procurement manager reorders in one call", "id" in r and r.get("status") == "issued", str(r))
rid = r.get("id", "")
check("reorder: numbered PO-<year>-<n>", r.get("number", "").startswith(f"PO-{yr}-"), str(r))
check("reorder: remembers where it came from", row(rid, "reordered_from") == src1)
check("reorder: same supplier, issued status", row(rid, "supplier_org||'|'||status") == f"{s1}|issued")
check("reorder: the address of last time is reused", row(rid, "delivery_address") == "Plot 4, MIDC, Pune 411019")
check("reorder: terms, shipping and charges copied", row(rid, "payment_terms_days||'|'||shipping||'|'||other_charges") == "45|500.00|100.00")
check("reorder: promise date = today + the old lead time", row(rid, "expected_at") == (date.today() + timedelta(days=5)).isoformat())
check("reorder: the new quantities are the buyer's", SQL(f"select string_agg(qty::text, ',' order by description) from po_lines where po_id='{rid}'") == "20.000,30.500")
check("reorder: prices and GST are the old ones", SQL(f"select string_agg(unit_price::text||'@'||gst_rate::text, ',' order by description) from po_lines where po_id='{rid}'") == "1500.00@18.00,210.50@18.00")
check("reorder: created by the person who clicked", row(rid, "created_by") == ids["P"])
check("reorder: the supplier is told", int(SQL(f"select count(*) from notifications where org_id='{s1}' and link_to='orders/{rid}'")) >= 1)
check("reorder: audited on both sides, ids only", int(SQL(f"select count(*) from audit_log where entity_id='{rid}' and action in ('po_reordered','po_received')")) == 2
      and "price" not in SQL(f"select string_agg(detail::text, '') from audit_log where entity_id='{rid}'"))
check("reorder: the old order is untouched", row(src1, "status") == "received" and SQL(f"select count(*) from po_lines where po_id='{src1}'") == "2")

# ── 5. duplicates ──
check("duplicate: preview now warns", (PV("O", src1)["duplicate"] or {}).get("id") == rid)
denied("duplicate: refused by default", reorder("O", src1), "duplicate_open")
r2 = J(reorder("O", src1, allowDuplicate=True))
check("duplicate: allowed when the buyer says order again anyway", "id" in r2, str(r2))
check("duplicate: both orders exist and numbers differ", r2.get("number") != r.get("number"))
for pid_ in (rid, r2.get("id", "")): ok("duplicate: (setup) buyer cancels", call("O", "cancel_purchase_order", q(pid_), "'test'"))
check("duplicate: once cancelled the warning is gone", PV("O", src1)["duplicate"] is None)

# ── 6. the browser cannot move a price ──
r3 = J(raw("O", src1, {"lines": [{"id": L[0][0], "qty": 3, "unitPrice": 1, "unit_price": 1, "gst_rate": 0, "price": 1}], "unitPrice": 1, "shipping": 0, "supplier_org": s2, "paymentTermsDays": 90}))
check("tamper: extra fields are ignored, the order is made", "id" in r3, str(r3))
r3id = r3.get("id", "")
check("tamper: the price is still the agreed one", SQL(f"select unit_price||'@'||gst_rate from po_lines where po_id='{r3id}'") == "1500.00@18.00")
check("tamper: supplier, shipping and terms cannot be changed", row(r3id, "supplier_org||'|'||shipping||'|'||payment_terms_days") == f"{s1}|500.00|45")
check("tamper: only the chosen line is on the new order", SQL(f"select count(*) from po_lines where po_id='{r3id}'") == "1")
denied("tamper: the browser cannot write orders directly", U("P", f"update purchase_orders set reordered_from = null where id='{r3id}'"), "permission denied")
denied("tamper: nor insert them", U("P", f"insert into purchase_orders(org_id,number,supplier_org,created_by) values ('{oA}','HACK-1','{s1}','{ids['P']}')"), "permission denied")

# ── 7. the owner-only line ──
big = mk(s2, lines=[LN("HR coil", 1000, "Kg", 500)], title="Coil")
pb = PV("P", big)
check("limit: preview shows the amount is above the line", float(pb["amounts"]["total"]) > 200000 and pb["limit"]["you_may_exceed"] is False)
n0 = npo(oA)
denied("limit: a procurement manager cannot reorder above Rs 2,00,000", reorder("P", big), "owner_required")
check("limit: and nothing was left behind", npo(oA) == n0)
check("limit: a smaller quantity from the same order is fine", "id" in J(reorder("P", big, [100])))
rb = J(reorder("O", big, allowDuplicate=True))
check("limit: the owner can", "id" in rb and float(rb.get("total", 0)) > 200000, str(rb))
ds = mk(s1, buyer=oD, lines=[LN("Packing tape", 400, "Roll", 600)], title="Tape")
check("limit: a solo owner can too", "id" in J(reorder("DO", ds)))

# ── 8. the daily limit ──
dl = mk(s1, buyer=oD, lines=[LN("Gloves", 10, "Pair", 100)], title="Gloves")
sh(f"insert into purchase_orders(org_id,number,supplier_org,status,created_by,reordered_from) select '{oD}','DAY-'||g,'{s1}','cancelled','{ids['DO']}','{dl}' from generate_series(1,28) g")
check("daily: the 30th reorder of the day is allowed (29th was ds)", "id" in J(reorder("DO", dl)))
denied("daily: the 31st is refused", reorder("DO", dl, allowDuplicate=True), "daily_limit")
sh(f"update purchase_orders set created_at = now() - interval '25 hours' where org_id='{oD}' and number like 'DAY-%'")
check("daily: yesterday's reorders no longer count", "id" in J(reorder("DO", dl, allowDuplicate=True)))
check("daily: another company is not affected", "id" in J(reorder("O", mk(s1, lines=[LN("Bolts", 5, "Box", 90)], title="Bolts"))))

# ── 9. the reorder rhythm ──
G2 = [LN("Steel wire", 10, "Coil", 800)]
g2 = [mk(s2, age=a, lines=G2, title="Wire") for a in (70, 40, 10)]
rh = PV("O", g2[-1])["rhythm"]
check("rhythm: 3 orders 30 days apart", rh["orders"] == 3 and rh["gap_days"] == 30, str(rh))
check("rhythm: next order is due in 20 days", rh["days_until"] == 20 and rh["next_due"] == (date.today() + timedelta(days=20)).isoformat(), str(rh))
G3 = [LN("Rubber seal", 100, "Pc", 12)]
g3 = [mk(s2, age=a, lines=G3, title="Seals") for a in (100, 60)]
mk(s2, status="cancelled", age=5, lines=G3, title="Seals")
rh3 = PV("O", g3[-1])["rhythm"]
check("rhythm: a late order says how late (cancelled orders do not count)", rh3["gap_days"] == 40 and rh3["days_until"] == -20, str(rh3))
G4 = [LN("Safety shoes", 5, "Pair", 1800)]
g4 = mk(s2, age=15, lines=G4, title="Shoes")
check("rhythm: a single order has no rhythm yet", PV("O", g4)["rhythm"]["gap_days"] is None)
g5a = mk(s2, age=12, lines=[LN("Paint", 5, "Can", 700)], title="Paint"); g5b = mk(s2, age=12, lines=[LN("Paint", 5, "Can", 700)], title="Paint")
check("rhythm: two orders on the same day are not a rhythm", PV("O", g5b)["rhythm"]["gap_days"] is None)
check("rhythm: signature ignores case and spacing", J(call("O", "preview_reorder", q(mk(s2, age=3, lines=[LN("  steel WIRE ", 10, "coil", 800)], title="Wire"))))["rhythm"]["orders"] == 4)

# ── 10. what to reorder next ──
sg = J(call("O", "list_reorder_suggestions", q(oA)))
items = sg.get("items", [])
check("suggestions: owner sees a list and may reorder", len(items) >= 4 and sg.get("can_reorder") is True, str(sg)[:200])
dues = [i["days_until"] for i in items if i["days_until"] is not None]
check("suggestions: the most overdue come first", dues == sorted(dues) and dues[0] == -20, str(dues))
check("suggestions: those without a rhythm come last", all(i["days_until"] is None for i in items[len(dues):]))
check("suggestions: the late purchase is listed with its supplier", any(i["title"] == "Seals" and i["supplier_name"] == "Bharat Steels" for i in items))
check("suggestions: a purchase with an order on its way is flagged", any(i["title"] == "Coil" and i["open_order"] for i in items))
check("suggestions: a cancelled-only purchase is not suggested", not any(i["po_id"] == canc for i in items))
check("suggestions: one row per purchase, not per order", sum(1 for i in items if i["title"] == "Wire") == 1)
check("suggestions: finance can read but not reorder", J(call("F", "list_reorder_suggestions", q(oA))).get("can_reorder") is False)
check("suggestions: limit works", len(J(call("O", "list_reorder_suggestions", q(oA), "1")).get("items", [])) == 1)
for k in ("XO", "Z", "SU"): denied(f"suggestions: {k} cannot read another company's", call(k, "list_reorder_suggestions", q(oA)), "not_allowed")
denied("suggestions: supplier side cannot", call("S1", "list_reorder_suggestions", q(oA)), "not_allowed")
denied("suggestions: anonymous", ANON(f"select list_reorder_suggestions('{oA}')"), "permission denied")

# ── 11. both sides see the link ──
cx = J(call("O", "get_reorder_context", q(r3id)))
check("context: a reorder points at its source", (cx.get("reordered_from") or {}).get("id") == src1, str(cx))
cs = J(call("O", "get_reorder_context", q(src1)))
check("context: the source lists its reorders", r3id in [x["id"] for x in cs.get("reorders", [])])
denied("context: a stranger cannot", call("XO", "get_reorder_context", q(r3id)), "not_found")
si = J(call("S1", "get_supplier_reorder_info", q(s1), q(r3id)))
check("supplier: sees this is a reorder of the earlier order", si.get("is_reorder") is True and si.get("source_number") == "SEED-%d" % (N[0] and int(SQL(f"select substring(number from '[0-9]+$') from purchase_orders where id='{src1}'"))), str(si))
check("supplier: a normal order is not marked a reorder", J(call("S1", "get_supplier_reorder_info", q(s1), q(src1))).get("is_reorder") is False)
check("supplier: a team member can see it too", J(call("S1B", "get_supplier_reorder_info", q(s1), q(r3id))).get("is_reorder") is True)
denied("supplier: a suspended member cannot", call("S1S", "get_supplier_reorder_info", q(s1), q(r3id)), "not_allowed")
denied("supplier: another supplier cannot", call("S2", "get_supplier_reorder_info", q(s2), q(r3id)), "not_found")
denied("supplier: a buyer cannot", call("O", "get_supplier_reorder_info", q(oA), q(r3id)), "not_allowed")

# ── 12. the old flow still works on a reorder ──
ok("flow: the supplier confirms a reorder in one tap", call("S1", "confirm_purchase_order", q(s1), q(r3id), "'ok'"))
check("flow: it is acknowledged", row(r3id, "status") == "acknowledged")
check("flow: the buyer's order page still opens", J(call("O", "get_purchase_order", q(r3id))).get("po", {}).get("status") == "acknowledged")
ra = J(reorder("O", src1)); raid = ra.get("id", "")
ok("flow: the supplier can decline a reorder (price moved)", call("S1", "decline_purchase_order", q(s1), q(raid), "'Steel price went up'"))
check("flow: declined reorder is cancelled by the supplier", row(raid, "status||'|'||cancelled_by") == "cancelled|supplier")
check("flow: a declined reorder does not block a new one", "id" in J(reorder("O", src1)))
check("flow: the source order is untouched by all of it", row(src1, "status") == "received")
check("flow: deleting a source keeps the reorder (link just clears)", sh(f"delete from purchase_orders where id='{older}'")[0] and row(r3id, "reordered_from") == src1)
check("flow: migration applied twice is harmless", run(["-f", ro_mig[0]]).returncode == 0)

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
