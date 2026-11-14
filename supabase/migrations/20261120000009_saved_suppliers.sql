-- Vendora saved suppliers (migration 9). Run AFTER migrations 1-8. Safe to run twice.
--
-- What buyers get: a shortlist. A buyer company saves suppliers it finds in the directory and sees them again under
-- "Saved suppliers". The whole buying team shares one list per company.
--
-- Safety (no data leaks is the first rule)
--   * The table is NOT readable or writable from the browser at all (RLS on, every grant revoked, no policy). Everything goes
--     through four functions that check, on the server, who is asking.
--   * Every function takes the buyer company id and proves that the caller is an ACTIVE member of that BUYER company.
--     Anything else (a stranger, a supplier, another company's member, a made-up id) gets the same answer: not_allowed.
--     So nobody can read another company's list, and nobody can learn whether a company exists.
--   * Saving or removing needs the owner or procurement-manager role (the same people who manage suppliers in the app).
--     Other team members can see the list, not change it.
--   * Only suppliers that finished onboarding can be saved. A buyer company, a made-up id and an unfinished supplier all
--     give the same answer: not_found.
--   * Suppliers can never see who saved them, and there is no function that tells them. The list returns the same public facts
--     as the directory (migration 7), through get_trust_passport(), so an expired proof stops counting here too.
--   * Size is bounded: at most 500 saved suppliers per company, pages of up to 50.
--   * Every save and every removal is written to the audit log (ids only, no names).

create table if not exists public.saved_suppliers (
  buyer_org    uuid not null references public.businesses(id) on delete cascade,
  supplier_org uuid not null references public.businesses(id) on delete cascade,
  saved_by     uuid references auth.users(id) on delete set null,
  saved_at     timestamptz not null default now(),
  primary key (buyer_org, supplier_org),
  check (buyer_org <> supplier_org)
);
create index if not exists saved_suppliers_supplier_idx on public.saved_suppliers (supplier_org);

alter table public.saved_suppliers enable row level security;
revoke all on public.saved_suppliers from public, anon, authenticated;
-- (no policies on purpose: with RLS on and no policy, the browser can do nothing with this table)

-- One place that decides who may touch a company's shortlist.
create or replace function public._saved_guard(p_org uuid, p_write boolean)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated'; end if;
  if p_org is null or not exists (
       select 1 from public.memberships m join public.businesses b on b.id = m.org_id
        where m.org_id = p_org and m.user_id = (select auth.uid()) and m.status = 'active' and b.kind = 'buyer'
          and (not p_write or m.role in ('owner', 'procurement_manager')))
  then raise exception 'not_allowed'; end if;
end $$;

create or replace function public.save_supplier(p_buyer_org uuid, p_supplier uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_new boolean; v_total int;
begin
  perform public._saved_guard(p_buyer_org, true);
  if p_supplier is null or not exists (
       select 1 from public.businesses b join public.supplier_profiles p on p.org_id = b.id
        where b.id = p_supplier and b.kind = 'supplier')
  then raise exception 'not_found'; end if;
  -- one writer at a time per company, so the limit below cannot be raced
  perform pg_advisory_xact_lock(hashtextextended(p_buyer_org::text, 9));
  if not exists (select 1 from public.saved_suppliers where buyer_org = p_buyer_org and supplier_org = p_supplier)
     and (select count(*) from public.saved_suppliers where buyer_org = p_buyer_org) >= 500
  then raise exception 'too_many_saved'; end if;
  insert into public.saved_suppliers (buyer_org, supplier_org, saved_by)
    values (p_buyer_org, p_supplier, (select auth.uid()))
    on conflict do nothing;
  get diagnostics v_new = row_count;
  if v_new then perform public._audit(p_buyer_org, 'supplier_saved', 'supplier', p_supplier, '{}'::jsonb); end if;
  select count(*) into v_total from public.saved_suppliers where buyer_org = p_buyer_org;
  return jsonb_build_object('saved', true, 'total', v_total);
end $$;

create or replace function public.unsave_supplier(p_buyer_org uuid, p_supplier uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_gone boolean; v_total int;
begin
  perform public._saved_guard(p_buyer_org, true);
  delete from public.saved_suppliers where buyer_org = p_buyer_org and supplier_org = p_supplier;
  get diagnostics v_gone = row_count;
  if v_gone then perform public._audit(p_buyer_org, 'supplier_unsaved', 'supplier', p_supplier, '{}'::jsonb); end if;
  select count(*) into v_total from public.saved_suppliers where buyer_org = p_buyer_org;
  return jsonb_build_object('saved', false, 'total', v_total);
end $$;

-- Which suppliers are saved: just ids, so the directory can show "Saved" on its cards.
create or replace function public.saved_supplier_ids(p_buyer_org uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._saved_guard(p_buyer_org, false);
  return coalesce((select jsonb_agg(s.supplier_org order by s.saved_at desc)
                     from public.saved_suppliers s join public.supplier_profiles p on p.org_id = s.supplier_org
                    where s.buyer_org = p_buyer_org), '[]'::jsonb);
end $$;

-- The shortlist itself, shaped exactly like a directory card, newest first.
create or replace function public.list_saved_suppliers(p_buyer_org uuid, p_limit int default 24, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 24), 1), 50);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_total int; v_items jsonb;
begin
  perform public._saved_guard(p_buyer_org, false);
  select count(*) into v_total
    from public.saved_suppliers s join public.supplier_profiles p on p.org_id = s.supplier_org
   where s.buyer_org = p_buyer_org;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.saved_at desc, x.name, x.org_id), '[]'::jsonb) into v_items
    from (
      select b.id as org_id, b.name, b.city, b.state, p.categories, left(p.description, 200) as description,
             (t.pp ->> 'level')::int as level, t.pp ->> 'level_name' as level_name, t.pp ->> 'valid_through' as valid_through,
             jsonb_array_length(t.pp -> 'checks') as proofs,
             exists (select 1 from jsonb_array_elements(t.pp -> 'checks') c
                      where c ->> 'type' = 'registration' and c ->> 'evidence' = 'government_record') as government_checked,
             s.saved_at
        from public.saved_suppliers s
        join public.businesses b on b.id = s.supplier_org and b.kind = 'supplier'
        join public.supplier_profiles p on p.org_id = b.id
        cross join lateral (select public.get_trust_passport(b.id) as pp) t
       where s.buyer_org = p_buyer_org
       order by s.saved_at desc, b.name, b.id
       limit v_limit offset v_offset) x;
  return jsonb_build_object('total', v_total, 'items', v_items);
end $$;

do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('_saved_guard', 'save_supplier', 'unsave_supplier', 'saved_supplier_ids', 'list_saved_suppliers')
  loop execute format('revoke all on function %s from public, anon, authenticated', f.sig); end loop;
end $$;
grant execute on function public.save_supplier(uuid, uuid) to authenticated;
grant execute on function public.unsave_supplier(uuid, uuid) to authenticated;
grant execute on function public.saved_supplier_ids(uuid) to authenticated;
grant execute on function public.list_saved_suppliers(uuid, int, int) to authenticated;
-- _saved_guard is only called from inside the functions above (security definer), so it needs no grant.

notify pgrst, 'reload schema';
