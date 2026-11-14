-- Vendora supplier products (migration 10). Run AFTER migrations 1-9. Safe to run twice.
--
-- What suppliers get: a Products page where they add, edit and remove what they sell. Buyers see these products in the
-- directory and on the supplier profile (migrations 7 and 8 already read supplier_products), so an edit shows up there at once.
--
-- Safety (no data leaks is the first rule)
--   * The table stays read-only from the browser (migration 3: members of the company can read their own rows).
--     Every write goes through the two functions below, which check on the server who is asking.
--   * The caller must be an ACTIVE member of a SUPPLIER company with the owner or procurement-manager role.
--     A buyer, a stranger, a supplier of another company and a made-up id all get the same answer: not_allowed.
--   * A product can only be changed or removed inside the company the caller proved they belong to. Passing another
--     company's product id gives not_found, so nobody can learn whether it exists.
--   * Every field is checked on the server (length, allowed values, non-negative numbers). The browser checks are only for
--     friendliness. The currency is the company's own, never taken from the browser.
--   * Product photos are not touched by these functions (they are kept as they are).
--   * Size is bounded: at most 200 products per company; one writer at a time per company so the limit cannot be raced.
--   * Every save and every removal is written to the audit log (ids only, no names).

create or replace function public._product_guard(p_org uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated'; end if;
  if p_org is null or not exists (
       select 1 from public.memberships m join public.businesses b on b.id = m.org_id
        where m.org_id = p_org and m.user_id = (select auth.uid()) and m.status = 'active' and b.kind = 'supplier'
          and m.role in ('owner', 'procurement_manager'))
  then raise exception 'not_allowed'; end if;
end $$;

-- p_product: { id?, name, category, description, unit, moq, price, availability }  (id present = edit, absent = add)
create or replace function public.save_supplier_product(p_org uuid, p_product jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid; v_name text; v_cat text; v_desc text; v_unit text; v_moq numeric; v_price numeric; v_avail text; v_cur text;
  v_new boolean := false;
begin
  perform public._product_guard(p_org);
  if p_product is null or jsonb_typeof(p_product) <> 'object' then raise exception 'invalid_product' using errcode = '22023'; end if;

  v_name  := public._ob_text(p_product, 'name', 120);
  v_cat   := public._ob_text(p_product, 'category', 60);
  v_desc  := public._ob_text(p_product, 'description', 1000);
  v_unit  := public._ob_text(p_product, 'unit', 40);
  v_avail := public._ob_text(p_product, 'availability', 40);
  v_moq   := public._ob_num(p_product, 'moq');
  v_price := public._ob_num(p_product, 'price');

  if char_length(v_name) < 2 then raise exception 'invalid_name' using errcode = '22023'; end if;
  if v_cat not in ('Raw Materials', 'Industrial Machinery', 'Electrical Equipment', 'Packaging Materials', 'Chemicals',
                   'Construction Materials', 'Electronics', 'Office Supplies', 'Logistics & Transport', 'Professional Services',
                   'Agriculture', 'Food & Beverage', 'Healthcare', 'Other')
  then raise exception 'invalid_category' using errcode = '22023'; end if;
  if v_avail not in ('Available', 'Made to order', 'Temporarily unavailable') then raise exception 'invalid_availability' using errcode = '22023'; end if;
  if v_price is not null and v_price > 99999999999 then raise exception 'invalid_price' using errcode = '22023'; end if;
  if v_moq   is not null and v_moq   > 99999999999 then raise exception 'invalid_moq'   using errcode = '22023'; end if;

  -- the id must be a real uuid text, nothing else
  if p_product ? 'id' and jsonb_typeof(p_product -> 'id') = 'string' and (p_product ->> 'id') ~ '^[0-9a-fA-F-]{36}$' then
    v_id := (p_product ->> 'id')::uuid;
  elsif p_product ? 'id' and jsonb_typeof(p_product -> 'id') not in ('null') then
    raise exception 'not_found';
  end if;

  select b.currency into v_cur from public.businesses b where b.id = p_org;

  -- one writer at a time per company, so the limit and the duplicate check below cannot be raced
  perform pg_advisory_xact_lock(hashtextextended(p_org::text, 10));

  if exists (select 1 from public.supplier_products x
              where x.org_id = p_org and lower(x.name) = lower(v_name) and (v_id is null or x.id <> v_id))
  then raise exception 'duplicate_name'; end if;

  if v_id is null then
    if (select count(*) from public.supplier_products where org_id = p_org) >= 200 then raise exception 'too_many_products'; end if;
    insert into public.supplier_products (org_id, name, category, description, unit, moq, price, currency, availability, sort_order)
      values (p_org, v_name, v_cat, v_desc, v_unit, v_moq, v_price, coalesce(v_cur, 'INR'), v_avail,
              coalesce((select max(sort_order) + 1 from public.supplier_products where org_id = p_org), 0))
      returning id into v_id;
    v_new := true;
  else
    update public.supplier_products
       set name = v_name, category = v_cat, description = v_desc, unit = v_unit, moq = v_moq, price = v_price,
           currency = coalesce(v_cur, currency), availability = v_avail
     where id = v_id and org_id = p_org;
    if not found then raise exception 'not_found'; end if;
  end if;

  perform public._audit(p_org, case when v_new then 'product.added' else 'product.updated' end, 'supplier_product', v_id, '{}'::jsonb);
  return jsonb_build_object('id', v_id, 'created', v_new);
end $$;

create or replace function public.delete_supplier_product(p_org uuid, p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public._product_guard(p_org);
  perform pg_advisory_xact_lock(hashtextextended(p_org::text, 10));
  delete from public.supplier_products where id = p_id and org_id = p_org;
  if not found then raise exception 'not_found'; end if;
  perform public._audit(p_org, 'product.removed', 'supplier_product', p_id, '{}'::jsonb);
end $$;

do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('_product_guard', 'save_supplier_product', 'delete_supplier_product')
  loop execute format('revoke all on function %s from public, anon, authenticated', f.sig); end loop;
end $$;
grant execute on function public.save_supplier_product(uuid, jsonb) to authenticated;
grant execute on function public.delete_supplier_product(uuid, uuid) to authenticated;
-- _product_guard is only called from inside the two functions above (security definer), so it needs no grant.

notify pgrst, 'reload schema';
