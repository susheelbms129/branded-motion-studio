-- Vendora supplier directory (migration 7). Run AFTER migrations 1-6. Safe to run twice.
--
-- What buyers get: ONE function, list_suppliers(), that returns a page of suppliers with their Trust Passport summary.
--
-- Safety
--   * Only signed-in members of a BUYER company (and reviewers) may call it. Suppliers cannot browse their competitors.
--   * It returns public facts only: name, city/state, categories, a short description, and the passport level.
--     Contact details, bank, address, documents and proofs' private fields never leave. No new table is readable.
--   * The passport summary comes from get_trust_passport(), so an expired proof never counts, here or anywhere else.
--   * Search text is treated as plain text (wildcards escaped); page size is capped at 50.
--   * Only suppliers that finished onboarding appear (they have a supplier_profiles row).

create or replace function public._is_buyer()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m join public.businesses b on b.id = m.org_id
     where m.user_id = (select auth.uid()) and m.status = 'active' and b.kind = 'buyer')
$$;

create or replace function public.list_suppliers(
  p_search text default '', p_state text default '', p_category text default '',
  p_verified_only boolean default false, p_limit int default 24, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_q text := left(btrim(coalesce(p_search, '')), 80);
  v_like text;
  v_state text := lower(btrim(coalesce(p_state, '')));
  v_cat text := lower(btrim(coalesce(p_category, '')));
  v_limit int := least(greatest(coalesce(p_limit, 24), 1), 50);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_total int; v_items jsonb; v_states jsonb; v_cats jsonb;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated'; end if;
  if not (public._is_buyer() or public.is_platform_admin()) then raise exception 'not_allowed'; end if;
  -- the search is plain text: escape LIKE wildcards
  v_like := '%' || replace(replace(replace(lower(v_q), '\', '\\'), '%', '\%'), '_', '\_') || '%';

  with base as (
    select b.id, b.name, b.city, b.state, p.categories, left(p.description, 200) as description,
           public.get_trust_passport(b.id) as pp
      from public.businesses b join public.supplier_profiles p on p.org_id = b.id
     where b.kind = 'supplier'
  ), shaped as (
    select id, name, city, state, categories, description,
           (pp ->> 'level')::int as level, pp ->> 'level_name' as level_name, pp ->> 'valid_through' as valid_through,
           jsonb_array_length(pp -> 'checks') as proofs,
           exists (select 1 from jsonb_array_elements(pp -> 'checks') c
                    where c ->> 'type' = 'registration' and c ->> 'evidence' = 'government_record') as government_checked
      from base
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
         coalesce((select jsonb_agg(to_jsonb(x) order by x.level desc, x.name, x.org_id)
                     from (select id as org_id, name, city, state, categories, description, level, level_name, valid_through, proofs, government_checked
                             from filtered order by level desc, name, id limit v_limit offset v_offset) x), '[]'::jsonb),
         coalesce((select jsonb_agg(distinct state order by state) from shaped where state <> ''), '[]'::jsonb),
         coalesce((select jsonb_agg(distinct c order by c) from shaped, unnest(categories) c), '[]'::jsonb)
    into v_total, v_items, v_states, v_cats;

  return jsonb_build_object('total', v_total, 'items', v_items, 'states', v_states, 'categories', v_cats);
end $$;

do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('_is_buyer', 'list_suppliers')
  loop execute format('revoke all on function %s from public, anon, authenticated', f.sig); end loop;
end $$;
grant execute on function public.list_suppliers(text, text, text, boolean, int, int) to authenticated;
-- _is_buyer is only called from inside list_suppliers (security definer), so it needs no grant.

notify pgrst, 'reload schema';
