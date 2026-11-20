-- Migration 22 — One-click reorder, with a memory. Run AFTER migrations 1-21. Safe to run twice.
--
-- THE IDEA: most B2B buying is the same thing from the same supplier again. Other marketplaces make you search, compare and quote
-- every time, or give a blind "buy again" button. Vendora reorders from a past delivered order in one step, but it re-checks
-- the world first and it remembers your rhythm:
--   * Before anything is sent, the buyer sees what changed since last time: is the supplier STILL verified, how did the last delivery
--     go (days early or late), what the buyer paid for each line this time and the time before, whether an order for the same things
--     is already on its way (so nobody orders twice by accident), and how many days the buyer has to pay.
--   * The prices are the ones the supplier agreed last time. The supplier sees "this is a reorder of PO-x at the same prices" and
--     confirms in one tap, or declines with a reason if the price has moved. No price is ever invented or edited by the buyer.
--   * Vendora learns the rhythm: if you bought the same things from the same supplier at least twice, it works out your usual gap and
--     tells you when the next order is due ("due in 6 days", "9 days late").
--
-- Safety
--   * Only the owner or a procurement manager can reorder, as for any order. Above Rs 2,00,000 only the OWNER can (the same line the
--     request approvals draw, migration 12): a reorder must not become a way around a second pair of eyes.
--   * Only a delivered order can be reordered, and only while the supplier is still verified TODAY.
--   * Quantities are the buyer's; prices, GST, units and terms are copied from the source on the server. The browser sends only
--     line ids and quantities, so a tampered request cannot change a price.
--   * An order for the same things already open is a duplicate: it is refused unless the buyer says "order again anyway".
--   * At most 30 reorders per company per day (a runaway script cannot spam a supplier). Orders are numbered under the same lock as all
--     others (migration 16). Everything is audited (ids only) and the supplier is told.

-- ───────── 1. storage ─────────
alter table public.purchase_orders add column if not exists reordered_from uuid references public.purchase_orders(id) on delete set null;
create index if not exists purchase_orders_reordered_from_idx on public.purchase_orders (reordered_from) where reordered_from is not null;

-- ───────── 2. rules and helpers (not callable from the browser) ─────────
create or replace function public._reorder_rules()
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('owner_only_above', 200000, 'per_day', 30, 'max_lead_days', 365, 'min_orders_for_rhythm', 2,
                            'max_qty', 99999999, 'max_lines', 100)
$$;

-- What an order is "of": its lines, ignoring case, spacing and order. Two orders to the same supplier with the same signature are the same purchase.
create or replace function public._po_signature(p_po uuid)
returns text language sql stable security definer set search_path = '' as $$
  select md5(coalesce(string_agg(lower(btrim(l.description)) || '|' || lower(btrim(l.unit)), ';'
                                 order by lower(btrim(l.description)), lower(btrim(l.unit))), ''))
    from public.po_lines l where l.po_id = p_po
$$;

-- An order for the same things from the same supplier that has not been delivered yet (null when none).
create or replace function public._reorder_open_twin(p_org uuid, p_supplier uuid, p_sig text)
returns uuid language sql stable security definer set search_path = '' as $$
  select o.id from public.purchase_orders o
   where o.org_id = p_org and o.supplier_org = p_supplier and o.status in ('issued', 'acknowledged', 'partially_received')
     and public._po_signature(o.id) = p_sig
   order by o.created_at desc, o.id limit 1
$$;

-- The buyer's usual gap for this purchase: the middle value of the gaps between its orders (same supplier, same things).
create or replace function public._reorder_rhythm(p_org uuid, p_supplier uuid, p_sig text)
returns jsonb language sql stable security definer set search_path = '' as $$
  with s as (
    select coalesce(o.issued_at, o.created_at)::date as d
      from public.purchase_orders o
     where o.org_id = p_org and o.supplier_org = p_supplier and o.status <> 'cancelled' and public._po_signature(o.id) = p_sig),
  g as (select (d - lag(d) over (order by d))::int as gap from s),
  m as (select count(*)::int as n, max(d) as last_on from s),
  med as (select round(percentile_cont(0.5) within group (order by gap))::int as gap, count(*)::int as k from g where gap >= 1)
  select jsonb_build_object(
    'orders', m.n, 'last_order_on', m.last_on,
    'gap_days', case when m.n >= 2 and med.k >= 1 then med.gap end,
    'next_due', case when m.n >= 2 and med.k >= 1 then m.last_on + med.gap end,
    'days_until', case when m.n >= 2 and med.k >= 1 then (m.last_on + med.gap) - current_date end)
    from m, med
$$;

-- ───────── 3. the check-up before ordering ─────────
create or replace function public.preview_reorder(p_po uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  o public.purchase_orders; b public.businesses; v_role text; v_sig text; v_lvl int; v_twin uuid; tw public.purchase_orders;
  v_blockers jsonb := '[]'::jsonb; v_lines jsonb; v_rules jsonb := public._reorder_rules(); v_days int; v_lead int; v_issued timestamptz;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated'; end if;
  select * into o from public.purchase_orders where id = p_po and supplier_org is not null and public._req_role(org_id) is not null;
  if not found then raise exception 'not_found'; end if;
  v_role := public._req_role(o.org_id);
  select * into b from public.businesses where id = o.supplier_org;
  v_lvl := public._trust_level(o.supplier_org);
  v_sig := public._po_signature(o.id);
  v_issued := coalesce(o.issued_at, o.created_at);
  if v_role not in ('owner', 'procurement_manager') then v_blockers := v_blockers || to_jsonb('role'::text); end if;
  if o.status not in ('received', 'closed') then v_blockers := v_blockers || to_jsonb('not_delivered'::text); end if;
  if v_lvl < 1 then v_blockers := v_blockers || to_jsonb('supplier_not_verified'::text); end if;
  if not exists (select 1 from public.po_lines where po_id = o.id) then v_blockers := v_blockers || to_jsonb('no_lines'::text); end if;

  v_days := case when o.delivered_at is not null and o.expected_at is not null then (o.delivered_at at time zone 'UTC')::date - o.expected_at end;
  v_lead := case when o.expected_at is not null then least(greatest(o.expected_at - v_issued::date, 1), (v_rules ->> 'max_lead_days')::int) else 7 end;
  v_twin := public._reorder_open_twin(o.org_id, o.supplier_org, v_sig);
  select * into tw from public.purchase_orders where id = v_twin;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', l.id, 'description', l.description, 'unit', l.unit, 'qty', l.qty, 'unit_price', l.unit_price, 'gst_rate', l.gst_rate,
      'earlier_price', p.unit_price, 'earlier_on', p.on_day) order by l.id), '[]'::jsonb) into v_lines
    from public.po_lines l
    left join lateral (
      select pl.unit_price, coalesce(p2.issued_at, p2.created_at)::date as on_day
        from public.po_lines pl join public.purchase_orders p2 on p2.id = pl.po_id
       where p2.org_id = o.org_id and p2.supplier_org = o.supplier_org and p2.status <> 'cancelled' and p2.id <> o.id
         and coalesce(p2.issued_at, p2.created_at) < v_issued
         and lower(btrim(pl.description)) = lower(btrim(l.description)) and lower(btrim(pl.unit)) = lower(btrim(l.unit))
       order by coalesce(p2.issued_at, p2.created_at) desc, p2.id limit 1) p on true
   where l.po_id = o.id;

  return jsonb_build_object(
    'source', jsonb_build_object('id', o.id, 'number', o.number, 'title', o.title, 'category', o.category, 'status', o.status,
      'issued_at', o.issued_at, 'expected_at', o.expected_at, 'delivered_at', o.delivered_at, 'days_vs_promise', v_days,
      'lead_days', v_lead, 'payment_terms_days', o.payment_terms_days, 'delivery_address', o.delivery_address,
      'shipping', o.shipping, 'other_charges', o.other_charges, 'currency', (select z.currency from public.businesses z where z.id = o.org_id)),
    'supplier', jsonb_build_object('id', b.id, 'name', b.name, 'city', b.city, 'state', b.state, 'level_now', v_lvl, 'verified_today', v_lvl >= 1),
    'lines', v_lines, 'amounts', public._po_amounts(o.id),
    'rhythm', public._reorder_rhythm(o.org_id, o.supplier_org, v_sig),
    'duplicate', case when v_twin is null then null else jsonb_build_object('id', tw.id, 'number', tw.number, 'status', tw.status, 'issued_at', tw.issued_at) end,
    'blockers', v_blockers, 'can_reorder', jsonb_array_length(v_blockers) = 0, 'role', v_role,
    'limit', jsonb_build_object('owner_only_above', (v_rules ->> 'owner_only_above')::numeric, 'you_may_exceed', v_role = 'owner'));
end $$;

-- ───────── 4. the reorder itself ─────────
-- p_data: { lines: [{ id, qty }] (ids of the source order's lines; qty up to 3 decimals), deliveryAddress (optional, 5-500),
--           notes (optional, up to 1000), allowDuplicate (optional boolean) }
create or replace function public.reorder_purchase_order(p_po uuid, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  o public.purchase_orders; v_role text; v_rules jsonb := public._reorder_rules(); v_addr text; v_notes text := ''; v_allow boolean := false;
  v_ids uuid[] := '{}'; v_qty numeric[] := '{}'; e jsonb; v_id uuid; v_q numeric; v_sig text; v_twin uuid; v_year int; v_n int; v_number text;
  v_po uuid; v_lead int; v_total numeric; v_name text; v_buyer text; v_issued timestamptz;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated'; end if;
  select * into o from public.purchase_orders where id = p_po and supplier_org is not null and public._req_role(org_id) is not null;
  if not found then raise exception 'not_found'; end if;
  v_role := public._req_role(o.org_id);
  if v_role not in ('owner', 'procurement_manager') then raise exception 'not_allowed'; end if;
  if o.status not in ('received', 'closed') then raise exception 'not_delivered'; end if;
  if public._trust_level(o.supplier_org) < 1 then raise exception 'supplier_not_verified'; end if;

  if p_data is null or jsonb_typeof(p_data) <> 'object' then raise exception 'invalid_request'; end if;
  if p_data -> 'lines' is null or jsonb_typeof(p_data -> 'lines') <> 'array' then raise exception 'invalid_lines'; end if;
  if jsonb_array_length(p_data -> 'lines') < 1 or jsonb_array_length(p_data -> 'lines') > (v_rules ->> 'max_lines')::int then raise exception 'invalid_lines'; end if;
  for e in select value from jsonb_array_elements(p_data -> 'lines') loop
    if jsonb_typeof(e) <> 'object' or jsonb_typeof(e -> 'id') is distinct from 'string' then raise exception 'invalid_lines'; end if;
    if jsonb_typeof(e -> 'qty') is distinct from 'number' then raise exception 'invalid_quantity'; end if;
    begin v_id := (e ->> 'id')::uuid; exception when others then raise exception 'invalid_lines'; end;
    v_q := (e ->> 'qty')::numeric;
    if v_q <= 0 or v_q > (v_rules ->> 'max_qty')::numeric or round(v_q, 3) <> v_q then raise exception 'invalid_quantity'; end if;
    if v_id = any (v_ids) then raise exception 'invalid_lines'; end if;
    if not exists (select 1 from public.po_lines l where l.id = v_id and l.po_id = o.id) then raise exception 'invalid_lines'; end if;
    v_ids := v_ids || v_id; v_qty := v_qty || v_q;
  end loop;

  if p_data ? 'deliveryAddress' and jsonb_typeof(p_data -> 'deliveryAddress') <> 'null' then
    if jsonb_typeof(p_data -> 'deliveryAddress') <> 'string' then raise exception 'invalid_address'; end if;
    v_addr := btrim(p_data ->> 'deliveryAddress');
  else
    v_addr := btrim(o.delivery_address);
  end if;
  if char_length(v_addr) < 5 or char_length(v_addr) > 500 then raise exception 'invalid_address'; end if;
  if p_data ? 'notes' and jsonb_typeof(p_data -> 'notes') <> 'null' then
    if jsonb_typeof(p_data -> 'notes') <> 'string' then raise exception 'invalid_notes'; end if;
    v_notes := btrim(p_data ->> 'notes');
    if char_length(v_notes) > 1000 then raise exception 'invalid_notes'; end if;
  end if;
  if p_data ? 'allowDuplicate' and jsonb_typeof(p_data -> 'allowDuplicate') <> 'null' then
    if jsonb_typeof(p_data -> 'allowDuplicate') <> 'boolean' then raise exception 'invalid_request'; end if;
    v_allow := (p_data ->> 'allowDuplicate')::boolean;
  end if;

  -- same lock as awarding (migration 16): numbering, the daily limit and the duplicate check all happen one at a time per company
  perform pg_advisory_xact_lock(hashtextextended(o.org_id::text, 16));
  if (select count(*) from public.purchase_orders x where x.org_id = o.org_id and x.reordered_from is not null
         and x.created_at > now() - interval '24 hours') >= (v_rules ->> 'per_day')::int then raise exception 'daily_limit'; end if;
  v_sig := public._po_signature(o.id);
  v_twin := public._reorder_open_twin(o.org_id, o.supplier_org, v_sig);
  if v_twin is not null and not v_allow then raise exception 'duplicate_open'; end if;

  v_year := extract(year from now())::int;
  select coalesce(max(substring(number from '([0-9]+)$')::int), 0) + 1 into v_n
    from public.purchase_orders where org_id = o.org_id and number like 'PO-' || v_year || '-%';
  v_number := 'PO-' || v_year || '-' || lpad(v_n::text, 4, '0');
  v_issued := coalesce(o.issued_at, o.created_at);
  v_lead := case when o.expected_at is not null then least(greatest(o.expected_at - v_issued::date, 1), (v_rules ->> 'max_lead_days')::int) else 7 end;

  insert into public.purchase_orders (org_id, number, supplier_org, status, issued_at, expected_at, created_by, shipping, other_charges,
                                      payment_terms_days, delivery_address, notes, title, category, reordered_from)
    values (o.org_id, v_number, o.supplier_org, 'issued', now(), current_date + v_lead, (select auth.uid()), o.shipping, o.other_charges,
            o.payment_terms_days, v_addr, v_notes, o.title, o.category, o.id)
    returning id into v_po;
  insert into public.po_lines (org_id, po_id, material_id, description, qty, unit, unit_price, gst_rate)
    select o.org_id, v_po, l.material_id, l.description, u.qty, l.unit, l.unit_price, l.gst_rate
      from public.po_lines l join unnest(v_ids, v_qty) as u(id, qty) on u.id = l.id
     where l.po_id = o.id order by l.id;

  -- a reorder must not become a way around a second pair of eyes
  v_total := (public._po_amounts(v_po) ->> 'total')::numeric;
  if v_total > (v_rules ->> 'owner_only_above')::numeric and v_role <> 'owner' then raise exception 'owner_required'; end if;

  select name into v_name from public.businesses where id = o.supplier_org;
  select name into v_buyer from public.businesses where id = o.org_id;
  perform public._po_notify_supplier(o.supplier_org, 'Reorder from ' || v_buyer, v_number || ' · same prices as ' || o.number || ' · ' || o.title, v_po);
  perform public._audit(o.org_id, 'po_reordered', 'purchase_order', v_po, jsonb_build_object('from', o.id, 'supplier', o.supplier_org, 'duplicate_allowed', v_twin is not null));
  perform public._audit(o.supplier_org, 'po_received', 'purchase_order', v_po, jsonb_build_object('buyer', o.org_id, 'reorder_of', o.id));
  return jsonb_build_object('id', v_po, 'number', v_number, 'status', 'issued', 'total', v_total);
end $$;

-- ───────── 5. what to reorder next (the buyer's memory) ─────────
-- One row per purchase the buyer repeats: the same things from the same supplier. Most due first.
create or replace function public.list_reorder_suggestions(p_org uuid, p_limit int default 12)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_limit int := least(greatest(coalesce(p_limit, 12), 1), 50); v_items jsonb;
begin
  perform public._req_guard(p_org);
  with src as (
    select o.id, o.supplier_org, o.status, o.number, o.title, coalesce(o.issued_at, o.created_at) as at, o.delivered_at, public._po_signature(o.id) as sig
      from public.purchase_orders o where o.org_id = p_org and o.supplier_org is not null and o.status <> 'cancelled'),
  grp as (
    select s.supplier_org, s.sig,
           (array_agg(s.id order by s.delivered_at desc nulls last, s.at desc) filter (where s.status in ('received', 'closed')))[1] as src_id,
           bool_or(s.status in ('issued', 'acknowledged', 'partially_received')) as open_order
      from src s group by s.supplier_org, s.sig
    having bool_or(s.status in ('received', 'closed'))),
  rows_ as (
    select g.*, o.number, o.title, o.delivered_at, b.name as supplier_name, public._trust_level(g.supplier_org) as lvl,
           public._reorder_rhythm(p_org, g.supplier_org, g.sig) as rh, (public._po_amounts(g.src_id) ->> 'total')::numeric as total
      from grp g join public.purchase_orders o on o.id = g.src_id join public.businesses b on b.id = g.supplier_org)
  select coalesce(jsonb_agg(jsonb_build_object(
           'po_id', r.src_id, 'number', r.number, 'title', r.title, 'supplier_id', r.supplier_org, 'supplier_name', r.supplier_name,
           'delivered_at', r.delivered_at, 'total', r.total, 'orders', r.rh -> 'orders', 'gap_days', r.rh -> 'gap_days',
           'next_due', r.rh -> 'next_due', 'days_until', r.rh -> 'days_until', 'open_order', r.open_order, 'verified_today', r.lvl >= 1)
         order by (r.rh ->> 'days_until')::int nulls last, r.delivered_at desc nulls last, r.src_id), '[]'::jsonb) into v_items
    from (select * from rows_ order by (rh ->> 'days_until')::int nulls last, delivered_at desc nulls last, src_id limit v_limit) r;
  return jsonb_build_object('items', v_items, 'can_reorder', public._req_role(p_org) in ('owner', 'procurement_manager'));
end $$;

-- ───────── 6. links between an order and its reorders (buyer side) and the supplier's banner ─────────
create or replace function public.get_reorder_context(p_po uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare o public.purchase_orders; s public.purchase_orders;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated'; end if;
  select * into o from public.purchase_orders where id = p_po and supplier_org is not null and public._req_role(org_id) is not null;
  if not found then raise exception 'not_found'; end if;
  select * into s from public.purchase_orders where id = o.reordered_from and org_id = o.org_id;
  return jsonb_build_object(
    'reordered_from', case when s.id is null then null else jsonb_build_object('id', s.id, 'number', s.number) end,
    'reorders', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'number', r.number, 'status', r.status) order by r.created_at desc, r.id), '[]'::jsonb)
                   from (select * from public.purchase_orders x where x.reordered_from = o.id and x.org_id = o.org_id order by x.created_at desc, x.id limit 5) r));
end $$;

create or replace function public.get_supplier_reorder_info(p_org uuid, p_po uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare o public.purchase_orders; s public.purchase_orders;
begin
  perform public._quote_guard(p_org);
  select * into o from public.purchase_orders where id = p_po and supplier_org = p_org;
  if not found then raise exception 'not_found'; end if;
  select * into s from public.purchase_orders where id = o.reordered_from and supplier_org = p_org;
  return jsonb_build_object(
    'is_reorder', o.reordered_from is not null, 'source_number', s.number, 'source_delivered_at', s.delivered_at,
    'orders_together', (select count(*) from public.purchase_orders x where x.org_id = o.org_id and x.supplier_org = p_org and x.status <> 'cancelled'));
end $$;

-- ───────── 7. who may call what ─────────
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('_reorder_rules', '_po_signature', '_reorder_open_twin', '_reorder_rhythm',
              'preview_reorder', 'reorder_purchase_order', 'list_reorder_suggestions', 'get_reorder_context', 'get_supplier_reorder_info')
  loop execute format('revoke all on function %s from public, anon, authenticated', f.sig); end loop;
end $$;
grant execute on function public.preview_reorder(uuid) to authenticated;
grant execute on function public.reorder_purchase_order(uuid, jsonb) to authenticated;
grant execute on function public.list_reorder_suggestions(uuid, int) to authenticated;
grant execute on function public.get_reorder_context(uuid) to authenticated;
grant execute on function public.get_supplier_reorder_info(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
