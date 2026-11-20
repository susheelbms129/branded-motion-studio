-- Migration 21 — the Supplier Scorecard: a record earned from real orders. Run AFTER migrations 1-20. Safe to run twice.
--
-- WHAT IT IS: proof, not payment. A buyer opening a supplier's profile (and anyone opening a shared Trust Passport) sees what that
-- supplier actually did on Vendora in the last 12 months: how fast it replied to RFQs, whether orders arrived on the promised date and how
-- late the late ones were, how many different buyers it served, how many came back, and whether it ever confirmed an order and then
-- walked away. Nothing on it can be bought, edited or self-reported.
--
-- HOW IT DIFFERS FROM FAIR RANK (migration 18): Fair Rank is a score that decides ORDER (last 180 days, pulled towards the middle so a
-- lucky order cannot make a company). The Scorecard is the RECORD behind it, over 12 months, with the raw counts, the spread (not just an
-- average), a six-month trend, the last few outcomes, and badges whose rules anyone can read. It never shows points.
--
-- WHAT KEEPS IT HONEST
--   * Reply times are server timestamps. Delivery dates are recorded by the BUYER, never the supplier. Promised dates cannot be edited.
--   * A percentage or a median appears only after 3 real data points. Counts always appear, so a thin record looks thin.
--   * "Different buyers" and "buyers who came back" are shown next to the order count: 20 orders from one buyer is one buyer.
--   * Orders between companies of the same group (same PAN inside the GSTIN) are not counted, so a company cannot feed its own record.
--   * A supplier that confirmed an order and then cancelled it shows that, in the open.
--   * Buyers' names and order values never appear. The recent outcomes show the month and the result only.
--   * The unearned-badge progress ("6 of 10 orders") is visible to the supplier only. Buyers and the public see earned badges.

-- ───────── 1. the rules, in one place (they are returned with every scorecard, so the page can never describe other rules) ─────────
create or replace function public._scorecard_rules()
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('version', 1, 'window_days', 365, 'min_samples', 3, 'trend_months', 6, 'recent_outcomes', 6,
    'late_bands', jsonb_build_array(jsonb_build_object('key', 'late_1_3', 'from_days', 1, 'to_days', 3), jsonb_build_object('key', 'late_4_plus', 'from_days', 4)),
    'badges', jsonb_build_array(
      jsonb_build_object('key', 'fast_replies', 'title', 'Fast replies', 'unit', 'quotes', 'need', 5, 'rule', 'Median reply under 4 hours, over at least 5 quotes'),
      jsonb_build_object('key', 'on_time_record', 'title', 'On-time record', 'unit', 'orders', 'need', 10, 'rule', '90% or more of at least 10 orders delivered on or before the promised date'),
      jsonb_build_object('key', 'repeat_buyers', 'title', 'Buyers come back', 'unit', 'repeat buyers', 'need', 3, 'rule', 'At least 3 buyers placed a second order'),
      jsonb_build_object('key', 'clean_record', 'title', 'Never walked away', 'unit', 'orders', 'need', 10, 'rule', 'At least 10 confirmed orders and none cancelled by the supplier after confirming')))
$$;

-- ───────── 2. the evidence, one row per real event (internal) ─────────
create or replace function public._scorecard_orders(p_org uuid)
returns table (delivered boolean, failed boolean, diff int, buyer uuid, related boolean, at timestamptz)
language sql stable security definer set search_path = '' as $$
  select (p.status in ('received', 'closed') and p.delivered_at is not null and p.expected_at is not null),
         (p.status = 'cancelled' and p.cancelled_by = 'supplier' and p.acknowledged_at is not null),
         ((p.delivered_at at time zone 'UTC')::date - p.expected_at),
         p.org_id,
         coalesce(substr(bb.gstin, 3, 10) <> '' and substr(bb.gstin, 3, 10) = substr(sb.gstin, 3, 10), false),
         coalesce(p.delivered_at, p.cancelled_at)
    from public.purchase_orders p
    join public.businesses bb on bb.id = p.org_id
    join public.businesses sb on sb.id = p.supplier_org
   where p.supplier_org = p_org
     and p.issued_at >= current_date::timestamp at time zone 'UTC' - make_interval(days => (public._scorecard_rules() ->> 'window_days')::int)
$$;

create or replace function public._scorecard_invites(p_org uuid)
returns table (answered boolean, quoted boolean, ignored boolean, hrs numeric, responded_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select (i.status in ('quoted', 'declined') and i.responded_at is not null),
         (i.status = 'quoted' and i.responded_at is not null),
         (i.status in ('sent', 'viewed') and f.due_date is not null and f.due_date < current_date),
         (greatest(extract(epoch from (i.responded_at - i.sent_at)) / 3600.0, 0))::numeric,
         i.responded_at
    from public.rfq_invites i join public.rfqs f on f.id = i.rfq_id
   where i.supplier_org = p_org
     and i.sent_at >= current_date::timestamp at time zone 'UTC' - make_interval(days => (public._scorecard_rules() ->> 'window_days')::int)
$$;

-- ───────── 3. the scorecard (internal; the three public doors below all call this) ─────────
create or replace function public._scorecard_core(p_org uuid, p_self boolean)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  r jsonb := public._scorecard_rules(); v_min int := (r ->> 'min_samples')::int; n_recent int := (r ->> 'recent_outcomes')::int;
  v_del int; v_ontime int; v_early int; v_late13 int; v_late4 int; v_failed int; v_excluded int; v_med_diff numeric;
  v_buyers int; v_repeat int; v_closed int; v_answered int; v_quoted int; v_within24 int; v_medh numeric;
  v_months jsonb; v_recent jsonb; v_badges jsonb; v_on_pct int; v_med_h numeric;
begin
  select count(*) filter (where delivered and not related), count(*) filter (where delivered and not related and diff <= 0),
         count(*) filter (where delivered and not related and diff < 0), count(*) filter (where delivered and not related and diff between 1 and 3),
         count(*) filter (where delivered and not related and diff >= 4), count(*) filter (where failed and not related),
         count(*) filter (where (delivered or failed) and related),
         (percentile_cont(0.5) within group (order by diff) filter (where delivered and not related))::numeric
    into v_del, v_ontime, v_early, v_late13, v_late4, v_failed, v_excluded, v_med_diff
    from public._scorecard_orders(p_org);

  select count(*), count(*) filter (where n >= 2) into v_buyers, v_repeat
    from (select buyer, count(*) as n from public._scorecard_orders(p_org) where delivered and not related group by buyer) b;

  select count(*) filter (where answered or ignored), count(*) filter (where answered), count(*) filter (where quoted),
         count(*) filter (where quoted and hrs <= 24), (percentile_cont(0.5) within group (order by hrs) filter (where quoted))::numeric
    into v_closed, v_answered, v_quoted, v_within24, v_medh
    from public._scorecard_invites(p_org);

  -- the last six calendar months, oldest first; a month with nothing in it still appears so the gap is visible
  select jsonb_agg(jsonb_build_object('month', to_char(m, 'YYYY-MM'),
           'orders', (select count(*) from public._scorecard_orders(p_org) o where o.delivered and not o.related and date_trunc('month', o.at at time zone 'UTC') = m),
           'on_time', (select count(*) from public._scorecard_orders(p_org) o where o.delivered and not o.related and o.diff <= 0 and date_trunc('month', o.at at time zone 'UTC') = m),
           'quotes', (select count(*) from public._scorecard_invites(p_org) i where i.quoted and date_trunc('month', i.responded_at at time zone 'UTC') = m),
           'median_hours', (select round((percentile_cont(0.5) within group (order by i.hrs))::numeric, 1) from public._scorecard_invites(p_org) i
                             where i.quoted and date_trunc('month', i.responded_at at time zone 'UTC') = m)) order by m)
    into v_months
    from generate_series(date_trunc('month', current_date) - make_interval(months => (r ->> 'trend_months')::int - 1), date_trunc('month', current_date), interval '1 month') m;

  -- the latest outcomes: the month and the result, never the buyer or the value
  select coalesce(jsonb_agg(jsonb_build_object('month', to_char(at at time zone 'UTC', 'YYYY-MM'),
           'outcome', case when failed then 'cancelled' when diff < 0 then 'early' when diff = 0 then 'on_time' else 'late' end,
           'days', case when delivered then abs(diff) end) order by at desc), '[]'::jsonb)
    into v_recent
    from (select * from public._scorecard_orders(p_org) o where (o.delivered or o.failed) and not o.related order by o.at desc limit n_recent) x;

  v_on_pct := case when v_del >= v_min then round(100.0 * v_ontime / v_del)::int end;
  v_med_h := case when v_quoted >= v_min then round(v_medh, 1) end;

  select jsonb_agg(jsonb_build_object('key', b ->> 'key', 'title', b ->> 'title', 'rule', b ->> 'rule', 'unit', b ->> 'unit', 'need', (b ->> 'need')::int,
           'have', case b ->> 'key' when 'fast_replies' then v_quoted when 'on_time_record' then v_del when 'repeat_buyers' then v_repeat else v_del end,
           'earned', case b ->> 'key'
             when 'fast_replies' then v_quoted >= (b ->> 'need')::int and v_medh < 4
             when 'on_time_record' then v_del >= (b ->> 'need')::int and 100.0 * v_ontime / nullif(v_del, 0) >= 90
             when 'repeat_buyers' then v_repeat >= (b ->> 'need')::int
             else v_del + v_failed >= (b ->> 'need')::int and v_failed = 0 end))
    into v_badges
    from jsonb_array_elements(r -> 'badges') b;
  -- buyers and the public see only what was earned; the supplier also sees how far each badge still is
  if not p_self then
    select coalesce(jsonb_agg(x - 'have' - 'need'), '[]'::jsonb) into v_badges from jsonb_array_elements(v_badges) x where (x ->> 'earned')::boolean;
  end if;

  return jsonb_build_object(
    'window_days', (r ->> 'window_days')::int, 'min_samples', v_min, 'level', public._trust_level(p_org),
    'is_new', (v_del + v_failed + v_closed) = 0,
    'replies', jsonb_build_object('rfqs_counted', v_closed, 'answered', v_answered, 'quoted', v_quoted,
      'answered_pct', case when v_closed >= v_min then round(100.0 * v_answered / v_closed)::int end,
      'median_hours', v_med_h,
      'within_24h_pct', case when v_quoted >= v_min then round(100.0 * v_within24 / v_quoted)::int end),
    'delivery', jsonb_build_object('orders_counted', v_del + v_failed, 'delivered', v_del,
      'on_time', v_ontime, 'early', v_early, 'late_1_3', v_late13, 'late_4_plus', v_late4,
      'on_time_pct', v_on_pct,
      'median_days_vs_promise', case when v_del >= v_min then round(v_med_diff, 0)::int end,
      'cancelled_after_confirming', v_failed),
    'buyers', jsonb_build_object('different', v_buyers, 'repeat', v_repeat),
    'excluded_same_group', v_excluded,
    'months', coalesce(v_months, '[]'::jsonb), 'recent', v_recent, 'badges', coalesce(v_badges, '[]'::jsonb),
    'rules', r);
end $$;

-- ───────── 4. the public doors ─────────
-- A buyer, a platform admin, or a member of the supplier itself (who additionally sees badge progress).
create or replace function public.get_supplier_scorecard(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_self boolean;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from public.businesses b join public.supplier_profiles p on p.org_id = b.id where b.id = p_org and b.kind = 'supplier') then
    raise exception 'not_found';
  end if;
  v_self := public._quote_role(p_org) is not null;
  if not (v_self or public._is_buyer() or public.is_platform_admin()) then raise exception 'not_allowed'; end if;
  return public._scorecard_core(p_org, v_self);
end $$;

-- The shared Trust Passport now carries the scorecard too, so the proof travels with the link.
create or replace function public.get_public_passport(p_slug text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_slug text := lower(btrim(coalesce(p_slug, ''))); v_out jsonb;
begin
  if v_slug !~ '^[a-z0-9-]{2,60}$' then raise exception 'not_found'; end if;
  select jsonb_build_object(
           'slug', b.slug, 'name', b.name, 'city', b.city, 'state', b.state, 'country', b.country,
           'business_type', b.business_type, 'year_established', b.year_established,
           'description', p.description,
           'logo', case when p.logo is not null and char_length(p.logo) <= 100000 then p.logo end,
           'categories', to_jsonb(p.categories),
           'as_of', current_date,
           'passport', public._passport_core(b.id),
           'scorecard', public._scorecard_core(b.id, false))
    into v_out
    from public.businesses b join public.supplier_profiles p on p.org_id = b.id
   where b.slug = v_slug and b.kind = 'supplier' and p.passport_public;
  if v_out is null then raise exception 'not_found'; end if;
  return v_out;
end $$;

-- ───────── 5. who may call what ─────────
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('_scorecard_rules', '_scorecard_orders', '_scorecard_invites', '_scorecard_core',
                  'get_supplier_scorecard', 'get_public_passport')
  loop execute format('revoke all on function %s from public, anon, authenticated', f.sig); end loop;
end $$;
grant execute on function public.get_supplier_scorecard(uuid) to authenticated;
grant execute on function public.get_public_passport(text) to anon, authenticated;

notify pgrst, 'reload schema';
