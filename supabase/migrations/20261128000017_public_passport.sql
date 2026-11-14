-- Vendora shareable Trust Passport (migration 17). Run AFTER migrations 1-16. Safe to run twice.
--
-- What suppliers get: a public page https://<site>/verified/<company-slug> and a small badge image they can put on their
-- website, quotation, email signature or WhatsApp status. Anyone can open it WITHOUT signing in and see what Vendora has
-- verified, how it was checked (government record or reviewed document), and until when. Verification is free; so is sharing.
--
-- What makes it trustworthy
--   * The page is LIVE. It reads the same passport buyers see, so an expired proof disappears from it by itself. A supplier
--     cannot paste an old screenshot of "Verified": the link always tells today's truth, with today's date.
--   * Sharing is OPT-IN. Nothing is public until the owner of the supplier company switches it on, and it can be switched
--     off at any time. Only a supplier with at least one verified proof can switch it on.
--
-- Safety
--   * The public function returns only what buyers already see: name, place, company facts, description, logo, categories
--     and the passport. NEVER: contact name, email, phone, website, bank, street address, documents, products, ids of
--     people. A company that is not shared, not a supplier, has not finished onboarding, or does not exist all get the same
--     answer (not_found), so nobody can probe which companies exist.
--   * Only the OWNER of the supplier company can switch sharing on or off; any active member can read the setting.
--   * The passport inside the public page is built by the same maths as get_trust_passport (a test compares them).
--   * Switching on or off is written to the audit log (ids only).

-- 1. the switch (off for everyone until their owner turns it on)
alter table public.supplier_profiles add column if not exists passport_public boolean not null default false;

-- 2. the passport itself, without the sign-in check (internal; not callable from the browser)
create or replace function public._passport_core(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_level int; v_checks jsonb;
begin
  v_level := public._trust_level(p_org);
  select coalesce(jsonb_agg(jsonb_build_object(
      'type', c.type, 'label', case when c.type = 'certificate' then c.label else '' end,
      'reference', case when c.type in ('registration', 'certificate') then c.reference else '' end,
      'issuer', case when c.type = 'certificate' then c.issuer else '' end,
      'verified_on', c.reviewed_at::date, 'expires_at', c.expires_at,
      'evidence', case when gov then 'government_record' else 'document_reviewed' end,
      'record_checked_on', case when gov then (c.lookup ->> 'fetched_at')::timestamptz::date end)
    order by case c.type when 'registration' then 1 when 'address' then 2 when 'bank' then 3 else 4 end, c.label), '[]'::jsonb)
    into v_checks
    from (select k.*, (k.type = 'registration' and k.lookup ->> 'outcome' = 'ok' and lower(coalesce(k.lookup ->> 'gst_status', '')) = 'active'
                       and k.lookup ->> 'name_match' in ('match', 'partial')) as gov
            from public.verification_checks k
           where k.org_id = p_org and k.status = 'verified' and (k.expires_at is null or k.expires_at >= current_date)) c;
  return jsonb_build_object('level', v_level,
    'level_name', case v_level when 3 then 'Verified + Certificates' when 2 then 'Verified' when 1 then 'Registered' else 'Not verified' end,
    'valid_through', (select min(c.expires_at) from public.verification_checks c
                       where c.org_id = p_org and c.status = 'verified' and c.expires_at >= current_date),
    'checks', v_checks);
end $$;

-- 3. public: anyone, signed in or not
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
           'passport', public._passport_core(b.id))
    into v_out
    from public.businesses b join public.supplier_profiles p on p.org_id = b.id
   where b.slug = v_slug and b.kind = 'supplier' and p.passport_public;
  if v_out is null then raise exception 'not_found'; end if;
  return v_out;
end $$;

-- 4. the supplier's own control
create or replace function public.get_passport_sharing(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_role text;
begin
  v_role := public._quote_guard(p_org);
  return (select jsonb_build_object('enabled', p.passport_public, 'slug', b.slug, 'level', public._trust_level(p_org),
                                    'can_change', v_role = 'owner')
            from public.businesses b join public.supplier_profiles p on p.org_id = b.id
           where b.id = p_org and b.kind = 'supplier');
end $$;

create or replace function public.set_passport_sharing(p_org uuid, p_enabled boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_role text; v_slug text;
begin
  v_role := public._quote_guard(p_org);
  if v_role <> 'owner' then raise exception 'not_allowed'; end if;
  if p_enabled is null then raise exception 'invalid_request'; end if;
  select b.slug into v_slug from public.businesses b join public.supplier_profiles p on p.org_id = b.id
   where b.id = p_org and b.kind = 'supplier' for update of p;
  if v_slug is null then raise exception 'not_found'; end if;
  if p_enabled and public._trust_level(p_org) < 1 then raise exception 'not_verified'; end if;
  update public.supplier_profiles set passport_public = p_enabled where org_id = p_org;
  perform public._audit(p_org, case when p_enabled then 'passport_shared' else 'passport_unshared' end, 'supplier_profile', null, '{}'::jsonb);
  return jsonb_build_object('enabled', p_enabled, 'slug', v_slug);
end $$;

-- 5. who may call what
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('_passport_core', 'get_public_passport', 'get_passport_sharing', 'set_passport_sharing')
  loop execute format('revoke all on function %s from public, anon, authenticated', f.sig); end loop;
end $$;
grant execute on function public.get_public_passport(text) to anon, authenticated;
grant execute on function public.get_passport_sharing(uuid) to authenticated;
grant execute on function public.set_passport_sharing(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
