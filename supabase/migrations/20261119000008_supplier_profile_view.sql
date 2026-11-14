-- Vendora supplier profile for buyers (migration 8). Run AFTER migrations 1-7. Safe to run twice.
--
-- What buyers get: ONE function, get_supplier_profile(org), that returns the public profile of ONE supplier together with its
-- Trust Passport. It is what the supplier detail page shows after a buyer clicks a card in the directory.
--
-- Safety (same rules as list_suppliers in migration 7)
--   * Only signed-in members of a BUYER company (and reviewers) may call it. Suppliers cannot study their competitors.
--   * Public facts only: name, place, company facts, full description, categories, products (with ONE small photo each),
--     delivery terms, service areas and the passport. NEVER returned: contact name, email, phone, website, bank, street
--     address, documents. Buyers reach a supplier through Vendora (RFQ), so contact details stay private.
--   * The passport comes from get_trust_passport(), so an expired proof never counts, here or anywhere else.
--   * Only suppliers that finished onboarding can be opened (they have a supplier_profiles row). Anything else is "not_found",
--     the same answer for a buyer company, a made-up id and a supplier who has not launched, so ids cannot be probed.
--   * Size is bounded: at most 20 products, 30 service areas, one photo per product and only if it is small.

create or replace function public.get_supplier_profile(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_out jsonb;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated'; end if;
  if not (public._is_buyer() or public.is_platform_admin()) then raise exception 'not_allowed'; end if;
  if p_org is null then raise exception 'not_found'; end if;

  select jsonb_build_object(
           'org_id', b.id,
           'name', b.name,
           'city', b.city,
           'state', b.state,
           'country', b.country,
           'business_type', b.business_type,
           'company_size', b.company_size,
           'year_established', b.year_established,
           'description', p.description,
           'logo', p.logo,
           'categories', to_jsonb(p.categories),
           'products', coalesce((
              select jsonb_agg(jsonb_build_object(
                       'name', x.name, 'category', x.category, 'description', x.description, 'unit', x.unit,
                       'moq', x.moq, 'price', x.price, 'currency', x.currency, 'availability', x.availability,
                       'image', case when x.images[1] is not null and char_length(x.images[1]) <= 100000 then x.images[1] end)
                     order by x.sort_order, x.name)
                from (select * from public.supplier_products sp where sp.org_id = b.id order by sp.sort_order, sp.name limit 20) x), '[]'::jsonb),
           'capabilities', (
              select jsonb_build_object(
                       'coverage', to_jsonb(c.coverage), 'delivery_time', c.delivery_time, 'min_order_value', c.min_order_value,
                       'currency', c.currency, 'delivery_options', to_jsonb(c.delivery_options), 'pickup', c.pickup, 'details', c.details)
                from public.supplier_capabilities c where c.org_id = b.id),
           'locations', coalesce((
              select jsonb_agg(jsonb_build_object('country', l.country, 'state', l.state, 'city', l.city) order by l.country, l.state, l.city)
                from (select * from public.supplier_locations sl where sl.org_id = b.id order by sl.country, sl.state, sl.city limit 30) l), '[]'::jsonb),
           'passport', public.get_trust_passport(b.id))
    into v_out
    from public.businesses b join public.supplier_profiles p on p.org_id = b.id
   where b.id = p_org and b.kind = 'supplier';

  if v_out is null then raise exception 'not_found'; end if;
  return v_out;
end $$;

do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'get_supplier_profile'
  loop execute format('revoke all on function %s from public, anon, authenticated', f.sig); end loop;
end $$;
grant execute on function public.get_supplier_profile(uuid) to authenticated;

notify pgrst, 'reload schema';
