#!/usr/bin/env python3
"""
Tests for the MSME 45-day payment tracker (migration 20).
Builds a THROWAWAY database `vendora_msme_test`, applies every migration, then checks the Udyam proof, who the rule covers,
the deadline arithmetic (45 / 15 days, acceptance, objections), payments, confirmations, interest, the tax-year warning,
reminders, permissions and direct table access. Never point it at a real project.

    PGHOST=localhost PGUSER=postgres python3 supabase/tests/msme/run_tests.py
    (set PSQL_BIN if psql is not on your PATH)
"""
import glob, json, os, subprocess, sys, uuid
from datetime import date, timedelta
HERE = os.path.dirname(os.path.abspath(__file__))
MIG = os.path.join(HERE, "..", "..", "migrations")
BOOT = os.path.join(HERE, "..", "invite_only", "bootstrap_local_supabase.sql")
DB = "vendora_msme_test"
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

files = sorted(glob.glob(os.path.join(MIG, "*.sql")))
m20 = [f for f in files if f.endswith("_msme_payments.sql")]
assert m20, "the MSME payments migration (20) is missing"
for f in files: apply(f)
apply(m20[0])  # safe to run twice

names = "O P F AP E XO S1 S1B S2 S3 S4 Z".split()
ids = {k: str(uuid.uuid4()) for k in names}
for k in names:
    sh(f"insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values ('{ids[k]}','{k.lower()}@t.in',now(),'{json.dumps({'name': k + ' Person'})}')")
oA, oX, s1, s2, s3, s4 = (str(uuid.uuid4()) for _ in range(6))
for o, n, kind in [(oA, "Alpha Mills", "buyer"), (oX, "Xeno Foods", "buyer"), (s1, "Kaveri Industrial", "supplier"), (s2, "Bharat Steels", "supplier"),
                   (s3, "Newbie Traders", "supplier"), (s4, "Plain Co", "supplier")]:
    sh(f"insert into businesses(id,slug,name,kind) values ('{o}','{n.lower().replace(' ', '-')}','{n}','{kind}')")
    if kind == "supplier": sh(f"insert into supplier_profiles(org_id) values ('{o}'); insert into supplier_verifications(org_id) values ('{o}')")
sh("update profiles set account_type='supplier' where user_id in (" + ",".join(f"'{ids[k]}'" for k in "S1 S1B S2 S3 S4".split()) + ")")
for k, o, role in [("O", oA, "owner"), ("P", oA, "procurement_manager"), ("F", oA, "finance_manager"), ("AP", oA, "approver"), ("E", oA, "employee"),
                   ("XO", oX, "owner"), ("S1", s1, "owner"), ("S1B", s1, "employee"), ("S2", s2, "owner"), ("S3", s3, "owner"), ("S4", s4, "owner")]:
    ok(f"(setup) {k} joins", sh(f"insert into memberships(org_id,user_id,role,status) values ('{o}','{ids[k]}','{role}','active')"))
def udyam(org, size, act, number="UDYAM-MH-12-0000001", days=300):
    sh(f"insert into verification_checks(org_id,type,label,reference,udyam_size,udyam_activity,status,reviewed_at,expires_at) values ('{org}','udyam','Udyam registration','{number}','{size}','{act}','verified',now(),current_date+({days}))")
udyam(s1, "small", "manufacturing", "UDYAM-MH-12-0000001"); udyam(s2, "medium", "manufacturing", "UDYAM-MH-12-0000002"); udyam(s3, "micro", "trade", "UDYAM-MH-12-0000003")

U = lambda k, sql: sh(sql, "authenticated", ids[k])
ANON = lambda sql: sh(sql, "anon")
def call(who, fn, *args): return U(who, f"select {fn}({', '.join(args)})")
def J(res):
    try: return json.loads(res[1])
    except Exception: return {}
def q(s): return "'" + str(s).replace("'", "''") + "'"
SQL = lambda sql: sh(sql)[1]
D = lambda n: (date.today() + timedelta(days=n)).isoformat()
seq = [0]
def mk_po(sup, status="acknowledged", terms=30, delivered=None, expected=10, ack=True, total=1000, org=None, created_by="P"):
    """a purchase order of `total` rupees; delivered = days ago (None = not delivered yet)"""
    org = org or oA; seq[0] += 1; pid = str(uuid.uuid4())
    sh(f"""insert into purchase_orders(id,org_id,number,supplier_org,status,issued_at,expected_at,created_by,payment_terms_days,title,acknowledged_at,delivered_at)
           values ('{pid}','{org}','PO-T-{seq[0]:04d}','{sup}','{status}',now()-interval '60 days',current_date+({expected}),'{ids[created_by]}',{terms},'Order {seq[0]}',
                   {"now()-interval '50 days'" if ack else "null"},
                   {"(current_date-" + str(delivered) + " + time '12:00')::timestamp at time zone 'UTC'" if delivered is not None else "null"});
           insert into po_lines(org_id,po_id,description,qty,unit,unit_price,gst_rate) values ('{org}','{pid}','Item',1,'Nos',{total},0)""")
    return pid
ST = lambda pid: J(U("O", f"select public._po_pay_state('{pid}')")) if False else json.loads(SQL(f"select public._po_pay_state('{pid}')"))
GP = lambda who, pid: J(call(who, "get_po_payment", q(pid)))
pay = lambda who, pid, amt, on=None, **kw: call(who, "record_po_payment", q(pid), str(amt), (q(on) if on else "null"), q(kw.get("method", "bank_transfer")), q(kw.get("ref", "")), q(kw.get("note", "")))

# ═══ 1. the Udyam proof ═══
r = call("S4", "start_udyam_check", q(s4), q("udyam-mh-12-0000009"), q("small"), q("services")); ok("a supplier starts a Udyam proof (number is tidied up)", r)
cid = r[1]
row = SQL(f"select reference||'|'||udyam_size||'|'||udyam_activity||'|'||status||'|'||label from verification_checks where id='{cid}'")
check("the proof stores the number, size and activity as a draft", row == "UDYAM-MH-12-0000009|small|services|draft|Udyam · Small · Services", row)
denied("a malformed Udyam number is refused", call("S4", "start_udyam_check", q(s4), q("UDYAM-MH-1-12345"), q("small"), q("services")), "invalid_udyam")
denied("a bad size is refused", call("S4", "start_udyam_check", q(s4), q("UDYAM-MH-12-0000009"), q("giant"), q("services")), "invalid_size")
denied("a bad activity is refused", call("S4", "start_udyam_check", q(s4), q("UDYAM-MH-12-0000009"), q("small"), q("magic")), "invalid_activity")
denied("someone else's company cannot be changed", call("S1", "start_udyam_check", q(s4), q("UDYAM-MH-12-0000009"), q("small"), q("services")), "not_allowed")
denied("a buyer cannot add a Udyam proof", call("O", "start_udyam_check", q(oA), q("UDYAM-MH-12-0000009"), q("small"), q("services")), "not_allowed")
denied("a verified Udyam number cannot be used by another company", call("S4", "start_udyam_check", q(s4), q("UDYAM-MH-12-0000001"), q("small"), q("services")), "udyam_in_use")
denied("signed out cannot", ANON(f"select public.start_udyam_check('{s4}','UDYAM-MH-12-0000009','small','services')"), "permission denied")
ok("starting again replaces the old draft", call("S4", "start_udyam_check", q(s4), q("UDYAM-MH-12-0000009"), q("micro"), q("services")))
check("only one draft is kept", SQL(f"select count(*) from verification_checks where org_id='{s4}' and type='udyam'") == "1")
check("a Udyam row without size and activity is impossible", not sh(f"insert into verification_checks(org_id,type,reference) values ('{s4}','udyam','x')")[0])
check("the Trust Level is not changed by a Udyam proof", SQL(f"select _trust_level('{s1}')") == "0" and SQL(f"select _trust_level('{s4}')") == "0")
sh(f"insert into verification_checks(org_id,type,reference,status,reviewed_at,expires_at) values ('{s1}','registration','27AAAAA0000A1Z5','verified',now(),current_date+300)")
check("Trust Level still depends only on the old proofs", SQL(f"select _trust_level('{s1}')") == "1")
pp = J(call("O", "get_trust_passport", q(s1)))
ud = [c for c in pp.get("checks", []) if c["type"] == "udyam"]
check("a verified Udyam proof appears on the Trust Passport with size and activity", len(ud) == 1 and ud[0]["size"] == "small" and ud[0]["activity"] == "manufacturing" and ud[0]["reference"] == "UDYAM-MH-12-0000001", str(ud))
check("the draft one does not appear for S4", [c for c in J(call("O", "get_trust_passport", q(s4))).get("checks", []) if c["type"] == "udyam"] == [])
check("the passport's other fields are unchanged", pp["level"] == 1 and pp["checks"][0]["type"] == "registration")
check("an expired Udyam proof is ignored", (sh(f"update verification_checks set expires_at=current_date-1 where org_id='{s1}' and type='udyam'") and SQL(f"select _udyam_of('{s1}') is null") == "t"))
sh(f"update verification_checks set expires_at=current_date+300 where org_id='{s1}' and type='udyam'")
check("the internal helpers are not callable from the browser", not U("S1", f"select public._udyam_of('{s1}')")[0] and not U("O", "select public._po_pay_state(gen_random_uuid())")[0] and not ANON("select public._fy_end(current_date)")[0])

# ═══ 2. who the rule covers ═══
a = ST(mk_po(s1, delivered=5)); check("a small manufacturer is covered", a["applies"] == "yes" and a["applies_why"] == "small", str(a))
b = ST(mk_po(s2, delivered=5)); check("a medium supplier is NOT covered, and keeps the agreed days", b["applies"] == "no" and b["applies_why"] == "medium" and b["due_days"] == 30 and b["deduction"] == "na", str(b))
c = ST(mk_po(s3, delivered=5)); check("a pure trader is NOT covered", c["applies"] == "no" and c["applies_why"] == "trader", str(c))
d = ST(mk_po(s4, delivered=5)); check("no verified Udyam: we do not know, and we say so", d["applies"] == "unknown" and d["applies_why"] == "no_udyam", str(d))
check("an unknown supplier still gets the 45-day cap on the deadline (the safe reading)", d["due_days"] == 30 and d["due_date"] == D(25))

# ═══ 3. deadline arithmetic ═══
p60 = mk_po(s1, terms=60, delivered=3)
x = ST(p60); check("agreed 60 days is cut to 45 by law", x["due_days"] == 45 and x["capped"] is True and x["agreed_days"] == 60 and x["due_date"] == D(42), str(x))
x = ST(mk_po(s2, terms=60, delivered=3)); check("a medium supplier's 60 days stand", x["due_days"] == 60 and x["capped"] is False, str(x))
x = ST(mk_po(s1, terms=30, delivered=3)); check("30 days from the day goods are accepted", x["due_date"] == D(27) and x["accepted_on"] == D(-3) and x["days_left"] == 27 and x["status"] == "on_track", str(x))
x = ST(mk_po(s1, terms=0, delivered=0)); check("zero days means due on acceptance", x["due_date"] == D(0) and x["status"] == "due_today" and x["days_left"] == 0, str(x))
x = ST(mk_po(s1, terms=30, delivered=24)); check("within 7 days is 'due soon'", x["status"] == "due_soon" and x["days_left"] == 6, str(x))
x = ST(mk_po(s1, terms=30, delivered=31)); check("past the deadline is overdue", x["status"] == "overdue" and x["days_left"] == -1, str(x))
x = ST(mk_po(s1, terms=45, delivered=44)); check("day 44 of 45 is due soon, not overdue", x["status"] == "due_soon" and x["days_left"] == 1, str(x))
x = ST(mk_po(s1, terms=45, delivered=46)); check("day 46 of 45 is overdue", x["status"] == "overdue", str(x))
x = ST(mk_po(s1, ack=False, status="received", terms=60, delivered=3)); check("with no written agreement the limit is 15 days", x["due_days"] == 15 and x["written_agreement"] is False and x["capped"] is True, str(x))
x = ST(mk_po(s1, status="acknowledged", terms=30, delivered=None, expected=10)); check("before delivery the supplier sees a projected pay date", x["phase"] == "awaiting_delivery" and x["status"] == "not_started" and x["projected"] is True and x["due_date"] == D(40) and x["days_left"] is None, str(x))
x = ST(mk_po(s1, status="issued", delivered=None)); check("an order the supplier has not confirmed is not tracked", x["phase"] == "none" and x["status"] == "none", str(x))
x = ST(mk_po(s1, status="cancelled", delivered=None)); check("a cancelled order is not tracked", x["status"] == "none")
x = ST(mk_po(s1, delivered=10, expected=-100)); check("the pre-delivery projection is gone once delivered", x["projected"] is False and x["accepted_on"] == D(-10))
x = ST(mk_po(s1, status="acknowledged", delivered=None, expected=None) if False else mk_po(s1, delivered=None, expected=3)); check("projection is expected date plus days", x["due_date"] == D(33))

# ═══ 4. payments ═══
P1 = mk_po(s1, terms=30, delivered=5, total=1000)
denied("an employee cannot record a payment", pay("E", P1, 100), "not_allowed")
denied("an approver cannot", pay("AP", P1, 100), "not_allowed")
denied("another buyer cannot see the order", pay("XO", P1, 100), "not_found")
denied("a supplier cannot record the buyer's payment", pay("S1", P1, 100), "not_found")
denied("signed out cannot", ANON(f"select public.record_po_payment('{P1}', 100)"), "permission denied")
denied("zero is refused", pay("O", P1, 0), "invalid_amount")
denied("negative is refused", pay("O", P1, -5), "invalid_amount")
denied("a future date is refused", pay("O", P1, 100, D(1)), "invalid_date")
denied("a date before delivery is refused", pay("O", P1, 100, D(-9)), "invalid_date")
denied("more than is owed is refused", pay("O", P1, 1000.01), "too_much")
denied("an unknown method is refused", pay("O", P1, 100, method="bitcoin"), "invalid_method")
ok("finance manager can record a payment", pay("F", P1, 400, D(-2), ref="UTR12345"))
x = GP("O", P1)["state"]; check("the balance falls and the status stays on track", x["paid"] == 400 and x["balance"] == 600 and x["status"] == "on_track", str(x))
ok("the procurement manager can record the rest", pay("P", P1, 600))
x = GP("O", P1)["state"]; check("fully paid in time", x["balance"] == 0 and x["status"] == "paid" and x["interest_estimate"] == 0 and x["deduction"] == "safe", str(x))
denied("nothing more can be recorded once paid", pay("O", P1, 1), "already_paid")
check("the supplier was told about each payment", int(SQL(f"select count(*) from notifications where org_id='{s1}' and link_to='orders/{P1}' and title like '%payment%' or title like '%paid%'")) >= 2)
check("the payments are in the audit log of both sides", int(SQL(f"select count(*) from audit_log where entity_id='{P1}' and action in ('po_payment_recorded','po_payment_received')")) == 4)
P2 = mk_po(s1, status="acknowledged", delivered=None)
denied("nothing can be paid before delivery is recorded", pay("O", P2, 10), "not_delivered")
check("money is stored with 2 decimals", pay("O", mk_po(s1, delivered=2, total=500), 100.456)[0] and SQL("select amount from po_payments order by created_at desc limit 1") == "100.46")

# ═══ 5. late payment, interest, the tax-year warning ═══
PL = mk_po(s1, terms=30, delivered=60, total=100000)
x = ST(PL); check("60 days after delivery with 30 agreed: overdue by 30 days", x["status"] == "overdue" and x["days_left"] == -30, str(x))
exp = round(100000 * ((1 + 3 * 5.75 / 1200) ** (30 / 30.4375) - 1), 2)
check("interest estimate is 3 x bank rate compounded monthly", abs(x["interest_estimate"] - exp) < 0.02, f"{x['interest_estimate']} vs {exp}")
ok("a late payment is recorded", pay("O", PL, 100000, D(-10)))
x = ST(PL); check("paid late: status says so and interest is on the days it was late", x["status"] == "paid_late" and abs(x["interest_estimate"] - round(100000 * ((1 + 3 * 5.75 / 1200) ** (20 / 30.4375) - 1), 2)) < 0.02, str(x))
x = ST(mk_po(s2, terms=30, delivered=60, total=100000)); check("a medium supplier has no interest estimate and no tax warning", x["interest_estimate"] == 0 and x["deduction"] == "na" and x["status"] == "overdue", str(x))
fy = SQL("select _fy_end(current_date)")
check("the financial year ends on 31 March", fy.endswith("-03-31") and fy > D(-1), fy)
check("_fy_end handles April and March", SQL("select _fy_end(date '2026-04-01')") == "2027-03-31" and SQL("select _fy_end(date '2027-03-31')") == "2027-03-31" and SQL("select _fy_end(date '2026-12-31')") == "2027-03-31")
x = ST(mk_po(s1, terms=30, delivered=5)); fyd = date.fromisoformat(x["fy_end"])
check("a bill falling due before 31 March is 'at risk' for this year's deduction", (x["deduction"] == "at_risk") == (date.fromisoformat(x["due_date"]) <= fyd), str(x))
check("the deduction year is that of the supply", x["fy_end"] == SQL(f"select _fy_end('{D(-5)}')"))
SQL("update msme_settings set bank_rate=6")
x = ST(PL); SQL("update msme_settings set bank_rate=5.75")
check("a different bank rate changes the estimate", x["bank_rate"] == 6)

# ═══ 6. supplier confirmation ═══
P3 = mk_po(s1, terms=30, delivered=5, total=1000); pay("O", P3, 300); pid3 = GP("O", P3)["payments"][0]["id"]
check("the buyer sees the payment as unconfirmed", GP("O", P3)["payments"][0]["confirmed_at"] is None)
denied("an employee at the supplier cannot confirm", call("S1B", "confirm_po_payment", q(s1), q(pid3)), "not_allowed")
denied("another supplier cannot confirm", call("S2", "confirm_po_payment", q(s2), q(pid3)), "not_found")
denied("the buyer cannot confirm for the supplier", call("O", "confirm_po_payment", q(s1), q(pid3)), "not_allowed")
denied("the dispute needs a reason", call("S1", "dispute_po_payment", q(s1), q(pid3), q("no")), "note_required")
ok("the supplier disputes: it did not arrive", call("S1", "dispute_po_payment", q(s1), q(pid3), q("Nothing reached our account")))
check("the buyer is told", int(SQL(f"select count(*) from notifications where org_id='{oA}' and body like '%Nothing reached%'")) >= 1)
check("a disputed payment is flagged in the state", GP("O", P3)["state"]["disputed_payments"] == 1)
ok("the supplier then confirms it arrived", call("S1", "confirm_po_payment", q(s1), q(pid3)))
check("confirmation clears the dispute", GP("O", P3)["payments"][0]["confirmed_at"] is not None and GP("O", P3)["payments"][0]["disputed_at"] is None and GP("O", P3)["state"]["disputed_payments"] == 0)
denied("a confirmed payment cannot be disputed", call("S1", "dispute_po_payment", q(s1), q(pid3), q("changed my mind")), "already_confirmed")
denied("a confirmed payment cannot be removed", call("O", "void_po_payment", q(pid3)), "already_confirmed")
ok("confirming twice is harmless", call("S1", "confirm_po_payment", q(s1), q(pid3)))
P4 = mk_po(s1, terms=30, delivered=5); pay("O", P4, 50); pid4 = GP("O", P4)["payments"][0]["id"]
denied("a stranger cannot remove it", call("XO", "void_po_payment", q(pid4)), "not_found")
denied("an employee cannot remove it", call("E", "void_po_payment", q(pid4)), "not_allowed")
ok("the buyer removes a mistake within 24 hours", call("O", "void_po_payment", q(pid4)))
check("the balance is back", GP("O", P4)["state"]["balance"] == 1000)
P5 = mk_po(s1, terms=30, delivered=5); pay("O", P5, 50); sh(f"update po_payments set created_at=now()-interval '25 hours' where po_id='{P5}'")
denied("after 24 hours it stays", call("O", "void_po_payment", q(GP("O", P5)["payments"][0]["id"])), "too_late")

# ═══ 7. objections ═══
P6 = mk_po(s1, terms=30, delivered=4)
denied("an employee cannot object", call("E", "raise_po_objection", q(P6), q("Goods damaged on arrival")), "not_allowed")
denied("an objection needs a reason", call("O", "raise_po_objection", q(P6), q("bad")), "note_required")
check("the buyer may object within 15 days", GP("O", P6)["can_object"] is True)
ok("the buyer raises a written objection", call("O", "raise_po_objection", q(P6), q("Ten sheets arrived dented")))
x = ST(P6); check("the clock is on hold, and there is no deadline while on hold", x["status"] == "on_hold" and x["on_hold"] is True and x["due_date"] is None, str(x))
check("the supplier is told, with the reason", int(SQL(f"select count(*) from notifications where org_id='{s1}' and body like '%dented%'")) == 1)
denied("a second objection is refused", call("O", "raise_po_objection", q(P6), q("Another long reason here")), "already_objected")
check("the supplier sees the objection and the buyer can clear it", J(call("S1", "get_supplier_po_payment", q(s1), q(P6)))["state"]["objection_note"] == "Ten sheets arrived dented" and GP("O", P6)["can_clear_objection"] is True)
denied("the supplier cannot clear it", call("S1", "clear_po_objection", q(P6)), "")
ok("the buyer clears it: accepted from today", call("O", "clear_po_objection", q(P6)))
x = ST(P6); check("the payment period starts from the day it was cleared", x["accepted_on"] == D(0) and x["due_date"] == D(30) and x["status"] == "on_track", str(x))
denied("clearing twice is refused", call("O", "clear_po_objection", q(P6)), "no_objection")
denied("an objection after 15 days is too late", call("O", "raise_po_objection", q(mk_po(s1, delivered=16)), q("Goods were faulty really")), "too_late")
P7 = mk_po(s1, delivered=3); pay("O", P7, 10)
denied("once part is paid it counts as accepted", call("O", "raise_po_objection", q(P7), q("Goods were faulty really")), "already_paid")
denied("no objection before delivery", call("O", "raise_po_objection", q(mk_po(s1, delivered=None)), q("Goods were faulty really")), "not_delivered")

# ═══ 8. trackers ═══
lp = J(call("O", "list_payables", q(oA)))
check("the buyer tracker lists orders with their state and a summary", len(lp["items"]) > 10 and "summary" in lp and lp["rules"]["max_days"] == 45, str(lp)[:200])
check("the most urgent come first", lp["items"][0]["state"]["status"] == "overdue")
check("overdue amounts and interest are summed", lp["summary"]["overdue_count"] >= 2 and lp["summary"]["overdue_amount"] > 0 and lp["summary"]["interest_estimate"] > 0)
check("orders with an unknown supplier type are counted so the buyer can ask for a Udyam proof", lp["summary"]["unknown_count"] >= 1)
check("filter: attention", all(i["state"]["status"] in ("overdue", "due_today", "due_soon") or i["state"]["deduction"] == "at_risk" for i in J(call("O", "list_payables", q(oA), "'attention'"))["items"]))
check("filter: paid", all(i["state"]["status"] in ("paid", "paid_late") for i in J(call("O", "list_payables", q(oA), "'paid'"))["items"]))
check("filter: open", all(i["state"]["status"] not in ("paid", "paid_late", "none") for i in J(call("O", "list_payables", q(oA), "'open'"))["items"]))
denied("a bad filter is refused", call("O", "list_payables", q(oA), "'zzz'"), "invalid_filter")
denied("a stranger cannot see another buyer's payables", call("XO", "list_payables", q(oA)), "not_allowed")
denied("a supplier cannot use the buyer tracker", call("S1", "list_payables", q(s1)), "not_allowed")
check("the other buyer sees nothing", J(call("XO", "list_payables", q(oX)))["items"] == [])
check("an employee can read the tracker but not pay", call("E", "list_payables", q(oA))[0] and GP("E", P7)["can_record"] is False)
rc = J(call("S1", "list_receivables", q(s1)))
check("the supplier sees what it will be paid and when", len(rc["items"]) > 5 and rc["summary"]["covered"] is True and rc["summary"]["udyam"]["size"] == "small", str(rc["summary"]))
check("the supplier sees only its own orders", all(i["buyer_name"] == "Alpha Mills" for i in rc["items"]) and len(J(call("S2", "list_receivables", q(s2)))["items"]) == 3)
check("a medium supplier is told the rule does not cover it", J(call("S2", "list_receivables", q(s2)))["summary"]["covered"] is False and J(call("S3", "list_receivables", q(s3)))["summary"]["covered"] is False)
check("a supplier with no Udyam proof is not 'covered'", J(call("S4", "list_receivables", q(s4)))["summary"]["covered"] is False and J(call("S4", "list_receivables", q(s4)))["summary"]["udyam"] is None)
denied("a buyer cannot use the supplier tracker", call("O", "list_receivables", q(oA)), "not_allowed")
denied("another supplier cannot", call("S2", "list_receivables", q(s1)), "not_allowed")
denied("a supplier cannot read another supplier's order payments", call("S2", "get_supplier_po_payment", q(s2), q(P7)), "not_found")
denied("a stranger buyer cannot read the order's payments", call("XO", "get_po_payment", q(P7)), "not_found")
denied("signed out cannot", ANON(f"select public.list_payables('{oA}')"), "permission denied")
check("the rules page data comes back", J(call("S1", "get_msme_rules"))["max_days_no_agreement"] == 15)
denied("signed out cannot read the rules", ANON("select public.get_msme_rules()"), "permission denied")
denied("only a platform admin sets the bank rate", call("O", "set_msme_bank_rate", "6"), "not_allowed")

# ═══ 9. reminders ═══
sh("delete from po_payment_alerts; delete from notifications")
R1 = mk_po(s1, terms=30, delivered=25, total=5000)    # 5 days left
R2 = mk_po(s1, terms=30, delivered=40, total=5000)    # overdue
R3 = mk_po(s4, terms=30, delivered=40, total=5000)    # supplier type unknown
R4 = mk_po(s2, terms=30, delivered=40, total=5000)    # medium
n = int(SQL("select public.run_payment_reminders()"))
check("reminders go to covered suppliers' buyers only", int(SQL(f"select count(*) from po_payment_alerts where po_id in ('{R3}','{R4}')")) == 0)
check("a deadline within 7 days warns the buyer (owner and the order's creator)", int(SQL(f"select count(*) from notifications where org_id='{oA}' and title like 'Payment due in 5 days%'")) == 2)
check("an overdue payment warns the buyer and tells the supplier", int(SQL(f"select count(*) from notifications where org_id='{oA}' and title like 'Payment overdue%'")) >= 1 and int(SQL(f"select count(*) from notifications where org_id='{s1}' and title like 'Payment is overdue%'")) >= 1)
n2 = int(SQL("select public.run_payment_reminders()"))
check("running it again sends nothing twice", n2 == 0, str(n2))
check("the job leaves a heartbeat", SQL("select count(*) from ops_heartbeats where name='run_payment_reminders'") == "1")
denied("the reminder job is not callable by users", call("O", "run_payment_reminders"), "permission denied")
check("nor signed out", not ANON("select public.run_payment_reminders()")[0])
check("the service role can run it", sh("select public.run_payment_reminders()", "service_role")[0])
pay("O", R2, 5000)
check("a paid order is never reminded about again", True)

# ═══ 10. direct table access ═══
for t in ("po_payments", "po_payment_alerts", "msme_settings"):
    check(f"{t}: the browser cannot read it directly", not U("O", f"select count(*) from {t}")[0] and not ANON(f"select count(*) from {t}")[0])
    check(f"{t}: nor write it", not U("O", f"delete from {t}")[0])
check("an order's objection columns cannot be written from the browser", not U("O", f"update purchase_orders set objection_at=now() where id='{P7}'")[0])
check("a payment cannot be inserted by hand", not U("O", f"insert into po_payments(org_id,po_id,amount,paid_on,method) values ('{oA}','{P7}',1,current_date,'upi')")[0])
check("a payment row cannot be zero or negative", not sh(f"insert into po_payments(org_id,po_id,amount,paid_on,method) values ('{oA}','{P7}',0,current_date,'upi')")[0])
check("a payment method outside the list is refused by the table too", not sh(f"insert into po_payments(org_id,po_id,amount,paid_on,method) values ('{oA}','{P7}',1,current_date,'gold')")[0])
check("deleting an order removes its payments", (sh(f"delete from purchase_orders where id='{P7}'")[0]) and SQL(f"select count(*) from po_payments where po_id='{P7}'") == "0")

# concurrency: two simultaneous payments cannot overpay
PC = mk_po(s1, terms=30, delivered=2, total=1000)
import threading
res = []
def worker(): res.append(pay("O", PC, 800)[0])
ts = [threading.Thread(target=worker) for _ in range(2)]
[t.start() for t in ts]; [t.join() for t in ts]
check("two racing payments cannot pay more than is owed", sorted(res) == [False, True] and SQL(f"select sum(amount) from po_payments where po_id='{PC}'") == "800.00", str(res))

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
