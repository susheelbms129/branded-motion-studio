-- Vendora real purchase orders (migration 16). Run AFTER migrations 1-15. Safe to run twice.
--
-- Buyers: on the quote comparison (migration 15) the buyer AWARDS an RFQ to one quote. That creates a real purchase order,
-- issues it to the supplier in the same step and marks the RFQ awarded. Buyers see it under "Purchase orders".
-- Suppliers: an "Orders received" page. The supplier CONFIRMS the order (it becomes "acknowledged") or DECLINES it with a
-- reason. A declined or cancelled order reopens the RFQ so the buyer can choose another quote. Both sides are notified.
--
-- What makes it different
--   * The order is built from the quote the supplier actually sent: same prices, GST, freight, terms, delivery days.
--     Nobody retypes a number, so the order can never disagree with the quote.
--   * Awarding is free for both sides: no fee to receive an order, none to place one.
--   * Only a supplier that is STILL verified today can be awarded, and only on a quote that has not expired.
--
-- Safety
--   * Purchase orders can no longer be WRITTEN from the browser. Every change goes through the functions below.
--   * Only the owner or a procurement manager of the BUYER company can award or cancel; every buyer member can read.
--     Only the owner or a procurement manager of the SUPPLIER company can confirm or decline; its other members can read.
--     Strangers and made-up ids get not_allowed / not_found, so nobody learns whether an order exists.
--   * One RFQ can have only one live order (unique index plus a row lock): two clicks cannot award twice.
--   * Order number PO-<year>-<0001...> per company, handed out under a lock.
--   * Input is checked on the server: address 5-500 characters, notes up to 1000, supplier note / reason up to 500.
--   * Every step is written to the audit log (ids only).

-- ───────────── 1. shape of the tables ─────────────
alter table public.purchase_orders alter column supplier_id drop not null;
alter table public.purchase_orders add column if not exists supplier_org uuid references public.businesses(id) on delete restrict;
alter table public.purchase_orders drop constraint if exists purchase_orders_one_target;
alter table public.purchase_orders add constraint purchase_orders_one_target check ((supplier_id is null) <> (supplier_org is null));
alter table public.purchase_orders add column if not exists title text not null default '';
alter table public.purchase_orders add column if not exists category text not null default '';
alter table public.purchase_orders add column if not exists acknowledged_at timestamptz;
alter table public.purchase_orders add column if not exists supplier_note text not null default '';
alter table public.purchase_orders add column if not exists decline_reason text not null default '';
alter table public.purchase_orders add column if not exists cancelled_by text check (cancelled_by in ('buyer', 'supplier'));
alter table public.purchase_orders add column if not exists cancelled_at timestamptz;
create index if not exists purchase_orders_supplier_org_idx on public.purchase_orders (supplier_org);
create index if not exists purchase_orders_rfq_idx on public.purchase_orders (rfq_id);
create unique index if not exists purchase_orders_one_live_per_rfq on public.purchase_orders (rfq_id)
  where rfq_id is not null and status <> 'cancelled';

alter table public.request_events drop constraint if exists request_events_type_check;
alter table public.request_events add constraint request_events_type_check
  check (type in ('created', 'submitted', 'routed', 'approved', 'rejected', 'withdrawn', 'auto_approved', 'rfq_sent', 'po_issued'));

revoke insert, update, delete on public.purchase_orders, public.po_lines from authenticated;

-- ───────────── 2. small helpers (not callable from the browser) ─────────────
create or replace function public._order_state(p_status text)
returns text language sql immutable set search_path = '' as $$
  select case when p_status = 'issued' then 'new' when p_status = 'cancelled' then 'declined' else 'confirmed' end
$$;

create or replace function public._po_amounts(p_po uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare o public.purchase_orders; v_sub numeric; v_gst numeric;
begin
  select * into o from public.purchase_orders where id = p_po;
  if not found then return null; end if;
  select round(coalesce(sum(l.qty * l.unit_price), 0), 2), round(coalesce(sum(l.qty * l.unit_price * l.gst_rate / 100), 0), 2)
    into v_sub, v_gst from public.po_lines l where l.po_id = p_po;
  return jsonb_build_object('subtotal', v_sub, 'gst', v_gst, 'shipping', o.shipping, 'other_charges', o.other_charges,
    'total', v_sub + v_gst + o.shipping + o.other_charges);
end $$;

create or replace function public._po_lines(p_po uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'description', l.description, 'qty', l.qty, 'unit', l.unit,
           'unit_price', l.unit_price, 'gst_rate', l.gst_rate) order by l.id), '[]'::jsonb)
    from public.po_lines l where l.po_id = p_po
$$;

create or replace function public._po_notify_buyer(p_org uuid, p_creator uuid, p_title text, p_body text, p_po uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare m record;
begin
  for m in select mm.user_id from public.memberships mm
            where mm.org_id = p_org and mm.status = 'active' and (mm.role in ('owner', 'procurement_manager') or mm.user_id = p_creator) loop
    insert into public.notifications (org_id, user_id, kind, title, body, link_to)
      values (p_org, m.user_id, 'po', p_title, p_body, 'purchase-orders/' || p_po::text);
  end loop;
end $$;

create or replace function public._po_notify_supplier(p_org uuid, p_title text, p_body text, p_po uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare m record;
begin
  for m in select mm.user_id from public.memberships mm
            where mm.org_id = p_org and mm.status = 'active' and mm.role in ('owner', 'procurement_manager') loop
    insert into public.notifications (org_id, user_id, kind, title, body, link_to)
      values (p_org, m.user_id, 'po', p_title, p_body, 'orders/' || p_po::text);
  end loop;
end $$;

create or replace function public._po_reopen_rfq(p_rfq uuid, p_quotation uuid)
returns void language sql security definer set search_path = '' as $$
  update public.rfqs set status = 'evaluating', awarded_quotation_id = null
   where id = p_rfq and status = 'awarded' and awarded_quotation_id is not distinct from p_quotation
$$;

-- ───────────── 3. buyer functions ─────────────
-- p_data: { deliveryAddress (5-500 characters), notes (optional, up to 1000) }
create or replace function public.award_rfq(p_rfq uuid, p_quotation uuid, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  f public.rfqs; q public.quotations; v_role text; v_addr text; v_notes text := ''; v_year int; v_n int; v_number text; v_po uuid;
  v_name text; v_buyer text;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated'; end if;
  select * into f from public.rfqs where id = p_rfq for update;
  if not found or public._req_role(f.org_id) is null then raise exception 'not_found'; end if;
  v_role := public._req_role(f.org_id);
  if v_role not in ('owner', 'procurement_manager') then raise exception 'not_allowed'; end if;
  if f.status = 'awarded' then raise exception 'already_awarded'; end if;
  if f.status not in ('sent', 'evaluating') then raise exception 'rfq_closed'; end if;

  select * into q from public.quotations where id = p_quotation and rfq_id = p_rfq and supplier_org is not null;
  if not found then raise exception 'quote_not_found'; end if;
  if q.valid_until is not null and q.valid_until < current_date then raise exception 'quote_expired'; end if;
  if public._trust_level(q.supplier_org) < 1 then raise exception 'supplier_not_verified'; end if;
  if exists (select 1 from public.purchase_orders o where o.quotation_id = q.id and o.status = 'cancelled' and o.cancelled_by = 'supplier')
    then raise exception 'supplier_declined'; end if;

  if p_data is null or jsonb_typeof(p_data) <> 'object' then raise exception 'invalid_request'; end if;
  if p_data -> 'deliveryAddress' is null or jsonb_typeof(p_data -> 'deliveryAddress') <> 'string' then raise exception 'invalid_address'; end if;
  v_addr := btrim(p_data ->> 'deliveryAddress');
  if char_length(v_addr) < 5 or char_length(v_addr) > 500 then raise exception 'invalid_address'; end if;
  if p_data ? 'notes' and jsonb_typeof(p_data -> 'notes') <> 'null' then
    if jsonb_typeof(p_data -> 'notes') <> 'string' then raise exception 'invalid_notes'; end if;
    v_notes := btrim(p_data ->> 'notes');
    if char_length(v_notes) > 1000 then raise exception 'invalid_notes'; end if;
  end if;
  if not exists (select 1 from public.quotation_lines where quotation_id = q.id) then raise exception 'quote_not_found'; end if;

  perform pg_advisory_xact_lock(hashtextextended(f.org_id::text, 16));
  v_year := extract(year from now())::int;
  select coalesce(max(substring(number from '([0-9]+)$')::int), 0) + 1 into v_n
    from public.purchase_orders where org_id = f.org_id and number like 'PO-' || v_year || '-%';
  v_number := 'PO-' || v_year || '-' || lpad(v_n::text, 4, '0');

  insert into public.purchase_orders (org_id, number, supplier_org, rfq_id, quotation_id, request_id, status, issued_at, expected_at,
                                      created_by, shipping, other_charges, payment_terms_days, delivery_address, notes, title, category)
    values (f.org_id, v_number, q.supplier_org, f.id, q.id, f.request_id, 'issued', now(), current_date + q.delivery_days,
            (select auth.uid()), q.shipping, q.other_charges, q.payment_terms_days, v_addr, v_notes, f.title, f.category)
    returning id into v_po;
  insert into public.po_lines (org_id, po_id, description, qty, unit, unit_price, gst_rate)
    select f.org_id, v_po, t.description, l.qty, t.unit, l.unit_price, q.gst_rate
      from public.quotation_lines l join public.rfq_items t on t.id = l.rfq_item_id
     where l.quotation_id = q.id order by t.position, t.id;

  update public.rfqs set status = 'awarded', awarded_quotation_id = q.id where id = f.id;
  select name into v_name from public.businesses where id = q.supplier_org;
  select name into v_buyer from public.businesses where id = f.org_id;
  if f.request_id is not null then
    perform public._req_event(f.org_id, f.request_id, 'po_issued', v_number || ' issued to ' || v_name);
  end if;
  perform public._po_notify_supplier(q.supplier_org, 'New purchase order from ' || v_buyer, v_number || ' · ' || f.title, v_po);
  perform public._audit(f.org_id, 'po_issued', 'purchase_order', v_po, jsonb_build_object('rfq', f.id, 'supplier', q.supplier_org));
  perform public._audit(q.supplier_org, 'po_received', 'purchase_order', v_po, jsonb_build_object('rfq', f.id, 'buyer', f.org_id));
  return jsonb_build_object('id', v_po, 'number', v_number, 'status', 'issued');
end $$;

create or replace function public.list_purchase_orders(p_org uuid, p_status text default null, p_limit int default 50, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_status text := nullif(btrim(coalesce(p_status, '')), '');
  v_total int; v_counts jsonb; v_items jsonb;
begin
  perform public._req_guard(p_org);
  if v_status is not null and v_status not in ('issued', 'acknowledged', 'partially_received', 'received', 'closed', 'cancelled') then
    raise exception 'invalid_status'; end if;
  select coalesce(jsonb_object_agg(x.status, x.n), '{}'::jsonb) into v_counts
    from (select status, count(*) as n from public.purchase_orders where org_id = p_org and supplier_org is not null group by status) x;
  select count(*) into v_total from public.purchase_orders where org_id = p_org and supplier_org is not null and (v_status is null or status = v_status);
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'number', x.number, 'title', x.title, 'status', x.status,
      'supplier_name', x.supplier_name, 'issued_at', x.issued_at, 'expected_at', x.expected_at, 'rfq_id', x.rfq_id,
      'rfq_number', x.rfq_number, 'currency', x.currency, 'total', (public._po_amounts(x.id) ->> 'total')::numeric)
    order by x.created_at desc, x.number desc), '[]'::jsonb) into v_items
    from (select o.id, o.number, o.title, o.status, o.created_at, o.issued_at, o.expected_at, o.rfq_id, b.name as supplier_name,
                 (select f.number from public.rfqs f where f.id = o.rfq_id) as rfq_number,
                 (select z.currency from public.businesses z where z.id = o.org_id) as currency
            from public.purchase_orders o join public.businesses b on b.id = o.supplier_org
           where o.org_id = p_org and (v_status is null or o.status = v_status)
           order by o.created_at desc, o.number desc limit v_limit offset v_offset) x;
  return jsonb_build_object('total', v_total, 'counts', v_counts, 'items', v_items);
end $$;

create or replace function public.get_purchase_order(p_po uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare o public.purchase_orders; v_role text; b public.businesses;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated'; end if;
  select * into o from public.purchase_orders where id = p_po and supplier_org is not null and public._req_role(org_id) is not null;
  if not found then raise exception 'not_found'; end if;
  v_role := public._req_role(o.org_id);
  select * into b from public.businesses where id = o.supplier_org;
  return jsonb_build_object(
    'po', jsonb_build_object('id', o.id, 'number', o.number, 'title', o.title, 'category', o.category, 'status', o.status,
      'created_at', o.created_at, 'issued_at', o.issued_at, 'expected_at', o.expected_at, 'acknowledged_at', o.acknowledged_at,
      'cancelled_at', o.cancelled_at, 'cancelled_by', o.cancelled_by, 'payment_terms_days', o.payment_terms_days,
      'delivery_address', o.delivery_address, 'notes', o.notes, 'supplier_note', o.supplier_note, 'decline_reason', o.decline_reason,
      'rfq_id', o.rfq_id, 'rfq_number', (select f.number from public.rfqs f where f.id = o.rfq_id),
      'created_by_name', public._display_name(o.created_by),
      'currency', (select z.currency from public.businesses z where z.id = o.org_id)),
    'supplier', jsonb_build_object('id', b.id, 'name', b.name, 'city', b.city, 'state', b.state, 'gstin', b.gstin,
      'level_now', public._trust_level(b.id)),
    'lines', public._po_lines(o.id), 'amounts', public._po_amounts(o.id),
    'can_cancel', o.status = 'issued' and v_role in ('owner', 'procurement_manager'));
end $$;

create or replace function public.cancel_purchase_order(p_po uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare o public.purchase_orders; v_reason text := ''; v_buyer text;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated'; end if;
  select * into o from public.purchase_orders where id = p_po and supplier_org is not null for update;
  if not found or public._req_role(o.org_id) is null then raise exception 'not_found'; end if;
  if public._req_role(o.org_id) not in ('owner', 'procurement_manager') then raise exception 'not_allowed'; end if;
  if o.status <> 'issued' then raise exception 'not_pending'; end if;
  if p_reason is not null then
    v_reason := btrim(p_reason);
    if char_length(v_reason) > 500 then raise exception 'invalid_reason'; end if;
  end if;
  update public.purchase_orders set status = 'cancelled', cancelled_by = 'buyer', cancelled_at = now(), decline_reason = v_reason where id = o.id;
  perform public._po_reopen_rfq(o.rfq_id, o.quotation_id);
  select name into v_buyer from public.businesses where id = o.org_id;
  perform public._po_notify_supplier(o.supplier_org, v_buyer || ' cancelled a purchase order',
    o.number || case when v_reason = '' then '' else ' · ' || v_reason end, o.id);
  perform public._audit(o.org_id, 'po_cancelled', 'purchase_order', o.id, jsonb_build_object('by', 'buyer'));
  perform public._audit(o.supplier_org, 'po_cancelled', 'purchase_order', o.id, jsonb_build_object('by', 'buyer'));
  return jsonb_build_object('status', 'cancelled');
end $$;

-- Migration 15's comparison, now also telling the page whether the caller may award and whether an order already exists.
create or replace function public.get_rfq_quotes(p_rfq uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare f public.rfqs; v_cur text; v_quotes jsonb; v_role text; v_po jsonb := null; o public.purchase_orders;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated'; end if;
  select * into f from public.rfqs where id = p_rfq and public._req_role(org_id) is not null;
  if not found then raise exception 'not_found'; end if;
  v_role := public._req_role(f.org_id);
  select b.currency into v_cur from public.businesses b where b.id = f.org_id;

  select coalesce(jsonb_agg(jsonb_build_object(
      'quote_id', q.id, 'supplier_org', q.supplier_org, 'name', b.name, 'city', b.city, 'state', b.state,
      'level_now', public._trust_level(q.supplier_org), 'level_at_send', i.level_at_send,
      'revision', q.revision, 'sent_at', i.sent_at, 'received_at', q.received_at,
      'gst_rate', q.gst_rate, 'shipping', q.shipping, 'other_charges', q.other_charges,
      'delivery_days', q.delivery_days, 'payment_terms_days', q.payment_terms_days,
      'valid_until', q.valid_until, 'notes', q.notes,
      'lines', coalesce((select jsonb_agg(jsonb_build_object('item_id', l.rfq_item_id, 'qty', l.qty, 'unit_price', l.unit_price)
                                          order by l.id)
                           from public.quotation_lines l where l.quotation_id = q.id), '[]'::jsonb),
      'amounts', public._quote_amounts(q.id),
      'declined_order', exists (select 1 from public.purchase_orders d where d.quotation_id = q.id and d.status = 'cancelled' and d.cancelled_by = 'supplier'))
    order by q.received_at, q.id), '[]'::jsonb) into v_quotes
    from public.quotations q
    join public.businesses b on b.id = q.supplier_org
    left join public.rfq_invites i on i.rfq_id = q.rfq_id and i.supplier_org = q.supplier_org
   where q.rfq_id = p_rfq and q.supplier_org is not null;

  select * into o from public.purchase_orders where rfq_id = p_rfq and status <> 'cancelled' and supplier_org is not null limit 1;
  if found then
    v_po := jsonb_build_object('id', o.id, 'number', o.number, 'status', o.status, 'quotation_id', o.quotation_id,
      'supplier_name', (select b.name from public.businesses b where b.id = o.supplier_org));
  end if;

  return jsonb_build_object('currency', coalesce(v_cur, 'INR'), 'rfq_status', f.status, 'due_date', f.due_date,
    'today', current_date, 'quotes', v_quotes, 'po', v_po,
    'can_award', v_role in ('owner', 'procurement_manager') and f.status in ('sent', 'evaluating'));
end $$;

-- ───────────── 4. supplier functions ─────────────
-- p_filter: all | new | confirmed | declined
create or replace function public.list_supplier_orders(p_org uuid, p_filter text default 'all', p_limit int default 50, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_filter text := nullif(nullif(btrim(coalesce(p_filter, '')), ''), 'all');
  v_total int; v_counts jsonb; v_items jsonb;
begin
  perform public._quote_guard(p_org);
  if v_filter is not null and v_filter not in ('new', 'confirmed', 'declined') then raise exception 'invalid_status'; end if;
  select coalesce(jsonb_object_agg(x.s, x.n), '{}'::jsonb) into v_counts
    from (select public._order_state(status) as s, count(*) as n from public.purchase_orders where supplier_org = p_org group by 1) x;
  select count(*) into v_total from public.purchase_orders
   where supplier_org = p_org and (v_filter is null or public._order_state(status) = v_filter);
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'number', x.number, 'title', x.title, 'status', x.status, 'state', x.state,
      'buyer_name', x.buyer_name, 'buyer_city', x.buyer_city, 'buyer_state', x.buyer_state, 'currency', x.currency,
      'issued_at', x.issued_at, 'expected_at', x.expected_at, 'total', (public._po_amounts(x.id) ->> 'total')::numeric)
    order by x.grp, x.issued_at desc, x.id), '[]'::jsonb) into v_items
    from (select o.id, o.number, o.title, o.status, public._order_state(o.status) as state,
                 case when o.status = 'issued' then 0 else 1 end as grp,
                 b.name as buyer_name, b.city as buyer_city, b.state as buyer_state, b.currency as currency, o.issued_at, o.expected_at
            from public.purchase_orders o join public.businesses b on b.id = o.org_id
           where o.supplier_org = p_org and (v_filter is null or public._order_state(o.status) = v_filter)
           order by (case when o.status = 'issued' then 0 else 1 end), o.issued_at desc, o.id
           limit v_limit offset v_offset) x;
  return jsonb_build_object('total', v_total, 'counts', v_counts, 'items', v_items);
end $$;

create or replace function public.count_new_orders(p_org uuid)
returns int language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._quote_guard(p_org);
  return (select count(*)::int from public.purchase_orders where supplier_org = p_org and status = 'issued');
end $$;

create or replace function public.get_supplier_order(p_org uuid, p_po uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_role text; o public.purchase_orders; b public.businesses;
begin
  v_role := public._quote_guard(p_org);
  select * into o from public.purchase_orders where id = p_po and supplier_org = p_org;
  if not found then raise exception 'not_found'; end if;
  select * into b from public.businesses where id = o.org_id;
  return jsonb_build_object(
    'po', jsonb_build_object('id', o.id, 'number', o.number, 'title', o.title, 'category', o.category, 'status', o.status,
      'state', public._order_state(o.status), 'issued_at', o.issued_at, 'expected_at', o.expected_at,
      'acknowledged_at', o.acknowledged_at, 'cancelled_at', o.cancelled_at, 'cancelled_by', o.cancelled_by,
      'payment_terms_days', o.payment_terms_days, 'delivery_address', o.delivery_address, 'notes', o.notes,
      'supplier_note', o.supplier_note, 'decline_reason', o.decline_reason, 'currency', b.currency),
    'buyer', jsonb_build_object('name', b.name, 'city', b.city, 'state', b.state),
    'lines', public._po_lines(o.id), 'amounts', public._po_amounts(o.id),
    'can_respond', o.status = 'issued' and v_role in ('owner', 'procurement_manager'));
end $$;

create or replace function public.confirm_purchase_order(p_org uuid, p_po uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_role text; o public.purchase_orders; v_note text := ''; v_name text;
begin
  v_role := public._quote_guard(p_org);
  if v_role not in ('owner', 'procurement_manager') then raise exception 'not_allowed'; end if;
  select * into o from public.purchase_orders where id = p_po and supplier_org = p_org for update;
  if not found then raise exception 'not_found'; end if;
  if o.status <> 'issued' then raise exception 'not_pending'; end if;
  if p_note is not null then
    v_note := btrim(p_note);
    if char_length(v_note) > 500 then raise exception 'invalid_note'; end if;
  end if;
  update public.purchase_orders set status = 'acknowledged', acknowledged_at = now(), supplier_note = v_note where id = o.id;
  select name into v_name from public.businesses where id = p_org;
  perform public._po_notify_buyer(o.org_id, o.created_by, v_name || ' confirmed your order', o.number || ' · ' || o.title, o.id);
  perform public._audit(p_org, 'po_confirmed', 'purchase_order', o.id, '{}'::jsonb);
  perform public._audit(o.org_id, 'po_confirmed', 'purchase_order', o.id, jsonb_build_object('supplier', p_org));
  return jsonb_build_object('status', 'acknowledged');
end $$;

create or replace function public.decline_purchase_order(p_org uuid, p_po uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_role text; o public.purchase_orders; v_reason text := ''; v_name text;
begin
  v_role := public._quote_guard(p_org);
  if v_role not in ('owner', 'procurement_manager') then raise exception 'not_allowed'; end if;
  select * into o from public.purchase_orders where id = p_po and supplier_org = p_org for update;
  if not found then raise exception 'not_found'; end if;
  if o.status <> 'issued' then raise exception 'not_pending'; end if;
  if p_reason is not null then
    v_reason := btrim(p_reason);
    if char_length(v_reason) > 500 then raise exception 'invalid_reason'; end if;
  end if;
  update public.purchase_orders set status = 'cancelled', cancelled_by = 'supplier', cancelled_at = now(), decline_reason = v_reason where id = o.id;
  perform public._po_reopen_rfq(o.rfq_id, o.quotation_id);
  select name into v_name from public.businesses where id = p_org;
  perform public._po_notify_buyer(o.org_id, o.created_by, v_name || ' declined your order',
    o.number || case when v_reason = '' then '' else ' · ' || v_reason end, o.id);
  perform public._audit(p_org, 'po_declined', 'purchase_order', o.id, '{}'::jsonb);
  perform public._audit(o.org_id, 'po_declined', 'purchase_order', o.id, jsonb_build_object('supplier', p_org));
  return jsonb_build_object('status', 'cancelled');
end $$;

-- ───────────── 5. who may call what ─────────────
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and (p.proname in ('_order_state', '_po_amounts', '_po_lines', '_po_notify_buyer', '_po_notify_supplier',
              '_po_reopen_rfq', 'award_rfq', 'list_purchase_orders', 'get_purchase_order', 'cancel_purchase_order', 'get_rfq_quotes',
              'list_supplier_orders', 'count_new_orders', 'get_supplier_order', 'confirm_purchase_order', 'decline_purchase_order'))
  loop execute format('revoke all on function %s from public, anon, authenticated', f.sig); end loop;
end $$;
grant execute on function public.get_rfq_quotes(uuid) to authenticated;
grant execute on function public.award_rfq(uuid, uuid, jsonb) to authenticated;
grant execute on function public.list_purchase_orders(uuid, text, int, int) to authenticated;
grant execute on function public.get_purchase_order(uuid) to authenticated;
grant execute on function public.cancel_purchase_order(uuid, text) to authenticated;
grant execute on function public.list_supplier_orders(uuid, text, int, int) to authenticated;
grant execute on function public.count_new_orders(uuid) to authenticated;
grant execute on function public.get_supplier_order(uuid, uuid) to authenticated;
grant execute on function public.confirm_purchase_order(uuid, uuid, text) to authenticated;
grant execute on function public.decline_purchase_order(uuid, uuid, text) to authenticated;

notify pgrst, 'reload schema';
