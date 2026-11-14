-- Vendora supplier quote requests (migration 14). Run AFTER migrations 1-13. Safe to run twice.
--
-- What suppliers get: a "Quote requests" inbox. When a buyer sends an RFQ (migration 13) to a verified supplier, the supplier
-- sees it here, opens it, and either sends a quotation (price per item, GST, freight, delivery time, payment terms, validity)
-- or declines with an optional reason. The buyer is notified either way and sees the status on the RFQ.
--
-- What makes it different
--   * Answering is free, always. There are no lead fees and no "buy this lead" step. A supplier is in the inbox because it
--     earned a verified Trust Passport, not because it paid.
--   * Quote in 60 seconds: each RFQ line is matched to the supplier's own product list, and the price, unit and the last
--     used GST / payment / delivery terms come back ready to send. The supplier checks and sends.
--   * Honest to both sides: the supplier sees what is wanted and how many suppliers were invited, never another supplier's
--     name or price. The buyer's estimated prices were never copied into the RFQ (migration 13), so quotes stay honest.
--
-- Safety (no data leaks and no shortcuts are the first rules)
--   * Suppliers cannot read the buyer's RFQ tables (row level security keeps those to the buyer company). They go through
--     the functions below, which show a supplier ONLY the RFQs it was invited to, and only what a supplier needs to quote.
--   * Like requests and RFQs, quotations can no longer be WRITTEN from the browser. Every change goes through a function.
--   * Only the owner or a procurement manager of the SUPPLIER company can quote or decline; other members can read.
--     Buyers, strangers and made-up ids get not_allowed / not_found, so nobody learns whether an RFQ exists.
--   * A quote must price EVERY item of the RFQ (so buyers can compare true landed cost, Task 13), once per supplier.
--     Sending again while the RFQ is open REVISES the quote (the revision number goes up). It is blocked once the RFQ is
--     closed, awarded, or past its deadline.
--   * Input is checked on the server: price per item above 0, GST 0-40%, freight and other charges at least 0,
--     delivery and payment days 0-365 (whole days), validity from today up to 365 days, a note of at most 1000 characters.
--   * Quoting and declining are written to the audit log (ids only) and notify the buyer company.

-- ───────────── 1. shape of the tables ─────────────
alter table public.quotations alter column supplier_id drop not null;
alter table public.quotations add column if not exists supplier_org uuid references public.businesses(id) on delete cascade;
alter table public.quotations add column if not exists revision int not null default 1;
alter table public.quotations drop constraint if exists quotations_one_target;
alter table public.quotations add constraint quotations_one_target check ((supplier_id is null) <> (supplier_org is null));
create unique index if not exists quotations_org_unique on public.quotations (rfq_id, supplier_org) where supplier_org is not null;
create index if not exists quotations_supplier_org_idx on public.quotations (supplier_org);
alter table public.quotation_lines add column if not exists rfq_item_id uuid references public.rfq_items(id) on delete cascade;
create index if not exists quotation_lines_item_idx on public.quotation_lines (rfq_item_id);
alter table public.rfq_invites add column if not exists viewed_at timestamptz;
alter table public.rfq_invites add column if not exists decline_reason text not null default '';

-- The browser may read quotations (RLS keeps them to the buyer company) but never write them directly.
revoke insert, update, delete on public.quotations, public.quotation_lines from authenticated;

-- ───────────── 2. small helpers (not callable from the browser) ─────────────
-- The caller's role in a SUPPLIER company, or null.
create or replace function public._quote_role(p_org uuid)
returns text language sql stable security definer set search_path = '' as $$
  select m.role from public.memberships m join public.businesses b on b.id = m.org_id
   where m.org_id = p_org and m.user_id = (select auth.uid()) and m.status = 'active' and b.kind = 'supplier'
$$;

-- Same, but raises: not_authenticated / not_allowed.
create or replace function public._quote_guard(p_org uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare v_role text;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated'; end if;
  v_role := public._quote_role(p_org);
  if v_role is null then raise exception 'not_allowed'; end if;
  return v_role;
end $$;

-- One place that decides what a supplier sees as the state of an invitation.
create or replace function public._quote_state(p_invite text, p_rfq text, p_due date)
returns text language sql stable set search_path = '' as $$
  select case
    when p_invite = 'quoted' then 'quoted'
    when p_invite = 'declined' then 'declined'
    when p_rfq in ('sent', 'evaluating') and (p_due is null or p_due >= current_date) then 'open'
    else 'closed' end
$$;

-- A decimal number from JSON (a number or a numeric string), or the given error. At most 2 decimals.
create or replace function public._quote_num(p_val jsonb, p_min numeric, p_max numeric, p_err text)
returns numeric language plpgsql immutable set search_path = '' as $$
declare t text; v numeric;
begin
  if p_val is null or jsonb_typeof(p_val) not in ('number', 'string') then raise exception '%', p_err; end if;
  t := btrim(p_val #>> '{}');
  if t !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$' then raise exception '%', p_err; end if;
  v := t::numeric;
  if v < p_min or v > p_max then raise exception '%', p_err; end if;
  return v;
end $$;

-- A quotation's money, worked out the same way the app's landed-cost code does it.
create or replace function public._quote_amounts(p_q uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare q public.quotations; v_sub numeric; v_gst numeric;
begin
  select * into q from public.quotations where id = p_q;
  if not found then return null; end if;
  select round(coalesce(sum(l.qty * l.unit_price), 0), 2) into v_sub from public.quotation_lines l where l.quotation_id = p_q;
  v_gst := round(v_sub * q.gst_rate / 100, 2);
  return jsonb_build_object('subtotal', v_sub, 'gst', v_gst, 'shipping', q.shipping, 'other_charges', q.other_charges,
    'total', v_sub + v_gst + q.shipping + q.other_charges);
end $$;

-- Tell the buyer company's owners and procurement managers (and whoever created the RFQ).
create or replace function public._quote_notify_buyer(p_rfq public.rfqs, p_title text, p_body text)
returns void language plpgsql security definer set search_path = '' as $$
declare m record;
begin
  for m in select mm.user_id from public.memberships mm
            where mm.org_id = p_rfq.org_id and mm.status = 'active'
              and (mm.role in ('owner', 'procurement_manager') or mm.user_id = p_rfq.owner_id) loop
    insert into public.notifications (org_id, user_id, kind, title, body, link_to)
      values (p_rfq.org_id, m.user_id, 'rfq', p_title, p_body, 'rfqs/' || p_rfq.id::text);
  end loop;
end $$;

-- ───────────── 3. the functions the app calls ─────────────
-- The inbox: every RFQ this supplier was invited to. p_filter: all | open | quoted | declined | closed.
create or replace function public.list_quote_requests(p_org uuid, p_filter text default 'all', p_limit int default 50, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_filter text := nullif(nullif(btrim(coalesce(p_filter, '')), ''), 'all');
  v_total int; v_counts jsonb; v_items jsonb;
begin
  perform public._quote_guard(p_org);
  if v_filter is not null and v_filter not in ('open', 'quoted', 'declined', 'closed') then raise exception 'invalid_status'; end if;
  select coalesce(jsonb_object_agg(x.s, x.n), '{}'::jsonb) into v_counts
    from (select public._quote_state(i.status, f.status, f.due_date) as s, count(*) as n
            from public.rfq_invites i join public.rfqs f on f.id = i.rfq_id
           where i.supplier_org = p_org group by 1) x;
  select count(*) into v_total
    from public.rfq_invites i join public.rfqs f on f.id = i.rfq_id
   where i.supplier_org = p_org and (v_filter is null or public._quote_state(i.status, f.status, f.due_date) = v_filter);
  select coalesce(jsonb_agg(jsonb_build_object(
      'rfq_id', x.rfq_id, 'number', x.number, 'title', x.title, 'category', x.category, 'due_date', x.due_date,
      'sent_at', x.sent_at, 'responded_at', x.responded_at, 'state', x.state, 'item_count', x.item_count,
      'invited', x.invited, 'buyer_name', x.buyer_name, 'buyer_city', x.buyer_city, 'buyer_state', x.buyer_state,
      'currency', x.currency, 'my_total', x.my_total)
    order by x.grp, x.due_date nulls last, x.sent_at desc, x.rfq_id), '[]'::jsonb) into v_items
    from (
      select f.id as rfq_id, f.number, f.title, f.category, f.due_date, i.sent_at, i.responded_at,
             public._quote_state(i.status, f.status, f.due_date) as state,
             case when public._quote_state(i.status, f.status, f.due_date) = 'open' then 0 else 1 end as grp,
             (select count(*) from public.rfq_items t where t.rfq_id = f.id) as item_count,
             (select count(*) from public.rfq_invites ii where ii.rfq_id = f.id) as invited,
             b.name as buyer_name, b.city as buyer_city, b.state as buyer_state, b.currency as currency,
             (select (public._quote_amounts(q.id) ->> 'total')::numeric from public.quotations q
               where q.rfq_id = f.id and q.supplier_org = p_org) as my_total
        from public.rfq_invites i
        join public.rfqs f on f.id = i.rfq_id
        join public.businesses b on b.id = f.org_id
       where i.supplier_org = p_org and (v_filter is null or public._quote_state(i.status, f.status, f.due_date) = v_filter)
       order by (case when public._quote_state(i.status, f.status, f.due_date) = 'open' then 0 else 1 end),
                f.due_date nulls last, i.sent_at desc, f.id
       limit v_limit offset v_offset) x;
  return jsonb_build_object('total', v_total, 'counts', v_counts, 'items', v_items);
end $$;

-- One RFQ as the invited supplier sees it. Opening it for the first time marks it "viewed" (the buyer can see that).
create or replace function public.get_quote_request(p_org uuid, p_rfq uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_role text; v_inv public.rfq_invites; f public.rfqs; b public.businesses; v_q public.quotations; v_state text;
  v_items jsonb; v_quote jsonb := null; v_last jsonb := null;
begin
  v_role := public._quote_guard(p_org);
  select * into v_inv from public.rfq_invites where rfq_id = p_rfq and supplier_org = p_org;
  if not found then raise exception 'not_found'; end if;
  select * into f from public.rfqs where id = p_rfq;
  select * into b from public.businesses where id = f.org_id;
  if v_inv.status = 'sent' then
    update public.rfq_invites set status = 'viewed', viewed_at = now() where id = v_inv.id and status = 'sent';
    v_inv.status := 'viewed'; v_inv.viewed_at := now();
  end if;
  v_state := public._quote_state(v_inv.status, f.status, f.due_date);

  -- each wanted line, with the supplier's own matching product (same currency as the buyer) when there is one
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'description', t.description, 'qty', t.qty, 'unit', t.unit,
      'suggestion', (select jsonb_build_object('product_id', sp.id, 'name', sp.name, 'price', sp.price, 'unit', sp.unit,
                            'moq', sp.moq, 'availability', sp.availability)
                       from public.supplier_products sp
                      where sp.org_id = p_org and sp.price is not null and sp.currency = b.currency
                        and char_length(btrim(sp.name)) >= 2 and char_length(btrim(t.description)) >= 2
                        and (lower(btrim(sp.name)) = lower(btrim(t.description))
                             or position(lower(btrim(sp.name)) in lower(t.description)) > 0
                             or position(lower(btrim(t.description)) in lower(sp.name)) > 0)
                      order by (lower(btrim(sp.name)) = lower(btrim(t.description))) desc, char_length(sp.name) desc, sp.id
                      limit 1)
    ) order by t.position, t.id), '[]'::jsonb) into v_items
    from public.rfq_items t where t.rfq_id = p_rfq;

  select * into v_q from public.quotations where rfq_id = p_rfq and supplier_org = p_org;
  if found then
    v_quote := jsonb_build_object('id', v_q.id, 'revision', v_q.revision, 'received_at', v_q.received_at, 'gst_rate', v_q.gst_rate,
      'shipping', v_q.shipping, 'other_charges', v_q.other_charges, 'delivery_days', v_q.delivery_days,
      'payment_terms_days', v_q.payment_terms_days, 'valid_until', v_q.valid_until, 'notes', v_q.notes,
      'amounts', public._quote_amounts(v_q.id),
      'lines', coalesce((select jsonb_agg(jsonb_build_object('item_id', l.rfq_item_id, 'unit_price', l.unit_price))
                           from public.quotation_lines l where l.quotation_id = v_q.id), '[]'::jsonb));
  end if;
  -- the terms this supplier used last time, so the next quote starts from them
  select jsonb_build_object('gst_rate', q.gst_rate, 'payment_terms_days', q.payment_terms_days, 'delivery_days', q.delivery_days)
    into v_last from public.quotations q where q.supplier_org = p_org order by q.received_at desc limit 1;

  return jsonb_build_object(
    'rfq', jsonb_build_object('id', f.id, 'number', f.number, 'title', f.title, 'category', f.category, 'due_date', f.due_date,
      'notes', f.notes, 'currency', b.currency,
      'open', f.status in ('sent', 'evaluating') and (f.due_date is null or f.due_date >= current_date), 'invited', (select count(*) from public.rfq_invites ii where ii.rfq_id = f.id)),
    'buyer', jsonb_build_object('name', b.name, 'city', b.city, 'state', b.state),
    'invite', jsonb_build_object('status', v_inv.status, 'state', v_state, 'sent_at', v_inv.sent_at, 'viewed_at', v_inv.viewed_at,
      'responded_at', v_inv.responded_at, 'decline_reason', v_inv.decline_reason, 'level_at_send', v_inv.level_at_send),
    'items', v_items, 'quote', v_quote, 'last_terms', v_last,
    'can_respond', v_role in ('owner', 'procurement_manager'));
end $$;

-- Send (or revise) a quotation. p_data: { lines: [{itemId, unitPrice}], gstRate, shipping, otherCharges, deliveryDays,
--   paymentTermsDays, validUntil (yyyy-mm-dd), notes }
create or replace function public.submit_quotation(p_org uuid, p_rfq uuid, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_role text; f public.rfqs; v_inv public.rfq_invites; v_q uuid; v_rev int := 1; v_new boolean := true;
  v_gst numeric; v_ship numeric; v_other numeric; v_t numeric; v_days int; v_pay int; v_valid date; v_notes text := '';
  v_lines jsonb; v_el jsonb; v_text text; v_item uuid; v_seen uuid[] := '{}'; v_price numeric; v_qty numeric; v_count int;
  v_amounts jsonb; v_name text;
begin
  v_role := public._quote_guard(p_org);
  if v_role not in ('owner', 'procurement_manager') then raise exception 'not_allowed'; end if;
  -- the invitation row is locked from here, so a double click cannot send two quotes
  select * into v_inv from public.rfq_invites where rfq_id = p_rfq and supplier_org = p_org for update;
  if not found then raise exception 'not_found'; end if;
  select * into f from public.rfqs where id = p_rfq for update;
  if f.status not in ('sent', 'evaluating') or (f.due_date is not null and f.due_date < current_date) then
    raise exception 'rfq_closed'; end if;

  if p_data is null or jsonb_typeof(p_data) <> 'object' then raise exception 'invalid_request'; end if;
  v_gst := public._quote_num(p_data -> 'gstRate', 0, 40, 'invalid_gst');
  v_ship := public._quote_num(coalesce(p_data -> 'shipping', '0'::jsonb), 0, 1000000000, 'invalid_shipping');
  v_other := public._quote_num(coalesce(p_data -> 'otherCharges', '0'::jsonb), 0, 1000000000, 'invalid_other_charges');
  v_t := public._quote_num(p_data -> 'deliveryDays', 0, 365, 'invalid_delivery_days');
  if v_t <> trunc(v_t) then raise exception 'invalid_delivery_days'; end if;
  v_days := v_t::int;
  v_t := public._quote_num(p_data -> 'paymentTermsDays', 0, 365, 'invalid_payment_terms');
  if v_t <> trunc(v_t) then raise exception 'invalid_payment_terms'; end if;
  v_pay := v_t::int;
  -- validity: from today up to 365 days
  begin
    if p_data -> 'validUntil' is null or jsonb_typeof(p_data -> 'validUntil') <> 'string' or (p_data ->> 'validUntil') !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'x'; end if;
    v_valid := (p_data ->> 'validUntil')::date;
  exception when others then raise exception 'invalid_valid_until'; end;
  if v_valid < current_date or v_valid > current_date + 365 then raise exception 'invalid_valid_until'; end if;
  if p_data ? 'notes' and jsonb_typeof(p_data -> 'notes') <> 'null' then
    if jsonb_typeof(p_data -> 'notes') <> 'string' then raise exception 'invalid_notes'; end if;
    v_notes := btrim(p_data ->> 'notes');
    if char_length(v_notes) > 1000 then raise exception 'invalid_notes'; end if;
  end if;

  -- every item of the RFQ must be priced exactly once
  select count(*) into v_count from public.rfq_items where rfq_id = p_rfq;
  v_lines := p_data -> 'lines';
  if v_count = 0 or v_lines is null or jsonb_typeof(v_lines) <> 'array' or jsonb_array_length(v_lines) <> v_count then
    raise exception 'incomplete_quote'; end if;
  for v_el in select value from jsonb_array_elements(v_lines) loop
    if jsonb_typeof(v_el) <> 'object' or coalesce(jsonb_typeof(v_el -> 'itemId'), '') <> 'string' then raise exception 'incomplete_quote'; end if;
    v_text := lower(btrim(v_el ->> 'itemId'));
    if v_text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'incomplete_quote'; end if;
    v_item := v_text::uuid;
    if v_item = any (v_seen) or not exists (select 1 from public.rfq_items where id = v_item and rfq_id = p_rfq) then
      raise exception 'incomplete_quote'; end if;
    v_seen := v_seen || v_item;
    perform public._quote_num(v_el -> 'unitPrice', 0.01, 10000000, 'invalid_price');
  end loop;

  select id, revision + 1 into v_q, v_rev from public.quotations where rfq_id = p_rfq and supplier_org = p_org;
  if found then
    v_new := false;
    update public.quotations set gst_rate = v_gst, shipping = v_ship, other_charges = v_other, delivery_days = v_days,
           payment_terms_days = v_pay, valid_until = v_valid, notes = v_notes, revision = v_rev, received_at = now()
     where id = v_q;
    delete from public.quotation_lines where quotation_id = v_q;
  else
    v_rev := 1;
    insert into public.quotations (org_id, rfq_id, supplier_org, gst_rate, shipping, other_charges, delivery_days,
                                   payment_terms_days, valid_until, notes, revision)
      values (f.org_id, p_rfq, p_org, v_gst, v_ship, v_other, v_days, v_pay, v_valid, v_notes, 1)
      returning id into v_q;
  end if;
  for v_el in select value from jsonb_array_elements(v_lines) loop
    v_item := lower(btrim(v_el ->> 'itemId'))::uuid;
    v_price := public._quote_num(v_el -> 'unitPrice', 0.01, 10000000, 'invalid_price');
    select qty into v_qty from public.rfq_items where id = v_item;
    insert into public.quotation_lines (org_id, quotation_id, rfq_item_id, qty, unit_price)
      values (f.org_id, v_q, v_item, v_qty, v_price);
  end loop;

  update public.rfq_invites set status = 'quoted', responded_at = now(), decline_reason = '' where id = v_inv.id;
  if f.status = 'sent' then update public.rfqs set status = 'evaluating' where id = p_rfq; end if;
  v_amounts := public._quote_amounts(v_q);
  select name into v_name from public.businesses where id = p_org;
  perform public._quote_notify_buyer(f, v_name || case when v_new then ' sent a quote' else ' updated their quote' end,
    f.number || ' · ' || f.title);
  perform public._audit(p_org, 'quote_submitted', 'quotation', v_q, jsonb_build_object('rfq', p_rfq, 'revision', v_rev));
  perform public._audit(f.org_id, 'quote_received', 'quotation', v_q, jsonb_build_object('rfq', p_rfq, 'supplier', p_org, 'revision', v_rev));
  return jsonb_build_object('id', v_q, 'revision', v_rev, 'amounts', v_amounts);
end $$;

-- Decline an RFQ, with an optional reason (at most 500 characters).
create or replace function public.decline_quote_request(p_org uuid, p_rfq uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_role text; f public.rfqs; v_inv public.rfq_invites; v_reason text := ''; v_name text;
begin
  v_role := public._quote_guard(p_org);
  if v_role not in ('owner', 'procurement_manager') then raise exception 'not_allowed'; end if;
  select * into v_inv from public.rfq_invites where rfq_id = p_rfq and supplier_org = p_org for update;
  if not found then raise exception 'not_found'; end if;
  select * into f from public.rfqs where id = p_rfq;
  if f.status not in ('sent', 'evaluating') or (f.due_date is not null and f.due_date < current_date) then
    raise exception 'rfq_closed'; end if;
  if v_inv.status = 'quoted' then raise exception 'already_quoted'; end if;
  if p_reason is not null then
    v_reason := btrim(p_reason);
    if char_length(v_reason) > 500 then raise exception 'invalid_reason'; end if;
  end if;
  update public.rfq_invites set status = 'declined', responded_at = now(), decline_reason = v_reason where id = v_inv.id;
  select name into v_name from public.businesses where id = p_org;
  perform public._quote_notify_buyer(f, v_name || ' declined to quote',
    case when v_reason = '' then f.number || ' · ' || f.title else v_reason end);
  perform public._audit(p_org, 'quote_declined', 'rfq', p_rfq, '{}'::jsonb);
  perform public._audit(f.org_id, 'quote_declined', 'rfq', p_rfq, jsonb_build_object('supplier', p_org));
  return jsonb_build_object('status', 'declined');
end $$;

-- ───────────── 4. who may call what ─────────────
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and (p.proname like '\_quote\_%' or p.proname in
              ('list_quote_requests', 'get_quote_request', 'submit_quotation', 'decline_quote_request'))
  loop execute format('revoke all on function %s from public, anon, authenticated', f.sig); end loop;
end $$;
grant execute on function public.list_quote_requests(uuid, text, int, int) to authenticated;
grant execute on function public.get_quote_request(uuid, uuid) to authenticated;
grant execute on function public.submit_quotation(uuid, uuid, jsonb) to authenticated;
grant execute on function public.decline_quote_request(uuid, uuid, text) to authenticated;

notify pgrst, 'reload schema';
