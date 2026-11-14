-- Vendora database lock (migration 11). Run AFTER migrations 1-10. Safe to run twice.
--
-- Buyers and suppliers are two separate products. Earlier migrations already lock most of the line (the browser cannot
-- write supplier tables, and every buyer/supplier function checks which side the caller is on). An attack run against all
-- ten migrations found three gaps, closed here:
--
--   1. SUPPLIER COMPANIES COULD WRITE BUYER TABLES. The buyer tables (requests, RFQs, purchase orders, materials, the
--      buyer's own supplier list, approval rules ...) only asked "are you an owner / procurement manager of this company?".
--      They never asked what KIND of company it is, so a supplier owner could create purchase orders inside their own
--      supplier company. Now every one of those tables carries a RESTRICTIVE policy: a row can only be touched when its
--      company is a buyer. A restrictive policy is added on top of the existing rules and cannot be bypassed by them.
--      (Future supplier-side features that must write into these tables do it through checked functions, never directly.)
--
--   2. A VERIFIED SUPPLIER COULD CHANGE WHO THEY ARE. The company name, GSTIN and state could be edited by the owner at
--      any time, so a supplier verified as "Kaveri Industrial" could rename itself to someone else's name and keep the
--      Verified badge. While a supplier holds a verified, unexpired registration, those three fields are now locked for
--      every signed-in user. (Server-side tools, which have no signed-in user, can still correct them after a re-check.)
--
--   3. TOO MANY TABLE POWERS. Signed-in users had TRUNCATE (which skips row level security), REFERENCES and TRIGGER on every
--      table. The app never needs them. They are removed, and new tables will not get them by default.

-- ───────────── 1. buyer tables belong to buyer companies only ─────────────
create or replace function public._is_buyer_org(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.businesses b where b.id = p_org and b.kind = 'buyer')
$$;
revoke all on function public._is_buyer_org(uuid) from public, anon;
grant execute on function public._is_buyer_org(uuid) to authenticated;

do $$ declare t text; begin
  foreach t in array array['categories', 'suppliers', 'supplier_contacts', 'materials', 'rfqs', 'rfq_items', 'rfq_invites',
    'quotations', 'quotation_lines', 'purchase_orders', 'po_lines', 'purchase_requests', 'request_items',
    'approval_steps', 'approval_rules', 'insights']
  loop
    execute format('drop policy if exists buyer_side_only on public.%I', t);
    execute format($p$create policy buyer_side_only on public.%I as restrictive for all to authenticated
      using (public._is_buyer_org(org_id)) with check (public._is_buyer_org(org_id))$p$, t);
  end loop;
end $$;

-- ───────────── 2. a verified supplier cannot change who they are ─────────────
create or replace function public.guard_supplier_identity()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.kind = 'supplier'
     and (new.name is distinct from old.name or new.gstin is distinct from old.gstin or new.state is distinct from old.state)
     and (select auth.uid()) is not null      -- server-side tools (no signed-in user) are not blocked
     and exists (select 1 from public.verification_checks c
                  where c.org_id = old.id and c.type = 'registration' and c.status = 'verified'
                    and (c.expires_at is null or c.expires_at >= current_date))
  then
    raise exception 'identity_locked: a verified supplier cannot change its name, GSTIN or state. Contact Vendora support to re-verify.';
  end if;
  return new;
end $$;
revoke all on function public.guard_supplier_identity() from public, anon, authenticated;

drop trigger if exists guard_supplier_identity on public.businesses;
create trigger guard_supplier_identity before update on public.businesses
  for each row execute function public.guard_supplier_identity();

-- ───────────── 3. remove table powers the app never uses ─────────────
do $$ declare t text; begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind in ('r', 'p')
  loop
    execute format('revoke truncate, references, trigger on public.%I from anon, authenticated', t);
  end loop;
end $$;
revoke all on all tables in schema public from anon;
alter default privileges in schema public revoke truncate, references, trigger on tables from anon, authenticated;

notify pgrst, 'reload schema';
