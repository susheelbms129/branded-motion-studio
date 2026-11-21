-- Vendora goods acceptance (migration 26). Run AFTER migrations 1-25. Safe to run twice.
--
-- WHY THIS EXISTS
--   The MSME 45-day rule (migration 20) starts its clock the day the buyer ACCEPTS the goods. Until now that day was one date
--   typed by the buyer for the whole order. Real deliveries are messier: they arrive in parts, some boxes are damaged, and
--   when there is an argument nobody can prove what arrived. This migration records every delivery as a GOODS RECEIPT:
--   what date, how many of each item were accepted, how many were rejected and why, and photos. The supplier sees it at once.
--
-- WHAT BUYERS AND SUPPLIERS GET
--   * Buyer: record each delivery with quantities per item and photos. Accept in parts. Reject damaged goods with a reason.
--     Fix a wrong entry within 48 hours (before any payment or objection exists). Close an order that will never be
--     fully delivered ("close short") so the supplier is not left waiting.
--   * Supplier: told at once, sees exactly what was accepted and rejected with the photos, and can AGREE or DISPUTE each receipt
--     with a note. Both sides keep the same record, so "you never delivered" and "you never told me" stop being arguments.
--   * The payment clock now starts from a real, evidenced date. The order moves to "received" (and delivered_at is set) only when
--     every item has been ACCEPTED in full, or when the buyer closes it short. Rejected goods go back to the supplier, who may
--     deliver a replacement; a rejection never uses up the order.
--
-- RULES
--   * Only the owner or a procurement manager of the BUYER company records, fixes or closes a receipt. Everyone else on that
--     company and on the supplier company can read. Strangers and made-up ids get not_found.
--   * A delivery date cannot be in the future or before the order was issued.
--   * Never accept more than was ordered: accepted quantity, over all receipts, cannot exceed the ordered quantity of an item.
--     (Rejected goods are recorded, never counted as received, and cannot exceed the ordered quantity in one receipt.)
--   * A rejection needs a reason (3-200 characters).
--   * A receipt can be voided only within 48 hours, only while no payment and no objection exist on the order, and with a reason.
--     It is never deleted: the voided receipt stays on the record, and its number is never reused.
--   * Photos: up to 6 per receipt, JPG/PNG/WEBP, 5 MB each, in a PRIVATE bucket. They cannot be replaced or erased from the
--     browser. Both companies can open them through links that expire.
--   * Every step is written to the audit log (ids only).
--
-- WHAT IS NOT IN THIS STEP (honest limits)
--   * The payment clock is still one clock per order: it starts when the whole order is received. Per-delivery clocks come later.
--   * Rejected quantities are recorded and flagged but do not yet reduce the amount payable; that is done with the invoice
--     match (P4) and credit notes (P7).
--   * The 15-day "deemed acceptance" if the buyer does nothing is the next step (P2).

-- ───────────── 1. tables ─────────────
alter table public.purchase_orders add column if not exists receiving_closed_short boolean not null default false;
alter table public.purchase_orders add column if not exists short_close_reason text not null default '';

create table if not exists public.goods_receipts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.businesses (id) on delete cascade,
  po_id uuid not null references public.purchase_orders (id) on delete cascade,
  supplier_org uuid not null references public.businesses (id) on delete cascade,
  seq int not null check (seq > 0),
  number text not null,
  received_on date not null,
  note text not null default '' check (char_length(note) <= 500),
  status text not null default 'active' check (status in ('active', 'voided')),
  voided_at timestamptz,
  voided_by uuid references auth.users (id),
  void_reason text not null default '' check (char_length(void_reason) <= 200),
  supplier_response text check (supplier_response in ('agreed', 'disputed')),
  supplier_note text not null default '' check (char_length(supplier_note) <= 300),
  supplier_responded_at timestamptz,
  supplier_responded_by uuid references auth.users (id),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  unique (po_id, seq)
);
create index if not exists goods_receipts_po_idx on public.goods_receipts (po_id);
create index if not exists goods_receipts_org_idx on public.goods_receipts (org_id, created_at desc);

create table if not exists public.goods_receipt_lines (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.goods_receipts (id) on delete cascade,
  po_line_id uuid not null references public.po_lines (id) on delete cascade,
  qty_accepted numeric(14, 3) not null default 0 check (qty_accepted >= 0),
  qty_rejected numeric(14, 3) not null default 0 check (qty_rejected >= 0),
  reject_reason text not null default '' check (char_length(reject_reason) <= 200),
  check (qty_accepted + qty_rejected > 0),
  check (qty_rejected = 0 or char_length(btrim(reject_reason)) >= 3),
  unique (receipt_id, po_line_id)
);
create index if not exists goods_receipt_lines_po_line_idx on public.goods_receipt_lines (po_line_id);

create table if not exists public.goods_receipt_photos (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.goods_receipts (id) on delete cascade,
  path text not null unique,
  name text not null default 'photo' check (char_length(name) <= 200),
  size_bytes bigint,
  created_at timestamptz not null default now()
);
create index if not exists goods_receipt_photos_receipt_idx on public.goods_receipt_photos (receipt_id);

alter table public.goods_receipts enable row level security;
alter table public.goods_receipt_lines enable row level security;
alter table public.goods_receipt_photos enable row level security;
revoke all on public.goods_receipts, public.goods_receipt_lines, public.goods_receipt_photos from public, anon, authenticated;

-- ───────────── 2. the arithmetic, in one place ─────────────
-- Keeps an order's status and delivery date true to its ACTIVE receipts. Called after every receipt change.
create or replace function public._grn_sync(p_po uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare o public.purchase_orders; v_n int; v_acc numeric; v_open int; v_last date; v_done boolean;
begin
  select * into o from public.purchase_orders where id = p_po;
  if not found or o.status not in ('acknowledged', 'partially_received', 'received') then return; end if;
  select count(*), max(r.received_on) into v_n, v_last from public.goods_receipts r where r.po_id = p_po and r.status = 'active';
  select coalesce(sum(gl.qty_accepted), 0) into v_acc
    from public.goods_receipt_lines gl join public.goods_receipts r on r.id = gl.receipt_id where r.po_id = p_po and r.status = 'active';
  select count(*) into v_open from public.po_lines l
   where l.po_id = p_po and l.qty > coalesce((select sum(gl.qty_accepted) from public.goods_receipt_lines gl
                                                join public.goods_receipts r on r.id = gl.receipt_id
                                               where gl.po_line_id = l.id and r.status = 'active'), 0);
  if v_n = 0 or v_acc = 0 then
    -- nothing accepted (yet): a short close means nothing, and the clock cannot run
    update public.purchase_orders
       set receiving_closed_short = false, short_close_reason = '',
           status = case when v_n = 0 then 'acknowledged' else 'partially_received' end, delivered_at = null
     where id = p_po;
    return;
  end if;
  v_done := v_open = 0 or o.receiving_closed_short;
  if v_done then
    update public.purchase_orders set status = 'received', delivered_at = (v_last + time '12:00')::timestamp at time zone 'UTC' where id = p_po;
  else
    update public.purchase_orders set status = 'partially_received', delivered_at = null where id = p_po;
  end if;
end $$;

-- Validates and stores one receipt. p_lines: [{"lineId": uuid, "accepted": n, "rejected": n, "reason": text}, ...]
-- The caller has already checked WHO may do this and the order's status and the date.
create or replace function public._grn_create(o public.purchase_orders, p_day date, p_note text, p_lines jsonb, p_uid uuid, p_quick boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_note text := ''; e jsonb; v_line uuid; v_acc numeric; v_rej numeric; v_reason text; v_seen uuid[] := '{}'; v_n int := 0;
  v_left numeric; v_ord numeric; v_desc text; v_seq int; v_id uuid; v_number text; v_buyer text; v_on_time boolean; v_status text;
  v_tot_acc numeric := 0; v_tot_rej numeric := 0; v_tot_ord numeric; v_complete boolean;
begin
  if p_note is not null then
    v_note := btrim(p_note);
    if char_length(v_note) > 500 then raise exception 'invalid_note'; end if;
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 or jsonb_array_length(p_lines) > 200 then
    raise exception 'invalid_lines'; end if;

  select coalesce(max(seq), 0) + 1 into v_seq from public.goods_receipts where po_id = o.id;
  v_number := 'GRN-' || o.number || '-' || v_seq;
  insert into public.goods_receipts (org_id, po_id, supplier_org, seq, number, received_on, note, created_by)
    values (o.org_id, o.id, o.supplier_org, v_seq, v_number, p_day, v_note, p_uid) returning id into v_id;

  for e in select * from jsonb_array_elements(p_lines) loop
    begin
      v_line := (e ->> 'lineId')::uuid;
      v_acc := coalesce(nullif(e ->> 'accepted', ''), '0')::numeric;
      v_rej := coalesce(nullif(e ->> 'rejected', ''), '0')::numeric;
    exception when others then raise exception 'invalid_lines';
    end;
    v_reason := btrim(coalesce(e ->> 'reason', ''));
    if v_acc < 0 or v_rej < 0 or round(v_acc, 3) <> v_acc or round(v_rej, 3) <> v_rej then raise exception 'invalid_quantity'; end if;
    if v_line = any (v_seen) then raise exception 'invalid_lines'; end if;
    v_seen := v_seen || v_line;
    if v_acc = 0 and v_rej = 0 then continue; end if;
    select l.description, l.qty, l.qty - coalesce((select sum(gl.qty_accepted) from public.goods_receipt_lines gl
                                              join public.goods_receipts r on r.id = gl.receipt_id
                                             where gl.po_line_id = l.id and r.status = 'active'), 0)
      into v_desc, v_ord, v_left from public.po_lines l where l.id = v_line and l.po_id = o.id;
    if not found then raise exception 'invalid_lines'; end if;
    if v_acc > v_left then raise exception 'over_received: only % still to accept of %', trim_scale(v_left)::text, left(v_desc, 60); end if;
    if v_rej > v_ord then raise exception 'invalid_quantity'; end if;
    if v_rej > 0 and (char_length(v_reason) < 3 or char_length(v_reason) > 200) then raise exception 'reason_required: say why % was rejected', left(v_desc, 60); end if;
    insert into public.goods_receipt_lines (receipt_id, po_line_id, qty_accepted, qty_rejected, reject_reason)
      values (v_id, v_line, v_acc, v_rej, case when v_rej > 0 then v_reason else '' end);
    v_tot_acc := v_tot_acc + v_acc; v_tot_rej := v_tot_rej + v_rej; v_n := v_n + 1;
  end loop;
  if v_n = 0 then raise exception 'empty_receipt: enter a quantity for at least one item'; end if;

  perform public._grn_sync(o.id);
  select status into v_status from public.purchase_orders where id = o.id;
  v_complete := v_status = 'received';
  select coalesce(sum(qty), 0) into v_tot_ord from public.po_lines where po_id = o.id;
  v_on_time := o.expected_at is null or p_day <= o.expected_at;
  select name into v_buyer from public.businesses where id = o.org_id;

  if p_quick or v_complete then
    perform public._po_notify_supplier(o.supplier_org, v_buyer || ' recorded delivery of an order',
      o.number || ' · ' || o.title || case when v_on_time then ' · on time' else ' · after the promised date' end
        || case when v_tot_rej > 0 then ' · some goods rejected' else '' end, o.id);
  else
    perform public._po_notify_supplier(o.supplier_org, v_buyer || ' recorded a partial delivery',
      o.number || ' · ' || o.title || ' · ' || trim_scale(v_tot_acc)::text || ' accepted'
        || case when v_tot_rej > 0 then ', ' || trim_scale(v_tot_rej)::text || ' rejected' else '' end, o.id);
  end if;
  perform public._audit(o.org_id, 'goods_received', 'purchase_order', o.id, jsonb_build_object('receipt', v_id, 'complete', v_complete, 'rejected', v_tot_rej > 0));
  perform public._audit(o.supplier_org, 'goods_received', 'purchase_order', o.id, jsonb_build_object('receipt', v_id, 'complete', v_complete, 'rejected', v_tot_rej > 0));
  if v_complete then
    perform public._audit(o.org_id, 'po_goods_received', 'purchase_order', o.id, jsonb_build_object('on_time', v_on_time));
    perform public._audit(o.supplier_org, 'po_goods_received', 'purchase_order', o.id, jsonb_build_object('on_time', v_on_time));
  end if;
  return jsonb_build_object('id', v_id, 'number', v_number, 'status', v_status, 'complete', v_complete,
    'delivered_on', case when v_complete then p_day end, 'on_time', v_on_time);
end $$;

-- ───────────── 3. the buyer's functions ─────────────
create or replace function public.record_goods_receipt(p_po uuid, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare o public.purchase_orders; v_role text; v_day date;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated'; end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then raise exception 'invalid_request'; end if;
  select * into o from public.purchase_orders where id = p_po and supplier_org is not null for update;
  if not found then raise exception 'not_found'; end if;
  v_role := public._req_role(o.org_id);
  if v_role is null then raise exception 'not_found'; end if;
  if v_role not in ('owner', 'procurement_manager') then raise exception 'not_allowed'; end if;
  if o.status not in ('acknowledged', 'partially_received') then raise exception 'not_receivable'; end if;
  begin
    v_day := coalesce(nullif(p_data ->> 'receivedOn', ''), current_date::text)::date;
  exception when others then raise exception 'invalid_date';
  end;
  if v_day > current_date or v_day < o.issued_at::date then raise exception 'invalid_date'; end if;
  return public._grn_create(o, v_day, p_data ->> 'note', p_data -> 'lines', (select auth.uid()), false);
end $$;

-- The old one-tap "everything arrived" now writes a full receipt (every item, all accepted). Orders with no lines keep the old behaviour.
create or replace function public.receive_purchase_order(p_po uuid, p_delivered_on date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare o public.purchase_orders; v_day date; v_role text; v_buyer text; v_on_time boolean; v_lines jsonb;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated'; end if;
  select * into o from public.purchase_orders where id = p_po and supplier_org is not null for update;
  if not found then raise exception 'not_found'; end if;
  v_role := public._req_role(o.org_id);
  if v_role is null then raise exception 'not_found'; end if;
  if v_role not in ('owner', 'procurement_manager') then raise exception 'not_allowed'; end if;
  if o.status <> 'acknowledged' then raise exception 'not_receivable'; end if;
  v_day := coalesce(p_delivered_on, current_date);
  if v_day > current_date or v_day < o.issued_at::date then raise exception 'invalid_date'; end if;

  select jsonb_agg(jsonb_build_object('lineId', l.id, 'accepted', l.qty)) into v_lines from public.po_lines l where l.po_id = o.id;
  if v_lines is not null then
    perform public._grn_create(o, v_day, '', v_lines, (select auth.uid()), true);
    return jsonb_build_object('status', 'received', 'delivered_on', v_day, 'on_time', o.expected_at is null or v_day <= o.expected_at);
  end if;

  update public.purchase_orders set status = 'received', delivered_at = (v_day + time '12:00')::timestamp at time zone 'UTC' where id = o.id;
  v_on_time := o.expected_at is null or v_day <= o.expected_at;
  select name into v_buyer from public.businesses where id = o.org_id;
  perform public._po_notify_supplier(o.supplier_org, v_buyer || ' recorded delivery of an order',
    o.number || ' · ' || o.title || case when v_on_time then ' · on time' else ' · after the promised date' end, o.id);
  perform public._audit(o.org_id, 'po_goods_received', 'purchase_order', o.id, jsonb_build_object('on_time', v_on_time));
  perform public._audit(o.supplier_org, 'po_goods_received', 'purchase_order', o.id, jsonb_build_object('on_time', v_on_time));
  return jsonb_build_object('status', 'received', 'delivered_on', v_day, 'on_time', v_on_time);
end $$;

-- A wrong entry (typo, wrong date) can be taken back within 48 hours, while no payment and no objection depend on it.
create or replace function public.void_goods_receipt(p_receipt uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.goods_receipts; o public.purchase_orders; v_role text; v_reason text := btrim(coalesce(p_reason, '')); v_buyer text;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated'; end if;
  select * into r from public.goods_receipts where id = p_receipt;
  if not found then raise exception 'not_found'; end if;
  select * into o from public.purchase_orders where id = r.po_id for update;
  v_role := public._req_role(r.org_id);
  if v_role is null then raise exception 'not_found'; end if;
  if v_role not in ('owner', 'procurement_manager') then raise exception 'not_allowed'; end if;
  select * into r from public.goods_receipts where id = p_receipt for update;
  if r.status <> 'active' then raise exception 'already_voided'; end if;
  if r.created_at < now() - interval '48 hours' then raise exception 'too_late: a receipt can only be taken back within 48 hours'; end if;
  if o.status not in ('acknowledged', 'partially_received', 'received') then raise exception 'locked'; end if;
  if o.objection_at is not null or exists (select 1 from public.po_payments pp where pp.po_id = o.id) then
    raise exception 'locked: a payment or an objection already depends on this delivery'; end if;
  if char_length(v_reason) < 3 or char_length(v_reason) > 200 then raise exception 'reason_required'; end if;

  update public.goods_receipts set status = 'voided', voided_at = now(), voided_by = (select auth.uid()), void_reason = v_reason where id = r.id;
  perform public._grn_sync(o.id);
  select name into v_buyer from public.businesses where id = o.org_id;
  perform public._po_notify_supplier(o.supplier_org, v_buyer || ' corrected a delivery record', o.number || ' · ' || r.number || ' was taken back: ' || v_reason, o.id);
  perform public._audit(o.org_id, 'goods_receipt_voided', 'purchase_order', o.id, jsonb_build_object('receipt', r.id));
  perform public._audit(o.supplier_org, 'goods_receipt_voided', 'purchase_order', o.id, jsonb_build_object('receipt', r.id));
  return jsonb_build_object('status', (select status from public.purchase_orders where id = o.id));
end $$;

-- Nothing more will come: accept what arrived and let the order (and the payment clock) move on. The supplier is not left waiting.
create or replace function public.close_receiving_short(p_po uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare o public.purchase_orders; v_role text; v_reason text := btrim(coalesce(p_reason, '')); v_acc numeric; v_buyer text;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated'; end if;
  select * into o from public.purchase_orders where id = p_po and supplier_org is not null for update;
  if not found then raise exception 'not_found'; end if;
  v_role := public._req_role(o.org_id);
  if v_role is null then raise exception 'not_found'; end if;
  if v_role not in ('owner', 'procurement_manager') then raise exception 'not_allowed'; end if;
  if o.status <> 'partially_received' then raise exception 'not_receivable'; end if;
  select coalesce(sum(gl.qty_accepted), 0) into v_acc from public.goods_receipt_lines gl
    join public.goods_receipts r on r.id = gl.receipt_id where r.po_id = o.id and r.status = 'active';
  if v_acc = 0 then raise exception 'nothing_accepted: accept at least one delivery first'; end if;
  if char_length(v_reason) < 3 or char_length(v_reason) > 200 then raise exception 'reason_required'; end if;
  update public.purchase_orders set receiving_closed_short = true, short_close_reason = v_reason where id = o.id;
  perform public._grn_sync(o.id);
  select name into v_buyer from public.businesses where id = o.org_id;
  perform public._po_notify_supplier(o.supplier_org, v_buyer || ' closed an order as short-delivered', o.number || ' · ' || o.title || ' · ' || v_reason, o.id);
  perform public._audit(o.org_id, 'goods_closed_short', 'purchase_order', o.id, '{}'::jsonb);
  perform public._audit(o.supplier_org, 'goods_closed_short', 'purchase_order', o.id, '{}'::jsonb);
  return jsonb_build_object('status', (select status from public.purchase_orders where id = o.id));
end $$;

-- ───────────── 4. the supplier's answer ─────────────
-- The supplier agrees with a receipt, or disputes it with a note. This is a record both sides can see; it does not change the clock
-- (a formal objection stays in the payment tracker, migration 20).
create or replace function public.respond_goods_receipt(p_receipt uuid, p_response text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.goods_receipts; o public.purchase_orders; v_note text := btrim(coalesce(p_note, '')); v_name text;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated'; end if;
  select * into r from public.goods_receipts where id = p_receipt for update;
  if not found or not public.has_role(r.supplier_org, array['owner', 'procurement_manager']) then raise exception 'not_found'; end if;
  if r.status <> 'active' then raise exception 'already_voided'; end if;
  if p_response is null or p_response not in ('agreed', 'disputed') then raise exception 'invalid_response'; end if;
  if char_length(v_note) > 300 then raise exception 'invalid_note'; end if;
  if p_response = 'disputed' and char_length(v_note) < 3 then raise exception 'note_required: say what is different'; end if;
  select * into o from public.purchase_orders where id = r.po_id;
  update public.goods_receipts set supplier_response = p_response, supplier_note = v_note, supplier_responded_at = now(), supplier_responded_by = (select auth.uid()) where id = r.id;
  select name into v_name from public.businesses where id = r.supplier_org;
  perform public._po_notify_buyer(o.org_id, o.created_by,
    v_name || case when p_response = 'agreed' then ' agreed with a delivery record' else ' disputed a delivery record' end,
    o.number || ' · ' || r.number || case when v_note <> '' then ' · ' || v_note else '' end, o.id);
  perform public._audit(r.supplier_org, 'goods_receipt_' || p_response, 'purchase_order', o.id, jsonb_build_object('receipt', r.id));
  perform public._audit(o.org_id, 'goods_receipt_' || p_response, 'purchase_order', o.id, jsonb_build_object('receipt', r.id));
  return jsonb_build_object('response', p_response);
end $$;

-- ───────────── 5. photos ─────────────
-- Who may upload a photo into a receipt's folder: the buyer's owner or procurement manager, while it is active and under 6 photos.
create or replace function public._grn_can_upload(p_org uuid, p_receipt uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.goods_receipts r
                  where r.id = p_receipt and r.org_id = p_org and r.status = 'active'
                    and public._req_role(r.org_id) in ('owner', 'procurement_manager')
                    and (select count(*) from public.goods_receipt_photos p where p.receipt_id = r.id) < 6)
$$;

-- Who may read a photo in a receipt's folder: any active member of the buyer company, or of the supplier company on that order.
create or replace function public._grn_can_read(p_org uuid, p_receipt uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.goods_receipts r
                  where r.id = p_receipt and r.org_id = p_org
                    and (public._req_role(r.org_id) is not null or public.is_member(r.supplier_org)))
$$;

create or replace function public.attach_receipt_photo(p_receipt uuid, p_path text, p_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare r public.goods_receipts; v_size bigint; v_mime text; v_id uuid; v_has_storage boolean := to_regclass('storage.objects') is not null;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated'; end if;
  select * into r from public.goods_receipts where id = p_receipt for update;
  if not found or coalesce(public._req_role(r.org_id), '') not in ('owner', 'procurement_manager') then raise exception 'not_found'; end if;
  if r.status <> 'active' then raise exception 'already_voided'; end if;
  if p_path is null or p_path not like (r.org_id::text || '/' || r.id::text || '/%') or p_path ~ '\.\.' or char_length(p_path) > 300 then raise exception 'invalid_path'; end if;
  if (select count(*) from public.goods_receipt_photos where receipt_id = r.id) >= 6 then raise exception 'too_many_photos: up to 6 photos'; end if;
  if v_has_storage then
    execute 'select (metadata ->> ''size'')::bigint, metadata ->> ''mimetype'' from storage.objects where bucket_id = ''goods-photos'' and name = $1'
      into v_size, v_mime using p_path;
    if v_size is null then raise exception 'file_missing: upload the photo first'; end if;
    if v_size > 5242880 then raise exception 'file_too_large: maximum 5 MB'; end if;
    if v_mime not in ('image/jpeg', 'image/png', 'image/webp') then raise exception 'file_type: JPG, PNG or WEBP only'; end if;
  end if;
  insert into public.goods_receipt_photos (receipt_id, path, name, size_bytes)
    values (r.id, p_path, left(coalesce(nullif(btrim(p_name), ''), 'photo'), 200), v_size)
    on conflict (path) do nothing returning id into v_id;
  if v_id is null then raise exception 'already_attached'; end if;
  perform public._audit(r.org_id, 'goods_photo_added', 'purchase_order', r.po_id, jsonb_build_object('receipt', r.id));
  return v_id;
end $$;

-- Either company may open a photo; the app then asks storage for a 60 second link.
create or replace function public.open_receipt_photo(p_photo uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare v_path text; r public.goods_receipts;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated'; end if;
  select p.path into v_path from public.goods_receipt_photos p where p.id = p_photo;
  if not found then raise exception 'not_found'; end if;
  select g.* into r from public.goods_receipts g join public.goods_receipt_photos p on p.receipt_id = g.id where p.id = p_photo;
  if public._req_role(r.org_id) is null and not public.is_member(r.supplier_org) then raise exception 'not_found'; end if;
  return v_path;
end $$;

-- ───────────── 6. one read for both sides ─────────────
create or replace function public.get_po_receiving(p_po uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  o public.purchase_orders; v_brole text; v_buyer boolean; v_sup boolean; v_sup_mgr boolean; v_mgr boolean; v_lines jsonb; v_rcpts jsonb;
  v_acc numeric; v_open boolean; v_locked boolean; v_n int;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated'; end if;
  select * into o from public.purchase_orders where id = p_po and supplier_org is not null;
  if not found then raise exception 'not_found'; end if;
  v_brole := public._req_role(o.org_id);
  v_buyer := v_brole is not null;
  v_sup := public.is_member(o.supplier_org);
  if not v_buyer and not v_sup then raise exception 'not_found'; end if;
  v_mgr := coalesce(v_brole in ('owner', 'procurement_manager'), false);
  v_sup_mgr := coalesce(public.has_role(o.supplier_org, array['owner', 'procurement_manager']), false);
  v_locked := o.objection_at is not null or exists (select 1 from public.po_payments pp where pp.po_id = o.id);

  select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'description', l.description, 'unit', l.unit, 'ordered', l.qty,
           'accepted', t.a, 'rejected', t.r, 'remaining', greatest(l.qty - t.a, 0)) order by l.id), '[]'::jsonb)
    into v_lines
    from public.po_lines l
    cross join lateral (select coalesce(sum(gl.qty_accepted), 0) as a, coalesce(sum(gl.qty_rejected), 0) as r
                          from public.goods_receipt_lines gl join public.goods_receipts g on g.id = gl.receipt_id
                         where gl.po_line_id = l.id and g.status = 'active') t
   where l.po_id = o.id;
  select coalesce(sum(gl.qty_accepted), 0) into v_acc from public.goods_receipt_lines gl join public.goods_receipts g on g.id = gl.receipt_id where g.po_id = o.id and g.status = 'active';
  select count(*) into v_n from public.goods_receipts where po_id = o.id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', g.id, 'number', g.number, 'received_on', g.received_on, 'created_at', g.created_at, 'by', public._display_name(g.created_by),
           'note', g.note, 'voided', g.status = 'voided', 'void_reason', g.void_reason,
           'supplier_response', g.supplier_response, 'supplier_note', g.supplier_note, 'supplier_responded_at', g.supplier_responded_at,
           'can_void', v_mgr and g.status = 'active' and g.created_at >= now() - interval '48 hours' and not v_locked
                       and o.status in ('acknowledged', 'partially_received', 'received'),
           'can_respond', v_sup_mgr and g.status = 'active',
           'can_add_photo', v_mgr and g.status = 'active' and (select count(*) from public.goods_receipt_photos p where p.receipt_id = g.id) < 6,
           'lines', (select coalesce(jsonb_agg(jsonb_build_object('description', l.description, 'unit', l.unit, 'accepted', gl.qty_accepted,
                       'rejected', gl.qty_rejected, 'reason', gl.reject_reason) order by l.id), '[]'::jsonb)
                       from public.goods_receipt_lines gl join public.po_lines l on l.id = gl.po_line_id where gl.receipt_id = g.id),
           'photos', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name) order by p.created_at), '[]'::jsonb)
                        from public.goods_receipt_photos p where p.receipt_id = g.id)
         ) order by g.seq desc), '[]'::jsonb)
    into v_rcpts from public.goods_receipts g where g.po_id = o.id;

  return jsonb_build_object(
    'po_status', o.status, 'expected_at', o.expected_at, 'delivered_at', o.delivered_at, 'closed_short', o.receiving_closed_short,
    'short_close_reason', o.short_close_reason,
    'legacy', o.status in ('received', 'closed') and v_n = 0,
    'can_record', v_mgr and o.status in ('acknowledged', 'partially_received'),
    'can_close_short', v_mgr and o.status = 'partially_received' and v_acc > 0,
    'lines', v_lines, 'receipts', v_rcpts);
end $$;

-- ───────────── 7. private photo storage ─────────────
-- Skipped automatically where there is no Supabase storage (such as a plain test database).
do $$ begin
  if to_regclass('storage.objects') is null then return; end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('goods-photos', 'goods-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do update set public = false, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

  -- path rule: <buyer company id>/<receipt id>/<file>
  drop policy if exists gphotos_read on storage.objects;
  create policy gphotos_read on storage.objects for select to authenticated
    using (bucket_id = 'goods-photos' and array_length(string_to_array(name, '/'), 1) = 3
           and public._grn_can_read(nullif(split_part(name, '/', 1), '')::uuid, nullif(split_part(name, '/', 2), '')::uuid));

  drop policy if exists gphotos_insert on storage.objects;
  create policy gphotos_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'goods-photos'
      and array_length(string_to_array(name, '/'), 1) = 3
      and public._grn_can_upload(nullif(split_part(name, '/', 1), '')::uuid, nullif(split_part(name, '/', 2), '')::uuid));
  -- no update, no delete policy: a photo cannot be replaced or erased from the browser
end $$;

-- ───────────── who may call what ─────────────
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('_grn_sync', '_grn_create', '_grn_can_upload', '_grn_can_read', 'record_goods_receipt', 'void_goods_receipt',
              'close_receiving_short', 'respond_goods_receipt', 'attach_receipt_photo', 'open_receipt_photo', 'get_po_receiving')
  loop execute format('revoke all on function %s from public, anon, authenticated', f.sig); end loop;
end $$;
grant execute on function public.record_goods_receipt(uuid, jsonb) to authenticated;
grant execute on function public.void_goods_receipt(uuid, text) to authenticated;
grant execute on function public.close_receiving_short(uuid, text) to authenticated;
grant execute on function public.respond_goods_receipt(uuid, text, text) to authenticated;
grant execute on function public.attach_receipt_photo(uuid, text, text) to authenticated;
grant execute on function public.open_receipt_photo(uuid) to authenticated;
grant execute on function public.get_po_receiving(uuid) to authenticated;
grant execute on function public._grn_can_upload(uuid, uuid) to authenticated;
grant execute on function public._grn_can_read(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
