-- Vendora WhatsApp alerts (migration 25). Run AFTER migrations 1-24. Safe to run twice.
--
-- WHAT PEOPLE GET
--   * Suppliers: a WhatsApp the moment a buyer sends them a quote request, and when an order arrives.
--   * Buyers: a WhatsApp when quotes come in, and it carries the verdict, not just "you have a message":
--     "3 quotes in. Lowest Rs 92,000, 8% below the average." (computed from the buyer's own real quotes, landed cost).
--   * Orders: both sides are told when an order is issued, confirmed or declined.
--
-- WHAT MAKES IT DIFFERENT FROM A NOTIFICATION BELL
--   * Own-number proof: nobody gets messages until they confirm a code that was sent to THEIR WhatsApp. A stranger's number
--     can never be attached to an account just by typing it.
--   * Calm by design: a burst of updates on the same RFQ becomes ONE message; nothing is sent between the person's quiet
--     hours (default 21:00-08:00 India time), it waits and goes out in the morning; "STOP" in WhatsApp turns it all off.
--   * Cost safety: a monthly cap per company, so a bug or a flood can never run up a WhatsApp bill.
--   * Decision-first: the digest numbers are read at SEND time, so a merged message always shows the latest numbers.
--
-- SAFETY
--   * Phone numbers and codes live in tables the browser cannot touch. The app only calls the functions below.
--   * The verification code is stored as a hash, expires in 10 minutes, allows 5 tries, and 3 codes per hour per person.
--   * One verified number belongs to one account (no number can be attached to many accounts to spam).
--   * Messages carry NO prices from other suppliers and no contact details; suppliers only ever get their own RFQ title.
--   * The hook that queues messages can never block the business action that caused the notification: if it fails, the
--     notification is still saved and the order / quote goes through.
--   * Sending itself happens on the server with the WhatsApp token (see SETUP-WHATSAPP.md). The server uses only the two
--     service functions at the bottom; they are granted to the service role and nobody else.

-- ───────────── 1. tables ─────────────
create table if not exists public.whatsapp_contacts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  phone text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  status text not null default 'pending' check (status in ('pending', 'verified')),
  paused boolean not null default false,
  code_hash bytea,
  code_expires_at timestamptz,
  code_attempts int not null default 0,
  verified_at timestamptz,
  want_rfq boolean not null default true,
  want_po boolean not null default true,
  quiet_start smallint not null default 21 check (quiet_start between 0 and 23),
  quiet_end smallint not null default 8 check (quiet_end between 0 and 23),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists whatsapp_contacts_one_verified_phone on public.whatsapp_contacts (phone) where status = 'verified';

create table if not exists public.whatsapp_outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  org_id uuid references public.businesses (id) on delete cascade,
  kind text not null check (kind in ('verify', 'test', 'rfq', 'po')),
  title text not null default '',
  body text not null default '',
  link_to text,
  merged int not null default 1,
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed', 'skipped')),
  send_after timestamptz not null default now(),
  attempts int not null default 0,
  last_error text not null default '',
  provider_id text,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  delivered_at timestamptz
);
create index if not exists whatsapp_outbox_due_idx on public.whatsapp_outbox (send_after) where status in ('queued', 'sending');
create index if not exists whatsapp_outbox_user_idx on public.whatsapp_outbox (user_id, created_at desc);
create index if not exists whatsapp_outbox_org_idx on public.whatsapp_outbox (org_id, created_at);
create index if not exists whatsapp_outbox_provider_idx on public.whatsapp_outbox (provider_id) where provider_id is not null;

alter table public.whatsapp_contacts enable row level security;
alter table public.whatsapp_outbox enable row level security;
revoke all on public.whatsapp_contacts from public, anon, authenticated;
revoke all on public.whatsapp_outbox from public, anon, authenticated;

-- ───────────── 2. the rules in one place ─────────────
-- Messages per company per calendar month. A WhatsApp bill can never run away; the owner can raise this later.
create or replace function public._wa_cap() returns int language sql immutable set search_path = '' as $$ select 300 $$;

-- The next moment a message may be sent, given the person's quiet hours (India time). Equal start and end = no quiet hours.
create or replace function public._wa_next_allowed(p_from timestamptz, p_qs int, p_qe int)
returns timestamptz language plpgsql stable set search_path = '' as $$
declare l timestamp := p_from at time zone 'Asia/Kolkata'; h int := extract(hour from l)::int; d date := l::date; v_in boolean;
begin
  if p_qs = p_qe then return p_from; end if;
  if p_qs < p_qe then v_in := h >= p_qs and h < p_qe; else v_in := h >= p_qs or h < p_qe; end if;
  if not v_in then return p_from; end if;
  if h < p_qe then return (d + p_qe * interval '1 hour') at time zone 'Asia/Kolkata'; end if;
  return ((d + 1) + p_qe * interval '1 hour') at time zone 'Asia/Kolkata';
end $$;

-- "3 quotes in, lowest X, average Y" for a buyer's RFQ link. Read at send time so a merged message is never stale.
create or replace function public._wa_rfq_digest(p_link text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_rfq uuid; n int; lo numeric; av numeric;
begin
  if p_link is null or p_link !~ '^rfqs/[0-9a-f-]{36}$' then return null; end if;
  v_rfq := substring(p_link from 6)::uuid;
  select count(*), min(x.t), avg(x.t) into n, lo, av
    from (select (public._quote_amounts(q.id) ->> 'total')::numeric as t
            from public.quotations q where q.rfq_id = v_rfq and q.supplier_org is not null) x;
  if n = 0 then return null; end if;
  return jsonb_build_object('quotes', n, 'lowest', round(lo, 2), 'average', round(av, 2));
end $$;

-- ───────────── 3. the hook: every notification may become a WhatsApp (never blocking) ─────────────
create or replace function public._wa_enqueue_from_notification()
returns trigger language plpgsql security definer set search_path = '' as $$
declare c public.whatsapp_contacts; v_n int; v_id uuid; v_when timestamptz;
begin
  begin
    if new.kind not in ('rfq', 'po') then return new; end if;
    select * into c from public.whatsapp_contacts where user_id = new.user_id and status = 'verified' and not paused;
    if not found then return new; end if;
    if (new.kind = 'rfq' and not c.want_rfq) or (new.kind = 'po' and not c.want_po) then return new; end if;

    select count(*) into v_n from public.whatsapp_outbox
     where org_id = new.org_id and status in ('queued', 'sending', 'sent') and created_at >= date_trunc('month', now());
    if v_n >= public._wa_cap() then
      insert into public.whatsapp_outbox (user_id, org_id, kind, title, body, link_to, status, last_error)
        values (new.user_id, new.org_id, new.kind, new.title, new.body, new.link_to, 'skipped', 'monthly_cap');
      return new;
    end if;

    -- a burst of updates on the same thing becomes one message, with the newest words
    select id into v_id from public.whatsapp_outbox
     where user_id = new.user_id and kind = new.kind and status = 'queued' and link_to is not distinct from new.link_to
     order by created_at desc limit 1 for update;
    if found then
      update public.whatsapp_outbox set title = new.title, body = new.body, merged = merged + 1 where id = v_id;
      return new;
    end if;

    v_when := public._wa_next_allowed(now() + interval '90 seconds', c.quiet_start, c.quiet_end);
    insert into public.whatsapp_outbox (user_id, org_id, kind, title, body, link_to, send_after)
      values (new.user_id, new.org_id, new.kind, new.title, new.body, new.link_to, v_when);
  exception when others then
    raise warning 'whatsapp enqueue skipped: %', sqlerrm;
  end;
  return new;
end $$;

drop trigger if exists notifications_whatsapp_enqueue on public.notifications;
create trigger notifications_whatsapp_enqueue after insert on public.notifications
  for each row execute function public._wa_enqueue_from_notification();

-- ───────────── 4. the functions the app calls (signed-in people, about themselves only) ─────────────
create or replace function public._wa_mask(p text)
returns text language sql immutable set search_path = '' as $$ select left(p, 3) || '••••' || right(p, 2) $$;

create or replace function public.get_whatsapp_settings()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare u uuid := (select auth.uid()); c public.whatsapp_contacts; v_recent jsonb; v_month int;
begin
  if u is null then raise exception 'not_authenticated'; end if;
  select * into c from public.whatsapp_contacts where user_id = u;
  select coalesce(jsonb_agg(jsonb_build_object('kind', x.kind, 'title', x.title, 'status', x.status, 'created_at', x.created_at,
                                               'delivered', x.delivered_at is not null, 'merged', x.merged) order by x.created_at desc), '[]'::jsonb)
    into v_recent from (select * from public.whatsapp_outbox where user_id = u and kind <> 'verify' order by created_at desc limit 8) x;
  select count(*) into v_month from public.whatsapp_outbox
   where user_id = u and kind <> 'verify' and status in ('queued', 'sending', 'sent') and created_at >= date_trunc('month', now());
  if c.user_id is null then
    return jsonb_build_object('status', 'none', 'recent', v_recent, 'month_count', v_month);
  end if;
  return jsonb_build_object('status', c.status, 'phone', public._wa_mask(c.phone), 'paused', c.paused,
    'want_rfq', c.want_rfq, 'want_po', c.want_po, 'quiet_start', c.quiet_start, 'quiet_end', c.quiet_end,
    'code_pending', c.status = 'pending' and c.code_expires_at is not null and c.code_expires_at > now(),
    'recent', v_recent, 'month_count', v_month);
end $$;

-- Step 1: the person types their WhatsApp number; we send a 6 digit code to it.
create or replace function public.start_whatsapp_verification(p_phone text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare u uuid := (select auth.uid()); v_phone text; v_code text; c public.whatsapp_contacts;
begin
  if u is null then raise exception 'not_authenticated'; end if;
  if p_phone is null then raise exception 'invalid_phone'; end if;
  v_phone := regexp_replace(btrim(p_phone), '[\s\-().]', '', 'g');
  if v_phone like '00%' then v_phone := '+' || substring(v_phone from 3); end if;
  if v_phone !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'invalid_phone'; end if;

  perform pg_advisory_xact_lock(hashtextextended(u::text, 25));
  select * into c from public.whatsapp_contacts where user_id = u;
  if found and c.status = 'verified' and c.phone = v_phone then
    return jsonb_build_object('status', 'verified', 'phone', public._wa_mask(v_phone));
  end if;
  if exists (select 1 from public.whatsapp_contacts where phone = v_phone and status = 'verified' and user_id <> u) then
    raise exception 'phone_in_use';
  end if;
  if (select count(*) from public.whatsapp_outbox where user_id = u and kind = 'verify' and created_at > now() - interval '1 hour') >= 3 then
    raise exception 'rate_limited';
  end if;

  v_code := lpad((('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))::bit(32)::bigint % 1000000)::text, 6, '0');
  insert into public.whatsapp_contacts (user_id, phone, status, code_hash, code_expires_at, code_attempts)
    values (u, v_phone, 'pending', sha256(convert_to(v_code || u::text, 'UTF8')), now() + interval '10 minutes', 0)
  on conflict (user_id) do update
    set phone = excluded.phone, status = 'pending', code_hash = excluded.code_hash, code_expires_at = excluded.code_expires_at,
        code_attempts = 0, verified_at = null, updated_at = now();
  insert into public.whatsapp_outbox (user_id, kind, title, body) values (u, 'verify', 'Verification code', v_code);
  return jsonb_build_object('status', 'code_sent', 'phone', public._wa_mask(v_phone));
end $$;

-- Step 2: the person types the code. Wrong tries are COUNTED (so this returns a result instead of raising, to keep the count).
create or replace function public.confirm_whatsapp_verification(p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare u uuid := (select auth.uid()); c public.whatsapp_contacts; v_code text := regexp_replace(coalesce(p_code, ''), '\s', '', 'g');
begin
  if u is null then raise exception 'not_authenticated'; end if;
  perform pg_advisory_xact_lock(hashtextextended(u::text, 25));
  select * into c from public.whatsapp_contacts where user_id = u for update;
  if not found or c.status <> 'pending' or c.code_hash is null then return jsonb_build_object('ok', false, 'error', 'no_pending'); end if;
  if c.code_expires_at < now() then return jsonb_build_object('ok', false, 'error', 'expired'); end if;
  if c.code_attempts >= 5 then return jsonb_build_object('ok', false, 'error', 'too_many'); end if;
  if v_code !~ '^[0-9]{6}$' or sha256(convert_to(v_code || u::text, 'UTF8')) <> c.code_hash then
    update public.whatsapp_contacts set code_attempts = code_attempts + 1, updated_at = now() where user_id = u;
    return jsonb_build_object('ok', false, 'error', 'wrong_code', 'left', greatest(4 - c.code_attempts, 0));
  end if;
  begin
    update public.whatsapp_contacts set status = 'verified', verified_at = now(), code_hash = null, code_expires_at = null,
           code_attempts = 0, paused = false, updated_at = now() where user_id = u;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'phone_in_use');
  end;
  return jsonb_build_object('ok', true, 'phone', public._wa_mask(c.phone));
end $$;

create or replace function public.set_whatsapp_prefs(p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare u uuid := (select auth.uid()); c public.whatsapp_contacts;
begin
  if u is null then raise exception 'not_authenticated'; end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then raise exception 'invalid_request'; end if;
  select * into c from public.whatsapp_contacts where user_id = u for update;
  if not found then raise exception 'no_contact'; end if;
  begin
    if p_data ? 'want_rfq' then c.want_rfq := (p_data ->> 'want_rfq')::boolean; end if;
    if p_data ? 'want_po' then c.want_po := (p_data ->> 'want_po')::boolean; end if;
    if p_data ? 'paused' then c.paused := (p_data ->> 'paused')::boolean; end if;
    if p_data ? 'quiet_start' then c.quiet_start := (p_data ->> 'quiet_start')::smallint; end if;
    if p_data ? 'quiet_end' then c.quiet_end := (p_data ->> 'quiet_end')::smallint; end if;
  exception when others then raise exception 'invalid_request';
  end;
  if c.quiet_start not between 0 and 23 or c.quiet_end not between 0 and 23 then raise exception 'invalid_request'; end if;
  update public.whatsapp_contacts set want_rfq = c.want_rfq, want_po = c.want_po, paused = c.paused,
         quiet_start = c.quiet_start, quiet_end = c.quiet_end, updated_at = now() where user_id = u;
  if c.paused then
    update public.whatsapp_outbox set status = 'skipped', last_error = 'paused' where user_id = u and status = 'queued' and kind in ('rfq', 'po');
  end if;
  return public.get_whatsapp_settings();
end $$;

-- Turn it off for good: the number is deleted and anything waiting is dropped.
create or replace function public.stop_whatsapp()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare u uuid := (select auth.uid());
begin
  if u is null then raise exception 'not_authenticated'; end if;
  update public.whatsapp_outbox set status = 'skipped', last_error = 'stopped', body = '' where user_id = u and status in ('queued', 'sending');
  delete from public.whatsapp_contacts where user_id = u;
  return jsonb_build_object('status', 'none');
end $$;

-- "Send me a test": three a day.
create or replace function public.send_whatsapp_test()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare u uuid := (select auth.uid()); c public.whatsapp_contacts;
begin
  if u is null then raise exception 'not_authenticated'; end if;
  select * into c from public.whatsapp_contacts where user_id = u;
  if not found or c.status <> 'verified' then raise exception 'not_verified'; end if;
  if (select count(*) from public.whatsapp_outbox where user_id = u and kind = 'test' and created_at > now() - interval '1 day') >= 3 then
    raise exception 'rate_limited';
  end if;
  insert into public.whatsapp_outbox (user_id, kind, title, body) values (u, 'test', 'Your WhatsApp alerts are working', 'You will hear from Vendora here about quotes and orders.');
  return jsonb_build_object('queued', true);
end $$;

-- ───────────── 5. the service functions (the sending server only) ─────────────
-- Take the messages that are due. Opted-out people are skipped here, at the last moment, so a STOP always wins.
create or replace function public.wa_claim_batch(p_limit int default 20)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_rows jsonb; v_limit int := least(greatest(coalesce(p_limit, 20), 1), 50);
begin
  update public.whatsapp_outbox set status = 'queued', claimed_at = null where status = 'sending' and claimed_at < now() - interval '10 minutes' and attempts < 4;
  update public.whatsapp_outbox set status = 'failed', last_error = 'stuck', body = case when kind in ('verify') then '' else body end
   where status = 'sending' and claimed_at < now() - interval '10 minutes' and attempts >= 4;

  -- an alert that could not be sent for a day is no longer news; a code that could not be sent in 15 minutes has expired anyway
  update public.whatsapp_outbox set status = 'failed', last_error = 'too_old', body = case when kind = 'verify' then '' else body end
   where status = 'queued' and ((kind = 'verify' and created_at < now() - interval '15 minutes') or (kind <> 'verify' and created_at < now() - interval '24 hours'));

  update public.whatsapp_outbox o set status = 'skipped', last_error = 'opted_out', body = case when o.kind = 'verify' then '' else o.body end
   where o.status = 'queued' and o.send_after <= now()
     and not exists (select 1 from public.whatsapp_contacts k
                      where k.user_id = o.user_id
                        and (o.kind in ('verify') or (k.status = 'verified' and (o.kind = 'test' or not k.paused))));

  with c as (select id from public.whatsapp_outbox where status = 'queued' and send_after <= now()
              order by send_after, created_at limit v_limit for update skip locked),
       u as (update public.whatsapp_outbox o set status = 'sending', claimed_at = now(), attempts = o.attempts + 1
              from c where o.id = c.id returning o.*)
  select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'kind', u.kind, 'title', u.title, 'body', u.body, 'link_to', u.link_to,
           'merged', u.merged, 'attempts', u.attempts, 'phone', k.phone, 'digest', public._wa_rfq_digest(u.link_to)) order by u.created_at), '[]'::jsonb)
    into v_rows from u join public.whatsapp_contacts k on k.user_id = u.user_id;
  return v_rows;
end $$;

-- Record what happened. outcome: sent | retry | failed | hold. A code is wiped as soon as it has been handled.
-- hold = our own setup is wrong right now (token expired, template not approved): wait 10 minutes and do NOT use up an attempt.
create or replace function public.wa_mark_result(p_id uuid, p_outcome text, p_provider_id text default null, p_error text default '')
returns void language plpgsql security definer set search_path = '' as $$
declare o public.whatsapp_outbox;
begin
  select * into o from public.whatsapp_outbox where id = p_id for update;
  if not found or o.status <> 'sending' then return; end if;
  if p_outcome = 'sent' then
    update public.whatsapp_outbox set status = 'sent', sent_at = now(), provider_id = p_provider_id, last_error = '',
           body = case when kind = 'verify' then '' else body end where id = p_id;
  elsif p_outcome = 'hold' then
    update public.whatsapp_outbox set status = 'queued', claimed_at = null, attempts = greatest(o.attempts - 1, 0),
           send_after = now() + interval '10 minutes', last_error = left(coalesce(p_error, ''), 300) where id = p_id;
  elsif p_outcome = 'retry' and o.attempts < 4 then
    update public.whatsapp_outbox set status = 'queued', claimed_at = null, send_after = now() + (o.attempts * interval '2 minutes'),
           last_error = left(coalesce(p_error, ''), 300) where id = p_id;
  else
    update public.whatsapp_outbox set status = 'failed', last_error = left(coalesce(p_error, ''), 300),
           body = case when kind = 'verify' then '' else body end where id = p_id;
  end if;
end $$;

-- WhatsApp told us what happened to a message we sent (delivered / read / failed).
create or replace function public.wa_provider_status(p_provider_id text, p_status text, p_error text default '')
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_provider_id is null or p_provider_id = '' then return; end if;
  if p_status in ('delivered', 'read') then
    update public.whatsapp_outbox set delivered_at = coalesce(delivered_at, now()) where provider_id = p_provider_id;
  elsif p_status = 'failed' then
    update public.whatsapp_outbox set status = 'failed', last_error = left(coalesce(p_error, 'delivery_failed'), 300) where provider_id = p_provider_id;
  end if;
end $$;

-- The person replied STOP in WhatsApp. Everything pauses at once; they can resume in Settings.
create or replace function public.wa_stop_by_phone(p_phone text)
returns int language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  if p_phone is null or p_phone !~ '^\+[1-9][0-9]{7,14}$' then return 0; end if;
  with s as (update public.whatsapp_contacts set paused = true, updated_at = now() where phone = p_phone and status = 'verified' returning user_id)
  update public.whatsapp_outbox o set status = 'skipped', last_error = 'stopped_by_reply'
    from s where o.user_id = s.user_id and o.status = 'queued' and o.kind in ('rfq', 'po');
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ───────────── who may call what ─────────────
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('_wa_cap', '_wa_next_allowed', '_wa_rfq_digest', '_wa_enqueue_from_notification', '_wa_mask',
              'get_whatsapp_settings', 'start_whatsapp_verification', 'confirm_whatsapp_verification', 'set_whatsapp_prefs', 'stop_whatsapp',
              'send_whatsapp_test', 'wa_claim_batch', 'wa_mark_result', 'wa_provider_status', 'wa_stop_by_phone')
  loop execute format('revoke all on function %s from public, anon, authenticated', f.sig); end loop;
end $$;
grant execute on function public.get_whatsapp_settings() to authenticated;
grant execute on function public.start_whatsapp_verification(text) to authenticated;
grant execute on function public.confirm_whatsapp_verification(text) to authenticated;
grant execute on function public.set_whatsapp_prefs(jsonb) to authenticated;
grant execute on function public.stop_whatsapp() to authenticated;
grant execute on function public.send_whatsapp_test() to authenticated;
grant execute on function public.wa_claim_batch(int) to service_role;
grant execute on function public.wa_mark_result(uuid, text, text, text) to service_role;
grant execute on function public.wa_provider_status(text, text, text) to service_role;
grant execute on function public.wa_stop_by_phone(text) to service_role;

notify pgrst, 'reload schema';
