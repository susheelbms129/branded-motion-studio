-- Vendora buyer quote comparison (migration 15). Run AFTER migrations 1-14. Safe to run twice.
--
-- What buyers get: every quotation suppliers sent for an RFQ (migration 14), side by side, with the real numbers needed to
-- compare on TOTAL LANDED COST (item prices + GST + freight + other charges), plus delivery time, payment terms, validity,
-- how fast the supplier replied, and how verified the supplier is today (Trust Passport level, from migration 4/6).
--
-- This migration only READS. It adds one function and changes no table, so nothing from migrations 1-14 is touched.
--
-- Safety (no data leaks and no shortcuts are the first rules)
--   * Only members of the BUYER company that owns the RFQ can read its quotes (same rule as get_rfq in migration 13).
--     Suppliers, strangers and made-up ids get not_found, so nobody learns whether an RFQ exists.
--   * A supplier never sees another supplier's price: this function is not callable by them for another company's RFQ,
--     and the supplier functions of migration 14 still show a supplier only its own quote.
--   * The math (money per quote) is returned from the same database function that quoting uses (_quote_amounts), so the
--     browser can double check its own landed-cost arithmetic against it.
--   * "today" comes from the database clock, so an expired quote is judged the same for everyone.

create or replace function public.get_rfq_quotes(p_rfq uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare f public.rfqs; v_cur text; v_quotes jsonb;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated'; end if;
  select * into f from public.rfqs where id = p_rfq and public._req_role(org_id) is not null;
  if not found then raise exception 'not_found'; end if;
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
      'amounts', public._quote_amounts(q.id))
    order by q.received_at, q.id), '[]'::jsonb) into v_quotes
    from public.quotations q
    join public.businesses b on b.id = q.supplier_org
    left join public.rfq_invites i on i.rfq_id = q.rfq_id and i.supplier_org = q.supplier_org
   where q.rfq_id = p_rfq and q.supplier_org is not null;

  return jsonb_build_object('currency', coalesce(v_cur, 'INR'), 'rfq_status', f.status, 'due_date', f.due_date,
    'today', current_date, 'quotes', v_quotes);
end $$;

-- ───────────── who may call what ─────────────
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'get_rfq_quotes'
  loop execute format('revoke all on function %s from public, anon, authenticated', f.sig); end loop;
end $$;
grant execute on function public.get_rfq_quotes(uuid) to authenticated;

notify pgrst, 'reload schema';
