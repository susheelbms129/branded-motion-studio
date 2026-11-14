-- Vendora real RFQs (migration 13). Run AFTER migrations 1-12. Safe to run twice.
--
-- What buyers get: an approved purchase request can be sent, as one RFQ, to chosen VERIFIED suppliers. The RFQ is saved,
-- each supplier gets an invitation (and a notification), and the request moves on to "converted to RFQ".
--
-- Who is invited
--   * Until now an RFQ invitation pointed at the buyer's private "suppliers" list. Real RFQs point at real supplier
--     COMPANIES (rfq_invites.supplier_org), the same companies the directory and saved shortlist show.
--   * A supplier can be invited only when its Trust Passport currently counts (level 1 or higher: a registration proof that
--     has been verified and has not expired). The check runs inside send_rfq() at the moment of sending, so a stale page
--     in the browser can never invite an unverified or expired supplier. The level at that moment is stored on the
--     invitation, as evidence of who was verified when the RFQ went out.
--
-- Safety (no data leaks and no shortcuts are the first rules)
--   * Like requests in migration 12, the RFQ tables can no longer be WRITTEN from the browser. Before this, an owner could
--     edit an RFQ directly (change its status, invite anyone, even set a winner). Every change now goes through functions.
--   * Only the owner or a procurement manager of the BUYER company can send an RFQ (the same people the app lets convert a
--     request). Everyone else in the company can read RFQs. Suppliers, strangers and made-up ids get the same answers as
--     in migration 12 (not_allowed / not_found), so nobody learns whether a request or an RFQ exists.
--   * Only an APPROVED request can be sent, and only once. The request row is locked while sending, so two people clicking
--     at the same moment cannot send two RFQs for one request.
--   * The buyer's ESTIMATED prices are never copied into the RFQ. Suppliers see what is wanted (item, quantity, unit), not
--     what the buyer expects to pay, so quotes stay honest.
--   * Input is checked on the server: 1 to 20 distinct suppliers, a due date between tomorrow and 180 days away, a note of at
--     most 1000 characters.
--   * RFQ numbers are RFQ-<year>-<0001...> per company, handed out under a lock.
--   * Sending is written to the audit log (ids only) and to the request's timeline.
--   (Quotations are still written directly by the older rules; Tasks 12 and 13 move supplier quotes behind functions.)

-- ───────────── 1. shape of the tables ─────────────
alter table public.rfq_invites alter column supplier_id drop not null;
alter table public.rfq_invites add column if not exists supplier_org uuid references public.businesses(id) on delete cascade;
alter table public.rfq_invites add column if not exists level_at_send int;
alter table public.rfq_invites drop constraint if exists rfq_invites_one_target;
alter table public.rfq_invites add constraint rfq_invites_one_target check ((supplier_id is null) <> (supplier_org is null));
create unique index if not exists rfq_invites_org_unique on public.rfq_invites (rfq_id, supplier_org) where supplier_org is not null;
create index if not exists rfq_invites_supplier_org_idx on public.rfq_invites (supplier_org);
alter table public.rfqs add column if not exists category text not null default '';
alter table public.rfq_items add column if not exists position int not null default 0;
create index if not exists rfqs_request_idx on public.rfqs (request_id);

-- the request timeline learns one more kind of event
alter table public.request_events drop constraint if exists request_events_type_check;
alter table public.request_events add constraint request_events_type_check
  check (type in ('created', 'submitted', 'routed', 'approved', 'rejected', 'withdrawn', 'auto_approved', 'rfq_sent'));

-- The browser may read RFQs (RLS keeps it to the company) but never write them directly.
revoke insert, update, delete on public.rfqs, public.rfq_items, public.rfq_invites from authenticated;

-- ───────────── 2. the functions the app calls ─────────────
create or replace function public.send_rfq(p_request uuid, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.purchase_requests; v_role text; v_ids jsonb; v_el jsonb; v_text text; v_due date; v_notes text := '';
  v_sup uuid[] := '{}'; v_one uuid; v_level int; v_levels int[] := '{}'; v_i int;
  v_year int; v_n int; v_number text; v_rfq uuid; v_buyer text; m record;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated'; end if;
  -- the request row is locked from here, so two people cannot send the same request at once
  select * into r from public.purchase_requests where id = p_request and public._req_role(org_id) is not null for update;
  if not found then raise exception 'not_found'; end if;
  v_role := public._req_role(r.org_id);
  if v_role not in ('owner', 'procurement_manager') then raise exception 'not_allowed'; end if;
  if r.status = 'converted_to_rfq' then raise exception 'already_sent'; end if;
  if r.status <> 'approved' then raise exception 'not_approved'; end if;

  if p_data is null or jsonb_typeof(p_data) <> 'object' then raise exception 'invalid_request'; end if;
  -- due date: between tomorrow and 180 days away
  begin
    if p_data -> 'dueDate' is null or jsonb_typeof(p_data -> 'dueDate') <> 'string' or (p_data ->> 'dueDate') !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'x'; end if;
    v_due := (p_data ->> 'dueDate')::date;
  exception when others then raise exception 'invalid_due_date'; end;
  if v_due <= current_date or v_due > current_date + 180 then raise exception 'invalid_due_date'; end if;
  -- note (optional)
  if p_data ? 'notes' and jsonb_typeof(p_data -> 'notes') <> 'null' then
    if jsonb_typeof(p_data -> 'notes') <> 'string' then raise exception 'invalid_notes'; end if;
    v_notes := btrim(p_data ->> 'notes');
    if char_length(v_notes) > 1000 then raise exception 'invalid_notes'; end if;
  end if;
  -- suppliers: 1 to 20, real ids, no duplicates
  v_ids := p_data -> 'supplierIds';
  if v_ids is null or jsonb_typeof(v_ids) <> 'array' or jsonb_array_length(v_ids) = 0 then raise exception 'no_suppliers'; end if;
  if jsonb_array_length(v_ids) > 20 then raise exception 'too_many_suppliers'; end if;
  for v_el in select value from jsonb_array_elements(v_ids) loop
    if jsonb_typeof(v_el) <> 'string' then raise exception 'invalid_suppliers'; end if;
    v_text := lower(btrim(v_el #>> '{}'));
    if v_text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'invalid_suppliers'; end if;
    v_one := v_text::uuid;
    if v_one = any (v_sup) then raise exception 'duplicate_suppliers'; end if;
    v_sup := v_sup || v_one;
  end loop;
  -- every supplier must be a real, onboarded supplier company whose Trust Passport counts RIGHT NOW
  foreach v_one in array v_sup loop
    if not exists (select 1 from public.businesses b join public.supplier_profiles p on p.org_id = b.id
                    where b.id = v_one and b.kind = 'supplier') then raise exception 'supplier_not_found'; end if;
    v_level := public._trust_level(v_one);
    if v_level < 1 then raise exception 'supplier_not_verified'; end if;
    v_levels := v_levels || v_level;
  end loop;
  if not exists (select 1 from public.request_items where request_id = p_request) then raise exception 'no_items'; end if;

  -- one writer at a time per company, so RFQ numbers are never handed out twice
  perform pg_advisory_xact_lock(hashtextextended(r.org_id::text, 13));
  v_year := extract(year from now())::int;
  select coalesce(max(substring(number from '([0-9]+)$')::int), 0) + 1 into v_n
    from public.rfqs where org_id = r.org_id and number like 'RFQ-' || v_year || '-%';
  v_number := 'RFQ-' || v_year || '-' || lpad(v_n::text, 4, '0');

  insert into public.rfqs (org_id, number, title, request_id, category, status, due_date, owner_id, notes)
    values (r.org_id, v_number, r.title, p_request, r.category, 'sent', v_due, (select auth.uid()), v_notes)
    returning id into v_rfq;
  -- what is wanted (never what the buyer expects to pay: unit_price is deliberately not copied)
  insert into public.rfq_items (org_id, rfq_id, description, qty, unit, position)
    select r.org_id, v_rfq, i.description, i.qty, i.unit, i.position
      from public.request_items i where i.request_id = p_request order by i.position, i.id;
  for v_i in 1 .. array_length(v_sup, 1) loop
    insert into public.rfq_invites (org_id, rfq_id, supplier_org, level_at_send, status)
      values (r.org_id, v_rfq, v_sup[v_i], v_levels[v_i], 'sent');
  end loop;

  update public.purchase_requests set status = 'converted_to_rfq' where id = p_request;
  perform public._req_event(r.org_id, p_request, 'rfq_sent', v_number || ' sent to ' || array_length(v_sup, 1) || ' verified supplier' ||
    case when array_length(v_sup, 1) = 1 then '' else 's' end);
  perform public._audit(r.org_id, 'rfq_sent', 'rfq', v_rfq, jsonb_build_object('request', p_request, 'suppliers', array_length(v_sup, 1)));

  -- tell every active member of each invited supplier company
  select name into v_buyer from public.businesses where id = r.org_id;
  for m in select mm.org_id, mm.user_id from public.memberships mm
            where mm.org_id = any (v_sup) and mm.status = 'active' loop
    insert into public.notifications (org_id, user_id, kind, title, body, link_to)
      values (m.org_id, m.user_id, 'rfq', 'New quote request from ' || v_buyer, r.title, 'quote-requests/' || v_rfq::text);
  end loop;
  return jsonb_build_object('id', v_rfq, 'number', v_number, 'status', 'sent', 'invited', array_length(v_sup, 1));
end $$;

create or replace function public.list_rfqs(p_org uuid, p_status text default null, p_limit int default 50, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_status text := nullif(nullif(btrim(coalesce(p_status, '')), ''), 'all');
  v_total int; v_counts jsonb; v_items jsonb;
begin
  perform public._req_guard(p_org);
  if v_status is not null and v_status not in ('draft', 'sent', 'evaluating', 'awarded', 'closed') then raise exception 'invalid_status'; end if;
  select coalesce(jsonb_object_agg(x.status, x.n), '{}'::jsonb) into v_counts
    from (select status, count(*) as n from public.rfqs where org_id = p_org group by status) x;
  select count(*) into v_total from public.rfqs where org_id = p_org and (v_status is null or status = v_status);
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc, x.number desc), '[]'::jsonb) into v_items
    from (
      select f.id, f.number, f.title, f.status, f.category, f.due_date, f.created_at, f.request_id,
             (select pr.number from public.purchase_requests pr where pr.id = f.request_id) as request_number,
             public._display_name(f.owner_id) as owner_name,
             (select count(*) from public.rfq_invites i where i.rfq_id = f.id) as invited,
             (select count(*) from public.rfq_invites i where i.rfq_id = f.id and i.status = 'quoted') as quoted,
             (select count(*) from public.rfq_items t where t.rfq_id = f.id) as item_count
        from public.rfqs f
       where f.org_id = p_org and (v_status is null or f.status = v_status)
       order by f.created_at desc, f.number desc
       limit v_limit offset v_offset) x;
  return jsonb_build_object('total', v_total, 'counts', v_counts, 'items', v_items);
end $$;

create or replace function public.get_rfq(p_rfq uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare f public.rfqs; v_role text;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated'; end if;
  select * into f from public.rfqs where id = p_rfq and public._req_role(org_id) is not null;
  if not found then raise exception 'not_found'; end if;
  v_role := public._req_role(f.org_id);
  return jsonb_build_object(
    'rfq', jsonb_build_object('id', f.id, 'org_id', f.org_id, 'number', f.number, 'title', f.title, 'status', f.status,
      'category', f.category, 'due_date', f.due_date, 'created_at', f.created_at, 'notes', f.notes,
      'request_id', f.request_id, 'request_number', (select pr.number from public.purchase_requests pr where pr.id = f.request_id),
      'owner_name', public._display_name(f.owner_id)),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'description', t.description, 'qty', t.qty, 'unit', t.unit)
                       order by t.position, t.id) from public.rfq_items t where t.rfq_id = f.id), '[]'::jsonb),
    'invites', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'supplier_org', i.supplier_org, 'name', b.name,
                         'city', b.city, 'state', b.state, 'status', i.status, 'sent_at', i.sent_at, 'responded_at', i.responded_at,
                         'level_at_send', i.level_at_send, 'level_now', public._trust_level(i.supplier_org))
                       order by i.sent_at, b.name, i.id)
                       from public.rfq_invites i join public.businesses b on b.id = i.supplier_org
                      where i.rfq_id = f.id and i.supplier_org is not null), '[]'::jsonb));
end $$;

-- For the request page: has this request already become an RFQ, and may the caller send it?
create or replace function public.get_request_rfq(p_request uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.purchase_requests; v_role text; v_rfq public.rfqs;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated'; end if;
  select * into r from public.purchase_requests where id = p_request and public._req_role(org_id) is not null;
  if not found then raise exception 'not_found'; end if;
  v_role := public._req_role(r.org_id);
  select * into v_rfq from public.rfqs where request_id = p_request order by created_at desc limit 1;
  return jsonb_build_object('rfq_id', v_rfq.id, 'rfq_number', v_rfq.number,
    'can_send', r.status = 'approved' and v_role in ('owner', 'procurement_manager'));
end $$;

-- ───────────── 3. who may call what ─────────────
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('send_rfq', 'list_rfqs', 'get_rfq', 'get_request_rfq')
  loop execute format('revoke all on function %s from public, anon, authenticated', f.sig); end loop;
end $$;
grant execute on function public.send_rfq(uuid, jsonb) to authenticated;
grant execute on function public.list_rfqs(uuid, text, int, int) to authenticated;
grant execute on function public.get_rfq(uuid) to authenticated;
grant execute on function public.get_request_rfq(uuid) to authenticated;

notify pgrst, 'reload schema';
