-- Vendora Trust Passport (migration 4)
--
-- Instead of one yes/no "verified" badge, every supplier carries a PASSPORT of separate proofs:
--   registration (GST number), address, bank account, and any number of quality certificates.
-- Each proof is reviewed on its own, shows its verification date and expiry to buyers, and LAPSES AUTOMATICALLY
-- when it goes stale (buyers never see an expired proof as valid, even if no job has run yet).
--
-- Saves your reviewers' time (and money): a GST number is checked by the database BEFORE a human sees it
-- (format, checksum, state code, duplicate use), so typos and fakes never reach the review queue.
--
-- Security model
--   * Browser = read only. Every write goes through a checked function below.
--   * Documents live in a PRIVATE storage bucket. No public URL exists; documents open through links that expire.
--   * Suppliers cannot delete or overwrite uploaded evidence (no update/delete storage policy).
--   * Reviewing is limited to platform_admins, a table nobody can edit from the browser. An admin cannot review
--     a company they belong to, and only the admin who claimed a check can decide it.
--   * Buyers get a small public view (get_trust_passport): bank and address details and documents never leave.
--   * Every submission, claim, decision and document view is written to the append-only audit log.
--
-- Making someone a reviewer (SQL editor only, never from the app):
--   insert into public.platform_admins (user_id) select id from auth.users where email = 'you@yourcompany.com';

-- ───────────────────────── 1. reviewers ─────────────────────────
create table if not exists public.platform_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;
revoke all on public.platform_admins from anon, authenticated;   -- no policy on purpose: invisible to the API

create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.platform_admins a where a.user_id = (select auth.uid()))
$$;

-- ───────────────────────── 2. the proofs ─────────────────────────
create table if not exists public.verification_checks (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.businesses(id) on delete cascade,
  type         text not null check (type in ('registration', 'address', 'bank', 'certificate')),
  label        text not null default '' check (char_length(label) <= 80),    -- certificate name, or bank "Account ending 1234"
  reference    text not null default '' check (char_length(reference) <= 300), -- GSTIN / address / IFSC / certificate number
  issuer       text not null default '' check (char_length(issuer) <= 120),
  issued_on    date,
  expires_at   date,
  doc_path     text check (doc_path is null or char_length(doc_path) <= 300),
  doc_name     text check (doc_name is null or char_length(doc_name) <= 200),
  doc_size     bigint check (doc_size is null or doc_size between 1 and 10485760),
  status       text not null default 'draft'
                 check (status in ('draft', 'submitted', 'in_review', 'verified', 'rejected', 'superseded', 'expired')),
  auto_flags   jsonb not null default '{}'::jsonb,       -- what the database pre-check found (shown to the reviewer)
  submitted_by uuid references auth.users(id) on delete set null,
  submitted_at timestamptz,
  claimed_by   uuid references auth.users(id) on delete set null,
  claimed_at   timestamptz,
  reviewed_by  uuid references auth.users(id) on delete set null,
  reviewed_at  timestamptz,
  review_note  text check (review_note is null or char_length(review_note) <= 1000),
  warned_at    timestamptz,                               -- the "expires soon" notice was sent
  created_at   timestamptz not null default now()
);
create index if not exists verification_checks_org_idx on public.verification_checks (org_id);
create index if not exists verification_checks_queue_idx on public.verification_checks (status, submitted_at);

-- One open check per kind at a time (certificates: one open check per certificate name).
create unique index if not exists verification_checks_one_open_idx
  on public.verification_checks (org_id, type) where status in ('draft', 'submitted', 'in_review') and type <> 'certificate';
create unique index if not exists verification_checks_one_open_cert_idx
  on public.verification_checks (org_id, lower(label)) where status in ('draft', 'submitted', 'in_review') and type = 'certificate';
-- One GST number can be verified for ONE company only (stops someone borrowing another company's identity).
create unique index if not exists verification_checks_gstin_unique
  on public.verification_checks (reference) where type = 'registration' and status = 'verified';

alter table public.verification_checks enable row level security;
revoke all on public.verification_checks from anon, authenticated;
grant select on public.verification_checks to authenticated;
drop policy if exists verification_checks_read on public.verification_checks;
create policy verification_checks_read on public.verification_checks for select to authenticated
  using (public.is_member(org_id) or public.is_platform_admin());

-- ───────────────────────── 3. GST number pre-check ─────────────────────────
-- Same maths as src/lib/gstin.ts. Format + checksum + state code. Immutable: no table access.
create or replace function public._gstin_report(p_gstin text, p_state text default '')
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  g text := upper(btrim(coalesce(p_gstin, '')));
  chars constant text := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  states constant jsonb := '{"01":"Jammu and Kashmir","02":"Himachal Pradesh","03":"Punjab","04":"Chandigarh","05":"Uttarakhand",
    "06":"Haryana","07":"Delhi","08":"Rajasthan","09":"Uttar Pradesh","10":"Bihar","11":"Sikkim","12":"Arunachal Pradesh",
    "13":"Nagaland","14":"Manipur","15":"Mizoram","16":"Tripura","17":"Meghalaya","18":"Assam","19":"West Bengal",
    "20":"Jharkhand","21":"Odisha","22":"Chhattisgarh","23":"Madhya Pradesh","24":"Gujarat",
    "26":"Dadra and Nagar Haveli and Daman and Diu","27":"Maharashtra","29":"Karnataka","30":"Goa","31":"Lakshadweep",
    "32":"Kerala","33":"Tamil Nadu","34":"Puducherry","35":"Andaman and Nicobar Islands","36":"Telangana",
    "37":"Andhra Pradesh","38":"Ladakh"}'::jsonb;
  s int := 0; i int; v int; code text; sname text; format_ok boolean; sum_ok boolean := false;
begin
  format_ok := g ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$';
  if not format_ok then
    return jsonb_build_object('format_ok', false, 'checksum_ok', false, 'state_name', null, 'state_matches', null, 'pan', null);
  end if;
  for i in 0..13 loop
    v := (strpos(chars, substr(g, i + 1, 1)) - 1) * case when i % 2 = 0 then 1 else 2 end;
    s := s + v / 36 + v % 36;
  end loop;
  sum_ok := substr(chars, ((36 - s % 36) % 36) + 1, 1) = substr(g, 15, 1);
  code := substr(g, 1, 2);
  sname := states ->> code;
  return jsonb_build_object(
    'format_ok', true, 'checksum_ok', sum_ok, 'state_name', sname, 'pan', substr(g, 3, 10),
    'state_matches', case when sname is null or btrim(coalesce(p_state, '')) = '' then null
                          else lower(sname) = lower(btrim(p_state)) end);
end $$;

-- Browser helper (instant feedback while typing). Needs no login: it reads nothing.
create or replace function public.check_gstin(p_gstin text, p_state text default '')
returns jsonb language sql immutable set search_path = '' as $$ select public._gstin_report(p_gstin, p_state) $$;

-- ───────────────────────── 4. helpers ─────────────────────────
create or replace function public._notify_owners(p_org uuid, p_kind text, p_title text, p_body text)
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications (org_id, user_id, kind, title, body, link_to)
  select p_org, m.user_id, p_kind, p_title, p_body, '/supplier/verification'
    from public.memberships m where m.org_id = p_org and m.status = 'active' and m.role = 'owner'
$$;

-- 0 = none, 1 = Registered, 2 = Verified, 3 = Certified. Only proofs that are verified AND not past their date count.
create or replace function public._trust_level(p_org uuid)
returns int language sql stable security definer set search_path = '' as $$
  with ok as (
    select type from public.verification_checks
     where org_id = p_org and status = 'verified' and (expires_at is null or expires_at >= current_date))
  select case
    when not exists (select 1 from ok where type = 'registration') then 0
    when exists (select 1 from ok where type = 'address') and exists (select 1 from ok where type = 'bank')
         and exists (select 1 from ok where type = 'certificate') then 3
    when exists (select 1 from ok where type = 'address') and exists (select 1 from ok where type = 'bank') then 2
    else 1 end
$$;

-- Keeps the one-line summary (supplier_verifications, used by the dashboard badge) in step with the proofs.
create or replace function public._sync_summary(p_org uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_status text; v_reg text;
begin
  select reference into v_reg from public.verification_checks
   where org_id = p_org and type = 'registration' and status in ('verified', 'submitted', 'in_review')
   order by (status = 'verified') desc, created_at desc limit 1;
  v_status := case
    when public._trust_level(p_org) >= 1 then 'verified'
    when exists (select 1 from public.verification_checks where org_id = p_org and type = 'registration' and status = 'in_review') then 'in_review'
    when exists (select 1 from public.verification_checks where org_id = p_org and type = 'registration' and status = 'submitted') then 'submitted'
    -- a rejection only matters until a later, better attempt exists
    when (select c.status from public.verification_checks c where c.org_id = p_org and c.type = 'registration'
           order by c.created_at desc limit 1) = 'rejected' then 'rejected'
    else 'not_submitted' end;
  update public.supplier_verifications
     set status = v_status, registration_no = coalesce(v_reg, registration_no), updated_at = now(),
         reviewed_at = case when v_status in ('verified', 'rejected') then now() else reviewed_at end
   where org_id = p_org;
end $$;

-- Whether the caller may submit evidence for this company: its owner or finance manager, and it must be a supplier.
create or replace function public._can_manage_proofs(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.businesses b where b.id = p_org and b.kind = 'supplier')
     and public.has_role(p_org, array['owner', 'finance_manager'])
$$;

-- ───────────────────────── 5. supplier: create a proof, attach the file, submit ─────────────────────────
create or replace function public.start_check(
  p_org uuid, p_type text, p_label text default '', p_reference text default '', p_issuer text default '',
  p_issued_on date default null, p_expires_on date default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid()); v_label text := btrim(coalesce(p_label, '')); v_ref text := btrim(coalesce(p_reference, ''));
  v_iss text := btrim(coalesce(p_issuer, '')); v_id uuid; v_state text; v_rep jsonb;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if not public._can_manage_proofs(p_org) then raise exception 'not_allowed'; end if;
  if p_type not in ('registration', 'address', 'bank', 'certificate') then raise exception 'invalid_type'; end if;

  if p_type = 'registration' then
    v_ref := upper(v_ref); v_label := '';
    select state into v_state from public.businesses where id = p_org;
    v_rep := public._gstin_report(v_ref, v_state);
    if not (v_rep ->> 'format_ok')::boolean then raise exception 'invalid_gstin: the GST number is not in the right format'; end if;
    if not (v_rep ->> 'checksum_ok')::boolean then raise exception 'invalid_gstin: the GST number has a typo (checksum does not match)'; end if;
    if v_rep ->> 'state_name' is null then raise exception 'invalid_gstin: unknown state code'; end if;
    if exists (select 1 from public.verification_checks where type = 'registration' and status = 'verified'
                and reference = v_ref and org_id <> p_org) then
      raise exception 'gstin_in_use: this GST number is already verified for another company';
    end if;
  elsif p_type = 'bank' then
    v_ref := upper(v_ref);
    if v_ref !~ '^[A-Z]{4}0[A-Z0-9]{6}$' then raise exception 'invalid_ifsc: IFSC must look like HDFC0001234'; end if;
    if v_label !~ '^[0-9]{4}$' then raise exception 'invalid_account: give only the last 4 digits of the account number'; end if;
    v_label := 'Account ending ' || v_label;           -- the full account number is never stored
  elsif p_type = 'address' then
    v_label := '';
    if char_length(v_ref) < 15 then raise exception 'invalid_address: please give the full address'; end if;
  else
    if char_length(v_label) < 2 then raise exception 'invalid_label: name the certificate (for example ISO 9001)'; end if;
    if char_length(v_ref) < 3 then raise exception 'invalid_reference: enter the certificate number'; end if;
    if char_length(v_iss) < 2 then raise exception 'invalid_issuer: who issued the certificate?'; end if;
    if p_expires_on is null then raise exception 'invalid_expiry: enter the date the certificate expires'; end if;
    if (select count(*) from public.verification_checks where org_id = p_org and type = 'certificate'
         and status in ('draft', 'submitted', 'in_review', 'verified')) >= 20 then raise exception 'too_many_certificates'; end if;
  end if;
  if p_expires_on is not null and p_expires_on <= current_date then raise exception 'invalid_expiry: this document has already expired'; end if;
  if p_expires_on is not null and p_expires_on > current_date + interval '10 years' then raise exception 'invalid_expiry: too far in the future'; end if;
  if p_issued_on is not null and p_issued_on > current_date then raise exception 'invalid_issue_date: issue date is in the future'; end if;

  -- an old unfinished draft of the same kind is replaced
  delete from public.verification_checks where org_id = p_org and type = p_type and status = 'draft'
     and (p_type <> 'certificate' or lower(label) = lower(v_label));
  insert into public.verification_checks (org_id, type, label, reference, issuer, issued_on, expires_at, auto_flags, submitted_by)
    values (p_org, p_type, v_label, v_ref, v_iss, p_issued_on, p_expires_on, coalesce(v_rep, '{}'::jsonb), uid)
    returning id into v_id;
  return v_id;
end $$;

-- Registers the uploaded file with the check. The file must really be in the bucket, under this check's own folder.
create or replace function public.attach_document(p_check uuid, p_path text, p_name text)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.verification_checks; v_size bigint; v_mime text; v_has_storage boolean := to_regclass('storage.objects') is not null;
begin
  select * into c from public.verification_checks where id = p_check for update;
  if not found or not public._can_manage_proofs(c.org_id) then raise exception 'not_allowed'; end if;
  if c.status <> 'draft' then raise exception 'not_a_draft'; end if;
  if p_path is null or p_path not like (c.org_id::text || '/' || c.id::text || '/%') or p_path ~ '\.\.' then raise exception 'invalid_path'; end if;
  if v_has_storage then
    execute 'select (metadata ->> ''size'')::bigint, metadata ->> ''mimetype'' from storage.objects where bucket_id = ''verification-docs'' and name = $1'
      into v_size, v_mime using p_path;
    if v_size is null then raise exception 'file_missing: upload the file first'; end if;
    if v_size > 10485760 then raise exception 'file_too_large: maximum 10 MB'; end if;
    if v_mime not in ('application/pdf', 'image/jpeg', 'image/png') then raise exception 'file_type: PDF, JPG or PNG only'; end if;
  end if;
  update public.verification_checks
     set doc_path = p_path, doc_name = left(coalesce(nullif(btrim(p_name), ''), 'document'), 200), doc_size = v_size
   where id = p_check;
end $$;

create or replace function public.submit_check(p_check uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.verification_checks; uid uuid := (select auth.uid());
begin
  select * into c from public.verification_checks where id = p_check for update;
  if not found or not public._can_manage_proofs(c.org_id) then raise exception 'not_allowed'; end if;
  if c.status <> 'draft' then raise exception 'not_a_draft'; end if;
  if c.doc_path is null then raise exception 'document_required: attach the document before submitting'; end if;
  update public.verification_checks set status = 'submitted', submitted_at = now(), submitted_by = uid where id = p_check;
  perform public._sync_summary(c.org_id);
  perform public._audit(c.org_id, 'proof_submitted', 'verification_check', p_check, jsonb_build_object('type', c.type, 'label', c.label));
end $$;

-- Supplier throws away a proof that nobody has started reviewing yet.
create or replace function public.withdraw_check(p_check uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.verification_checks;
begin
  select * into c from public.verification_checks where id = p_check for update;
  if not found or not public._can_manage_proofs(c.org_id) then raise exception 'not_allowed'; end if;
  if c.status not in ('draft', 'submitted') then raise exception 'cannot_withdraw: it is already being reviewed'; end if;
  update public.verification_checks set status = 'superseded', review_note = 'Withdrawn by the supplier' where id = p_check;
  perform public._sync_summary(c.org_id);
  perform public._audit(c.org_id, 'proof_withdrawn', 'verification_check', p_check, jsonb_build_object('type', c.type));
end $$;

-- Lets a member or reviewer open a document; the audit trail records every viewing. The app then asks storage for a 60 s link.
create or replace function public.record_document_view(p_check uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare c public.verification_checks;
begin
  select * into c from public.verification_checks where id = p_check;
  if not found or c.doc_path is null then raise exception 'not_found'; end if;
  if not (public.is_member(c.org_id) or public.is_platform_admin()) then raise exception 'not_allowed'; end if;
  perform public._audit(c.org_id, 'document_viewed', 'verification_check', p_check, jsonb_build_object('type', c.type));
  return c.doc_path;
end $$;

-- ───────────────────────── 6. reviewers ─────────────────────────
-- The queue, oldest first, with everything a reviewer needs: who, what, what the database already checked, waiting time.
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
        'duplicate_gstin', c.type = 'registration' and exists (
            select 1 from public.verification_checks o where o.reference = c.reference and o.org_id <> c.org_id
               and o.type = 'registration' and o.status in ('submitted', 'in_review', 'verified'))
      ) as row
      from public.verification_checks c join public.businesses b on b.id = c.org_id
      where case when p_scope = 'done' then c.status in ('verified', 'rejected') and c.reviewed_at > now() - interval '30 days'
                 else c.status in ('submitted', 'in_review') end
      limit 200) q), '[]'::jsonb);
end $$;

create or replace function public.admin_claim_check(p_check uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.verification_checks; uid uuid := (select auth.uid());
begin
  if not public.is_platform_admin() then raise exception 'not_allowed'; end if;
  select * into c from public.verification_checks where id = p_check for update;
  if not found then raise exception 'not_found'; end if;
  if public.is_member(c.org_id) then raise exception 'conflict_of_interest: you belong to this company'; end if;
  if c.status = 'in_review' and c.claimed_by = uid then return; end if;
  if c.status <> 'submitted' then raise exception 'not_claimable: someone else has it or it is already decided'; end if;
  update public.verification_checks set status = 'in_review', claimed_by = uid, claimed_at = now() where id = p_check;
  perform public._sync_summary(c.org_id);
  perform public._audit(c.org_id, 'proof_claimed', 'verification_check', p_check, jsonb_build_object('type', c.type));
end $$;

-- A reviewer gives the claim back (went for lunch, found a conflict, ...).
create or replace function public.admin_release_check(p_check uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.verification_checks;
begin
  if not public.is_platform_admin() then raise exception 'not_allowed'; end if;
  select * into c from public.verification_checks where id = p_check for update;
  if not found or c.status <> 'in_review' or c.claimed_by is distinct from (select auth.uid()) then raise exception 'not_yours'; end if;
  update public.verification_checks set status = 'submitted', claimed_by = null, claimed_at = null where id = p_check;
  perform public._sync_summary(c.org_id);
end $$;

-- Verify or reject. Only the reviewer who claimed it. A rejection must explain why (the supplier sees it).
create or replace function public.admin_decide(p_check uuid, p_decision text, p_note text default '', p_expires_on date default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c public.verification_checks; uid uuid := (select auth.uid()); v_note text := btrim(coalesce(p_note, ''));
  v_exp date; v_title text; v_label text;
begin
  if not public.is_platform_admin() then raise exception 'not_allowed'; end if;
  if p_decision not in ('verify', 'reject') then raise exception 'invalid_decision'; end if;
  select * into c from public.verification_checks where id = p_check for update;
  if not found then raise exception 'not_found'; end if;
  if public.is_member(c.org_id) then raise exception 'conflict_of_interest: you belong to this company'; end if;
  if c.status <> 'in_review' or c.claimed_by is distinct from uid then raise exception 'not_yours: claim it first'; end if;
  v_label := case c.type when 'registration' then 'Business registration' when 'address' then 'Business address'
                         when 'bank' then 'Bank account' else coalesce(nullif(c.label, ''), 'Certificate') end;

  if p_decision = 'reject' then
    if char_length(v_note) < 10 then raise exception 'note_required: tell the supplier what to fix (at least 10 characters)'; end if;
    update public.verification_checks set status = 'rejected', reviewed_by = uid, reviewed_at = now(), review_note = v_note where id = p_check;
    perform public._notify_owners(c.org_id, 'proof_rejected', v_label || ' needs a fix', v_note);
  else
    -- how long the proof stays valid: the reviewer may choose; certificates keep the date printed on them
    v_exp := case when c.type = 'certificate' then least(coalesce(p_expires_on, c.expires_at), c.expires_at)
                  else coalesce(p_expires_on, current_date + case c.type when 'bank' then 180 else 365 end) end;
    if v_exp is null or v_exp <= current_date then raise exception 'invalid_expiry: the proof must be valid beyond today'; end if;
    if v_exp > current_date + interval '3 years' then raise exception 'invalid_expiry: maximum 3 years'; end if;
    -- the older verified proof of the same kind is replaced
    update public.verification_checks set status = 'superseded'
     where org_id = c.org_id and type = c.type and status in ('verified', 'expired') and id <> c.id
       and (c.type <> 'certificate' or lower(label) = lower(c.label));
    update public.verification_checks
       set status = 'verified', reviewed_by = uid, reviewed_at = now(), review_note = nullif(v_note, ''), expires_at = v_exp, warned_at = null
     where id = p_check;
    perform public._notify_owners(c.org_id, 'proof_verified', v_label || ' verified',
      'Buyers can now see this proof on your Trust Passport until ' || to_char(v_exp, 'DD Mon YYYY') || '.');
  end if;
  perform public._sync_summary(c.org_id);
  perform public._audit(c.org_id, case p_decision when 'verify' then 'proof_verified' else 'proof_rejected' end,
                        'verification_check', p_check, jsonb_build_object('type', c.type, 'label', c.label));
end $$;

-- ───────────────────────── 7. the passport itself ─────────────────────────
-- What a BUYER may see about a supplier. Only valid proofs. Registration and certificate numbers are public facts
-- (a buyer can check them elsewhere); bank and address details never appear.
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
      'verified_on', c.reviewed_at::date, 'expires_at', c.expires_at)
    order by case c.type when 'registration' then 1 when 'address' then 2 when 'bank' then 3 else 4 end, c.label), '[]'::jsonb)
    into v_checks
    from public.verification_checks c
   where c.org_id = p_org and c.status = 'verified' and (c.expires_at is null or c.expires_at >= current_date);
  return jsonb_build_object('level', v_level,
    'level_name', case v_level when 3 then 'Certified' when 2 then 'Verified' when 1 then 'Registered' else 'Not verified' end,
    'valid_through', (select min(c.expires_at) from public.verification_checks c
                       where c.org_id = p_org and c.status = 'verified' and c.expires_at >= current_date),
    'checks', v_checks);
end $$;

-- Run once a day (Supabase: Database → Cron, or an Edge Function with the service key).
-- Lapses stale proofs, warns suppliers 30 days ahead, and keeps every summary correct.
create or replace function public.refresh_trust_passports()
returns int language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
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
    perform public._notify_owners(r.org_id, 'proof_expiring', 'A proof expires soon',
      coalesce(nullif(r.label, ''), r.type) || ' expires on ' || to_char(r.expires_at, 'DD Mon YYYY') || '. Renew it to stay visible.');
  end loop;
  return n;
end $$;

-- ───────────────────────── 8. private document storage ─────────────────────────
-- Skipped automatically where there is no Supabase storage (such as a plain test database).
do $$ begin
  if to_regclass('storage.objects') is null then return; end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('verification-docs', 'verification-docs', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png'])
    on conflict (id) do update set public = false, file_size_limit = 10485760,
      allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png'];

  -- path rule: <company id>/<check id>/<file>
  drop policy if exists vdocs_read on storage.objects;
  create policy vdocs_read on storage.objects for select to authenticated
    using (bucket_id = 'verification-docs'
           and (public.is_platform_admin() or public.is_member(nullif(split_part(name, '/', 1), '')::uuid)));

  drop policy if exists vdocs_insert on storage.objects;
  create policy vdocs_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'verification-docs'
      and array_length(string_to_array(name, '/'), 1) = 3
      and public._can_manage_proofs(nullif(split_part(name, '/', 1), '')::uuid)
      and exists (select 1 from public.verification_checks c
                   where c.id = nullif(split_part(name, '/', 2), '')::uuid
                     and c.org_id = nullif(split_part(name, '/', 1), '')::uuid and c.status = 'draft')
      and (select count(*) from storage.objects o where o.bucket_id = 'verification-docs'
             and o.name like split_part(objects.name, '/', 1) || '/' || split_part(objects.name, '/', 2) || '/%') < 3);
  -- no update, no delete policy: uploaded evidence cannot be replaced or erased from the browser
end $$;

-- ───────────────────────── 9. who may call what ─────────────────────────
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('is_platform_admin', '_gstin_report', 'check_gstin', '_notify_owners', '_trust_level',
              '_sync_summary', '_can_manage_proofs', 'start_check', 'attach_document', 'submit_check', 'withdraw_check',
              'record_document_view', 'admin_queue', 'admin_claim_check', 'admin_release_check', 'admin_decide',
              'get_trust_passport', 'refresh_trust_passports')
  loop execute format('revoke all on function %s from public, anon, authenticated', f.sig); end loop;
end $$;

-- the storage policies call these as the signed-in user
grant execute on function public.is_platform_admin(), public._can_manage_proofs(uuid) to authenticated;
grant execute on function
  public.check_gstin(text, text), public.start_check(uuid, text, text, text, text, date, date),
  public.attach_document(uuid, text, text), public.submit_check(uuid), public.withdraw_check(uuid),
  public.record_document_view(uuid), public.admin_queue(text), public.admin_claim_check(uuid),
  public.admin_release_check(uuid), public.admin_decide(uuid, text, text, date), public.get_trust_passport(uuid)
  to authenticated;
grant execute on function public.refresh_trust_passports() to service_role;

notify pgrst, 'reload schema';
