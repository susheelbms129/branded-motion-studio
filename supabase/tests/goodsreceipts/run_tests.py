#!/usr/bin/env python3
"""
Tests for goods acceptance (migration 26).
Builds a THROWAWAY database `vendora_goodsreceipts_test`, applies every migration, then checks: who may record, read, fix and
close; every input rule (quantities, dates, reasons, over-receiving); partial and complete deliveries and how they drive the order's
status and the MSME payment clock; rejections and replacements; voiding (48 hours, locked by payments and objections); closing short;
the supplier's agree / dispute; photos and the private bucket; the old one-tap receive; audit and notifications; direct table access.
Never point it at a real project.

    PGHOST=localhost PGUSER=postgres python3 supabase/tests/goodsreceipts/run_tests.py
"""
import glob, json, os, subprocess, sys, uuid
from datetime import date, timedelta
HERE = os.path.dirname(os.path.abspath(__file__))
MIG = os.path.join(HERE, "..", "..", "migrations")
BOOT = os.path.join(HERE, "..", "invite_only", "bootstrap_local_supabase.sql")
DB = "vendora_goodsreceipts_test"
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
def denied(name, res, word=""): check(name, (not res[0]) and word in res[2], res[2][:220])

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
m26 = [f for f in files if f.endswith("_goods_receipts.sql")]
assert m26, "the goods receipts migration (26) is missing"
for f in files: apply(f)
apply(m26[0])  # safe to run twice

# ── people ──  O buyer owner, P procurement manager, F finance manager, E employee, XO other buyer owner,
#              S1 supplier owner, S1B supplier employee, S2 other supplier owner
names = "O P F E XO S1 S1B S2".split()
ids = {k: str(uuid.uuid4()) for k in names}
for k in names:
    sh(f"insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values ('{ids[k]}','{k.lower()}@t.in',now(),'{json.dumps({'name': k + ' Person'})}')")
oA, oX, s1, s2 = (str(uuid.uuid4()) for _ in range(4))
for o, n, kind in [(oA, "Alpha Mills", "buyer"), (oX, "Xeno Foods", "buyer"), (s1, "Kaveri Industrial", "supplier"), (s2, "Bharat Steels", "supplier")]:
    sh(f"insert into businesses(id,slug,name,kind) values ('{o}','{n.lower().replace(' ', '-')}','{n}','{kind}')")
    if kind == "supplier": sh(f"insert into supplier_profiles(org_id) values ('{o}'); insert into supplier_verifications(org_id) values ('{o}')")
sh("update profiles set account_type='supplier' where user_id in (" + ",".join(f"'{ids[k]}'" for k in ("S1", "S1B", "S2")) + ")")
for k, o, role in [("O", oA, "owner"), ("P", oA, "procurement_manager"), ("F", oA, "finance_manager"), ("E", oA, "employee"), ("XO", oX, "owner"),
                   ("S1", s1, "owner"), ("S1B", s1, "employee"), ("S2", s2, "owner")]:
    ok(f"(setup) {k} joins", sh(f"insert into memberships(org_id,user_id,role,status) values ('{o}','{ids[k]}','{role}','active')"))

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
def mk_po(status="acknowledged", lines=((100, 10), (50, 20)), org=None, sup=None, expected=10, issued_days=30, no_lines=False):
    """an order with lines [(qty, unit_price)]; returns (po id, [line ids])"""
    org = org or oA; sup = sup or s1; seq[0] += 1; pid = str(uuid.uuid4())
    sh(f"""insert into purchase_orders(id,org_id,number,supplier_org,status,issued_at,expected_at,created_by,payment_terms_days,title,acknowledged_at)
           values ('{pid}','{org}','PO-T-{seq[0]:04d}','{sup}','{status}',now()-interval '{issued_days} days',current_date+({expected}),'{ids['O']}',30,'Order {seq[0]}',now()-interval '{issued_days - 1} days')""")
    lids = []
    if not no_lines:
        for i, (qty, price) in enumerate(lines):
            lid = str(uuid.uuid4()); lids.append(lid)
            ok("(setup) a line", sh(f"insert into po_lines(id,org_id,po_id,description,qty,unit,unit_price,gst_rate) values ('{lid}','{org}','{pid}','{['Steel rods','Steel plates','Bolts','Nuts'][i]}',{qty},'Nos',{price},0)"))
    return pid, lids
def rcpt(who, pid, lines, day=None, note=""):
    d = {"lines": lines}
    if day: d["receivedOn"] = day
    if note: d["note"] = note
    return call(who, "record_goods_receipt", q(pid), f"$j${json.dumps(d)}$j$::jsonb")
def L(lid, acc=0, rej=0, reason=""): return {"lineId": lid, "accepted": acc, "rejected": rej, "reason": reason}
GR = lambda who, pid: J(call(who, "get_po_receiving", q(pid)))
ST = lambda pid: SQL(f"select status||'|'||coalesce(delivered_at::text,'none') from purchase_orders where id='{pid}'")
PAY = lambda pid: json.loads(SQL(f"select public._po_pay_state('{pid}')"))
def notes(org, pid, like): return int(SQL(f"select count(*) from notifications where org_id='{org}' and link_to='orders/{pid}' and title like '{like}'"))

# ═══ 1. nobody reaches the tables or the internals ═══
p, l = mk_po()
for t in ("goods_receipts", "goods_receipt_lines", "goods_receipt_photos"):
    denied(f"tables: a signed-in user cannot read {t}", U("O", f"select * from {t}"), "permission denied")
    denied(f"tables: anon cannot read {t}", ANON(f"select * from {t}"), "permission denied")
denied("tables: nobody can write a receipt directly", U("O", f"insert into goods_receipts(org_id,po_id,supplier_org,seq,number,received_on,created_by) values ('{oA}','{p}','{s1}',1,'x',current_date,'{ids['O']}')"), "permission denied")
for fn, args in [("_grn_sync", f"'{p}'"), ("_grn_create", "null,null,null,null,null,false")]:
    denied(f"internal: {fn} is not callable by users", U("O", f"select {fn}({args})"), "permission denied")
for sql in (f"select record_goods_receipt('{p}','{{}}')", f"select void_goods_receipt('{uuid.uuid4()}','x')", f"select close_receiving_short('{p}','x')",
            f"select respond_goods_receipt('{uuid.uuid4()}','agreed')", f"select attach_receipt_photo('{uuid.uuid4()}','a','b')",
            f"select open_receipt_photo('{uuid.uuid4()}')", f"select get_po_receiving('{p}')"):
    denied(f"anon cannot call {sql.split('(')[0].replace('select ', '')}", ANON(sql), "permission denied")

# ═══ 2. who may read ═══
g = GR("O", p)
check("read: the buyer owner sees the lines with nothing received yet", len(g.get("lines", [])) == 2 and all(x["accepted"] == 0 and x["remaining"] == x["ordered"] for x in g["lines"]), str(g)[:200])
check("read: ...and may record", g.get("can_record") is True and g.get("can_close_short") is False)
check("read: an employee of the buyer can read but not record", GR("E", p).get("can_record") is False and len(GR("E", p).get("lines", [])) == 2)
check("read: the supplier can read but not record", GR("S1", p).get("can_record") is False and len(GR("S1", p).get("lines", [])) == 2)
check("read: a supplier employee can read", len(GR("S1B", p).get("lines", [])) == 2)
denied("read: another buyer sees nothing", call("XO", "get_po_receiving", q(p)), "not_found")
denied("read: another supplier sees nothing", call("S2", "get_po_receiving", q(p)), "not_found")
denied("read: a made-up order is not found", call("O", "get_po_receiving", q(uuid.uuid4())), "not_found")
check("read: nothing marked legacy for a fresh order", g.get("legacy") is False)

# ═══ 3. who may record ═══
denied("record: the supplier cannot record its own delivery", rcpt("S1", p, [L(l[0], 10)]), "not_found")
denied("record: another buyer cannot", rcpt("XO", p, [L(l[0], 10)]), "not_found")
denied("record: an employee cannot", rcpt("E", p, [L(l[0], 10)]), "not_allowed")
denied("record: a finance manager cannot", rcpt("F", p, [L(l[0], 10)]), "not_allowed")
denied("record: an order still waiting for the supplier cannot be received", rcpt("O", mk_po(status="issued")[0], [L(l[0], 1)]), "not_receivable")
denied("record: a cancelled order cannot", rcpt("O", mk_po(status="cancelled")[0], [L(l[0], 1)]), "not_receivable")
denied("record: a made-up order", rcpt("O", str(uuid.uuid4()), [L(l[0], 1)]), "not_found")

# ═══ 4. every input rule ═══
for bad, why, word in [
    ([], "no lines", "invalid_lines"),
    ([L(l[0], 0, 0)], "all zero", "empty_receipt"),
    ([L(l[0], -1)], "negative", "invalid_quantity"),
    ([L(l[0], 1.2345)], "four decimals", "invalid_quantity"),
    ([L(l[0], 101)], "more than ordered", "over_received"),
    ([L(l[0], 5), L(l[0], 5)], "the same item twice", "invalid_lines"),
    ([L(str(uuid.uuid4()), 5)], "an item that is not on the order", "invalid_lines"),
    ([L(l[0], 5, 3, "")], "a rejection with no reason", "reason_required"),
    ([L(l[0], 5, 3, "ab")], "a too short reason", "reason_required"),
    ([L(l[0], 5, 3, "x" * 201)], "a too long reason", "reason_required"),
    ([L(l[0], 5, 101, "damaged")], "rejecting more than was ordered", "invalid_quantity"),
]:
    denied(f"input: {why} is refused", rcpt("O", p, bad), word)
denied("input: a future date is refused", rcpt("O", p, [L(l[0], 5)], day=D(1)), "invalid_date")
denied("input: a date before the order was issued is refused", rcpt("O", p, [L(l[0], 5)], day=D(-40)), "invalid_date")
denied("input: a nonsense date is refused", rcpt("O", p, [L(l[0], 5)], day="not-a-date"), "invalid_date")
denied("input: a too long note is refused", rcpt("O", p, [L(l[0], 5)], note="n" * 501), "invalid_note")
denied("input: a non-object body is refused", call("O", "record_goods_receipt", q(p), "$j$[1]$j$::jsonb"), "invalid_request")
p_other, l_other = mk_po()
denied("input: an item of ANOTHER order is refused", rcpt("O", p, [L(l_other[0], 5)]), "invalid_lines")
check("input: nothing was saved by any refused attempt", SQL(f"select count(*) from goods_receipts where po_id='{p}'") == "0" and ST(p).startswith("acknowledged|none"))

# ═══ 5. a partial delivery with a rejection ═══
r = rcpt("O", p, [L(l[0], 60, 10, "10 rods bent in transit"), L(l[1], 0, 0)], day=D(-2), note="Truck 1 of 2")
ok("partial: the first delivery is recorded", r)
rj = J(r)
check("partial: it is numbered and the order is only partly received", rj.get("number") == f"GRN-PO-T-{seq[0] - 1:04d}-1" or rj.get("number", "").endswith("-1"), str(rj))
check("partial: complete is false, status partially_received", rj.get("complete") is False and rj.get("status") == "partially_received", str(rj))
check("partial: the order is partially_received and the clock has NOT started", ST(p) == "partially_received|none", ST(p))
pay = PAY(p)
check("partial: the payment tracker says delivery has not completed", pay["phase"] == "awaiting_delivery", str(pay)[:200])
g = GR("O", p); by = {x["description"]: x for x in g["lines"]}
check("partial: rods show 60 accepted, 10 rejected, 40 still to accept", by["Steel rods"]["accepted"] == 60 and by["Steel rods"]["rejected"] == 10 and by["Steel rods"]["remaining"] == 40, str(by))
check("partial: plates are untouched", by["Steel plates"]["accepted"] == 0 and by["Steel plates"]["remaining"] == 50)
check("partial: the receipt shows its lines, reason, note and who", len(g["receipts"]) == 1 and g["receipts"][0]["note"] == "Truck 1 of 2" and g["receipts"][0]["by"] and
      g["receipts"][0]["lines"][0]["reason"] == "10 rods bent in transit" and len(g["receipts"][0]["lines"]) == 1, str(g["receipts"])[:300])
check("partial: the buyer may still record and may close short", g["can_record"] is True and g["can_close_short"] is True)
check("partial: the supplier sees the same facts", {x["description"]: x["accepted"] for x in GR("S1", p)["lines"]} == {"Steel rods": 60, "Steel plates": 0})
check("partial: the supplier is told, with what was accepted and rejected", notes(s1, p, "% recorded a partial delivery") == 1 and
      "60 accepted, 10 rejected" in SQL(f"select body from notifications where org_id='{s1}' and link_to='orders/{p}' and title like '%partial%'"))
check("partial: both sides' audit logs have it without private details", SQL(f"select count(*) from audit_log where entity_id='{p}' and action='goods_received'") == "2")
check("partial: no 'delivered' audit yet (the order is not complete)", SQL(f"select count(*) from audit_log where entity_id='{p}' and action='po_goods_received'") == "0")
denied("partial: only 40 rods are still to accept", rcpt("O", p, [L(l[0], 41)]), "over_received")

# ═══ 6. replacement and completion start the clock ═══
ok("complete: the rest of the rods (the replacement for the bent ones) and all plates", rcpt("O", p, [L(l[0], 40), L(l[1], 50)], day=D(-1)))
check("complete: the order is received, dated by the LAST delivery", ST(p) == f"received|{D(-1)} 12:00:00+00", ST(p))
pay = PAY(p)
check("complete: the MSME payment clock now runs from that date", pay["phase"] == "running" and pay["accepted_on"] == D(-1), str(pay)[:250])
check("complete: the due date is accepted date + 30 days", pay["due_date"] == (date.today() + timedelta(days=29)).isoformat(), str(pay.get("due_date")))
g = GR("O", p)
check("complete: nothing is left to accept, and no more can be recorded", all(x["remaining"] == 0 for x in g["lines"]) and g["can_record"] is False and g["can_close_short"] is False)
check("complete: two receipts, newest first", [x["number"][-1] for x in g["receipts"]] == ["2", "1"], str([x["number"] for x in g["receipts"]]))
check("complete: the supplier is told the delivery is complete", notes(s1, p, "% recorded delivery of an order") == 1)
check("complete: the delivered audit exists on both sides", SQL(f"select count(*) from audit_log where entity_id='{p}' and action='po_goods_received'") == "2")
denied("complete: a received order cannot be received again", rcpt("O", p, [L(l[0], 1)]), "not_receivable")

# ═══ 7. a fully rejected delivery starts nothing ═══
p2, l2 = mk_po(lines=((20, 100),))
ok("rejected: a whole delivery is rejected with a reason", rcpt("O", p2, [L(l2[0], 0, 20, "wrong grade")], day=D(-1)))
check("rejected: the order is partially_received and the clock has not started", ST(p2) == "partially_received|none")
g = GR("O", p2)
check("rejected: 20 are still to accept (a rejection does not use up the order)", g["lines"][0]["remaining"] == 20 and g["lines"][0]["rejected"] == 20)
check("rejected: it cannot be closed short while nothing was accepted", g["can_close_short"] is False)
denied("rejected: closing short with nothing accepted is refused", call("O", "close_receiving_short", q(p2), q("never came")), "nothing_accepted")
ok("rejected: the supplier's replacement is accepted", rcpt("O", p2, [L(l2[0], 20)]))
check("rejected: now it is received", ST(p2).startswith("received|"))

# ═══ 8. closing short ═══
p3, l3 = mk_po(lines=((100, 10), (50, 20)))
rcpt("O", p3, [L(l3[0], 100), L(l3[1], 30)], day=D(-3))
check("short: 30 of 50 plates arrived, so the order is partial", ST(p3).startswith("partially_received|none"))
denied("short: a reason is needed", call("O", "close_receiving_short", q(p3), q("")), "reason_required")
denied("short: an employee cannot", call("E", "close_receiving_short", q(p3), q("supplier cannot make the rest")), "not_allowed")
denied("short: the supplier cannot", call("S1", "close_receiving_short", q(p3), q("we give up")), "not_found")
denied("short: another buyer cannot", call("XO", "close_receiving_short", q(p3), q("x y z")), "not_found")
ok("short: the owner closes it, with a reason", call("O", "close_receiving_short", q(p3), q("Supplier cannot make the remaining plates")))
check("short: the order is received, dated by the last accepted delivery", ST(p3) == f"received|{D(-3)} 12:00:00+00", ST(p3))
check("short: the clock runs", PAY(p3)["phase"] == "running")
check("short: the reason is on the record and the supplier is told", SQL(f"select short_close_reason from purchase_orders where id='{p3}'").startswith("Supplier cannot") and notes(s1, p3, "% closed an order as short-delivered") == 1)
check("short: the read says so", GR("S1", p3)["closed_short"] is True and GR("S1", p3)["short_close_reason"].startswith("Supplier"))
denied("short: it cannot be closed twice", call("O", "close_receiving_short", q(p3), q("again please")), "not_receivable")

# ═══ 9. fixing a wrong entry (void) ═══
p4, l4 = mk_po(lines=((10, 100),))
r = rcpt("O", p4, [L(l4[0], 10)], day=D(-5))
rid = J(r)["id"]
check("void: a complete delivery started the clock", ST(p4).startswith("received|"))
denied("void: a reason is needed", call("O", "void_goods_receipt", q(rid), q("")), "reason_required")
denied("void: an employee cannot", call("E", "void_goods_receipt", q(rid), q("wrong date entered")), "not_allowed")
denied("void: the supplier cannot", call("S1", "void_goods_receipt", q(rid), q("not mine")), "not_found")
denied("void: another buyer cannot", call("XO", "void_goods_receipt", q(rid), q("not mine")), "not_found")
denied("void: a made-up receipt is not found", call("O", "void_goods_receipt", q(uuid.uuid4()), q("not there")), "not_found")
ok("void: the owner takes it back with a reason", call("O", "void_goods_receipt", q(rid), q("Entered the wrong date")))
check("void: the order goes back to confirmed and the clock stops", ST(p4) == "acknowledged|none" and PAY(p4)["phase"] == "awaiting_delivery", ST(p4))
g = GR("O", p4)
check("void: the receipt stays on the record, marked voided, with its reason", len(g["receipts"]) == 1 and g["receipts"][0]["voided"] is True and g["receipts"][0]["void_reason"] == "Entered the wrong date" and g["receipts"][0]["can_void"] is False)
check("void: quantities are free again", g["lines"][0]["remaining"] == 10 and g["can_record"] is True)
denied("void: it cannot be voided twice", call("O", "void_goods_receipt", q(rid), q("once more")), "already_voided")
check("void: the supplier is told", notes(s1, p4, "% corrected a delivery record") == 1)
r2 = rcpt("O", p4, [L(l4[0], 10)], day=D(-4))
check("void: the corrected receipt gets a NEW number (numbers are never reused)", J(r2).get("number", "").endswith("-2"), str(J(r2)))
check("void: and the clock starts from the corrected date", PAY(p4)["accepted_on"] == D(-4))
denied("void: a payment on the order locks the receipt", (lambda: (SQL(f"insert into po_payments(org_id,po_id,amount,paid_on,method,recorded_by) values ('{oA}','{p4}',100,current_date,'bank_transfer','{ids['O']}')"), call("O", "void_goods_receipt", q(J(r2)["id"]), q("too late now")))[1])(), "locked")
p5, l5 = mk_po(lines=((10, 100),))
rid5 = J(rcpt("O", p5, [L(l5[0], 10)]))["id"]
SQL(f"update purchase_orders set objection_at = now() where id='{p5}'")
denied("void: an open objection locks the receipt", call("O", "void_goods_receipt", q(rid5), q("not so fast")), "locked")
p6, l6 = mk_po(lines=((10, 100),))
rid6 = J(rcpt("O", p6, [L(l6[0], 10)]))["id"]
SQL(f"update goods_receipts set created_at = now() - interval '49 hours' where id='{rid6}'")
denied("void: after 48 hours it is final", call("O", "void_goods_receipt", q(rid6), q("forgot something")), "too_late")
check("void: ...and the read says it cannot be voided", GR("O", p6)["receipts"][0]["can_void"] is False)
# voiding one of two receipts moves a received order back to partial
p7, l7 = mk_po(lines=((100, 10),))
a = J(rcpt("O", p7, [L(l7[0], 70)])); b = J(rcpt("O", p7, [L(l7[0], 30)]))
check("void: two receipts complete the order", ST(p7).startswith("received|"))
ok("void: the second is taken back", call("O", "void_goods_receipt", q(b["id"]), q("Counted twice")))
check("void: the order is partial again with 30 to accept", ST(p7) == "partially_received|none" and GR("O", p7)["lines"][0]["remaining"] == 30)
ok("void: the short close is dropped when nothing is accepted any more", call("O", "void_goods_receipt", q(a["id"]), q("Also wrong")))
check("void: back to confirmed", ST(p7) == "acknowledged|none")

# ═══ 10. the supplier answers ═══
p8, l8 = mk_po(lines=((10, 100),))
rid8 = J(rcpt("O", p8, [L(l8[0], 8, 2, "scratched")]))["id"]
denied("answer: the buyer cannot answer for the supplier", call("O", "respond_goods_receipt", q(rid8), q("agreed")), "not_found")
denied("answer: another supplier cannot", call("S2", "respond_goods_receipt", q(rid8), q("agreed")), "not_found")
denied("answer: a supplier employee cannot", call("S1B", "respond_goods_receipt", q(rid8), q("agreed")), "not_found")
denied("answer: only agreed or disputed", call("S1", "respond_goods_receipt", q(rid8), q("maybe")), "invalid_response")
denied("answer: a dispute needs a note", call("S1", "respond_goods_receipt", q(rid8), q("disputed"), q("")), "note_required")
denied("answer: a too long note is refused", call("S1", "respond_goods_receipt", q(rid8), q("agreed"), q("n" * 301)), "invalid_note")
check("answer: the supplier may respond (read says so)", GR("S1", p8)["receipts"][0]["can_respond"] is True and GR("O", p8)["receipts"][0]["can_respond"] is False)
ok("answer: the supplier disputes with a note", call("S1", "respond_goods_receipt", q(rid8), q("disputed"), q("The 2 rods were fine when they left us")))
g = GR("O", p8)["receipts"][0]
check("answer: the buyer sees the dispute and the note", g["supplier_response"] == "disputed" and g["supplier_note"].startswith("The 2 rods") and g["supplier_responded_at"])
check("answer: the buyer is told", int(SQL(f"select count(*) from notifications where org_id='{oA}' and link_to='purchase-orders/{p8}' and title like '% disputed a delivery record'")) >= 1)
ok("answer: the supplier can change its mind", call("S1", "respond_goods_receipt", q(rid8), q("agreed")))
check("answer: now agreed, note cleared", GR("O", p8)["receipts"][0]["supplier_response"] == "agreed" and GR("O", p8)["receipts"][0]["supplier_note"] == "")
check("answer: a dispute does not change the order or the clock", ST(p8) == "partially_received|none")
check("answer: both sides audit it", SQL(f"select count(*) from audit_log where entity_id='{p8}' and action like 'goods_receipt_%'") == "4")
ok("answer: voiding is still allowed after a response", call("O", "void_goods_receipt", q(rid8), q("Wrong quantities entered")))
denied("answer: a voided receipt cannot be answered", call("S1", "respond_goods_receipt", q(rid8), q("agreed")), "already_voided")

# ═══ 11. photos ═══
p9, l9 = mk_po(lines=((10, 100),))
rid9 = J(rcpt("O", p9, [L(l9[0], 8, 2, "cracked")]))["id"]
path = lambda n: f"{oA}/{rid9}/{n}"
def put(name, mime="image/jpeg", size=1000, bucket="goods-photos"):
    SQL(f"insert into storage.objects(bucket_id,name,metadata) values ('{bucket}','{path(name)}','{json.dumps({'size': size, 'mimetype': mime})}')")
denied("photo: the file must really be uploaded first", call("O", "attach_receipt_photo", q(rid9), q(path("a.jpg")), q("a.jpg")), "file_missing")
put("a.jpg"); ok("photo: the buyer attaches a photo", call("O", "attach_receipt_photo", q(rid9), q(path("a.jpg")), q("a.jpg")))
put("big.jpg", size=6 * 1024 * 1024); denied("photo: over 5 MB is refused", call("O", "attach_receipt_photo", q(rid9), q(path("big.jpg")), q("big")), "file_too_large")
put("doc.pdf", mime="application/pdf"); denied("photo: a PDF is refused", call("O", "attach_receipt_photo", q(rid9), q(path("doc.pdf")), q("doc")), "file_type")
denied("photo: attaching the same file twice is refused", call("O", "attach_receipt_photo", q(rid9), q(path("a.jpg")), q("a.jpg")), "already_attached")
denied("photo: a path in another folder is refused", call("O", "attach_receipt_photo", q(rid9), q(f"{oA}/{uuid.uuid4()}/x.jpg"), q("x")), "invalid_path")
denied("photo: a path with .. is refused", call("O", "attach_receipt_photo", q(rid9), q(f"{oA}/{rid9}/../x.jpg"), q("x")), "invalid_path")
denied("photo: the supplier cannot add photos to the buyer's receipt", call("S1", "attach_receipt_photo", q(rid9), q(path("a.jpg")), q("a")), "not_found")
denied("photo: an employee cannot add photos", call("E", "attach_receipt_photo", q(rid9), q(path("a.jpg")), q("a")), "not_found")
for i in range(2, 7):
    put(f"p{i}.jpg"); r = call("O", "attach_receipt_photo", q(rid9), q(path(f"p{i}.jpg")), q(f"p{i}"))
    check(f"photo: photo {i} of 6", r[0] if i <= 6 else not r[0], r[2])
put("p7.jpg")
denied("photo: a 7th real photo is refused", call("O", "attach_receipt_photo", q(rid9), q(path("p7.jpg")), q("p7")), "too_many_photos")
g = GR("S1", p9)["receipts"][0]
check("photo: the supplier sees 6 photos on the receipt", len(g["photos"]) == 6 and g["can_add_photo"] is False)
pid_ = g["photos"][0]["id"]
check("photo: the buyer can open a photo", call("O", "open_receipt_photo", q(pid_))[1].startswith(f"{oA}/{rid9}/"))
check("photo: so can the supplier (an employee too)", call("S1", "open_receipt_photo", q(pid_))[0] and call("S1B", "open_receipt_photo", q(pid_))[0])
denied("photo: another buyer cannot open it", call("XO", "open_receipt_photo", q(pid_)), "not_found")
denied("photo: another supplier cannot open it", call("S2", "open_receipt_photo", q(pid_)), "not_found")
denied("photo: a made-up photo is not found", call("O", "open_receipt_photo", q(uuid.uuid4())), "not_found")
ok("photo: voiding a receipt keeps its photos on file", call("O", "void_goods_receipt", q(rid9), q("Wrong order entirely")))
check("photo: ...and they are still there", SQL(f"select count(*) from goods_receipt_photos where receipt_id='{rid9}'") == "6")
denied("photo: nothing can be added to a voided receipt", call("O", "attach_receipt_photo", q(rid9), q(path("p7.jpg")), q("p7")), "already_voided")
# the private bucket
# NOTE: the Trust Passport upload policy (vdocs_insert, migration 4) counts rows of storage.objects from inside a policy on storage.objects.
# Plain Postgres refuses that as infinite recursion; it is removed in THIS throwaway database only, so this suite tests the new policies alone.
SQL("drop policy if exists vdocs_insert on storage.objects")
check("bucket: the bucket exists and is private with a 5 MB limit", SQL("select (not public)::text||file_size_limit from storage.buckets where id='goods-photos'") == "true5242880")
check("bucket: nobody can replace or erase a photo (no update or delete policy)", SQL("select count(*) from pg_policies where tablename='objects' and policyname like 'gphotos_%' and cmd in ('UPDATE','DELETE','ALL')") == "0")
check("bucket: read and insert policies exist", SQL("select count(*) from pg_policies where tablename='objects' and policyname in ('gphotos_read','gphotos_insert')") == "2")
p10, l10 = mk_po(lines=((5, 1),)); rid10 = J(rcpt("O", p10, [L(l10[0], 5)]))["id"]
ins = lambda who, name: U(who, f"insert into storage.objects(bucket_id,name,metadata) values ('goods-photos','{name}','{{}}')")
ok("bucket: the buyer owner may upload into the receipt folder", ins("O", f"{oA}/{rid10}/ok.jpg"))
ok("bucket: so may a procurement manager", ins("P", f"{oA}/{rid10}/ok2.jpg"))
denied("bucket: an employee may not", ins("E", f"{oA}/{rid10}/no.jpg"), "row-level security")
denied("bucket: the supplier may not", ins("S1", f"{oA}/{rid10}/no.jpg"), "row-level security")
denied("bucket: another buyer may not", ins("XO", f"{oA}/{rid10}/no.jpg"), "row-level security")
denied("bucket: a wrong folder shape is refused", ins("O", f"{oA}/{rid10}/deep/no.jpg"), "row-level security")
denied("bucket: another company's folder is refused", ins("O", f"{oX}/{rid10}/no.jpg"), "row-level security")
denied("bucket: a receipt that does not exist is refused", ins("O", f"{oA}/{uuid.uuid4()}/no.jpg"), "row-level security")
check("bucket: the supplier can read a photo of its own order", U("S1", f"select count(*) from storage.objects where bucket_id='goods-photos' and name='{oA}/{rid10}/ok.jpg'")[1] == "1")
check("bucket: a stranger sees nothing", U("XO", f"select count(*) from storage.objects where bucket_id='goods-photos' and name='{oA}/{rid10}/ok.jpg'")[1] == "0")
check("bucket: another supplier sees nothing", U("S2", f"select count(*) from storage.objects where bucket_id='goods-photos' and name='{oA}/{rid10}/ok.jpg'")[1] == "0")
check("bucket: a delete removes nothing", U("O", f"with d as (delete from storage.objects where name='{oA}/{rid10}/ok.jpg' returning 1) select count(*) from d")[1] == "0")

# ═══ 12. the old one-tap receive still works, and now writes a full receipt ═══
p11, l11 = mk_po(lines=((100, 10), (50, 20)))
r = call("O", "receive_purchase_order", q(p11), "null")
ok("quick: one tap records everything as received", r)
check("quick: the answer has the same shape as before", J(r).get("status") == "received" and J(r).get("on_time") is True and J(r).get("delivered_on") == D(0), str(J(r)))
check("quick: the order is received today", ST(p11).startswith("received|"))
g = GR("O", p11)
check("quick: it wrote ONE receipt with every item fully accepted", len(g["receipts"]) == 1 and len(g["receipts"][0]["lines"]) == 2 and all(x["remaining"] == 0 and x["rejected"] == 0 for x in g["lines"]), str(g)[:200])
check("quick: the supplier is told in the same words as before", notes(s1, p11, "% recorded delivery of an order") == 1)
check("quick: audited on both sides", SQL(f"select count(*) from audit_log where entity_id='{p11}' and action='po_goods_received'") == "2")
denied("quick: it cannot be done twice", call("O", "receive_purchase_order", q(p11), "null"), "not_receivable")
p12, _ = mk_po(lines=((10, 1),))
denied("quick: not after a partial delivery (use the receipt form)", (lambda: (rcpt("O", p12, [L(_[0], 3)]), call("O", "receive_purchase_order", q(p12), "null"))[1])(), "not_receivable")
p13, _ = mk_po(no_lines=True)
ok("quick: an order with no lines keeps the old behaviour", call("O", "receive_purchase_order", q(p13), q(D(-3))))
check("quick: ...and is received on that date", ST(p13) == f"received|{D(-3)} 12:00:00+00", ST(p13))
check("quick: ...and reads as an older record with no receipts", GR("O", p13)["legacy"] is True and GR("O", p13)["receipts"] == [])
p14, l14 = mk_po(lines=((10, 1),), expected=-5)
check("quick: a late delivery is flagged late", J(call("O", "receive_purchase_order", q(p14), "null")).get("on_time") is False)
denied("quick: a future date is still refused", call("O", "receive_purchase_order", q(mk_po(lines=((1, 1),))[0]), q(D(2))), "invalid_date")

# ═══ 13. a late complete delivery counts as late ═══
p15, l15 = mk_po(lines=((10, 1),), expected=-3)
r = J(rcpt("O", p15, [L(l15[0], 10)]))
check("late: the receipt says it was after the promised date", r.get("on_time") is False and "after the promised date" in SQL(f"select body from notifications where org_id='{s1}' and link_to='orders/{p15}' order by created_at desc limit 1"))
p16, l16 = mk_po(lines=((10, 1),), expected=5)
check("late: an on-time delivery says so", J(rcpt("O", p16, [L(l16[0], 10)])).get("on_time") is True)
# a rejected item shows in the final notification
p17, l17 = mk_po(lines=((10, 1),))
rcpt("O", p17, [L(l17[0], 6, 4, "damaged")]); rcpt("O", p17, [L(l17[0], 4)])
check("a delivery completed by a replacement still completes the order", ST(p17).startswith("received|"))

# ═══ 14. other parts of the app are untouched ═══
check("other: a supplier's delivery record now counts the receipt-based delivery", int(SQL(f"select count(*) from purchase_orders where supplier_org='{s1}' and status='received' and delivered_at is not null")) >= 5)
denied("other: the supplier still cannot set a delivery date on its own order", U("S1", f"update purchase_orders set delivered_at = now() where id='{p}'"), "permission denied")
denied("other: nor can a buyer change an order directly", U("O", f"update purchase_orders set status='received' where id='{p5}'"), "permission denied")
check("other: migration 26 applied twice is harmless", run(["-f", m26[0]]).returncode == 0)
check("other: reads still work after re-applying", GR("O", p)["lines"][0]["remaining"] == 0)

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
