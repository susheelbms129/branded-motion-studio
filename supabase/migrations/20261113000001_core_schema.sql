-- Vendora core schema: multi-tenant from day one.
-- Every business table carries org_id and has Row Level Security (RLS) enabled,
-- so one company can never read or write another company's data.
-- Run in the Supabase SQL editor, or with `supabase db push`.

-- ───────────────────────── helpers ─────────────────────────

create table public.businesses (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique check (slug ~ '^[a-z0-9-]{2,60}$'),
  name       text not null check (char_length(name) between 2 and 120),
  plan       text not null default 'Starter' check (plan in ('Starter','Growth','Enterprise')),
  industry   text not null default '',
  city       text not null default '',
  gstin      text not null default '' check (gstin = '' or gstin ~ '^[0-9]{2}[A-Z0-9]{13}$'),
  currency   text not null default 'INR' check (currency in ('INR','USD','EUR','AED')),
  created_at timestamptz not null default now()
);

create table public.profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  name       text not null default '',
  email      text not null default '',
  created_at timestamptz not null default now()
);

create table public.memberships (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.businesses(id) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete cascade,
  role           text not null check (role in ('owner','procurement_manager','finance_manager','approver','employee')),
  department     text not null default '',
  status         text not null default 'active' check (status in ('active','invited','suspended')),
  joined_at      timestamptz not null default now(),
  last_active_at timestamptz,
  unique (org_id, user_id)
);
create index on public.memberships (user_id);

-- SECURITY DEFINER so policies can look up membership without recursing into RLS.
create function public.is_member(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = p_org and m.user_id = (select auth.uid()) and m.status = 'active'
  );
$$;

create function public.has_role(p_org uuid, p_roles text[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = p_org and m.user_id = (select auth.uid())
      and m.status = 'active' and m.role = any (p_roles)
  );
$$;

-- Creating a workspace: inserts the org and makes the caller its owner, atomically.
create function public.create_organization(p_name text, p_slug text, p_industry text default '', p_city text default '')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  if (select auth.uid()) is null then raise exception 'not authenticated'; end if;
  insert into public.businesses (name, slug, industry, city) values (p_name, p_slug, p_industry, p_city)
    returning id into v_org;
  insert into public.memberships (org_id, user_id, role) values (v_org, (select auth.uid()), 'owner');
  return v_org;
end $$;

-- Every new auth user gets a profile row.
create function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id, name, email)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', ''), coalesce(new.email, ''));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ───────────────────────── business tables ─────────────────────────
-- Money: numeric(14,2), never floating point.

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.businesses(id) on delete cascade,
  name text not null, accent text not null default 'blue',
  monthly_budget numeric(14,2) not null default 0 check (monthly_budget >= 0)
);

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.businesses(id) on delete cascade,
  name text not null, city text not null default '', state text not null default '',
  gstin text not null default '' check (gstin = '' or gstin ~ '^[0-9]{2}[A-Z0-9]{13}$'),
  category_ids uuid[] not null default '{}',
  payment_terms_days int not null default 30 check (payment_terms_days >= 0),
  since date, status text not null default 'active' check (status in ('active','inactive','under_review')),
  email text not null default '', phone text not null default '', website text not null default '',
  created_at timestamptz not null default now()
);

create table public.supplier_contacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.businesses(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  name text not null, designation text not null default '', email text not null default '',
  phone text not null default '', is_primary boolean not null default false
);

create table public.materials (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.businesses(id) on delete cascade,
  sku text not null, name text not null,
  category_id uuid references public.categories(id) on delete set null,
  unit text not null, gst_rate numeric(5,2) not null default 18 check (gst_rate between 0 and 40),
  hsn text not null default '', preferred_supplier_id uuid references public.suppliers(id) on delete set null,
  description text not null default '',
  unique (org_id, sku)
);

create table public.purchase_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.businesses(id) on delete cascade,
  number text not null, title text not null,
  requester_id uuid not null references auth.users(id),
  department text not null default '',
  category_id uuid references public.categories(id) on delete set null,
  status text not null default 'draft' check (status in ('draft','pending_approval','approved','rejected','converted_to_rfq','completed')),
  priority text not null default 'medium' check (priority in ('low','medium','high','urgent')),
  needed_by date, justification text not null default '',
  created_at timestamptz not null default now(),
  unique (org_id, number)
);

create table public.request_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.businesses(id) on delete cascade,
  request_id uuid not null references public.purchase_requests(id) on delete cascade,
  material_id uuid references public.materials(id) on delete set null,
  description text not null default '', qty numeric(14,3) not null check (qty > 0),
  unit text not null, unit_price numeric(14,2) not null default 0 check (unit_price >= 0)
);

create table public.approval_steps (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.businesses(id) on delete cascade,
  request_id uuid not null references public.purchase_requests(id) on delete cascade,
  approver_id uuid not null references auth.users(id),
  level int not null check (level >= 1),
  status text not null default 'waiting' check (status in ('pending','approved','rejected','waiting')),
  decided_at timestamptz, comment text
);

create table public.rfqs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.businesses(id) on delete cascade,
  number text not null, title text not null,
  request_id uuid references public.purchase_requests(id) on delete set null,
  category_id uuid references public.categories(id) on delete set null,
  status text not null default 'draft' check (status in ('draft','sent','evaluating','awarded','closed')),
  due_date date, owner_id uuid not null references auth.users(id),
  awarded_quotation_id uuid, notes text not null default '',
  created_at timestamptz not null default now(),
  unique (org_id, number)
);

create table public.rfq_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.businesses(id) on delete cascade,
  rfq_id uuid not null references public.rfqs(id) on delete cascade,
  material_id uuid references public.materials(id) on delete set null,
  description text not null default '', qty numeric(14,3) not null check (qty > 0), unit text not null
);

create table public.rfq_invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.businesses(id) on delete cascade,
  rfq_id uuid not null references public.rfqs(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  status text not null default 'sent' check (status in ('sent','viewed','quoted','declined')),
  sent_at timestamptz not null default now(), responded_at timestamptz,
  unique (rfq_id, supplier_id)
);

create table public.quotations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.businesses(id) on delete cascade,
  rfq_id uuid not null references public.rfqs(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  received_at timestamptz not null default now(),
  gst_rate numeric(5,2) not null default 18 check (gst_rate between 0 and 40),
  shipping numeric(14,2) not null default 0 check (shipping >= 0),
  other_charges numeric(14,2) not null default 0 check (other_charges >= 0),
  delivery_days int not null default 0 check (delivery_days >= 0),
  payment_terms_days int not null default 30 check (payment_terms_days >= 0),
  valid_until date, notes text not null default ''
);
alter table public.rfqs add constraint rfqs_awarded_fk
  foreign key (awarded_quotation_id) references public.quotations(id) on delete set null;

create table public.quotation_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.businesses(id) on delete cascade,
  quotation_id uuid not null references public.quotations(id) on delete cascade,
  material_id uuid references public.materials(id) on delete set null,
  qty numeric(14,3) not null check (qty > 0), unit_price numeric(14,2) not null check (unit_price >= 0)
);

create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.businesses(id) on delete cascade,
  number text not null,
  supplier_id uuid not null references public.suppliers(id),
  rfq_id uuid references public.rfqs(id) on delete set null,
  quotation_id uuid references public.quotations(id) on delete set null,
  request_id uuid references public.purchase_requests(id) on delete set null,
  category_id uuid references public.categories(id) on delete set null,
  status text not null default 'draft' check (status in ('draft','issued','acknowledged','partially_received','received','closed','cancelled')),
  created_at timestamptz not null default now(), issued_at timestamptz,
  expected_at date, delivered_at timestamptz,
  created_by uuid not null references auth.users(id),
  shipping numeric(14,2) not null default 0 check (shipping >= 0),
  other_charges numeric(14,2) not null default 0 check (other_charges >= 0),
  payment_terms_days int not null default 30 check (payment_terms_days >= 0),
  delivery_address text not null default '', notes text not null default '',
  unique (org_id, number)
);

create table public.po_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.businesses(id) on delete cascade,
  po_id uuid not null references public.purchase_orders(id) on delete cascade,
  material_id uuid references public.materials(id) on delete set null,
  description text not null default '', qty numeric(14,3) not null check (qty > 0), unit text not null,
  unit_price numeric(14,2) not null check (unit_price >= 0),
  gst_rate numeric(5,2) not null default 18 check (gst_rate between 0 and 40)
);

create table public.approval_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  field text not null check (field in ('amount','category','department')),
  operator text not null check (operator in ('gt','lt','eq')),
  value text not null, approver_roles text[] not null default '{}',
  levels int not null default 1 check (levels between 1 and 5), active boolean not null default true
);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.businesses(id) on delete cascade,
  email text not null, role text not null check (role in ('procurement_manager','finance_manager','approver','employee')),
  invited_by uuid not null references auth.users(id),
  sent_at timestamptz not null default now(), status text not null default 'pending' check (status in ('pending','expired','accepted'))
);

create table public.insights (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.businesses(id) on delete cascade,
  type text not null, severity text not null check (severity in ('high','medium','low')),
  title text not null, what_happened text not null default '', why_flagged text not null default '',
  confidence numeric(4,3) not null default 0 check (confidence between 0 and 1),
  evidence jsonb not null default '[]', suggested_action text not null default '',
  impact_amount numeric(14,2), status text not null default 'open' check (status in ('open','dismissed','snoozed','resolved')),
  created_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null, title text not null, body text not null default '',
  link_to text, read boolean not null default false, created_at timestamptz not null default now()
);

-- Append-only record of who did what. No update/delete is ever granted.
create table public.audit_log (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.businesses(id) on delete cascade,
  actor_id uuid references auth.users(id),
  action text not null, entity text not null, entity_id uuid,
  detail jsonb not null default '{}', at timestamptz not null default now()
);

-- Indexes on every org_id and common foreign keys (RLS filters on these).
do $$ declare t text; begin
  foreach t in array array['categories','suppliers','supplier_contacts','materials','purchase_requests','request_items',
    'approval_steps','rfqs','rfq_items','rfq_invites','quotations','quotation_lines','purchase_orders','po_lines',
    'approval_rules','invitations','insights','notifications','audit_log'] loop
    execute format('create index on public.%I (org_id)', t);
  end loop;
end $$;
create index on public.request_items (request_id);
create index on public.approval_steps (request_id);
create index on public.approval_steps (approver_id);
create index on public.rfq_items (rfq_id);
create index on public.quotations (rfq_id);
create index on public.quotation_lines (quotation_id);
create index on public.po_lines (po_id);
create index on public.purchase_orders (supplier_id);

-- ───────────────────────── Row Level Security ─────────────────────────

alter table public.businesses  enable row level security;
alter table public.profiles       enable row level security;
alter table public.memberships    enable row level security;

-- Nothing is reachable without logging in.
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon;
grant execute on function public.create_organization(text, text, text, text) to authenticated;

create policy org_select on public.businesses for select to authenticated using (public.is_member(id));
create policy org_update on public.businesses for update to authenticated
  using (public.has_role(id, array['owner'])) with check (public.has_role(id, array['owner']));

create policy profile_self on public.profiles for select to authenticated
  using (user_id = (select auth.uid())
         or exists (select 1 from public.memberships a join public.memberships b on a.org_id = b.org_id
                    where a.user_id = (select auth.uid()) and b.user_id = profiles.user_id and a.status = 'active'));
create policy profile_update_self on public.profiles for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy member_select on public.memberships for select to authenticated using (public.is_member(org_id));
create policy member_owner_write on public.memberships for all to authenticated
  using (public.has_role(org_id, array['owner'])) with check (public.has_role(org_id, array['owner']));

-- Read: any active member of the org. Write: owner / procurement manager.
do $$ declare t text; begin
  foreach t in array array['categories','suppliers','supplier_contacts','materials','rfqs','rfq_items','rfq_invites',
    'quotations','quotation_lines','purchase_orders','po_lines'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_member(org_id))', t||'_read', t);
    execute format($p$create policy %I on public.%I for all to authenticated
      using (public.has_role(org_id, array['owner','procurement_manager']))
      with check (public.has_role(org_id, array['owner','procurement_manager']))$p$, t||'_write', t);
  end loop;
end $$;

-- Purchase requests: anyone can raise one as themselves; the requester edits it while it is a draft.
alter table public.purchase_requests enable row level security;
create policy pr_read on public.purchase_requests for select to authenticated using (public.is_member(org_id));
create policy pr_insert on public.purchase_requests for insert to authenticated
  with check (public.is_member(org_id) and requester_id = (select auth.uid()));
create policy pr_update on public.purchase_requests for update to authenticated
  using ((requester_id = (select auth.uid()) and status = 'draft') or public.has_role(org_id, array['owner','procurement_manager']))
  with check (public.is_member(org_id));
create policy pr_delete on public.purchase_requests for delete to authenticated
  using (requester_id = (select auth.uid()) and status = 'draft');

alter table public.request_items enable row level security;
create policy ri_read on public.request_items for select to authenticated using (public.is_member(org_id));
create policy ri_write on public.request_items for all to authenticated
  using (exists (select 1 from public.purchase_requests r where r.id = request_id
                 and ((r.requester_id = (select auth.uid()) and r.status = 'draft') or public.has_role(r.org_id, array['owner','procurement_manager']))))
  with check (public.is_member(org_id));

-- Approvals: only the named approver can decide their own step.
alter table public.approval_steps enable row level security;
create policy as_read on public.approval_steps for select to authenticated using (public.is_member(org_id));
create policy as_decide on public.approval_steps for update to authenticated
  using (approver_id = (select auth.uid()) and status = 'pending')
  with check (approver_id = (select auth.uid()));
create policy as_manage on public.approval_steps for insert to authenticated
  with check (public.has_role(org_id, array['owner','procurement_manager']));

alter table public.approval_rules enable row level security;
create policy rules_read on public.approval_rules for select to authenticated using (public.is_member(org_id));
create policy rules_write on public.approval_rules for all to authenticated
  using (public.has_role(org_id, array['owner','finance_manager'])) with check (public.has_role(org_id, array['owner','finance_manager']));

alter table public.invitations enable row level security;
create policy inv_owner on public.invitations for all to authenticated
  using (public.has_role(org_id, array['owner'])) with check (public.has_role(org_id, array['owner']));

alter table public.insights enable row level security;
create policy ins_read on public.insights for select to authenticated using (public.is_member(org_id));
create policy ins_update on public.insights for update to authenticated
  using (public.has_role(org_id, array['owner','procurement_manager','finance_manager']))
  with check (public.is_member(org_id));

alter table public.notifications enable row level security;
create policy notif_own on public.notifications for select to authenticated using (user_id = (select auth.uid()));
create policy notif_mark on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Audit log: owner and finance can read; members can only add entries as themselves; nobody can edit or delete.
alter table public.audit_log enable row level security;
create policy audit_read on public.audit_log for select to authenticated
  using (public.has_role(org_id, array['owner','finance_manager']));
create policy audit_insert on public.audit_log for insert to authenticated
  with check (public.is_member(org_id) and actor_id = (select auth.uid()));
revoke update, delete, truncate on public.audit_log from authenticated;
