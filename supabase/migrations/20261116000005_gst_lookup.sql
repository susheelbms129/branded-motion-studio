-- Vendora GST live lookup (migration 5)
--
-- When a supplier submits a GST proof, an Edge Function (supabase/functions/gst-lookup) asks a GST data provider
-- "who is this GSTIN, and is it Active?" and records the answer here, next to the proof, for the reviewer.
--
-- What the reviewer gets: legal name, trade name, registration status, registration date, and whether the legal /
-- trade name matches the company name the supplier gave us. A Cancelled / Suspended registration CANNOT be verified.
--
-- Safety
--   * Only the Edge Function (service role) can write a lookup result. Browsers can only ASK for one, and only for
--     their own pending GST proof (or as a reviewer). The name comparison runs here, never in the browser.
--   * A lookup costs money, so: one successful lookup per proof, 3 tries per proof for suppliers, 10 proofs per
--     company per day.
--   * A failed or unavailable lookup never blocks anything: the reviewer simply sees "live check not available".
--   * Existing functions are untouched, except admin_queue which gains one extra key ("lookup").

alter table public.verification_checks add column if not exists lookup          jsonb;
alter table public.verification_checks add column if not exists lookup_at       timestamptz;   -- set when the answer is final
alter table public.verification_checks add column if not exists lookup_tries    int not null default 0;
alter table public.verification_checks add column if not exists lookup_last_try timestamptz;

-- ───────── name comparison ─────────
create or replace function public._name_tokens(p text)
returns text[] language sql immutable set search_path = '' as $$
  select coalesce(array_agg(distinct s.t), '{}'::text[])
    from (select unnest(regexp_split_to_array(regexp_replace(lower(coalesce(p, '')), '[^a-z0-9]+', ' ', 'g'), '\s+')) as t) s
   where length(s.t) >= 2
     and s.t <> all (array['pvt', 'private', 'ltd', 'limited', 'llp', 'and', 'the', 'co', 'company', 'corp', 'corporation', 'inc', 'india', 'opc'])
$$;

-- 'match' | 'partial' | 'mismatch' | 'unknown'
create or replace function public._name_match(a text, b text)
returns text language plpgsql immutable set search_path = '' as $$
declare ta text[] := public._name_tokens(a); tb text[] := public._name_tokens(b); n int; r numeric;
begin
  if cardinality(ta) = 0 or cardinality(tb) = 0 then return 'unknown'; end if;
  select count(*) into n from (select unnest(ta) intersect select unnest(tb)) x;
  r := n::numeric / least(cardinality(ta), cardinality(tb));
  return case when r >= 0.8 then 'match' when r >= 0.5 then 'partial' else 'mismatch' end;
end $$;

-- ───────── ask for a lookup (browser side, checked) ─────────
-- Returns the GST number to look up. The Edge Function calls this AS THE SIGNED-IN USER, so these checks are the real gate.
create or replace function public.request_gst_lookup(p_check uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare c public.verification_checks; v_admin boolean;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated'; end if;
  select * into c from public.verification_checks where id = p_check for update;
  if not found then raise exception 'not_found'; end if;
  v_admin := public.is_platform_admin() and not public.is_member(c.org_id);
  if not (v_admin or public._can_manage_proofs(c.org_id)) then raise exception 'not_allowed'; end if;
  if c.type <> 'registration' then raise exception 'not_applicable: only GST proofs have a live check'; end if;
  if c.status not in ('submitted', 'in_review') then raise exception 'not_pending: the proof is not waiting for review'; end if;
  if c.lookup_at is not null then raise exception 'already_checked: this GST number was already checked'; end if;
  if not v_admin and c.lookup_tries >= 3 then raise exception 'too_many_tries: the live check was tried too many times'; end if;
  if (select count(*) from public.verification_checks o
       where o.org_id = c.org_id and o.lookup_last_try > now() - interval '1 day') >= 10 and c.lookup_last_try is null then
    raise exception 'daily_limit: too many live checks today';
  end if;
  update public.verification_checks set lookup_tries = lookup_tries + 1, lookup_last_try = now() where id = p_check;
  return c.reference;
end $$;

-- ───────── record the answer (Edge Function only) ─────────
create or replace function public.record_gst_lookup(p_check uuid, p_result jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c public.verification_checks; v_out text := p_result ->> 'outcome'; v_biz text; v_legal text; v_trade text; v_match text;
  rank constant jsonb := '{"match":3,"partial":2,"mismatch":1,"unknown":0}';
  m1 text; m2 text; v_new jsonb;
  d1 text := p_result ->> 'registered_on'; d2 text := p_result ->> 'cancelled_on';
begin
  if v_out not in ('ok', 'not_found', 'unavailable') then raise exception 'invalid_outcome'; end if;
  select * into c from public.verification_checks where id = p_check for update;
  if not found or c.type <> 'registration' then raise exception 'not_found'; end if;
  if c.status not in ('submitted', 'in_review') or c.lookup_at is not null then return; end if;   -- stale answer: ignore quietly

  -- dates must be real calendar dates (2020-02-31 is not)
  begin perform d1::date; exception when others then d1 := null; end;
  begin perform d2::date; exception when others then d2 := null; end;
  v_legal := left(nullif(btrim(p_result ->> 'legal_name'), ''), 200);
  v_trade := left(nullif(btrim(p_result ->> 'trade_name'), ''), 200);
  select name into v_biz from public.businesses where id = c.org_id;
  m1 := public._name_match(v_biz, v_legal); m2 := public._name_match(v_biz, v_trade);
  v_match := case when (rank ->> m1)::int >= (rank ->> m2)::int then m1 else m2 end;

  v_new := jsonb_build_object(
    'outcome', v_out, 'fetched_at', now(),
    'legal_name', v_legal, 'trade_name', v_trade,
    'gst_status', left(nullif(btrim(p_result ->> 'gst_status'), ''), 40),
    'constitution', left(nullif(btrim(p_result ->> 'constitution'), ''), 80),
    'registered_on', case when d1 ~ '^\d{4}-\d{2}-\d{2}$' then d1 end,
    'cancelled_on',  case when d2 ~ '^\d{4}-\d{2}-\d{2}$' then d2 end,
    'name_match', case when v_out = 'ok' then v_match else 'unknown' end,
    'reason', left(nullif(btrim(p_result ->> 'reason'), ''), 120));
  update public.verification_checks
     set lookup = v_new, lookup_at = case when v_out in ('ok', 'not_found') then now() end
   where id = p_check;
  perform public._audit(c.org_id, 'gst_lookup', 'verification_check', p_check,
    jsonb_build_object('outcome', v_out, 'gst_status', v_new ->> 'gst_status', 'name_match', v_new ->> 'name_match'));
end $$;

-- ───────── a registration that GSTN says is not Active cannot be verified ─────────
create or replace function public.guard_gst_active()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status = 'verified' and old.status is distinct from 'verified' and new.type = 'registration'
     and new.lookup ->> 'outcome' = 'ok' and lower(coalesce(new.lookup ->> 'gst_status', 'active')) <> 'active' then
    raise exception 'gst_not_active: the government record shows this registration as %, so it cannot be verified. Reject it with a note instead.',
      coalesce(new.lookup ->> 'gst_status', 'not active');
  end if;
  return new;
end $$;
drop trigger if exists guard_gst_active on public.verification_checks;
create trigger guard_gst_active before update on public.verification_checks
  for each row execute function public.guard_gst_active();

-- ───────── the reviewer's queue, now with the live result ─────────
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
            where n.nspname = 'public' and p.proname in ('_name_tokens', '_name_match', 'request_gst_lookup', 'record_gst_lookup', 'guard_gst_active')
  loop execute format('revoke all on function %s from public, anon, authenticated', f.sig); end loop;
end $$;
grant execute on function public.request_gst_lookup(uuid) to authenticated;
grant execute on function public.record_gst_lookup(uuid, jsonb) to service_role;

notify pgrst, 'reload schema';
