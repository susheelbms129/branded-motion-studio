-- Vendora: invite-only onboarding. Builds ON TOP of 20261113000001_core_schema.sql (run that first).
-- Run in the Supabase SQL editor, or with `supabase db push`. Safe to run twice.
--
-- Rules enforced here, in the database (the browser is never trusted):
--   * Nobody writes to memberships or invitations directly. Every change goes through the functions
--     below, which check who the caller is and what role they hold in THAT company.
--   * Invitation tokens are stored only as SHA-256 hashes. Single use, 7-day expiry, bound to one
--     email and one role, cancellable by the owner before use. The table cannot be read by users.
--   * Accepting needs a VERIFIED email that matches the invitation. The role comes from the
--     invitation row, never from the client. An invitation can never grant 'owner' (core rule);
--     an owner promotes someone after they have joined.
--   * The last active owner of a company can never be removed, suspended or downgraded.
--   * Invites, role changes, suspensions and acceptances are written to the core audit_log.
--
-- REQUIRED in the Supabase dashboard: Authentication -> Providers -> Email -> "Confirm email" = ON.
-- (If it is off, anyone could register someone else's email address and accept their invitation.)

-- ───────────────────────── 0. preflight ─────────────────────────
do $$ begin
  if to_regclass('public.invitations') is null
     or to_regclass('public.memberships') is null
     or to_regclass('public.audit_log') is null
     or to_regprocedure('public.is_member(uuid)') is null then
    raise exception 'Run 20261113000001_core_schema.sql first.';
  end if;
end $$;

-- ───────────────────────── 1. invitations: add what invite links need ─────────────────────────
-- Core has: id, org_id, email, role, invited_by, sent_at, status.
alter table public.invitations add column if not exists token_hash text;      -- SHA-256 of the link token; the token itself is never stored
alter table public.invitations add column if not exists expires_at timestamptz;
alter table public.invitations add column if not exists used_at    timestamptz;
alter table public.invitations add column if not exists used_by    uuid references auth.users(id) on delete set null;
alter table public.invitations add column if not exists revoked_at timestamptz;

-- Rows that existed before link tokens can never be accepted (they have no token): close them.
update public.invitations set expires_at = sent_at + interval '7 days' where expires_at is null;
update public.invitations set status = 'expired' where token_hash is null and status = 'pending';
update public.invitations set email = lower(btrim(email)) where email <> lower(btrim(email));
alter table public.invitations alter column expires_at set not null;

-- status gains 'revoked'. Its meaning: pending = open, accepted = used, revoked = cancelled by the owner.
-- (An open invitation past expires_at is treated as expired at read time.)
alter table public.invitations drop constraint if exists invitations_status_check;
alter table public.invitations add  constraint invitations_status_check
  check (status in ('pending','expired','accepted','revoked'));
alter table public.invitations drop constraint if exists invitations_email_normalised;
alter table public.invitations add  constraint invitations_email_normalised
  check (email = lower(email) and char_length(email) <= 254);
alter table public.invitations drop constraint if exists invitations_token_hash_format;
alter table public.invitations add  constraint invitations_token_hash_format
  check (token_hash is null or token_hash ~ '^[0-9a-f]{64}$');

create unique index if not exists invitations_token_hash_key on public.invitations (token_hash);
-- one open invitation per person per company
create unique index if not exists invitations_one_open on public.invitations (org_id, email) where status = 'pending';

-- ───────────────────────── 2. helpers ─────────────────────────
-- (Core already provides is_member(org) and has_role(org, roles[]).)
create or replace function public.org_role(p_org uuid)
returns text language sql stable security definer set search_path = '' as $$
  select m.role from public.memberships m
  where m.org_id = p_org and m.user_id = (select auth.uid()) and m.status = 'active'
$$;

create or replace function public._display_name(p_user uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select nullif(btrim(p.name), '') from public.profiles p where p.user_id = p_user),
    (select nullif(btrim(u.raw_user_meta_data ->> 'name'), '') from auth.users u where u.id = p_user),
    (select nullif(split_part(u.email, '@', 1), '') from auth.users u where u.id = p_user),
    'A teammate')
$$;

-- Writes to core's audit_log. Only these functions write the entries that matter (they run as the table owner).
create or replace function public._audit(p_org uuid, p_action text, p_entity text, p_entity_id uuid, p_detail jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, detail)
  values (p_org, (select auth.uid()), p_action, p_entity, p_entity_id, coalesce(p_detail, '{}'::jsonb))
$$;

-- One place that decides whether an invitation can still be used.
create or replace function public._invite_state(p_inv public.invitations)
returns text language sql stable set search_path = '' as $$
  select case
    when p_inv.status = 'accepted' or p_inv.used_at is not null then 'used'
    when p_inv.status = 'revoked'  or p_inv.revoked_at is not null then 'revoked'
    when p_inv.status = 'expired'  or p_inv.expires_at <= now() then 'expired'
    else 'valid' end
$$;

-- ───────────────────────── 3. last-owner protection (race-safe) ─────────────────────────
create or replace function public.guard_last_owner()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.role = 'owner' and old.status = 'active'
     and (tg_op = 'DELETE' or new.role <> 'owner' or new.status <> 'active') then
    if tg_op = 'DELETE' and not exists (select 1 from public.organizations o where o.id = old.org_id) then
      return old;   -- the whole company is being deleted
    end if;
    perform pg_advisory_xact_lock(hashtextextended(old.org_id::text, 0));
    if not exists (select 1 from public.memberships m
                   where m.org_id = old.org_id and m.id <> old.id and m.role = 'owner' and m.status = 'active') then
      raise exception 'last_owner: a company must keep at least one active owner';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists guard_last_owner on public.memberships;
create trigger guard_last_owner before update or delete on public.memberships
  for each row execute function public.guard_last_owner();

-- ───────────────────────── 4. tighten the core policies ─────────────────────────
-- Core let an owner write memberships and invitations directly. Invite-only needs the opposite:
-- these two tables change ONLY through the functions below (so every change is checked and audited,
-- and token hashes never leave the database).
drop policy if exists inv_owner on public.invitations;
revoke all on public.invitations from anon, authenticated;

drop policy if exists member_owner_write on public.memberships;
revoke insert, update, delete, truncate on public.memberships from authenticated;
-- member_select (core) stays: members can read their company's memberships.

-- ───────────────────────── 5. functions the app calls ─────────────────────────
-- Same signature as core (so the app's existing call keeps working), now with validation and a cap.
create or replace function public.create_organization(p_name text, p_slug text, p_industry text default '', p_city text default '')
returns uuid language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); v_name text := btrim(coalesce(p_name, '')); v_slug text; v_id uuid;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if char_length(v_name) < 2 or char_length(v_name) > 120 then raise exception 'invalid_name'; end if;
  v_slug := lower(coalesce(p_slug, ''));
  if v_slug !~ '^[a-z0-9][a-z0-9-]{1,59}$' then raise exception 'invalid_slug'; end if;
  if (select count(*) from public.memberships where user_id = uid and role = 'owner') >= 5 then
    raise exception 'too_many_companies';
  end if;
  insert into public.organizations (name, slug, industry, city)
    values (v_name, v_slug, left(btrim(coalesce(p_industry, '')), 80), left(btrim(coalesce(p_city, '')), 80))
    returning id into v_id;
  insert into public.memberships (org_id, user_id, role, status) values (v_id, uid, 'owner', 'active');
  perform public._audit(v_id, 'organization_created', 'organization', v_id, jsonb_build_object('name', v_name));
  return v_id;
end $$;

-- Returns the raw link token ONCE, to the caller (our server), which emails it. Only the hash is stored.
drop function if exists public.create_invitation(uuid, text, text);
create function public.create_invitation(p_org uuid, p_email text, p_role text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid()); v_email text := lower(btrim(coalesce(p_email, '')));
  v_token text; v_id uuid; v_exp timestamptz := now() + interval '7 days'; v_org text;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if public.org_role(p_org) is distinct from 'owner' then raise exception 'not_allowed'; end if;
  if p_role is null or p_role not in ('procurement_manager','finance_manager','approver','employee') then
    raise exception 'invalid_role';
  end if;
  if char_length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'invalid_email'; end if;
  if (select count(*) from public.invitations where org_id = p_org and sent_at > now() - interval '1 hour') >= 50 then
    raise exception 'rate_limited';
  end if;
  if exists (select 1 from public.memberships m join auth.users u on u.id = m.user_id
             where m.org_id = p_org and lower(u.email) = v_email) then
    raise exception 'already_member';
  end if;
  -- sending again cancels the older link
  update public.invitations set status = 'revoked', revoked_at = now()
    where org_id = p_org and email = v_email and status = 'pending';
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');   -- 64 hex chars
  insert into public.invitations (org_id, email, role, token_hash, invited_by, expires_at)
    values (p_org, v_email, p_role, encode(sha256(convert_to(v_token, 'utf8')), 'hex'), uid, v_exp)
    returning id into v_id;
  select name into v_org from public.organizations where id = p_org;
  perform public._audit(p_org, 'invitation_created', 'invitation', v_id, jsonb_build_object('email', v_email, 'role', p_role));
  return jsonb_build_object('id', v_id, 'token', v_token, 'expiresAt', v_exp, 'orgName', v_org,
                            'inviterName', public._display_name(uid), 'role', p_role, 'email', v_email);
end $$;

drop function if exists public.revoke_invitation(uuid);
create function public.revoke_invitation(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.invitations;
begin
  select * into v from public.invitations where id = p_id;
  if not found or public.org_role(v.org_id) is distinct from 'owner' then raise exception 'not_allowed'; end if;
  update public.invitations set status = 'revoked', revoked_at = now() where id = p_id and status = 'pending';
  perform public._audit(v.org_id, 'invitation_revoked', 'invitation', p_id, jsonb_build_object('email', v.email));
end $$;

drop function if exists public.list_invitations(uuid);
create function public.list_invitations(p_org uuid)
returns table (id uuid, email text, role text, invited_by_name text, created_at timestamptz, expires_at timestamptz, expired boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if public.org_role(p_org) is distinct from 'owner' then raise exception 'not_allowed'; end if;
  return query
    select i.id, i.email, i.role, public._display_name(i.invited_by), i.sent_at, i.expires_at, i.expires_at <= now()
    from public.invitations i
    where i.org_id = p_org and i.status in ('pending', 'expired') and i.token_hash is not null
    order by i.sent_at desc;
end $$;

drop function if exists public.list_members(uuid);
create function public.list_members(p_org uuid)
returns table (user_id uuid, name text, email text, role text, department text, status text, joined_at timestamptz, last_sign_in_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_member(p_org) then raise exception 'not_allowed'; end if;
  return query
    select m.user_id, public._display_name(m.user_id), u.email::text, m.role, m.department, m.status, m.joined_at, u.last_sign_in_at
    from public.memberships m join auth.users u on u.id = m.user_id
    where m.org_id = p_org
    order by m.joined_at;
end $$;

drop function if exists public.set_member_role(uuid, uuid, text);
create function public.set_member_role(p_org uuid, p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_old text; v_mid uuid;
begin
  if public.org_role(p_org) is distinct from 'owner' then raise exception 'not_allowed'; end if;
  if p_user = (select auth.uid()) then raise exception 'cannot_change_self'; end if;
  if p_role is null or p_role not in ('owner','procurement_manager','finance_manager','approver','employee') then
    raise exception 'invalid_role';
  end if;
  select id, role into v_mid, v_old from public.memberships where org_id = p_org and user_id = p_user;
  if not found then raise exception 'not_found'; end if;
  update public.memberships set role = p_role where id = v_mid;
  perform public._audit(p_org, 'role_changed', 'membership', v_mid, jsonb_build_object('user_id', p_user, 'from', v_old, 'to', p_role));
end $$;

drop function if exists public.set_member_status(uuid, uuid, text);
create function public.set_member_status(p_org uuid, p_user uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_mid uuid;
begin
  if public.org_role(p_org) is distinct from 'owner' then raise exception 'not_allowed'; end if;
  if p_user = (select auth.uid()) then raise exception 'cannot_change_self'; end if;
  if p_status is null or p_status not in ('active','suspended') then raise exception 'invalid_status'; end if;
  update public.memberships set status = p_status where org_id = p_org and user_id = p_user returning id into v_mid;
  if not found then raise exception 'not_found'; end if;
  perform public._audit(p_org, 'member_status_changed', 'membership', v_mid, jsonb_build_object('user_id', p_user, 'status', p_status));
end $$;

-- ───────────────────────── 6. the invitation link: look up and accept ─────────────────────────
-- Before sign-in: only says whether the link is usable, and shows a masked email.
drop function if exists public.peek_invitation(text);
create function public.peek_invitation(p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v public.invitations; v_state text;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then return jsonb_build_object('state', 'invalid'); end if;
  select * into v from public.invitations where token_hash = encode(sha256(convert_to(p_token, 'utf8')), 'hex');
  if not found then return jsonb_build_object('state', 'invalid'); end if;
  v_state := public._invite_state(v);
  if v_state <> 'valid' then return jsonb_build_object('state', v_state); end if;
  return jsonb_build_object('state', 'valid',
    'maskedEmail', left(split_part(v.email, '@', 1), 1) || '***@' || split_part(v.email, '@', 2));
end $$;

-- After sign-in: shows company, role and inviter only if the signed-in, VERIFIED email matches.
drop function if exists public.preview_invitation(text);
create function public.preview_invitation(p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v public.invitations; v_mail text; v_ok timestamptz; v_peek jsonb;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated'; end if;
  v_peek := public.peek_invitation(p_token);
  if v_peek ->> 'state' <> 'valid' then return v_peek; end if;
  select * into v from public.invitations where token_hash = encode(sha256(convert_to(p_token, 'utf8')), 'hex');
  select lower(email), email_confirmed_at into v_mail, v_ok from auth.users where id = (select auth.uid());
  if v_ok is null then return jsonb_build_object('state', 'unverified'); end if;
  if v_mail is distinct from v.email then
    return jsonb_build_object('state', 'wrong_email', 'maskedEmail', v_peek ->> 'maskedEmail');
  end if;
  return jsonb_build_object('state', 'ok', 'email', v.email, 'role', v.role,
    'orgName', (select name from public.organizations where id = v.org_id),
    'inviterName', public._display_name(v.invited_by));
end $$;

drop function if exists public.accept_invitation(text);
create function public.accept_invitation(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); v public.invitations; v_state text; v_mail text; v_ok timestamptz; v_org text;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then return jsonb_build_object('state', 'invalid'); end if;
  select * into v from public.invitations
    where token_hash = encode(sha256(convert_to(p_token, 'utf8')), 'hex') for update;   -- row lock: single use even under races
  if not found then return jsonb_build_object('state', 'invalid'); end if;
  v_state := public._invite_state(v);
  if v_state <> 'valid' then return jsonb_build_object('state', v_state); end if;
  select lower(email), email_confirmed_at into v_mail, v_ok from auth.users where id = uid;
  if v_ok is null then return jsonb_build_object('state', 'unverified'); end if;
  if v_mail is distinct from v.email then
    return jsonb_build_object('state', 'wrong_email',
      'maskedEmail', left(split_part(v.email, '@', 1), 1) || '***@' || split_part(v.email, '@', 2));
  end if;
  select name into v_org from public.organizations where id = v.org_id;
  -- Already on the team (even suspended): burn the link, change nothing. A suspended person is not reactivated by a link.
  if exists (select 1 from public.memberships where org_id = v.org_id and user_id = uid) then
    update public.invitations set status = 'accepted', used_at = now(), used_by = uid where id = v.id;
    return jsonb_build_object('state', 'already_member', 'orgId', v.org_id, 'orgName', v_org);
  end if;
  insert into public.memberships (org_id, user_id, role, status) values (v.org_id, uid, v.role, 'active');
  update public.invitations set status = 'accepted', used_at = now(), used_by = uid where id = v.id;
  perform public._audit(v.org_id, 'invitation_accepted', 'invitation', v.id, jsonb_build_object('email', v.email, 'role', v.role));
  return jsonb_build_object('state', 'ok', 'orgId', v.org_id, 'orgName', v_org, 'role', v.role);
end $$;

-- ───────────────────────── 7. who may call what ─────────────────────────
-- Supabase grants EXECUTE on new functions to everyone by default; take it away, then grant exactly what is needed.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in
             ('org_role','_display_name','_audit','_invite_state','guard_last_owner',
              'create_organization','create_invitation','revoke_invitation','list_invitations','list_members',
              'set_member_role','set_member_status','peek_invitation','preview_invitation','accept_invitation')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;

grant execute on function
  public.create_organization(text, text, text, text),
  public.create_invitation(uuid, text, text),
  public.revoke_invitation(uuid),
  public.list_invitations(uuid),
  public.list_members(uuid),
  public.set_member_role(uuid, uuid, text),
  public.set_member_status(uuid, uuid, text),
  public.preview_invitation(text),
  public.accept_invitation(text)
  to authenticated;
-- the only thing a signed-out visitor may call: "is this link still usable?"
grant execute on function public.peek_invitation(text) to anon, authenticated;

notify pgrst, 'reload schema';
