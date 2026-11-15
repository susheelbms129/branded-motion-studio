-- Vendora Quote in 60 seconds (migration 19). Run AFTER migrations 1-18. Safe to run twice.
--
-- THE IDEA: a supplier should be able to answer an RFQ in about a minute. Typing every price and every term again for every
-- buyer is the reason small suppliers answer late or not at all, and late answers cost them Fair Rank speed points (migration
-- 18). So Vendora remembers, and does the typing:
--   1. PRICE MEMORY   every RFQ line is matched against the supplier's OWN product list and against the prices they quoted
--                     before. The best match is filled in, with where it came from ("from your product list", "from your
--                     quote 12 days ago"). Every quote they send teaches Vendora their prices, so next time it is faster.
--   2. USUAL TERMS    a supplier saves their usual GST, delivery time, payment terms, freight, validity and note once.
--   3. ONE TAP        when every line has a clean price, the request is flagged "ready in one tap" in the inbox, and the supplier
--                     reviews and sends it.
--
-- A WRONG PRICE IS WORSE THAN NO PRICE, so matching is strict and honest about how sure it is:
--   * Sizes and numbers must agree. "MS plate 10 mm" never matches "MS plate 12 mm", and "Bolt" never auto-fills "Bolt M8".
--   * Confidence is "exact", "strong" or "possible". Only exact and strong are filled in; possible is offered as a one-tap
--     suggestion the supplier chooses.
--   * Nothing is filled in when the unit differs (a price per Kg is not a price per Sheet), when the product is marked
--     temporarily unavailable, or when the price is from an earlier quote more than 90 days old (180 days is the limit).
--   * "Clean" (eligible for one tap) also needs the buyer's quantity to meet the product's minimum order.
--   * The supplier always sees and sends the quote itself. Nothing is ever sent for them.
--
-- Safety
--   * Suggestions use ONLY the calling supplier's own products and own earlier quotes. A supplier can never get another
--     supplier's price: every lookup is keyed by the caller's company, which is checked first (_quote_guard).
--   * Only prices in the buyer's currency are used, so a rupee price is never offered for a dollar RFQ.
--   * The saved terms table cannot be read or written from the browser. Only the owner or a procurement manager can save
--     terms (through save_quote_defaults); any active member of the supplier company sees them when quoting.
--   * Saving terms is written to the audit log (ids only).
--   * submit_quotation still checks every price and term when the quote is sent. It has ONE change: revising a quote keeps the
--     original reply time. Before, a late revision reset it, so fixing a typo days later made a supplier look slow in Fair Rank.

-- ───────────── 1. the supplier's usual terms ─────────────
create table if not exists public.supplier_quote_defaults (
  org_id             uuid primary key references public.businesses(id) on delete cascade,
  gst_rate           numeric(5,2)  not null default 18 check (gst_rate between 0 and 40),
  delivery_days      int           not null default 7  check (delivery_days between 0 and 365),
  payment_terms_days int           not null default 30 check (payment_terms_days between 0 and 365),
  valid_days         int           not null default 15 check (valid_days between 1 and 365),
  shipping           numeric(14,2) not null default 0  check (shipping >= 0),
  other_charges      numeric(14,2) not null default 0  check (other_charges >= 0),
  notes              text          not null default '' check (char_length(notes) <= 1000),
  updated_at         timestamptz   not null default now()
);
alter table public.supplier_quote_defaults enable row level security;
revoke all on public.supplier_quote_defaults from public, anon, authenticated;

-- ───────────── 2. matching (internal) ─────────────
-- Words that matter, lower case, plural trimmed, sizes split from units ("10mm" -> "10", "mm"), a few Indian trade
-- abbreviations spelled out (MS, SS, GI). The same function runs on both sides of a comparison.
create or replace function public._qs_tokens(p text)
returns text[] language plpgsql immutable set search_path = '' as $$
declare s text; t text; r text[] := '{}';
begin
  s := lower(coalesce(left(p, 300), ''));
  s := regexp_replace(s, '([0-9])([a-z])', '\1 \2', 'g');
  s := regexp_replace(s, '([a-z])([0-9])', '\1 \2', 'g');
  s := regexp_replace(s, '[^a-z0-9.]+', ' ', 'g');
  for t in select x from regexp_split_to_table(s, '\s+') x loop
    t := btrim(t, '.');
    if t = '' or t in ('of', 'the', 'and', 'for', 'with', 'in', 'to', 'a', 'an', 'x', 'pcs', 'pc', 'piece', 'pieces', 'nos', 'no', 'qty', 'size') then continue; end if;
    if t = 'ms' then r := r || array['mild', 'steel'];
    elsif t = 'ss' then r := r || array['stainless', 'steel'];
    elsif t = 'gi' then r := r || array['galvanised', 'iron'];
    elsif t = 'galvanized' then r := r || array['galvanised'];
    else
      if t !~ '^[0-9.]+$' and char_length(t) > 3 and t like '%s' and t not like '%ss' then t := left(t, char_length(t) - 1); end if;
      r := r || t;
    end if;
  end loop;
  return coalesce((select array_agg(distinct x order by x) from unnest(r) x), '{}');
end $$;

-- How sure are we that a wanted line and a product / earlier line are the same thing? null, 'possible', 'strong' or 'exact'.
create or replace function public._qs_match(p_desc text, p_name text)
returns text language plpgsql immutable set search_path = '' as $$
declare a text[] := public._qs_tokens(p_desc); b text[] := public._qs_tokens(p_name);
        na text[]; nb text[]; v_inter int; v_small int; v_big int;
begin
  if cardinality(a) = 0 or cardinality(b) = 0 then return null; end if;
  if a = b then return 'exact'; end if;
  select coalesce(array_agg(x order by x), '{}') into na from unnest(a) x where x ~ '^[0-9]+(\.[0-9]+)?$';
  select coalesce(array_agg(x order by x), '{}') into nb from unnest(b) x where x ~ '^[0-9]+(\.[0-9]+)?$';
  -- two different sizes are two different products
  if cardinality(na) > 0 and cardinality(nb) > 0 and na <> nb then return null; end if;
  select count(*) into v_inter from unnest(a) x where x = any (b);
  v_small := least(cardinality(a), cardinality(b));
  v_big := greatest(cardinality(a), cardinality(b));
  if v_inter = v_small and v_small >= 2 and na = nb and v_big - v_small <= 2 then return 'strong'; end if;
  if v_inter = v_small then return 'possible'; end if;
  if v_inter >= 2 and v_inter::numeric / v_small >= 0.67 and na = nb then return 'possible'; end if;
  return null;
end $$;

-- The best price this supplier already has for a wanted line, or null. Only ever the caller's own data.
create or replace function public._qs_suggest(p_org uuid, p_desc text, p_unit text, p_cur text, p_qty numeric, p_exclude_rfq uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r jsonb;
begin
  if char_length(btrim(coalesce(p_desc, ''))) < 2 then return null; end if;
  with cand as (
    select 'product'::text as source, 0 as srcrank, sp.id as product_id, sp.name as name, sp.price as price, sp.unit as unit,
           sp.moq as moq, sp.availability as availability, null::date as quoted_on, public._qs_match(p_desc, sp.name) as conf,
           sp.created_at as at
      from public.supplier_products sp
     where sp.org_id = p_org and sp.price is not null and sp.price > 0 and sp.currency = p_cur
    union all
    select 'past_quote'::text, 1, null::uuid, h.description, h.unit_price, h.unit, null::numeric, 'Available'::text, h.at::date,
           public._qs_match(p_desc, h.description), h.at
      from (select t.description, ql.unit_price, t.unit, q.received_at as at
              from public.quotations q
              join public.quotation_lines ql on ql.quotation_id = q.id
              join public.rfq_items t on t.id = ql.rfq_item_id
              join public.rfqs f on f.id = q.rfq_id
              join public.businesses bb on bb.id = f.org_id
             where q.supplier_org = p_org and q.rfq_id is distinct from p_exclude_rfq and bb.currency = p_cur
               and q.received_at >= now() - interval '180 days'
             order by q.received_at desc limit 300) h
  ), ranked as (
    select c.*, (btrim(coalesce(p_unit, '')) = '' or lower(btrim(c.unit)) = lower(btrim(p_unit))) as unit_ok,
           case c.conf when 'exact' then 0 when 'strong' then 1 else 2 end as rk
      from cand c where c.conf is not null
  ), best as (
    select z.*, (z.conf in ('exact', 'strong') and z.unit_ok and z.availability <> 'Temporarily unavailable'
                 and (z.source = 'product' or z.quoted_on >= current_date - 90)) as auto
      from ranked z order by z.rk, (not z.unit_ok), z.srcrank, z.at desc, z.name limit 1
  )
  select jsonb_build_object('source', b.source, 'confidence', b.conf, 'product_id', b.product_id, 'name', b.name, 'price', b.price,
           'unit', b.unit, 'moq', b.moq, 'availability', b.availability, 'quoted_on', b.quoted_on, 'unit_ok', b.unit_ok,
           'auto', b.auto, 'clean', b.auto and (b.moq is null or p_qty is null or b.moq <= p_qty))
    into r from best b;
  return r;
end $$;

-- ───────────── 3. save the usual terms ─────────────
create or replace function public.save_quote_defaults(p_org uuid, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_role text; v_gst numeric; v_ship numeric; v_other numeric; v_del numeric; v_pay numeric; v_valid numeric; v_notes text := '';
begin
  v_role := public._quote_guard(p_org);
  if v_role not in ('owner', 'procurement_manager') then raise exception 'not_allowed'; end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then raise exception 'invalid_request'; end if;
  v_gst := public._quote_num(p_data -> 'gstRate', 0, 40, 'invalid_gst');
  v_ship := public._quote_num(coalesce(p_data -> 'shipping', '0'::jsonb), 0, 1000000000, 'invalid_shipping');
  v_other := public._quote_num(coalesce(p_data -> 'otherCharges', '0'::jsonb), 0, 1000000000, 'invalid_other_charges');
  v_del := public._quote_num(p_data -> 'deliveryDays', 0, 365, 'invalid_delivery_days');
  if v_del <> trunc(v_del) then raise exception 'invalid_delivery_days'; end if;
  v_pay := public._quote_num(p_data -> 'paymentTermsDays', 0, 365, 'invalid_payment_terms');
  if v_pay <> trunc(v_pay) then raise exception 'invalid_payment_terms'; end if;
  v_valid := public._quote_num(p_data -> 'validDays', 1, 365, 'invalid_valid_days');
  if v_valid <> trunc(v_valid) then raise exception 'invalid_valid_days'; end if;
  if p_data ? 'notes' and jsonb_typeof(p_data -> 'notes') <> 'null' then
    if jsonb_typeof(p_data -> 'notes') <> 'string' then raise exception 'invalid_notes'; end if;
    v_notes := btrim(p_data ->> 'notes');
    if char_length(v_notes) > 1000 then raise exception 'invalid_notes'; end if;
  end if;
  insert into public.supplier_quote_defaults (org_id, gst_rate, delivery_days, payment_terms_days, valid_days, shipping, other_charges, notes, updated_at)
    values (p_org, v_gst, v_del::int, v_pay::int, v_valid::int, v_ship, v_other, v_notes, now())
    on conflict (org_id) do update set gst_rate = excluded.gst_rate, delivery_days = excluded.delivery_days,
      payment_terms_days = excluded.payment_terms_days, valid_days = excluded.valid_days, shipping = excluded.shipping,
      other_charges = excluded.other_charges, notes = excluded.notes, updated_at = now();
  perform public._audit(p_org, 'quote_defaults_saved', 'supplier_quote_defaults', null, '{}'::jsonb);
  return jsonb_build_object('gst_rate', v_gst, 'delivery_days', v_del::int, 'payment_terms_days', v_pay::int, 'valid_days', v_valid::int,
    'shipping', v_ship, 'other_charges', v_other, 'notes', v_notes);
end $$;

-- ───────────── 4. the inbox and the request, with the new price memory (rebuilt from migration 14) ─────────────
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
      'currency', x.currency, 'my_total', x.my_total, 'ready', x.ready)
    order by x.grp, x.due_date nulls last, x.sent_at desc, x.rfq_id), '[]'::jsonb) into v_items
    from (
      select f.id as rfq_id, f.number, f.title, f.category, f.due_date, i.sent_at, i.responded_at,
             public._quote_state(i.status, f.status, f.due_date) as state,
             case when public._quote_state(i.status, f.status, f.due_date) = 'open' then 0 else 1 end as grp,
             (select count(*) from public.rfq_items t where t.rfq_id = f.id) as item_count,
             (select count(*) from public.rfq_invites ii where ii.rfq_id = f.id) as invited,
             b.name as buyer_name, b.city as buyer_city, b.state as buyer_state, b.currency as currency,
             (select (public._quote_amounts(q.id) ->> 'total')::numeric from public.quotations q
               where q.rfq_id = f.id and q.supplier_org = p_org) as my_total,
             -- "Ready in one tap": still open, and every item already has a clean price from the supplier's own data
             (public._quote_state(i.status, f.status, f.due_date) = 'open'
              and exists (select 1 from public.rfq_items t0 where t0.rfq_id = f.id)
              and not exists (select 1 from public.rfq_items t1 where t1.rfq_id = f.id
                               and not coalesce((public._qs_suggest(p_org, t1.description, t1.unit, b.currency, t1.qty, f.id) ->> 'clean')::boolean, false))) as ready
        from public.rfq_invites i
        join public.rfqs f on f.id = i.rfq_id
        join public.businesses b on b.id = f.org_id
       where i.supplier_org = p_org and (v_filter is null or public._quote_state(i.status, f.status, f.due_date) = v_filter)
       order by (case when public._quote_state(i.status, f.status, f.due_date) = 'open' then 0 else 1 end),
                f.due_date nulls last, i.sent_at desc, f.id
       limit v_limit offset v_offset) x;
  return jsonb_build_object('total', v_total, 'counts', v_counts, 'items', v_items);
end $$;

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

  -- each wanted line, with the supplier's best own price for it (product list or an earlier quote), when there is one
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'description', t.description, 'qty', t.qty, 'unit', t.unit,
      'suggestion', public._qs_suggest(p_org, t.description, t.unit, b.currency, t.qty, p_rfq)
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
    'defaults', (select jsonb_build_object('gst_rate', d.gst_rate, 'delivery_days', d.delivery_days, 'payment_terms_days', d.payment_terms_days,
                   'valid_days', d.valid_days, 'shipping', d.shipping, 'other_charges', d.other_charges, 'notes', d.notes)
                   from public.supplier_quote_defaults d where d.org_id = p_org),
    'can_respond', v_role in ('owner', 'procurement_manager'));
end $$;

-- ───────────── 4b. a revision keeps the first reply time (rebuilt from migration 14, one line changed) ─────────────
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

  -- A revision keeps the ORIGINAL reply time: fixing a typo days later must not make the supplier look slow (Fair Rank and the
  -- reply time buyers see are measured from the first quote). A supplier who declined and then quotes is timed from that quote.
  update public.rfq_invites
     set status = 'quoted',
         responded_at = case when v_inv.status = 'quoted' and v_inv.responded_at is not null then v_inv.responded_at else now() end,
         decline_reason = ''
   where id = v_inv.id;
  if f.status = 'sent' then update public.rfqs set status = 'evaluating' where id = p_rfq; end if;
  v_amounts := public._quote_amounts(v_q);
  select name into v_name from public.businesses where id = p_org;
  perform public._quote_notify_buyer(f, v_name || case when v_new then ' sent a quote' else ' updated their quote' end,
    f.number || ' · ' || f.title);
  perform public._audit(p_org, 'quote_submitted', 'quotation', v_q, jsonb_build_object('rfq', p_rfq, 'revision', v_rev));
  perform public._audit(f.org_id, 'quote_received', 'quotation', v_q, jsonb_build_object('rfq', p_rfq, 'supplier', p_org, 'revision', v_rev));
  return jsonb_build_object('id', v_q, 'revision', v_rev, 'amounts', v_amounts);
end $$;

-- ───────────── 5. who may call what ─────────────
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('_qs_tokens', '_qs_match', '_qs_suggest', 'save_quote_defaults',
                                                          'list_quote_requests', 'get_quote_request', 'submit_quotation')
  loop execute format('revoke all on function %s from public, anon, authenticated', f.sig); end loop;
end $$;
grant execute on function public.list_quote_requests(uuid, text, int, int) to authenticated;
grant execute on function public.get_quote_request(uuid, uuid) to authenticated;
grant execute on function public.save_quote_defaults(uuid, jsonb) to authenticated;
grant execute on function public.submit_quotation(uuid, uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
