-- Vendora GST Instant Identity (migration 26)
--
-- While a supplier types their GST number, the form now shows the full government record (legal name, trade name,
-- status, taxpayer type, registered address, nature of business, registration date, blocked or not) so they can confirm
-- "this is my business" BEFORE submitting. The reviewer then sees the same record plus the supplier's confirmation.
--
-- Safety (same spirit as migration 5)
--   * Only the owner / finance manager of that supplier company can ask for a preview. Browsers never write a result.
--   * A preview costs money, so: a fresh answer is reused for 6 h (1 h for "not found"), 4 paid lookups per user per
--     minute, 15 per company per day. Cached answers are free and unlimited.
--   * Nothing here blocks submitting a proof. If the provider is down the form just shows no live record.
--   * Safe to run twice. Existing behaviour is unchanged except: record_gst_lookup now also keeps the address fields,
--     and admin_queue gains one key ("supplier_confirmed_at").

alter table public.verification_checks add column if not exists lookup_confirmed_at timestamptz;   -- supplier said "this is my business"

create table if not exists public.gst_preview_cache (
  gstin      text primary key,
  result     jsonb not null,
  fetched_at timestamptz not null default now()
);
create table if not exists public.gst_preview_log (
  id      bigint generated always as identity primary key,
  org_id  uuid not null,
  user_id uuid,
  gstin   text not null,
  cached  boolean not null default false,
  at      timestamptz not null default now()
);
create index if not exists gst_preview_log_org_at  on public.gst_preview_log (org_id, at desc);
create index if not exists gst_preview_log_user_at on public.gst_preview_log (user_id, at desc);
alter table public.gst_preview_cache enable row level security;
alter table public.gst_preview_log   enable row level security;
revoke all on public.gst_preview_cache from anon, authenticated;
revoke all on public.gst_preview_log   from anon, authenticated;

-- ───────── one place that turns a provider answer into the small safe shape we store ─────────
create or replace function public._gst_clean(p jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare d1 text := p ->> 'registered_on'; d2 text := p ->> 'cancelled_on';
begin
  begin perform d1::date; exception when others then d1 := null; end;   -- must be a real calendar date
  begin perform d2::date; exception when others then d2 := null; end;
  return jsonb_build_object(
    'outcome',            p ->> 'outcome',
    'legal_name',         left(nullif(btrim(p ->> 'legal_name'), ''), 200),
    'trade_name',         left(nullif(btrim(p ->> 'trade_name'), ''), 200),
    'gst_status',         left(nullif(btrim(p ->> 'gst_status'), ''), 40),
    'constitution',       left(nullif(btrim(p ->> 'constitution'), ''), 80),
    'registered_on',      case when d1 ~ '^\d{4}-\d{2}-\d{2}$' then d1 end,
    'cancelled_on',       case when d2 ~ '^\d{4}-\d{2}-\d{2}$' then d2 end,
    'taxpayer_type',      left(nullif(btrim(p ->> 'taxpayer_type'), ''), 40),
    'address',            left(nullif(btrim(p ->> 'address'), ''), 300),
    'city',               left(nullif(btrim(p ->> 'city'), ''), 80),
    'state',              left(nullif(btrim(p ->> 'state'), ''), 60),
    'pincode',            case when p ->> 'pincode' ~ '^\d{6}$' then p ->> 'pincode' end,
    'nature_of_business', left(nullif(btrim(p ->> 'nature_of_business'), ''), 200),
    'block_status',       left(nullif(btrim(p ->> 'block_status'), ''), 40));
end $$;

-- ───────── the record as the supplier sees it: plus name match, state match, "already linked elsewhere" ─────────
create or replace function public._gst_preview_view(p_org uuid, p_gstin text, p_result jsonb, p_fetched timestamptz)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_biz text; v_bstate text; m1 text; m2 text; v_match text; v_state text; v_claimed boolean;
  rank constant jsonb := '{"match":3,"partial":2,"mismatch":1,"unknown":0}';
begin
  select name, state into v_biz, v_bstate from public.businesses where id = p_org;
  m1 := public._name_match(v_biz, p_result ->> 'legal_name');
  m2 := public._name_match(v_biz, p_result ->> 'trade_name');
  v_match := case when (rank ->> m1)::int >= (rank ->> m2)::int then m1 else m2 end;
  v_state := coalesce(p_result ->> 'state', public._gstin_report(p_gstin) ->> 'state_name');
  v_claimed := exists (
    select 1 from public.verification_checks o
     where o.type = 'registration' and upper(o.reference) = p_gstin and o.org_id <> p_org
       and o.status in ('submitted', 'in_review', 'verified'));
  return p_result || jsonb_build_object(
    'gstin', p_gstin, 'fetched_at', p_fetched, 'your_name', v_biz,
    'name_match', case when p_result ->> 'outcome' = 'ok' then v_match else 'unknown' end,
    'state_matches', case when v_state is null or btrim(coalesce(v_bstate, '')) = '' then null else lower(v_state) = lower(btrim(v_bstate)) end,
    'already_claimed', v_claimed);
end $$;

-- ───────── ask for a preview (called by the Edge Function AS THE SIGNED-IN USER: this is the real gate) ─────────
-- Returns {"cached": record} when a fresh answer exists (free), or {"go": true} when the provider should be asked.
create or replace function public.request_gst_preview(p_org uuid, p_gstin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare g text := upper(btrim(coalesce(p_gstin, ''))); rep jsonb; c public.gst_preview_cache; uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if not public._can_manage_proofs(p_org) then raise exception 'not_allowed'; end if;
  rep := public._gstin_report(g);
  if not coalesce((rep ->> 'format_ok')::boolean, false) or not coalesce((rep ->> 'checksum_ok')::boolean, false) or rep ->> 'state_name' is null then
    raise exception 'bad_gstin: this GST number is not valid';
  end if;
  select * into c from public.gst_preview_cache
   where gstin = g and fetched_at > now() - case when result ->> 'outcome' = 'ok' then interval '6 hours' else interval '1 hour' end;
  if found then
    insert into public.gst_preview_log (org_id, user_id, gstin, cached) values (p_org, uid, g, true);
    return jsonb_build_object('cached', public._gst_preview_view(p_org, g, c.result, c.fetched_at));
  end if;
  if (select count(*) from public.gst_preview_log where user_id = uid and not cached and at > now() - interval '1 minute') >= 4 then
    raise exception 'too_soon: please wait a moment';
  end if;
  if (select count(*) from public.gst_preview_log where org_id = p_org and not cached and at > now() - interval '1 day') >= 15 then
    raise exception 'daily_limit: too many live checks today';
  end if;
  insert into public.gst_preview_log (org_id, user_id, gstin, cached) values (p_org, uid, g, false);
  return jsonb_build_object('go', true);
end $$;

-- ───────── store the provider's answer (Edge Function only, service role) ─────────
create or replace function public.record_gst_preview(p_org uuid, p_gstin text, p_result jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare g text := upper(btrim(coalesce(p_gstin, ''))); clean jsonb; v_out text := p_result ->> 'outcome';
begin
  if v_out not in ('ok', 'not_found') then raise exception 'invalid_outcome'; end if;
  if not exists (select 1 from public.businesses where id = p_org and kind = 'supplier') then raise exception 'not_found'; end if;
  if g !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$' then raise exception 'bad_gstin'; end if;
  clean := public._gst_clean(p_result);
  insert into public.gst_preview_cache (gstin, result, fetched_at) values (g, clean, now())
    on conflict (gstin) do update set result = excluded.result, fetched_at = excluded.fetched_at;
  return public._gst_preview_view(p_org, g, clean, now());
end $$;

-- ───────── the proof's own lookup now keeps the address fields too (replaces migration 5's version) ─────────
create or replace function public.record_gst_lookup(p_check uuid, p_result jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c public.verification_checks; v_out text := p_result ->> 'outcome'; v_biz text; v_match text; v_new jsonb;
  rank constant jsonb := '{"match":3,"partial":2,"mismatch":1,"unknown":0}';
  m1 text; m2 text;
begin
  if v_out not in ('ok', 'not_found', 'unavailable') then raise exception 'invalid_outcome'; end if;
  select * into c from public.verification_checks where id = p_check for update;
  if not found or c.type <> 'registration' then raise exception 'not_found'; end if;
  if c.status not in ('submitted', 'in_review') or c.lookup_at is not null then return; end if;   -- stale answer: ignore quietly

  v_new := public._gst_clean(p_result);
  select name into v_biz from public.businesses where id = c.org_id;
  m1 := public._name_match(v_biz, v_new ->> 'legal_name'); m2 := public._name_match(v_biz, v_new ->> 'trade_name');
  v_match := case when (rank ->> m1)::int >= (rank ->> m2)::int then m1 else m2 end;
  v_new := v_new || jsonb_build_object(
    'fetched_at', now(),
    'name_match', case when v_out = 'ok' then v_match else 'unknown' end,
    'reason', left(nullif(btrim(p_result ->> 'reason'), ''), 120));
  update public.verification_checks
     set lookup = v_new, lookup_at = case when v_out in ('ok', 'not_found') then now() end
   where id = p_check;
  perform public._audit(c.org_id, 'gst_lookup', 'verification_check', p_check,
    jsonb_build_object('outcome', v_out, 'gst_status', v_new ->> 'gst_status', 'name_match', v_new ->> 'name_match'));
end $$;

-- ───────── supplier: "this is my business" ─────────
create or replace function public.confirm_gst_identity(p_check uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.verification_checks;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated'; end if;
  select * into c from public.verification_checks where id = p_check for update;
  if not found then raise exception 'not_found'; end if;
  if not public._can_manage_proofs(c.org_id) then raise exception 'not_allowed'; end if;
  if c.type <> 'registration' or c.status not in ('submitted', 'in_review') then raise exception 'not_pending: the proof is not waiting for review'; end if;
  if c.lookup_confirmed_at is not null then return; end if;
  update public.verification_checks set lookup_confirmed_at = now() where id = p_check;
  perform public._audit(c.org_id, 'gst_identity_confirmed', 'verification_check', p_check, '{}'::jsonb);
end $$;

-- ───────── the reviewer's queue: one extra key ─────────
create or replace function public.admin_queue(p_scope text default 'open')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() then raise exception 'not_allowed'; end if;
  return coalesce((
    select jsonb_agg(row order by (row ->> 'submitted_at')) from (
      select jsonb_build_object(
        'id', c.id, 'org_id', c.org_id, 'org_name', b.name, 'org_state', b.state, 'type', c.type, 'label', c.label,
        'reference', c.reference, 'issuer', c.issuer, 'issued_on', c.issued_on, 'expires_at', c.expires_at,
        'doc_name', c.doc_name, 'status', c.status, 'auto_flags', c.auto_flags, 'submitted_at', c.submitted_at,
        'waiting_hours', round(extract(epoch from (now() - c.submitted_at)) / 3600.0, 1),
        'claimed_by_me', c.claimed_by = (select auth.uid()), 'claimed_by_name', case when c.claimed_by is null then null else public._display_name(c.claimed_by) end,
        'reviewed_at', c.reviewed_at, 'review_note', c.review_note,
        'lookup', c.lookup,
        'supplier_confirmed_at', c.lookup_confirmed_at,
        'duplicate_gstin', c.type = 'registration' and exists (
            select 1 from public.verification_checks o where o.reference = c.reference and o.org_id <> c.org_id
               and o.type = 'registration' and o.status in ('submitted', 'in_review', 'verified'))
      ) as row
      from public.verification_checks c join public.businesses b on b.id = c.org_id
      where case when p_scope = 'done' then c.status in ('verified', 'rejected') and c.reviewed_at > now() - interval '30 days'
                 else c.status in ('submitted', 'in_review') end
      limit 200) q), '[]'::jsonb);
end $$;

-- ───────── who may call what ─────────
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('_gst_clean', '_gst_preview_view', 'request_gst_preview', 'record_gst_preview', 'record_gst_lookup', 'confirm_gst_identity')
  loop execute format('revoke all on function %s from public, anon, authenticated', f.sig); end loop;
end $$;
grant execute on function public.request_gst_preview(uuid, text)      to authenticated;
grant execute on function public.confirm_gst_identity(uuid)           to authenticated;
grant execute on function public.record_gst_preview(uuid, text, jsonb) to service_role;
grant execute on function public.record_gst_lookup(uuid, jsonb)        to service_role;
grant execute on function public.admin_queue(text)                     to authenticated;

notify pgrst, 'reload schema';
