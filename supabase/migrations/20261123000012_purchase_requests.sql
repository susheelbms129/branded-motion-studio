-- Vendora purchase requests (migration 12). Run AFTER migrations 1-11. Safe to run twice.
--
-- What buyers get: real purchase requests. A team member raises a request, it is routed to the right approver, and every
-- step is recorded on a timeline. Nothing about a request lives in the browser any more.
--
-- Safety (no data leaks and no shortcuts are the first rules)
--   * The browser can READ the three request tables (company members only, buyer companies only), but it can no longer
--     WRITE them. Before this migration an owner or procurement manager could edit a request row directly and set its
--     status to "approved", skipping the approval chain. Now every change goes through the functions below, which check
--     who is asking and what state the request is in.
--   * Every function proves the caller is an ACTIVE member of a BUYER company. Supplier companies, strangers and made-up ids
--     all get the same answer, so nobody can learn whether a request or a company exists.
--   * Nobody approves their own request. The assigned approver decides; the company owner can step in if the approver is away.
--   * Two people deciding at the same moment cannot both win: the request row is locked while a decision is made.
--   * Input is checked on the server (lengths, quantities, prices, dates, at most 50 lines). The browser's checks are only
--     for convenience.
--   * Numbers are PR-<year>-<0001...> per company. They are handed out under a lock, so two people never get the same number.
--   * Every create, submit, decision, withdrawal and deletion is written to the audit log (ids only, no free text).
--   * The timeline (request_events) is append-only from the app's point of view: no function edits or deletes an event.

-- ───────────── 1. shape of the tables ─────────────
alter table public.purchase_requests add column if not exists category text not null default '';
alter table public.purchase_requests add column if not exists submitted_at timestamptz;
alter table public.request_items add column if not exists position int not null default 0;

create table if not exists public.request_events (
  id         bigint generated always as identity primary key,
  org_id     uuid not null references public.businesses(id) on delete cascade,
  request_id uuid not null references public.purchase_requests(id) on delete cascade,
  actor_id   uuid references auth.users(id) on delete set null,
  type       text not null check (type in ('created', 'submitted', 'routed', 'approved', 'rejected', 'withdrawn', 'auto_approved')),
  text       text not null,
  at         timestamptz not null default clock_timestamp()
);
create index if not exists request_events_request_idx on public.request_events (request_id, id);
create index if not exists request_events_org_idx on public.request_events (org_id);
alter table public.request_events enable row level security;
revoke all on public.request_events from public, anon, authenticated;
-- (no policies on purpose: the timeline is only reachable through get_request())

-- The browser may read requests (RLS keeps it to the company) but never write them directly.
revoke insert, update, delete on public.purchase_requests, public.request_items, public.approval_steps from authenticated;

-- ───────────── 2. small helpers (not callable from the browser) ─────────────
-- Returns the caller's role in a BUYER company, or null when the caller is not an active member of it.
create or replace function public._req_role(p_org uuid)
returns text language sql stable security definer set search_path = '' as $$
  select m.role from public.memberships m join public.businesses b on b.id = m.org_id
   where m.org_id = p_org and m.user_id = (select auth.uid()) and m.status = 'active' and b.kind = 'buyer'
$$;

-- Same, but raises: not_authenticated / not_allowed.
create or replace function public._req_guard(p_org uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare v_role text;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated'; end if;
  v_role := public._req_role(p_org);
  if v_role is null then raise exception 'not_allowed'; end if;
  return v_role;
end $$;

create or replace function public._req_txt(p jsonb, k text, p_min int, p_max int, p_code text)
returns text language plpgsql immutable set search_path = '' as $$
declare t text;
begin
  if p -> k is null or jsonb_typeof(p -> k) <> 'string' then raise exception using message = p_code, errcode = '22023'; end if;
  t := btrim(p ->> k);
  if char_length(t) < p_min or char_length(t) > p_max then raise exception using message = p_code, errcode = '22023'; end if;
  return t;
end $$;

create or replace function public._req_num(p jsonb, k text, p_max numeric, p_decimals int, p_allow_zero boolean, p_code text)
returns numeric language plpgsql immutable set search_path = '' as $$
declare t text; n numeric;
begin
  if p -> k is null or jsonb_typeof(p -> k) not in ('number', 'string') then raise exception using message = p_code, errcode = '22023'; end if;
  t := btrim(p ->> k);
  if t !~ ('^[0-9]{1,12}(\.[0-9]{1,' || p_decimals || '})?$') then raise exception using message = p_code, errcode = '22023'; end if;
  n := t::numeric;
  if n > p_max or (n = 0 and not p_allow_zero) then raise exception using message = p_code, errcode = '22023'; end if;
  return n;
end $$;

create or replace function public._req_event(p_org uuid, p_request uuid, p_type text, p_text text)
returns void language sql security definer set search_path = '' as $$
  insert into public.request_events (org_id, request_id, actor_id, type, text)
  values (p_org, p_request, (select auth.uid()), p_type, p_text)
$$;

create or replace function public._req_notify(p_org uuid, p_user uuid, p_title text, p_body text, p_request uuid)
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications (org_id, user_id, kind, title, body, link_to)
  values (p_org, p_user, 'request', p_title, p_body, 'requests/' || p_request::text)
$$;

create or replace function public._req_total(p_request uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce(sum(i.qty * i.unit_price), 0) from public.request_items i where i.request_id = p_request
$$;

-- Can this person decide the request's current step right now? One rule, used by decide_request, get_request and the count.
create or replace function public._req_can_decide(p_request uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.purchase_requests r
      join public.approval_steps s on s.request_id = r.id and s.status = 'pending'
      join public.memberships m on m.org_id = r.org_id and m.user_id = p_user and m.status = 'active'
      join public.businesses b on b.id = r.org_id and b.kind = 'buyer'
     where r.id = p_request and r.status = 'pending_approval'
       and r.requester_id <> p_user
       and m.role in ('owner', 'procurement_manager', 'finance_manager', 'approver')
       and (s.approver_id = p_user or m.role = 'owner'))
$$;

-- Picks who approves. Level 1: a dedicated approver first, then procurement, finance, owner. Level 2 (only above
-- ₹2,00,000): finance first, then owner, never the same person as level 1. Nobody approves their own request.
create or replace function public._req_pick(p_org uuid, p_requester uuid, p_level int, p_exclude uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select m.user_id from public.memberships m
   where m.org_id = p_org and m.status = 'active' and m.user_id <> p_requester and m.user_id is distinct from p_exclude
     and m.role = any (case when p_level = 1 then array['approver', 'procurement_manager', 'finance_manager', 'owner']
                            else array['finance_manager', 'owner'] end)
   order by case when p_level = 1
                 then case m.role when 'approver' then 1 when 'procurement_manager' then 2 when 'finance_manager' then 3 else 4 end
                 else case m.role when 'finance_manager' then 1 else 2 end end,
            m.joined_at, m.user_id
   limit 1
$$;

-- Sends a draft into approval (or approves it straight away when the requester is the only person who could).
create or replace function public._req_route(p_request uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare r public.purchase_requests; v_total numeric; v_l1 uuid; v_l2 uuid; v_role text;
begin
  select * into r from public.purchase_requests where id = p_request;
  v_total := public._req_total(p_request);
  v_l1 := public._req_pick(r.org_id, r.requester_id, 1, null);
  if v_total > 200000 then v_l2 := public._req_pick(r.org_id, r.requester_id, 2, v_l1); end if;

  if v_l1 is null then
    select m.role into v_role from public.memberships m where m.org_id = r.org_id and m.user_id = r.requester_id and m.status = 'active';
    if v_role is null or v_role not in ('owner', 'procurement_manager', 'finance_manager', 'approver') then
      raise exception 'no_approver';
    end if;
    update public.purchase_requests set status = 'approved', submitted_at = now() where id = p_request;
    perform public._req_event(r.org_id, p_request, 'submitted', 'Submitted for approval');
    perform public._req_event(r.org_id, p_request, 'auto_approved',
      'Approved automatically: nobody else in your company can approve requests yet. Invite a teammate to add a second pair of eyes.');
    perform public._audit(r.org_id, 'request_auto_approved', 'purchase_request', p_request, '{}'::jsonb);
    return 'approved';
  end if;

  update public.purchase_requests set status = 'pending_approval', submitted_at = now() where id = p_request;
  delete from public.approval_steps where request_id = p_request;
  insert into public.approval_steps (org_id, request_id, approver_id, level, status) values (r.org_id, p_request, v_l1, 1, 'pending');
  if v_l2 is not null then
    insert into public.approval_steps (org_id, request_id, approver_id, level, status) values (r.org_id, p_request, v_l2, 2, 'waiting');
  end if;
  perform public._req_event(r.org_id, p_request, 'submitted', 'Submitted for approval');
  perform public._req_event(r.org_id, p_request, 'routed',
    'Sent to ' || public._display_name(v_l1) || ' for approval' || case when v_l2 is not null then ', then ' || public._display_name(v_l2) else '' end);
  perform public._req_notify(r.org_id, v_l1, 'Approval needed: ' || r.number, r.title, p_request);
  perform public._audit(r.org_id, 'request_submitted', 'purchase_request', p_request, '{}'::jsonb);
  return 'pending_approval';
end $$;

-- ───────────── 3. the functions the app calls ─────────────
create or replace function public.create_request(p_org uuid, p_data jsonb, p_submit boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_title text; v_dept text; v_cat text; v_just text; v_prio text; v_needed date; v_items jsonb; v_it jsonb;
  v_year int; v_n int; v_number text; v_id uuid; v_pos int := 0; v_status text := 'draft';
begin
  perform public._req_guard(p_org);
  if p_data is null or jsonb_typeof(p_data) <> 'object' then raise exception 'invalid_request'; end if;
  v_title := public._req_txt(p_data, 'title', 3, 120, 'invalid_title');
  v_dept  := public._req_txt(p_data, 'department', 2, 60, 'invalid_department');
  v_cat   := public._req_txt(p_data, 'category', 2, 60, 'invalid_category');
  v_just  := public._req_txt(p_data, 'justification', 10, 2000, 'invalid_justification');
  v_prio  := public._req_txt(p_data, 'priority', 3, 10, 'invalid_priority');
  if v_prio not in ('low', 'medium', 'high', 'urgent') then raise exception 'invalid_priority'; end if;
  begin
    if (p_data ->> 'neededBy') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'x'; end if;
    v_needed := (p_data ->> 'neededBy')::date;
  exception when others then raise exception 'invalid_needed_by'; end;
  if v_needed < current_date or v_needed > current_date + 1095 then raise exception 'invalid_needed_by'; end if;

  v_items := p_data -> 'items';
  if v_items is null or jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) = 0 then raise exception 'no_items'; end if;
  if jsonb_array_length(v_items) > 50 then raise exception 'too_many_items'; end if;
  for v_it in select value from jsonb_array_elements(v_items) loop
    if jsonb_typeof(v_it) <> 'object' then raise exception 'invalid_item'; end if;
    perform public._req_txt(v_it, 'description', 2, 200, 'invalid_item_description');
    perform public._req_txt(v_it, 'unit', 1, 20, 'invalid_item_unit');
    perform public._req_num(v_it, 'qty', 10000000, 3, false, 'invalid_item_qty');
    perform public._req_num(v_it, 'unitPrice', 10000000, 2, true, 'invalid_item_price');
  end loop;

  -- one writer at a time per company, so numbers are never handed out twice
  perform pg_advisory_xact_lock(hashtextextended(p_org::text, 12));
  v_year := extract(year from now())::int;
  select coalesce(max(substring(number from '([0-9]+)$')::int), 0) + 1 into v_n
    from public.purchase_requests where org_id = p_org and number like 'PR-' || v_year || '-%';
  v_number := 'PR-' || v_year || '-' || lpad(v_n::text, 4, '0');

  insert into public.purchase_requests (org_id, number, title, requester_id, department, category, status, priority, needed_by, justification)
    values (p_org, v_number, v_title, (select auth.uid()), v_dept, v_cat, 'draft', v_prio, v_needed, v_just)
    returning id into v_id;
  for v_it in select value from jsonb_array_elements(v_items) loop
    insert into public.request_items (org_id, request_id, description, qty, unit, unit_price, position)
      values (p_org, v_id, btrim(v_it ->> 'description'), (btrim(v_it ->> 'qty'))::numeric, btrim(v_it ->> 'unit'),
              (btrim(v_it ->> 'unitPrice'))::numeric, v_pos);
    v_pos := v_pos + 1;
  end loop;
  perform public._req_event(p_org, v_id, 'created', 'Request created');
  perform public._audit(p_org, 'request_created', 'purchase_request', v_id, '{}'::jsonb);
  if coalesce(p_submit, false) then v_status := public._req_route(v_id); end if;
  return jsonb_build_object('id', v_id, 'number', v_number, 'status', v_status);
end $$;

create or replace function public.submit_request(p_request uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.purchase_requests; v_status text;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated'; end if;
  select * into r from public.purchase_requests where id = p_request and public._req_role(org_id) is not null for update;
  if not found then raise exception 'not_found'; end if;
  if r.requester_id <> (select auth.uid()) then raise exception 'not_allowed'; end if;
  if r.status <> 'draft' then raise exception 'not_draft'; end if;
  v_status := public._req_route(p_request);
  return jsonb_build_object('id', p_request, 'status', v_status);
end $$;

create or replace function public.decide_request(p_request uuid, p_decision text, p_comment text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.purchase_requests; s public.approval_steps; v_next public.approval_steps; v_me uuid := (select auth.uid());
  v_comment text := btrim(coalesce(p_comment, '')); v_by text; v_status text;
begin
  if v_me is null then raise exception 'not_authenticated'; end if;
  if p_decision not in ('approved', 'rejected') then raise exception 'invalid_decision'; end if;
  if char_length(v_comment) > 1000 then raise exception 'invalid_comment'; end if;
  if p_decision = 'rejected' and v_comment = '' then raise exception 'comment_required'; end if;
  select * into r from public.purchase_requests where id = p_request and public._req_role(org_id) is not null for update;
  if not found then raise exception 'not_found'; end if;
  if r.requester_id = v_me then raise exception 'not_allowed'; end if;
  if r.status <> 'pending_approval' then raise exception 'not_pending'; end if;
  select * into s from public.approval_steps where request_id = p_request and status = 'pending' order by level limit 1;
  if not found then raise exception 'not_pending'; end if;
  if not public._req_can_decide(p_request, v_me) then raise exception 'not_your_turn'; end if;

  v_by := public._display_name(v_me) || case when s.approver_id <> v_me then ' (for ' || public._display_name(s.approver_id) || ')' else '' end;
  update public.approval_steps set status = p_decision, decided_at = now(), comment = nullif(v_comment, ''), approver_id = v_me where id = s.id;

  if p_decision = 'rejected' then
    update public.purchase_requests set status = 'rejected' where id = p_request;
    perform public._req_event(r.org_id, p_request, 'rejected', 'Rejected by ' || v_by || case when v_comment <> '' then ': ' || v_comment else '' end);
    perform public._req_notify(r.org_id, r.requester_id, r.number || ' was rejected', v_comment, p_request);
    v_status := 'rejected';
  else
    select * into v_next from public.approval_steps where request_id = p_request and status = 'waiting' order by level limit 1;
    if found then
      update public.approval_steps set status = 'pending' where id = v_next.id;
      perform public._req_event(r.org_id, p_request, 'approved', 'Level ' || s.level || ' approved by ' || v_by || '. Waiting for ' || public._display_name(v_next.approver_id));
      perform public._req_notify(r.org_id, v_next.approver_id, 'Approval needed: ' || r.number, r.title, p_request);
      v_status := 'pending_approval';
    else
      update public.purchase_requests set status = 'approved' where id = p_request;
      perform public._req_event(r.org_id, p_request, 'approved', 'Approved by ' || v_by || case when v_comment <> '' then ': ' || v_comment else '' end);
      perform public._req_notify(r.org_id, r.requester_id, r.number || ' was approved', r.title, p_request);
      v_status := 'approved';
    end if;
  end if;
  perform public._audit(r.org_id, 'request_' || p_decision, 'purchase_request', p_request, jsonb_build_object('level', s.level));
  return jsonb_build_object('id', p_request, 'status', v_status);
end $$;

-- The requester can pull a request back to draft while nobody has approved any level yet.
create or replace function public.withdraw_request(p_request uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.purchase_requests;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated'; end if;
  select * into r from public.purchase_requests where id = p_request and public._req_role(org_id) is not null for update;
  if not found then raise exception 'not_found'; end if;
  if r.requester_id <> (select auth.uid()) then raise exception 'not_allowed'; end if;
  if r.status <> 'pending_approval' or exists (select 1 from public.approval_steps where request_id = p_request and status in ('approved', 'rejected'))
  then raise exception 'not_pending'; end if;
  delete from public.approval_steps where request_id = p_request;
  update public.purchase_requests set status = 'draft', submitted_at = null where id = p_request;
  perform public._req_event(r.org_id, p_request, 'withdrawn', 'Withdrawn by the requester');
  perform public._audit(r.org_id, 'request_withdrawn', 'purchase_request', p_request, '{}'::jsonb);
  return jsonb_build_object('id', p_request, 'status', 'draft');
end $$;

create or replace function public.delete_draft_request(p_request uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.purchase_requests;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated'; end if;
  select * into r from public.purchase_requests where id = p_request and public._req_role(org_id) is not null for update;
  if not found then raise exception 'not_found'; end if;
  if r.requester_id <> (select auth.uid()) then raise exception 'not_allowed'; end if;
  if r.status <> 'draft' then raise exception 'not_draft'; end if;
  delete from public.purchase_requests where id = p_request;
  perform public._audit(r.org_id, 'request_deleted', 'purchase_request', p_request, '{}'::jsonb);
  return jsonb_build_object('id', p_request, 'deleted', true);
end $$;

create or replace function public.list_requests(p_org uuid, p_status text default null, p_limit int default 50, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_status text := nullif(nullif(btrim(coalesce(p_status, '')), ''), 'all');
  v_total int; v_counts jsonb; v_items jsonb;
begin
  perform public._req_guard(p_org);
  if v_status is not null and v_status not in ('draft', 'pending_approval', 'approved', 'rejected', 'converted_to_rfq', 'completed') then
    raise exception 'invalid_status';
  end if;
  select coalesce(jsonb_object_agg(x.status, x.n), '{}'::jsonb) into v_counts
    from (select status, count(*) as n from public.purchase_requests where org_id = p_org group by status) x;
  select count(*) into v_total from public.purchase_requests where org_id = p_org and (v_status is null or status = v_status);
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc, x.number desc), '[]'::jsonb) into v_items
    from (
      select r.id, r.number, r.title, r.status, r.priority, r.category, r.department, r.needed_by, r.created_at,
             r.requester_id, public._display_name(r.requester_id) as requester_name,
             public._req_total(r.id) as total,
             (select count(*) from public.request_items i where i.request_id = r.id) as item_count,
             (select public._display_name(s.approver_id) from public.approval_steps s
               where s.request_id = r.id and s.status = 'pending' order by s.level limit 1) as waiting_on
        from public.purchase_requests r
       where r.org_id = p_org and (v_status is null or r.status = v_status)
       order by r.created_at desc, r.number desc
       limit v_limit offset v_offset) x;
  return jsonb_build_object('total', v_total, 'counts', v_counts, 'items', v_items);
end $$;

create or replace function public.get_request(p_request uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.purchase_requests; v_me uuid := (select auth.uid()); v_out jsonb;
begin
  if v_me is null then raise exception 'not_authenticated'; end if;
  select * into r from public.purchase_requests where id = p_request and public._req_role(org_id) is not null;
  if not found then raise exception 'not_found'; end if;
  select jsonb_build_object(
    'request', jsonb_build_object(
      'id', r.id, 'org_id', r.org_id, 'number', r.number, 'title', r.title, 'status', r.status, 'priority', r.priority,
      'category', r.category, 'department', r.department, 'needed_by', r.needed_by, 'created_at', r.created_at,
      'submitted_at', r.submitted_at, 'justification', r.justification, 'requester_id', r.requester_id,
      'requester_name', public._display_name(r.requester_id), 'total', public._req_total(r.id)),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'description', i.description, 'qty', i.qty, 'unit', i.unit,
                'unit_price', i.unit_price) order by i.position, i.id) from public.request_items i where i.request_id = r.id), '[]'::jsonb),
    'approvals', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'level', s.level, 'status', s.status, 'approver_id', s.approver_id,
                'approver_name', public._display_name(s.approver_id), 'decided_at', s.decided_at, 'comment', s.comment) order by s.level)
                from public.approval_steps s where s.request_id = r.id), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'type', e.type, 'text', e.text, 'at', e.at,
                'actor_id', e.actor_id, 'actor_name', case when e.actor_id is null then 'Vendora' else public._display_name(e.actor_id) end) order by e.id)
                from public.request_events e where e.request_id = r.id), '[]'::jsonb),
    'is_requester', r.requester_id = v_me,
    'can_decide', public._req_can_decide(r.id, v_me),
    'can_withdraw', r.requester_id = v_me and r.status = 'pending_approval'
                    and not exists (select 1 from public.approval_steps s where s.request_id = r.id and s.status in ('approved', 'rejected'))
  ) into v_out;
  return v_out;
end $$;

-- The number on the sidebar: requests waiting for THIS person's decision.
create or replace function public.count_my_pending_approvals(p_org uuid)
returns int language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._req_guard(p_org);
  return (select count(*)::int from public.purchase_requests r
           where r.org_id = p_org and r.status = 'pending_approval' and public._req_can_decide(r.id, (select auth.uid())));
end $$;

-- ───────────── 4. who may call what ─────────────
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and (p.proname like '\_req\_%' or p.proname in
              ('create_request', 'submit_request', 'decide_request', 'withdraw_request', 'delete_draft_request',
               'list_requests', 'get_request', 'count_my_pending_approvals'))
  loop execute format('revoke all on function %s from public, anon, authenticated', f.sig); end loop;
end $$;
grant execute on function public.create_request(uuid, jsonb, boolean) to authenticated;
grant execute on function public.submit_request(uuid) to authenticated;
grant execute on function public.decide_request(uuid, text, text) to authenticated;
grant execute on function public.withdraw_request(uuid) to authenticated;
grant execute on function public.delete_draft_request(uuid) to authenticated;
grant execute on function public.list_requests(uuid, text, int, int) to authenticated;
grant execute on function public.get_request(uuid) to authenticated;
grant execute on function public.count_my_pending_approvals(uuid) to authenticated;
-- the _req_* helpers are only called from inside the functions above (security definer), so they need no grant.

notify pgrst, 'reload schema';
