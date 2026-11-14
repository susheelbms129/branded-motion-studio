-- Vendora Trust Passport hardening (migration 6). Run AFTER migrations 4 and 5. Safe to run twice.
--
-- What this fixes (found by reading migrations 4 and 5 line by line):
--   1. Name matching: "Sri Ltd" used to MATCH "Sri Lakshmi Steel Industries" (overlap was divided by the SHORTER name).
--      Now the longer name counts, and a match is only a signal for the reviewer, never proof.
--   2. GST outcome policy. Before, only an "ok" lookup could block a bad registration. Now, every outcome has a rule:
--        Active + name matches ......... reviewer may verify
--        Active + name MISMATCH ........ reviewer must write a note (>= 10 chars) explaining why
--        status unknown ................ reviewer must write a note (confirm on the GST portal)
--        Cancelled / Suspended / other . cannot be verified (reject with a note)
--        Not found in government record  reviewer must write a note (override with a reason, audited)
--        Provider down / not set up .... allowed, exactly as before (manual review)
--   3. Lookup cost control: 30 s cooldown (double-click protection), reviewers capped at 6 tries per proof,
--      suppliers at 3, 15 tries per company per day, and a platform-wide daily kill switch (500).
--   4. Sensitive evidence (address, bank IFSC, documents) is now readable only by the company's owner / finance manager
--      and by reviewers. Ordinary employees can no longer read it.
--   5. check_gstin: the comment said "no login"; it has always required one. Comment corrected (grant unchanged on purpose).
--   6. Reviewer operations: a heartbeat for the daily expiry job, admin_ops_stats() (waiting > 24 h, stale claims,
--      failed live checks, job health, per-reviewer workload) and admin_release_stale() for abandoned claims.
--   7. Trust Passport honesty: each proof now says HOW it was checked ("government_record" or "document_reviewed"),
--      and level 3 is called "Verified + Certificates" instead of "Certified" (Vendora does not certify quality;
--      it reviews certificate documents).

-- ───────── 1. safer name matching ─────────
create or replace function public._name_tokens(p text)
returns text[] language sql immutable set search_path = '' as $$
  select coalesce(array_agg(distinct s.t), '{}'::text[])
    from (select unnest(regexp_split_to_array(regexp_replace(lower(coalesce(p, '')), '[^a-z0-9]+', ' ', 'g'), '\s+')) as t) s
   where length(s.t) >= 2
     and s.t <> all (array['pvt', 'private', 'ltd', 'limited', 'llp', 'and', 'the', 'co', 'company', 'corp', 'corporation', 'inc', 'india', 'opc',
                           'industries', 'industry', 'enterprises', 'enterprise', 'traders', 'trading', 'services', 'solutions'])
$$;

-- 'match' | 'partial' | 'mismatch' | 'unknown'. A SIGNAL for the reviewer, not proof of identity.
--   match    : 80%+ of the LONGER name's words are shared
--   partial  : 50%+ of the longer name's words are shared, or one name is fully contained in the other
--              (a short name such as "Sri" is therefore never a full match for "Sri Lakshmi Steel")
create or replace function public._name_match(a text, b text)
returns text language plpgsql immutable set search_path = '' as $$
declare ta text[] := public._name_tokens(a); tb text[] := public._name_tokens(b); n int; g int; l int;
begin
  if cardinality(ta) = 0 or cardinality(tb) = 0 then return 'unknown'; end if;
  select count(*) into n from (select unnest(ta) intersect select unnest(tb)) x;
  g := greatest(cardinality(ta), cardinality(tb));
  l := least(cardinality(ta), cardinality(tb));
  return case when n::numeric / g >= 0.8 then 'match'
              when n::numeric / g >= 0.5 or n = l then 'partial'
              else 'mismatch' end;
end $$;

-- ───────── 2. one explicit rule per GST outcome ─────────
create or replace function public.guard_gst_active()
returns trigger language plpgsql set search_path = '' as $$
declare v_out text; v_sts text; v_note int;
begin
  if not (new.status = 'verified' and old.status is distinct from 'verified' and new.type = 'registration') then return new; end if;
  v_out  := new.lookup ->> 'outcome';
  v_sts  := lower(coalesce(nullif(btrim(new.lookup ->> 'gst_status'), ''), 'unknown'));
  v_note := char_length(btrim(coalesce(new.review_note, '')));
  if v_out = 'ok' then
    if v_sts = 'unknown' then
      if v_note < 10 then
        raise exception 'gst_status_unknown: the government record did not give a registration status. Check the GST portal and write what you saw in the note (at least 10 characters).';
      end if;
    elsif v_sts <> 'active' then
      raise exception 'gst_not_active: the government record shows this registration as %, so it cannot be verified. Reject it with a note instead.',
        coalesce(new.lookup ->> 'gst_status', 'not active');
    end if;
    if new.lookup ->> 'name_match' = 'mismatch' and v_note < 10 then
      raise exception 'name_mismatch: the registered name does not match the company name. Write a note (at least 10 characters) explaining why you are verifying it anyway.';
    end if;
  elsif v_out = 'not_found' and v_note < 10 then
    raise exception 'gst_not_found: the government record has no taxpayer with this GST number. To verify anyway, write a note (at least 10 characters) explaining why.';
  end if;
  return new;
end $$;
drop trigger if exists guard_gst_active on public.verification_checks;
create trigger guard_gst_active before update on public.verification_checks
  for each row execute function public.guard_gst_active();

-- ───────── 3. lookup cost control ─────────
create index if not exists verification_checks_lookup_try_idx on public.verification_checks (lookup_last_try) where lookup_last_try is not null;

create or replace function public.request_gst_lookup(p_check uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare c public.verification_checks; v_admin boolean; v_max int;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated'; end if;
  select * into c from public.verification_checks where id = p_check for update;
  if not found then raise exception 'not_found'; end if;
  v_admin := public.is_platform_admin() and not public.is_member(c.org_id);
  v_max := case when v_admin then 6 else 3 end;
  if not (v_admin or public._can_manage_proofs(c.org_id)) then raise exception 'not_allowed'; end if;
  if c.type <> 'registration' then raise exception 'not_applicable: only GST proofs have a live check'; end if;
  if c.status not in ('submitted', 'in_review') then raise exception 'not_pending: the proof is not waiting for review'; end if;
  if c.lookup_at is not null then raise exception 'already_checked: this GST number was already checked'; end if;
  if c.lookup_last_try is not null and c.lookup_last_try > now() - interval '30 seconds' then
    raise exception 'too_soon: a live check was just tried. Wait a moment.';
  end if;
  if c.lookup_tries >= v_max then raise exception 'too_many_tries: the live check was tried too many times'; end if;
  if not v_admin and (select coalesce(sum(o.lookup_tries), 0) from public.verification_checks o
                       where o.org_id = c.org_id and o.lookup_last_try > now() - interval '1 day') >= 15 then
    raise exception 'daily_limit: too many live checks today';
  end if;
  -- platform-wide kill switch: stops a bug or an attack from running up the provider bill. Raise the number here when you grow.
  if (select coalesce(sum(o.lookup_tries), 0) from public.verification_checks o where o.lookup_last_try > now() - interval '1 day') >= 500 then
    raise exception 'platform_limit: live checks are paused for today';
  end if;
  update public.verification_checks set lookup_tries = lookup_tries + 1, lookup_last_try = now() where id = p_check;
  return c.reference;
end $$;

-- ───────── 4. sensitive evidence: owner / finance manager and reviewers only ─────────
drop policy if exists verification_checks_read on public.verification_checks;
create policy verification_checks_read on public.verification_checks for select to authenticated
  using (public._can_manage_proofs(org_id) or public.is_platform_admin());

create or replace function public.record_document_view(p_check uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare c public.verification_checks;
begin
  select * into c from public.verification_checks where id = p_check;
  if not found or c.doc_path is null then raise exception 'not_found'; end if;
  if not (public._can_manage_proofs(c.org_id) or public.is_platform_admin()) then raise exception 'not_allowed'; end if;
  perform public._audit(c.org_id, 'document_viewed', 'verification_check', p_check, jsonb_build_object('type', c.type));
  return c.doc_path;
end $$;

do $$ begin
  if to_regclass('storage.objects') is null then return; end if;
  drop policy if exists vdocs_read on storage.objects;
  create policy vdocs_read on storage.objects for select to authenticated
    using (bucket_id = 'verification-docs'
           and (public.is_platform_admin() or public._can_manage_proofs(nullif(split_part(name, '/', 1), '')::uuid)));
end $$;

-- ───────── 5. honest comment ─────────
comment on function public.check_gstin(text, text) is
  'Instant GST format/checksum/state feedback. Signed-in users only. The signup screen uses the same maths in src/lib/gstin.ts, so no login-free grant is needed.';

-- ───────── 6. reviewer operations ─────────
create table if not exists public.ops_heartbeats (
  name     text primary key,
  last_run timestamptz not null,
  detail   jsonb not null default '{}'::jsonb
);
alter table public.ops_heartbeats enable row level security;
revoke all on public.ops_heartbeats from anon, authenticated;     -- no policy on purpose: invisible to the API

-- Same job as before, plus a heartbeat so a silently failing cron shows up in admin_ops_stats().
create or replace function public.refresh_trust_passports()
returns int language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0; w int := 0;
begin
  for r in update public.verification_checks set status = 'expired'
            where status = 'verified' and expires_at is not null and expires_at < current_date
            returning org_id, type, label loop
    n := n + 1;
    perform public._notify_owners(r.org_id, 'proof_expired', 'A proof has expired',
      coalesce(nullif(r.label, ''), r.type) || ' is no longer shown to buyers. Upload a fresh one to restore it.');
    perform public._sync_summary(r.org_id);
  end loop;
  for r in update public.verification_checks set warned_at = now()
            where status = 'verified' and warned_at is null and expires_at between current_date and current_date + 30
            returning org_id, type, label, expires_at loop
    w := w + 1;
    perform public._notify_owners(r.org_id, 'proof_expiring', 'A proof expires soon',
      coalesce(nullif(r.label, ''), r.type) || ' expires on ' || to_char(r.expires_at, 'DD Mon YYYY') || '. Renew it to stay visible.');
  end loop;
  insert into public.ops_heartbeats (name, last_run, detail) values ('refresh_trust_passports', now(), jsonb_build_object('expired', n, 'warned', w))
    on conflict (name) do update set last_run = excluded.last_run, detail = excluded.detail;
  return n;
end $$;

create or replace function public.admin_ops_stats()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare hb timestamptz;
begin
  if not public.is_platform_admin() then raise exception 'not_allowed'; end if;
  select h.last_run into hb from public.ops_heartbeats h where h.name = 'refresh_trust_passports';
  return jsonb_build_object(
    'open',                 (select count(*) from public.verification_checks where status in ('submitted', 'in_review')),
    'waiting_over_24h',     (select count(*) from public.verification_checks where status in ('submitted', 'in_review') and submitted_at < now() - interval '24 hours'),
    'oldest_waiting_hours', (select round(max(extract(epoch from (now() - submitted_at)) / 3600.0), 1) from public.verification_checks where status in ('submitted', 'in_review')),
    'stale_claims',         (select count(*) from public.verification_checks where status = 'in_review' and claimed_at < now() - interval '24 hours'),
    'lookup_failures_24h',  (select count(*) from public.verification_checks where type = 'registration' and status in ('submitted', 'in_review')
                               and lookup ->> 'outcome' = 'unavailable' and lookup_last_try > now() - interval '24 hours'),
    'no_live_result',       (select count(*) from public.verification_checks where type = 'registration' and status in ('submitted', 'in_review')
                               and lookup is null and submitted_at < now() - interval '10 minutes'),
    'expiring_30d',         (select count(*) from public.verification_checks where status = 'verified' and expires_at between current_date and current_date + 30),
    'expiry_job_last_run',  hb,
    'expiry_job_healthy',   hb is not null and hb > now() - interval '36 hours',
    'reviewers',            coalesce((select jsonb_agg(jsonb_build_object('name', public._display_name(s.claimed_by), 'open_claims', s.n, 'oldest_claim_hours', s.h) order by s.n desc)
                                        from (select claimed_by, count(*) as n, round(extract(epoch from (now() - min(claimed_at))) / 3600.0, 1) as h
                                                from public.verification_checks where status = 'in_review' and claimed_by is not null group by claimed_by) s), '[]'::jsonb));
end $$;

-- Gives abandoned claims back to the queue (a reviewer left, forgot, or is on leave). Any reviewer may run it.
create or replace function public.admin_release_stale(p_hours int default 24)
returns int language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  if not public.is_platform_admin() then raise exception 'not_allowed'; end if;
  if p_hours is null or p_hours < 1 or p_hours > 720 then raise exception 'invalid_hours: choose between 1 and 720 hours'; end if;
  for r in update public.verification_checks set status = 'submitted', claimed_by = null, claimed_at = null
            where status = 'in_review' and claimed_at < now() - make_interval(hours => p_hours)
            returning id, org_id, type loop
    n := n + 1;
    perform public._sync_summary(r.org_id);
    perform public._audit(r.org_id, 'proof_claim_released', 'verification_check', r.id, jsonb_build_object('type', r.type, 'stale_hours', p_hours));
  end loop;
  return n;
end $$;

-- ───────── 7. the passport now says HOW each proof was checked ─────────
-- 0 = none, 1 = Registered, 2 = Verified, 3 = Verified + Certificates (the level logic itself is unchanged).
create or replace function public.get_trust_passport(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_level int; v_checks jsonb;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from public.businesses b where b.id = p_org and b.kind = 'supplier') then raise exception 'not_found'; end if;
  v_level := public._trust_level(p_org);
  select coalesce(jsonb_agg(jsonb_build_object(
      'type', c.type, 'label', case when c.type = 'certificate' then c.label else '' end,
      'reference', case when c.type in ('registration', 'certificate') then c.reference else '' end,
      'issuer', case when c.type = 'certificate' then c.issuer else '' end,
      'verified_on', c.reviewed_at::date, 'expires_at', c.expires_at,
      -- government_record: the live GSTN record was Active and its name matched. Everything else: a document a human reviewed.
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

-- ───────── who may call what ─────────
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('admin_ops_stats', 'admin_release_stale')
  loop execute format('revoke all on function %s from public, anon, authenticated', f.sig); end loop;
end $$;
grant execute on function public.admin_ops_stats() to authenticated;
grant execute on function public.admin_release_stale(int) to authenticated;

notify pgrst, 'reload schema';
