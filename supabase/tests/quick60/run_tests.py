#!/usr/bin/env python3
"""
Tests for Quote in 60 seconds: price memory, usual terms, one-tap readiness (migration 19).
Builds a THROWAWAY database `vendora_quick60_test`, applies every migration, then sends RFQs and attacks the flow:
who may send, which requests may be sent, which suppliers may be invited (verified only, checked at send time), input checks,
numbering, notifications, what suppliers can and cannot see, direct table writes and races.
Never point it at a real project.

    PGHOST=localhost PGUSER=postgres python3 supabase/tests/quick60/run_tests.py
    (set PSQL_BIN if psql is not on your PATH)
"""
import glob, json, os, subprocess, sys, uuid
from datetime import date, timedelta
HERE = os.path.dirname(os.path.abspath(__file__))
MIG = os.path.join(HERE, "..", "..", "migrations")
BOOT = os.path.join(HERE, "..", "invite_only", "bootstrap_local_supabase.sql")
DB = "vendora_quick60_test"
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
q_mig = [f for f in files if f.endswith("_quote_in_60.sql")]
assert q_mig, "the quote in 60 seconds migration (19) is missing"
for f in files: apply(f)
apply(q_mig[0])  # safe to run twice

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

M = lambda a, b: SQL(f"select coalesce(public._qs_match({q(a)}, {q(b)}), 'none')")
GQ = lambda who, org, rid: J(call(who, "get_quote_request", q(org), q(rid)))
LQ = lambda who, org: J(call(who, "list_quote_requests", q(org)))
def prod(org, name, price, unit="Sheet", moq="null", avail="Available", cur="INR"):
    pid = str(uuid.uuid4())
    pr = "null" if price is None else str(price)
    sh(f"insert into supplier_products(id,org_id,name,category,unit,moq,price,currency,availability) values ('{pid}','{org}',{q(name)},'Steel','{unit}',{moq},{pr},'{cur}','{avail}')")
    return pid
def sug(who, org, rid, i=0): return GQ(who, org, rid)["items"][i]["suggestion"]
def quote(who, org, rid, prices, **kw):
    its = GQ(who, org, rid)["items"]
    d = {"lines": [{"itemId": it["id"], "unitPrice": p} for it, p in zip(its, prices)], "gstRate": 18, "shipping": 0, "otherCharges": 0,
         "deliveryDays": 7, "paymentTermsDays": 30, "validUntil": (date.today() + timedelta(days=15)).isoformat(), "notes": ""}
    d.update(kw); return call(who, "submit_quotation", q(org), q(rid), jb(d))

# ═══ 1. matching: the same thing is recognised, a different size never is ═══
check("the same item written differently is an exact match", M("MS plate 10mm", "Mild Steel Plate 10 mm") == "exact", M("MS plate 10mm", "Mild Steel Plate 10 mm"))
check("plurals and word order do not matter", M("Plates, MS 10 mm", "ms plate 10mm") == "exact" and M("Brass sheets", "Brass sheet") == "exact" and M("M8 hex bolt", "Hex bolt M8") == "exact")
check("trade abbreviations are understood (MS, SS, GI)", M("SS 304 sheet", "Stainless steel 304 sheet") == "exact" and M("GI pipe 1 inch", "Galvanized iron pipe 1 inch") == "exact")
check("a little extra wording is a strong match", M("MS plate 10mm thick", "Mild Steel Plate 10 mm") == "strong", M("MS plate 10mm thick", "Mild Steel Plate 10 mm"))
check("a different size is NEVER a match", M("MS plate 10mm", "MS plate 12mm") == "none" and M("Hex bolt M8", "Hex bolt M10") == "none")
check("extra numbers on one side are not matched either (better no price than a wrong one)", M("Cable 2.5 sq mm", "Cable 2.5 sq mm 100m") == "none")
check("a size on one side only is only a possible match, never filled in", M("Hex bolt", "Hex bolt M8 zinc") == "possible" and M("Welding rod", "Welding electrode rod 3.15 mm") == "possible" and M("Bolt", "Hex bolt M8") == "possible")
check("a single shared word is not enough", M("Hex bolt", "Anchor bolt") == "none" and M("Pipe", "Pump") == "none")
check("empty or meaningless text matches nothing", M("", "Plate") == "none" and M("  ", "  ") == "none" and M("the of and", "plate") == "none")
check("injection-looking text is only text", M("plate'; drop table businesses; --", "plate") in ("none", "possible", "strong", "exact") and SQL("select count(*) from businesses") != "0")
check("the matching helpers cannot be called from the browser", not U("S1", "select public._qs_match('a','b')")[0] and not ANON("select public._qs_tokens('a')")[0] and not U("S1", f"select public._qs_suggest('{s1}','a','','INR',1,null)")[0])

# ═══ 2. the RFQ the suppliers answer: item 1 "MS plate 10mm" 10 Sheet, item 2 "Welding rod" 25.5 Kg ═══
RID = J(send("P", approved(), data(sup=[s1, s2])))["id"]
check("(setup) the RFQ was sent to both suppliers", len(RID) == 36)
s = sug("S1", s1, RID); check("with no products and no history there is nothing to fill in", s is None, str(s))
check("the request carries no usual terms yet", GQ("S1", s1, RID)["defaults"] is None)
check("an RFQ with no prices known is not ready in one tap", [i["ready"] for i in LQ("S1", s1)["items"]] == [False])

p1 = prod(s1, "Mild Steel Plate 10 mm", 1500, "Sheet", moq=5)
p2 = prod(s1, "Welding electrode rod 3.15 mm", 210, "Kg")
prod(s2, "Mild Steel Plate 10 mm", 999, "Sheet")
s = sug("S1", s1, RID, 0)
check("a product-list price is found for the matching item, with where it came from", s and s["source"] == "product" and s["confidence"] == "exact" and s["price"] == 1500 and s["product_id"] == p1 and s["name"] == "Mild Steel Plate 10 mm", str(s))
check("an exact match with the right unit is filled in and clean", s["auto"] is True and s["clean"] is True and s["unit_ok"] is True and s["moq"] == 5 and s["availability"] == "Available", str(s))
s2_ = sug("S1", s1, RID, 1)
check("a loose match is offered but not filled in", s2_ and s2_["confidence"] == "possible" and s2_["auto"] is False and s2_["clean"] is False and s2_["price"] == 210, str(s2_))
check("the answer still has the shape the quote form already uses", all(k in s for k in ("product_id", "name", "price", "unit", "moq", "availability")))
check("one loose item means the RFQ is not ready in one tap", [i["ready"] for i in LQ("S1", s1)["items"]] == [False])
check("another supplier's price is never shown to this one", all(x["suggestion"] is None or x["suggestion"]["price"] != 999 for x in GQ("S1", s1, RID)["items"]))
check("the other supplier sees only its own price", sug("S2", s2, RID, 0)["price"] == 999 and sug("S2", s2, RID, 1) is None)
denied("a supplier cannot ask for a competitor's quote request", call("S1", "get_quote_request", q(s2), q(RID)), "not_allowed")
denied("a buyer cannot", call("O", "get_quote_request", q(s1), q(RID)), "not_allowed")
denied("signed out cannot", ANON(f"select public.get_quote_request('{s1}','{RID}')"), "permission denied")

# the careful rules
SQL(f"update supplier_products set unit='Kg' where id='{p1}'")
s = sug("S1", s1, RID, 0)
check("a price per a different unit is not filled in", s["auto"] is False and s["unit_ok"] is False and s["clean"] is False, str(s))
SQL(f"update supplier_products set unit='sheet' where id='{p1}'")
check("unit case does not matter", sug("S1", s1, RID, 0)["auto"] is True)
SQL(f"update supplier_products set availability='Temporarily unavailable' where id='{p1}'")
s = sug("S1", s1, RID, 0)
check("a temporarily unavailable product is not filled in", s["auto"] is False and s["availability"] == "Temporarily unavailable", str(s))
SQL(f"update supplier_products set availability='Made to order', moq=20 where id='{p1}'")
s = sug("S1", s1, RID, 0)
check("below the minimum order the price is still filled in, but it is not clean", s["auto"] is True and s["clean"] is False and s["moq"] == 20, str(s))
SQL(f"update supplier_products set moq=5 where id='{p1}'")
SQL(f"update supplier_products set price=null where id='{p1}'")
check("a product with no price is never used", sug("S1", s1, RID, 0) is None)
SQL(f"update supplier_products set price=1500, currency='USD' where id='{p1}'")
check("a price in another currency is never used", sug("S1", s1, RID, 0) is None)
SQL(f"update supplier_products set currency='INR' where id='{p1}'")
check("(restored) the match is back", sug("S1", s1, RID, 0)["auto"] is True)
p3 = prod(s1, "Mild Steel Plate 12 mm", 1800, "Sheet")
check("a product of a different size is ignored even when it is newer", sug("S1", s1, RID, 0)["price"] == 1500)
SQL(f"update supplier_products set price=1600 where id='{p3}'")
check("the same size always wins", sug("S1", s1, RID, 0)["product_id"] == p1)
SQL(f"update supplier_products set name='Mild Steel Plate 10 mm thick', unit='Sheet' where id='{p3}'")
check("on a tie an exact match beats a strong match", sug("S1", s1, RID, 0)["confidence"] == "exact" and sug("S1", s1, RID, 0)["product_id"] == p1)
SQL(f"delete from supplier_products where id='{p3}'")

# ═══ 3. every quote teaches Vendora the supplier's prices ═══
SQL(f"update supplier_products set name='Welding electrode rod 3.15 mm' where id='{p2}'")
ok("the supplier sends a quote with its own prices", quote("S1", s1, RID, [1450, 205]))
check("the price they just quoted is not offered back on the same RFQ", all(x["suggestion"]["source"] == "product" for x in GQ("S1", s1, RID)["items"] if x["suggestion"]))
SQL(f"delete from supplier_products where org_id='{s1}'")
check("without a product list the quote the supplier just sent is not echoed on its own RFQ", all(x["suggestion"] is None for x in GQ("S1", s1, RID)["items"]))
RID2 = J(send("O", approved(), data(sup=[s1, s2])))["id"]
items2 = GQ("S1", s1, RID2)["items"]
a0, a1 = items2[0]["suggestion"], items2[1]["suggestion"]
check("a new RFQ is filled in from the price the supplier quoted last time", a0 and a0["source"] == "past_quote" and a0["price"] == 1450 and a0["confidence"] == "exact" and a0["auto"] is True and a0["product_id"] is None and a0["quoted_on"] == date.today().isoformat(), str(a0))
check("each line is remembered separately: the second item is filled in from its own earlier price", a1 and a1["price"] == 205 and a1["auto"] is True and a1["confidence"] == "exact" and a1["source"] == "past_quote", str(a1))
check("the other supplier never gets this supplier's quoted prices", all(x["suggestion"] is None or x["suggestion"]["price"] not in (1450, 205) for x in GQ("S2", s2, RID2)["items"]))
SQL(f"update quotations set received_at = now() - interval '100 days' where supplier_org='{s1}'")
a0 = sug("S1", s1, RID2, 0)
check("a price older than 90 days is offered but not filled in", a0 and a0["auto"] is False and a0["price"] == 1450, str(a0))
SQL(f"update quotations set received_at = now() - interval '200 days' where supplier_org='{s1}'")
check("a price older than 180 days is forgotten", sug("S1", s1, RID2, 0) is None)
SQL(f"update quotations set received_at = now() where supplier_org='{s1}'")
# a buyer that works in dollars: the supplier's rupee products and rupee quotes must not be offered
SQL(f"update businesses set currency='USD' where id='{oD}'")
RIDU = J(send("DO", approved(org=oD, maker="DO"), data(sup=[s1])))["id"]
check("(setup) a dollar RFQ reaches the supplier", len(RIDU) == 36)
check("rupee products and rupee quotes are never offered for a dollar RFQ", all(x["suggestion"] is None for x in GQ("S1", s1, RIDU)["items"]), str([x["suggestion"] for x in GQ("S1", s1, RIDU)["items"]]))
pu = prod(s1, "Mild Steel Plate 10 mm", 20, "Sheet", cur="USD")
su = sug("S1", s1, RIDU, 0)
check("a dollar price is offered for a dollar RFQ", su and su["price"] == 20 and su["source"] == "product" and su["auto"] is True, str(su))
check("and the dollar price is never offered for a rupee RFQ", sug("S1", s1, RID2, 0)["price"] == 1450)
SQL(f"delete from supplier_products where id='{pu}'")

# ═══ 4. ready in one tap ═══
prod(s1, "Welding electrode rod 3.15 mm", 210, "Kg")
SQL(f"update rfq_items set description='Welding electrode rod 3.15mm' where rfq_id='{RID2}' and description='Welding rod'")
check("(setup) both lines now match", all(x["suggestion"] and x["suggestion"]["clean"] for x in GQ("S1", s1, RID2)["items"]), str([x["suggestion"] for x in GQ("S1", s1, RID2)["items"]]))
rows = {r["rfq_id"]: r for r in LQ("S1", s1)["items"]}
check("an open request whose lines all have clean prices is ready in one tap", rows[RID2]["ready"] is True, str(rows[RID2]))
check("a request already quoted is not 'ready'", rows[RID]["ready"] is False)
check("the other supplier's inbox is judged on its own data", all(r["ready"] is False for r in LQ("S2", s2)["items"]))
SQL(f"update supplier_products set availability='Temporarily unavailable' where org_id='{s1}' and name like 'Welding%'")
check("one unavailable item takes the ready flag away", {r["rfq_id"]: r for r in LQ("S1", s1)["items"]}[RID2]["ready"] is False)
SQL(f"update supplier_products set availability='Available' where org_id='{s1}'")
check("(restored) ready again", {r["rfq_id"]: r for r in LQ("S1", s1)["items"]}[RID2]["ready"] is True)
check("the inbox rows keep every field they had", all(k in rows[RID2] for k in ("rfq_id", "number", "title", "due_date", "state", "item_count", "buyer_name", "currency", "my_total")))
SQL(f"update rfqs set due_date = current_date - 1 where id='{RID2}'")
check("a request past its deadline is never ready", {r["rfq_id"]: r for r in LQ("S1", s1)["items"]}[RID2]["ready"] is False)
SQL(f"update rfqs set due_date = current_date + 5 where id='{RID2}'")
ok("the one-tap quote, sent with exactly the filled-in prices, is accepted by the unchanged checks", quote("S1", s1, RID2, [1450, 210]))
check("after sending, it is no longer ready", {r["rfq_id"]: r for r in LQ("S1", s1)["items"]}[RID2]["ready"] is False)
denied("the quote checks still refuse a bad price", quote("S1", s1, RID2, [0, 210]), "invalid_price")

# ═══ 5. the supplier's usual terms ═══
TD = lambda **kw: dict({"gstRate": 12, "deliveryDays": 5, "paymentTermsDays": 45, "validDays": 10, "shipping": 250, "otherCharges": 20.5, "notes": "Ex-works Pune."}, **kw)
SAVE = lambda who, org, d: call(who, "save_quote_defaults", q(org), jb(d))
ok("the owner saves the usual terms", SAVE("S1", s1, TD())); ok("saving again replaces them", SAVE("S1", s1, TD(gstRate=18)))
ok("a procurement manager of the supplier could too (a second supplier owner here)", SAVE("S2", s2, TD(gstRate=5)))
g1 = GQ("S1", s1, RID2)["defaults"]
check("the saved terms come back with the request", g1 == {"gst_rate": 18, "delivery_days": 5, "payment_terms_days": 45, "valid_days": 10, "shipping": 250, "other_charges": 20.5, "notes": "Ex-works Pune."}, str(g1))
check("an employee of the supplier sees them when quoting", GQ("S1B", s1, RID2)["defaults"] == g1)
check("each supplier sees only its own", GQ("S2", s2, RID2)["defaults"]["gst_rate"] == 5)
denied("an employee cannot change them", SAVE("S1B", s1, TD()), "not_allowed")
denied("a suspended member cannot", SAVE("S1S", s1, TD()), "not_allowed")
denied("another supplier cannot change someone else's", SAVE("S2", s1, TD()), "not_allowed")
denied("a buyer cannot", SAVE("O", s1, TD()), "not_allowed")
denied("someone with no company cannot", SAVE("Z", s1, TD()), "not_allowed")
denied("signed out cannot", ANON(f"select public.save_quote_defaults('{s1}', {jb(TD())})"), "permission denied")
for label, kw, code in [("GST above 40", dict(gstRate=41), "invalid_gst"), ("negative GST", dict(gstRate=-1), "invalid_gst"), ("a fractional delivery time", dict(deliveryDays=1.5), "invalid_delivery_days"),
                        ("delivery over a year", dict(deliveryDays=366), "invalid_delivery_days"), ("a fractional payment term", dict(paymentTermsDays=2.5), "invalid_payment_terms"),
                        ("validity of 0 days", dict(validDays=0), "invalid_valid_days"), ("validity over a year", dict(validDays=366), "invalid_valid_days"),
                        ("negative freight", dict(shipping=-5), "invalid_shipping"), ("a 1001-character note", dict(notes="x" * 1001), "invalid_notes"), ("a note that is not text", dict(notes=5), "invalid_notes")]:
    denied(f"{label} is refused", SAVE("S1", s1, TD(**kw)), code)
denied("a payload that is not an object is refused", call("S1", "save_quote_defaults", q(s1), "'[1]'::jsonb"), "invalid_request")
denied("a missing payload is refused", call("S1", "save_quote_defaults", q(s1), "null"), "invalid_request")
bad = {k: v for k, v in TD().items() if k != "gstRate"}
denied("a missing GST is refused", SAVE("S1", s1, bad), "invalid_gst")
check("nothing changed after the refusals", GQ("S1", s1, RID2)["defaults"]["gst_rate"] == 18)
check("saving is audited without private details", SQL(f"select count(*) from audit_log where org_id='{s1}' and action='quote_defaults_saved'") == "2")
check("a note left out is saved as empty", J(SAVE("S1", s1, {k: v for k, v in TD().items() if k != "notes"})).get("notes") == "")
check("the table cannot be read from the browser", not U("S1", "select * from supplier_quote_defaults")[0] and not ANON("select * from supplier_quote_defaults")[0])
check("or written from the browser", not U("S1", f"insert into supplier_quote_defaults(org_id) values ('{s3}')")[0] and not U("S1", f"update supplier_quote_defaults set gst_rate=0 where org_id='{s1}'")[0])
check("it has row level security and no public access", SQL("select relrowsecurity from pg_class where relname='supplier_quote_defaults'") == "t" and SQL("select count(*) from information_schema.table_privileges where grantee in ('anon','authenticated') and table_name='supplier_quote_defaults'") == "0")

# ═══ 6. nothing else changed ═══
check("the decline flow still works", call("S2", "decline_quote_request", q(s2), q(RID), "'no stock'")[0])
check("a buyer still sees both quotes", len(J(call("O", "get_rfq_quotes", q(RID)))["quotes"]) == 1)
# ═══ 7. revising a quote keeps the first reply time (so a late typo fix cannot make a supplier look slow) ═══
SQL(f"update rfq_invites set sent_at = now() - interval '3 days', responded_at = now() - interval '3 days' + interval '2 hours' where rfq_id='{RID}' and supplier_org='{s1}'")
first = SQL(f"select responded_at from rfq_invites where rfq_id='{RID}' and supplier_org='{s1}'")
ok("the supplier revises its quote days later", quote("S1", s1, RID, [1400, 200]))
check("the original reply time is kept", SQL(f"select responded_at from rfq_invites where rfq_id='{RID}' and supplier_org='{s1}'") == first)
check("it is still a quote, now revision 2", SQL(f"select status from rfq_invites where rfq_id='{RID}' and supplier_org='{s1}'") == "quoted" and SQL(f"select revision from quotations where rfq_id='{RID}' and supplier_org='{s1}'") == "2")
check("the buyer sees the revised prices", sorted(float(l["unit_price"]) for l in J(call("O", "get_rfq_quotes", q(RID)))["quotes"][0]["lines"]) == [200.0, 1400.0])
hrs = float(SQL(f"select extract(epoch from responded_at - sent_at) / 3600 from rfq_invites where rfq_id='{RID}' and supplier_org='{s1}'"))
check("Fair Rank still measures this reply as about 2 hours, not 3 days", abs(hrs - 2.0) < 0.05, str(hrs))
SQL(f"update rfq_invites set sent_at = now() - interval '5 days', responded_at = now() - interval '5 days' where rfq_id='{RID}' and supplier_org='{s2}'")
check("(setup) the second supplier had declined", SQL(f"select status from rfq_invites where rfq_id='{RID}' and supplier_org='{s2}'") == "declined")
ok("a supplier that declined can still send a quote", quote("S2", s2, RID, [900, 190]))
check("a quote after a decline is timed from the quote itself", SQL(f"select responded_at > now() - interval '1 minute' from rfq_invites where rfq_id='{RID}' and supplier_org='{s2}'") == "t" and SQL(f"select status from rfq_invites where rfq_id='{RID}' and supplier_org='{s2}'") == "quoted")

before = [i["ready"] for i in LQ("S1", s1)["items"]]
apply(q_mig[0])
check("running migration 19 again changes nothing (data and behaviour)", [i["ready"] for i in LQ("S1", s1)["items"]] == before and GQ("S1", s1, RID2)["defaults"]["gst_rate"] == 12)
print(f"{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
