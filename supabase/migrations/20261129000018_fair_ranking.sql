-- Vendora Fair Rank (migration 18). Run AFTER migrations 1-17. Safe to run twice.
--
-- THE PROMISE: a supplier can never buy a better position on Vendora. There is no paid placement, no sponsored listing, no
-- lead credits, and no pay-to-see-the-buyer. Position is EARNED, from three things only, all measured from what really
-- happened on the platform:
--     1. Trust      (50 points)  the Trust Passport level that counts today (an expired proof counts for nothing)
--     2. Response   (25 points)  how many RFQs the supplier answered, and how fast they sent a quote
--     3. Delivery   (25 points)  how many confirmed orders arrived on or before the promised date
-- The weights live in ONE place, get_fair_rank_rules(). The score is calculated from them, and the public "How ranking
-- works" page reads them from the same function, so the page can never describe a formula the database does not run.
--
-- What keeps it FAIR (not just free)
--   * New suppliers are not punished for having no history: with no evidence a supplier gets the neutral middle for
--     response and delivery (a "prior"), and it takes real evidence to move up or down. Small samples are pulled
--     towards the middle, so one lucky or unlucky order cannot make or break a supplier.
--   * Only the last 180 days count, so a bad month is not a life sentence and an old reputation cannot coast.
--   * Nobody is ranked on a guess: the numbers buyers see (reply time, answered share, on-time share) appear only after
--     3 real data points.
--   * Suppliers whose scores fall in the same one-point band are treated as EQUAL and take turns: the order among equals
--     is reshuffled every day (stable within a day, so paging never repeats or skips a company).
--   * Declining an RFQ honestly counts as answering it (a clear "no" is useful), but it earns no speed points, so
--     declining everything fast is not a way to climb. Ignoring RFQs until their due date counts against a supplier.
--     Confirming an order and then cancelling it counts as a missed delivery; declining it before confirming does not.
--   * Delivery dates are recorded by the BUYER (receive_purchase_order), never by the supplier, so a supplier cannot
--     mark its own homework.
--   * A supplier without a valid proof is not ranked at all: unverified suppliers are listed last, whatever else they did.
--   * Everyone sees the same order: it does not depend on who is looking, which buyer, or any money.
--
-- Safety
--   * The ranking reads only: businesses, supplier_profiles, verification_checks (through the Trust Passport),
--     rfq_invites, rfqs and purchase_orders. A test fails if it ever reads anything else.
--   * A supplier can read ONLY its own score breakdown (any active member of that company). Nobody sees a competitor's
--     breakdown; buyers see the public facts and the evidence behind them, never the points.
--   * Only the owner or a procurement manager of the BUYER company can record a delivery, only for a supplier-confirmed
--     order, never in the future and never before the order was issued. It is audited (ids only) and the supplier is told.

-- ───────────── 1. the rules, in one place (public: this is the formula) ─────────────
create or replace function public.get_fair_rank_rules()
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'version', 1,
    'max', 100,
    'trust', jsonb_build_object('max', 50, 'by_level', jsonb_build_object('0', 0, '1', 30, '2', 42, '3', 50)),
    'response', jsonb_build_object('max', 25, 'answered_weight', 0.5, 'speed_weight', 0.5,
      'speed_bands', jsonb_build_array(
        jsonb_build_object('within_hours', 4, 'score', 1.0), jsonb_build_object('within_hours', 24, 'score', 0.8),
        jsonb_build_object('within_hours', 72, 'score', 0.5), jsonb_build_object('within_hours', 168, 'score', 0.25)),
      'slower_score', 0.1),
    'delivery', jsonb_build_object('max', 25),
    'window_days', 180, 'prior', 0.5, 'prior_weight', 5, 'min_samples', 3, 'tie_band', 1)
$$;

-- ───────────── 2. a delivery is recorded by the buyer ─────────────
create or replace function public.receive_purchase_order(p_po uuid, p_delivered_on date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare o public.purchase_orders; v_day date; v_role text; v_buyer text; v_on_time boolean;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated'; end if;
  select * into o from public.purchase_orders where id = p_po and supplier_org is not null for update;
  if not found then raise exception 'not_found'; end if;
  v_role := public._req_role(o.org_id);
  if v_role is null then raise exception 'not_found'; end if;
  if v_role not in ('owner', 'procurement_manager') then raise exception 'not_allowed'; end if;
  if o.status <> 'acknowledged' then raise exception 'not_receivable'; end if;
  v_day := coalesce(p_delivered_on, current_date);
  if v_day > current_date or v_day < o.issued_at::date then raise exception 'invalid_date'; end if;
  update public.purchase_orders set status = 'received', delivered_at = (v_day + time '12:00')::timestamp at time zone 'UTC' where id = o.id;
  v_on_time := o.expected_at is null or v_day <= o.expected_at;
  select name into v_buyer from public.businesses where id = o.org_id;
  perform public._po_notify_supplier(o.supplier_org, v_buyer || ' recorded delivery of an order',
    o.number || ' · ' || o.title || case when v_on_time then ' · on time' else ' · after the promised date' end, o.id);
  perform public._audit(o.org_id, 'po_goods_received', 'purchase_order', o.id, jsonb_build_object('on_time', v_on_time));
  perform public._audit(o.supplier_org, 'po_goods_received', 'purchase_order', o.id, jsonb_build_object('on_time', v_on_time));
  return jsonb_build_object('status', 'received', 'delivered_on', v_day, 'on_time', v_on_time);
end $$;

-- The buyer's order page needs to know when it was delivered and whether the buyer may record it.
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
      'delivered_at', o.delivered_at,
      'cancelled_at', o.cancelled_at, 'cancelled_by', o.cancelled_by, 'payment_terms_days', o.payment_terms_days,
      'delivery_address', o.delivery_address, 'notes', o.notes, 'supplier_note', o.supplier_note, 'decline_reason', o.decline_reason,
      'rfq_id', o.rfq_id, 'rfq_number', (select f.number from public.rfqs f where f.id = o.rfq_id),
      'created_by_name', public._display_name(o.created_by),
      'currency', (select z.currency from public.businesses z where z.id = o.org_id)),
    'supplier', jsonb_build_object('id', b.id, 'name', b.name, 'city', b.city, 'state', b.state, 'gstin', b.gstin,
      'level_now', public._trust_level(b.id)),
    'lines', public._po_lines(o.id), 'amounts', public._po_amounts(o.id),
    'can_cancel', o.status = 'issued' and v_role in ('owner', 'procurement_manager'),
    'can_receive', o.status = 'acknowledged' and v_role in ('owner', 'procurement_manager'));
end $$;

-- ───────────── 3. the ranking itself (internal; every supplier, one pass) ─────────────
create or replace function public._fair_rank_all(p_day date default current_date)
returns table (org_id uuid, level int, ranked boolean, is_new boolean, score numeric, trust_pts numeric, response_pts numeric,
               delivery_pts numeric, closed int, answered int, quoted int, median_hours numeric, orders_n int, on_time int,
               bucket int, tie_key text)
language plpgsql stable security definer set search_path = '' as $$
declare
  r jsonb := public.get_fair_rank_rules();
  w interval := make_interval(days => (r ->> 'window_days')::int);
  since timestamptz := p_day::timestamp at time zone 'UTC' - make_interval(days => (r ->> 'window_days')::int);
  k numeric := (r ->> 'prior_weight')::numeric;
  pr numeric := (r ->> 'prior')::numeric;
  band numeric := (r ->> 'tie_band')::numeric;
  tmax numeric := (r -> 'trust' ->> 'max')::numeric;
  rmax numeric := (r -> 'response' ->> 'max')::numeric;
  dmax numeric := (r -> 'delivery' ->> 'max')::numeric;
  aw numeric := (r -> 'response' ->> 'answered_weight')::numeric;
  sw numeric := (r -> 'response' ->> 'speed_weight')::numeric;
  slower numeric := (r -> 'response' ->> 'slower_score')::numeric;
begin
  return query
  with sup as (
    select b.id as oid, public._trust_level(b.id) as lvl
      from public.businesses b join public.supplier_profiles p on p.org_id = b.id
     where b.kind = 'supplier'
  ), inv as (
    select i.supplier_org as oid,
           (i.status in ('quoted', 'declined') and i.responded_at is not null) as answered,
           (i.status = 'quoted' and i.responded_at is not null) as quoted,
           (i.status in ('sent', 'viewed') and f.due_date is not null and f.due_date < p_day) as ignored,
           greatest(extract(epoch from (i.responded_at - i.sent_at)) / 3600.0, 0) as hrs
      from public.rfq_invites i join public.rfqs f on f.id = i.rfq_id
     where i.supplier_org is not null and i.sent_at >= since
  ), inv_s as (
    select x.*, coalesce((select (bd ->> 'score')::numeric
                            from jsonb_array_elements(r -> 'response' -> 'speed_bands') bd
                           where x.hrs <= (bd ->> 'within_hours')::numeric
                           order by (bd ->> 'within_hours')::numeric limit 1), slower) as speed
      from inv x
  ), inv_a as (
    select s.oid,
           count(*) filter (where s.answered or s.ignored) as closed_n,
           count(*) filter (where s.answered) as answered_n,
           count(*) filter (where s.quoted) as quoted_n,
           coalesce(sum(s.speed) filter (where s.quoted), 0) as speed_sum,
           (percentile_cont(0.5) within group (order by s.hrs) filter (where s.quoted))::numeric as med
      from inv_s s group by s.oid
  ), po as (
    select p.supplier_org as oid,
           (p.status in ('received', 'closed') and p.delivered_at is not null and p.expected_at is not null) as delivered,
           ((p.delivered_at at time zone 'UTC')::date <= p.expected_at) as on_time,
           (p.status = 'cancelled' and p.cancelled_by = 'supplier' and p.acknowledged_at is not null) as failed
      from public.purchase_orders p
     where p.supplier_org is not null and p.issued_at >= since
  ), po_a as (
    select q.oid,
           count(*) filter (where q.delivered or q.failed) as total_n,
           count(*) filter (where q.delivered and q.on_time) as ontime_n
      from po q group by q.oid
  ), calc as (
    select s.oid, s.lvl,
           coalesce(a.closed_n, 0)::int as closed_n, coalesce(a.answered_n, 0)::int as answered_n, coalesce(a.quoted_n, 0)::int as quoted_n,
           round(a.med, 1) as med, coalesce(c.total_n, 0)::int as total_n, coalesce(c.ontime_n, 0)::int as ontime_n,
           coalesce((r -> 'trust' -> 'by_level' ->> s.lvl::text)::numeric, 0) as tp,
           rmax * (aw * ((coalesce(a.answered_n, 0) + k * pr) / (coalesce(a.closed_n, 0) + k))
                 + sw * ((coalesce(a.speed_sum, 0) + k * pr) / (coalesce(a.quoted_n, 0) + k))) as rp,
           dmax * ((coalesce(c.ontime_n, 0) + k * pr) / (coalesce(c.total_n, 0) + k)) as dp
      from sup s left join inv_a a on a.oid = s.oid left join po_a c on c.oid = s.oid
  )
  select c.oid, c.lvl, c.lvl >= 1, (c.closed_n + c.total_n) = 0,
         case when c.lvl >= 1 then round(c.tp + c.rp + c.dp, 1) end,
         round(c.tp, 1), round(c.rp, 1), round(c.dp, 1),
         c.closed_n, c.answered_n, c.quoted_n, c.med, c.total_n, c.ontime_n,
         case when c.lvl >= 1 then floor((c.tp + c.rp + c.dp) / band)::int else -1 end,
         md5(c.oid::text || p_day::text)
    from calc c;
end $$;

-- ───────────── 4. the directory, in fair order ─────────────
-- The same filters and public facts as migration 7. New: the order (fair rank by default) and the evidence behind it.
drop function if exists public.list_suppliers(text, text, text, boolean, int, int);
create or replace function public.list_suppliers(
  p_search text default '', p_state text default '', p_category text default '',
  p_verified_only boolean default false, p_limit int default 24, p_offset int default 0, p_sort text default 'fair')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_q text := left(btrim(coalesce(p_search, '')), 80);
  v_like text;
  v_state text := lower(btrim(coalesce(p_state, '')));
  v_cat text := lower(btrim(coalesce(p_category, '')));
  v_limit int := least(greatest(coalesce(p_limit, 24), 1), 50);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_sort text := lower(btrim(coalesce(p_sort, 'fair')));
  v_min int := (public.get_fair_rank_rules() ->> 'min_samples')::int;
  v_total int; v_items jsonb; v_states jsonb; v_cats jsonb;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated'; end if;
  if not (public._is_buyer() or public.is_platform_admin()) then raise exception 'not_allowed'; end if;
  if v_sort not in ('fair', 'name') then raise exception 'invalid_sort'; end if;
  v_like := '%' || replace(replace(replace(lower(v_q), '\', '\\'), '%', '\%'), '_', '\_') || '%';

  with base as (
    select b.id, b.name, b.city, b.state, p.categories, left(p.description, 200) as description,
           public.get_trust_passport(b.id) as pp
      from public.businesses b join public.supplier_profiles p on p.org_id = b.id
     where b.kind = 'supplier'
  ), shaped as (
    select base.id, base.name, base.city, base.state, base.categories, base.description,
           (pp ->> 'level')::int as level, pp ->> 'level_name' as level_name, pp ->> 'valid_through' as valid_through,
           jsonb_array_length(pp -> 'checks') as proofs,
           exists (select 1 from jsonb_array_elements(pp -> 'checks') c
                    where c ->> 'type' = 'registration' and c ->> 'evidence' = 'government_record') as government_checked,
           f.score, f.is_new, f.ranked, f.bucket, f.tie_key,
           case when f.quoted >= v_min then f.median_hours end as reply_hours,
           case when f.closed >= v_min then round(100.0 * f.answered / f.closed)::int end as answered_pct,
           case when f.orders_n >= v_min then round(100.0 * f.on_time / f.orders_n)::int end as on_time_pct,
           f.closed as rfqs_counted, f.orders_n as orders_counted
      from base join public._fair_rank_all() f on f.org_id = base.id
  ), filtered as (
    select * from shaped s
     where (v_q = '' or lower(s.name) like v_like escape '\' or lower(s.city) like v_like escape '\'
            or lower(s.description) like v_like escape '\'
            or exists (select 1 from unnest(s.categories) c where lower(c) like v_like escape '\'))
       and (v_state = '' or lower(s.state) = v_state)
       and (v_cat = '' or exists (select 1 from unnest(s.categories) c where lower(c) = v_cat))
       and (not coalesce(p_verified_only, false) or s.level >= 1)
  )
  select (select count(*) from filtered),
         coalesce((select jsonb_agg(to_jsonb(x) - 'bucket' - 'tie_key' - 'ranked' - 'ord' order by x.ord) from (
                     select id as org_id, name, city, state, categories, description, level, level_name, valid_through, proofs,
                            government_checked, score as fair_score, is_new, reply_hours, answered_pct, on_time_pct,
                            rfqs_counted, orders_counted, bucket, tie_key, ranked,
                            row_number() over (order by
                              case when v_sort = 'name' then level end desc nulls last,
                              case when v_sort = 'name' then name end,
                              case when v_sort = 'fair' then bucket end desc nulls last,
                              case when v_sort = 'fair' then tie_key end,
                              id) as ord
                       from filtered order by ord limit v_limit offset v_offset) x), '[]'::jsonb),
         coalesce((select jsonb_agg(distinct state order by state) from shaped where state <> ''), '[]'::jsonb),
         coalesce((select jsonb_agg(distinct c order by c) from shaped, unnest(categories) c), '[]'::jsonb)
    into v_total, v_items, v_states, v_cats;
  return jsonb_build_object('total', v_total, 'items', v_items, 'states', v_states, 'categories', v_cats);
end $$;

-- ───────────── 5. what a supplier sees about itself (and only itself) ─────────────
create or replace function public.get_my_fair_rank(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_role text; f record; r jsonb := public.get_fair_rank_rules(); v_ranked int; v_below int; v_pct int;
begin
  v_role := public._quote_guard(p_org);
  select * into f from public._fair_rank_all() x where x.org_id = p_org;
  if not found then raise exception 'not_found'; end if;
  select count(*) filter (where x.ranked), count(*) filter (where x.ranked and x.org_id <> p_org and x.score < f.score)
    into v_ranked, v_below from public._fair_rank_all() x;
  if f.ranked and v_ranked > 1 then v_pct := round(100.0 * v_below / (v_ranked - 1))::int; end if;
  return jsonb_build_object(
    'day', current_date, 'level', f.level, 'ranked', f.ranked, 'is_new', f.is_new, 'score', f.score,
    'ahead_of_pct', v_pct, 'verified_suppliers', v_ranked,
    'trust', jsonb_build_object('points', f.trust_pts, 'max', (r -> 'trust' ->> 'max')::numeric),
    'response', jsonb_build_object('points', f.response_pts, 'max', (r -> 'response' ->> 'max')::numeric,
                                   'rfqs_counted', f.closed, 'answered', f.answered, 'quoted', f.quoted, 'median_hours', f.median_hours),
    'delivery', jsonb_build_object('points', f.delivery_pts, 'max', (r -> 'delivery' ->> 'max')::numeric,
                                   'orders_counted', f.orders_n, 'on_time', f.on_time),
    'rules', r);
end $$;

-- ───────────── 6. what a buyer sees about one supplier's record ─────────────
create or replace function public.get_supplier_record(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare f record; v_min int := (public.get_fair_rank_rules() ->> 'min_samples')::int;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated'; end if;
  if not (public._is_buyer() or public.is_platform_admin()) then raise exception 'not_allowed'; end if;
  select * into f from public._fair_rank_all() x where x.org_id = p_org;
  if not found then raise exception 'not_found'; end if;
  return jsonb_build_object(
    'fair_score', f.score, 'is_new', f.is_new, 'window_days', (public.get_fair_rank_rules() ->> 'window_days')::int,
    'reply_hours', case when f.quoted >= v_min then f.median_hours end,
    'answered_pct', case when f.closed >= v_min then round(100.0 * f.answered / f.closed)::int end,
    'on_time_pct', case when f.orders_n >= v_min then round(100.0 * f.on_time / f.orders_n)::int end,
    'rfqs_counted', f.closed, 'orders_counted', f.orders_n);
end $$;

-- ───────────── 7. who may call what ─────────────
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('get_fair_rank_rules', '_fair_rank_all', 'receive_purchase_order',
                  'list_suppliers', 'get_my_fair_rank', 'get_supplier_record', 'get_purchase_order')
  loop execute format('revoke all on function %s from public, anon, authenticated', f.sig); end loop;
end $$;
grant execute on function public.get_fair_rank_rules() to anon, authenticated;
grant execute on function public.list_suppliers(text, text, text, boolean, int, int, text) to authenticated;
grant execute on function public.get_my_fair_rank(uuid) to authenticated;
grant execute on function public.get_supplier_record(uuid) to authenticated;
grant execute on function public.receive_purchase_order(uuid, date) to authenticated;
grant execute on function public.get_purchase_order(uuid) to authenticated;

notify pgrst, 'reload schema';
