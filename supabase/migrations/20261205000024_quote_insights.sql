-- Vendora real insights, step 1: "Paid vs market" (migration 24). Run AFTER migrations 1-23. Safe to run twice.
--
-- WHAT BUYERS GET
--   * For every purchase order that came from an RFQ, the app compares what you PAID (the awarded quote's total landed cost:
--     items + GST + freight + other charges) with ALL the real quotes suppliers sent for that same RFQ.
--     Example: "You paid 8% above the average quote, and a quote Rs 12,400 cheaper was available."
--   * Good news is shown too ("12% below the average", "you saved Rs 30,000 against the dearest quote"), so the numbers are
--     trusted and are not only alarms.
--
-- HONESTY RULES
--   * Only real data: quotes suppliers actually sent for the same RFQ. Nothing is estimated or invented.
--   * An order is compared only when at least 2 quotes exist (one quote has nothing to be compared with).
--   * Cancelled orders are left out.
--   * Each supplier has one quote per RFQ (a revision replaces it), so no supplier counts twice in the average.
--   * The money comes from the same database function that quoting and awarding use (_quote_amounts), so it matches the
--     comparison screen to the rupee.
--
-- SAFETY
--   * READ ONLY: this migration adds one function and changes no table.
--   * Only members of the BUYER company can read it (same rule as purchase orders: not_allowed otherwise).
--   * It returns only totals, counts and the buyer's own order numbers: never another supplier's name or line prices.

create or replace function public.get_quote_insights(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_items jsonb; v_sum jsonb;
begin
  perform public._req_guard(p_org);

  with po as (
    select o.id as po_id, o.number, o.title, o.rfq_id, o.quotation_id, o.issued_at
      from public.purchase_orders o
     where o.org_id = p_org and o.supplier_org is not null and o.status <> 'cancelled'
       and o.rfq_id is not null and o.quotation_id is not null
  ), q as (
    select po.po_id, x.id as qid, (public._quote_amounts(x.id) ->> 'total')::numeric as total
      from po join public.quotations x on x.rfq_id = po.rfq_id and x.supplier_org is not null
  ), agg as (
    select po.po_id, po.number, po.title, po.rfq_id, po.issued_at,
           count(q.qid)::int as quotes, round(avg(q.total), 2) as average, min(q.total) as cheapest, max(q.total) as dearest,
           max(q.total) filter (where q.qid = po.quotation_id) as paid
      from po join q on q.po_id = po.po_id
     group by po.po_id, po.number, po.title, po.rfq_id, po.issued_at, po.quotation_id
  ), r as (
    select a.*,
           (1 + (select count(*) from q z where z.po_id = a.po_id and z.total < a.paid))::int as rank,
           round((a.paid - a.average) / nullif(a.average, 0) * 100, 1) as pct_vs_average,
           round(a.paid - a.cheapest, 2) as extra_vs_cheapest,
           round(a.paid - a.average, 2) as diff_vs_average,
           round(a.dearest - a.paid, 2) as saved_vs_dearest
      from agg a where a.quotes >= 2 and a.paid is not null
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'po_id', r.po_id, 'po_number', r.number, 'title', r.title, 'rfq_id', r.rfq_id, 'issued_at', r.issued_at,
           'quotes', r.quotes, 'paid', r.paid, 'average', r.average, 'cheapest', r.cheapest, 'dearest', r.dearest, 'rank', r.rank,
           'pct_vs_average', coalesce(r.pct_vs_average, 0), 'diff_vs_average', r.diff_vs_average,
           'extra_vs_cheapest', r.extra_vs_cheapest, 'saved_vs_dearest', r.saved_vs_dearest)
         order by r.issued_at desc nulls last, r.po_id), '[]'::jsonb),
         jsonb_build_object('orders', count(*), 'paid_total', coalesce(sum(r.paid), 0),
           'vs_average_total', coalesce(sum(r.diff_vs_average), 0),
           'saved_vs_dearest_total', coalesce(sum(r.saved_vs_dearest), 0),
           'extra_vs_cheapest_total', coalesce(sum(r.extra_vs_cheapest), 0),
           'above_average', count(*) filter (where r.diff_vs_average > 0),
           'below_average', count(*) filter (where r.diff_vs_average < 0))
    into v_items, v_sum from r;

  return jsonb_build_object('as_of', current_date, 'items', v_items, 'summary', v_sum);
end $$;

do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'get_quote_insights'
  loop execute format('revoke all on function %s from public, anon, authenticated', f.sig); end loop;
end $$;
grant execute on function public.get_quote_insights(uuid) to authenticated;

notify pgrst, 'reload schema';
