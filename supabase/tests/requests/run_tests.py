#!/usr/bin/env python3
"""
Tests for purchase requests in the database (migration 12).
Builds a THROWAWAY database `vendora_requests_test`, applies every migration, then exercises the request flow and attacks it:
validation, numbering, approval routing, decisions, permissions, other companies, the supplier side, direct table writes and races.
Never point it at a real project.

    PGHOST=localhost PGUSER=postgres python3 supabase/tests/requests/run_tests.py
    (set PSQL_BIN if psql is not on your PATH)
"""
import glob, json, os, subprocess, sys, uuid
from datetime import date, timedelta
HERE = os.path.dirname(os.path.abspath(__file__))
MIG = os.path.join(HERE, "..", "..", "migrations")
BOOT = os.path.join(HERE, "..", "invite_only", "bootstrap_local_supabase.sql")
DB = "vendora_requests_test"
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
req_mig = [f for f in files if f.endswith("_purchase_requests.sql")]
assert req_mig, "the purchase requests migration (12) is missing"
for f in files: apply(f)
apply(req_mig[0])  # safe to run twice

# ── people ──  A company: O owner, P procurement, F finance, AP approver, E / E2 employees, SU suspended approver
#              D company: DO solo owner.  Q company: QO owner + QE employee (for the "nobody can approve" safety net)
#              X: stranger buyer owner.  S: supplier owner.  Z: signed up, no company
names = "O P F AP E E2 SU DO DE QO QE XO S Z".split()
ids = {k: str(uuid.uuid4()) for k in names}
for k in names:
    sh(f"insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values ('{ids[k]}','{k.lower()}@t.in',now(),'{json.dumps({'name': k + ' Person'})}')")
oA, oD, oQ, oX, oS = (str(uuid.uuid4()) for _ in range(5))
for o, n, kind in [(oA, "Alpha Mills", "buyer"), (oD, "Delta Mills", "buyer"), (oQ, "Quartz Works", "buyer"), (oX, "Xeno Foods", "buyer"), (oS, "Kaveri Industrial", "supplier")]:
    sh(f"insert into businesses(id,slug,name,kind) values ('{o}','{n.lower().replace(' ', '-')}','{n}','{kind}')")
    if kind == "supplier": sh(f"insert into supplier_profiles(org_id) values ('{o}'); insert into supplier_verifications(org_id) values ('{o}')")
for k, o, role, st in [("O", oA, "owner", "active"), ("P", oA, "procurement_manager", "active"), ("F", oA, "finance_manager", "active"),
                       ("AP", oA, "approver", "active"), ("E", oA, "employee", "active"), ("E2", oA, "employee", "active"), ("SU", oA, "approver", "suspended"),
                       ("DO", oD, "owner", "active"), ("DE", oD, "employee", "active"), ("QO", oQ, "owner", "active"), ("QE", oQ, "employee", "active"),
                       ("XO", oX, "owner", "active"), ("S", oS, "owner", "active")]:
    sh(f"insert into memberships(org_id,user_id,role,status) values ('{o}','{ids[k]}','{role}','{st}')")
U = lambda k, sql: sh(sql, "authenticated", ids[k])
ANON = lambda sql: sh(sql, "anon")
def call(who, fn, *args):
    return U(who, f"select {fn}({', '.join(args)})")
def J(res):
    try: return json.loads(res[1])
    except Exception: return {}
def q(s): return "'" + str(s).replace("'", "''") + "'"
def jb(d): return "$j$" + json.dumps(d) + "$j$::jsonb"
SQL = lambda sql: sh(sql)[1]

NEEDED = (date.today() + timedelta(days=14)).isoformat()
def req(**kw):
    d = {"title": "MS plates for line 3", "department": "Production", "category": "Raw material", "justification": "Needed for the new fabrication line.",
         "priority": "medium", "neededBy": NEEDED, "items": [{"description": "MS plate 10mm", "qty": 10, "unit": "Sheet", "unitPrice": 1500}]}
    d.update(kw); return d
def create(who, org, data, submit=False): return call(who, "create_request", q(org), jb(data), "true" if submit else "false")
BIG = [{"description": "Hot rolled coil", "qty": 100, "unit": "Tonne", "unitPrice": 5000}]   # ₹5,00,000: needs two levels

# ═══ 1. the server checks everything it is given ═══
bad = {
  "a missing title": ({"title": ""}, "invalid_title"), "a too-short title": ({"title": "ab"}, "invalid_title"),
  "a title that is not text": ({"title": 5}, "invalid_title"), "a 121-character title": ({"title": "x" * 121}, "invalid_title"),
  "no department": ({"department": ""}, "invalid_department"), "no category": ({"category": " "}, "invalid_category"),
  "a short justification": ({"justification": "too short"}, "invalid_justification"),
  "an unknown priority": ({"priority": "asap"}, "invalid_priority"),
  "a date in the past": ({"neededBy": (date.today() - timedelta(days=1)).isoformat()}, "invalid_needed_by"),
  "a date far in the future": ({"neededBy": (date.today() + timedelta(days=4000)).isoformat()}, "invalid_needed_by"),
  "a made-up date": ({"neededBy": "2031-02-31"}, "invalid_needed_by"), "a date in the wrong format": ({"neededBy": "14/12/2031"}, "invalid_needed_by"),
  "no items": ({"items": []}, "no_items"), "items that are not a list": ({"items": "none"}, "no_items"),
  "51 items": ({"items": [{"description": "Bolt", "qty": 1, "unit": "pcs", "unitPrice": 1}] * 51}, "too_many_items"),
  "an item that is not an object": ({"items": [5]}, "invalid_item"),
  "an item with no description": ({"items": [{"description": "", "qty": 1, "unit": "pcs", "unitPrice": 1}]}, "invalid_item_description"),
  "an item with no unit": ({"items": [{"description": "Bolt", "qty": 1, "unit": "", "unitPrice": 1}]}, "invalid_item_unit"),
  "a zero quantity": ({"items": [{"description": "Bolt", "qty": 0, "unit": "pcs", "unitPrice": 1}]}, "invalid_item_qty"),
  "a negative quantity": ({"items": [{"description": "Bolt", "qty": -5, "unit": "pcs", "unitPrice": 1}]}, "invalid_item_qty"),
  "a huge quantity": ({"items": [{"description": "Bolt", "qty": 99999999999, "unit": "pcs", "unitPrice": 1}]}, "invalid_item_qty"),
  "a quantity that is text": ({"items": [{"description": "Bolt", "qty": "lots", "unit": "pcs", "unitPrice": 1}]}, "invalid_item_qty"),
  "a negative price": ({"items": [{"description": "Bolt", "qty": 1, "unit": "pcs", "unitPrice": -1}]}, "invalid_item_price"),
  "a price with 3 decimals": ({"items": [{"description": "Bolt", "qty": 1, "unit": "pcs", "unitPrice": 1.234}]}, "invalid_item_price"),
}
for name, (patch, word) in bad.items():
    denied(f"the server refuses {name}", create("E", oA, req(**patch)), word)
denied("the server refuses a payload that is not an object", call("E", "create_request", q(oA), "'[1]'::jsonb", "false"), "invalid_request")
denied("the server refuses a missing payload", call("E", "create_request", q(oA), "null", "false"), "invalid_request")
check("nothing was saved by any refused request", SQL("select count(*) from purchase_requests") == "0")
ok("a price of zero is allowed (prices are estimates)", create("E", oA, req(items=[{"description": "Bolt", "qty": 1, "unit": "pcs", "unitPrice": 0}])))
ok("a quantity with 3 decimals and a string number are allowed", create("E", oA, req(items=[{"description": "Oil", "qty": "2.5", "unit": "L", "unitPrice": "10.50"}])))
sh("delete from purchase_requests")

# ═══ 2. numbering ═══
r1 = create("E", oA, req()); r2 = create("E", oA, req(title="Second request")); rd = create("DO", oD, req())
yr = date.today().year
check("the first number is PR-<year>-0001", J(r1).get("number") == f"PR-{yr}-0001", r1[1])
check("the second number is PR-<year>-0002", J(r2).get("number") == f"PR-{yr}-0002", r2[1])
check("another company starts at 0001 again", J(rd).get("number") == f"PR-{yr}-0001", rd[1])
check("new requests start as drafts", J(r1).get("status") == "draft")
rid1, rid2 = J(r1)["id"], J(r2)["id"]
check("a draft has no approval steps", SQL(f"select count(*) from approval_steps where request_id='{rid1}'") == "0")
check("the lines are saved in order with their values", SQL(f"select qty||'x'||unit_price from request_items where request_id='{rid1}'") == "10.000x1500.00")

# ═══ 3. routing on submit ═══
s1 = call("E", "submit_request", q(rid1))
check("a small request goes to approval", J(s1).get("status") == "pending_approval", s1[2])
check("small requests have a single level", SQL(f"select count(*) from approval_steps where request_id='{rid1}'") == "1")
check("level 1 is the dedicated approver", SQL(f"select approver_id from approval_steps where request_id='{rid1}' and level=1") == ids["AP"])
check("the approver got a notification", SQL(f"select count(*) from notifications where user_id='{ids['AP']}' and link_to='requests/{rid1}'") == "1")
denied("a request cannot be submitted twice", call("E", "submit_request", q(rid1)), "not_draft")
denied("only the requester can submit a draft", call("E2", "submit_request", q(rid2)), "not_allowed")
denied("the owner cannot submit someone else's draft either", call("O", "submit_request", q(rid2)), "not_allowed")
big = J(create("E", oA, req(title="Big steel order", items=BIG), True))
check("a request above ₹2,00,000 has two levels", SQL(f"select count(*) from approval_steps where request_id='{big['id']}'") == "2")
check("level 2 is finance, level 1 is not", SQL(f"select approver_id from approval_steps where request_id='{big['id']}' and level=2") == ids["F"]
      and SQL(f"select approver_id from approval_steps where request_id='{big['id']}' and level=1") == ids["AP"])
check("only level 1 is open at first", SQL(f"select string_agg(status, ',' order by level) from approval_steps where request_id='{big['id']}'") == "pending,waiting")
check("exactly ₹2,00,000 needs only one level", SQL(f"select count(*) from approval_steps where request_id='{J(create('E', oA, req(items=[{'description': 'Exact limit item', 'qty': 1, 'unit': 'pcs', 'unitPrice': 200000}]), True))['id']}'") == "1")
ap_req = J(create("AP", oA, req(title="Raised by the approver"), True))
check("nobody approves their own request (approver raises, procurement approves)", SQL(f"select approver_id from approval_steps where request_id='{ap_req['id']}' and level=1") == ids["P"])
o_req = J(create("O", oA, req(title="Raised by the owner"), True))
check("the owner's own request goes to someone else", SQL(f"select approver_id from approval_steps where request_id='{o_req['id']}' and level=1") == ids["AP"])
check("a suspended approver is never picked", SQL(f"select count(*) from approval_steps where approver_id='{ids['SU']}'") == "0")
solo = J(create("DO", oD, req(title="Solo owner request"), True))
check("a lone owner's request is approved automatically", solo.get("status") == "approved", str(solo))
check("and the timeline says so plainly", "automatically" in SQL(f"select text from request_events where request_id='{solo['id']}' and type='auto_approved'"))
emp = J(create("DE", oD, req(title="Employee in solo company"), True))
check("an employee's request goes to the owner when there is one", emp.get("status") == "pending_approval" and SQL(f"select approver_id from approval_steps where request_id='{emp['id']}'") == ids["DO"])
qd = J(create("QE", oQ, req()))
sh("alter table memberships disable trigger guard_last_owner")
sh(f"update memberships set status='suspended' where org_id='{oQ}' and user_id='{ids['QO']}'")
sh("alter table memberships enable trigger guard_last_owner")
denied("with nobody able to approve, an employee gets a clear error", call("QE", "submit_request", q(qd["id"])), "no_approver")
check("and the request stays a draft", SQL(f"select status from purchase_requests where id='{qd['id']}'") == "draft")

# ═══ 4. decisions ═══
check("the approver's sidebar count is right", call("AP", "count_my_pending_approvals", q(oA))[1] == "4" and J(call("AP", "get_request", q(rid1)))["can_decide"] is True)
check("the finance manager has nothing waiting yet", call("F", "count_my_pending_approvals", q(oA))[1] == "0")
check("the owner can step in on all of them except their own", call("O", "count_my_pending_approvals", q(oA))[1] == "4")
check("the requester has nothing to decide", call("E", "count_my_pending_approvals", q(oA))[1] == "0")
denied("a requester cannot approve their own request", call("E", "decide_request", q(rid1), "'approved'", "''"), "not_allowed")
denied("not even the owner approves their own request", call("O", "decide_request", q(o_req["id"]), "'approved'", "''"), "not_allowed")
denied("a colleague who is not the approver cannot decide", call("P", "decide_request", q(rid1), "'approved'", "''"), "not_your_turn")
denied("an employee cannot decide", call("E2", "decide_request", q(rid1), "'approved'", "''"), "not_your_turn")
denied("a made-up decision is refused", call("AP", "decide_request", q(rid1), "'maybe'", "''"), "invalid_decision")
denied("a rejection needs a reason", call("AP", "decide_request", q(rid1), "'rejected'", "'   '"), "comment_required")
denied("an over-long comment is refused", call("AP", "decide_request", q(rid1), "'approved'", q("x" * 1001)), "invalid_comment")
check("nothing changed after all those refusals", SQL(f"select status from purchase_requests where id='{rid1}'") == "pending_approval")
ok("the approver approves", call("AP", "decide_request", q(rid1), "'approved'", "'Looks right'"))
check("the request is approved", SQL(f"select status from purchase_requests where id='{rid1}'") == "approved")
check("the requester was told", SQL(f"select count(*) from notifications where user_id='{ids['E']}' and title like '%approved'") == "1")
denied("a decided request cannot be decided again", call("AP", "decide_request", q(rid1), "'rejected'", "'changed my mind'"), "not_pending")
# two levels
ok("level 1 approves the big order", call("AP", "decide_request", q(big["id"]), "'approved'", "''"))
check("the big order is still waiting, now on finance", SQL(f"select status from purchase_requests where id='{big['id']}'") == "pending_approval"
      and SQL(f"select string_agg(status, ',' order by level) from approval_steps where request_id='{big['id']}'") == "approved,pending")
denied("level 1 cannot also approve level 2", call("AP", "decide_request", q(big["id"]), "'approved'", "''"), "not_your_turn")
check("finance was notified of level 2", SQL(f"select count(*) from notifications where user_id='{ids['F']}' and link_to='requests/{big['id']}'") == "1")
ok("finance approves level 2", call("F", "decide_request", q(big["id"]), "'approved'", "'Budget ok'"))
check("the big order is approved only after both levels", SQL(f"select status from purchase_requests where id='{big['id']}'") == "approved")
# owner override + rejection
over = J(create("E", oA, req(title="Owner steps in", items=BIG), True))
ok("level 1", call("AP", "decide_request", q(over["id"]), "'approved'", "''"))
ok("the owner decides level 2 for the absent finance manager", call("O", "decide_request", q(over["id"]), "'rejected'", "'Over budget this month'"))
check("the request is rejected", SQL(f"select status from purchase_requests where id='{over['id']}'") == "rejected")
check("the record shows who really decided", SQL(f"select approver_id from approval_steps where request_id='{over['id']}' and level=2") == ids["O"])
check("the timeline names the owner and the stand-in", "O Person (for F Person)" in SQL(f"select text from request_events where request_id='{over['id']}' and type='rejected'"))
check("the requester sees the reason in a notification", SQL(f"select body from notifications where user_id='{ids['E']}' and title like '%rejected'") == "Over budget this month")

# ═══ 5. withdraw and delete ═══
w = J(create("E", oA, req(title="To withdraw"), True))
denied("someone else cannot withdraw", call("E2", "withdraw_request", q(w["id"])), "not_allowed")
ok("the requester withdraws a request nobody has decided", call("E", "withdraw_request", q(w["id"])))
check("it is a draft again with no steps", SQL(f"select status from purchase_requests where id='{w['id']}'") == "draft" and SQL(f"select count(*) from approval_steps where request_id='{w['id']}'") == "0")
ok("and it can be submitted again", call("E", "submit_request", q(w["id"])))
w2 = J(create("E", oA, req(title="Half approved", items=BIG), True))
ok("level 1", call("AP", "decide_request", q(w2["id"]), "'approved'", "''"))
denied("a half-approved request cannot be withdrawn", call("E", "withdraw_request", q(w2["id"])), "not_pending")
denied("an approved request cannot be withdrawn", call("E", "withdraw_request", q(rid1)), "not_pending")
denied("only the requester deletes a draft", call("E2", "delete_draft_request", q(rid2)), "not_allowed")
denied("not even the owner deletes someone else's draft", call("O", "delete_draft_request", q(rid2)), "not_allowed")
denied("a submitted request cannot be deleted", call("E", "delete_draft_request", q(rid1)), "not_draft")
ok("the requester deletes their own draft", call("E", "delete_draft_request", q(rid2)))
check("its lines and timeline went with it", SQL(f"select (select count(*) from request_items where request_id='{rid2}') + (select count(*) from request_events where request_id='{rid2}')") == "0")

# ═══ 6. who can see what ═══
lst = J(call("E2", "list_requests", q(oA)))
check("a colleague sees the company's requests", lst.get("total", 0) >= 6, str(lst)[:200])
check("the list carries totals, requester and who it waits on", all(k in lst["items"][0] for k in ("total", "requester_name", "waiting_on", "item_count")))
check("counts by status add up to the whole", sum(lst["counts"].values()) == int(SQL(f"select count(*) from purchase_requests where org_id='{oA}'")))
check("filtering by status works", all(i["status"] == "approved" for i in J(call("E2", "list_requests", q(oA), "'approved'"))["items"]))
check("'all' means no filter", J(call("E2", "list_requests", q(oA), "'all'"))["total"] == lst["total"])
check("the total sum is computed in the database", [i for i in lst["items"] if i["id"] == big["id"]][0]["total"] == 500000)
check("paging clamps silly sizes", len(J(call("E2", "list_requests", q(oA), "null", "1", "0"))["items"]) == 1 and len(J(call("E2", "list_requests", q(oA), "null", "-5", "-9"))["items"]) == 1)
denied("an unknown status is refused", call("E2", "list_requests", q(oA), "'sneaky'"), "invalid_status")
det = J(call("E", "get_request", q(big["id"])))
check("the detail has request, lines, approvals and timeline", all(k in det for k in ("request", "items", "approvals", "events")) and len(det["approvals"]) == 2 and len(det["items"]) == 1)
check("the timeline reads in order", [e["type"] for e in det["events"]] == ["created", "submitted", "routed", "approved", "approved"], str([e["type"] for e in det["events"]]))
check("the requester is told they are the requester", det["is_requester"] is True and det["can_decide"] is False)
check("a draft's detail has no timeline beyond creation", [e["type"] for e in J(call("E", "get_request", q(w2["id"])))["events"]][0] == "created")
# other companies and sides
for who, label in [("XO", "a stranger from another company"), ("S", "a supplier"), ("Z", "someone with no company"), ("SU", "a suspended member")]:
    denied(f"{label} cannot list the company's requests", call(who, "list_requests", q(oA)), "not_allowed")
    denied(f"{label} cannot create a request in it", create(who, oA, req()), "not_allowed")
    denied(f"{label} cannot count its approvals", call(who, "count_my_pending_approvals", q(oA)), "not_allowed")
    if True:
        denied(f"{label} cannot open a request (and cannot tell it exists)", call(who, "get_request", q(big["id"])), "not_found")
        denied(f"{label} cannot decide a request", call(who, "decide_request", q(emp["id"]), "'approved'", "''"), "not_found")
        denied(f"{label} cannot submit or delete a request", call(who, "submit_request", q(w["id"])), "not_found")
        denied(f"{label} cannot withdraw a request", call(who, "withdraw_request", q(w["id"])), "not_found")
        denied(f"{label} cannot delete a request", call(who, "delete_draft_request", q(w["id"])), "not_found")
denied("a made-up request id is the same answer as a hidden one", call("E", "get_request", q(uuid.uuid4())), "not_found")
denied("a made-up company is the same answer as a hidden one", call("E", "list_requests", q(uuid.uuid4())), "not_allowed")
denied("a null company is refused", call("E", "list_requests", "null"), "not_allowed")
check("another company's list only shows its own requests", J(call("XO", "list_requests", q(oX)))["total"] == 0 and J(call("DO", "list_requests", q(oD)))["total"] == 3)
denied("a signed-out visitor cannot call the functions", ANON("select list_requests('" + oA + "')"), "permission denied")
denied("a signed-out visitor cannot create", ANON(f"select create_request('{oA}', {jb(req())}, false)"), "permission denied")
check("a call with no sign-in at all is refused", sh(f"set local role authenticated; select list_requests('{oA}')")[0] is False)
for fn in ("_req_guard(uuid)", "_req_route(uuid)", "_req_event(uuid,uuid,text,text)", "_req_can_decide(uuid,uuid)", "_req_pick(uuid,uuid,int,uuid)", "_req_notify(uuid,uuid,text,text,uuid)"):
    check(f"the internal helper {fn.split('(')[0]} is not callable from the browser",
          SQL(f"select has_function_privilege('authenticated', 'public.{fn}', 'execute') or has_function_privilege('anon', 'public.{fn}', 'execute')") == "f")

# ═══ 7. the tables themselves are closed to writes ═══
denied("a member cannot insert a request directly", U("E", f"insert into purchase_requests(org_id,number,title,requester_id) values ('{oA}','PR-X','x','{ids['E']}')"), "permission denied")
denied("the owner cannot flip a request to approved directly", U("O", f"update purchase_requests set status='approved' where id='{w2['id']}'"), "permission denied")
denied("the owner cannot edit lines directly", U("O", f"update request_items set unit_price=1 where request_id='{w2['id']}'"), "permission denied")
denied("a member cannot approve a step directly", U("AP", f"update approval_steps set status='approved' where approver_id='{ids['AP']}'"), "permission denied")
denied("nobody deletes requests directly", U("E", f"delete from purchase_requests where id='{w['id']}'"), "permission denied")
denied("the timeline table cannot be read directly", U("E", "select count(*) from request_events"), "permission denied")
denied("the timeline table cannot be written directly", U("O", f"insert into request_events(org_id,request_id,type,text) values ('{oA}','{w['id']}','created','forged')"), "permission denied")
check("a stranger sees zero request rows even by direct read", U("XO", "select count(*) from purchase_requests")[1] == "0")
check("a supplier sees zero request rows even by direct read", U("S", "select count(*) from purchase_requests")[1] == "0")
check("a member can still read their company's rows directly", int(U("E2", "select count(*) from purchase_requests")[1]) >= 6)

# ═══ 8. audit log ═══
acts = SQL(f"select string_agg(distinct action, ',' order by action) from audit_log where org_id='{oA}' and entity='purchase_request'")
check("every kind of change is audited", all(a in acts for a in ("request_created", "request_submitted", "request_approved", "request_rejected", "request_withdrawn", "request_deleted")), acts)
check("the audit log holds ids only, no free text", "Over budget" not in SQL("select string_agg(detail::text, ' ') from audit_log"))

# ═══ 9. races ═══
def parallel(sqls):
    ps = [subprocess.Popen([PSQL, "-q", "-At", "-d", DB, "-v", "ON_ERROR_STOP=1"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True) for _ in sqls]
    for p, s in zip(ps, sqls): p.stdin.write(s); p.stdin.close()
    return [(p.wait() == 0, p.stdout.read(), p.stderr.read()) for p in ps]
pre = lambda k: f"begin; set local role authenticated; select set_config('request.jwt.claims', '{json.dumps({'sub': ids[k]})}', true); "
res = parallel([pre("E2") + f"select create_request('{oD}', {jb(req(title='Race ' + str(i)))}, false);".replace(oD, oA) + " commit;" for i in range(8)])
check("8 simultaneous requests all succeed", all(r[0] for r in res), str([r[2][:80] for r in res if not r[0]]))
nums = SQL(f"select count(distinct number)||'/'||count(*) from purchase_requests where org_id='{oA}' and title like 'Race %'")
check("and every one got its own number", nums == "8/8", nums)
rc = J(create("E", oA, req(title="Race to decide"), True))
res = parallel([pre("AP") + f"select decide_request('{rc['id']}', 'approved', 'a'); commit;", pre("O") + f"select decide_request('{rc['id']}', 'rejected', 'b'); commit;"])
check("two people deciding at once: exactly one wins", sorted(r[0] for r in res) == [False, True], str([r[2][:100] for r in res]))
check("and the request holds one decision", SQL(f"select count(*) from approval_steps where request_id='{rc['id']}' and status in ('approved','rejected')") == "1")

# ═══ 10. nothing leaked into other tables ═══
check("another company's data was never touched", SQL(f"select count(*) from purchase_requests where org_id='{oX}'") == "0")
print(f"{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
