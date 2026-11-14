#!/usr/bin/env python3
"""
Security tests for supabase/migrations/20261113000002_invite_only_onboarding.sql

It builds a THROWAWAY database `vendora_invite_test` (dropped and recreated every run), imitates the
parts of Supabase the migrations need (bootstrap_local_supabase.sql), applies the core migration, then
this one, and attacks it as different users. Never point it at a real project.

Usage (any local Postgres 14+, using the normal libpq variables):
    PGHOST=localhost PGPORT=5432 PGUSER=postgres python3 supabase/tests/invite_only/run_tests.py
"""
import json, os, subprocess, sys, uuid
HERE = os.path.dirname(os.path.abspath(__file__))
MIG = os.path.join(HERE, "..", "..", "migrations")
DB = "vendora_invite_test"
PSQL = os.environ.get("PSQL_BIN", "psql")

def run(args, sql=None, db=DB):
    r = subprocess.run([PSQL, "-q", "-At", "-v", "ON_ERROR_STOP=1", "-d", db] + args, input=sql, capture_output=True, text=True)
    return r

def sh(sql, role=None, sub=None):
    """Run SQL as the superuser, or as a Supabase role (anon / authenticated) with a given user id."""
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
def denied(name, res, word=""): check(name, (not res[0]) and word in res[2], res[2])
def J(res):
    try: return json.loads(res[1])
    except Exception: return {"state": "ERROR", "raw": res[1], "err": res[2][:200]}

# ───────── build the database: core migration first, then a legacy row, then the new migration ─────────
subprocess.run([PSQL, "-q", "-d", "postgres", "-c", f"drop database if exists {DB}"], check=True)
subprocess.run([PSQL, "-q", "-d", "postgres", "-c", f"create database {DB}"], check=True)
def apply(path):
    r = run(["-f", path]); 
    if r.returncode: print(r.stderr); sys.exit("migration failed: " + path)
apply(os.path.join(HERE, "bootstrap_local_supabase.sql"))
apply(os.path.join(MIG, "20261113000001_core_schema.sql"))

ids = {k: str(uuid.uuid4()) for k in "ABCDEFGH"}
users = {"A": ("a@acme.in", True), "B": ("b@beta.in", True), "C": ("c@x.com", True), "D": ("d@x.com", False),
         "E": ("e@x.com", True), "F": ("f@x.com", True), "G": ("g@acme.in", True), "H": ("h@x.com", True)}
for k, (em, conf) in users.items():
    sh(f"insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values ('{ids[k]}','{em}',{'now()' if conf else 'null'},'{{\"name\":\"User {k}\"}}')")
check("core trigger made profiles", sh("select count(*) from profiles")[1] == "8")

# a pre-existing invitation from before link tokens existed (core shape only)
orgL = sh("insert into businesses(slug,name) values ('legacy-co','Legacy Co') returning id")[1].splitlines()[0]
sh(f"insert into memberships(org_id,user_id,role) values ('{orgL}','{ids['A']}','owner')")
sh(f"insert into invitations(org_id,email,role,invited_by) values ('{orgL}','Old@X.com ','employee','{ids['A']}')")

apply(os.path.join(MIG, "20261113000002_invite_only_onboarding.sql"))
apply(os.path.join(MIG, "20261113000002_invite_only_onboarding.sql"))   # must be safe to run twice
check("legacy invitation closed + normalised", sh("select status||'|'||email from invitations where org_id='%s'" % orgL)[1] == "expired|old@x.com")
sh(f"delete from memberships where org_id='{orgL}'")   # (superuser cleanup; trigger allows it only because we remove org next)
sh(f"delete from businesses where id='{orgL}'")

def U(k, sql): return sh(sql, "authenticated", ids[k])
A = lambda s: U("A", s); B = lambda s: U("B", s)

# ───────── creating companies ─────────
orgA = A("select create_organization('Acme','acme-1','Mfg','Pune')")[1]
orgB = B("select create_organization('Beta','beta-1')")[1]       # 2-argument call must still work (core defaults kept)
check("orgs created", len(orgA) == 36 and len(orgB) == 36)
check("A sees only own org", A("select count(*) from businesses")[1] == "1")
check("B cannot read Acme members", B(f"select count(*) from memberships where org_id='{orgA}'")[1] == "0")
check("B cannot read Acme org row", B(f"select count(*) from businesses where id='{orgA}'")[1] == "0")
check("owner membership exists", sh(f"select role from memberships where org_id='{orgA}' and user_id='{ids['A']}'")[1] == "owner")
denied("bad slug refused", A("select create_organization('Valid Name','Bad Slug!','','')"), "invalid_slug")
denied("short name refused", A("select create_organization('x','ok-slug','','')"), "invalid_name")
denied("anon cannot create company", sh("select create_organization('Evil','evil-1')", "anon"), "permission denied")
for i in range(4): U("H", f"select create_organization('H Co {i}','h-co-{i}')")
U("H", "select create_organization('H Co 4','h-co-4')")
denied("6th company refused", U("H", "select create_organization('H Co 5','h-co-5')"), "too_many_companies")
check("audit: company creation recorded with entity", sh(f"select entity||'|'||action from audit_log where org_id='{orgA}'")[1] == "organization|organization_created")

# ───────── the core policies are tightened ─────────
denied("anon cannot read orgs", sh("select * from businesses", "anon"), "permission denied")
denied("anon cannot read invitations", sh("select * from invitations", "anon"), "permission denied")
denied("user cannot insert membership directly", B(f"insert into memberships(org_id,user_id,role) values ('{orgA}','{ids['B']}','owner')"), "permission denied")
denied("OWNER cannot insert membership directly", A(f"insert into memberships(org_id,user_id,role) values ('{orgA}','{ids['C']}','employee')"), "permission denied")
denied("OWNER cannot update membership directly", A(f"update memberships set role='employee' where org_id='{orgA}'"), "permission denied")
denied("OWNER cannot delete membership directly", A(f"delete from memberships where org_id='{orgA}'"), "permission denied")
denied("OWNER cannot read invitations table (token hashes stay hidden)", A("select token_hash from invitations"), "permission denied")
denied("OWNER cannot insert invitation directly", A(f"insert into invitations(org_id,email,role,invited_by,token_hash,expires_at) values ('{orgA}','z@x.com','employee','{ids['A']}','{'a'*64}',now()+interval '1 day')"), "permission denied")
denied("members cannot edit audit log", A("update audit_log set action='x'"), "permission denied")
denied("members cannot delete audit log", A("delete from audit_log"), "permission denied")

# ───────── creating invitations ─────────
denied("B cannot invite into Acme", B(f"select create_invitation('{orgA}','c@x.com','employee')"), "not_allowed")
denied("anon cannot call create_invitation", sh(f"select create_invitation('{orgA}','c@x.com','employee')", "anon"), "permission denied")
denied("invitation cannot grant owner", A(f"select create_invitation('{orgA}','q@x.com','owner')"), "invalid_role")
denied("bad role refused", A(f"select create_invitation('{orgA}','z@x.com','god')"), "invalid_role")
denied("bad email refused", A(f"select create_invitation('{orgA}','not-an-email','employee')"), "invalid_email")
denied("invite existing member refused", A(f"select create_invitation('{orgA}','a@acme.in','employee')"), "already_member")

inv = J(A(f"select create_invitation('{orgA}','C@X.com ','employee')")); tok = inv["token"]
check("token is 64 hex", len(tok) == 64 and all(c in "0123456789abcdef" for c in tok))
check("email normalised", inv["email"] == "c@x.com")
check("inviter name comes from profile", inv["inviterName"] == "User A")
check("raw token is not stored", sh(f"select count(*) from invitations where token_hash='{tok}'")[1] == "0")
check("hash is stored", sh("select count(*) from invitations where char_length(token_hash)=64")[1] == "1")
check("status is pending", sh("select status from invitations where token_hash is not null")[1] == "pending")
check("expiry is ~7 days", sh("select (expires_at - sent_at) between interval '6 days 23 hours' and interval '7 days 1 hour' from invitations where token_hash is not null")[1] == "t")
check("audit: invitation recorded", sh(f"select count(*) from audit_log where action='invitation_created' and entity='invitation'")[1] == "1")
check("audit has no token", sh(f"select count(*) from audit_log where detail::text like '%{tok}%'")[1] == "0")

# ───────── before sign-in ─────────
check("peek anon valid + masked", J(sh(f"select peek_invitation('{tok}')", "anon")) == {"state": "valid", "maskedEmail": "c***@x.com"})
check("peek garbage invalid", J(sh("select peek_invitation('nope')", "anon"))["state"] == "invalid")
check("peek wrong token invalid", J(sh(f"select peek_invitation('{'0'*64}')", "anon"))["state"] == "invalid")
denied("anon cannot preview", sh(f"select preview_invitation('{tok}')", "anon"), "permission denied")
denied("anon cannot accept", sh(f"select accept_invitation('{tok}')", "anon"), "permission denied")

# ───────── stolen link / unverified email ─────────
check("wrong email preview", J(U("E", f"select preview_invitation('{tok}')"))["state"] == "wrong_email")
check("wrong email accept refused", J(U("E", f"select accept_invitation('{tok}')"))["state"] == "wrong_email")
check("no membership for thief", sh(f"select count(*) from memberships where user_id='{ids['E']}'")[1] == "0")
sh(f"update auth.users set email='tmp-c@x.com' where id='{ids['C']}'")
sh(f"update auth.users set email='c@x.com' where id='{ids['D']}'")
check("unverified email refused", J(U("D", f"select accept_invitation('{tok}')"))["state"] == "unverified")
sh(f"update auth.users set email='d@x.com' where id='{ids['D']}'")
sh(f"update auth.users set email='c@x.com' where id='{ids['C']}'")

# ───────── accepting ─────────
pv = J(U("C", f"select preview_invitation('{tok}')"))
check("preview ok shows role+org", pv["state"] == "ok" and pv["role"] == "employee" and pv["orgName"] == "Acme")
acc = J(U("C", f"select accept_invitation('{tok}')"))
check("accept ok with invited role", acc["state"] == "ok" and acc["role"] == "employee" and acc["orgId"] == orgA)
check("status accepted", sh("select status||'|'||(used_at is not null)||'|'||(used_by is not null) from invitations where token_hash is not null")[1] == "accepted|true|true")
check("single use (same user)", J(U("C", f"select accept_invitation('{tok}')"))["state"] == "used")
check("single use (other user)", J(U("E", f"select accept_invitation('{tok}')"))["state"] == "used")
check("peek shows used", J(sh(f"select peek_invitation('{tok}')", "anon"))["state"] == "used")
check("audit: acceptance recorded", sh("select count(*) from audit_log where action='invitation_accepted'")[1] == "1")

# ───────── what the new employee can and cannot do ─────────
check("C sees Acme only", U("C", "select count(*) from businesses")[1] == "1")
denied("employee cannot invite", U("C", f"select create_invitation('{orgA}','q@x.com','employee')"), "not_allowed")
denied("employee cannot change roles", U("C", f"select set_member_role('{orgA}','{ids['C']}','owner')"), "not_allowed")
denied("employee cannot list invitations", U("C", f"select * from list_invitations('{orgA}')"), "not_allowed")
check("employee sees 0 audit rows (core rule: owner/finance only)", U("C", "select count(*) from audit_log")[1] == "0")
check("employee can list members", U("C", f"select count(*) from list_members('{orgA}')")[1] == "2")
check("member names come from profiles", U("C", f"select name from list_members('{orgA}') where user_id='{ids['A']}'")[1] == "User A")
denied("outsider cannot list members", B(f"select * from list_members('{orgA}')"), "not_allowed")
denied("direct role update blocked", U("C", f"update memberships set role='owner' where user_id='{ids['C']}'"), "permission denied")
check("core RLS still isolates business data: employee cannot add suppliers",
      not U("C", f"insert into suppliers(org_id,name) values ('{orgA}','Sneaky')")[0])
check("core RLS: owner can add suppliers", A(f"insert into suppliers(org_id,name) values ('{orgA}','Real Supplier')")[0])
check("core RLS: other company cannot see them", B("select count(*) from suppliers")[1] == "0")
check("core RLS: member can see them", U("C", "select count(*) from suppliers")[1] == "1")

# ───────── owner management ─────────
denied("owner cannot change own role", A(f"select set_member_role('{orgA}','{ids['A']}','employee')"), "cannot_change_self")
denied("owner cannot change own access", A(f"select set_member_status('{orgA}','{ids['A']}','suspended')"), "cannot_change_self")
denied("invalid role refused", A(f"select set_member_role('{orgA}','{ids['C']}','god')"), "invalid_role")
denied("unknown member refused", A(f"select set_member_role('{orgA}','{ids['E']}','approver')"), "not_found")
ok("owner changes C role", A(f"select set_member_role('{orgA}','{ids['C']}','approver')"))
check("role changed in db", sh(f"select role from memberships where user_id='{ids['C']}'")[1] == "approver")
check("audit: role change recorded", sh("select detail->>'from'||'>'||(detail->>'to') from audit_log where action='role_changed'")[1] == "employee>approver")
ok("owner suspends C", A(f"select set_member_status('{orgA}','{ids['C']}','suspended')"))
check("suspended C loses all access", U("C", "select count(*) from businesses")[1] == "0")
check("suspended C sees no suppliers", U("C", "select count(*) from suppliers")[1] == "0")
denied("suspended C cannot list members", U("C", f"select * from list_members('{orgA}')"), "not_allowed")
ok("owner reactivates C", A(f"select set_member_status('{orgA}','{ids['C']}','active')"))
denied("B cannot touch Acme member", B(f"select set_member_role('{orgA}','{ids['C']}','owner')"), "not_allowed")

# ───────── last owner (enforced by trigger, so even a superuser-side bug cannot break it) ─────────
denied("last owner cannot be downgraded", sh(f"update memberships set role='employee' where user_id='{ids['A']}' and org_id='{orgA}'"), "last_owner")
denied("last owner cannot be suspended", sh(f"update memberships set status='suspended' where user_id='{ids['A']}' and org_id='{orgA}'"), "last_owner")
denied("last owner cannot be deleted", sh(f"delete from memberships where user_id='{ids['A']}' and org_id='{orgA}'"), "last_owner")
ok("promote C to owner (after joining)", A(f"select set_member_role('{orgA}','{ids['C']}','owner')"))
ok("now A may be downgraded (another owner exists)", sh(f"update memberships set role='employee' where user_id='{ids['A']}' and org_id='{orgA}'"))
denied("but then C is the last owner", sh(f"update memberships set role='employee' where user_id='{ids['C']}' and org_id='{orgA}'"), "last_owner")
sh(f"update memberships set role='owner' where user_id='{ids['A']}' and org_id='{orgA}'")
sh(f"update memberships set role='employee' where user_id='{ids['C']}' and org_id='{orgA}'")

# ───────── finance manager reads the audit trail (core rule), cannot manage team ─────────
J2 = J(A(f"select create_invitation('{orgA}','g@acme.in','finance_manager')"))
check("finance accept ok", J(U("G", f"select accept_invitation('{J2['token']}')"))["state"] == "ok")
check("finance manager can read audit log", int(U("G", "select count(*) from audit_log")[1]) >= 4)
denied("finance manager cannot invite", U("G", f"select create_invitation('{orgA}','q@x.com','employee')"), "not_allowed")

# ───────── revoke / resend / expire ─────────
i2 = J(A(f"select create_invitation('{orgA}','f@x.com','finance_manager')"))
i3 = J(A(f"select create_invitation('{orgA}','f@x.com','finance_manager')"))
check("resend invalidates older link", J(U("F", f"select accept_invitation('{i2['token']}')"))["state"] == "revoked")
check("only one open invite per email", sh("select count(*) from invitations where email='f@x.com' and status='pending'")[1] == "1")
check("pending list shows it", A(f"select count(*) from list_invitations('{orgA}')")[1] == "1")
ok("owner revokes", A(f"select revoke_invitation('{i3['id']}')"))
check("revoked link refused", J(U("F", f"select accept_invitation('{i3['token']}')"))["state"] == "revoked")
check("peek shows revoked", J(sh(f"select peek_invitation('{i3['token']}')", "anon"))["state"] == "revoked")
denied("outsider cannot revoke", B(f"select revoke_invitation('{i3['id']}')"), "not_allowed")
denied("outsider cannot list", B(f"select * from list_invitations('{orgA}')"), "not_allowed")
i4 = J(A(f"select create_invitation('{orgA}','f@x.com','employee')"))
sh(f"update invitations set expires_at = now() - interval '1 minute' where id='{i4['id']}'")
check("expired link refused", J(U("F", f"select accept_invitation('{i4['token']}')"))["state"] == "expired")
check("peek shows expired", J(sh(f"select peek_invitation('{i4['token']}')", "anon"))["state"] == "expired")
check("expired invite listed as expired (so owner can resend)", A(f"select expired from list_invitations('{orgA}')")[1] == "t")
check("audit: revocation recorded", sh("select count(*) from audit_log where action='invitation_revoked'")[1] == "1")

# ───────── already a member / suspended person is not reactivated by a link ─────────
sh(f"update memberships set status='suspended' where user_id='{ids['C']}' and org_id='{orgA}'")
sh(f"insert into invitations(org_id,email,role,invited_by,token_hash,expires_at) values ('{orgA}','c@x.com','employee','{ids['A']}',encode(sha256(convert_to('{'b'*64}','utf8')),'hex'),now()+interval '1 day')")
r = J(U("C", f"select accept_invitation('{'b'*64}')"))
check("already_member state", r["state"] == "already_member")
check("suspended person NOT reactivated by link", sh(f"select status from memberships where user_id='{ids['C']}' and org_id='{orgA}'")[1] == "suspended")

# ───────── two companies stay apart ─────────
check("A cannot see Beta's anything", A(f"select count(*) from memberships where org_id='{orgB}'")[1] == "0")
check("Beta audit stays inside Beta", B("select count(*) from audit_log")[1] == "1")
check("function privileges: authenticated cannot call internal helpers", not U("A", f"select _audit('{orgA}','x','y',null,'{{}}')")[0])
check("function privileges: authenticated cannot call _invite_state", not U("A", "select _invite_state(null::invitations)")[0])

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
