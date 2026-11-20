-- Migration 20 — MSME 45-day payment tracker.
--
-- THE RULE (Income-tax Act s.43B(h), in force since 1 April 2024; carried into s.37(2)(g) of the Income-tax Act 2025):
--   * A buyer may deduct what it owes a MICRO or SMALL supplier only in the year it actually PAYS, if it pays late.
--   * Late = after the agreed period, which can never be more than 45 days (15 days if there is no written agreement),
--     counted from the day the goods are accepted (or deemed accepted).
--   * Medium suppliers and pure traders are outside the rule. So the SUPPLIER TYPE decides everything, and we only treat a supplier
--     as covered after a human has checked its Udyam certificate (a new proof on the Trust Passport).
--   * The supplier may also claim interest: three times the RBI bank rate, compounded monthly (MSMED Act s.16). Shown as an ESTIMATE.
--
-- WHAT THIS ADDS
--   1. A fifth Trust Passport proof: Udyam registration (number, size, activity), checked by a person like the other proofs.
--   2. Payments recorded by the buyer, confirmed or disputed by the supplier.
--   3. One function (_po_pay_state) that works out, for any order, whether the rule applies, the deadline, the days left,
--      the estimated interest and whether this year's tax deduction is at risk. The browser never calculates any of it.
--   4. A buyer tracker (what to pay, in what order, what happens if you don't) and a supplier tracker (when will I be paid).
--   5. Written objections (the 15-day acceptance window), and reminders before a deadline.
--
-- This is information, not legal or tax advice. The pages say so, and show which assumptions were used.

-- ───────── 1. the Udyam proof ─────────
alter table public.verification_checks drop constraint if exists verification_checks_type_check;
alter table public.verification_checks add constraint verification_checks_type_check
  check (type in ('registration', 'address', 'bank', 'certificate', 'udyam'));
alter table public.verification_checks add column if not exists udyam_size text
  check (udyam_size is null or udyam_size in ('micro', 'small', 'medium'));
alter table public.verification_checks add column if not exists udyam_activity text
  check (udyam_activity is null or udyam_activity in ('manufacturing', 'services', 'trade'));
alter table public.verification_checks drop constraint if exists verification_checks_udyam_fields;
alter table public.verification_checks add constraint verification_checks_udyam_fields
  check (type <> 'udyam' or (udyam_size is not null and udyam_activity is not null));
create unique index if not exists verification_checks_udyam_unique
  on public.verification_checks (reference) where type = 'udyam' and status = 'verified';

create or replace function public.start_udyam_check(p_org uuid, p_number text, p_size text, p_activity text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_no text := upper(regexp_replace(coalesce(p_number, ''), '\s', '', 'g')); v_id uuid; v_size text := lower(btrim(coalesce(p_size, '')));
        v_act text := lower(btrim(coalesce(p_activity, '')));
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated'; end if;
  if not public._can_manage_proofs(p_org) then raise exception 'not_allowed'; end if;
  if v_no !~ '^UDYAM-[A-Z]{2}-[0-9]{2}-[0-9]{7}$' then raise exception 'invalid_udyam: it looks like UDYAM-MH-12-1234567'; end if;
  if v_size not in ('micro', 'small', 'medium') then raise exception 'invalid_size: choose micro, small or medium'; end if;
  if v_act not in ('manufacturing', 'services', 'trade') then raise exception 'invalid_activity: choose manufacturing, services or trade'; end if;
  if exists (select 1 from public.verification_checks where type = 'udyam' and status = 'verified' and reference = v_no and org_id <> p_org) then
    raise exception 'udyam_in_use: this Udyam number is already verified for another company';
  end if;
  delete from public.verification_checks where org_id = p_org and type = 'udyam' and status = 'draft';
  insert into public.verification_checks (org_id, type, label, reference, udyam_size, udyam_activity, submitted_by)
    values (p_org, 'udyam', 'Udyam · ' || initcap(v_size) || ' · ' || initcap(v_act), v_no, v_size, v_act, (select auth.uid()))
    returning id into v_id;
  return v_id;
end $$;

-- What a verified, unexpired Udyam proof says about a supplier (null when there is none).
create or replace function public._udyam_of(p_org uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('number', c.reference, 'size', c.udyam_size, 'activity', c.udyam_activity, 'verified_on', c.reviewed_at::date)
    from public.verification_checks c
   where c.org_id = p_org and c.type = 'udyam' and c.status = 'verified' and (c.expires_at is null or c.expires_at >= current_date)
   order by c.reviewed_at desc limit 1
$$;

-- The Trust Passport now carries the Udyam proof (size and activity are shown, the certificate itself is not).
create or replace function public._passport_core(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_level int; v_checks jsonb;
begin
  v_level := public._trust_level(p_org);
  select coalesce(jsonb_agg(jsonb_build_object(
      'type', c.type, 'label', case when c.type = 'certificate' then c.label else '' end,
      'reference', case when c.type in ('registration', 'certificate', 'udyam') then c.reference else '' end,
      'issuer', case when c.type = 'certificate' then c.issuer else '' end,
      'verified_on', c.reviewed_at::date, 'expires_at', c.expires_at,
      'evidence', case when gov then 'government_record' else 'document_reviewed' end,
      'record_checked_on', case when gov then (c.lookup ->> 'fetched_at')::timestamptz::date end)
      || case when c.type = 'udyam' then jsonb_build_object('size', c.udyam_size, 'activity', c.udyam_activity) else '{}'::jsonb end
    order by case c.type when 'registration' then 1 when 'address' then 2 when 'bank' then 3 when 'udyam' then 4 else 5 end, c.label), '[]'::jsonb)
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

create or replace function public.get_trust_passport(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from public.businesses b where b.id = p_org and b.kind = 'supplier') then raise exception 'not_found'; end if;
  return public._passport_core(p_org);
end $$;

-- ───────── 2. storage ─────────
alter table public.purchase_orders add column if not exists objection_at timestamptz;
alter table public.purchase_orders add column if not exists objection_note text not null default '';
alter table public.purchase_orders add column if not exists objection_cleared_at timestamptz;

create table if not exists public.po_payments (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.businesses(id) on delete cascade,      -- the buyer
  po_id         uuid not null references public.purchase_orders(id) on delete cascade,
  amount        numeric(14,2) not null check (amount > 0),
  paid_on       date not null,
  method        text not null check (method in ('bank_transfer', 'upi', 'cheque', 'other')),
  reference     text not null default '' check (char_length(reference) <= 100),
  note          text not null default '' check (char_length(note) <= 300),
  recorded_by   uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  confirmed_at  timestamptz,
  confirmed_by  uuid references auth.users(id) on delete set null,
  disputed_at   timestamptz,
  dispute_note  text not null default '' check (char_length(dispute_note) <= 500)
);
create index if not exists po_payments_po_idx on public.po_payments (po_id);
create index if not exists po_payments_org_idx on public.po_payments (org_id);
alter table public.po_payments enable row level security;
revoke all on public.po_payments from public, anon, authenticated;

create table if not exists public.po_payment_alerts (
  po_id   uuid not null references public.purchase_orders(id) on delete cascade,
  kind    text not null check (kind in ('due_soon', 'due_today', 'overdue', 'year_end')),
  sent_at timestamptz not null default now(),
  primary key (po_id, kind)
);
alter table public.po_payment_alerts enable row level security;
revoke all on public.po_payment_alerts from public, anon, authenticated;

-- One row: the RBI bank rate used for the interest ESTIMATE. A platform admin updates it when the RBI changes it.
create table if not exists public.msme_settings (
  id        int primary key default 1 check (id = 1),
  bank_rate numeric(5,2) not null check (bank_rate between 0 and 25),
  as_of     date not null
);
insert into public.msme_settings (id, bank_rate, as_of) values (1, 5.75, date '2026-11-01') on conflict (id) do nothing;
alter table public.msme_settings enable row level security;
revoke all on public.msme_settings from public, anon, authenticated;

-- ───────── 3. the one place that decides ─────────
-- Financial year (April to March) in which a date falls: returns the 31 March that ends it.
create or replace function public._fy_end(p_day date)
returns date language sql immutable set search_path = '' as $$
  select make_date(extract(year from p_day)::int + case when extract(month from p_day) >= 4 then 1 else 0 end, 3, 31)
$$;

create or replace function public._po_pay_state(p_po uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  o public.purchase_orders; u jsonb; v_rate numeric; v_total numeric; v_paid numeric; v_bal numeric; v_last date;
  v_applies text; v_why text; v_written boolean; v_agreed int; v_days int; v_capped boolean := false;
  v_accept date; v_due date; v_proj boolean := false; v_phase text; v_status text; v_left int; v_fy date;
  v_interest numeric := 0; v_ded text := 'na'; v_hold boolean; v_late_paid numeric := 0; r record;
begin
  select * into o from public.purchase_orders where id = p_po;
  if not found then return null; end if;
  v_total := (public._po_amounts(p_po) ->> 'total')::numeric;
  select coalesce(sum(amount), 0), max(paid_on) into v_paid, v_last from public.po_payments where po_id = p_po;
  v_bal := greatest(v_total - v_paid, 0);
  select bank_rate into v_rate from public.msme_settings where id = 1;

  -- 1. does the rule cover this supplier?
  u := public._udyam_of(o.supplier_org);
  if u is null then v_applies := 'unknown'; v_why := 'no_udyam';
  elsif u ->> 'size' = 'medium' then v_applies := 'no'; v_why := 'medium';
  elsif u ->> 'activity' = 'trade' then v_applies := 'no'; v_why := 'trader';
  else v_applies := 'yes'; v_why := u ->> 'size'; end if;

  -- 2. the clock starts when the buyer accepts the goods; a written objection within 15 days holds it until the objection is cleared
  v_written := o.acknowledged_at is not null;
  v_agreed := o.payment_terms_days;
  v_hold := o.objection_at is not null and o.objection_cleared_at is null;
  if o.delivered_at is not null then
    v_accept := case when o.objection_cleared_at is not null then o.objection_cleared_at::date else o.delivered_at::date end;
  end if;
  if v_applies = 'no' then v_days := v_agreed;
  elsif v_written then v_days := least(v_agreed, 45); v_capped := v_agreed > 45;
  else v_days := least(v_agreed, 15); v_capped := v_agreed > 15; end if;

  if v_accept is not null and not v_hold then v_due := v_accept + v_days;
  elsif v_accept is null and o.expected_at is not null then v_due := o.expected_at + v_days; v_proj := true; end if;

  v_phase := case
    when o.status not in ('acknowledged', 'partially_received', 'received', 'closed') then 'none'
    when o.delivered_at is null then 'awaiting_delivery'
    when v_hold then 'on_hold'
    else 'running' end;

  v_status := case
    when v_phase = 'none' then 'none'
    when v_phase = 'awaiting_delivery' then 'not_started'
    when v_phase = 'on_hold' then 'on_hold'
    when v_bal = 0 then case when v_last > v_due then 'paid_late' else 'paid' end
    when v_due < current_date then 'overdue'
    when v_due = current_date then 'due_today'
    when v_due - current_date <= 7 then 'due_soon'
    else 'on_track' end;
  v_left := case when v_phase = 'running' and v_bal > 0 then v_due - current_date end;

  -- 3. estimated interest (3 x bank rate, compounded monthly): on late payments already made and on what is still unpaid and overdue
  if v_applies = 'yes' and v_due is not null and not v_proj and v_phase = 'running' then
    for r in select amount, paid_on from public.po_payments where po_id = p_po and paid_on > v_due loop
      v_interest := v_interest + r.amount * (power(1 + 3 * v_rate / 1200, (r.paid_on - v_due) / 30.4375) - 1);
    end loop;
    if v_bal > 0 and v_due < current_date then
      v_interest := v_interest + v_bal * (power(1 + 3 * v_rate / 1200, (current_date - v_due) / 30.4375) - 1);
    end if;
  end if;

  -- 4. this year's tax deduction (only the buyer cares): lost for the year if still unpaid at 31 March when the due date has passed by then
  if v_applies = 'yes' and v_phase = 'running' then
    v_fy := public._fy_end(v_accept);
    v_ded := case
      when v_bal = 0 then case when v_last > v_fy and v_due <= v_fy then 'deferred' else 'safe' end
      when v_due > v_fy then 'safe'
      when current_date <= v_fy then 'at_risk'
      else 'deferred' end;
  end if;

  return jsonb_build_object(
    'phase', v_phase, 'status', v_status,
    'applies', v_applies, 'applies_why', v_why, 'udyam', u,
    'total', v_total, 'paid', v_paid, 'balance', v_bal, 'last_paid_on', v_last,
    'agreed_days', v_agreed, 'due_days', v_days, 'capped', v_capped, 'written_agreement', v_written,
    'accepted_on', v_accept, 'due_date', v_due, 'projected', v_proj, 'days_left', v_left,
    'on_hold', v_hold, 'objection_at', o.objection_at, 'objection_note', o.objection_note,
    'objection_open_until', case when o.delivered_at is not null and o.objection_at is null then o.delivered_at::date + 15 end,
    'interest_estimate', round(v_interest, 2), 'bank_rate', v_rate,
    'fy_end', v_fy, 'deduction', v_ded,
    'disputed_payments', (select count(*) from public.po_payments where po_id = p_po and disputed_at is not null and confirmed_at is null));
end $$;

-- ───────── 4. buyer side ─────────
create or replace function public.get_msme_rules()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated'; end if;
  return jsonb_build_object('max_days', 45, 'max_days_no_agreement', 15, 'objection_days', 15, 'effective_from', '2024-04-01',
    'interest_multiple', 3, 'bank_rate', (select bank_rate from public.msme_settings where id = 1),
    'bank_rate_as_of', (select as_of from public.msme_settings where id = 1));
end $$;

create or replace function public.set_msme_bank_rate(p_rate numeric, p_as_of date default current_date)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() then raise exception 'not_allowed'; end if;
  if p_rate is null or p_rate < 0 or p_rate > 25 then raise exception 'invalid_rate'; end if;
  update public.msme_settings set bank_rate = p_rate, as_of = coalesce(p_as_of, current_date) where id = 1;
end $$;

create or replace function public.list_payables(p_org uuid, p_filter text default 'all')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_filter text := coalesce(nullif(btrim(p_filter), ''), 'all'); v_out jsonb;
begin
  perform public._req_guard(p_org);
  if v_filter not in ('all', 'attention', 'open', 'paid') then raise exception 'invalid_filter'; end if;
  with s as materialized (
    select o.id, o.number, o.title, o.supplier_org as supplier_id, b.name as supplier_name, public._po_pay_state(o.id) as st, o.issued_at
      from public.purchase_orders o join public.businesses b on b.id = o.supplier_org
     where o.org_id = p_org and o.supplier_org is not null and o.status in ('acknowledged', 'partially_received', 'received', 'closed'))
  select jsonb_build_object(
    'summary', (select jsonb_build_object(
      'overdue_count',  count(*) filter (where st ->> 'status' = 'overdue'),
      'overdue_amount', coalesce(sum((st ->> 'balance')::numeric) filter (where st ->> 'status' = 'overdue'), 0),
      'due_soon_count', count(*) filter (where st ->> 'status' in ('due_soon', 'due_today')),
      'due_soon_amount', coalesce(sum((st ->> 'balance')::numeric) filter (where st ->> 'status' in ('due_soon', 'due_today')), 0),
      'at_risk_count',  count(*) filter (where st ->> 'deduction' = 'at_risk'),
      'at_risk_amount', coalesce(sum((st ->> 'balance')::numeric) filter (where st ->> 'deduction' = 'at_risk'), 0),
      'open_amount',    coalesce(sum((st ->> 'balance')::numeric) filter (where st ->> 'phase' in ('running', 'on_hold')), 0),
      'interest_estimate', coalesce(sum((st ->> 'interest_estimate')::numeric), 0),
      'unknown_count',  count(*) filter (where st ->> 'applies' = 'unknown' and (st ->> 'balance')::numeric > 0 and st ->> 'phase' <> 'none'),
      'paid_count',     count(*) filter (where st ->> 'status' in ('paid', 'paid_late')),
      'year_end',       public._fy_end(current_date)) from s),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'number', number, 'title', title, 'supplier_id', supplier_id,
           'supplier_name', supplier_name, 'state', st) order by
           case st ->> 'status' when 'overdue' then 0 when 'due_today' then 1 when 'due_soon' then 2 when 'on_hold' then 3 when 'on_track' then 4
                                when 'not_started' then 5 else 6 end,
           (st ->> 'due_date'), issued_at desc, id), '[]'::jsonb)
      from s
     where case v_filter
             when 'attention' then st ->> 'status' in ('overdue', 'due_today', 'due_soon') or st ->> 'deduction' = 'at_risk'
             when 'open' then st ->> 'status' in ('on_track', 'due_soon', 'due_today', 'overdue', 'on_hold', 'not_started')
             when 'paid' then st ->> 'status' in ('paid', 'paid_late')
             else true end),
    'rules', public.get_msme_rules()) into v_out;
  return v_out;
end $$;

create or replace function public.get_po_payment(p_po uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare o public.purchase_orders; v_role text; v_state jsonb;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated'; end if;
  select * into o from public.purchase_orders where id = p_po and supplier_org is not null and public._req_role(org_id) is not null;
  if not found then raise exception 'not_found'; end if;
  v_role := public._req_role(o.org_id);
  v_state := public._po_pay_state(o.id);
  return jsonb_build_object('state', v_state, 'rules', public.get_msme_rules(),
    'payments', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'amount', p.amount, 'paid_on', p.paid_on, 'method', p.method,
                    'reference', p.reference, 'note', p.note, 'recorded_by', public._display_name(p.recorded_by), 'confirmed_at', p.confirmed_at,
                    'disputed_at', p.disputed_at, 'dispute_note', p.dispute_note,
                    'can_void', p.confirmed_at is null and p.created_at > now() - interval '24 hours' and v_role in ('owner', 'procurement_manager', 'finance_manager'))
                    order by p.paid_on, p.created_at), '[]'::jsonb) from public.po_payments p where p.po_id = o.id),
    'can_record', v_role in ('owner', 'procurement_manager', 'finance_manager') and o.delivered_at is not null and (v_state ->> 'balance')::numeric > 0,
    'can_object', v_role in ('owner', 'procurement_manager') and o.delivered_at is not null and o.objection_at is null
                  and current_date <= o.delivered_at::date + 15 and not exists (select 1 from public.po_payments where po_id = o.id),
    'can_clear_objection', v_role in ('owner', 'procurement_manager') and o.objection_at is not null and o.objection_cleared_at is null);
end $$;

create or replace function public.record_po_payment(p_po uuid, p_amount numeric, p_paid_on date default null, p_method text default 'bank_transfer',
                                                    p_reference text default '', p_note text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare o public.purchase_orders; v_role text; v_bal numeric; v_day date; v_ref text := btrim(coalesce(p_reference, '')); v_note text := btrim(coalesce(p_note, ''));
        v_id uuid; v_buyer text; v_amt numeric; v_after numeric;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated'; end if;
  select * into o from public.purchase_orders where id = p_po and supplier_org is not null for update;
  if not found then raise exception 'not_found'; end if;
  v_role := public._req_role(o.org_id);
  if v_role is null then raise exception 'not_found'; end if;
  if v_role not in ('owner', 'procurement_manager', 'finance_manager') then raise exception 'not_allowed'; end if;
  if o.delivered_at is null then raise exception 'not_delivered: record the delivery first'; end if;
  if p_method not in ('bank_transfer', 'upi', 'cheque', 'other') then raise exception 'invalid_method'; end if;
  if char_length(v_ref) > 100 or char_length(v_note) > 300 then raise exception 'invalid_text'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'invalid_amount'; end if;
  v_amt := round(p_amount, 2);
  if v_amt <= 0 then raise exception 'invalid_amount'; end if;
  v_day := coalesce(p_paid_on, current_date);
  if v_day > current_date or v_day < o.delivered_at::date then raise exception 'invalid_date: the payment date must be between delivery and today'; end if;
  if (select count(*) from public.po_payments where po_id = o.id) >= 50 then raise exception 'too_many_payments'; end if;
  v_bal := (public._po_pay_state(o.id) ->> 'balance')::numeric;
  if v_bal <= 0 then raise exception 'already_paid'; end if;
  if v_amt > v_bal then raise exception 'too_much: only % is still owed', v_bal; end if;

  insert into public.po_payments (org_id, po_id, amount, paid_on, method, reference, note, recorded_by)
    values (o.org_id, o.id, v_amt, v_day, p_method, v_ref, v_note, (select auth.uid())) returning id into v_id;
  v_after := v_bal - v_amt;
  select name into v_buyer from public.businesses where id = o.org_id;
  perform public._po_notify_supplier(o.supplier_org,
    v_buyer || case when v_after = 0 then ' paid an order in full' else ' recorded a payment' end,
    o.number || ' · ' || o.title || ' · ' || to_char(v_amt, 'FM999G999G990D00') || ' on ' || to_char(v_day, 'DD Mon YYYY') || ' · please confirm you received it', o.id);
  perform public._audit(o.org_id, 'po_payment_recorded', 'purchase_order', o.id, jsonb_build_object('payment', v_id, 'amount', v_amt, 'balance_after', v_after));
  perform public._audit(o.supplier_org, 'po_payment_received', 'purchase_order', o.id, jsonb_build_object('payment', v_id, 'amount', v_amt));
  return jsonb_build_object('id', v_id, 'balance', v_after, 'fully_paid', v_after = 0);
end $$;

-- A mistake can be undone for 24 hours, and only while the supplier has not confirmed the money arrived.
create or replace function public.void_po_payment(p_payment uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare p public.po_payments; o public.purchase_orders;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated'; end if;
  select * into p from public.po_payments where id = p_payment for update;
  if not found or public._req_role(p.org_id) is null then raise exception 'not_found'; end if;
  if public._req_role(p.org_id) not in ('owner', 'procurement_manager', 'finance_manager') then raise exception 'not_allowed'; end if;
  if p.confirmed_at is not null then raise exception 'already_confirmed'; end if;
  if p.created_at < now() - interval '24 hours' then raise exception 'too_late: a payment can be removed within 24 hours'; end if;
  select * into o from public.purchase_orders where id = p.po_id;
  delete from public.po_payments where id = p.id;
  perform public._po_notify_supplier(o.supplier_org, 'A recorded payment was removed', o.number || ' · ' || o.title, o.id);
  perform public._audit(p.org_id, 'po_payment_voided', 'purchase_order', o.id, jsonb_build_object('amount', p.amount));
  perform public._audit(o.supplier_org, 'po_payment_voided', 'purchase_order', o.id, jsonb_build_object('amount', p.amount));
end $$;

-- A written objection within 15 days of delivery (goods not as ordered). The supplier sees it and the reason.
create or replace function public.raise_po_objection(p_po uuid, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare o public.purchase_orders; v_note text := btrim(coalesce(p_note, '')); v_buyer text;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated'; end if;
  select * into o from public.purchase_orders where id = p_po and supplier_org is not null for update;
  if not found or public._req_role(o.org_id) is null then raise exception 'not_found'; end if;
  if public._req_role(o.org_id) not in ('owner', 'procurement_manager') then raise exception 'not_allowed'; end if;
  if o.delivered_at is null then raise exception 'not_delivered'; end if;
  if o.objection_at is not null then raise exception 'already_objected'; end if;
  if exists (select 1 from public.po_payments where po_id = o.id) then raise exception 'already_paid: part of this order has been paid, so it was accepted'; end if;
  if current_date > o.delivered_at::date + 15 then raise exception 'too_late: an objection must be raised within 15 days of delivery'; end if;
  if char_length(v_note) < 10 or char_length(v_note) > 500 then raise exception 'note_required: say what is wrong (10 to 500 characters)'; end if;
  update public.purchase_orders set objection_at = now(), objection_note = v_note, objection_cleared_at = null where id = o.id;
  select name into v_buyer from public.businesses where id = o.org_id;
  perform public._po_notify_supplier(o.supplier_org, v_buyer || ' raised an objection to a delivery', o.number || ' · ' || v_note, o.id);
  perform public._audit(o.org_id, 'po_objection_raised', 'purchase_order', o.id, '{}'::jsonb);
  perform public._audit(o.supplier_org, 'po_objection_raised', 'purchase_order', o.id, '{}'::jsonb);
  return public._po_pay_state(o.id);
end $$;

-- The objection is settled: the goods are accepted from today and the payment clock starts.
create or replace function public.clear_po_objection(p_po uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare o public.purchase_orders; v_buyer text;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated'; end if;
  select * into o from public.purchase_orders where id = p_po and supplier_org is not null for update;
  if not found or public._req_role(o.org_id) is null then raise exception 'not_found'; end if;
  if public._req_role(o.org_id) not in ('owner', 'procurement_manager') then raise exception 'not_allowed'; end if;
  if o.objection_at is null or o.objection_cleared_at is not null then raise exception 'no_objection'; end if;
  update public.purchase_orders set objection_cleared_at = now() where id = o.id;
  select name into v_buyer from public.businesses where id = o.org_id;
  perform public._po_notify_supplier(o.supplier_org, v_buyer || ' accepted the goods after an objection', o.number || ' · the payment period starts today', o.id);
  perform public._audit(o.org_id, 'po_objection_cleared', 'purchase_order', o.id, '{}'::jsonb);
  perform public._audit(o.supplier_org, 'po_objection_cleared', 'purchase_order', o.id, '{}'::jsonb);
  return public._po_pay_state(o.id);
end $$;

-- ───────── 5. supplier side ─────────
create or replace function public.list_receivables(p_org uuid, p_filter text default 'all')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_filter text := coalesce(nullif(btrim(p_filter), ''), 'all'); v_out jsonb; u jsonb;
begin
  perform public._quote_guard(p_org);
  if v_filter not in ('all', 'attention', 'open', 'paid') then raise exception 'invalid_filter'; end if;
  u := public._udyam_of(p_org);
  with s as materialized (
    select o.id, o.number, o.title, b.name as buyer_name, public._po_pay_state(o.id) as st, o.issued_at
      from public.purchase_orders o join public.businesses b on b.id = o.org_id
     where o.supplier_org = p_org and o.status in ('acknowledged', 'partially_received', 'received', 'closed'))
  select jsonb_build_object(
    'summary', (select jsonb_build_object(
      'overdue_count',  count(*) filter (where st ->> 'status' = 'overdue'),
      'overdue_amount', coalesce(sum((st ->> 'balance')::numeric) filter (where st ->> 'status' = 'overdue'), 0),
      'due_soon_count', count(*) filter (where st ->> 'status' in ('due_soon', 'due_today')),
      'due_soon_amount', coalesce(sum((st ->> 'balance')::numeric) filter (where st ->> 'status' in ('due_soon', 'due_today')), 0),
      'expected_amount', coalesce(sum((st ->> 'balance')::numeric) filter (where st ->> 'phase' in ('running', 'on_hold', 'awaiting_delivery')), 0),
      'interest_estimate', coalesce(sum((st ->> 'interest_estimate')::numeric), 0),
      'to_confirm',     (select count(*) from public.po_payments p join s r on r.id = p.po_id where p.confirmed_at is null and p.disputed_at is null),
      'paid_count',     count(*) filter (where st ->> 'status' in ('paid', 'paid_late')),
      'covered',        u is not null and u ->> 'size' <> 'medium' and u ->> 'activity' <> 'trade',
      'udyam',          u) from s),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'number', number, 'title', title, 'buyer_name', buyer_name, 'state', st) order by
           case st ->> 'status' when 'overdue' then 0 when 'due_today' then 1 when 'due_soon' then 2 when 'on_hold' then 3 when 'on_track' then 4
                                when 'not_started' then 5 else 6 end,
           (st ->> 'due_date'), issued_at desc, id), '[]'::jsonb)
      from s
     where case v_filter
             when 'attention' then st ->> 'status' in ('overdue', 'due_today', 'due_soon', 'on_hold')
             when 'open' then st ->> 'status' in ('on_track', 'due_soon', 'due_today', 'overdue', 'on_hold', 'not_started')
             when 'paid' then st ->> 'status' in ('paid', 'paid_late')
             else true end),
    'rules', public.get_msme_rules()) into v_out;
  return v_out;
end $$;

create or replace function public.get_supplier_po_payment(p_org uuid, p_po uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare o public.purchase_orders; v_role text;
begin
  v_role := public._quote_guard(p_org);
  select * into o from public.purchase_orders where id = p_po and supplier_org = p_org;
  if not found then raise exception 'not_found'; end if;
  return jsonb_build_object('state', public._po_pay_state(o.id), 'rules', public.get_msme_rules(),
    'payments', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'amount', p.amount, 'paid_on', p.paid_on, 'method', p.method,
                    'reference', p.reference, 'note', p.note, 'confirmed_at', p.confirmed_at, 'disputed_at', p.disputed_at, 'dispute_note', p.dispute_note,
                    'can_respond', p.confirmed_at is null and v_role in ('owner', 'procurement_manager')) order by p.paid_on, p.created_at), '[]'::jsonb)
                   from public.po_payments p where p.po_id = o.id));
end $$;

create or replace function public.confirm_po_payment(p_org uuid, p_payment uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare p public.po_payments; o public.purchase_orders; v_role text; v_sup text;
begin
  v_role := public._quote_guard(p_org);
  if v_role not in ('owner', 'procurement_manager') then raise exception 'not_allowed'; end if;
  select * into p from public.po_payments where id = p_payment for update;
  if not found then raise exception 'not_found'; end if;
  select * into o from public.purchase_orders where id = p.po_id;
  if o.supplier_org <> p_org then raise exception 'not_found'; end if;
  if p.confirmed_at is not null then return; end if;
  update public.po_payments set confirmed_at = now(), confirmed_by = (select auth.uid()), disputed_at = null, dispute_note = '' where id = p.id;
  select name into v_sup from public.businesses where id = p_org;
  perform public._po_notify_buyer(o.org_id, p.recorded_by, v_sup || ' confirmed your payment', o.number || ' · ' || to_char(p.amount, 'FM999G999G990D00'), o.id);
  perform public._audit(p_org, 'po_payment_confirmed', 'purchase_order', o.id, jsonb_build_object('payment', p.id));
  perform public._audit(o.org_id, 'po_payment_confirmed', 'purchase_order', o.id, jsonb_build_object('payment', p.id));
end $$;

create or replace function public.dispute_po_payment(p_org uuid, p_payment uuid, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare p public.po_payments; o public.purchase_orders; v_role text; v_note text := btrim(coalesce(p_note, '')); v_sup text;
begin
  v_role := public._quote_guard(p_org);
  if v_role not in ('owner', 'procurement_manager') then raise exception 'not_allowed'; end if;
  if char_length(v_note) < 5 or char_length(v_note) > 500 then raise exception 'note_required: say what is wrong (5 to 500 characters)'; end if;
  select * into p from public.po_payments where id = p_payment for update;
  if not found then raise exception 'not_found'; end if;
  select * into o from public.purchase_orders where id = p.po_id;
  if o.supplier_org <> p_org then raise exception 'not_found'; end if;
  if p.confirmed_at is not null then raise exception 'already_confirmed'; end if;
  update public.po_payments set disputed_at = now(), dispute_note = v_note where id = p.id;
  select name into v_sup from public.businesses where id = p_org;
  perform public._po_notify_buyer(o.org_id, p.recorded_by, v_sup || ' says a recorded payment did not arrive', o.number || ' · ' || v_note, o.id);
  perform public._audit(p_org, 'po_payment_disputed', 'purchase_order', o.id, jsonb_build_object('payment', p.id));
  perform public._audit(o.org_id, 'po_payment_disputed', 'purchase_order', o.id, jsonb_build_object('payment', p.id));
end $$;

-- ───────── 6. reminders (run daily, like refresh_trust_passports) ─────────
-- Warns the buyer before the deadline, the day it falls, and when it is missed (the supplier is told too).
-- Each warning is sent once per order. Orders whose supplier has no verified Udyam proof are never nagged: we do not know the rule applies.
create or replace function public.run_payment_reminders()
returns int language plpgsql security definer set search_path = '' as $$
declare r record; st jsonb; v_kind text; n int := 0; v_ins int; v_left int; v_amt text;
begin
  for r in select o.id, o.org_id, o.supplier_org, o.created_by, o.number, o.title from public.purchase_orders o
            where o.supplier_org is not null and o.status in ('acknowledged', 'partially_received', 'received', 'closed') and o.delivered_at is not null loop
    st := public._po_pay_state(r.id);
    if st ->> 'applies' <> 'yes' or st ->> 'phase' <> 'running' or (st ->> 'balance')::numeric <= 0 then continue; end if;
    v_left := (st ->> 'days_left')::int;
    v_amt := to_char((st ->> 'balance')::numeric, 'FM999G999G990D00');
    v_kind := case when v_left < 0 then 'overdue' when v_left = 0 then 'due_today' when v_left <= 7 then 'due_soon' end;
    if v_kind is not null then
      insert into public.po_payment_alerts (po_id, kind) values (r.id, v_kind) on conflict do nothing;
      get diagnostics v_ins = row_count;
      if v_ins > 0 then
        n := n + 1;
        perform public._po_notify_buyer(r.org_id, r.created_by,
          case v_kind when 'overdue' then 'Payment overdue: ' || r.number when 'due_today' then 'Payment due today: ' || r.number
                      else 'Payment due in ' || v_left || ' day' || case when v_left = 1 then '' else 's' end || ': ' || r.number end,
          r.title || ' · ' || v_amt || ' is owed to a micro or small supplier. Paying after the deadline moves the tax deduction to the year of payment and the supplier can claim interest.', r.id);
        if v_kind = 'overdue' then
          perform public._po_notify_supplier(r.supplier_org, 'Payment is overdue: ' || r.number, r.title || ' · ' || v_amt || ' was due on ' || to_char((st ->> 'due_date')::date, 'DD Mon YYYY'), r.id);
        end if;
      end if;
    end if;
    -- the financial year is about to end with the bill unpaid and already past due or due before 31 March
    if st ->> 'deduction' = 'at_risk' and (st ->> 'fy_end')::date - current_date <= 30 then
      insert into public.po_payment_alerts (po_id, kind) values (r.id, 'year_end') on conflict do nothing;
      get diagnostics v_ins = row_count;
      if v_ins > 0 then
        n := n + 1;
        perform public._po_notify_buyer(r.org_id, r.created_by, 'Pay before 31 March to keep the deduction: ' || r.number,
          r.title || ' · ' || v_amt || ' unpaid. Unpaid to a micro or small supplier at year end, the expense is deductible only next year.', r.id);
      end if;
    end if;
  end loop;
  insert into public.ops_heartbeats (name, last_run, detail) values ('run_payment_reminders', now(), jsonb_build_object('sent', n))
    on conflict (name) do update set last_run = excluded.last_run, detail = excluded.detail;
  return n;
end $$;

-- ───────── 7. who may call what ─────────
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('start_udyam_check', '_udyam_of', '_passport_core', 'get_trust_passport', '_fy_end', '_po_pay_state',
                  'get_msme_rules', 'set_msme_bank_rate', 'list_payables', 'get_po_payment', 'record_po_payment', 'void_po_payment',
                  'raise_po_objection', 'clear_po_objection', 'list_receivables', 'get_supplier_po_payment', 'confirm_po_payment',
                  'dispute_po_payment', 'run_payment_reminders')
  loop execute format('revoke all on function %s from public, anon, authenticated', f.sig); end loop;
end $$;
grant execute on function public.start_udyam_check(uuid, text, text, text) to authenticated;
grant execute on function public.get_trust_passport(uuid) to authenticated;
grant execute on function public.get_msme_rules() to authenticated;
grant execute on function public.set_msme_bank_rate(numeric, date) to authenticated;
grant execute on function public.list_payables(uuid, text) to authenticated;
grant execute on function public.get_po_payment(uuid) to authenticated;
grant execute on function public.record_po_payment(uuid, numeric, date, text, text, text) to authenticated;
grant execute on function public.void_po_payment(uuid) to authenticated;
grant execute on function public.raise_po_objection(uuid, text) to authenticated;
grant execute on function public.clear_po_objection(uuid) to authenticated;
grant execute on function public.list_receivables(uuid, text) to authenticated;
grant execute on function public.get_supplier_po_payment(uuid, uuid) to authenticated;
grant execute on function public.confirm_po_payment(uuid, uuid) to authenticated;
grant execute on function public.dispute_po_payment(uuid, uuid, text) to authenticated;
grant execute on function public.run_payment_reminders() to service_role;

notify pgrst, 'reload schema';
