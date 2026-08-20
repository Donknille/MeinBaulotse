-- ---------------------------------------------------------------------------
-- NUR FÜR DIE LOKALE ENTWICKLUNG.
--
-- Bildet das nach, was ein Supabase-Projekt von Haus aus mitbringt: das
-- Schema `auth` mit `auth.users` und `auth.uid()`, die Rollen `anon`,
-- `authenticated` und `service_role`, sowie die Rollenauflösung aus dem
-- JWT-Claim. Damit laufen die Migrationen aus `supabase/migrations`
-- unverändert gegen einen nackten Postgres-Container — und die RLS-Tests
-- prüfen exakt dieselben Policies wie in der Produktion.
--
-- Diese Datei wird NIEMALS gegen ein Supabase-Projekt angewandt.
-- ---------------------------------------------------------------------------

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

grant anon, authenticated, service_role to current_user;

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  created_at timestamptz not null default now()
);

-- Entspricht der Supabase-Funktion: liest die Nutzerkennung aus dem
-- JWT-Claim, den die Anwendung je Transaktion setzt.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ),
    ''
  )::uuid
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'),
    'anon'
  )
$$;

create or replace function auth.email()
returns text
language sql
stable
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.email', true),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
    ),
    ''
  )
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to anon, authenticated, service_role;
