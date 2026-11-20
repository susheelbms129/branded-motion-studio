-- Migration 23 — Company profile + public storefront. Run AFTER migrations 1-22. Safe to run twice.
--
-- WHAT SUPPLIERS GET
--   * A "Company profile" page where the owner or a procurement manager edits what buyers see: a one-line headline, the full
--     "about", logo, categories, contact person, delivery terms and service areas. (Until now these could only be set once, during onboarding.)
--   * A public STOREFRONT: https://<site>/s/<company-slug>. Anyone, signed in or not, can open it, and Google can find it: it is
--     listed in the site's sitemap, carries structured data, and has a real preview image for WhatsApp and Google.
--
-- WHAT MAKES IT DIFFERENT
--   * It is a LIVE proof page, not a brochure. The storefront shows the Trust Passport as of TODAY and the earned Scorecard (migration 21,
--     with its honesty rules). If a proof expires the storefront disappears from Google by itself (it is removed from the sitemap and
--     answers "not found"): nobody can keep an old "Verified" listing alive.
--   * No thin or spam pages in Google: to publish, a company must be verified today, have an "about" of at least 100 characters
--     and at least one category. The same check runs every time the page is read, not only when the switch is flipped.
--   * Prices are hidden by default (many B2B suppliers do not want a public price list). The owner can show them.
--   * Suppliers see how their storefront performs: visits and "Request a quote" clicks for the last 30 days. Counters only;
--     no visitor is identified, no IP address or browser detail is stored.
--
-- SAFETY
--   * Publishing is OPT-IN and only the OWNER can switch it on or off. Any active member can read the settings.
--   * The public functions return only what buyers already see: name, place, company facts, headline, about, categories, up to 20
--     products, delivery terms, service areas, the passport and the scorecard. NEVER: contact name, email, phone, website, bank, street address,
--     documents, ids of people or companies. A company that is not published, not verified today, not a supplier or does not exist
--     all get the same answer (not_found), so nobody can probe which companies exist.
--   * Photos are not placed inside the page data. They are served by their own address (logo and one photo per product), and only
--     for a published storefront, so Google and WhatsApp can fetch them.
--   * Every input is checked on the server (lengths, allowed values, image type and size). The logo is limited to 100,000 characters
--     so it always fits the public limit.
--   * One writer at a time per company. Every save and every switch is written to the audit log (ids only).
--   * Visit counters are anonymous, one row per company per day, and capped, so they cannot grow without bound.

-- ───────────── 1. storage ─────────────
alter table public.supplier_profiles add column if not exists tagline text not null default '' check (char_length(tagline) <= 120);
alter table public.supplier_profiles add column if not exists storefront_public boolean not null default false;
alter table public.supplier_profiles add column if not exists storefront_show_prices boolean not null default false;
alter table public.supplier_profiles add column if not exists storefront_published_at timestamptz;

create table if not exists public.storefront_stats (
  org_id      uuid not null references public.businesses(id) on delete cascade,
  day         date not null,
  views       int  not null default 0 check (views between 0 and 1000000),
  quote_clicks int not null default 0 check (quote_clicks between 0 and 1000000),
  primary key (org_id, day)
);
alter table public.storefront_stats enable row level security;
revoke all on public.storefront_stats from anon, authenticated;

-- ───────────── 2. rules and helpers (not callable from the browser) ─────────────
-- What must be true for a storefront to be public: verified today, an "about" of at least 100 characters, at least one category.
create or replace function public._storefront_ready(p_org uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  with f as (
    select public._trust_level(p_org) >= 1 as verified,
           coalesce((select char_length(btrim(p.description)) >= 100 from public.supplier_profiles p where p.org_id = p_org), false) as about,
           coalesce((select cardinality(p.categories) >= 1 from public.supplier_profiles p where p.org_id = p_org), false) as cats)
  select jsonb_build_object(
    'required_ok', f.verified and f.about and f.cats,
    'missing', to_jsonb(array_remove(array[case when not f.verified then 'verified' end, case when not f.about then 'about' end,
                                           case when not f.cats then 'categories' end], null)))
    from f
$$;

-- The company behind a PUBLIC storefront (null when it is not published, not verified today, not a supplier or does not exist).
create or replace function public._storefront_org(p_slug text)
returns uuid language sql stable security definer set search_path = '' as $$
  select b.id from public.businesses b join public.supplier_profiles p on p.org_id = b.id
   where b.slug = lower(btrim(coalesce(p_slug, ''))) and b.kind = 'supplier' and p.storefront_public
     and (public._storefront_ready(b.id) ->> 'required_ok')::boolean
$$;

-- ───────────── 3. the supplier's own side ─────────────
create or replace function public.get_company_profile(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_role text; v_out jsonb;
begin
  v_role := public._quote_guard(p_org);
  select jsonb_build_object(
      'name', b.name, 'slug', b.slug, 'city', b.city, 'state', b.state, 'country', b.country, 'business_type', b.business_type,
      'year_established', b.year_established, 'role', v_role, 'can_edit', v_role in ('owner', 'procurement_manager'), 'can_publish', v_role = 'owner',
      'profile', jsonb_build_object('tagline', p.tagline, 'description', p.description, 'logo', p.logo, 'categories', to_jsonb(p.categories),
         'contact_name', p.contact_name, 'designation', p.designation, 'email', p.email, 'phone_code', p.phone_code, 'phone', p.phone, 'alt_phone', p.alt_phone),
      'capabilities', (select jsonb_build_object('coverage', to_jsonb(c.coverage), 'delivery_time', c.delivery_time, 'min_order_value', c.min_order_value,
                          'currency', c.currency, 'delivery_options', to_jsonb(c.delivery_options), 'pickup', c.pickup)
                         from public.supplier_capabilities c where c.org_id = p_org),
      'locations', (select coalesce(jsonb_agg(jsonb_build_object('country', l.country, 'state', l.state, 'city', l.city) order by l.country, l.state, l.city), '[]'::jsonb)
                      from public.supplier_locations l where l.org_id = p_org),
      'storefront', jsonb_build_object(
         'enabled', p.storefront_public, 'show_prices', p.storefront_show_prices, 'published_at', p.storefront_published_at,
         'level', public._trust_level(p_org), 'ready', public._storefront_ready(p_org),
         'live', p.storefront_public and (public._storefront_ready(p_org) ->> 'required_ok')::boolean,
         'views_30', (select coalesce(sum(s.views), 0) from public.storefront_stats s where s.org_id = p_org and s.day > current_date - 30),
         'quote_clicks_30', (select coalesce(sum(s.quote_clicks), 0) from public.storefront_stats s where s.org_id = p_org and s.day > current_date - 30),
         'series', (select jsonb_agg(jsonb_build_object('day', d::date, 'views', coalesce(s.views, 0), 'quote_clicks', coalesce(s.quote_clicks, 0)) order by d)
                      from generate_series(current_date - 13, current_date, interval '1 day') d
                      left join public.storefront_stats s on s.org_id = p_org and s.day = d::date)))
    into v_out
    from public.businesses b join public.supplier_profiles p on p.org_id = b.id
   where b.id = p_org and b.kind = 'supplier';
  if v_out is null then raise exception 'not_found'; end if;
  return v_out;
end $$;

-- p_data: any of { tagline, description, categories, logo (image or null), contactName, designation, email, phoneCode, phone, altPhone,
--                  coverage, deliveryTime, minOrderValue, deliveryOptions, pickup, locations: [{ country, state, city }] }
-- A key that is not sent is left as it is. A key that is sent is checked and saved.
create or replace function public.save_company_profile(p_org uuid, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_role text; v_t text; v_cats text[]; v_cov text[]; v_opts text[]; v_logo jsonb; v_min jsonb; v_locs jsonb; e jsonb; v_c text; v_s text; v_ci text;
begin
  v_role := public._quote_guard(p_org);
  if v_role not in ('owner', 'procurement_manager') then raise exception 'not_allowed'; end if;
  if not exists (select 1 from public.supplier_profiles where org_id = p_org) then raise exception 'not_found'; end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then raise exception 'invalid_request'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_org::text, 23));

  -- 1. check everything first, so a bad field saves nothing
  if p_data ? 'tagline' then perform public._ob_text(p_data, 'tagline', 120); end if;
  if p_data ? 'description' then
    v_t := public._ob_text(p_data, 'description', 2000);
    if char_length(v_t) < 50 then raise exception 'invalid_description'; end if;
  end if;
  if p_data ? 'categories' then
    v_cats := public._ob_list(p_data, 'categories', 20, 60);
    if cardinality(v_cats) = 0 then raise exception 'invalid_categories'; end if;
  end if;
  if p_data ? 'logo' then
    v_logo := p_data -> 'logo';
    if jsonb_typeof(v_logo) <> 'null' and (jsonb_typeof(v_logo) <> 'string' or not public._ob_is_image(v_logo #>> '{}', 100000)) then raise exception 'invalid_logo'; end if;
  end if;
  if p_data ? 'contactName' then
    v_t := public._ob_text(p_data, 'contactName', 120);
    if char_length(v_t) < 2 then raise exception 'invalid_contactName'; end if;
  end if;
  if p_data ? 'designation' then perform public._ob_text(p_data, 'designation', 80); end if;
  if p_data ? 'email' then
    v_t := lower(public._ob_text(p_data, 'email', 254));
    if v_t !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'invalid_email'; end if;
  end if;
  if p_data ? 'phoneCode' then
    v_t := public._ob_text(p_data, 'phoneCode', 6);
    if v_t !~ '^\+[0-9]{1,4}$' then raise exception 'invalid_phoneCode'; end if;
  end if;
  if p_data ? 'phone' then
    v_t := public._ob_text(p_data, 'phone', 20);
    if char_length(regexp_replace(v_t, '[^0-9]', '', 'g')) < 7 then raise exception 'invalid_phone'; end if;
  end if;
  if p_data ? 'altPhone' then perform public._ob_text(p_data, 'altPhone', 20); end if;
  if p_data ? 'coverage' then
    v_cov := public._ob_list(p_data, 'coverage', 4, 40);
    if cardinality(v_cov) = 0 or exists (select 1 from unnest(v_cov) x where x not in ('Within my city', 'Within my state', 'Across India', 'Internationally'))
      then raise exception 'invalid_coverage'; end if;
  end if;
  if p_data ? 'deliveryTime' then perform public._ob_text(p_data, 'deliveryTime', 40); end if;
  if p_data ? 'minOrderValue' then
    v_min := p_data -> 'minOrderValue';
    if jsonb_typeof(v_min) not in ('null', 'number') then raise exception 'invalid_minOrderValue'; end if;
    if jsonb_typeof(v_min) = 'number' and ((v_min #>> '{}')::numeric < 0 or (v_min #>> '{}')::numeric > 100000000000) then raise exception 'invalid_minOrderValue'; end if;
  end if;
  if p_data ? 'deliveryOptions' then v_opts := public._ob_list(p_data, 'deliveryOptions', 6, 60); end if;
  if p_data ? 'pickup' then
    v_t := public._ob_text(p_data, 'pickup', 3);
    if v_t not in ('', 'Yes', 'No') then raise exception 'invalid_pickup'; end if;
  end if;
  if p_data ? 'locations' then
    v_locs := p_data -> 'locations';
    if jsonb_typeof(v_locs) = 'null' then v_locs := '[]'::jsonb; end if;
    if jsonb_typeof(v_locs) <> 'array' or jsonb_array_length(v_locs) > 100 then raise exception 'invalid_locations'; end if;
    for e in select value from jsonb_array_elements(v_locs) loop
      if jsonb_typeof(e) <> 'object' then raise exception 'invalid_locations'; end if;
      v_c := public._ob_text(e, 'country', 80); v_s := public._ob_text(e, 'state', 80); v_ci := public._ob_text(e, 'city', 80);
      if v_c = '' then raise exception 'invalid_locations'; end if;
    end loop;
  end if;

  -- 2. save
  if p_data ? 'tagline' then update public.supplier_profiles set tagline = public._ob_text(p_data, 'tagline', 120) where org_id = p_org; end if;
  if p_data ? 'description' then update public.supplier_profiles set description = public._ob_text(p_data, 'description', 2000) where org_id = p_org; end if;
  if v_cats is not null then update public.supplier_profiles set categories = v_cats where org_id = p_org; end if;
  if p_data ? 'logo' then update public.supplier_profiles set logo = case when jsonb_typeof(v_logo) = 'null' then null else v_logo #>> '{}' end where org_id = p_org; end if;
  if p_data ? 'contactName' then update public.supplier_profiles set contact_name = public._ob_text(p_data, 'contactName', 120) where org_id = p_org; end if;
  if p_data ? 'designation' then update public.supplier_profiles set designation = public._ob_text(p_data, 'designation', 80) where org_id = p_org; end if;
  if p_data ? 'email' then update public.supplier_profiles set email = lower(public._ob_text(p_data, 'email', 254)) where org_id = p_org; end if;
  if p_data ? 'phoneCode' then update public.supplier_profiles set phone_code = public._ob_text(p_data, 'phoneCode', 6) where org_id = p_org; end if;
  if p_data ? 'phone' then update public.supplier_profiles set phone = public._ob_text(p_data, 'phone', 20) where org_id = p_org; end if;
  if p_data ? 'altPhone' then update public.supplier_profiles set alt_phone = public._ob_text(p_data, 'altPhone', 20) where org_id = p_org; end if;
  update public.supplier_profiles set updated_at = now() where org_id = p_org;

  if p_data ?| array['coverage', 'deliveryTime', 'minOrderValue', 'deliveryOptions', 'pickup'] then
    insert into public.supplier_capabilities (org_id) values (p_org) on conflict (org_id) do nothing;
    if v_cov is not null then update public.supplier_capabilities set coverage = v_cov where org_id = p_org; end if;
    if p_data ? 'deliveryTime' then update public.supplier_capabilities set delivery_time = public._ob_text(p_data, 'deliveryTime', 40) where org_id = p_org; end if;
    if p_data ? 'minOrderValue' then update public.supplier_capabilities set min_order_value = case when jsonb_typeof(v_min) = 'null' then null else (v_min #>> '{}')::numeric end where org_id = p_org; end if;
    if v_opts is not null then update public.supplier_capabilities set delivery_options = v_opts where org_id = p_org; end if;
    if p_data ? 'pickup' then update public.supplier_capabilities set pickup = public._ob_text(p_data, 'pickup', 3) where org_id = p_org; end if;
    update public.supplier_capabilities set updated_at = now() where org_id = p_org;
  end if;
  if v_locs is not null then
    delete from public.supplier_locations where org_id = p_org;
    insert into public.supplier_locations (org_id, country, state, city)
      select distinct p_org, btrim(x ->> 'country'), btrim(coalesce(x ->> 'state', '')), btrim(coalesce(x ->> 'city', ''))
        from jsonb_array_elements(v_locs) x;
  end if;
  perform public._audit(p_org, 'company_profile_saved', 'supplier_profile', p_org, '{}'::jsonb);
  return jsonb_build_object('saved', true);
end $$;

-- Publish or hide the storefront. Only the owner. Publishing needs the three requirements; hiding never does.
create or replace function public.set_storefront(p_org uuid, p_enabled boolean, p_show_prices boolean default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_role text; v_ready jsonb;
begin
  v_role := public._quote_guard(p_org);
  if v_role <> 'owner' then raise exception 'not_allowed'; end if;
  if p_enabled is null then raise exception 'invalid_request'; end if;
  if not exists (select 1 from public.supplier_profiles where org_id = p_org) then raise exception 'not_found'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_org::text, 23));
  v_ready := public._storefront_ready(p_org);
  if p_enabled and not (v_ready ->> 'required_ok')::boolean then raise exception 'not_ready'; end if;
  update public.supplier_profiles
     set storefront_public = p_enabled,
         storefront_show_prices = coalesce(p_show_prices, storefront_show_prices),
         storefront_published_at = case when p_enabled and storefront_published_at is null then now() else storefront_published_at end,
         updated_at = now()
   where org_id = p_org;
  perform public._audit(p_org, case when p_enabled then 'storefront_published' else 'storefront_hidden' end, 'supplier_profile', p_org,
                        jsonb_build_object('show_prices', coalesce(p_show_prices, (select storefront_show_prices from public.supplier_profiles where org_id = p_org))));
  return jsonb_build_object('enabled', p_enabled, 'ready', v_ready);
end $$;

-- ───────────── 4. the public side: anyone, signed in or not ─────────────
create or replace function public.get_public_storefront(p_slug text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_slug text := lower(btrim(coalesce(p_slug, ''))); v_org uuid; v_out jsonb;
begin
  if v_slug !~ '^[a-z0-9-]{2,60}$' then raise exception 'not_found'; end if;
  v_org := public._storefront_org(v_slug);
  if v_org is null then raise exception 'not_found'; end if;
  select jsonb_build_object(
      'slug', b.slug, 'name', b.name, 'city', b.city, 'state', b.state, 'country', b.country, 'business_type', b.business_type,
      'year_established', b.year_established, 'tagline', p.tagline, 'description', p.description,
      'has_logo', p.logo is not null and char_length(p.logo) <= 100000,
      'categories', to_jsonb(p.categories), 'show_prices', p.storefront_show_prices,
      'products', (select coalesce(jsonb_agg(jsonb_build_object(
                      'id', x.id, 'name', x.name, 'category', x.category, 'description', x.description, 'unit', x.unit, 'moq', x.moq,
                      'price', case when p.storefront_show_prices then x.price end, 'currency', x.currency, 'availability', x.availability,
                      'has_photo', cardinality(x.images) > 0) order by x.sort_order, x.created_at, x.id), '[]'::jsonb)
                     from (select * from public.supplier_products pr where pr.org_id = v_org order by pr.sort_order, pr.created_at, pr.id limit 20) x),
      'product_count', (select count(*) from public.supplier_products pr where pr.org_id = v_org),
      'delivery', (select jsonb_build_object('coverage', to_jsonb(c.coverage), 'delivery_time', c.delivery_time, 'min_order_value', c.min_order_value,
                            'currency', c.currency, 'delivery_options', to_jsonb(c.delivery_options), 'pickup', c.pickup)
                     from public.supplier_capabilities c where c.org_id = v_org),
      'service_areas', (select coalesce(jsonb_agg(jsonb_build_object('country', l.country, 'state', l.state, 'city', l.city) order by l.country, l.state, l.city), '[]'::jsonb)
                          from (select * from public.supplier_locations sl where sl.org_id = v_org order by sl.country, sl.state, sl.city limit 30) l),
      'as_of', current_date, 'updated_at', p.updated_at,
      'passport', public._passport_core(v_org), 'scorecard', public._scorecard_core(v_org, false))
    into v_out
    from public.businesses b join public.supplier_profiles p on p.org_id = b.id where b.id = v_org;
  return v_out;
end $$;

-- The photo behind a storefront address: kind 'logo' or 'product' (with the product id). Returns the image as a data address, or not_found.
create or replace function public.get_public_storefront_image(p_slug text, p_kind text, p_id uuid default null)
returns text language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid; v_img text;
begin
  v_org := public._storefront_org(p_slug);
  if v_org is null then raise exception 'not_found'; end if;
  if p_kind = 'logo' then
    select p.logo into v_img from public.supplier_profiles p where p.org_id = v_org;
  elsif p_kind = 'product' and p_id is not null then
    select pr.images[1] into v_img from public.supplier_products pr where pr.id = p_id and pr.org_id = v_org;
  else
    raise exception 'not_found';
  end if;
  if v_img is null or not public._ob_is_image(v_img, 250000) then raise exception 'not_found'; end if;
  return v_img;
end $$;

-- For the sitemap: every storefront that is public today, newest change first.
create or replace function public.list_public_storefronts(p_limit int default 1000, p_offset int default 0)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('slug', t.slug, 'updated_at', t.updated_at) order by t.updated_at desc, t.slug), '[]'::jsonb)
    from (select b.slug, p.updated_at
            from public.businesses b join public.supplier_profiles p on p.org_id = b.id
           where b.kind = 'supplier' and p.storefront_public and (public._storefront_ready(b.id) ->> 'required_ok')::boolean
           order by p.updated_at desc, b.slug
           limit least(greatest(coalesce(p_limit, 1000), 1), 5000) offset greatest(coalesce(p_offset, 0), 0)) t
$$;

-- Anonymous counters: kind 'view' or 'quote_click'. Unknown companies and kinds are ignored without an error, so nothing can be probed.
create or replace function public.record_storefront_event(p_slug text, p_kind text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  if p_kind is null or p_kind not in ('view', 'quote_click') then return; end if;
  v_org := public._storefront_org(p_slug);
  if v_org is null then return; end if;
  insert into public.storefront_stats (org_id, day, views, quote_clicks)
    values (v_org, current_date, case when p_kind = 'view' then 1 else 0 end, case when p_kind = 'quote_click' then 1 else 0 end)
  on conflict (org_id, day) do update
    set views = least(public.storefront_stats.views + excluded.views, 1000000),
        quote_clicks = least(public.storefront_stats.quote_clicks + excluded.quote_clicks, 1000000);
end $$;

-- For a signed-in BUYER looking at a storefront: the company id, so "Request a quote" can open the directory profile directly.
create or replace function public.storefront_org_for_buyer(p_slug text)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated'; end if;
  if not public._is_buyer() then raise exception 'not_allowed'; end if;
  v_org := public._storefront_org(p_slug);
  if v_org is null then raise exception 'not_found'; end if;
  return v_org;
end $$;

-- ───────────── 5. who may call what ─────────────
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('_storefront_ready', '_storefront_org', 'get_company_profile', 'save_company_profile', 'set_storefront',
              'get_public_storefront', 'get_public_storefront_image', 'list_public_storefronts', 'record_storefront_event', 'storefront_org_for_buyer')
  loop execute format('revoke all on function %s from public, anon, authenticated', f.sig); end loop;
end $$;
grant execute on function public.get_company_profile(uuid) to authenticated;
grant execute on function public.save_company_profile(uuid, jsonb) to authenticated;
grant execute on function public.set_storefront(uuid, boolean, boolean) to authenticated;
grant execute on function public.storefront_org_for_buyer(text) to authenticated;
grant execute on function public.get_public_storefront(text) to anon, authenticated;
grant execute on function public.get_public_storefront_image(text, text, uuid) to anon, authenticated;
grant execute on function public.list_public_storefronts(int, int) to anon, authenticated;
grant execute on function public.record_storefront_event(text, text) to anon, authenticated;

notify pgrst, 'reload schema';
