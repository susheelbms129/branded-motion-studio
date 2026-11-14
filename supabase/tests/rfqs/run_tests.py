#!/usr/bin/env python3
"""
Tests for real RFQs in the database (migration 13).
Builds a THROWAWAY database `vendora_rfqs_test`, applies every migration, then sends RFQs and attacks the flow:
who may send, which requests may be sent, which suppliers may be invited (verified only, checked at send time), input checks,
numbering, notifications, what suppliers can and cannot see, direct table writes and races.
Never point it at a real project.

    PGHOST=localhost PGUSER=postgres python3 supabase/tests/rfqs/run_tests.py
    (set PSQL_BIN if psql is not on your PATH)
"""
import glob, json, os, subprocess, sys, uuid
from datetime import date, timedelta
HERE = os.path.dirname(os.path.abspath(__file__))
MIG = os.path.join(HERE, "..", "..", "migrations")
BOOT = os.path.join(HERE, "..", "invite_only", "bootstrap_local_supabase.sql")
DB = "vendora_rfqs_test"
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
rfq_mig = [f for f in files if f.endswith("_rfqs.sql")]
assert rfq_mig, "the RFQs migration (13) is missing"
for f in files: apply(f)
apply(rfq_mig[0])  # safe to run twice

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

# ═══ 1. only approved requests, only by the right people ═══
draft = J(call("E", "create_request", q(oA), jb(req(title="Still a draft")), "false"))["id"]
pending = J(call("E", "create_request", q(oA), jb(req(title="Waiting for approval")), "true"))["id"]
rid = approved(title="Plates for line 3")
denied("a draft cannot be sent", send("P", draft, data()), "not_approved")
denied("a request still waiting for approval cannot be sent", send("P", pending, data()), "not_approved")
denied("the requester (an employee) cannot send", send("E", rid, data()), "not_allowed")
denied("a finance manager cannot send", send("F", rid, data()), "not_allowed")
denied("an approver cannot send", send("AP", rid, data()), "not_allowed")
for who, label in [("XO", "a buyer from another company"), ("S1", "a supplier"), ("Z", "someone with no company"), ("SU", "a suspended member")]:
    denied(f"{label} cannot send it (and cannot tell it exists)", send(who, rid, data()), "not_found")
    denied(f"{label} cannot read its RFQ status", call(who, "get_request_rfq", q(rid)), "not_found")
denied("a made-up request is the same answer", send("P", uuid.uuid4(), data()), "not_found")
denied("a signed-out visitor cannot send", ANON(f"select send_rfq('{rid}', {jb(data())})"), "permission denied")
check("nothing was created by any refusal", SQL("select count(*) from rfqs") == "0" and SQL("select count(*) from rfq_invites") == "0")
check("the request is still approved", SQL(f"select status from purchase_requests where id='{rid}'") == "approved")

# ═══ 2. input is checked on the server ═══
many = [str(uuid.uuid4()) for _ in range(21)]
bad = {
  "no suppliers": (data(sup=[]), "no_suppliers"), "suppliers that are not a list": (data(sup="all"), "no_suppliers"),
  "a missing supplier list": ({"dueDate": DUE}, "no_suppliers"), "21 suppliers": (data(sup=many), "too_many_suppliers"),
  "a supplier id that is not text": (data(sup=[5]), "invalid_suppliers"), "a supplier id that is not an id": (data(sup=["abc"]), "invalid_suppliers"),
  "the same supplier twice": (data(sup=[s1, s1]), "duplicate_suppliers"), "the same supplier twice in different case": (data(sup=[s1, s1.upper()]), "duplicate_suppliers"),
  "a missing due date": ({"supplierIds": [s1]}, "invalid_due_date"), "a due date that is not text": (data(due=20301212), "invalid_due_date"),
  "today as the due date": (data(due=date.today().isoformat()), "invalid_due_date"),
  "a due date in the past": (data(due=(date.today() - timedelta(days=2)).isoformat()), "invalid_due_date"),
  "a due date 181 days away": (data(due=(date.today() + timedelta(days=181)).isoformat()), "invalid_due_date"),
  "a made-up due date": (data(due="2031-02-31"), "invalid_due_date"), "a due date in the wrong format": (data(due="14/12/2031"), "invalid_due_date"),
  "notes that are not text": (data(notes=5), "invalid_notes"), "1001 characters of notes": (data(notes="x" * 1001), "invalid_notes"),
  "an unknown supplier": (data(sup=[str(uuid.uuid4())]), "supplier_not_found"),
  "a buyer company as a supplier": (data(sup=[oX]), "supplier_not_found"),
  "a supplier that never finished onboarding": (data(sup=[s5]), "supplier_not_found"),
  "a supplier with no verified proof": (data(sup=[s1, s3]), "supplier_not_verified"),
  "a supplier whose proof has expired": (data(sup=[s4]), "supplier_not_verified"),
}
for name, (d, word) in bad.items(): denied(f"the server refuses {name}", send("P", rid, d), word)
denied("the server refuses a payload that is not an object", call("P", "send_rfq", q(rid), "'[1]'::jsonb"), "invalid_request")
denied("the server refuses a missing payload", call("P", "send_rfq", q(rid), "null"), "invalid_request")
check("still nothing was created", SQL("select count(*) from rfqs") == "0" and SQL("select count(*) from notifications where kind='rfq'") == "0")
check("and the request is still approved and sendable", SQL(f"select status from purchase_requests where id='{rid}'") == "approved")
ok("a due date of tomorrow is allowed (checked with a throwaway request)", send("O", approved(title="Tomorrow"), data(sup=[s1], due=(date.today() + timedelta(days=1)).isoformat())))
ok("a due date exactly 180 days away is allowed", send("O", approved(title="Far away"), data(sup=[s1], due=(date.today() + timedelta(days=180)).isoformat())))
sh("delete from rfqs"); sh("delete from notifications"); sh("update purchase_requests set status='approved' where status='converted_to_rfq'")

# ═══ 3. a real send ═══
gr = get = call("P", "get_request_rfq", q(rid))
check("before sending, the procurement manager may send", J(gr)["can_send"] is True and J(gr)["rfq_id"] is None, gr[1])
check("the employee is told they may not", J(call("E", "get_request_rfq", q(rid)))["can_send"] is False)
res = send("P", rid, data(notes="  Please quote delivered to Peenya.  "))
ok("the procurement manager sends the RFQ", res)
out = J(res); rfq = out.get("id")
check("the first number is RFQ-<year>-0001", out.get("number") == f"RFQ-{yr}-0001" and out.get("status") == "sent" and out.get("invited") == 2, res[1])
check("the request became 'converted to RFQ'", SQL(f"select status from purchase_requests where id='{rid}'") == "converted_to_rfq")
check("the RFQ is linked, titled and categorised from the request",
      SQL(f"select title||'|'||category||'|'||status||'|'||request_id||'|'||owner_id from rfqs where id='{rfq}'") == f"Plates for line 3|Raw material|sent|{rid}|{ids['P']}")
check("the due date and trimmed note were saved", SQL(f"select due_date||'|'||notes from rfqs where id='{rfq}'") == f"{DUE}|Please quote delivered to Peenya.")
check("the items were copied in order with quantities", SQL(f"select string_agg(description||':'||qty||':'||unit, ',' order by position) from rfq_items where rfq_id='{rfq}'")
      == "MS plate 10mm:10.000:Sheet,Welding rod:25.500:Kg")
check("the buyer's estimated prices are not in the RFQ at all",
      SQL("select count(*) from information_schema.columns where table_name='rfq_items' and column_name ilike '%price%'") == "0"
      and "1500" not in SQL(f"select to_jsonb(t)::text from rfq_items t where rfq_id='{rfq}' limit 1") )
check("each supplier got an invitation with the level it had at that moment",
      SQL(f"select string_agg(supplier_org||':'||level_at_send||':'||status, ',' order by level_at_send) from rfq_invites where rfq_id='{rfq}'") == f"{s1}:1:sent,{s2}:2:sent")
check("invitations point at companies, not at the private supplier list", SQL(f"select count(*) from rfq_invites where rfq_id='{rfq}' and supplier_id is null") == "2")
check("every active supplier member was notified", SQL(f"select string_agg(user_id::text, ',' order by user_id::text) from notifications where kind='rfq' and org_id in ('{s1}','{s2}')")
      == ",".join(sorted([ids["S1"], ids["S1B"], ids["S2"]])))
check("a suspended supplier member was not", SQL(f"select count(*) from notifications where user_id='{ids['S1S']}'") == "0")
check("the notification names the buyer and carries the request title", SQL(f"select title||'|'||body from notifications where user_id='{ids['S2']}'") == "New quote request from Alpha Mills|Plates for line 3")
check("the buyer's own people got no supplier notification", SQL(f"select count(*) from notifications where kind='rfq' and org_id='{oA}'") == "0")
check("the supplier notifications link to the quote request", SQL(f"select link_to from notifications where user_id='{ids['S1']}'") == f"quote-requests/{rfq}")
check("the request timeline records it", SQL(f"select text from request_events where request_id='{rid}' and type='rfq_sent'") == f"RFQ-{yr}-0001 sent to 2 verified suppliers")
check("the audit entry holds ids and counts only", json.loads(SQL(f"select detail::text from audit_log where action='rfq_sent' and entity_id='{rfq}'")) == {"request": rid, "suppliers": 2})
check("the audit entry names the company and the actor", SQL(f"select org_id||'|'||actor_id from audit_log where action='rfq_sent' and entity_id='{rfq}'") == f"{oA}|{ids['P']}")
denied("the same request cannot be sent twice", send("P", rid, data(sup=[s2])), "already_sent")
denied("not even by the owner", send("O", rid, data(sup=[s2])), "already_sent")
check("still one RFQ for the request", SQL(f"select count(*) from rfqs where request_id='{rid}'") == "1")
gr2 = J(call("P", "get_request_rfq", q(rid)))
check("the request page now points at the RFQ and cannot send again", gr2["rfq_id"] == rfq and gr2["rfq_number"] == f"RFQ-{yr}-0001" and gr2["can_send"] is False)
denied("a sent request cannot be submitted, deleted or decided again",
       call("E", "submit_request", q(rid)), "not_draft")
denied("it cannot be withdrawn either", call("E", "withdraw_request", q(rid)), "not_pending")
denied("or decided", call("AP", "decide_request", q(rid), "'rejected'", "'late'"), "not_pending")

# ═══ 4. numbering and one more supplier mix ═══
rid2 = approved(title="Bearings"); rid3 = approved(org=oD, maker="DO", title="Delta's own")
r2 = J(send("O", rid2, data(sup=[s2])))
check("the second number is RFQ-<year>-0002", r2.get("number") == f"RFQ-{yr}-0002", str(r2))
check("a single supplier reads 'supplier' not 'suppliers'", SQL(f"select text from request_events where request_id='{rid2}' and type='rfq_sent'").endswith("sent to 1 verified supplier"))
check("a solo owner's request is sent by the owner, numbering starts again at 0001 for another company",
      J(send("DO", rid3, data(sup=[s1]))).get("number") == f"RFQ-{yr}-0001")
check("the owner can send too", r2.get("invited") == 1)

# ═══ 5. reading ═══
lst = J(call("E", "list_rfqs", q(oA)))
check("an employee can read the list", lst.get("total") == 2 and lst["counts"] == {"sent": 2}, str(lst)[:200])
it = [i for i in lst["items"] if i["id"] == rfq][0]
check("the list carries number, request number, owner, invited and quoted counts",
      it["number"] == f"RFQ-{yr}-0001" and it["request_number"] == f"PR-{yr}-0003" and it["owner_name"] == "P Person" and it["invited"] == 2 and it["quoted"] == 0 and it["item_count"] == 2, str(it))
check("newest first", lst["items"][0]["id"] == r2["id"])
check("filtering by status works", J(call("E", "list_rfqs", q(oA), "'sent'"))["total"] == 2 and J(call("E", "list_rfqs", q(oA), "'awarded'"))["total"] == 0)
check("'all' means no filter", J(call("E", "list_rfqs", q(oA), "'all'"))["total"] == 2)
check("paging clamps silly sizes", len(J(call("E", "list_rfqs", q(oA), "null", "1", "0"))["items"]) == 1 and len(J(call("E", "list_rfqs", q(oA), "null", "-5", "-9"))["items"]) == 1)
denied("an unknown status is refused", call("E", "list_rfqs", q(oA), "'sneaky'"), "invalid_status")
check("another company only sees its own RFQs", J(call("DO", "list_rfqs", q(oD)))["total"] == 1 and J(call("XO", "list_rfqs", q(oX)))["total"] == 0)
for who, label in [("XO", "a buyer from another company"), ("S1", "a supplier"), ("Z", "someone with no company"), ("SU", "a suspended member")]:
    denied(f"{label} cannot list the company's RFQs", call(who, "list_rfqs", q(oA)), "not_allowed")
    denied(f"{label} cannot open an RFQ (and cannot tell it exists)", call(who, "get_rfq", q(rfq)), "not_found")
denied("a made-up company is refused", call("E", "list_rfqs", q(uuid.uuid4())), "not_allowed")
denied("a null company is refused", call("E", "list_rfqs", "null"), "not_allowed")
denied("a made-up RFQ is the same answer as a hidden one", call("E", "get_rfq", q(uuid.uuid4())), "not_found")
d = J(call("E", "get_rfq", q(rfq)))
check("the detail has the RFQ, items and invitations", all(k in d for k in ("rfq", "items", "invites")) and len(d["items"]) == 2 and len(d["invites"]) == 2, str(d)[:200])
check("the RFQ detail shows the request it came from", d["rfq"]["request_number"] == f"PR-{yr}-0003" and d["rfq"]["owner_name"] == "P Person" and d["rfq"]["notes"].startswith("Please quote"))
check("each invitation shows the supplier, the level then and the level now",
      sorted((i["name"], i["level_at_send"], i["level_now"]) for i in d["invites"]) == [("Bharat Steels", 2, 2), ("Kaveri Industrial", 1, 1)], str(d["invites"]))
check("the detail never contains a price", "unit_price" not in json.dumps(d) and "1500" not in json.dumps(d))
sh(f"update verification_checks set expires_at=current_date-1 where org_id='{s2}'")
d2 = J(call("E", "get_rfq", q(rfq)))
check("if a proof lapses later, the evidence of the level at sending stays and the current level drops",
      sorted((i["name"], i["level_at_send"], i["level_now"]) for i in d2["invites"]) == [("Bharat Steels", 2, 0), ("Kaveri Industrial", 1, 1)])
denied("a lapsed supplier can no longer be invited", send("O", approved(title="After the lapse"), data(sup=[s2])), "supplier_not_verified")

# ═══ 6. the tables themselves are closed to writes ═══
denied("the owner cannot insert an RFQ directly", U("O", f"insert into rfqs(org_id,number,title,owner_id) values ('{oA}','RFQ-X','x','{ids['O']}')"), "permission denied")
denied("the owner cannot change an RFQ's status directly", U("O", f"update rfqs set status='awarded' where id='{rfq}'"), "permission denied")
denied("the owner cannot invite anyone directly", U("O", f"insert into rfq_invites(org_id,rfq_id,supplier_org) values ('{oA}','{rfq}','{s3}')"), "permission denied")
denied("the owner cannot edit an invitation", U("O", f"update rfq_invites set status='quoted' where rfq_id='{rfq}'"), "permission denied")
denied("the owner cannot edit RFQ items", U("O", f"update rfq_items set qty=1 where rfq_id='{rfq}'"), "permission denied")
denied("nobody deletes an RFQ directly", U("O", f"delete from rfqs where id='{rfq}'"), "permission denied")
check("a member can still read their company's rows directly", int(U("E", "select count(*) from rfqs")[1]) == 2 and int(U("E", "select count(*) from rfq_invites")[1]) == 3)
check("a stranger sees zero RFQ rows even by direct read", U("XO", "select count(*) from rfqs")[1] == "0" and U("XO", "select count(*) from rfq_invites")[1] == "0")
check("an invited supplier sees zero RFQ rows through the tables (Task 12 will add a safe function)", U("S1", "select count(*) from rfqs")[1] == "0" and U("S1", "select count(*) from rfq_items")[1] == "0")
check("a supplier cannot see which buyers invited them by reading the invitations", U("S2", "select count(*) from rfq_invites")[1] == "0")
check("the new functions are closed to signed-out visitors",
      all(SQL(f"select has_function_privilege('anon', '{f}', 'execute')") == "f" for f in ("public.send_rfq(uuid,jsonb)", "public.list_rfqs(uuid,text,int,int)", "public.get_rfq(uuid)", "public.get_request_rfq(uuid)")))

# ═══ 7. audit ═══
check("the audit log holds ids only, no free text", all(w not in SQL("select string_agg(detail::text, ' ') from audit_log") for w in ("Peenya", "Plates")))
check("every send was audited", SQL(f"select count(*) from audit_log where action='rfq_sent' and entity_id in ('{rfq}','{r2['id']}')") == "2")

# ═══ 8. races ═══
def parallel(sqls):
    ps = [subprocess.Popen([PSQL, "-q", "-At", "-d", DB, "-v", "ON_ERROR_STOP=1"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True) for _ in sqls]
    for p, s in zip(ps, sqls): p.stdin.write(s); p.stdin.close()
    return [(p.wait() == 0, p.stdout.read(), p.stderr.read()) for p in ps]
pre = lambda k: f"begin; set local role authenticated; select set_config('request.jwt.claims', '{json.dumps({'sub': ids[k]})}', true); "
race = approved(title="Race to send")
res = parallel([pre("P") + f"select send_rfq('{race}', {jb(data(sup=[s1]))}); commit;", pre("O") + f"select send_rfq('{race}', {jb(data(sup=[s1]))}); commit;"])
check("two people sending one request at once: exactly one wins", sorted(r[0] for r in res) == [False, True], str([r[2][:100] for r in res]))
check("and only one RFQ exists for it", SQL(f"select count(*) from rfqs where request_id='{race}'") == "1")
many_ids = [approved(title=f"Parallel {i}") for i in range(6)]
res = parallel([pre("P") + f"select send_rfq('{m}', {jb(data(sup=[s1]))}); commit;" for m in many_ids])
check("6 simultaneous sends all succeed", all(r[0] for r in res), str([r[2][:100] for r in res if not r[0]]))
check("and every RFQ got its own number", SQL(f"select count(distinct number) = count(*) from rfqs where org_id='{oA}'") == "t")
check("numbers run without gaps", SQL(f"select max(substring(number from '([0-9]+)$')::int) = count(*) from rfqs where org_id='{oA}'") == "t")

# ═══ 9. nothing leaked into other tables ═══
check("another company's data was never touched", SQL(f"select count(*) from rfqs where org_id='{oX}'") == "0" and SQL(f"select count(*) from request_events where org_id='{oX}'") == "0")
check("the migration can be applied again without harm", run(["-f", rfq_mig[0]]).returncode == 0)
print(f"{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
