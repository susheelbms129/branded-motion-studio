-- Vendora: RESET a DEVELOPMENT database so the three migrations can be run cleanly.
-- !!! DANGER: this DELETES EVERY TABLE AND FUNCTION in the `public` schema, and all the rows in them. !!!
-- Use it ONLY on a dev / test project, never on one that holds real customer data.
-- It does NOT touch sign-ups (auth.users): people can still sign in; their profiles are rebuilt by migration 3.
--
-- Then run, in this order:
--   1. 20261113000001_core_schema.sql
--   2. 20261113000002_invite_only_onboarding.sql
--   3. 20261114000003_onboarding_profiles.sql

do $$
declare r record;
begin
  drop trigger if exists on_auth_user_created on auth.users;
  for r in select tablename from pg_tables where schemaname = 'public' loop
    execute format('drop table if exists public.%I cascade', r.tablename);
  end loop;
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prokind in ('f', 'p') loop
    execute format('drop function if exists %s cascade', r.sig);
  end loop;
end $$;
