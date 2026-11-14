-- Vendora: onboarding data model (buyers and suppliers).
-- Builds ON TOP of 20261113000001_core_schema.sql and 20261113000002_invite_only_onboarding.sql (run those first).
-- Run in the Supabase SQL editor, or with `supabase db push`. Safe to run twice.
--
-- What this adds, and the rules it enforces IN THE DATABASE (the browser is never trusted):
--   * Buyer or supplier is stored on profiles.account_type. The browser cannot edit it. (Before, it sat in
--     auth metadata, which a signed-in user can rewrite themselves.) It is set once, at sign-up, and then locked.
--   * businesses gains `kind` (buyer / supplier) plus the business details collected in onboarding.
--     `kind` can never change after creation, and a person can only join a company of their own account type.
--   * onboarding_progress: the answers so far, saved on every Continue, so a person can resume on any device.
--     It is readable only by its owner and written only through save_onboarding_progress().
--   * buyer_profiles, supplier_profiles, supplier_products, supplier_capabilities, supplier_locations,
--     supplier_verifications: the real data. They are filled ONLY when the person launches, by one
--     all-or-nothing function (complete_buyer_onboarding / complete_supplier_onboarding), which re-validates
--     everything on the server. Nobody writes these tables directly. Members of the company can read them.
--   * Verification is separate from onboarding: launching creates a supplier_verifications row with status
--     'not_submitted'. Documents are NOT stored here. When that step is built, use a PRIVATE storage bucket
--     with short-lived signed links, never a public URL.
--   * Product images and the logo are stored as small, validated data URLs (JPG/PNG/WebP only, size-capped,
--     never SVG). That is an MVP choice; move them to private storage when volume grows.

-- ───────────────────────── 0. preflight ─────────────────────────
do $$ begin
  if to_regclass('public.businesses') is null
     or to_regclass('public.profiles') is null
     or to_regprocedure('public.accept_invitation(text)') is null
     or to_regprocedure('public._audit(uuid,text,text,uuid,jsonb)') is null then
    raise exception 'Run 20261113000001_core_schema.sql and 20261113000002_invite_only_onboarding.sql first (the versions that use the table name "businesses"). On a dev project that has the old "organizations" table, run supabase/RESET_DEV_DATABASE.sql first.';
  end if;
end $$;

-- A table with one of the names below may already exist in the project from an earlier attempt (or an editor
-- that created it), with different columns. `create table if not exists` would silently keep that wrong table and
-- the policies below would fail ("column org_id does not exist"). So: if the table is missing any column this
-- migration needs, drop it when it is EMPTY, and stop with a clear message when it holds data (never lose rows silently).
do $$
declare
  spec constant jsonb := '{
    "onboarding_progress":     ["user_id","kind","current_step","status","data","org_id","started_at","updated_at","completed_at"],
    "buyer_profiles":          ["org_id","categories","purchase_frequency","budget_range","budget_currency","supplier_priorities","sourcing_areas","delivery_timeline","next_action"],
    "supplier_profiles":       ["org_id","description","logo","categories","contact_name","designation","email","phone_code","phone","alt_phone"],
    "supplier_products":       ["id","org_id","name","category","description","images","unit","moq","price","currency","availability","sort_order"],
    "supplier_capabilities":   ["org_id","coverage","delivery_time","min_order_value","currency","delivery_options","pickup","details"],
    "supplier_locations":      ["id","org_id","country","state","city"],
    "supplier_verifications":  ["org_id","status","registration_no","submitted_at","reviewed_at","reviewed_by","review_note"]
  }';
  t text; c text; missing boolean; n bigint;
begin
  for t in select jsonb_object_keys(spec) loop
    continue when to_regclass('public.' || t) is null;
    missing := false;
    for c in select jsonb_array_elements_text(spec -> t) loop
      if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = t and column_name = c) then
        missing := true;
      end if;
    end loop;
    continue when not missing;
    execute format('select count(*) from public.%I', t) into n;
    if n > 0 then
      raise exception 'The table public.% already exists with different columns and holds % row(s). Back it up, rename or drop it, then run this again.', t, n;
    end if;
    execute format('drop table public.%I cascade', t);
  end loop;
end $$;

-- ───────────────────────── 1. account type lives on profiles ─────────────────────────
do $$ begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'profiles' and column_name = 'account_type') then
    alter table public.profiles add column account_type text not null default 'buyer';
    -- true once the choice is final. Everyone who already exists is final: supplier only if they said so at sign-up.
    alter table public.profiles add column account_type_locked boolean not null default false;
    update public.profiles p
       set account_type = case when u.raw_user_meta_data ->> 'account_type' = 'supplier' then 'supplier' else 'buyer' end
      from auth.users u where u.id = p.user_id;
    update public.profiles set account_type_locked = true;
  end if;
end $$;

-- Sign-ups that happened before the profiles trigger existed (or while the table was reset) get their profile now.
insert into public.profiles (user_id, name, email, account_type, account_type_locked)
select u.id, coalesce(u.raw_user_meta_data ->> 'name', ''), coalesce(u.email, ''),
       case when u.raw_user_meta_data ->> 'account_type' = 'supplier' then 'supplier' else 'buyer' end, true
  from auth.users u
 where not exists (select 1 from public.profiles p where p.user_id = u.id);

alter table public.profiles drop constraint if exists profiles_account_type_check;
alter table public.profiles add  constraint profiles_account_type_check check (account_type in ('buyer', 'supplier'));

-- The sign-up form says which side the person is on; that choice is read ONCE, here, when the account is created.
-- Google / Apple sign-ups carry no choice, so they stay unlocked until claim_account_type() or their first save.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_type text := new.raw_user_meta_data ->> 'account_type';
begin
  insert into public.profiles (user_id, name, email, account_type, account_type_locked)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', ''), coalesce(new.email, ''),
          case when v_type = 'supplier' then 'supplier' else 'buyer' end,
          coalesce(v_type in ('buyer', 'supplier'), false));
  return new;
end $$;

-- A person can edit their display name and nothing else on their profile (not account_type, not email).
revoke insert, update, delete, truncate on public.profiles from anon, authenticated;
grant update (name) on public.profiles to authenticated;

-- ───────────────────────── 2. businesses: kind + business details ─────────────────────────
alter table public.businesses add column if not exists kind             text not null default 'buyer';
alter table public.businesses add column if not exists business_type    text not null default '';
alter table public.businesses add column if not exists country          text not null default '';
alter table public.businesses add column if not exists state            text not null default '';
alter table public.businesses add column if not exists website          text not null default '';
alter table public.businesses add column if not exists company_size     text not null default '';
alter table public.businesses add column if not exists year_established int;

alter table public.businesses drop constraint if exists businesses_kind_check;
alter table public.businesses add  constraint businesses_kind_check check (kind in ('buyer', 'supplier'));
alter table public.businesses drop constraint if exists businesses_details_check;
alter table public.businesses add  constraint businesses_details_check check (
  char_length(business_type) <= 60 and char_length(country) <= 80 and char_length(state) <= 80
  and char_length(website) <= 200 and char_length(company_size) <= 40
  and (year_established is null or year_established between 1900 and 2100));

-- A company is a buyer or a supplier for life.
create or replace function public.guard_org_kind()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.kind is distinct from old.kind then raise exception 'kind_immutable: a company cannot change from buyer to supplier'; end if;
  return new;
end $$;
drop trigger if exists guard_org_kind on public.businesses;
create trigger guard_org_kind before update on public.businesses
  for each row execute function public.guard_org_kind();

-- Core let an owner update ANY column of their company, including `plan` (free self-upgrade), `kind` and `slug`.
-- Now only the descriptive columns are editable from the browser. Nobody inserts or deletes through the API.
revoke insert, update, delete, truncate on public.businesses from anon, authenticated;
grant update (name, industry, city, gstin, currency, business_type, country, state, website, company_size, year_established)
  on public.businesses to authenticated;

-- A buyer account can only join buyer companies and a supplier account only supplier companies.
-- This also covers invitations (accept_invitation inserts the membership), without touching that function.
create or replace function public.guard_membership_account_type()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_kind text; v_type text;
begin
  select kind into v_kind from public.businesses where id = new.org_id;
  select account_type into v_type from public.profiles where user_id = new.user_id;
  if coalesce(v_type, 'buyer') is distinct from coalesce(v_kind, 'buyer') then
    raise exception 'account_type_mismatch: this account cannot join a % company', coalesce(v_kind, 'buyer');
  end if;
  return new;
end $$;
drop trigger if exists guard_membership_account_type on public.memberships;
create trigger guard_membership_account_type before insert on public.memberships
  for each row execute function public.guard_membership_account_type();

-- ───────────────────────── 3. tables ─────────────────────────
-- Money is numeric, never floating point.

-- Answers so far. One row per person per side. `data` is cleared when onboarding completes (the real tables hold the truth).
create table if not exists public.onboarding_progress (
  user_id      uuid not null references auth.users(id) on delete cascade,
  kind         text not null check (kind in ('buyer', 'supplier')),
  current_step int  not null default 0 check (current_step between 0 and 5),
  status       text not null default 'in_progress' check (status in ('in_progress', 'completed')),
  data         jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object' and pg_column_size(data) <= 6291456),
  org_id       uuid references public.businesses(id) on delete set null,
  started_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  completed_at timestamptz,
  primary key (user_id, kind)
);

create table if not exists public.buyer_profiles (
  org_id              uuid primary key references public.businesses(id) on delete cascade,
  categories          text[] not null default '{}' check (cardinality(categories) <= 20),
  purchase_frequency  text not null default '' check (char_length(purchase_frequency) <= 60),
  budget_range        text not null default '' check (char_length(budget_range) <= 60),
  budget_currency     text not null default 'INR' check (budget_currency ~ '^[A-Z]{3}$'),
  supplier_priorities text[] not null default '{}' check (cardinality(supplier_priorities) <= 10),
  sourcing_areas      text[] not null default '{}' check (cardinality(sourcing_areas) <= 10),
  delivery_timeline   text not null default '' check (char_length(delivery_timeline) <= 60),
  next_action         text not null default '' check (next_action in ('', 'suppliers', 'rfq', 'team')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table if not exists public.supplier_profiles (
  org_id       uuid primary key references public.businesses(id) on delete cascade,
  description  text not null default '' check (char_length(description) <= 2000),
  logo         text check (logo is null or (logo ~ '^data:image/(jpeg|png|webp);base64,' and char_length(logo) <= 250000)),
  categories   text[] not null default '{}' check (cardinality(categories) <= 20),
  contact_name text not null default '' check (char_length(contact_name) <= 120),
  designation  text not null default '' check (char_length(designation) <= 80),
  email        text not null default '' check (char_length(email) <= 254),
  phone_code   text not null default '' check (char_length(phone_code) <= 6),
  phone        text not null default '' check (char_length(phone) <= 20),
  alt_phone    text not null default '' check (char_length(alt_phone) <= 20),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.supplier_products (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.businesses(id) on delete cascade,
  name        text not null check (char_length(name) between 2 and 120),
  category    text not null check (char_length(category) <= 60),
  description text not null default '' check (char_length(description) <= 1000),
  images      text[] not null default '{}' check (cardinality(images) <= 4),
  unit        text not null default '' check (char_length(unit) <= 40),
  moq         numeric(14,3) check (moq is null or moq >= 0),
  price       numeric(14,2) check (price is null or price >= 0),
  currency    text not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  availability text not null check (availability in ('Available', 'Made to order', 'Temporarily unavailable')),
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

create table if not exists public.supplier_capabilities (
  org_id          uuid primary key references public.businesses(id) on delete cascade,
  coverage        text[] not null default '{}' check (cardinality(coverage) <= 4),
  delivery_time   text not null default '' check (char_length(delivery_time) <= 40),
  min_order_value numeric(14,2) check (min_order_value is null or min_order_value >= 0),
  currency        text not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  delivery_options text[] not null default '{}' check (cardinality(delivery_options) <= 6),
  pickup          text not null default '' check (pickup in ('', 'Yes', 'No')),
  -- Answers that depend on the business type (manufacturer, distributor, service provider, importer/exporter).
  -- Built by the server from a fixed list of keys, so nothing arbitrary is ever stored here.
  details         jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object' and pg_column_size(details) <= 20000),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.supplier_locations (
  id      uuid primary key default gen_random_uuid(),
  org_id  uuid not null references public.businesses(id) on delete cascade,
  country text not null check (char_length(country) between 1 and 80),
  state   text not null default '' check (char_length(state) <= 80),
  city    text not null default '' check (char_length(city) <= 80),
  unique (org_id, country, state, city)
);

-- Verification is its own process, separate from onboarding. No document columns on purpose (see header).
create table if not exists public.supplier_verifications (
  org_id          uuid primary key references public.businesses(id) on delete cascade,
  status          text not null default 'not_submitted'
                    check (status in ('not_submitted', 'submitted', 'in_review', 'verified', 'rejected')),
  registration_no text not null default '' check (char_length(registration_no) <= 50),
  submitted_at    timestamptz,
  reviewed_at     timestamptz,
  reviewed_by     uuid references auth.users(id) on delete set null,
  review_note     text check (review_note is null or char_length(review_note) <= 1000),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists supplier_products_org_idx on public.supplier_products (org_id);
create index if not exists supplier_locations_org_idx on public.supplier_locations (org_id);
create index if not exists onboarding_progress_org_idx on public.onboarding_progress (org_id);

-- ───────────────────────── 4. row level security ─────────────────────────
-- Read-only from the browser. Writes happen only inside the checked functions below
-- (when a feature needs people to edit these later, add a narrow policy for it in its own migration).
alter table public.onboarding_progress    enable row level security;
alter table public.buyer_profiles         enable row level security;
alter table public.supplier_profiles      enable row level security;
alter table public.supplier_products      enable row level security;
alter table public.supplier_capabilities  enable row level security;
alter table public.supplier_locations     enable row level security;
alter table public.supplier_verifications enable row level security;

revoke all on public.onboarding_progress, public.buyer_profiles, public.supplier_profiles, public.supplier_products,
  public.supplier_capabilities, public.supplier_locations, public.supplier_verifications from anon, authenticated;
grant select on public.onboarding_progress, public.buyer_profiles, public.supplier_profiles, public.supplier_products,
  public.supplier_capabilities, public.supplier_locations, public.supplier_verifications to authenticated;

drop policy if exists ob_select_own on public.onboarding_progress;
create policy ob_select_own on public.onboarding_progress for select to authenticated
  using (user_id = (select auth.uid()));

do $$ declare t text; begin
  foreach t in array array['buyer_profiles', 'supplier_profiles', 'supplier_products', 'supplier_capabilities',
                           'supplier_locations', 'supplier_verifications'] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_member(org_id))', t || '_read', t);
  end loop;
end $$;

-- ───────────────────────── 5. validation helpers (used only inside the functions below) ─────────────────────────
-- Each reads one key of the saved answers and rejects anything of the wrong shape or size.

create or replace function public._ob_text(p jsonb, k text, maxlen int)
returns text language plpgsql immutable set search_path = '' as $$
declare v jsonb := p -> k; t text;
begin
  if v is null or jsonb_typeof(v) = 'null' then return ''; end if;
  if jsonb_typeof(v) <> 'string' then raise exception 'invalid_%', k using errcode = '22023'; end if;
  t := btrim(p ->> k);
  if char_length(t) > maxlen then raise exception 'invalid_%', k using errcode = '22023'; end if;
  return t;
end $$;

create or replace function public._ob_list(p jsonb, k text, maxitems int, maxlen int)
returns text[] language plpgsql immutable set search_path = '' as $$
declare v jsonb := p -> k; e jsonb; s text; r text[] := '{}';
begin
  if v is null or jsonb_typeof(v) = 'null' then return r; end if;
  if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > maxitems then raise exception 'invalid_%', k using errcode = '22023'; end if;
  for e in select value from jsonb_array_elements(v) loop
    if jsonb_typeof(e) <> 'string' then raise exception 'invalid_%', k using errcode = '22023'; end if;
    s := btrim(e #>> '{}');
    if char_length(s) > maxlen then raise exception 'invalid_%', k using errcode = '22023'; end if;
    if s <> '' and not (s = any (r)) then r := r || s; end if;
  end loop;
  return r;
end $$;

-- A non-negative amount typed by a person ("1500", "12.5"). Empty means "not given".
create or replace function public._ob_num(p jsonb, k text)
returns numeric language plpgsql immutable set search_path = '' as $$
declare v jsonb := p -> k; t text;
begin
  if v is null or jsonb_typeof(v) = 'null' then return null; end if;
  if jsonb_typeof(v) not in ('string', 'number') then raise exception 'invalid_%', k using errcode = '22023'; end if;
  t := btrim(p ->> k);
  if t = '' then return null; end if;
  if t !~ '^[0-9]{1,12}(\.[0-9]{1,3})?$' then raise exception 'invalid_%', k using errcode = '22023'; end if;
  return t::numeric;
end $$;

-- Only small JPG / PNG / WebP data URLs. Never SVG (it can carry scripts).
create or replace function public._ob_is_image(s text, maxlen int)
returns boolean language sql immutable set search_path = '' as $$
  select s ~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$' and char_length(s) <= maxlen
$$;

create or replace function public._ob_images(p jsonb, k text, maxitems int)
returns text[] language plpgsql immutable set search_path = '' as $$
declare v jsonb := p -> k; e jsonb; r text[] := '{}';
begin
  if v is null or jsonb_typeof(v) = 'null' then return r; end if;
  if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > maxitems then raise exception 'invalid_%', k using errcode = '22023'; end if;
  for e in select value from jsonb_array_elements(v) loop
    if jsonb_typeof(e) <> 'string' or not public._ob_is_image(e #>> '{}', 250000) then
      raise exception 'invalid_%', k using errcode = '22023';
    end if;
    r := r || (e #>> '{}');
  end loop;
  return r;
end $$;

create or replace function public._ob_website_ok(w text)
returns boolean language sql immutable set search_path = '' as $$
  select w = '' or (char_length(w) <= 200 and w ~* '^(https?://)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:[0-9]{1,5})?(/[^[:space:]]*)?$')
$$;

-- Same country -> currency table the app uses to label prices.
create or replace function public._currency_for_country(c text)
returns text language sql immutable set search_path = '' as $$
  select case c
    when 'India' then 'INR' when 'United States' then 'USD' when 'United Kingdom' then 'GBP'
    when 'United Arab Emirates' then 'AED' when 'Singapore' then 'SGD' when 'Australia' then 'AUD'
    when 'Canada' then 'CAD' when 'Germany' then 'EUR' when 'Bangladesh' then 'BDT'
    when 'Nepal' then 'NPR' when 'Sri Lanka' then 'LKR' else 'USD' end
$$;

-- A URL-safe, unique company slug from the name (the app used to make these in the browser).
create or replace function public._ob_slug(p_name text, p_try int)
returns text language sql volatile set search_path = '' as $$
  select left(case when char_length(b) >= 2 then b else 'workspace' end, 40) || '-' || substr(md5(gen_random_uuid()::text || p_try::text), 1, 8)
  from (select btrim(regexp_replace(lower(p_name), '[^a-z0-9]+', '-', 'g'), '-') as b) s
$$;

-- ───────────────────────── 6. functions the app calls ─────────────────────────

-- Google / Apple sign-ups cannot carry the buyer-or-supplier choice, so the app records it right after.
-- It can only FILL IN a choice that was never made: it never converts an account that has chosen,
-- has started onboarding, or belongs to a company.
create or replace function public.claim_account_type(p_type text)
returns text language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); v_cur text; v_locked boolean;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if p_type is null or p_type not in ('buyer', 'supplier') then raise exception 'invalid_type'; end if;
  select account_type, account_type_locked into v_cur, v_locked from public.profiles where user_id = uid for update;
  if not found then raise exception 'no_profile'; end if;
  if v_locked then return v_cur; end if;
  if exists (select 1 from public.memberships where user_id = uid)
     or exists (select 1 from public.onboarding_progress where user_id = uid) then
    update public.profiles set account_type_locked = true where user_id = uid;
    return v_cur;
  end if;
  update public.profiles set account_type = p_type, account_type_locked = true where user_id = uid;
  return p_type;
end $$;

-- Called on every Continue. Stores the answers as given; strict checks happen at launch.
create or replace function public.save_onboarding_progress(p_kind text, p_step int, p_data jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); v_type text; v_status text;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if p_kind is null or p_kind not in ('buyer', 'supplier') then raise exception 'invalid_kind'; end if;
  select account_type into v_type from public.profiles where user_id = uid;
  if v_type is distinct from p_kind then raise exception 'wrong_account_type'; end if;
  if p_step is null or p_step < 0 or p_step > (case p_kind when 'buyer' then 4 else 5 end) then raise exception 'invalid_step'; end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then raise exception 'invalid_data'; end if;
  if octet_length(p_data::text) > 6000000 then raise exception 'too_large'; end if;

  select status into v_status from public.onboarding_progress where user_id = uid and kind = p_kind for update;
  if v_status = 'completed' then raise exception 'already_completed'; end if;

  insert into public.onboarding_progress (user_id, kind, current_step, data)
    values (uid, p_kind, p_step, p_data)
    on conflict (user_id, kind) do update
      set current_step = excluded.current_step, data = excluded.data, updated_at = now();
  -- Once they have started, the account type is final.
  update public.profiles set account_type_locked = true where user_id = uid and not account_type_locked;
end $$;

-- Launch (buyer): re-validates the saved answers, then creates the company, its owner, and the buyer profile together.
create or replace function public.complete_buyer_onboarding()
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid()); v_type text; v_prog public.onboarding_progress; d jsonb;
  v_name text; v_btype text; v_industry text; v_country text; v_state text; v_city text; v_site text; v_size text;
  v_cats text[]; v_freq text; v_budget text; v_cur text; v_next text; v_org uuid; i int;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select account_type into v_type from public.profiles where user_id = uid;
  if v_type is distinct from 'buyer' then raise exception 'wrong_account_type'; end if;

  select * into v_prog from public.onboarding_progress where user_id = uid and kind = 'buyer' for update;   -- row lock: no double launch
  if not found then raise exception 'no_progress'; end if;
  if v_prog.status = 'completed' then
    if v_prog.org_id is null then raise exception 'no_progress'; end if;
    return v_prog.org_id;   -- launched already (double click, second tab): same company, nothing duplicated
  end if;
  d := v_prog.data;

  v_name     := public._ob_text(d, 'companyName', 120);   if char_length(v_name) < 2 then raise exception 'invalid_companyName'; end if;
  v_btype    := public._ob_text(d, 'businessType', 60);   if v_btype = '' then raise exception 'invalid_businessType'; end if;
  v_industry := public._ob_text(d, 'industry', 80);       if v_industry = '' then raise exception 'invalid_industry'; end if;
  v_country  := public._ob_text(d, 'country', 80);        if v_country = '' then raise exception 'invalid_country'; end if;
  v_state    := public._ob_text(d, 'state', 80);          if v_state = '' then raise exception 'invalid_state'; end if;
  v_city     := public._ob_text(d, 'city', 80);           if v_city = '' then raise exception 'invalid_city'; end if;
  v_site     := public._ob_text(d, 'website', 200);       if not public._ob_website_ok(v_site) then raise exception 'invalid_website'; end if;
  v_size     := public._ob_text(d, 'companySize', 40);
  v_cats     := public._ob_list(d, 'categories', 20, 60); if cardinality(v_cats) = 0 then raise exception 'invalid_categories'; end if;
  v_freq     := public._ob_text(d, 'frequency', 60);      if v_freq = '' then raise exception 'invalid_frequency'; end if;
  v_budget   := public._ob_text(d, 'budget', 60);
  v_cur      := upper(public._ob_text(d, 'budgetCurrency', 3)); if v_cur !~ '^[A-Z]{3}$' then v_cur := 'INR'; end if;
  v_next     := public._ob_text(d, 'nextAction', 20);     if v_next not in ('', 'suppliers', 'rfq', 'team') then raise exception 'invalid_nextAction'; end if;

  if (select count(*) from public.memberships where user_id = uid and role = 'owner') >= 5 then raise exception 'too_many_companies'; end if;

  for i in 1..5 loop
    begin
      insert into public.businesses (slug, name, industry, city, kind, business_type, country, state, website, company_size, currency)
        values (public._ob_slug(v_name, i), v_name, v_industry, v_city, 'buyer', v_btype, v_country, v_state, v_site, v_size,
                case when v_cur in ('INR', 'USD', 'EUR', 'AED') then v_cur else 'INR' end)
        returning id into v_org;
      exit;
    exception when unique_violation then
      if i = 5 then raise; end if;
    end;
  end loop;

  insert into public.memberships (org_id, user_id, role, status) values (v_org, uid, 'owner', 'active');
  insert into public.buyer_profiles (org_id, categories, purchase_frequency, budget_range, budget_currency,
                                     supplier_priorities, sourcing_areas, delivery_timeline, next_action)
    values (v_org, v_cats, v_freq, v_budget, v_cur, public._ob_list(d, 'priorities', 10, 80),
            public._ob_list(d, 'sourcing', 10, 80), public._ob_text(d, 'delivery', 60), v_next);

  update public.onboarding_progress
     set status = 'completed', completed_at = now(), org_id = v_org, current_step = 4, data = '{}'::jsonb, updated_at = now()
   where user_id = uid and kind = 'buyer';
  perform public._audit(v_org, 'organization_created', 'organization', v_org, jsonb_build_object('name', v_name, 'kind', 'buyer'));
  perform public._audit(v_org, 'onboarding_completed', 'organization', v_org, jsonb_build_object('kind', 'buyer'));
  return v_org;
end $$;

-- Launch (supplier): same idea, plus the profile, products, capabilities, locations and an (unsubmitted) verification record.
create or replace function public.complete_supplier_onboarding()
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid()); v_type text; v_prog public.onboarding_progress; d jsonb;
  v_name text; v_btype text; v_industry text; v_country text; v_state text; v_city text; v_site text; v_size text; v_year text;
  v_desc text; v_logo text; v_cname text; v_email text; v_code text; v_phone text; v_cats text[]; v_cov text[];
  v_cur text; v_org uuid; v_offs jsonb; v_locs jsonb; o jsonb; ord bigint; i int; n int := 0;
  v_pname text; v_pcat text; v_pdesc text; v_avail text; v_group text; v_details jsonb := '{}'::jsonb; v_pickup text;
  yn text; k text; loc jsonb; v_lc text; v_ls text; v_lcity text;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select account_type into v_type from public.profiles where user_id = uid;
  if v_type is distinct from 'supplier' then raise exception 'wrong_account_type'; end if;

  select * into v_prog from public.onboarding_progress where user_id = uid and kind = 'supplier' for update;
  if not found then raise exception 'no_progress'; end if;
  if v_prog.status = 'completed' then
    if v_prog.org_id is null then raise exception 'no_progress'; end if;
    return v_prog.org_id;
  end if;
  d := v_prog.data;

  -- business information
  v_name     := public._ob_text(d, 'name', 120);          if char_length(v_name) < 2 then raise exception 'invalid_name'; end if;
  v_btype    := public._ob_text(d, 'businessType', 60);   if v_btype = '' then raise exception 'invalid_businessType'; end if;
  v_industry := public._ob_text(d, 'industry', 80);       if v_industry = '' then raise exception 'invalid_industry'; end if;
  v_country  := public._ob_text(d, 'country', 80);        if v_country = '' then raise exception 'invalid_country'; end if;
  v_state    := public._ob_text(d, 'state', 80);          if v_state = '' then raise exception 'invalid_state'; end if;
  v_city     := public._ob_text(d, 'city', 80);           if v_city = '' then raise exception 'invalid_city'; end if;
  v_site     := public._ob_text(d, 'website', 200);       if not public._ob_website_ok(v_site) then raise exception 'invalid_website'; end if;
  v_size     := public._ob_text(d, 'companySize', 40);
  v_year     := public._ob_text(d, 'yearEstablished', 4);
  if v_year <> '' and (v_year !~ '^[0-9]{4}$' or v_year::int < 1900 or v_year::int > extract(year from now())::int) then raise exception 'invalid_yearEstablished'; end if;

  -- supplier profile
  v_desc  := public._ob_text(d, 'description', 500);     if char_length(v_desc) < 50 then raise exception 'invalid_description'; end if;
  v_logo  := public._ob_text(d, 'logo', 250000);         if v_logo <> '' and not public._ob_is_image(v_logo, 250000) then raise exception 'invalid_logo'; end if;
  v_cname := public._ob_text(d, 'contactName', 120);     if char_length(v_cname) < 2 then raise exception 'invalid_contactName'; end if;
  v_email := lower(public._ob_text(d, 'email', 254));    if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'invalid_email'; end if;
  v_code  := public._ob_text(d, 'phoneCode', 6);         if v_code !~ '^\+[0-9]{1,4}$' then raise exception 'invalid_phoneCode'; end if;
  v_phone := public._ob_text(d, 'phone', 20);            if char_length(regexp_replace(v_phone, '[^0-9]', '', 'g')) < 7 then raise exception 'invalid_phone'; end if;
  perform public._ob_text(d, 'altPhone', 20);
  perform public._ob_text(d, 'designation', 80);

  -- products & services
  v_cats := public._ob_list(d, 'categories', 20, 60);    if cardinality(v_cats) = 0 then raise exception 'invalid_categories'; end if;
  v_offs := d -> 'offerings';
  if v_offs is null or jsonb_typeof(v_offs) <> 'array' or jsonb_array_length(v_offs) < 1 or jsonb_array_length(v_offs) > 30 then
    raise exception 'invalid_offerings';
  end if;

  -- supply capabilities
  v_cov := public._ob_list(d, 'coverage', 4, 40);        if cardinality(v_cov) = 0 then raise exception 'invalid_coverage'; end if;
  v_locs := d -> 'locations';
  if v_locs is not null and jsonb_typeof(v_locs) <> 'null' and (jsonb_typeof(v_locs) <> 'array' or jsonb_array_length(v_locs) > 100) then
    raise exception 'invalid_locations';
  end if;
  v_pickup := public._ob_text(d, 'pickup', 3);           if v_pickup not in ('', 'Yes', 'No') then raise exception 'invalid_pickup'; end if;
  perform public._ob_text(d, 'deliveryTime', 40);
  perform public._ob_num(d, 'minOrderValue');
  perform public._ob_list(d, 'deliveryOptions', 6, 60);

  -- answers that depend on the business type; only these known keys are ever kept
  v_group := case
    when v_btype = 'Manufacturer' then 'manufacturer'
    when v_btype in ('Distributor', 'Wholesaler', 'Trading Company') then 'distributor'
    when v_btype = 'Service Provider' then 'service'
    when v_btype in ('Importer', 'Exporter') then 'trade' end;
  foreach k in array array['inHouse', 'customMfg', 'multiSource', 'readyStock', 'bulkOrders', 'largeProjects', 'intlShipping'] loop
    yn := public._ob_text(d, k, 3);
    if yn not in ('', 'Yes', 'No') then raise exception 'invalid_%', k using errcode = '22023'; end if;
    if yn <> '' then v_details := v_details || jsonb_build_object(k, yn); end if;
  end loop;
  v_details := v_details || jsonb_build_object(
    'monthlyCapacity', public._ob_text(d, 'monthlyCapacity', 80),
    'serviceCoverage', public._ob_text(d, 'serviceCoverage', 60),
    'tradeCountries',  public._ob_text(d, 'tradeCountries', 200),
    'mfgCapabilities', to_jsonb(public._ob_list(d, 'mfgCapabilities', 10, 60)),
    'servicesOffered', to_jsonb(public._ob_list(d, 'servicesOffered', 10, 60)));
  if v_group = 'manufacturer' and coalesce(v_details ->> 'inHouse', '') = '' then raise exception 'invalid_inHouse'; end if;
  if v_group = 'service' and (jsonb_array_length(v_details -> 'servicesOffered') = 0 or (v_details ->> 'serviceCoverage') = '') then
    raise exception 'invalid_servicesOffered';
  end if;

  v_cur := public._currency_for_country(v_country);

  -- validate every offering BEFORE writing anything (extra empty rows are ignored; the first one is required)
  for o, ord in select value, ordinality from jsonb_array_elements(v_offs) with ordinality loop
    if jsonb_typeof(o) <> 'object' then raise exception 'invalid_offerings'; end if;
    v_pname := public._ob_text(o, 'name', 120); v_pdesc := public._ob_text(o, 'description', 1000);
    continue when ord > 1 and v_pname = '' and v_pdesc = '';
    v_pcat := public._ob_text(o, 'category', 60); v_avail := public._ob_text(o, 'availability', 40);
    if char_length(v_pname) < 2 then raise exception 'invalid_offerings'; end if;
    if not (v_pcat = any (v_cats)) then raise exception 'invalid_offerings'; end if;
    if char_length(v_pdesc) < 10 then raise exception 'invalid_offerings'; end if;
    if v_avail not in ('Available', 'Made to order', 'Temporarily unavailable') then raise exception 'invalid_offerings'; end if;
    perform public._ob_text(o, 'unit', 40); perform public._ob_num(o, 'moq'); perform public._ob_num(o, 'price');
    perform public._ob_images(o, 'images', 4);
    n := n + 1;
  end loop;
  if n < 1 then raise exception 'invalid_offerings'; end if;

  if (select count(*) from public.memberships where user_id = uid and role = 'owner') >= 5 then raise exception 'too_many_companies'; end if;

  -- everything checked: write it all (one transaction, so a failure leaves nothing behind)
  for i in 1..5 loop
    begin
      insert into public.businesses (slug, name, industry, city, kind, business_type, country, state, website, company_size, year_established, currency)
        values (public._ob_slug(v_name, i), v_name, v_industry, v_city, 'supplier', v_btype, v_country, v_state, v_site, v_size,
                nullif(v_year, '')::int, case when v_cur in ('INR', 'USD', 'EUR', 'AED') then v_cur else 'INR' end)
        returning id into v_org;
      exit;
    exception when unique_violation then
      if i = 5 then raise; end if;
    end;
  end loop;
  insert into public.memberships (org_id, user_id, role, status) values (v_org, uid, 'owner', 'active');

  insert into public.supplier_profiles (org_id, description, logo, categories, contact_name, designation, email, phone_code, phone, alt_phone)
    values (v_org, v_desc, nullif(v_logo, ''), v_cats, v_cname, public._ob_text(d, 'designation', 80), v_email, v_code, v_phone,
            public._ob_text(d, 'altPhone', 20));

  insert into public.supplier_capabilities (org_id, coverage, delivery_time, min_order_value, currency, delivery_options, pickup, details)
    values (v_org, v_cov, public._ob_text(d, 'deliveryTime', 40), public._ob_num(d, 'minOrderValue'), v_cur,
            public._ob_list(d, 'deliveryOptions', 6, 60), v_pickup, v_details);

  if v_locs is not null and jsonb_typeof(v_locs) = 'array' then
    for loc in select value from jsonb_array_elements(v_locs) loop
      if jsonb_typeof(loc) <> 'object' then raise exception 'invalid_locations'; end if;
      v_lc := public._ob_text(loc, 'country', 80); v_ls := public._ob_text(loc, 'state', 80); v_lcity := public._ob_text(loc, 'city', 80);
      if v_lc = '' then raise exception 'invalid_locations'; end if;
      insert into public.supplier_locations (org_id, country, state, city) values (v_org, v_lc, v_ls, v_lcity) on conflict do nothing;
    end loop;
  end if;

  for o, ord in select value, ordinality from jsonb_array_elements(v_offs) with ordinality loop
    v_pname := public._ob_text(o, 'name', 120); v_pdesc := public._ob_text(o, 'description', 1000);
    continue when ord > 1 and v_pname = '' and v_pdesc = '';
    insert into public.supplier_products (org_id, name, category, description, images, unit, moq, price, currency, availability, sort_order)
      values (v_org, v_pname, public._ob_text(o, 'category', 60), v_pdesc, public._ob_images(o, 'images', 4),
              public._ob_text(o, 'unit', 40), public._ob_num(o, 'moq'), public._ob_num(o, 'price'), v_cur,
              public._ob_text(o, 'availability', 40), ord::int);
  end loop;

  -- verification is a separate process: just record that it has not been started
  insert into public.supplier_verifications (org_id, status, registration_no)
    values (v_org, 'not_submitted', public._ob_text(d, 'registrationNo', 50));

  update public.onboarding_progress
     set status = 'completed', completed_at = now(), org_id = v_org, current_step = 5, data = '{}'::jsonb, updated_at = now()
   where user_id = uid and kind = 'supplier';
  perform public._audit(v_org, 'organization_created', 'organization', v_org, jsonb_build_object('name', v_name, 'kind', 'supplier'));
  perform public._audit(v_org, 'onboarding_completed', 'organization', v_org, jsonb_build_object('kind', 'supplier'));
  return v_org;
end $$;

-- ───────────────────────── 7. who may call what ─────────────────────────
-- Supabase grants EXECUTE on new functions to everyone by default; take it away, then grant exactly what is needed.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in
             ('handle_new_user', 'guard_org_kind', 'guard_membership_account_type',
              '_ob_text', '_ob_list', '_ob_num', '_ob_is_image', '_ob_images', '_ob_website_ok', '_currency_for_country', '_ob_slug',
              'claim_account_type', 'save_onboarding_progress', 'complete_buyer_onboarding', 'complete_supplier_onboarding')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;

grant execute on function
  public.claim_account_type(text),
  public.save_onboarding_progress(text, int, jsonb),
  public.complete_buyer_onboarding(),
  public.complete_supplier_onboarding()
  to authenticated;

notify pgrst, 'reload schema';
