-- ===========================================================================
--
--  MeinBaulotse — vollständige Einrichtung der Datenbank
--
--  ERZEUGT. Nicht von Hand bearbeiten.
--  Quelle: supabase/migrations/*.sql
--  Neu erzeugen: pnpm --filter @meinbaulotse/db build:db-setup
--
--  ---------------------------------------------------------------------
--
--  So spielst du das ein:
--
--    Supabase-Dashboard → SQL Editor → New query → diese Datei vollständig
--    einfügen → Run. Einmal, für ein frisches Projekt.
--
--  Die Reihenfolge der Abschnitte ist bindend; sie bauen aufeinander auf.
--  Läuft ein Abschnitt auf einen Fehler, brich ab und behebe ihn, statt
--  weiterzumachen.
--
--  NICHT enthalten ist supabase/local/0000_auth_shim.sql, und das gehört
--  auch nicht hierher. Diese Datei bildet nur in einem nackten Postgres
--  nach, was ein Supabase-Projekt von Haus aus mitbringt: das Schema auth
--  mit auth.uid() sowie die Rollen anon, authenticated und service_role.
--
--  ---------------------------------------------------------------------
--
--  Danach zur Kontrolle:
--
--    select
--      (select count(*) from phase)              as phasen,             -- 9
--      (select count(*) from trade)              as gewerke,            -- 21
--      (select count(*) from role_permission)    as rechte,             -- 47
--      (select count(*) from plan_template_task) as vorlagenvorgaenge,  -- 38
--      (select count(*) from guide_card)         as lotsenkarten,       -- 12
--      (select count(*) from decision_template)  as entscheidungen,     -- 14
--      (select count(*) from payment_template)   as zahlungsvorlage,    -- 9
--      (select count(*) from scope_permission)   as gastrechte;         -- 7
--
--    select count(*) filter (where rowsecurity) as mit_rls,
--           count(*)                            as tabellen
--    from pg_tables where schemaname = 'public';                -- 32 von 32
--
--    select id, public from storage.buckets
--     where id = 'baustellenfotos';                             -- f
--
--  Die zweite Abfrage ist die wichtigere: Die Zählung oben stimmt auch
--  dann, wenn die Rechte nur zur Hälfte angekommen sind. Die dritte gehört
--  dazu, weil ohne den Eimer jedes Foto beim Hochladen scheitert — und
--  zwar erst auf der Baustelle.
--
-- ===========================================================================

-- ===========================================================================
--  Abschnitt: 0001_schema.sql
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- MeinBaulotse — Grundschema (Arbeitspaket 1)
--
-- Terminfelder sind durchgängig `date`, nie `timestamptz`. Ein Bauvorgang
-- beginnt an einem Tag, nicht zu einer Uhrzeit; alles andere führt früher oder
-- später zu einem Termin, der sich je nach Zeitzone um einen Tag verschiebt.
-- ---------------------------------------------------------------------------

create extension if not exists pgcrypto;

create schema if not exists mbl;
comment on schema mbl is 'Hilfsfunktionen für Rechteprüfung und Invarianten.';

-- Aufzählungstypen ----------------------------------------------------------

create type mbl.federal_state as enum (
  'BW','BY','BE','BB','HB','HH','HE','MV','NI','NW','RP','SL','SN','ST','SH','TH'
);

create type mbl.build_type as enum (
  'efh_massiv','efh_fertighaus','sanierung','sonstiges'
);

create type mbl.contract_type as enum (
  'verbraucherbauvertrag','einzelgewerke','sonstiges'
);

create type mbl.member_role as enum (
  'owner','co_owner','contractor','trade','expert','viewer'
);

create type mbl.task_status as enum (
  'geplant','terminiert','bestaetigt','laeuft','fertig','abgenommen','verschoben','entfallen'
);

create type mbl.confirmation as enum (
  'self_stated','counterparty_stated','mutual','disputed'
);

create type mbl.duration_unit as enum ('werktage','kalendertage');

create type mbl.dependency_type as enum ('FS','SS','FF');

create type mbl.actor_channel as enum ('app','guest_link','import','system');

create type mbl.include_when as enum ('always','with_basement','without_basement');

create type mbl.schedule_change_reason as enum (
  'witterung','lieferzeit','kapazitaet','planungsaenderung','bauherren_entscheidung',
  'vorgewerk_verzug','behoerde','mangelbeseitigung','nachtrag','planinitialisierung','sonstiges'
);

-- Gemeinsame Spalten --------------------------------------------------------

create or replace function mbl.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

-- Stammdaten ----------------------------------------------------------------

create table phase (
  key         text primary key,
  name        text not null,
  ordinal     int  not null unique,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table phase is 'Die neun Bauphasen aus Abschnitt 7.1 der Spezifikation.';

create table trade (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid,
  code        text not null,
  name        text not null,
  sort_order  int  not null default 0,
  color_key   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on column trade.project_id is 'NULL = globales Gewerk aus dem Seed; gesetzt = projekteigenes Gewerk.';
create unique index trade_global_code_key on trade (code) where project_id is null;
create unique index trade_project_code_key on trade (project_id, code) where project_id is not null;

-- Mandanten für Baubegleiter ------------------------------------------------

create table expert_org (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  created_by  uuid references auth.users (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table expert_org is
  'Büro eines Baubegleiters oder Sachverständigen. Trägt die Mandantenfähigkeit '
  'der Rolle expert: ein Mitglied dieser Organisation sieht alle Projekte, in '
  'die die Organisation eingeladen wurde.';

create table expert_org_member (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references expert_org (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  is_admin    boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (org_id, user_id)
);

-- Projekt und Beteiligte ----------------------------------------------------

create table project (
  id                      uuid primary key default gen_random_uuid(),
  name                    text not null,
  address                 text,
  postal_code             text,
  city                    text,
  federal_state           mbl.federal_state not null,
  catholic_municipality   boolean not null default false,
  lat                     numeric(9,6),
  lon                     numeric(9,6),
  build_type              mbl.build_type not null,
  contract_type           mbl.contract_type not null,
  has_basement            boolean not null default true,
  plan_template_key       text,
  planned_start           date not null,
  contractual_completion  date,
  contract_sum_cents      bigint,
  security_pct            numeric(4,2),
  diary_head_hash         text,
  baseline_locked_at      timestamptz,
  created_by              uuid not null references auth.users (id),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
comment on column project.catholic_municipality is
  'Überwiegend katholische Gemeinde. Steuert Mariä Himmelfahrt in Bayern sowie '
  'Fronleichnam in Sachsen und Thüringen.';
comment on column project.baseline_locked_at is
  'Ab diesem Zeitpunkt sind die Baseline-Termine der Vorgänge unveränderlich.';

create table project_member (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references project (id) on delete cascade,
  user_id       uuid references auth.users (id) on delete set null,
  role          mbl.member_role not null,
  display_name  text,
  company       text,
  email         text,
  phone         text,
  trade_id      uuid references trade (id) on delete set null,
  expert_org_id uuid references expert_org (id) on delete set null,
  invited_at    timestamptz not null default now(),
  accepted_at   timestamptz,
  revoked_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint project_member_trade_scope check (role <> 'trade' or trade_id is not null),
  constraint project_member_expert_scope check (expert_org_id is null or role = 'expert')
);
create unique index project_member_user_key on project_member (project_id, user_id)
  where user_id is not null and revoked_at is null;
create index project_member_project_idx on project_member (project_id);
create index project_member_user_idx on project_member (user_id) where user_id is not null;
create index project_member_org_idx on project_member (expert_org_id) where expert_org_id is not null;

-- Rechtematrix als Daten ----------------------------------------------------

create table role_permission (
  role        mbl.member_role not null,
  permission  text not null,
  primary key (role, permission)
);
comment on table role_permission is
  'Die Rechtematrix aus Abschnitt 2.2 der Spezifikation, als Daten statt als '
  'verstreute Policy-Bedingungen. Policies fragen mbl.has_perm().';

-- Ablauf --------------------------------------------------------------------

create table task (
  id                    uuid primary key default gen_random_uuid(),
  project_id            uuid not null references project (id) on delete cascade,
  trade_id              uuid references trade (id) on delete set null,
  name                  text not null,
  description           text,
  wbs_code              text,
  phase_key             text not null references phase (key),
  template_task_code    text,
  sort_order            int not null default 0,
  is_milestone          boolean not null default false,
  is_wait               boolean not null default false,
  duration_days         int not null default 1,
  duration_unit         mbl.duration_unit not null default 'werktage',
  baseline_start        date,
  baseline_end          date,
  current_start         date,
  current_end           date,
  actual_start          date,
  actual_end            date,
  status                mbl.task_status not null default 'geplant',
  confirmation          mbl.confirmation not null default 'self_stated',
  confirmed_by          uuid references project_member (id) on delete set null,
  confirmed_at          timestamptz,
  responsible_member_id uuid references project_member (id) on delete set null,
  total_float_days      int,
  is_critical           boolean not null default false,
  guide_card_id         uuid,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint task_duration_nonneg check (duration_days >= 0),
  constraint task_milestone_zero check (not is_milestone or duration_days = 0),
  constraint task_wait_unit check (not is_wait or duration_unit = 'kalendertage'),
  constraint task_current_order check (current_end is null or current_start is null or current_end >= current_start),
  constraint task_baseline_order check (baseline_end is null or baseline_start is null or baseline_end >= baseline_start),
  constraint task_actual_order check (actual_end is null or actual_start is null or actual_end >= actual_start)
);
create index task_project_idx on task (project_id);
create index task_project_start_idx on task (project_id, current_start);
create index task_trade_idx on task (trade_id) where trade_id is not null;
create unique index task_template_code_key on task (project_id, template_task_code)
  where template_task_code is not null;

create table dependency (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references project (id) on delete cascade,
  predecessor_id uuid not null references task (id) on delete cascade,
  successor_id   uuid not null references task (id) on delete cascade,
  type           mbl.dependency_type not null default 'FS',
  lag_days       int not null default 0,
  lag_unit       mbl.duration_unit not null default 'werktage',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint dependency_no_self check (predecessor_id <> successor_id),
  unique (predecessor_id, successor_id, type)
);
create index dependency_project_idx on dependency (project_id);
create index dependency_successor_idx on dependency (successor_id);

-- Änderungshistorie. APPEND-ONLY, siehe 0002_rls.sql ------------------------

create table schedule_change (
  id                        uuid primary key default gen_random_uuid(),
  project_id                uuid not null references project (id) on delete cascade,
  task_id                   uuid references task (id) on delete set null,
  field                     text not null,
  old_value                 jsonb,
  new_value                 jsonb,
  actor_member_id           uuid references project_member (id) on delete set null,
  actor_role                mbl.member_role,
  actor_channel             mbl.actor_channel not null default 'app',
  reason_code               mbl.schedule_change_reason,
  reason_text               text,
  effect_days_on_completion int,
  propagated_from_change_id uuid references schedule_change (id) on delete set null,
  created_at                timestamptz not null default now()
);
create index schedule_change_project_idx on schedule_change (project_id, created_at desc);
create index schedule_change_task_idx on schedule_change (task_id, created_at desc);
comment on table schedule_change is
  'Append-only. Weder Anwendung noch Datenbankrolle dürfen ändern oder löschen. '
  'Eine Historie, die nachträglich korrigierbar ist, ist keine Historie.';

create table audit_log (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid references project (id) on delete cascade,
  actor_member_id uuid references project_member (id) on delete set null,
  actor_channel   mbl.actor_channel not null default 'app',
  action          text not null,
  entity_type     text,
  entity_id       uuid,
  meta            jsonb,
  ip_hash         text,
  user_agent_hash text,
  created_at      timestamptz not null default now()
);
create index audit_log_project_idx on audit_log (project_id, created_at desc);

-- Ablaufvorlagen ------------------------------------------------------------

create table plan_template (
  key         text primary key,
  name        text not null,
  build_types mbl.build_type[] not null default '{}',
  version     int not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table plan_template is
  'Ablaufvorlagen als Daten, nicht als Konstanten im Code — damit sie ohne '
  'Deployment pflegbar bleiben.';

create table plan_template_task (
  id            uuid primary key default gen_random_uuid(),
  template_key  text not null references plan_template (key) on delete cascade,
  code          text not null,
  name          text not null,
  trade_code    text,
  phase_key     text not null references phase (key),
  duration_days int not null,
  duration_unit mbl.duration_unit not null default 'werktage',
  is_milestone  boolean not null default false,
  is_wait       boolean not null default false,
  include_when  mbl.include_when not null default 'always',
  sort_order    int not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (template_key, code),
  constraint plan_template_task_milestone_zero check (not is_milestone or duration_days = 0),
  constraint plan_template_task_wait_unit check (not is_wait or duration_unit = 'kalendertage')
);

create table plan_template_dependency (
  id               uuid primary key default gen_random_uuid(),
  template_key     text not null references plan_template (key) on delete cascade,
  predecessor_code text not null,
  successor_code   text not null,
  type             mbl.dependency_type not null default 'FS',
  lag_days         int not null default 0,
  lag_unit         mbl.duration_unit not null default 'werktage',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (template_key, predecessor_code, successor_code, type),
  constraint plan_template_dependency_no_self check (predecessor_code <> successor_code)
);

-- updated_at auf allen Tabellen ---------------------------------------------

do $$
declare
  target text;
begin
  foreach target in array array[
    'phase','trade','expert_org','expert_org_member','project','project_member',
    'task','dependency','plan_template','plan_template_task','plan_template_dependency'
  ]
  loop
    execute format(
      'create trigger %I before update on %I for each row execute function mbl.touch_updated_at()',
      target || '_touch_updated_at', target
    );
  end loop;
end
$$;


-- ===========================================================================
--  Abschnitt: 0002_rls.sql
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- MeinBaulotse — Rechte und Invarianten
--
-- Grundsatz aus Abschnitt 6.4 der Spezifikation: Rechte gehören in die
-- Datenbank. Der Anwendungscode benutzt niemals eine privilegierte Rolle; er
-- öffnet je Transaktion eine Verbindung als `authenticated` und setzt den
-- JWT-Claim. Was die Policies hier nicht erlauben, ist nicht erreichbar —
-- unabhängig davon, was der Anwendungscode tut oder unterlässt.
--
-- Jede Policy geht über die Hilfsfunktionen in `mbl`. Der Gast-Zugang aus
-- AP 6 wird deshalb später ausschließlich `mbl.current_user_id()` und
-- `mbl.current_member_id()` erweitern; keine einzige Policy muss dafür
-- angefasst werden.
-- ---------------------------------------------------------------------------

-- Hilfsfunktionen -----------------------------------------------------------
--
-- WICHTIG: Alle Hilfsfunktionen sind `security definer` und laufen damit unter
-- dem Eigentümer der Tabellen. Genau deshalb darf auf `project_member` KEIN
-- `force row level security` gesetzt werden: Die Policy von `project_member`
-- ruft diese Funktionen auf, und die Funktionen lesen `project_member`. Mit
-- erzwungener RLS würde sich das gegenseitig aufrufen, bis Postgres abbricht.
-- Das ist die Stelle, an der solche Schemata üblicherweise scheitern.

create or replace function mbl.current_user_id()
returns uuid
language sql
stable
security definer
set search_path = mbl, public, auth
as $$
  select auth.uid()
$$;
comment on function mbl.current_user_id() is
  'Aktuelle Nutzerkennung. Ab AP 6 löst diese Funktion zusätzlich Gast-Token auf.';

create or replace function mbl.current_member_id(p_project uuid)
returns uuid
language sql
stable
security definer
set search_path = mbl, public, auth
as $$
  select m.id
  from project_member m
  where m.project_id = p_project
    and m.revoked_at is null
    and (
      m.user_id = auth.uid()
      or (
        m.expert_org_id is not null
        and exists (
          select 1 from expert_org_member om
          where om.org_id = m.expert_org_id and om.user_id = auth.uid()
        )
      )
    )
  -- Direkte Mitgliedschaft schlägt die Mitgliedschaft über eine Organisation.
  order by (m.user_id = auth.uid()) desc
  limit 1
$$;

create or replace function mbl.member_role(p_project uuid)
returns mbl.member_role
language sql
stable
security definer
set search_path = mbl, public, auth
as $$
  select m.role from project_member m where m.id = mbl.current_member_id(p_project)
$$;

create or replace function mbl.member_trade(p_project uuid)
returns uuid
language sql
stable
security definer
set search_path = mbl, public, auth
as $$
  select m.trade_id from project_member m where m.id = mbl.current_member_id(p_project)
$$;

create or replace function mbl.is_member(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = mbl, public, auth
as $$
  select mbl.current_member_id(p_project) is not null
$$;

create or replace function mbl.has_perm(p_project uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = mbl, public, auth
as $$
  select exists (
    select 1
    from role_permission rp
    where rp.permission = p_permission
      and rp.role = mbl.member_role(p_project)
  )
$$;
comment on function mbl.has_perm(uuid, text) is
  'Prüft die Rechtematrix aus Abschnitt 2.2 gegen die Tabelle role_permission.';

-- Zeilenschärfe für Einzelgewerke: ein `trade` sieht und ändert nur Vorgänge
-- seines eigenen Gewerks.
create or replace function mbl.trade_scope_ok(p_project uuid, p_trade uuid)
returns boolean
language sql
stable
security definer
set search_path = mbl, public, auth
as $$
  select case
    when mbl.member_role(p_project) = 'trade' then p_trade is not distinct from mbl.member_trade(p_project)
    else true
  end
$$;

create or replace function mbl.is_org_admin(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = mbl, public, auth
as $$
  select exists (
    select 1 from expert_org_member om
    where om.org_id = p_org and om.user_id = auth.uid() and om.is_admin
  )
$$;

create or replace function mbl.is_org_member(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = mbl, public, auth
as $$
  select exists (
    select 1 from expert_org_member om
    where om.org_id = p_org and om.user_id = auth.uid()
  )
$$;

create or replace function mbl.actor_channel()
returns mbl.actor_channel
language sql
stable
as $$
  select coalesce(nullif(current_setting('app.actor_channel', true), ''), 'app')::mbl.actor_channel
$$;

-- Grundrechte ---------------------------------------------------------------

grant usage on schema mbl to anon, authenticated;
grant execute on all functions in schema mbl to anon, authenticated;
grant usage on schema public to anon, authenticated;

revoke all on all tables in schema public from public;

-- Nachschlagetabellen: lesen genügt.
grant select on phase, plan_template, plan_template_task, plan_template_dependency,
  role_permission to authenticated;

grant select, insert, update, delete on trade, project, project_member, task, dependency,
  expert_org, expert_org_member to authenticated;

-- Append-only: kein UPDATE, kein DELETE. Das ist die erste von zwei Sperren.
grant select, insert on schedule_change, audit_log to authenticated;

-- RLS einschalten -----------------------------------------------------------

alter table phase                    enable row level security;
alter table plan_template            enable row level security;
alter table plan_template_task       enable row level security;
alter table plan_template_dependency enable row level security;
alter table role_permission          enable row level security;
alter table trade                    enable row level security;
alter table expert_org               enable row level security;
alter table expert_org_member        enable row level security;
alter table project                  enable row level security;
alter table project_member           enable row level security;
alter table task                     enable row level security;
alter table dependency               enable row level security;
alter table schedule_change          enable row level security;
alter table audit_log                enable row level security;

-- Nachschlagetabellen -------------------------------------------------------

create policy phase_read on phase for select to authenticated using (true);
create policy plan_template_read on plan_template for select to authenticated using (true);
create policy plan_template_task_read on plan_template_task for select to authenticated using (true);
create policy plan_template_dependency_read on plan_template_dependency for select to authenticated using (true);
create policy role_permission_read on role_permission for select to authenticated using (true);

-- Gewerke -------------------------------------------------------------------

create policy trade_read on trade for select to authenticated
  using (project_id is null or mbl.is_member(project_id));

create policy trade_write on trade for insert to authenticated
  with check (project_id is not null and mbl.has_perm(project_id, 'task.write'));

create policy trade_update on trade for update to authenticated
  using (project_id is not null and mbl.has_perm(project_id, 'task.write'))
  with check (project_id is not null and mbl.has_perm(project_id, 'task.write'));

create policy trade_delete on trade for delete to authenticated
  using (project_id is not null and mbl.has_perm(project_id, 'task.write'));

-- Mandanten -----------------------------------------------------------------

create policy expert_org_read on expert_org for select to authenticated
  using (mbl.is_org_member(id));

create policy expert_org_create on expert_org for insert to authenticated
  with check (created_by = mbl.current_user_id());

create policy expert_org_update on expert_org for update to authenticated
  using (mbl.is_org_admin(id)) with check (mbl.is_org_admin(id));

create policy expert_org_member_read on expert_org_member for select to authenticated
  using (mbl.is_org_member(org_id));

-- Beim Anlegen einer Organisation gibt es noch kein Mitglied, das Admin sein
-- könnte. Deshalb darf sich der Gründer selbst eintragen, solange die
-- Organisation leer ist.
create policy expert_org_member_write on expert_org_member for insert to authenticated
  with check (
    mbl.is_org_admin(org_id)
    or (
      user_id = mbl.current_user_id()
      and not exists (select 1 from expert_org_member existing where existing.org_id = org_id)
    )
  );

create policy expert_org_member_update on expert_org_member for update to authenticated
  using (mbl.is_org_admin(org_id)) with check (mbl.is_org_admin(org_id));

create policy expert_org_member_delete on expert_org_member for delete to authenticated
  using (mbl.is_org_admin(org_id));

-- Projekt -------------------------------------------------------------------

-- Der zweite Zweig hat zwei Gründe.
--
-- Fachlich: Wer ein Projekt angelegt hat, verliert nie den Zugang dazu. Ein
-- Bauherr, den ein zweiter Bauherr versehentlich aus seinem eigenen Projekt
-- entfernt, stünde sonst vor verschlossener Tür.
--
-- Technisch: `insert … returning` verlangt zusätzlich zur WITH-CHECK- auch die
-- USING-Bedingung. Im Moment des Anlegens gibt es noch keine Mitgliedszeile,
-- die `mbl.is_member` finden könnte. Ohne diesen Zweig ließe sich kein Projekt
-- anlegen — und der Fehler läse sich irreführend als Verstoß gegen die
-- Einfügeregel.
--
-- `created_by` ist deshalb unveränderlich, siehe Trigger weiter unten.
create policy project_read on project for select to authenticated
  using (mbl.is_member(id) or created_by = mbl.current_user_id());

create policy project_create on project for insert to authenticated
  with check (created_by = mbl.current_user_id());

create policy project_update on project for update to authenticated
  using (mbl.has_perm(id, 'contract.write'))
  with check (mbl.has_perm(id, 'contract.write'));

create policy project_delete on project for delete to authenticated
  using (mbl.has_perm(id, 'project.delete'));

-- Mitglieder ----------------------------------------------------------------

create policy project_member_read on project_member for select to authenticated
  using (mbl.is_member(project_id));

-- Zweiter Zweig: Wer das Projekt angelegt hat, trägt sich selbst als owner ein.
-- Ohne diese Ausnahme käme niemand je in sein eigenes Projekt hinein.
create policy project_member_invite on project_member for insert to authenticated
  with check (
    mbl.has_perm(project_id, 'member.invite')
    or (
      role = 'owner'
      and user_id = mbl.current_user_id()
      and exists (
        select 1 from project p
        where p.id = project_id and p.created_by = mbl.current_user_id()
      )
    )
  );

create policy project_member_update on project_member for update to authenticated
  using (mbl.has_perm(project_id, 'member.invite'))
  with check (mbl.has_perm(project_id, 'member.invite'));

create policy project_member_delete on project_member for delete to authenticated
  using (mbl.has_perm(project_id, 'member.invite'));

-- Vorgänge ------------------------------------------------------------------

create policy task_read on task for select to authenticated
  using (mbl.is_member(project_id) and mbl.trade_scope_ok(project_id, trade_id));

create policy task_create on task for insert to authenticated
  with check (mbl.has_perm(project_id, 'task.write'));

-- Termine ändern und Ist-Stände melden dürfen auch Einzelgewerke, aber nur am
-- eigenen Vorgang.
create policy task_update on task for update to authenticated
  using (mbl.has_perm(project_id, 'task.schedule') and mbl.trade_scope_ok(project_id, trade_id))
  with check (mbl.has_perm(project_id, 'task.schedule') and mbl.trade_scope_ok(project_id, trade_id));

create policy task_delete on task for delete to authenticated
  using (mbl.has_perm(project_id, 'task.write'));

-- Abhängigkeiten ------------------------------------------------------------

create policy dependency_read on dependency for select to authenticated
  using (mbl.is_member(project_id));

create policy dependency_create on dependency for insert to authenticated
  with check (mbl.has_perm(project_id, 'task.write'));

create policy dependency_update on dependency for update to authenticated
  using (mbl.has_perm(project_id, 'task.write'))
  with check (mbl.has_perm(project_id, 'task.write'));

create policy dependency_delete on dependency for delete to authenticated
  using (mbl.has_perm(project_id, 'task.write'));

-- Historie ------------------------------------------------------------------
-- Bewusst nur SELECT und INSERT. Es gibt keine UPDATE- und keine DELETE-Policy;
-- zusammen mit dem entzogenen Recht und dem Trigger weiter unten sind das drei
-- unabhängige Sperren.

create policy schedule_change_read on schedule_change for select to authenticated
  using (mbl.is_member(project_id));

create policy schedule_change_append on schedule_change for insert to authenticated
  with check (mbl.is_member(project_id));

create policy audit_log_read on audit_log for select to authenticated
  using (project_id is not null and mbl.is_member(project_id));

create policy audit_log_append on audit_log for insert to authenticated
  with check (project_id is null or mbl.is_member(project_id));

-- ---------------------------------------------------------------------------
-- Invarianten aus Abschnitt 4.1 der Spezifikation
-- ---------------------------------------------------------------------------

-- (1) schedule_change ist append-only.
create or replace function mbl.forbid_history_change()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'schedule_change ist append-only: % ist nicht zulässig.', tg_op
    using errcode = 'raise_exception',
          hint = 'Änderungen werden als neuer Eintrag geschrieben, nie durch Überschreiben.';
end
$$;

create trigger schedule_change_append_only
  before update or delete on schedule_change
  for each row execute function mbl.forbid_history_change();

-- (3) Baseline-Termine sind nach dem Sperren unveränderlich.
create or replace function mbl.guard_baseline()
returns trigger
language plpgsql
security definer
set search_path = mbl, public
as $$
declare
  locked_at timestamptz;
begin
  if new.baseline_start is not distinct from old.baseline_start
     and new.baseline_end is not distinct from old.baseline_end then
    return new;
  end if;

  select p.baseline_locked_at into locked_at from project p where p.id = old.project_id;
  if locked_at is not null then
    raise exception
      'Die Baseline dieses Projekts ist seit % gesperrt und kann nicht geändert werden.', locked_at
      using errcode = 'raise_exception';
  end if;
  return new;
end
$$;

create trigger task_guard_baseline
  before update on task
  for each row execute function mbl.guard_baseline();

-- (4) Jede Terminänderung erzeugt zwingend einen Eintrag in der Historie.
create or replace function mbl.log_task_change()
returns trigger
language plpgsql
security definer
set search_path = mbl, public
as $$
declare
  actor_member uuid;
  actor        mbl.member_role;
  reason       mbl.schedule_change_reason;
  reason_note  text;
  channel      mbl.actor_channel;
begin
  actor_member := mbl.current_member_id(coalesce(new.project_id, old.project_id));
  actor := mbl.member_role(coalesce(new.project_id, old.project_id));
  channel := mbl.actor_channel();
  reason := nullif(current_setting('app.change_reason', true), '')::mbl.schedule_change_reason;
  reason_note := nullif(current_setting('app.change_reason_text', true), '');

  if tg_op = 'INSERT' then
    insert into schedule_change (
      project_id, task_id, field, old_value, new_value,
      actor_member_id, actor_role, actor_channel, reason_code, reason_text
    )
    values (
      new.project_id, new.id, 'task_created', null,
      jsonb_build_object(
        'name', new.name,
        'current_start', new.current_start,
        'current_end', new.current_end,
        'duration_days', new.duration_days,
        'status', new.status
      ),
      actor_member, actor, channel, coalesce(reason, 'planinitialisierung'), reason_note
    );
    return new;
  end if;

  if new.current_start is distinct from old.current_start then
    insert into schedule_change (project_id, task_id, field, old_value, new_value,
      actor_member_id, actor_role, actor_channel, reason_code, reason_text)
    values (new.project_id, new.id, 'current_start', to_jsonb(old.current_start),
      to_jsonb(new.current_start), actor_member, actor, channel, reason, reason_note);
  end if;

  if new.current_end is distinct from old.current_end then
    insert into schedule_change (project_id, task_id, field, old_value, new_value,
      actor_member_id, actor_role, actor_channel, reason_code, reason_text)
    values (new.project_id, new.id, 'current_end', to_jsonb(old.current_end),
      to_jsonb(new.current_end), actor_member, actor, channel, reason, reason_note);
  end if;

  if new.duration_days is distinct from old.duration_days then
    insert into schedule_change (project_id, task_id, field, old_value, new_value,
      actor_member_id, actor_role, actor_channel, reason_code, reason_text)
    values (new.project_id, new.id, 'duration_days', to_jsonb(old.duration_days),
      to_jsonb(new.duration_days), actor_member, actor, channel, reason, reason_note);
  end if;

  if new.status is distinct from old.status then
    insert into schedule_change (project_id, task_id, field, old_value, new_value,
      actor_member_id, actor_role, actor_channel, reason_code, reason_text)
    values (new.project_id, new.id, 'status', to_jsonb(old.status),
      to_jsonb(new.status), actor_member, actor, channel, reason, reason_note);
  end if;

  return new;
end
$$;

create trigger task_log_change
  after insert or update on task
  for each row execute function mbl.log_task_change();

-- `created_by` ist unveränderlich. Sonst ließe sich der Lesezugriff aus
-- project_read verschieben oder entziehen.
create or replace function mbl.guard_created_by()
returns trigger
language plpgsql
as $$
begin
  if new.created_by is distinct from old.created_by then
    raise exception 'Der Ersteller eines Projekts kann nicht geändert werden.'
      using errcode = 'raise_exception';
  end if;
  return new;
end
$$;

create trigger project_guard_created_by
  before update on project
  for each row execute function mbl.guard_created_by();

-- (5) Abhängigkeiten dürfen keinen Zyklus schließen.
create or replace function mbl.guard_dependency_cycle()
returns trigger
language plpgsql
security definer
set search_path = mbl, public
as $$
declare
  cycle_path uuid[];
begin
  if new.predecessor_id = new.successor_id then
    raise exception 'Ein Vorgang kann nicht sein eigener Vorgänger sein.'
      using errcode = 'raise_exception';
  end if;

  -- Erreicht der Nachfolger den Vorgänger, schließt die neue Kante einen Kreis.
  with recursive reachable (task_id, path) as (
    select new.successor_id, array[new.successor_id]
    union all
    select d.successor_id, r.path || d.successor_id
    from dependency d
    join reachable r on d.predecessor_id = r.task_id
    where not d.successor_id = any (r.path)
      and d.id is distinct from new.id
  )
  select path into cycle_path
  from reachable
  where task_id = new.predecessor_id
  limit 1;

  if cycle_path is not null then
    raise exception
      'Diese Abhängigkeit würde einen Zyklus schließen: %', cycle_path
      using errcode = 'raise_exception',
            hint = 'Ein Bauablauf darf sich nicht im Kreis drehen.';
  end if;

  return new;
end
$$;

create trigger dependency_guard_cycle
  before insert or update on dependency
  for each row execute function mbl.guard_dependency_cycle();

-- Nachfassen: Rechte auf später angelegte Objekte in mbl.
grant execute on all functions in schema mbl to anon, authenticated;


-- ===========================================================================
--  Abschnitt: 0003_seed.sql
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- MeinBaulotse — Stammdaten (erzeugt, nicht von Hand bearbeiten)
--
-- Erzeugt von packages/db/scripts/generate-seed.ts aus:
--   - packages/schedule/src/templates/efh-massiv-unterkellert.ts
--   - packages/db/src/permissions.ts
--
-- Enthält die neun Bauphasen aus Abschnitt 7.1, die Gewerke, die
-- Rechtematrix aus Abschnitt 2.2 und die Ablaufvorlage aus Abschnitt 7.2.
-- ---------------------------------------------------------------------------

-- Bauphasen -----------------------------------------------------------------

insert into phase (key, name, ordinal) values
  ('vorbereitung', 'Vorbereitung und Vertrag', 1),
  ('gruendung', 'Gründung und Keller', 2),
  ('rohbau', 'Rohbau', 3),
  ('dach_huelle', 'Dach und Gebäudehülle', 4),
  ('rohinstallation', 'Rohinstallationen', 5),
  ('ausbau', 'Innenausbau', 6),
  ('endausbau', 'Endausbau', 7),
  ('aussenanlagen', 'Außenanlagen', 8),
  ('abnahme', 'Abnahme und Übergabe', 9)
on conflict (key) do nothing;

-- Gewerke -------------------------------------------------------------------

insert into trade (project_id, code, name, sort_order) values
  (null, 'gutachter', 'Gutachter', 10),
  (null, 'vermesser', 'Vermesser', 20),
  (null, 'gu', 'Generalunternehmer', 30),
  (null, 'erdbau', 'Erdbau', 40),
  (null, 'rohbau', 'Rohbau', 50),
  (null, 'zimmerer', 'Zimmerer', 60),
  (null, 'dachdecker', 'Dachdecker', 70),
  (null, 'fensterbau', 'Fensterbau', 80),
  (null, 'elektro', 'Elektro', 90),
  (null, 'shk', 'Sanitär, Heizung, Klima', 100),
  (null, 'pruefer', 'Prüfer', 110),
  (null, 'putzer', 'Putzer', 120),
  (null, 'trockenbau', 'Trockenbau', 130),
  (null, 'estrich', 'Estrich', 140),
  (null, 'fliesen', 'Fliesenleger', 150),
  (null, 'tischler', 'Tischler', 160),
  (null, 'maler', 'Maler', 170),
  (null, 'bodenleger', 'Bodenleger', 180),
  (null, 'treppenbau', 'Treppenbau', 190),
  (null, 'galabau', 'Garten- und Landschaftsbau', 200),
  (null, 'reinigung', 'Reinigung', 210)
on conflict do nothing;

-- Rechtematrix (Abschnitt 2.2) ----------------------------------------------

insert into role_permission (role, permission) values
  ('owner', 'project.read'),  -- Lesen
  ('co_owner', 'project.read'),  -- Lesen
  ('contractor', 'project.read'),  -- Lesen
  ('trade', 'project.read'),  -- Lesen
  ('expert', 'project.read'),  -- Lesen
  ('viewer', 'project.read'),  -- Lesen
  ('owner', 'project.delete'),  -- Projekt anlegen/löschen
  ('owner', 'member.invite'),  -- Mitglieder einladen
  ('co_owner', 'member.invite'),  -- Mitglieder einladen
  ('owner', 'task.write'),  -- Vorgänge anlegen/löschen
  ('co_owner', 'task.write'),  -- Vorgänge anlegen/löschen
  ('contractor', 'task.write'),  -- Vorgänge anlegen/löschen
  ('owner', 'task.schedule'),  -- Termin ändern
  ('co_owner', 'task.schedule'),  -- Termin ändern
  ('contractor', 'task.schedule'),  -- Termin ändern
  ('trade', 'task.schedule'),  -- Termin ändern
  ('owner', 'task.confirm'),  -- Termin bestätigen
  ('co_owner', 'task.confirm'),  -- Termin bestätigen
  ('contractor', 'task.confirm'),  -- Termin bestätigen
  ('trade', 'task.confirm'),  -- Termin bestätigen
  ('owner', 'task.progress'),  -- Ist-Beginn/Ist-Ende melden
  ('co_owner', 'task.progress'),  -- Ist-Beginn/Ist-Ende melden
  ('contractor', 'task.progress'),  -- Ist-Beginn/Ist-Ende melden
  ('trade', 'task.progress'),  -- Ist-Beginn/Ist-Ende melden
  ('owner', 'decision.write'),  -- Entscheidung pflegen
  ('co_owner', 'decision.write'),  -- Entscheidung pflegen
  ('expert', 'decision.propose'),  -- Entscheidung pflegen (Vorschlag)
  ('owner', 'diary.write'),  -- Tagebucheintrag erstellen
  ('co_owner', 'diary.write'),  -- Tagebucheintrag erstellen
  ('contractor', 'diary.write'),  -- Tagebucheintrag erstellen
  ('expert', 'diary.write'),  -- Tagebucheintrag erstellen
  ('owner', 'defect.write'),  -- Mangel erfassen
  ('co_owner', 'defect.write'),  -- Mangel erfassen
  ('expert', 'defect.write'),  -- Mangel erfassen
  ('owner', 'defect.resolve'),  -- Mangel auf behoben setzen
  ('co_owner', 'defect.resolve'),  -- Mangel auf behoben setzen
  ('contractor', 'defect.resolve.propose'),  -- Mangel auf behoben setzen (Vorschlag)
  ('trade', 'defect.resolve.propose'),  -- Mangel auf behoben setzen (Vorschlag)
  ('expert', 'defect.resolve.propose'),  -- Mangel auf behoben setzen (Vorschlag)
  ('owner', 'payment.release'),  -- Zahlungsfreigabe
  ('co_owner', 'payment.release'),  -- Zahlungsfreigabe
  ('owner', 'contract.write'),  -- Vertragsdaten pflegen
  ('co_owner', 'contract.write'),  -- Vertragsdaten pflegen
  ('expert', 'contract.write'),  -- Vertragsdaten pflegen
  ('owner', 'export.run'),  -- Akte exportieren
  ('co_owner', 'export.run'),  -- Akte exportieren
  ('expert', 'export.run')  -- Akte exportieren
on conflict do nothing;

-- Ablaufvorlage (Abschnitt 7.2) ---------------------------------------------

insert into plan_template (key, name, build_types, version) values
  ('efh_massiv_unterkellert', 'Einfamilienhaus massiv, unterkellert', '{efh_massiv,efh_fertighaus,sanierung,sonstiges}', 1)
on conflict (key) do nothing;

insert into plan_template_task
  (template_key, code, name, trade_code, phase_key, duration_days, duration_unit,
   is_milestone, is_wait, include_when, sort_order)
values
  ('efh_massiv_unterkellert', 't01', 'Baugrundgutachten', 'gutachter', 'vorbereitung', 10, 'werktage', false, false, 'always', 10),
  ('efh_massiv_unterkellert', 't02', 'Vermessung, Absteckung, Schnurgerüst', 'vermesser', 'vorbereitung', 1, 'werktage', false, false, 'always', 20),
  ('efh_massiv_unterkellert', 't03', 'Baustelleneinrichtung, Bauwasser, Baustrom', 'gu', 'vorbereitung', 2, 'werktage', false, false, 'always', 30),
  ('efh_massiv_unterkellert', 't04', 'Erdarbeiten, Baugrube', 'erdbau', 'gruendung', 3, 'werktage', false, false, 'always', 40),
  ('efh_massiv_unterkellert', 't05', 'Sauberkeitsschicht, Fundamenterder', 'rohbau', 'gruendung', 2, 'werktage', false, false, 'always', 50),
  ('efh_massiv_unterkellert', 't06', 'Bodenplatte', 'rohbau', 'gruendung', 4, 'werktage', false, false, 'always', 60),
  ('efh_massiv_unterkellert', 't07', 'Aushärtung Bodenplatte', null, 'gruendung', 3, 'kalendertage', false, true, 'always', 70),
  ('efh_massiv_unterkellert', 't08', 'Kellerwände', 'rohbau', 'gruendung', 8, 'werktage', false, false, 'with_basement', 80),
  ('efh_massiv_unterkellert', 't09', 'Kellerdecke', 'rohbau', 'gruendung', 4, 'werktage', false, false, 'with_basement', 90),
  ('efh_massiv_unterkellert', 't10', 'Abdichtung, Perimeterdämmung, Drainage', 'rohbau', 'gruendung', 3, 'werktage', false, false, 'with_basement', 100),
  ('efh_massiv_unterkellert', 't11', 'Verfüllung Arbeitsraum', 'erdbau', 'gruendung', 2, 'werktage', false, false, 'with_basement', 110),
  ('efh_massiv_unterkellert', 't12', 'Erdgeschoss-Mauerwerk', 'rohbau', 'rohbau', 8, 'werktage', false, false, 'always', 120),
  ('efh_massiv_unterkellert', 't13', 'Geschossdecke EG', 'rohbau', 'rohbau', 4, 'werktage', false, false, 'always', 130),
  ('efh_massiv_unterkellert', 't14', 'Obergeschoss, Drempel, Ringanker', 'rohbau', 'rohbau', 7, 'werktage', false, false, 'always', 140),
  ('efh_massiv_unterkellert', 't15', 'Rohbau fertig, Richtfest', null, 'rohbau', 0, 'werktage', true, false, 'always', 150),
  ('efh_massiv_unterkellert', 't16', 'Dachstuhl', 'zimmerer', 'dach_huelle', 4, 'werktage', false, false, 'always', 160),
  ('efh_massiv_unterkellert', 't17', 'Dacheindeckung, Klempnerarbeiten', 'dachdecker', 'dach_huelle', 6, 'werktage', false, false, 'always', 170),
  ('efh_massiv_unterkellert', 't18', 'Fenster und Haustür', 'fensterbau', 'dach_huelle', 3, 'werktage', false, false, 'always', 180),
  ('efh_massiv_unterkellert', 't19', 'Gebäude dicht', null, 'dach_huelle', 0, 'werktage', true, false, 'always', 190),
  ('efh_massiv_unterkellert', 't20', 'Rohinstallation Elektro', 'elektro', 'rohinstallation', 8, 'werktage', false, false, 'always', 200),
  ('efh_massiv_unterkellert', 't21', 'Rohinstallation Sanitär und Heizung', 'shk', 'rohinstallation', 8, 'werktage', false, false, 'always', 210),
  ('efh_massiv_unterkellert', 't22', 'Lüftungsanlage', 'shk', 'rohinstallation', 4, 'werktage', false, false, 'always', 220),
  ('efh_massiv_unterkellert', 't23', 'Blower-Door-Vorabtest', 'pruefer', 'rohinstallation', 1, 'werktage', false, false, 'always', 230),
  ('efh_massiv_unterkellert', 't24', 'Innenputz', 'putzer', 'ausbau', 8, 'werktage', false, false, 'always', 240),
  ('efh_massiv_unterkellert', 't25', 'Trockenbau, Dachgeschossausbau', 'trockenbau', 'ausbau', 10, 'werktage', false, false, 'always', 250),
  ('efh_massiv_unterkellert', 't26', 'Estrich', 'estrich', 'ausbau', 3, 'werktage', false, false, 'always', 260),
  ('efh_massiv_unterkellert', 't27', 'Trocknung bis Belegreife', null, 'ausbau', 35, 'kalendertage', false, true, 'always', 270),
  ('efh_massiv_unterkellert', 't28', 'Fliesenarbeiten', 'fliesen', 'endausbau', 8, 'werktage', false, false, 'always', 280),
  ('efh_massiv_unterkellert', 't29', 'Innentüren', 'tischler', 'endausbau', 3, 'werktage', false, false, 'always', 290),
  ('efh_massiv_unterkellert', 't30', 'Malerarbeiten', 'maler', 'endausbau', 8, 'werktage', false, false, 'always', 300),
  ('efh_massiv_unterkellert', 't31', 'Bodenbeläge', 'bodenleger', 'endausbau', 5, 'werktage', false, false, 'always', 310),
  ('efh_massiv_unterkellert', 't32', 'Treppe', 'treppenbau', 'endausbau', 2, 'werktage', false, false, 'always', 320),
  ('efh_massiv_unterkellert', 't33', 'Endmontage Elektro', 'elektro', 'endausbau', 4, 'werktage', false, false, 'always', 330),
  ('efh_massiv_unterkellert', 't34', 'Endmontage Sanitär', 'shk', 'endausbau', 4, 'werktage', false, false, 'always', 340),
  ('efh_massiv_unterkellert', 't35', 'Außenanlagen, Zufahrt, Pflaster', 'galabau', 'aussenanlagen', 10, 'werktage', false, false, 'always', 350),
  ('efh_massiv_unterkellert', 't36', 'Baureinigung', 'reinigung', 'abnahme', 2, 'werktage', false, false, 'always', 360),
  ('efh_massiv_unterkellert', 't37', 'Abnahme und Übergabe', null, 'abnahme', 0, 'werktage', true, false, 'always', 370),
  ('efh_massiv_unterkellert', 't38', 'Schlussrechnung, Restzahlung', null, 'abnahme', 0, 'werktage', true, false, 'always', 380)
on conflict (template_key, code) do nothing;

insert into plan_template_dependency
  (template_key, predecessor_code, successor_code, type, lag_days, lag_unit)
values
  ('efh_massiv_unterkellert', 't02', 't03', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't03', 't04', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't04', 't05', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't05', 't06', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't06', 't07', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't07', 't08', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't08', 't09', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't09', 't10', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't10', 't11', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't09', 't12', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't12', 't13', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't13', 't14', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't14', 't15', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't15', 't16', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't16', 't17', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't16', 't18', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't17', 't19', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't18', 't19', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't19', 't20', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't19', 't21', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't21', 't22', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't20', 't23', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't21', 't23', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't22', 't23', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't23', 't24', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't23', 't25', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't24', 't26', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't25', 't26', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't26', 't27', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't27', 't28', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't24', 't29', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't28', 't30', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't29', 't30', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't30', 't31', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't30', 't32', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't31', 't33', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't28', 't34', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't31', 't34', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't19', 't35', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't33', 't36', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't34', 't36', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't36', 't37', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't37', 't38', 'FS', 0, 'werktage')
on conflict do nothing;


-- ===========================================================================
--  Abschnitt: 0004_task_constraint.sql
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Verschieben von Hand: die Anfangsbeschränkung.
--
-- Bis hierher war jeder Termin ein Rechenergebnis. Wer einen Vorgang
-- verschiebt, sagt aber etwas, das keine Rechnung wissen kann — der Kran kommt
-- eine Woche später, der Estrich ist geliefert. Diese Aussage braucht einen
-- Ort, sonst überschreibt die nächste Neuberechnung sie wieder.
--
-- `earliest_start` ist genau dieser Ort und heißt bewusst nicht `moved_to`:
-- Der Berechnungskern kennt die Beschränkung längst als `earliestStart`
-- („nicht früher als"), und ein Vorgang kann dadurch später liegen, als die
-- Beschränkung sagt — nämlich dann, wenn ein Vorgänger ihn ohnehin schiebt.
--
-- Ist-Termine brauchen keine eigene Spalte. `actual_start` und `actual_end`
-- gibt es seit 0001, und der Kern behandelt sie als das, was sie sind: nicht
-- eine Beschränkung, sondern eine Tatsache, die die Rechnung überschreibt.
-- ---------------------------------------------------------------------------

alter table task add column if not exists earliest_start date;

comment on column task.earliest_start is
  'Anfangsbeschränkung: nicht früher als. Entsteht, wenn jemand den Vorgang verschiebt.';

-- Der Trigger mbl.log_task_change schreibt Termin- und Statusänderungen bereits
-- in schedule_change. Eine Beschränkung ist keine Terminänderung für sich — sie
-- wirkt über die Neuberechnung, und die verschiebt current_start und
-- current_end. Genau diese beiden landen in der Historie, und das ist die
-- richtige Auskunft: nicht „jemand hat eine Beschränkung gesetzt", sondern
-- „dieser Vorgang liegt jetzt anders".


-- ===========================================================================
--  Abschnitt: 0005_guide_card.sql
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- MeinBaulotse — Wissensschicht (Arbeitspaket 2)
--
-- Die Lotsenkarte aus Abschnitt 3.1 der Spezifikation. Sie ist der Grund,
-- warum es dieses Produkt gibt: Ein Bauherr scheitert selten daran, dass er
-- nicht weiß, wann der Fliesenleger kommt. Er scheitert daran, dass er nicht
-- weiß, was er nicht weiß.
--
-- Drei Tabellen, drei verschiedene Sorten Daten, und die Trennung ist der Kern
-- des Entwurfs:
--
--   guide_card       Redaktionsinhalt. Gehört niemandem, gilt für alle,
--                    unveränderlich nach der Veröffentlichung.
--   guide_card_read  Was ein einzelner Mensch gesehen und wie er es bewertet
--                    hat. Gehört seinem Projekt.
--   checklist_item   Sein Haken an einer Zeile der Karte. Ebenfalls seins.
--
-- Der Redaktionsinhalt liegt als Daten in der Datenbank, nicht als Konstante
-- im Code (Regel 5) — sonst braucht jede Korrektur an einem Satz eine
-- Auslieferung, und dann wird sie nicht gemacht.
-- ---------------------------------------------------------------------------

-- Redaktionsinhalt ----------------------------------------------------------

create table guide_card (
  id                       uuid primary key default gen_random_uuid(),
  key                      text not null,
  version                  int  not null default 1,
  phase_key                text not null references phase (key),
  trade_code               text,
  build_types              mbl.build_type[] not null default '{}',
  -- An welche Vorgänge der Ablaufvorlage die Karte gehört. Über diese Codes
  -- findet ein Projekt seine Karten, ohne dass die Redaktion Projekte kennen
  -- müsste.
  task_codes               text[] not null default '{}',
  title                    text not null,
  whats_happening          text not null,
  watch_for                jsonb not null default '[]',  -- [{text, why}]
  questions_for_contractor jsonb not null default '[]',  -- [{question, why_it_matters}]
  common_problems          jsonb not null default '[]',  -- [{problem, how_to_spot}]
  photo_prompts            jsonb not null default '[]',  -- [{key, what, why, before_task_code}]
  expert_recommended       boolean not null default false,
  expert_reason            text,
  -- Trägt die Karte eine Gesetzesstelle, erscheint der feste Zusatz aus
  -- CI 11.3: „Hinweis auf eine Gesetzesstelle, keine Rechtsberatung."
  legal_note               boolean not null default false,
  sources                  jsonb not null default '[]',  -- [{title, reference}]
  published_at             timestamptz,
  superseded_by            uuid references guide_card (id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (key, version),
  -- Eine Empfehlung ohne Begründung ist eine Behauptung. Abschnitt 1.4 der
  -- Spezifikation verlangt, dass die Grenze des Produkts offen benannt wird —
  -- dann auch mit Grund.
  constraint guide_card_expert_reason
    check (not expert_recommended or expert_reason is not null),
  constraint guide_card_version_positive check (version >= 1),
  constraint guide_card_not_self_superseded check (superseded_by is distinct from id)
);
comment on table guide_card is
  'Lotsenkarte nach Abschnitt 3.1. Nach published_at unveränderlich; eine '
  'Korrektur ist eine neue Version, die alte wird über superseded_by verkettet.';
comment on column guide_card.task_codes is
  'Codes aus plan_template_task. Die Zuordnung zu einem konkreten Vorgang '
  'passiert einmalig beim Anlegen des Projekts und friert damit die Fassung '
  'ein, die der Bauherr tatsächlich gesehen hat.';
comment on column guide_card.sources is
  'Herkunft jeder Aussage. Ohne Quelle keine Aussage — an dieser Stelle steht '
  'die Glaubwürdigkeit des gesamten Produkts (Abschnitt 6.3).';

create index guide_card_task_codes_idx on guide_card using gin (task_codes);
create index guide_card_phase_idx on guide_card (phase_key);
-- Je Schlüssel gibt es höchstens eine gültige Fassung: die, die niemand
-- abgelöst hat.
create unique index guide_card_current_key on guide_card (key)
  where superseded_by is null and published_at is not null;

-- Erst jetzt kann die Verknüpfung aus 0001 auch eine echte Beziehung sein.
alter table task
  add constraint task_guide_card_fk
  foreign key (guide_card_id) references guide_card (id) on delete set null;

-- Was der Nutzer gesehen hat -------------------------------------------------

create table guide_card_read (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references project (id) on delete cascade,
  guide_card_id uuid not null references guide_card (id) on delete cascade,
  member_id     uuid not null references project_member (id) on delete cascade,
  read_at       timestamptz not null default now(),
  -- Die einzige Metrik, die für die Redaktion zählt (Abschnitt 5.2).
  -- `null` heißt: gelesen, aber nicht bewertet.
  helpful       boolean,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (project_id, guide_card_id, member_id)
);
comment on table guide_card_read is
  'Gelesen-Stand und Rückmeldung je Mensch und Projekt. Grundlage für die '
  'Wiedervorlage und für die Frage, ob eine Karte ihren Zweck erfüllt.';

create index guide_card_read_project_idx on guide_card_read (project_id);
create index guide_card_read_card_idx on guide_card_read (guide_card_id);

-- Checklisten ----------------------------------------------------------------

create table checklist_item (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references project (id) on delete cascade,
  task_id       uuid not null references task (id) on delete cascade,
  guide_card_id uuid references guide_card (id) on delete set null,
  -- Verweis auf die Zeile der Karte, aus der der Haken stammt. Bleibt gültig,
  -- wenn die Karte eine neue Fassung bekommt: Der Haken hängt an der Aussage,
  -- nicht an ihrer Formulierung.
  source_key    text not null,
  text          text not null,
  is_done       boolean not null default false,
  done_at       timestamptz,
  done_by       uuid references project_member (id) on delete set null,
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (project_id, task_id, source_key)
);
comment on table checklist_item is
  'Der Haken des Bauherrn an einer Zeile aus watch_for. Entsteht erst beim '
  'ersten Antippen — eine Checkliste, die schon vor dem ersten Blick in der '
  'Datenbank steht, ist eine Liste offener Aufgaben, und das schreckt ab.';

create index checklist_item_task_idx on checklist_item (task_id);
create index checklist_item_project_idx on checklist_item (project_id);

-- updated_at -----------------------------------------------------------------

create trigger guide_card_touch_updated_at
  before update on guide_card
  for each row execute function mbl.touch_updated_at();

create trigger guide_card_read_touch_updated_at
  before update on guide_card_read
  for each row execute function mbl.touch_updated_at();

create trigger checklist_item_touch_updated_at
  before update on checklist_item
  for each row execute function mbl.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Invariante 6 aus Abschnitt 4.1: veröffentlichte Karten sind unveränderlich.
--
-- Der Grund ist nicht Ordnungsliebe. Wenn ein Bauherr im Mai gelesen hat, die
-- Aufbauhöhe müsse vor dem Estrich feststehen, und im September steht dort
-- etwas anderes, dann lässt sich hinterher nicht mehr sagen, welchen Rat er
-- damals bekommen hat. Genau diese Frage ist die einzige, die im Streitfall
-- zählt.
--
-- Die Sperre sitzt im Trigger und nicht in einer Policy, weil sie auch dann
-- gelten muss, wenn jemand mit vollen Rechten im SQL-Editor sitzt. Das ist die
-- Abnahmebedingung von AP 2: „Eine veröffentlichte Karte lässt sich per SQL
-- nicht ändern."
--
-- Ausgenommen ist genau ein Feld: `superseded_by`. Es ist der einzige Weg,
-- eine Karte abzulösen — und es lässt sich nur einmal setzen.
-- ---------------------------------------------------------------------------

create or replace function mbl.guard_guide_card_published()
returns trigger
language plpgsql
as $$
declare
  vorher jsonb;
  nachher jsonb;
begin
  if tg_op = 'DELETE' then
    if old.published_at is not null then
      raise exception
        'Die Lotsenkarte %/% ist veröffentlicht und kann nicht gelöscht werden.',
        old.key, old.version
        using errcode = 'raise_exception',
              hint = 'Eine überholte Karte wird abgelöst, nicht entfernt: superseded_by setzen.';
    end if;
    return old;
  end if;

  if old.published_at is null then
    return new;
  end if;

  -- `updated_at` gehört nicht zur Aussage, `superseded_by` ist die erlaubte
  -- Ausnahme. Alles andere wird verglichen — auch Spalten, die es heute noch
  -- nicht gibt.
  vorher  := to_jsonb(old) - 'superseded_by' - 'updated_at';
  nachher := to_jsonb(new) - 'superseded_by' - 'updated_at';

  if nachher is distinct from vorher then
    raise exception
      'Die Lotsenkarte %/% ist seit % veröffentlicht und unveränderlich.',
      old.key, old.version, old.published_at
      using errcode = 'raise_exception',
            hint = 'Änderungen entstehen als neue Version; die alte wird über superseded_by verkettet.';
  end if;

  if old.superseded_by is not null and new.superseded_by is distinct from old.superseded_by then
    raise exception
      'Die Lotsenkarte %/% ist bereits abgelöst. Die Verkettung bleibt, wie sie ist.',
      old.key, old.version
      using errcode = 'raise_exception';
  end if;

  return new;
end
$$;

create trigger guide_card_guard_published
  before update or delete on guide_card
  for each row execute function mbl.guard_guide_card_published();

-- ---------------------------------------------------------------------------
-- Rechte
-- ---------------------------------------------------------------------------

-- Redaktionsinhalt ist eine Nachschlagetabelle: lesen genügt. Geschrieben wird
-- er über Migrationen und den SQL-Editor, nicht aus der Anwendung heraus —
-- deshalb bekommt die Anwendungsrolle hier kein INSERT.
grant select on guide_card to authenticated;

grant select, insert, update on guide_card_read to authenticated;
grant select, insert, update, delete on checklist_item to authenticated;

alter table guide_card      enable row level security;
alter table guide_card_read enable row level security;
alter table checklist_item  enable row level security;

create policy guide_card_read_all on guide_card for select to authenticated
  using (true);

-- Gelesen-Stand und Rückmeldung gehören dem Menschen, der sie abgegeben hat.
-- Sichtbar sind sie im Projekt — sonst wüsste ein zweiter Bauherr nicht, dass
-- der erste die Karte schon kennt.
create policy guide_card_read_select on guide_card_read for select to authenticated
  using (mbl.is_member(project_id));

create policy guide_card_read_insert on guide_card_read for insert to authenticated
  with check (
    mbl.is_member(project_id)
    and member_id = mbl.current_member_id(project_id)
  );

create policy guide_card_read_update on guide_card_read for update to authenticated
  using (member_id = mbl.current_member_id(project_id))
  with check (member_id = mbl.current_member_id(project_id));

-- Die Checkliste ist das Werkzeug der Bauherrenseite und des Baubegleiters.
--
-- Sie steht bewusst **nicht** in der Rechtematrix aus Abschnitt 2.2: Die
-- Matrix beschreibt die Handlungen am Bauvorhaben, und ein Haken an einer
-- Merkzeile ist keine. Deshalb wird hier über die Rolle entschieden und nicht
-- über `mbl.has_perm` — eine erfundene Matrixzeile wäre die schlechtere
-- Auskunft.
--
-- `viewer` liest nur (Abschnitt 2.1), `contractor` und `trade` führen aus; die
-- Merkliste des Bauherrn ist nicht ihre.
create policy checklist_item_select on checklist_item for select to authenticated
  using (mbl.is_member(project_id));

create policy checklist_item_insert on checklist_item for insert to authenticated
  with check (
    mbl.is_member(project_id)
    and mbl.member_role(project_id) in ('owner', 'co_owner', 'expert')
  );

create policy checklist_item_update on checklist_item for update to authenticated
  using (
    mbl.is_member(project_id)
    and mbl.member_role(project_id) in ('owner', 'co_owner', 'expert')
  )
  with check (
    mbl.is_member(project_id)
    and mbl.member_role(project_id) in ('owner', 'co_owner', 'expert')
  );

create policy checklist_item_delete on checklist_item for delete to authenticated
  using (
    mbl.is_member(project_id)
    and mbl.member_role(project_id) in ('owner', 'co_owner', 'expert')
  );


-- ===========================================================================
--  Abschnitt: 0006_guide_cards.sql
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- MeinBaulotse — Lotsenkarten (erzeugt, nicht von Hand bearbeiten)
--
-- Erzeugt von packages/db/scripts/generate-guide-cards.ts aus
-- content/lotsenkarten/*.md. Neu erzeugen:
--   pnpm --filter @meinbaulotse/db cards:generate
--
-- 12 Karten aus Abschnitt 7.4 der Spezifikation. Sie decken die Phasen ab,
-- in denen am meisten schiefgeht.
--
-- Die Karten werden mit gesetztem published_at eingespielt und sind damit ab
-- diesem Moment unveränderlich. Eine Korrektur ist eine neue Fassung.
-- ---------------------------------------------------------------------------

-- Bodenplatte und Fundamenterder (01-bodenplatte.md)
insert into guide_card (
  key, version, phase_key, trade_code, build_types, task_codes, title, whats_happening,
  watch_for, questions_for_contractor, common_problems, photo_prompts,
  expert_recommended, expert_reason, legal_note, sources, published_at
) values (
  'bodenplatte', 1, 'gruendung', 'rohbau',
  '{}'::mbl.build_type[], array['t05', 't06']::text[],
  'Bodenplatte und Fundamenterder',
  'Auf dem verdichteten Baugrund entsteht zuerst eine dünne Sauberkeitsschicht, darauf kommen Dämmung, Bewehrung und die Bodenplatte aus Beton. In dieselbe Platte werden zwei Dinge eingebaut, die später niemand mehr erreicht: der Fundamenterder — ein Metallband, das dein Haus elektrisch mit dem Erdreich verbindet — und die Leerrohre, durch die Wasser, Strom und Internet ins Haus kommen.

Das ist der Tag, an dem am wenigsten sichtbar ist und am meisten festgelegt wird.',
  '[{"key":"w1","text":"Der Fundamenterder liegt vor dem Betonieren sichtbar in der Bewehrung, mit Anschlussfahnen, die aus dem Beton herausschauen","why":"nachträglich lässt sich ein Erder nur noch als Ringerder im Erdreich ergänzen, und das kostet ein Vielfaches"},{"key":"w2","text":"Die Anschlussfahnen sind aus nichtrostendem Stahl, nicht aus verzinktem Bandstahl","why":"verzinkter Stahl korrodiert genau an der Stelle, an der er den Beton verlässt"},{"key":"w3","text":"Alle Leerrohre für Hausanschlüsse liegen, bevor Beton kommt: Wasser, Strom, Telekommunikation, bei Bedarf Fernwärme oder Erdwärme","why":"eine Kernbohrung durch die fertige Bodenplatte ist möglich, aber sie durchtrennt die Abdichtung"},{"key":"w4","text":"Die Bewehrung liegt auf Abstandhaltern und nicht auf der Dämmung auf","why":"nur so bekommt der Stahl ringsum genug Beton und rostet nicht"},{"key":"w5","text":"Nach dem Betonieren wird die Platte feucht gehalten oder abgedeckt","why":"Beton, der zu schnell austrocknet, bekommt Risse und erreicht seine Festigkeit nicht"}]'::jsonb,
  '[{"key":"q1","question":"Welche Betonfestigkeits- und Expositionsklasse ist für die Bodenplatte vorgesehen, und woher stammt die Vorgabe?","whyItMatters":"die Klassen kommen aus der Statik und dem Bodengutachten, nicht aus Gewohnheit"},{"key":"q2","question":"Wie viele Anschlussfahnen des Fundamenterders gibt es, und wo genau kommen sie heraus?","whyItMatters":"du brauchst mindestens eine am Hausanschlussraum, weitere bei Blitzschutz oder Photovoltaik"},{"key":"q3","question":"Bekomme ich das Aufmaß der Leerrohre und ein Foto der Lage, bevor betoniert wird?","whyItMatters":"das ist die einzige Dokumentation, die es je geben wird"},{"key":"q4","question":"Wie wird die Bodenplatte nachbehandelt, und über wie viele Tage?","whyItMatters":"die Nachbehandlung ist eine geschuldete Leistung, keine Freundlichkeit"},{"key":"q5","question":"Ab welcher Außentemperatur wird nicht betoniert, und was passiert dann mit dem Termin?","whyItMatters":"dann weißt du vorher, dass Frost den Plan verschiebt, und nicht erst hinterher"}]'::jsonb,
  '[{"key":"c1","problem":"Der Fundamenterder fehlt ganz oder hat zu wenige Anschlussfahnen","howToSpot":"vor dem Betonieren schaut kein Metallband aus der Bewehrung heraus"},{"key":"c2","problem":"Verzinkter Bandstahl wurde durch den Beton ins Erdreich geführt","howToSpot":"silbrig glänzendes Band statt mattem Edelstahl an der Austrittsstelle"},{"key":"c3","problem":"Ein Leerrohr wurde vergessen","howToSpot":"fällt meistens erst auf, wenn der Anschluss gelegt werden soll"},{"key":"c4","problem":"Die Platte wurde bei Frost oder starker Hitze ohne Schutzmaßnahmen betoniert","howToSpot":"netzartige Risse an der Oberfläche in den ersten Tagen"},{"key":"c5","problem":"Die Höhenlage stimmt nicht mit der Planung überein","howToSpot":"die Oberkante der Platte passt nicht zum eingemessenen Höhenbezug des Vermessers"}]'::jsonb,
  '[{"key":"p1","what":"Die gesamte Bewehrungslage mit dem eingebauten Fundamenterder, aus mehreren Blickwinkeln","why":"danach ist der Aufbau im Beton und für immer unsichtbar","beforeTaskCode":"t06"},{"key":"p2","what":"Jede Anschlussfahne einzeln, mit einem Zollstock oder Meterstab als Maßstab daneben","why":"die Position brauchst du beim Elektroanschluss und beim Potentialausgleich","beforeTaskCode":"t06"},{"key":"p3","what":"Alle Leerrohre mit Abstand zu zwei festen Bezugspunkten, etwa den Achsen des Schnurgerüsts","why":"ohne Maßbezug ist ein Foto später nicht auswertbar","beforeTaskCode":"t06"}]'::jsonb,
  true, 'Alles, was hier eingebaut wird, verschwindet im Beton. Später ist es nicht mehr prüfbar und nur mit erheblichem Aufwand zu korrigieren.', false,
  '[{"title":"DIN 18014, Fundamenterder","note":"Ausführung, Werkstoffe und Anschlussfahnen"},{"title":"DIN EN 206 und DIN 1045-2, Beton","note":"Festigkeits- und Expositionsklassen"},{"title":"DIN 1045-3, Ausführung von Tragwerken aus Beton","note":"Betondeckung und Nachbehandlung"},{"title":"Verband Privater Bauherren, Ratgeber zur Baubegleitung","note":"Prüftermine, die Sachverständige üblicherweise setzen"}]'::jsonb,
  now()
)
on conflict (key, version) do nothing;

-- Kellerabdichtung, Dämmung und Drainage (02-kellerabdichtung.md)
insert into guide_card (
  key, version, phase_key, trade_code, build_types, task_codes, title, whats_happening,
  watch_for, questions_for_contractor, common_problems, photo_prompts,
  expert_recommended, expert_reason, legal_note, sources, published_at
) values (
  'kellerabdichtung', 1, 'gruendung', 'rohbau',
  '{}'::mbl.build_type[], array['t10', 't11']::text[],
  'Kellerabdichtung, Dämmung und Drainage',
  'Die Kelleraußenwände bekommen von außen eine Abdichtung gegen Wasser, darauf eine Dämmung, die im Erdreich liegen darf, und häufig eine Noppenbahn als Schutz. Wenn der Baugrund es verlangt, kommt zusätzlich eine Drainage: ein Rohr, das Wasser vom Haus wegführt. Danach wird der Arbeitsraum zwischen Wand und Erdreich wieder verfüllt.

Welche Abdichtung nötig ist, entscheidet nicht der Geschmack, sondern das Wasser im Boden. Diese Auskunft steht in deinem Baugrundgutachten.',
  '[{"key":"w1","text":"Im Baugrundgutachten steht eine Wassereinwirkungsklasse, und die Ausführung passt dazu","why":"eine Abdichtung gegen Bodenfeuchte hält drückendem Wasser nicht stand, und der Unterschied ist von außen nicht zu sehen"},{"key":"w2","text":"Am Übergang von der Bodenplatte zur Wand ist eine Hohlkehle ausgebildet","why":"die innere Ecke ist die Stelle, an der eine Abdichtung zuerst reißt"},{"key":"w3","text":"Jede Durchdringung durch die Wand hat einen eigenen dichten Anschluss","why":"Rohre für Wasser und Strom sind die häufigsten Leckstellen"},{"key":"w4","text":"Die Abdichtung ist durchgetrocknet, bevor Dämmung und Noppenbahn davorkommen","why":"eingeschlossene Feuchtigkeit bleibt für immer eingeschlossen"},{"key":"w5","text":"Die Noppenbahn endet oben mit einer Abschlussschiene und nicht offen","why":"offen wird sie zur Rinne, die Wasser genau dorthin leitet, wo es nicht hin soll"},{"key":"w6","text":"Verfüllt wird lagenweise mit geeignetem Material, nicht mit dem Aushub samt Steinen und Bauschutt","why":"scharfkantiges Material beschädigt die Abdichtung beim Verdichten"}]'::jsonb,
  '[{"key":"q1","question":"Welche Wassereinwirkungsklasse nach DIN 18533 liegt der Ausführung zugrunde, und auf welche Seite des Gutachtens stützt sie sich?","whyItMatters":"die Antwort verweist auf ein Dokument und nicht auf eine Meinung"},{"key":"q2","question":"Welches Abdichtungssystem wird eingesetzt, und in welcher Schichtdicke?","whyItMatters":"bei Bitumendickbeschichtungen ist die Trockenschichtdicke die entscheidende Größe"},{"key":"q3","question":"Wird eine Drainage eingebaut, und wohin wird das Wasser abgeführt?","whyItMatters":"eine Drainage ohne freien Ablauf staut das Wasser am Haus, statt es wegzuführen"},{"key":"q4","question":"Wann genau ist die Abdichtung fertig und noch offen sichtbar?","whyItMatters":"das ist das Zeitfenster für eine Fachprüfung und für deine Fotos"},{"key":"q5","question":"Womit wird der Arbeitsraum verfüllt, und in welchen Lagen wird verdichtet?","whyItMatters":"das Verfüllen ist der Moment, in dem eine fertige Abdichtung wieder kaputtgehen kann"}]'::jsonb,
  '[{"key":"c1","problem":"Die Abdichtung passt nicht zur tatsächlichen Wasserbelastung","howToSpot":"das Gutachten nennt zeitweise aufstauendes Sickerwasser, ausgeführt ist eine einfache Bitumenbeschichtung"},{"key":"c2","problem":"Die Hohlkehle fehlt oder ist zu klein","howToSpot":"der Übergang von Platte zu Wand ist ein scharfer rechter Winkel"},{"key":"c3","problem":"Die Beschichtung ist zu dünn aufgetragen","howToSpot":"der Untergrund schimmert stellenweise durch, die Fläche wirkt fleckig"},{"key":"c4","problem":"Die Noppenbahn wird für die Abdichtung gehalten","howToSpot":"hinter der Bahn liegt blankes Mauerwerk statt einer geschlossenen Beschichtung"},{"key":"c5","problem":"Die Drainage liegt zu hoch oder ohne Gefälle","howToSpot":"das Rohr liegt oberhalb der Unterkante der Bodenplatte oder ohne Spülschächte an den Ecken"},{"key":"c6","problem":"Verfüllt wurde mit dem groben Aushub","howToSpot":"Steine und Bauschutt liegen direkt an der Wand"}]'::jsonb,
  '[{"key":"p1","what":"Die fertige, noch offene Abdichtung über die ganze Wandhöhe, Wand für Wand","why":"nach dem Verfüllen ist keine einzige Stelle mehr erreichbar","beforeTaskCode":"t11"},{"key":"p2","what":"Die Hohlkehle und jeden Rohrdurchgang aus der Nähe","why":"das sind die Stellen, an denen später gesucht wird","beforeTaskCode":"t11"},{"key":"p3","what":"Das verlegte Drainagerohr mit Kiesbett und den Spülschächten","why":"nur so ist später nachvollziehbar, wo gespült werden kann","beforeTaskCode":"t11"}]'::jsonb,
  true, 'Ein feuchter Keller ist der teuerste Baumangel überhaupt, weil er sich nur von außen beheben lässt: Das Erdreich muss wieder weg.', false,
  '[{"title":"DIN 18533, Abdichtung von erdberührten Bauteilen","note":"Wassereinwirkungsklassen und zulässige Abdichtungsarten"},{"title":"DIN 4095, Dränung zum Schutz baulicher Anlagen","note":"wann eine Drainage sinnvoll ist und wie sie auszuführen ist"},{"title":"DIN 4108-10, Wärmedämmstoffe, Anwendungstypen","note":"welche Dämmung im Erdreich verwendet werden darf"},{"title":"Bauherren-Schutzbund, Hinweise zur Bauüberwachung","note":"empfohlene Kontrollzeitpunkte am Keller"}]'::jsonb,
  now()
)
on conflict (key, version) do nothing;

-- Mauerwerk und Geschossdecken (03-mauerwerk.md)
insert into guide_card (
  key, version, phase_key, trade_code, build_types, task_codes, title, whats_happening,
  watch_for, questions_for_contractor, common_problems, photo_prompts,
  expert_recommended, expert_reason, legal_note, sources, published_at
) values (
  'mauerwerk', 1, 'rohbau', 'rohbau',
  '{}'::mbl.build_type[], array['t12', 't13', 't14']::text[],
  'Mauerwerk und Geschossdecken',
  'Die Außen- und Innenwände werden gemauert, dazwischen entstehen die Geschossdecken. Aus einer Bodenplatte wird in wenigen Wochen ein Haus mit Räumen, und zum ersten Mal lässt sich begehen, was bisher nur ein Grundriss war.

Genau deshalb ist es der richtige Moment, um Maße zu prüfen: Was jetzt an falscher Stelle steht, steht dort für die nächsten achtzig Jahre.',
  '[{"key":"w1","text":"Geh mit dem Grundriss durch die Räume und prüfe die Öffnungen für Fenster und Türen","why":"eine falsch gesetzte Öffnung ist im Rohbau eine Tagesarbeit und nach dem Innenputz eine Baustelle"},{"key":"w2","text":"Die Steine sind trocken gelagert und abgedeckt","why":"nasse Steine bringen Feuchtigkeit ins Haus, die später über Monate wieder heraus muss"},{"key":"w3","text":"Angefangene Wände werden über Nacht und übers Wochenende abgedeckt","why":"Regen läuft in die Hohlkammern der Steine und steht dort"},{"key":"w4","text":"Die Stoßfugen sind so ausgeführt, wie der Steinhersteller es vorschreibt","why":"bei manchen Steinen sind offene Stoßfugen zulässig, bei anderen sind sie eine Undichtigkeit im Schall- und Wärmeschutz"},{"key":"w5","text":"Schlitze und Aussparungen sind eingeplant und nicht nachträglich gestemmt","why":"nachträgliche Schlitze können die Tragfähigkeit einer Wand verringern"},{"key":"w6","text":"Über jeder Öffnung sitzt ein Sturz mit ausreichender Auflagerlänge","why":"die Auflagerlänge steht in der Statik und wird auf der Baustelle gern gekürzt"}]'::jsonb,
  '[{"key":"q1","question":"Wann kann ich mit dem Grundriss durch den Rohbau gehen, bevor die Decke darüber kommt?","whyItMatters":"danach sind Änderungen an Öffnungen deutlich teurer"},{"key":"q2","question":"Wie werden die Wandkronen bei Regen und über das Wochenende geschützt?","whyItMatters":"die Antwort sagt dir, wie viel Baufeuchte du später wieder heraustrocknen musst"},{"key":"q3","question":"Welche Maßtoleranzen gelten für Wände und Decken, und nach welcher Norm?","whyItMatters":"dann redet ihr später über dieselbe Zahl und nicht über Empfinden"},{"key":"q4","question":"Sind alle Aussparungen für Lüftung, Abgas und Hausanschlüsse eingeplant?","whyItMatters":"jede vergessene Aussparung wird zum Kernbohrer im fertigen Mauerwerk"},{"key":"q5","question":"Wie hoch ist die Oberkante der Rohdecke bezogen auf die spätere Oberkante des fertigen Fußbodens?","whyItMatters":"aus dieser Differenz ergibt sich, wie viel Platz der Fußbodenaufbau tatsächlich hat"}]'::jsonb,
  '[{"key":"c1","problem":"Eine Öffnung sitzt an der falschen Stelle oder hat das falsche Maß","howToSpot":"Nachmessen mit dem Grundriss, bevor die nächste Decke liegt"},{"key":"c2","problem":"Der Rohbau steht über Wochen offen im Regen","howToSpot":"stehendes Wasser auf den Decken, dunkle Ränder an den Wänden"},{"key":"c3","problem":"Wände sind nicht lotrecht oder Räume nicht rechtwinklig","howToSpot":"an den Ecken mit einem langen Richtscheit oder über die Diagonalen des Raums"},{"key":"c4","problem":"Der Ringanker wurde unterbrochen","howToSpot":"an den Stoßstellen zwischen zwei Wandabschnitten unter der Decke"},{"key":"c5","problem":"Nachträglich gestemmte waagerechte Schlitze in tragenden Wänden","howToSpot":"frische Fräsungen quer durch die Wand, oft für Leitungen"}]'::jsonb,
  '[{"key":"p1","what":"Jede Wand mit ihren Öffnungen, bevor die nächste Geschossdecke liegt","why":"der Rohbau ist die einzige Fassung des Hauses, die man vollständig sehen kann","beforeTaskCode":"t14"},{"key":"p2","what":"Alle Aussparungen und Durchbrüche mit Maßbezug zu einer Raumecke","why":"später liegen Leitungen darin und niemand weiß mehr, wie groß der Durchbruch war","beforeTaskCode":"t14"},{"key":"p3","what":"Auflager und Stürze über den größeren Öffnungen","why":"die Auflagerlänge ist nach dem Innenputz nicht mehr nachweisbar","beforeTaskCode":"t24"}]'::jsonb,
  false, null, false,
  '[{"title":"DIN EN 1996 mit Nationalem Anhang, Eurocode 6, Mauerwerksbau","note":"Ausführung, Schlitze und Aussparungen"},{"title":"DIN 18202, Toleranzen im Hochbau","note":"zulässige Abweichungen für Ebenheit, Flucht und Winkligkeit"},{"title":"Verarbeitungsrichtlinie des Steinherstellers","note":"Mörtelart, Stoßfugenausbildung und Witterungsschutz"},{"title":"DIN 4108-7, Luftdichtheit von Gebäuden","note":"warum Fugen im Mauerwerk mehr sind als eine Frage der Optik"}]'::jsonb,
  now()
)
on conflict (key, version) do nothing;

-- Dachstuhl und Eindeckung (04-dach.md)
insert into guide_card (
  key, version, phase_key, trade_code, build_types, task_codes, title, whats_happening,
  watch_for, questions_for_contractor, common_problems, photo_prompts,
  expert_recommended, expert_reason, legal_note, sources, published_at
) values (
  'dach', 1, 'dach_huelle', 'dachdecker',
  '{}'::mbl.build_type[], array['t16', 't17']::text[],
  'Dachstuhl und Eindeckung',
  'Der Zimmerer stellt den Dachstuhl, danach kommt die Eindeckung: erst eine Unterdeckbahn, darauf Konterlattung und Traglattung, dann die Ziegel oder Steine. Der Klempner setzt Rinnen, Fallrohre und die Anschlussbleche an Schornstein, Kehlen und Gauben.

Das Dach ist die einzige Bauteilgruppe, bei der zwei Schichten Wasser abhalten: die Eindeckung, die man sieht, und die Unterdeckung darunter, die man nie wieder sieht.',
  '[{"key":"w1","text":"Das verbaute Holz ist trocken und trägt eine Kennzeichnung","why":"zu feucht eingebautes Holz schwindet, dann arbeiten die Verbindungen und es knackt jahrelang"},{"key":"w2","text":"Auf der Unterdeckbahn liegt eine Konterlattung, bevor die Traglattung kommt","why":"erst der Zwischenraum lüftet die Dachfläche, ohne ihn bleibt Feuchtigkeit im Aufbau stehen"},{"key":"w3","text":"Die Bahnen überlappen nach unten und sind an den Stößen verklebt oder verklemmt","why":"die Unterdeckung ist deine zweite Wasserebene, wenn ein Ziegel bei Sturm verrutscht"},{"key":"w4","text":"Die Kehlen, Anschlüsse und Durchdringungen sind sauber eingebunden","why":"an diesen Stellen läuft im Ernstfall das meiste Wasser zusammen"},{"key":"w5","text":"Die Dachneigung passt zu dem, was der Ziegelhersteller als Mindestneigung angibt","why":"darunter braucht es zusätzliche Maßnahmen, und die müssen vereinbart sein"}]'::jsonb,
  '[{"key":"q1","question":"Welche Regeldachneigung gilt für die vorgesehene Deckung, und wird sie eingehalten?","whyItMatters":"wird sie unterschritten, sind Zusatzmaßnahmen geschuldet und keine Kulanz"},{"key":"q2","question":"Welche Klasse hat die Unterdeckung, und ist sie regensicher ausgeführt?","whyItMatters":"bei geringer Neigung oder ausgebautem Dachgeschoss ist das die entscheidende Angabe"},{"key":"q3","question":"Wann ist das Dach so weit, dass das Haus als dicht gilt?","whyItMatters":"dieser Termin ist der Auslöser für die nächste Abschlagszahlung und für die Innenarbeiten"},{"key":"q4","question":"Wie werden Gerüst und Dachfläche gegen Sturm gesichert, solange noch nicht eingedeckt ist?","whyItMatters":"eine offene Dachfläche ist bei Wind die verletzlichste Phase des ganzen Baus"},{"key":"q5","question":"Wer stellt die Rinnen und Fallrohre her, und wo werden sie angeschlossen?","whyItMatters":"die Ableitung des Regenwassers gehört zur Erschließung und wird oft übersehen"}]'::jsonb,
  '[{"key":"c1","problem":"Die Konterlattung fehlt","howToSpot":"die Traglattung liegt direkt auf der Unterdeckbahn"},{"key":"c2","problem":"Die Unterdeckbahn ist beim Verlegen beschädigt worden","howToSpot":"Risse und Löcher, meist an den Tritten der Lattung, sichtbar nur vor dem Eindecken"},{"key":"c3","problem":"Die Anschlüsse an Schornstein oder Gaube sind nur verputzt statt eingeblecht","howToSpot":"kein sichtbares Blech, das unter die Deckung geführt wird"},{"key":"c4","problem":"Zu feuchtes Holz","howToSpot":"frische Schnittflächen wirken dunkel und fühlen sich kühl an, später Risse im Balken"},{"key":"c5","problem":"Dachfenster ohne Anschlussmanschette","howToSpot":"der Übergang zwischen Fensterrahmen und Unterdeckbahn ist offen"}]'::jsonb,
  '[{"key":"p1","what":"Die vollständige Unterdeckbahn mit Konterlattung, bevor eingedeckt wird","why":"danach liegt die zweite Wasserebene für Jahrzehnte unter den Ziegeln","beforeTaskCode":"t17"},{"key":"p2","what":"Alle Kehlen, Anschlüsse und Durchdringungen einzeln","why":"an diesen Stellen wird bei einer undichten Stelle zuerst gesucht","beforeTaskCode":"t17"},{"key":"p3","what":"Den Dachstuhl im Ganzen, mit Blick auf Verbindungen und Auflager","why":"nach dem Ausbau des Dachgeschosses ist die Konstruktion verkleidet","beforeTaskCode":"t25"}]'::jsonb,
  false, null, false,
  '[{"title":"Fachregeln des Deutschen Dachdeckerhandwerks, ZVDH","note":"Regeldachneigung, Unterdeckungsklassen und Anschlüsse"},{"title":"DIN 68800, Holzschutz","note":"Anforderungen an Holzfeuchte und konstruktiven Holzschutz"},{"title":"Statik und Prüfstatik des Bauvorhabens","note":"Querschnitte, Verbindungsmittel und Auflager"},{"title":"Klempnerfachregeln, ZVSHK und ZVDH","note":"Rinnen, Fallrohre und Anschlussbleche"}]'::jsonb,
  now()
)
on conflict (key, version) do nothing;

-- Fenstereinbau und Anschlussdichtung (05-fenster.md)
insert into guide_card (
  key, version, phase_key, trade_code, build_types, task_codes, title, whats_happening,
  watch_for, questions_for_contractor, common_problems, photo_prompts,
  expert_recommended, expert_reason, legal_note, sources, published_at
) values (
  'fenster', 1, 'dach_huelle', 'fensterbau',
  '{}'::mbl.build_type[], array['t18']::text[],
  'Fenstereinbau und Anschlussdichtung',
  'Die Fenster und die Haustür werden gesetzt, ausgerichtet, befestigt und ringsum an das Mauerwerk angeschlossen. Der Anschluss ist die eigentliche Leistung: Ein gutes Fenster in einer schlechten Fuge ist ein schlechtes Fenster.

Die Regel dahinter heißt „innen dichter als außen". Innen muss die Fuge luftdicht sein, damit keine feuchte Raumluft hineinzieht. Außen muss sie Schlagregen abhalten, aber Feuchtigkeit wieder heraustrocknen lassen.',
  '[{"key":"w1","text":"Der Anschluss besteht aus mehr als Bauschaum","why":"Schaum dämmt, aber er dichtet nicht, und ohne dichte Ebenen wandert Feuchtigkeit in die Fuge"},{"key":"w2","text":"Innen ist eine durchgehende dichte Ebene erkennbar, meist ein Folienband oder ein Dichtstoff","why":"das ist die Ebene, die im Blower-Door-Test gemessen wird"},{"key":"w3","text":"Das Fenster steht auf Tragklötzen und ist nicht nur eingeschäumt","why":"das Gewicht muss ins Mauerwerk geleitet werden, sonst verzieht sich der Rahmen"},{"key":"w4","text":"Die Fensterbank ist seitlich in die Laibung eingebunden und hat Gefälle nach außen","why":"die seitlichen Anschlüsse der Fensterbank sind eine der häufigsten Undichtigkeiten"},{"key":"w5","text":"Die Beschläge lassen sich leicht bedienen, die Flügel schließen ringsum gleichmäßig","why":"ungleichmäßiger Anpressdruck ist der erste Hinweis auf einen verzogenen Einbau"}]'::jsonb,
  '[{"key":"q1","question":"Nach welchem Verfahren werden die Fenster angeschlossen, und welche Ebenen sind vorgesehen?","whyItMatters":"die Antwort sollte drei Ebenen benennen und nicht ein Produkt"},{"key":"q2","question":"Welchen Uw-Wert haben die eingebauten Fenster, und stimmt er mit dem Energienachweis überein?","whyItMatters":"der Nachweis rechnet mit einem Wert, den das eingebaute Fenster erreichen muss"},{"key":"q3","question":"Welche Widerstandsklasse gegen Einbruch haben Fenster und Haustür?","whyItMatters":"die Nachrüstung kostet ein Vielfaches der Mehrkosten beim Einbau"},{"key":"q4","question":"Ist bei den bodentiefen Fenstern eine Absturzsicherung vorgesehen, und wie wird sie ausgeführt?","whyItMatters":"das ist keine Ausstattungsfrage, sondern eine Anforderung an das Glas oder ein Geländer"},{"key":"q5","question":"Wann werden die Fenster gesetzt, und wie lange bleiben die Anschlüsse offen sichtbar?","whyItMatters":"nur in diesem Zeitfenster lässt sich der Anschluss überhaupt prüfen"}]'::jsonb,
  '[{"key":"c1","problem":"Der Anschluss besteht ausschließlich aus Montageschaum","howToSpot":"rundum quillt gelber Schaum aus der Fuge, kein Band, kein Dichtstoff"},{"key":"c2","problem":"Die innere Dichtebene ist unterbrochen","howToSpot":"das Folienband endet an den Ecken oder ist an der Fensterbank nicht angeschlossen"},{"key":"c3","problem":"Es fehlen Trag- und Distanzklötze","howToSpot":"unter dem Rahmen ist nur Schaum zu sehen"},{"key":"c4","problem":"Der seitliche Anschluss der Fensterbank fehlt","howToSpot":"die Fensterbank läuft ohne Bördel oder Endstück in die Laibung"},{"key":"c5","problem":"Die Fenster werden zu früh gesetzt und auf der Baustelle beschädigt","howToSpot":"Kratzer im Glas oder im Rahmen, die niemandem mehr zuzuordnen sind"}]'::jsonb,
  '[{"key":"p1","what":"Die Anschlussfuge ringsum an jedem Fenster, bevor Innenputz oder Laibungsverkleidung kommt","why":"nach dem Putz ist die Fuge verdeckt und nur noch mit Aufwand zu beurteilen","beforeTaskCode":"t24"},{"key":"p2","what":"Die innere Dichtebene an mindestens einer Ecke jedes Fensters aus der Nähe","why":"die Ecken sind die Stellen, an denen die Ebene unterbrochen wird","beforeTaskCode":"t24"},{"key":"p3","what":"Fenster und Rahmen im Anlieferungszustand, bevor der Bau weiterläuft","why":"eine Beschädigung lässt sich später nur zuordnen, wenn der Ausgangszustand belegt ist","beforeTaskCode":"t24"}]'::jsonb,
  false, null, false,
  '[{"title":"Leitfaden zur Montage, ift Rosenheim und RAL Gütegemeinschaft Fenster und Haustüren","note":"die drei Anschlussebenen und ihre Ausführung"},{"title":"DIN 4108-7, Luftdichtheit von Gebäuden","note":"Anforderungen an die innere Dichtebene"},{"title":"DIN EN 1627, Einbruchhemmung","note":"die Widerstandsklassen RC1 bis RC6"},{"title":"DIN 18008, Glas im Bauwesen","note":"absturzsichernde Verglasung"},{"title":"Gebäudeenergiegesetz","note":"Anforderungen an den Wärmeschutz der Fenster"}]'::jsonb,
  now()
)
on conflict (key, version) do nothing;

-- Rohinstallation Elektro (06-rohinstallation-elektro.md)
insert into guide_card (
  key, version, phase_key, trade_code, build_types, task_codes, title, whats_happening,
  watch_for, questions_for_contractor, common_problems, photo_prompts,
  expert_recommended, expert_reason, legal_note, sources, published_at
) values (
  'rohinstallation_elektro', 1, 'rohinstallation', 'elektro',
  '{}'::mbl.build_type[], array['t20']::text[],
  'Rohinstallation Elektro',
  'Der Elektriker schlitzt die Wände, setzt die Dosen und zieht die Leitungen bis zum Zählerschrank. Nichts davon funktioniert schon, und nichts davon ist später noch zu sehen.

Das ist der Moment, an dem sich entscheidet, wo in zehn Jahren eine Steckdose sein wird und wo nicht. Nach dem Innenputz ist jede Änderung ein Nachtrag mit Staub.',
  '[{"key":"w1","text":"Geh mit einem Zettel durch jeden Raum und stell dir die Möbel vor, bevor die Dosen gesetzt werden","why":"die übliche Ausstattung ist ein Mindestmaß, kein Vorschlag für dein Leben"},{"key":"w2","text":"Die Leitungen verlaufen in den vorgesehenen Installationszonen","why":"nur dann weißt du später, wo du bohren darfst, ohne eine Leitung zu treffen"},{"key":"w3","text":"Für alles, was du vielleicht später willst, liegt ein Leerrohr: Netzwerk, Photovoltaik, Wallbox, Außensteckdose, Markise","why":"ein Leerrohr kostet jetzt wenige Euro und später eine aufgestemmte Wand"},{"key":"w4","text":"Der Zählerschrank hat freie Plätze","why":"jede Nachrüstung braucht Platz, und ein voller Schrank wird zum zweiten Schrank"},{"key":"w5","text":"Rauchwarnmelder sind eingeplant, in den Räumen, die deine Landesbauordnung verlangt","why":"das ist eine gesetzliche Pflicht und keine Ausstattung"}]'::jsonb,
  '[{"key":"q1","question":"Bekomme ich vor dem Schlitzen einen Plan mit allen Schaltern, Dosen und Auslässen je Raum?","whyItMatters":"auf Papier ist eine Änderung kostenlos, in der Wand nicht"},{"key":"q2","question":"Werden die Installationszonen nach DIN 18015-3 eingehalten?","whyItMatters":"die Antwort entscheidet darüber, ob du später gefahrlos ein Regal aufhängen kannst"},{"key":"q3","question":"Welche Stromkreise sind über einen Fehlerstromschutzschalter abgesichert?","whyItMatters":"für Steckdosenstromkreise in Wohnungen ist das eine Anforderung, keine Zusatzausstattung"},{"key":"q4","question":"Welche Leerrohre sind vorgesehen, und wohin führen sie?","whyItMatters":"ein Leerrohr ohne Zugdraht und ohne bekanntes Ziel ist nur ein Loch"},{"key":"q5","question":"Wann sind die Leitungen fertig und der Innenputz noch nicht begonnen?","whyItMatters":"genau dieses Zeitfenster brauchst du für Fotos und für eine Fachprüfung"}]'::jsonb,
  '[{"key":"c1","problem":"Zu wenige Steckdosen, vor allem in Küche, Arbeitszimmer und neben dem Bett","howToSpot":"beim Durchgehen mit dem Plan und den geplanten Möbeln"},{"key":"c2","problem":"Leitungen verlaufen quer durch die Wandfläche außerhalb der Zonen","howToSpot":"schräge oder diagonale Schlitze in der Wand"},{"key":"c3","problem":"Es fehlen Leerrohre für spätere Technik","howToSpot":"im Plan taucht kein einziges Leerrohr auf"},{"key":"c4","problem":"Dosen sitzen zu tief oder schief in der Wand","howToSpot":"der Dosenrand liegt nicht bündig mit der späteren Putzoberfläche"},{"key":"c5","problem":"Die Netzwerkverkabelung endet an einer Stelle ohne Strom und ohne Platz","howToSpot":"der geplante Verteilerpunkt liegt in einer Abstellkammer ohne Steckdose"}]'::jsonb,
  '[{"key":"p1","what":"Jede Wand vollständig mit allen Schlitzen und Leitungen, Raum für Raum","why":"das ist die einzige Bohrhilfe, die du in den nächsten Jahrzehnten haben wirst","beforeTaskCode":"t24"},{"key":"p2","what":"Jede Wand mit einem Maßstab im Bild, etwa einem Zollstock an der Türzarge","why":"ohne Maßbezug lässt sich aus einem Foto keine Bohrtiefe und keine Höhe ableiten","beforeTaskCode":"t24"},{"key":"p3","what":"Den offenen Zählerschrank mit Beschriftung der Stromkreise","why":"die Beschriftung geht erfahrungsgemäß als Erstes verloren","beforeTaskCode":"t33"}]'::jsonb,
  true, 'Solange die Leitungen offen in der Wand liegen, ist alles prüfbar. Ein Prüftermin deckt Elektro und Sanitär zusammen ab, wenn beide Gewerke fertig sind und noch nichts verputzt ist.', false,
  '[{"title":"DIN 18015-1 bis -3, Elektrische Anlagen in Wohngebäuden","note":"Planung, Mindestausstattung und Installationszonen"},{"title":"DIN VDE 0100, Errichten von Niederspannungsanlagen","note":"Schutzmaßnahmen und Fehlerstromschutz"},{"title":"Landesbauordnung des jeweiligen Bundeslandes","note":"Pflicht zu Rauchwarnmeldern und betroffene Räume"},{"title":"Verband Privater Bauherren, Prüftermine der Baubegleitung","note":"warum die Rohinstallation ein üblicher Kontrolltermin ist"}]'::jsonb,
  now()
)
on conflict (key, version) do nothing;

-- Rohinstallation Sanitär und Heizung (07-rohinstallation-shk.md)
insert into guide_card (
  key, version, phase_key, trade_code, build_types, task_codes, title, whats_happening,
  watch_for, questions_for_contractor, common_problems, photo_prompts,
  expert_recommended, expert_reason, legal_note, sources, published_at
) values (
  'rohinstallation_shk', 1, 'rohinstallation', 'shk',
  '{}'::mbl.build_type[], array['t21', 't22']::text[],
  'Rohinstallation Sanitär und Heizung',
  'Der Installateur verlegt die Leitungen für Trinkwasser, Abwasser und Heizung, stellt die Vorwände für die Bäder und setzt die Anschlusspunkte. Wo heute eine Rohrschelle sitzt, hängt später dein Waschbecken.

Am Ende dieser Phase steht eine Dichtheitsprüfung. Sie ist der einzige Nachweis, dass die Leitungen dicht waren, bevor sie zugeputzt wurden.',
  '[{"key":"w1","text":"Steh vor der fertigen Vorwand und prüfe die Höhen: WC, Waschbecken, Duscharmatur, Handtuchhalter","why":"die Positionen bestimmen zehn Jahre Nutzung und sind jetzt noch mit einem Bleistiftstrich zu ändern"},{"key":"w2","text":"Die Abwasserrohre sind mit Schellen befestigt, die eine Gummieinlage haben","why":"starr befestigte Rohre übertragen jedes Geräusch in die Nachbarräume"},{"key":"w3","text":"Die Leitungen sind gedämmt, auch die kalten","why":"warme Leitungen verlieren sonst Wärme, kalte schwitzen und durchfeuchten den Aufbau"},{"key":"w4","text":"Der Heizkreisverteiler sitzt an einer Stelle, die dauerhaft zugänglich bleibt","why":"er muss gewartet und eingestellt werden, nicht einmal, sondern immer wieder"},{"key":"w5","text":"Es gibt ein unterschriebenes Protokoll der Dichtheitsprüfung","why":"ohne Protokoll gibt es später nur zwei Meinungen und keinen Nachweis"}]'::jsonb,
  '[{"key":"q1","question":"Bekomme ich den Verlegeplan der Fußbodenheizung mit den Heizkreisen?","whyItMatters":"du brauchst ihn, bevor jemand in den Estrich bohrt, und für den hydraulischen Abgleich"},{"key":"q2","question":"Wie und wann wird die Dichtheitsprüfung durchgeführt, und bekomme ich das Protokoll?","whyItMatters":"die Prüfung gehört zur Leistung, das Protokoll gehört dir"},{"key":"q3","question":"Auf welcher Heizlastberechnung beruht die Auslegung der Wärmepumpe?","whyItMatters":"eine Anlage, die nach Faustformel ausgelegt wurde, läuft entweder zu kurz oder dauernd"},{"key":"q4","question":"Wird der hydraulische Abgleich durchgeführt und dokumentiert?","whyItMatters":"ohne ihn arbeiten Wärmepumpe und Fußbodenheizung dauerhaft ineffizient"},{"key":"q5","question":"Welche Anforderungen an den Schallschutz sind vereinbart, und wie werden sie an den Abwasserleitungen umgesetzt?","whyItMatters":"das Mindestmaß der Norm ist in einem Einfamilienhaus oft nicht das, was man hören möchte"}]'::jsonb,
  '[{"key":"c1","problem":"Die Dichtheitsprüfung wird gemacht, aber nicht protokolliert","howToSpot":"es gibt kein unterschriebenes Blatt mit Datum, Druck und Prüfdauer"},{"key":"c2","problem":"Abwasserrohre sind schallhart befestigt oder liegen direkt an einer Wand zum Schlafzimmer","howToSpot":"Metallschelle ohne Gummieinlage, Rohr berührt das Mauerwerk"},{"key":"c3","problem":"Leitungen sind ungedämmt oder nur teilweise gedämmt","howToSpot":"blanke Rohre in Durchbrüchen und hinter Vorwänden"},{"key":"c4","problem":"Die Vorwandhöhen passen nicht zur späteren Fliesenaufteilung","howToSpot":"der Fliesenspiegel endet mitten in einer Armatur"},{"key":"c5","problem":"Der Heizkreisverteiler wird später zugebaut","howToSpot":"er sitzt hinter einer Stelle, an der ein Schrank oder eine Vorwand geplant ist"}]'::jsonb,
  '[{"key":"p1","what":"Jede Wand und jeden Boden mit den verlegten Leitungen, Raum für Raum","why":"unter dem Estrich liegen Rohre, die niemand mehr sieht und jeder trifft","beforeTaskCode":"t26"},{"key":"p2","what":"Die Fußbodenheizung im verlegten Zustand, vor dem Estrich, mit Maßbezug zu den Raumkanten","why":"eine Bohrung in ein Heizrohr ist ein Wasserschaden im ganzen Geschoss","beforeTaskCode":"t26"},{"key":"p3","what":"Die Vorwände mit allen Anschlusspunkten, bevor sie geschlossen werden","why":"Position und Höhe der Anschlüsse sind später nur noch aufzustemmen","beforeTaskCode":"t24"}]'::jsonb,
  true, 'Wasserführende Leitungen verschwinden hinter Putz und Estrich. Ein Prüftermin deckt Elektro und Sanitär zusammen ab, solange beides offen liegt.', false,
  '[{"title":"DIN 1988 und DIN EN 806, Trinkwasserinstallationen","note":"Planung, Ausführung und Prüfung"},{"title":"DIN 1986-100, Entwässerungsanlagen für Gebäude und Grundstücke","note":"Abwasserleitungen, Gefälle und Belüftung"},{"title":"DIN EN 12831, Heizlastberechnung","note":"Grundlage für die Auslegung der Wärmeerzeugung"},{"title":"DIN 4109, Schallschutz im Hochbau","note":"Anforderungen an Geräusche aus haustechnischen Anlagen"},{"title":"Merkblatt Dichtheitsprüfung, ZVSHK","note":"Verfahren und Inhalt des Prüfprotokolls"},{"title":"Gebäudeenergiegesetz","note":"Dämmung von Leitungen und hydraulischer Abgleich"}]'::jsonb,
  now()
)
on conflict (key, version) do nothing;

-- Blower-Door-Vorabtest (08-blower-door.md)
insert into guide_card (
  key, version, phase_key, trade_code, build_types, task_codes, title, whats_happening,
  watch_for, questions_for_contractor, common_problems, photo_prompts,
  expert_recommended, expert_reason, legal_note, sources, published_at
) values (
  'blower_door', 1, 'rohinstallation', 'pruefer',
  '{}'::mbl.build_type[], array['t23']::text[],
  'Blower-Door-Vorabtest',
  'Ein Prüfer baut ein Gebläse in die Haustür ein und erzeugt im Haus Unterdruck und Überdruck. Aus der Luftmenge, die dabei nachströmt, ergibt sich, wie dicht die Gebäudehülle ist. Der Messwert heißt n50 und beschreibt, wie oft die Raumluft in einer Stunde rechnerisch ausgetauscht würde.

Der Vorabtest hat aber einen zweiten, wichtigeren Zweck: Bei Unterdruck lassen sich undichte Stellen aufspüren und beheben, solange sie noch erreichbar sind.',
  '[{"key":"w1","text":"Der Test findet statt, wenn die luftdichte Ebene fertig, aber noch zugänglich ist","why":"danach ist jede gefundene Leckage nur noch mit Abriss zu erreichen"},{"key":"w2","text":"Du weißt, was in deinem Haus die luftdichte Ebene überhaupt ist","why":"im Massivbau ist es meistens der Innenputz, im ausgebauten Dach die Dampfbremse, und beide müssen fertig sein"},{"key":"w3","text":"Der Prüfer sucht Leckagen und übergibt nicht nur eine Zahl","why":"der Messwert allein sagt dir nicht, wo nachgearbeitet werden muss"},{"key":"w4","text":"Du gehst beim Unterdruck selbst durchs Haus und hältst die Hand an Fensteranschlüsse, Steckdosen und Dachanschlüsse","why":"starken Zug spürt man ohne jedes Gerät"},{"key":"w5","text":"Es gibt ein Messprotokoll mit Datum, Messwerten und Randbedingungen","why":"der Nachweis wird beim Förderantrag und bei der Abnahme verlangt"}]'::jsonb,
  '[{"key":"q1","question":"Was genau ist beim Vorabtest schon fertig, und welche Ebene wird gemessen?","whyItMatters":"ein Test vor dem Innenputz misst in einem Massivhaus nicht die spätere luftdichte Ebene"},{"key":"q2","question":"Wird beim Vorabtest eine Leckageortung durchgeführt, und bin ich dabei?","whyItMatters":"mitgehen ist der Unterschied zwischen einer Zahl und einer Mängelliste"},{"key":"q3","question":"Welcher Grenzwert gilt für dieses Haus, und woraus ergibt er sich?","whyItMatters":"mit Lüftungsanlage gilt ein strengerer Wert als ohne"},{"key":"q4","question":"Wer beseitigt gefundene Undichtigkeiten, und wann wird nachgemessen?","whyItMatters":"ein Vorabtest ohne Nacharbeit ist nur eine Information"},{"key":"q5","question":"Wann findet der abschließende Test statt, und bekomme ich das Protokoll?","whyItMatters":"die Bestätigung gehört zu den Unterlagen, die du bei der Abnahme brauchst"}]'::jsonb,
  '[{"key":"c1","problem":"Der Test kommt zu spät","howToSpot":"Trockenbau und Verkleidungen sind schon geschlossen, die Anschlüsse nicht mehr erreichbar"},{"key":"c2","problem":"Es wird nur gemessen, nicht gesucht","howToSpot":"das Ergebnis ist eine Zahl auf einem Blatt, ohne eine Liste von Fundstellen"},{"key":"c3","problem":"Das Haus ist für die Messung nicht vorbereitet","howToSpot":"Lüftungsöffnungen und Abflüsse sind nicht verschlossen, Fenster stehen offen, der Wert wird unbrauchbar"},{"key":"c4","problem":"Die klassischen Fundstellen bleiben unbearbeitet","howToSpot":"Fensteranschlüsse, Rollladenkästen, Durchführungen von Leitungen und der Anschluss der Dampfbremse an den Giebel"},{"key":"c5","problem":"Der Grenzwert wird knapp gehalten und nach dem Ausbau nicht mehr geprüft","howToSpot":"es gibt nur ein Protokoll, und das trägt das Datum des Vorabtests"}]'::jsonb,
  '[{"key":"p1","what":"Jede beim Unterdruck gefundene undichte Stelle, mit Ortsangabe","why":"nur so ist später nachvollziehbar, was nachgearbeitet wurde","beforeTaskCode":"t24"},{"key":"p2","what":"Den Anschluss der Dampfbremse im Dachgeschoss ringsum, vor der Beplankung","why":"das ist die Stelle, an der die meisten Leckagen sitzen","beforeTaskCode":"t25"}]'::jsonb,
  true, 'Der Vorabtest ist selbst die Fachprüfung. Sein Wert hängt vollständig davon ab, dass er zum richtigen Zeitpunkt stattfindet und dass Leckagen gesucht und nicht nur gezählt werden.', false,
  '[{"title":"DIN EN ISO 9972, Bestimmung der Luftdurchlässigkeit von Gebäuden","note":"das Messverfahren und die Randbedingungen"},{"title":"DIN 4108-7, Luftdichtheit von Gebäuden","note":"Planung und Ausführung der luftdichten Ebene"},{"title":"Gebäudeenergiegesetz, Anforderungen an die Dichtheit","note":"die zulässigen Luftwechselraten mit und ohne Lüftungsanlage"},{"title":"Fachverband Luftdichtheit im Bauwesen, FLiB","note":"empfohlener Zeitpunkt und Ablauf eines Vorabtests"}]'::jsonb,
  now()
)
on conflict (key, version) do nothing;

-- Innenputz (09-innenputz.md)
insert into guide_card (
  key, version, phase_key, trade_code, build_types, task_codes, title, whats_happening,
  watch_for, questions_for_contractor, common_problems, photo_prompts,
  expert_recommended, expert_reason, legal_note, sources, published_at
) values (
  'innenputz', 1, 'ausbau', 'putzer',
  '{}'::mbl.build_type[], array['t24']::text[],
  'Innenputz',
  'Die Wände bekommen ihren Putz. Was danach aussieht wie eine Wand, ist im Massivbau zugleich die luftdichte Ebene des Hauses: Der Putz schließt die Fugen im Mauerwerk, durch die sonst Luft wandert.

Deshalb muss er an Stellen weitergeführt werden, an denen ihn niemand je sieht: hinter Vorwandinstallationen, bis hinauf zur Rohdecke, um jede Durchdringung herum.',
  '[{"key":"w1","text":"Hinter Vorwänden und abgehängten Bereichen wird durchgeputzt","why":"eine ungeputzte Fläche hinter einer Verkleidung ist ein Loch in der luftdichten Ebene"},{"key":"w2","text":"Der Putz läuft bis zur Rohdecke und endet nicht an der späteren Deckenkante","why":"der Streifen dazwischen ist im Blower-Door-Test messbar"},{"key":"w3","text":"An Übergängen zwischen zwei Baustoffen liegt ein Gewebe im Putz","why":"unterschiedliche Materialien arbeiten unterschiedlich, und genau dort reißt der Putz"},{"key":"w4","text":"Es wird gelüftet, aber nicht mit Heizgeräten trockengeblasen","why":"zu schnelles Trocknen erzeugt Risse und eine mürbe Oberfläche"},{"key":"w5","text":"Die Ecken sind winkelig und die Flächen eben, geprüft mit einem langen Richtscheit","why":"was hier schief ist, siehst du später an jedem Möbelstück, das an der Wand steht"}]'::jsonb,
  '[{"key":"q1","question":"Wird hinter allen Vorwänden und bis zur Rohdecke durchgeputzt?","whyItMatters":"das ist die häufigste Ursache für ein schlechtes Ergebnis beim Blower-Door-Test"},{"key":"q2","question":"Welche Oberflächenqualität ist geschuldet, und steht sie im Vertrag?","whyItMatters":"für Spachtel- und Trockenbauflächen sind die Stufen Q1 bis Q4 üblich, und der Unterschied ist erheblich"},{"key":"q3","question":"Wie viel Feuchtigkeit bringt der Putz ins Haus, und wie wird sie herausgelüftet?","whyItMatters":"Baufeuchte, die im Haus bleibt, wird zum Schimmelproblem"},{"key":"q4","question":"Welche Toleranzen gelten für Ebenheit und Winkligkeit?","whyItMatters":"dann gibt es später eine Zahl statt einer Einschätzung"},{"key":"q5","question":"Wann ist der Putz so trocken, dass der Estrich eingebracht werden kann?","whyItMatters":"die Reihenfolge und die Wartezeit bestimmen den weiteren Ablauf"}]'::jsonb,
  '[{"key":"c1","problem":"Hinter der Vorwand im Bad ist nicht geputzt","howToSpot":"vor dem Schließen der Vorwand hineinsehen, danach nicht mehr"},{"key":"c2","problem":"Der Putz endet an der abgehängten Decke","howToSpot":"oberhalb der späteren Deckenkante ist blankes Mauerwerk zu sehen"},{"key":"c3","problem":"Risse an Materialübergängen","howToSpot":"feine Linien genau dort, wo Beton auf Mauerwerk trifft, oft erst nach dem Trocknen"},{"key":"c4","problem":"Zu schnell getrocknet","howToSpot":"netzartige Haarrisse in der Fläche, Putz staubt beim Darüberstreichen"},{"key":"c5","problem":"Die Baufeuchte bleibt im Haus","howToSpot":"beschlagene Fenster, muffiger Geruch, feuchte Ecken"}]'::jsonb,
  '[{"key":"p1","what":"Die Flächen hinter jeder Vorwand, bevor sie geschlossen wird","why":"danach lässt sich nicht mehr belegen, ob dort geputzt wurde","beforeTaskCode":"t25"},{"key":"p2","what":"Den Anschluss des Putzes an die Rohdecke in jedem Raum mit abgehängter Decke","why":"dieser Streifen entscheidet über die Luftdichtheit und ist danach verdeckt","beforeTaskCode":"t25"}]'::jsonb,
  false, null, false,
  '[{"title":"DIN 18550 und DIN EN 13914-2, Planung und Ausführung von Innenputz","note":"Putzsysteme, Putzgrund und Ausführung"},{"title":"DIN 4108-7, Luftdichtheit von Gebäuden","note":"warum der Innenputz die luftdichte Ebene ist"},{"title":"DIN 18202, Toleranzen im Hochbau","note":"zulässige Abweichungen bei Ebenheit und Winkligkeit"},{"title":"Merkblatt zu Oberflächenqualitäten, Bundesverband Ausbau und Fassade","note":"was hinter den Stufen Q1 bis Q4 steht"}]'::jsonb,
  now()
)
on conflict (key, version) do nothing;

-- Estrich und Belegreife (10-estrich.md)
insert into guide_card (
  key, version, phase_key, trade_code, build_types, task_codes, title, whats_happening,
  watch_for, questions_for_contractor, common_problems, photo_prompts,
  expert_recommended, expert_reason, legal_note, sources, published_at
) values (
  'estrich', 1, 'ausbau', 'estrich',
  '{}'::mbl.build_type[], array['t26', 't27']::text[],
  'Estrich und Belegreife',
  'Auf die Rohdecke kommen Dämmung, Folie und darauf der Estrich: die Schicht, die den fertigen Fußboden trägt. Er wird an keiner Stelle mit den Wänden verbunden, sondern schwimmt auf der Dämmung, damit kein Schall in die Wände läuft.

Danach kommt die längste Wartezeit des ganzen Baus. Der Estrich muss trocknen, bis er belegreif ist, und das dauert Wochen. Diese Zeit lässt sich nicht verkürzen, nur durch Messen ehrlich bestimmen.',
  '[{"key":"w1","text":"Die Aufbauhöhe steht fest, bevor der Estrich kommt","why":"sie ergibt sich aus deinem Bodenbelag, und ein zu hoher Estrich lässt die Türen nicht mehr aufgehen"},{"key":"w2","text":"Der Randdämmstreifen läuft ringsum an jeder Wand und an jeder Säule hoch","why":"eine einzige Stelle, an der Estrich die Wand berührt, überträgt Trittschall ins ganze Haus"},{"key":"w3","text":"Der Randdämmstreifen wird erst nach den Bodenbelagsarbeiten abgeschnitten","why":"zu früh abgeschnitten, füllt sich die Fuge mit Fliesenkleber, und die Schallbrücke ist wieder da"},{"key":"w4","text":"Die Bewegungsfugen liegen dort, wo sie im Fugenplan stehen","why":"sie müssen später im Bodenbelag übernommen werden, sonst reißt der Belag"},{"key":"w5","text":"Vor dem Belegen wird die Restfeuchte gemessen und protokolliert","why":"der Kalender sagt nichts über die Feuchte, die Messung schon"}]'::jsonb,
  '[{"key":"q1","question":"Welche Aufbauhöhe ist eingeplant, und für welchen Bodenbelag?","whyItMatters":"Fliese, Parkett und Vinyl brauchen unterschiedlich viel Platz, und die Entscheidung muss vor dem Estrich fallen"},{"key":"q2","question":"Welche Estrichart wird eingebaut?","whyItMatters":"Zementestrich und Calciumsulfatestrich trocknen unterschiedlich lange und haben verschiedene Grenzwerte"},{"key":"q3","question":"Wird ein Funktionsheizen der Fußbodenheizung durchgeführt und protokolliert?","whyItMatters":"es gehört zur Leistung und ist die Voraussetzung dafür, dass der Belag verlegt werden darf"},{"key":"q4","question":"Wer misst die Belegreife, mit welchem Verfahren, und bekomme ich das Protokoll?","whyItMatters":"die CM-Messung ist das übliche Verfahren, und das Protokoll ist dein Nachweis"},{"key":"q5","question":"Bekomme ich den Fugenplan?","whyItMatters":"die Fliesen- und Bodenleger brauchen ihn, und du brauchst ihn, bevor jemand bohrt"}]'::jsonb,
  '[{"key":"c1","problem":"Der Bodenbelag steht bei der Ausführung noch nicht fest","howToSpot":"die Aufbauhöhe wird geschätzt, und die Türblätter passen später nicht"},{"key":"c2","problem":"Zu früh belegt","howToSpot":"der Belag wölbt sich Wochen später, oder es riecht muffig"},{"key":"c3","problem":"Der Randdämmstreifen fehlt an einer Stelle oder wurde zu früh abgeschnitten","howToSpot":"an der Fuge zwischen Estrich und Wand, bevor der Belag kommt"},{"key":"c4","problem":"Der Estrich ist über den Heizrohren zu dünn","howToSpot":"Risse, die genau dem Verlauf der Heizschleifen folgen"},{"key":"c5","problem":"Es wird ohne Messung belegt","howToSpot":"es gibt kein Protokoll mit Datum, Messwert und Messstelle"}]'::jsonb,
  '[{"key":"p1","what":"Die verlegte Fußbodenheizung mit Maßbezug zu den Raumkanten, bevor der Estrich kommt","why":"eine Bohrung in ein Heizrohr ist ein Wasserschaden, den niemand kommen sieht","beforeTaskCode":"t26"},{"key":"p2","what":"Den Randdämmstreifen ringsum in jedem Raum","why":"nach dem Bodenbelag ist nicht mehr nachweisbar, ob er durchgehend war","beforeTaskCode":"t31"},{"key":"p3","what":"Die Lage aller Bewegungsfugen","why":"sie müssen im Belag übernommen werden, und der Fugenplan geht gern verloren","beforeTaskCode":"t28"}]'::jsonb,
  false, null, false,
  '[{"title":"DIN 18560, Estriche im Bauwesen","note":"Aufbau, Dicken und Ausführung schwimmender Estriche"},{"title":"DIN EN 1264-4, Fußbodenheizung, Installation","note":"Funktionsheizen vor dem Belegen"},{"title":"Hinweise des Bundesverbands Estrich und Belag zur Belegreife","note":"CM-Messung und die üblichen Grenzwerte je Estrichart"},{"title":"Merkblatt zur Schnittstellenkoordination, ZDB","note":"wer was wann übergibt zwischen Estrich, Heizung und Belag"}]'::jsonb,
  now()
)
on conflict (key, version) do nothing;

-- Fliesenarbeiten (11-fliesen.md)
insert into guide_card (
  key, version, phase_key, trade_code, build_types, task_codes, title, whats_happening,
  watch_for, questions_for_contractor, common_problems, photo_prompts,
  expert_recommended, expert_reason, legal_note, sources, published_at
) values (
  'fliesen', 1, 'endausbau', 'fliesen',
  '{}'::mbl.build_type[], array['t28']::text[],
  'Fliesenarbeiten',
  'Bäder, Küche und häufig der Hauswirtschaftsraum werden gefliest. Vorher kommt in den Bereichen, die nass werden, eine Abdichtung direkt unter die Fliesen: eine dünne, meist blaue oder graue Schicht, die man nach dem Fliesen nie wieder sieht.

Fliesen sind nicht wasserdicht, und Fugen erst recht nicht. Dicht ist immer die Schicht darunter.',
  '[{"key":"w1","text":"In der Dusche und ringsum um die Wanne ist eine Abdichtung aufgebracht, bevor gefliest wird","why":"ohne sie läuft Wasser durch die Fugen in den Aufbau, und das merkt man erst nach Jahren"},{"key":"w2","text":"Die Abdichtung ist an Rohrdurchführungen und in den Ecken mit Manschetten und Dichtbändern verstärkt","why":"die Ecken und die Durchführungen sind die einzigen Stellen, an denen sie tatsächlich versagt"},{"key":"w3","text":"Die bodengleiche Dusche hat Gefälle zum Ablauf, gleichmäßig aus allen Richtungen","why":"eine Pfütze in der Dusche verschwindet nicht von selbst und lässt sich nicht nachbessern"},{"key":"w4","text":"Die Bewegungsfugen des Estrichs sind in den Fliesen übernommen","why":"wird darübergefliest, reißt der Belag genau dort"},{"key":"w5","text":"Beim Abklopfen mit dem Knöchel klingt keine Fliese hohl","why":"Hohlstellen brechen unter Belastung, und die Fliese ist dann nicht die einzige Baustelle"},{"key":"w6","text":"Randfugen und Innenecken sind elastisch ausgeführt, nicht starr verfugt","why":"dort bewegen sich zwei Bauteile gegeneinander"}]'::jsonb,
  '[{"key":"q1","question":"Welche Wassereinwirkungsklasse nach DIN 18534 wird in Dusche, Bad und Hauswirtschaftsraum angesetzt?","whyItMatters":"davon hängt ab, ob und wie abgedichtet wird"},{"key":"q2","question":"Bekomme ich Fotos der fertigen Abdichtung, bevor gefliest wird?","whyItMatters":"nach dem Fliesen ist sie für immer verdeckt"},{"key":"q3","question":"Wie ist das Verlegemuster geplant, und wo liegen die Schnitte?","whyItMatters":"an Türen, Ecken und über der Wanne entscheidet das über das Ergebnis"},{"key":"q4","question":"Wann muss die Fliesenauswahl spätestens stehen?","whyItMatters":"Lieferzeiten bei Fliesen sind der häufigste Grund für Verzug im Innenausbau"},{"key":"q5","question":"Sind die Silikonfugen Wartungsfugen?","whyItMatters":"sie altern und werden erneuert, das ist normal und kein Mangel"}]'::jsonb,
  '[{"key":"c1","problem":"In der Dusche fehlt die Abdichtung","howToSpot":"nur vor dem Fliesen zu sehen, danach nur noch am Feuchteschaden im Nachbarraum"},{"key":"c2","problem":"Die Abdichtung ist an den Ecken nur gestrichen und nicht mit Band verstärkt","howToSpot":"in der Innenecke ist kein eingelegtes Band zu erkennen"},{"key":"c3","problem":"Kein oder ungleichmäßiges Gefälle in der bodengleichen Dusche","howToSpot":"eine Wasserprobe steht nach dem Duschen an derselben Stelle"},{"key":"c4","problem":"Bewegungsfugen sind überfliest","howToSpot":"an der Stelle, an der im Estrich eine Fuge lag, verläuft die Fliese durch"},{"key":"c5","problem":"Hohllagen unter den Fliesen","howToSpot":"dumpfer, hohler Klang beim Abklopfen, meist an den Rändern"},{"key":"c6","problem":"Die Fliesenauswahl fällt zu spät","howToSpot":"der Liefertermin liegt hinter dem geplanten Beginn des Fliesenlegers"}]'::jsonb,
  '[{"key":"p1","what":"Die fertige Abdichtung in jedem Nassbereich, vollflächig und in den Ecken aus der Nähe","why":"nach dem Fliesen gibt es keinen Nachweis mehr, dass sie überhaupt da war","beforeTaskCode":"t28"},{"key":"p2","what":"Alle Rohrdurchführungen mit ihren Dichtmanschetten","why":"das sind die Stellen, an denen später gesucht wird","beforeTaskCode":"t28"},{"key":"p3","what":"Die gefliesten Wände vor dem Einbau der Sanitärobjekte, mit Maßbezug","why":"dahinter liegen Leitungen, und irgendwann bohrt jemand","beforeTaskCode":"t34"}]'::jsonb,
  false, null, false,
  '[{"title":"DIN 18534, Abdichtung von Innenräumen","note":"Wassereinwirkungsklassen und zulässige Abdichtungen im Verbund"},{"title":"Merkblätter des Zentralverbands des Deutschen Baugewerbes zu Verbundabdichtungen","note":"Ausführung an Ecken und Durchdringungen"},{"title":"Merkblatt zu Wartungsfugen, Industrieverband Dichtstoffe","note":"warum Silikonfugen erneuert werden und kein Mangel sind"},{"title":"DIN 18202, Toleranzen im Hochbau","note":"Ebenheit der gefliesten Flächen"}]'::jsonb,
  now()
)
on conflict (key, version) do nothing;

-- Abnahme und Übergabe (12-abnahme.md)
insert into guide_card (
  key, version, phase_key, trade_code, build_types, task_codes, title, whats_happening,
  watch_for, questions_for_contractor, common_problems, photo_prompts,
  expert_recommended, expert_reason, legal_note, sources, published_at
) values (
  'abnahme', 1, 'abnahme', null,
  '{}'::mbl.build_type[], array['t37', 't38']::text[],
  'Abnahme und Übergabe',
  'Bei der Abnahme erklärst du, dass du das Bauwerk als im Wesentlichen vertragsgemäß annimmst. Das ist kein Termin zum Schlüsselholen, sondern der Zeitpunkt, an dem sich die Rechtslage dreht.

Ab der Abnahme beginnt die Verjährungsfrist für Mängelansprüche, die Schlussrechnung wird fällig, und die Beweislast wechselt: Bis dahin muss der Unternehmer zeigen, dass seine Leistung mangelfrei ist. Danach musst du zeigen, dass sie es nicht ist.',
  '[{"key":"w1","text":"Nimm dir Zeit und lass dich nicht drängen","why":"die Abnahme ist der einzige Termin des ganzen Baus, den man nicht nachholen kann"},{"key":"w2","text":"Geh mit einer vorbereiteten Liste durch das Haus, Raum für Raum","why":"unter Zeitdruck fällt niemandem etwas ein, hinterher jedem"},{"key":"w3","text":"Jeder bekannte Mangel steht im Protokoll, auch der kleine","why":"was nicht im Protokoll steht, gilt als abgenommen"},{"key":"w4","text":"Zu jedem Mangel steht eine Frist im Protokoll","why":"ohne Frist gibt es keinen Zeitpunkt, ab dem etwas passiert"},{"key":"w5","text":"Du nimmst ein unterschriebenes Exemplar des Protokolls mit","why":"ein Protokoll, das nur der andere hat, ist kein Protokoll"},{"key":"w6","text":"Die Unterlagen sind vollständig übergeben","why":"Nachweise nachträglich einzusammeln ist mühsam, solange sie noch jemanden interessieren"}]'::jsonb,
  '[{"key":"q1","question":"Welche Unterlagen bekomme ich bei der Übergabe?","whyItMatters":"Messprotokolle, Bestandspläne, Bedienungsanleitungen und der Energieausweis gehören dazu"},{"key":"q2","question":"Liegen die Nachweise zu Luftdichtheit, Dichtheitsprüfung und hydraulischem Abgleich vor?","whyItMatters":"das sind genau die Nachweise, die später beim Verkauf oder bei einem Schaden verlangt werden"},{"key":"q3","question":"Welche Restleistungen stehen noch aus, und bis wann sind sie erledigt?","whyItMatters":"Restleistungen und Mängel sind zwei verschiedene Dinge und gehören getrennt ins Protokoll"},{"key":"q4","question":"Wie ist der Zahlungsplan mit der Abnahme verknüpft?","whyItMatters":"die letzte Rate ist dein einziges verbliebenes Druckmittel"},{"key":"q5","question":"Wer ist bei der Abnahme dabei, und darf ich einen Sachverständigen mitbringen?","whyItMatters":"das ist üblich und muss vorher niemand genehmigen"}]'::jsonb,
  '[{"key":"c1","problem":"Die Abnahme wird nebenbei erledigt","howToSpot":"der Termin ist auf eine Stunde angesetzt, das Protokoll ist schon vorausgefüllt"},{"key":"c2","problem":"Bekannte Mängel werden mündlich zugesagt und nicht protokolliert","howToSpot":"im Protokoll steht nichts, im Gedächtnis aller Beteiligten etwas anderes"},{"key":"c3","problem":"Es fehlt ein Vorbehalt","howToSpot":"das Protokoll enthält keine Erklärung zu bekannten Mängeln oder zu einer vereinbarten Vertragsstrafe"},{"key":"c4","problem":"Die Schlussrate wird vor Beseitigung der Mängel gezahlt","howToSpot":"der Zahlungsbeleg trägt ein Datum vor der Nachbesserung"},{"key":"c5","problem":"Unterlagen fehlen","howToSpot":"es gibt keinen Ordner, sondern das Versprechen, ihn nachzureichen"}]'::jsonb,
  '[{"key":"p1","what":"Jeden im Protokoll aufgeführten Mangel einzeln, mit Raumangabe","why":"eine Beschreibung im Protokoll ist selten so eindeutig wie ein Bild","beforeTaskCode":"t38"},{"key":"p2","what":"Das unterschriebene Abnahmeprotokoll selbst, alle Seiten","why":"es ist das wichtigste Dokument deines Bauvorhabens","beforeTaskCode":"t38"},{"key":"p3","what":"Alle Zählerstände am Übergabetag","why":"sie sind die Trennlinie zwischen Baustrom und deinem Verbrauch","beforeTaskCode":"t38"}]'::jsonb,
  true, 'Die Abnahme verschiebt die Beweislast auf dich. Was an diesem Tag nicht im Protokoll steht, musst du danach selbst nachweisen.', true,
  '[{"title":"§ 640 BGB, Abnahme","note":"Wirkung der Abnahme und die Folgen einer Fristsetzung"},{"title":"§ 650g BGB, Zustandsfeststellung","note":"was gilt, wenn die Abnahme verweigert wird"},{"title":"§ 634a BGB, Verjährung der Mängelansprüche","note":"die Frist bei Bauwerken beträgt fünf Jahre"},{"title":"§ 650m BGB, Abschlagszahlungen und Sicherheit beim Verbraucherbauvertrag","note":"Begrenzung der Abschläge und Sicherheitsleistung"},{"title":"§ 80 Gebäudeenergiegesetz, Energieausweis","note":"welcher Nachweis bei Fertigstellung auszustellen ist"},{"title":"Verband Privater Bauherren und Bauherren-Schutzbund, Hinweise zur Abnahme","note":"Ablauf und Vorbereitung des Termins"}]'::jsonb,
  now()
)
on conflict (key, version) do nothing;

-- ---------------------------------------------------------------------------
-- Zuordnung zu bestehenden Bauvorhaben
--
-- Neue Projekte bekommen ihre Karten beim Anlegen (apps/api/src/onboarding.ts).
-- Projekte, die es vor dieser Migration schon gab, hier — sonst stünde die
-- Wissensschicht ausgerechnet den Bauherren nicht zur Verfügung, die schon
-- bauen.
--
-- Die Zuordnung friert die Fassung ein, die der Bauherr tatsächlich zu sehen
-- bekommt. Eine spätere Fassung ändert nichts an einem laufenden Bauvorhaben,
-- solange die Zuordnung nicht ausdrücklich nachgezogen wird.
-- ---------------------------------------------------------------------------

update task t
   set guide_card_id = c.id
  from guide_card c
 where c.published_at is not null
   and c.superseded_by is null
   and t.template_task_code = any (c.task_codes)
   and t.guide_card_id is distinct from c.id;


-- ===========================================================================
--  Abschnitt: 0007_decision.sql
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- MeinBaulotse — Entscheidungsassistent (Arbeitspaket 3)
--
-- Die zweite der drei Ursachen aus Abschnitt 1.2: Der Bauherr entscheidet zu
-- spät. Fliesen werden vier Wochen vor dem Fliesenleger ausgesucht statt acht,
-- und die Lieferzeit kippt den Termin.
--
-- Die Rechnung dahinter ist eine Zeile aus Abschnitt 3.2:
--
--     decision.due_date = werktage_vor(task.current_start, lead_time_days)
--
-- Der eigentliche Gewinn steckt aber nicht in der Zeile, sondern in ihrer
-- Wiederholung: Verschiebt sich der Vorgang, verschiebt sich die Frist mit.
-- Erst das macht eine Terminverschiebung für den Bauherren handlungsrelevant —
-- vorher war sie eine Zahl, jetzt ist sie ein Termin in seinem Kalender.
-- ---------------------------------------------------------------------------

create type mbl.decision_status as enum (
  'offen','in_bemusterung','entschieden','beauftragt','hinfaellig'
);

-- Vorlagen -------------------------------------------------------------------

create table decision_template (
  key              text primary key,
  title            text not null,
  blocks_task_code text not null,
  lead_time_days   int  not null,
  lead_time_unit   mbl.duration_unit not null default 'werktage',
  reason           text,
  description      text not null,
  -- Drei feste Teile statt eines Fließtextes: worum es geht, was die Optionen
  -- unterscheidet, was man später bereut (Abschnitt 3.2). Ein einzelnes
  -- Textfeld verleitet dazu, keine der drei Fragen zu beantworten.
  help             jsonb not null default '{}',
  sort_order       int  not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint decision_template_lead_time_nonneg check (lead_time_days >= 0)
);
comment on table decision_template is
  'Die vierzehn Entscheidungsvorlagen aus Abschnitt 7.3, als Daten statt als '
  'Konstanten im Code. Erstbefüllung: 0008_decision_templates.sql.';
comment on column decision_template.reason is
  'Warum die Vorlaufzeit so lang ist. Ohne den Grund ist eine Frist eine '
  'Behauptung, mit ihm ein Argument.';

-- Entscheidungen eines Bauvorhabens ------------------------------------------

create table decision (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid not null references project (id) on delete cascade,
  template_key         text references decision_template (key) on delete set null,
  title                text not null,
  description          text,
  -- Warum die Vorlaufzeit so lang ist. Wie Beschreibung und Hilfe eine Kopie
  -- aus der Vorlage: Eine spätere Korrektur an der Vorlage schreibt kein
  -- laufendes Bauvorhaben um.
  reason               text,
  help                 jsonb not null default '{}',
  blocks_task_id       uuid references task (id) on delete set null,
  lead_time_days       int  not null,
  lead_time_unit       mbl.duration_unit not null default 'werktage',
  -- Ein Rechenergebnis, kein Eingabefeld. Es entsteht aus dem Beginn des
  -- blockierten Vorgangs und wird bei jeder Neuberechnung nachgezogen.
  due_date             date,
  status               mbl.decision_status not null default 'offen',
  decided_at           timestamptz,
  decided_note         text,
  estimated_cost_cents bigint,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint decision_lead_time_nonneg check (lead_time_days >= 0),
  -- Eine getroffene Entscheidung ohne Datum ist keine Auskunft. Der Trigger
  -- weiter unten setzt es; diese Bedingung ist die zweite Sperre.
  constraint decision_decided_at
    check (status not in ('entschieden','beauftragt') or decided_at is not null)
);
comment on column decision.due_date is
  'Werktage vor dem Beginn des blockierten Vorgangs. Wird gerechnet, nie von '
  'Hand gesetzt.';

create unique index decision_project_template_key on decision (project_id, template_key)
  where template_key is not null;
create index decision_project_idx on decision (project_id, due_date);
create index decision_task_idx on decision (blocks_task_id) where blocks_task_id is not null;

create trigger decision_template_touch_updated_at
  before update on decision_template
  for each row execute function mbl.touch_updated_at();

create trigger decision_touch_updated_at
  before update on decision
  for each row execute function mbl.touch_updated_at();

-- ---------------------------------------------------------------------------
-- „Entschieden" trägt sein Datum selbst
--
-- Der Zeitpunkt ist die halbe Aussage: „entschieden" beantwortet nicht, ob es
-- rechtzeitig war. Deshalb stempelt der Trigger ihn, statt sich darauf zu
-- verlassen, dass die Anwendung daran denkt — und räumt ihn wieder ab, wenn
-- jemand den Zustand zurücknimmt.
-- ---------------------------------------------------------------------------

create or replace function mbl.stamp_decision_decided()
returns trigger
language plpgsql
as $$
begin
  if new.status in ('entschieden','beauftragt') then
    if new.decided_at is null then
      new.decided_at := now();
    end if;
  elsif tg_op = 'UPDATE' and old.status in ('entschieden','beauftragt') then
    -- Zurück auf offen oder in Bemusterung: Dann gab es die Entscheidung
    -- nicht, und ein stehengebliebenes Datum wäre eine falsche Auskunft.
    new.decided_at := null;
  end if;
  return new;
end
$$;

create trigger decision_stamp_decided
  before insert or update on decision
  for each row execute function mbl.stamp_decision_decided();

-- ---------------------------------------------------------------------------
-- Die Frist zieht nach, ohne dass jemand die Entscheidung pflegen dürfte
--
-- Verschiebt der Generalunternehmer einen Vorgang, rechnet die Anwendung die
-- Fristen neu. Er hat aber kein `decision.write` — die Entscheidung gehört dem
-- Bauherrn. Ohne diese Unterscheidung stünde die Anwendung vor der Wahl,
-- entweder die Fristen veralten zu lassen oder dem GU Schreibrechte auf
-- Entscheidungen zu geben. Beides wäre falsch.
--
-- Deshalb zwei Ebenen: Die Policy lässt beide Rollen an die Zeile, der Trigger
-- verengt die eine auf genau ein Feld.
-- ---------------------------------------------------------------------------

create or replace function mbl.guard_decision_fields()
returns trigger
language plpgsql
security definer
set search_path = mbl, public
as $$
begin
  if mbl.has_perm(new.project_id, 'decision.write') then
    return new;
  end if;

  if (to_jsonb(new) - 'due_date' - 'updated_at')
     is distinct from (to_jsonb(old) - 'due_date' - 'updated_at') then
    raise exception
      'Eine Entscheidung pflegt der Bauherr. Geändert werden darf hier nur die errechnete Frist.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;

create trigger decision_guard_fields
  before update on decision
  for each row execute function mbl.guard_decision_fields();

-- ---------------------------------------------------------------------------
-- Rechte
-- ---------------------------------------------------------------------------

grant select on decision_template to authenticated;
grant select, insert, update, delete on decision to authenticated;

alter table decision_template enable row level security;
alter table decision          enable row level security;

create policy decision_template_read on decision_template for select to authenticated
  using (true);

create policy decision_read on decision for select to authenticated
  using (mbl.is_member(project_id));

create policy decision_create on decision for insert to authenticated
  with check (mbl.has_perm(project_id, 'decision.write'));

-- `task.schedule` steht hier, damit die Neuberechnung nach einer Verschiebung
-- durchkommt. Was diese Rolle tatsächlich ändern darf, entscheidet der Trigger
-- `mbl.guard_decision_fields`: nur `due_date`.
create policy decision_update on decision for update to authenticated
  using (
    mbl.has_perm(project_id, 'decision.write')
    or mbl.has_perm(project_id, 'task.schedule')
  )
  with check (
    mbl.has_perm(project_id, 'decision.write')
    or mbl.has_perm(project_id, 'task.schedule')
  );

create policy decision_delete on decision for delete to authenticated
  using (mbl.has_perm(project_id, 'decision.write'));

-- Die Rechtematrix kennt `decision.propose` für die Rolle `expert`
-- (Abschnitt 2.2, Zeile „Entscheidung pflegen"). Einen Vorschlagsweg gibt es
-- in Stufe 1 noch nicht; bis dahin liest der Baubegleiter mit und spricht mit
-- dem Bauherrn. Das Recht steht in `role_permission` und wartet auf seinen
-- Ablauf — es wird hier bewusst nicht stillschweigend zu Schreibrecht.


-- ===========================================================================
--  Abschnitt: 0008_decision_templates.sql
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- MeinBaulotse — Entscheidungsvorlagen (erzeugt, nicht von Hand bearbeiten)
--
-- Erzeugt von packages/db/scripts/generate-decisions.ts aus
-- packages/schedule/src/templates/entscheidungen.ts. Neu erzeugen:
--   pnpm --filter @meinbaulotse/db decisions:generate
--
-- 14 Vorlagen aus Abschnitt 7.3 der Spezifikation.
-- ---------------------------------------------------------------------------

insert into decision_template
  (key, title, blocks_task_code, lead_time_days, lead_time_unit, reason,
   description, help, sort_order)
values
  ('versicherungen', 'Bauherrenhaftpflicht und Bauleistungsversicherung', 't03',
   10, 'werktage', 'Beides muss stehen, bevor die erste Maschine anrückt.',
   'Zwei Versicherungen für die Bauzeit: eine für Schäden, die von deiner Baustelle ausgehen, und eine für Schäden am Bau selbst.',
   '{"whatItIsAbout":"Als Bauherr haftest du für das, was auf deinem Grundstück passiert, auch ohne eigenes Verschulden. Die Bauleistungsversicherung deckt dagegen Schäden am entstehenden Gebäude, etwa durch Sturm, Diebstahl oder Vandalismus.","whatDistinguishes":"Der Umfang und die Ausschlüsse. Prüfe, ob Eigenleistung, Helfer, Erdarbeiten und die Bauzeitverlängerung mitversichert sind. Manche Verträge des Generalunternehmers enthalten die Bauleistungsversicherung bereits.","whatPeopleRegret":"Zu spät abgeschlossen. Ein Sturmschaden am offenen Rohbau kostet fünfstellig, und der Vertrag muss vor dem Ereignis bestanden haben."}'::jsonb, 10),
  ('bauhelfer_bg_bau', 'Bauhelfer bei der BG Bau anmelden', 't03',
   5, 'werktage', 'Gesetzliche Pflicht, sobald jemand unentgeltlich mithilft.',
   'Wer beim Bau mithilft, ist gesetzlich unfallversichert. Die Anmeldung bei der Berufsgenossenschaft ist deine Aufgabe, nicht die der Helfer.',
   '{"whatItIsAbout":"Jede helfende Hand auf deiner Baustelle ist über die BG Bau unfallversichert, auch Freunde und Verwandte. Du musst das Bauvorhaben und die geleisteten Stunden melden.","whatDistinguishes":"Nichts, das ist keine Wahl. Die Frage ist nur, ob du Eigenleistung planst und wie viele Stunden es werden.","whatPeopleRegret":"Gar nicht angemeldet. Passiert etwas, steht ein Bußgeld im Raum, und der Versicherungsschutz für den Verletzten ist die kleinere Sorge."}'::jsonb, 20),
  ('dachziegel', 'Dachziegel: Modell und Farbe', 't17',
   20, 'werktage', 'Lieferzeit; einzelne Modelle und Farben sind saisonal knapp.',
   'Material, Form und Farbe der Dacheindeckung. Die Wahl bindet sich an die Dachneigung und häufig an Vorgaben aus dem Bebauungsplan.',
   '{"whatItIsAbout":"Die Eindeckung ist die sichtbarste Fläche deines Hauses und die, an die vierzig Jahre lang niemand mehr herankommt.","whatDistinguishes":"Material und Oberfläche. Tonziegel, Betonstein und Schiefer unterscheiden sich in Gewicht, Preis und Mindestneigung. Engobierte und glasierte Oberflächen bleiben länger sauber als unbehandelte.","whatPeopleRegret":"Die Farbe nach einem Musterstück in der Hand ausgesucht statt an einer bezogenen Fläche im Freien. Auf dem Dach wirkt sie anders."}'::jsonb, 30),
  ('fassade', 'Fassade: Putz oder Klinker, Farbton', 't17',
   25, 'werktage', 'Bestimmt die Gerüststandzeit und damit den Ablauf am Bau.',
   'Wie die Außenwand aussieht und aus was sie besteht. Die Entscheidung wirkt auf Kosten, Pflegeaufwand und den Bauablauf.',
   '{"whatItIsAbout":"Die äußere Schicht der Außenwand. Sie schützt die Dämmung und bestimmt, wie oft du in zwanzig Jahren ein Gerüst brauchst.","whatDistinguishes":"Putz ist günstiger und in jedem Farbton möglich, muss aber irgendwann gestrichen werden. Klinker kostet deutlich mehr, hält dafür ohne Anstrich und braucht mehr Wandstärke.","whatPeopleRegret":"Einen sehr hellen oder sehr dunklen Farbton gewählt. Hell zeigt jeden Ablauf unter der Fensterbank, dunkel heizt sich auf und bleicht aus."}'::jsonb, 40),
  ('fenster', 'Fenster: Farbe, Verglasung, Rollladen, Griffe', 't18',
   60, 'werktage', 'Fenster werden auf Maß gefertigt; die Lieferzeit ist die längste im Bau.',
   'Rahmenmaterial, Farbe innen und außen, Glasaufbau, Beschläge, Rollläden und Einbruchhemmung. Die längste Vorlaufzeit im ganzen Ablauf.',
   '{"whatItIsAbout":"Fenster sind Maßanfertigungen. Ab der Bestellung vergehen Wochen bis Monate, und in dieser Zeit ändert sich nichts mehr daran.","whatDistinguishes":"Rahmenmaterial und Glasaufbau. Kunststoff, Holz und Aluminium unterscheiden sich in Pflege, Preis und Lebensdauer. Beim Glas entscheidet der Aufbau über Wärmeschutz, Schallschutz und Sonnenschutz. Bei der Einbruchhemmung ist RC2 der übliche Standard für Wohnhäuser.","whatPeopleRegret":"Am Sonnenschutz gespart und an der Einbruchhemmung. Beides lässt sich nachrüsten, kostet dann aber ein Vielfaches der Mehrkosten beim Einbau."}'::jsonb, 50),
  ('elektroplanung', 'Elektroplanung: Steckdosen, Schalter, Netzwerk', 't20',
   15, 'werktage', 'Nach dem Schlitzen ist jede Änderung ein Nachtrag.',
   'Wo Steckdosen, Schalter, Leuchtenauslässe und Netzwerkdosen sitzen, und welche Leerrohre für später eingezogen werden.',
   '{"whatItIsAbout":"Der Plan, nach dem der Elektriker die Wände schlitzt. Was darin nicht steht, sitzt später nicht in der Wand.","whatDistinguishes":"Vor allem die Anzahl. Die übliche Ausstattung ist ein Mindestmaß, kein Vorschlag für dein Leben. Geh mit den geplanten Möbeln durch jeden Raum.","whatPeopleRegret":"Zu wenige Steckdosen neben dem Bett, in der Küche und am Arbeitsplatz. Und fehlende Leerrohre für Photovoltaik, Wallbox und Außensteckdose."}'::jsonb, 60),
  ('kuechenplanung', 'Küchenplanung mit Anschlusspunkten', 't20',
   20, 'werktage', 'Starkstrom, Wasser und Abluft müssen vor der Rohinstallation feststehen.',
   'Der Küchengrundriss mit allen Anschlüssen: Strom, Starkstrom, Wasser, Abwasser, Abluft oder Umluft.',
   '{"whatItIsAbout":"Nicht die Fronten und nicht die Arbeitsplatte, sondern wo Geräte und Spüle stehen. Danach richten sich die Leitungen.","whatDistinguishes":"Vor allem Kochfeld und Dunstabzug. Ein Induktionsfeld braucht Starkstrom, eine Abluftanlage einen Mauerdurchbruch nach außen, eine Umluftanlage nicht.","whatPeopleRegret":"Die Küche erst nach der Rohinstallation geplant. Dann liegt der Wasseranschluss zwei Meter neben der Spüle, und die Steckdose für den Backofen an der falschen Wand."}'::jsonb, 70),
  ('heizsystem', 'Heizsystem und Wärmepumpe final', 't21',
   40, 'werktage', 'Lieferzeit der Geräte und Fristen im Förderantrag.',
   'Welcher Wärmeerzeuger eingebaut wird, wie er ausgelegt ist und ob eine Förderung beantragt wird.',
   '{"whatItIsAbout":"Die Anlage, die dein Haus die nächsten zwanzig Jahre heizt, und die Grundlage für den Förderantrag.","whatDistinguishes":"Die Wärmequelle und die Auslegung. Luft und Erdreich unterscheiden sich in Erschließungskosten und Jahresarbeitszahl. Wichtiger als das Fabrikat ist, dass die Auslegung auf einer Heizlastberechnung beruht und nicht auf einer Faustformel.","whatPeopleRegret":"Eine zu groß ausgelegte Anlage. Sie taktet, verschleißt schneller und verbraucht mehr als eine passend gerechnete."}'::jsonb, 80),
  ('sanitaerobjekte', 'Sanitärobjekte und Vorwandpositionen', 't21',
   20, 'werktage', 'Die Position der Objekte bestimmt die Rohinstallation.',
   'Welche Objekte in Bad und Gäste-WC kommen und wo genau sie hängen. Die Höhen entscheiden über zehn Jahre Nutzung.',
   '{"whatItIsAbout":"Nicht die Armaturen, sondern die Positionen. Wo das WC hängt, wo die Dusche anfängt, auf welcher Höhe das Waschbecken sitzt.","whatDistinguishes":"Bodengleiche Dusche oder Wanne, Wandhängend oder stehend, Unterputz- oder Aufputzarmatur. Unterputz sieht ruhiger aus und ist im Wartungsfall aufwendiger.","whatPeopleRegret":"Standardhöhen übernommen, ohne sich davorzustellen. Ein Waschbecken auf 85 cm ist für 1,60 m und 1,95 m nicht dasselbe."}'::jsonb, 90),
  ('bodenbelag', 'Bodenbelag und Aufbauhöhe', 't26',
   15, 'werktage', 'Die Aufbauhöhe bestimmt die Dicke des Estrichs.',
   'Welcher Belag in welchen Raum kommt. Aus der Aufbauhöhe ergibt sich, wie dick der Estrich eingebracht wird.',
   '{"whatItIsAbout":"Jeder Belag braucht unterschiedlich viel Platz. Der Estrich wird darauf abgestimmt und ist danach nicht mehr zu ändern.","whatDistinguishes":"Aufbauhöhe, Wärmeleitfähigkeit und Pflege. Fliesen leiten die Fußbodenheizung am besten, Parkett fühlt sich wärmer an, Vinyl ist unempfindlich und dünn.","whatPeopleRegret":"Die Entscheidung dem Estrichleger überlassen. Passt die Aufbauhöhe nicht, schleifen später die Türen oder es entsteht eine Schwelle."}'::jsonb, 100),
  ('fliesen', 'Fliesen: Auswahl und Verlegemuster', 't28',
   40, 'werktage', 'Lieferzeit. Der häufigste Grund für Verzug im Innenausbau.',
   'Format, Farbe, Oberfläche und Verlegemuster für Bad, Gäste-WC und gegebenenfalls weitere Räume.',
   '{"whatItIsAbout":"Die Fliesen und die Art, wie sie liegen. Beides muss vor dem Beginn der Fliesenarbeiten geliefert und geprüft sein.","whatDistinguishes":"Format und Oberfläche. Große Formate wirken ruhiger und brauchen einen ebeneren Untergrund. Bei der Rutschhemmung gilt: In der bodengleichen Dusche ist eine matte Oberfläche kein Nachteil.","whatPeopleRegret":"Zu spät ausgesucht. Bei Fliesen sind acht Wochen Lieferzeit nichts Ungewöhnliches, und eine Nachbestellung aus einer anderen Charge weicht im Farbton ab."}'::jsonb, 110),
  ('innentueren', 'Innentüren: Modell, Zargen, Beschläge', 't29',
   50, 'werktage', 'Lange Lieferzeiten, besonders bei abweichenden Maßen.',
   'Türblätter, Zargen, Bänder und Drücker. Bei Sondermaßen und Sonderfarben verlängert sich die Lieferzeit deutlich.',
   '{"whatItIsAbout":"Alle Innentüren zusammen. Sie werden als Satz bestellt und auf die fertige Wandstärke abgestimmt.","whatDistinguishes":"Oberfläche und Aufbau. Röhrenspan ist leicht und günstig, Vollspan schwerer und leiser. Für Bad und Hauswirtschaftsraum lohnt der Blick auf die Feuchtebeständigkeit.","whatPeopleRegret":"Die Türhöhe nicht mitgedacht. Durchgehende Türen bis zur Decke wirken großzügig, sind aber ein Sondermaß mit eigener Lieferzeit."}'::jsonb, 120),
  ('treppe', 'Treppe: Material und Geländer', 't32',
   50, 'werktage', 'Aufmaß erst nach dem Rohbau möglich, danach Fertigung.',
   'Material, Bauart und Geländer der Innentreppe. Das Aufmaß erfolgt am fertigen Rohbau, die Fertigung dauert Wochen.',
   '{"whatItIsAbout":"Die Treppe wird für dein Haus gebaut, nicht gekauft. Zwischen Aufmaß und Einbau liegen mehrere Wochen.","whatDistinguishes":"Bauart und Material. Eine aufgesattelte Holztreppe, eine Betontreppe mit Belag und eine Faltwerktreppe unterscheiden sich in Preis, Schallübertragung und Platzbedarf.","whatPeopleRegret":"Den Schallschutz übersehen. Eine Treppe, die im Schlafzimmer darunter zu hören ist, lässt sich nachträglich kaum entkoppeln."}'::jsonb, 130),
  ('aussenanlagen', 'Außenanlagen: Zufahrt, Terrasse, Zaun', 't35',
   25, 'werktage', 'Materialbestellung und Abstimmung mit der Entwässerung.',
   'Zufahrt, Wege, Terrasse, Einfriedung und wohin das Regenwasser läuft.',
   '{"whatItIsAbout":"Alles außerhalb des Hauses. Häufig der Posten, der im Budget zuletzt drankommt und dann fehlt.","whatDistinguishes":"Versickerungsfähig oder versiegelt. Manche Gemeinden koppeln die Niederschlagswassergebühr an die versiegelte Fläche, und der Bebauungsplan kann Vorgaben machen.","whatPeopleRegret":"Leerrohre für Außenbeleuchtung, Tor und Gartensteckdose nicht mit eingegraben. Danach ist die Zufahrt gepflastert."}'::jsonb, 140)
on conflict (key) do nothing;


-- ===========================================================================
--  Abschnitt: 0009_change_effect.sql
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- MeinBaulotse — Was eine Verschiebung kostet (Arbeitspaket 4)
--
-- Abschnitt 3.5 der Spezifikation nennt acht Schritte für eine Verschiebung.
-- Sieben davon laufen seit AP 1. Der siebte fehlte:
--
--     „Auswirkung auf den prognostizierten Endtermin im schedule_change
--      festschreiben"
--
-- `effect_days_on_completion` steht seit 0001 in der Tabelle und war seitdem
-- immer null. Das ist die unangenehmste Sorte Lücke: Die Spalte suggeriert
-- eine Auskunft, die es nie gab, und in einem halben Jahr fragt jemand die
-- Historie ab und bekommt lauter Nullen zurück, ohne zu merken, dass niemand
-- sie je gefüllt hat.
--
-- Nachträglich füllen lässt sie sich nicht: `schedule_change` ist append-only,
-- per Rechteentzug **und** Trigger. Die Auswirkung muss also feststehen,
-- **bevor** die Änderung geschrieben wird — und genau das kann die Anwendung:
-- Sie rechnet den Plan mit der beabsichtigten Änderung im Speicher durch,
-- bevor sie ihn in der Datenbank ändert.
--
-- Der Weg dorthin ist derselbe, den `app.change_reason` schon geht: ein
-- transaktionslokaler Konfigurationswert, den der Trigger ausliest. Damit
-- ändert sich an der Aufrufseite nichts außer einem weiteren `set_config`.
-- ---------------------------------------------------------------------------

create or replace function mbl.log_task_change()
returns trigger
language plpgsql
security definer
set search_path = mbl, public
as $$
declare
  actor_member uuid;
  actor        mbl.member_role;
  reason       mbl.schedule_change_reason;
  reason_note  text;
  channel      mbl.actor_channel;
  effect       int;
begin
  actor_member := mbl.current_member_id(coalesce(new.project_id, old.project_id));
  actor := mbl.member_role(coalesce(new.project_id, old.project_id));
  channel := mbl.actor_channel();
  reason := nullif(current_setting('app.change_reason', true), '')::mbl.schedule_change_reason;
  reason_note := nullif(current_setting('app.change_reason_text', true), '');
  -- Wie viele Werktage sich der prognostizierte Endtermin durch diese
  -- Änderung verschiebt. Positiv heißt später. Kommt aus der Vorausrechnung
  -- der Anwendung; fehlt sie, bleibt die Spalte null — das ist ehrlicher als
  -- eine Null, die „keine Auswirkung" behauptet.
  effect := nullif(current_setting('app.change_effect_days', true), '')::int;

  if tg_op = 'INSERT' then
    insert into schedule_change (
      project_id, task_id, field, old_value, new_value,
      actor_member_id, actor_role, actor_channel, reason_code, reason_text,
      effect_days_on_completion
    )
    values (
      new.project_id, new.id, 'task_created', null,
      jsonb_build_object(
        'name', new.name,
        'current_start', new.current_start,
        'current_end', new.current_end,
        'duration_days', new.duration_days,
        'status', new.status
      ),
      actor_member, actor, channel, coalesce(reason, 'planinitialisierung'), reason_note,
      effect
    );
    return new;
  end if;

  if new.current_start is distinct from old.current_start then
    insert into schedule_change (project_id, task_id, field, old_value, new_value,
      actor_member_id, actor_role, actor_channel, reason_code, reason_text,
      effect_days_on_completion)
    values (new.project_id, new.id, 'current_start', to_jsonb(old.current_start),
      to_jsonb(new.current_start), actor_member, actor, channel, reason, reason_note, effect);
  end if;

  if new.current_end is distinct from old.current_end then
    insert into schedule_change (project_id, task_id, field, old_value, new_value,
      actor_member_id, actor_role, actor_channel, reason_code, reason_text,
      effect_days_on_completion)
    values (new.project_id, new.id, 'current_end', to_jsonb(old.current_end),
      to_jsonb(new.current_end), actor_member, actor, channel, reason, reason_note, effect);
  end if;

  if new.duration_days is distinct from old.duration_days then
    insert into schedule_change (project_id, task_id, field, old_value, new_value,
      actor_member_id, actor_role, actor_channel, reason_code, reason_text,
      effect_days_on_completion)
    values (new.project_id, new.id, 'duration_days', to_jsonb(old.duration_days),
      to_jsonb(new.duration_days), actor_member, actor, channel, reason, reason_note, effect);
  end if;

  if new.status is distinct from old.status then
    insert into schedule_change (project_id, task_id, field, old_value, new_value,
      actor_member_id, actor_role, actor_channel, reason_code, reason_text,
      effect_days_on_completion)
    values (new.project_id, new.id, 'status', to_jsonb(old.status),
      to_jsonb(new.status), actor_member, actor, channel, reason, reason_note, effect);
  end if;

  return new;
end
$$;

comment on column schedule_change.effect_days_on_completion is
  'Werktage, um die sich der prognostizierte Endtermin durch diese Änderung '
  'verschiebt. Positiv heißt später. Wird vor dem Schreiben vorausgerechnet, '
  'weil die Historie hinterher nicht mehr änderbar ist.';


-- ===========================================================================
--  Abschnitt: 0010_diary.sql
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- MeinBaulotse — Erfassung und Tagebuch (Arbeitspaket 5)
--
-- Abschnitt 3.8 endet mit dem Satz, der den ganzen Entwurf trägt:
--
--     „Der Nutzer erlebt davon nichts. Er sieht ein Fotoalbum seiner
--      Baustelle. Die Beweisqualität ist ein Nebenprodukt."
--
-- Alles hier folgt daraus. Der Bauherr drückt auf einen Knopf, die Kamera geht
-- auf, er tippt einen Satz. Was die Datenbank daraus macht — Versiegelung,
-- Hash-Kette, eingefrorenes Wetter, drei getrennte Zeitangaben — bekommt er
-- nie zu sehen und braucht es genau einmal: wenn zwei Jahre später jemand
-- bestreitet, dass die Dämmung an dem Tag noch nicht drin war.
--
-- Drei Entscheidungen, die man später nicht mehr nachrüsten kann:
--
-- 1. **Die Kette hängt an einer Reihenfolge, nicht an der Uhr.** `chain_index`
--    wird beim Versiegeln vergeben und ist innerhalb eines Bauvorhabens
--    lückenlos. Eine Kette über `created_at` wäre bei zwei Einträgen in
--    derselben Millisekunde nicht mehr eindeutig, und genau das passiert, wenn
--    eine Offline-Warteschlange drei Fotos auf einmal abliefert.
--
-- 2. **Die kanonische Form wird ausgeschrieben, nicht abgeleitet.**
--    `mbl.diary_canonical` nennt jedes Feld einzeln. `to_jsonb(zeile)` wäre
--    kürzer und würde bei der nächsten neuen Spalte jede bestehende Kette
--    brechen — rückwirkend und unreparierbar, denn die alten Hashes lassen
--    sich nicht neu bilden.
--
-- 3. **Zeitpunkte werden zu Text, bevor sie in den Hash gehen.**
--    `to_jsonb(timestamptz)` schreibt in der Zeitzone der Sitzung. Zwei
--    Servern in verschiedenen Zeitzonen dieselbe Zeile zu geben ergäbe zwei
--    Hashes. Deshalb überall `to_char(… at time zone 'UTC', …)`.
--
-- Und eine, die weniger offensichtlich ist: **Die Fotos hängen mit im Hash.**
-- Ohne das ließe sich nach dem Versiegeln das Bild austauschen, während der
-- Eintrag unversehrt aussieht — die Kette prüfte dann nur noch den Text.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Tagebuch
-- ---------------------------------------------------------------------------

create table diary_entry (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references project (id) on delete cascade,
  -- Der Tag, über den der Eintrag spricht. Nicht der Tag, an dem er entstand:
  -- Wer abends im Auto sitzt und den Vormittag nachträgt, meint den Vormittag.
  entry_date        date not null,
  body              text not null default '',
  author_member_id  uuid references project_member (id) on delete set null,
  author_role       mbl.member_role,
  -- Wetter der nächstgelegenen DWD-Station, mit dem Eintrag eingefroren.
  -- Später nachzuschlagen wäre wertlos: Ein Wetterarchiv sagt, wie das Wetter
  -- war, nicht was der Bauherr an dem Tag gesehen und deshalb notiert hat.
  weather           jsonb,
  task_ids          uuid[] not null default '{}',

  -- Versiegelung -----------------------------------------------------------
  locked_at         timestamptz,
  chain_index       int,
  content_hash      text,
  prev_hash         text,

  -- Zurückziehen statt löschen ---------------------------------------------
  retracted_at      timestamptz,
  retraction_reason text,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint diary_entry_sealed_complete
    check (locked_at is null or (content_hash is not null and chain_index is not null)),
  constraint diary_entry_retraction_reason
    check (retracted_at is null or coalesce(retraction_reason, '') <> '')
);

comment on table diary_entry is
  'Bautagebuch. 24 Stunden bearbeitbar, danach versiegelt und über eine '
  'Hash-Kette mit dem vorherigen Eintrag desselben Bauvorhabens verbunden '
  '(Abschnitt 3.8).';
comment on column diary_entry.chain_index is
  'Platz in der Kette, beim Versiegeln vergeben. Lückenlos je Bauvorhaben — '
  'eine Lücke ist selbst schon der Befund.';
comment on column diary_entry.weather is
  'Beobachtung der nächstgelegenen DWD-Station, eingefroren. Enthält Station, '
  'Entfernung und Bezugstag, damit die Angabe nachprüfbar bleibt.';

create unique index diary_entry_chain_key on diary_entry (project_id, chain_index)
  where chain_index is not null;
create index diary_entry_project_idx on diary_entry (project_id, entry_date desc);
create index diary_entry_open_idx on diary_entry (project_id, created_at)
  where locked_at is null;

create trigger diary_entry_touch_updated_at
  before update on diary_entry
  for each row execute function mbl.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Medien
--
-- Drei Zeitangaben, und das ist Absicht. Sie beantworten drei verschiedene
-- Fragen, und genau ihre Abweichungen sind die interessante Auskunft
-- (Abschnitt 3.8: „Abweichungen werden angezeigt, nicht versteckt"):
--
--   exif_taken_at  — was die Kamera in die Datei geschrieben hat
--   captured_at    — wann die Anwendung den Auslöser gesehen hat
--   stated_date    — welchen Tag der Nutzer dem Bild zuordnet
--
-- Eine einzige Spalte müsste sich für eine davon entscheiden und die anderen
-- beiden erfinden. Beim Erfassen im Flugmodus fallen sie auseinander: Die
-- Datei kommt womöglich ohne EXIF aus dem Kamera-Aufsatz des Browsers,
-- hochgeladen wird sie zwei Tage später, gemeint ist der Dienstag.
-- ---------------------------------------------------------------------------

create table media (
  id                    uuid primary key default gen_random_uuid(),
  project_id            uuid not null references project (id) on delete cascade,
  diary_entry_id        uuid references diary_entry (id) on delete restrict,
  task_id               uuid references task (id) on delete set null,

  -- Der Ablageort im Objektspeicher. Die Datei selbst geht nie durch den
  -- Anwendungsserver (Abschnitt 6.1) — der Browser lädt sie direkt hoch und
  -- meldet hier nur, dass und wohin.
  storage_path          text not null,
  mime                  text not null,
  bytes                 bigint not null,
  -- Prüfsumme des Originals, im Browser gebildet. Sie ist der Grund, warum
  -- ein Foto in einer versiegelten Bauakte nicht mehr austauschbar ist.
  sha256                text not null,

  exif_taken_at         timestamptz,
  exif_lat              numeric(9,6),
  exif_lon              numeric(9,6),
  captured_at           timestamptz,
  stated_date           date,

  floorplan_x           numeric(6,4),
  floorplan_y           numeric(6,4),
  floor                 text,
  -- Erfüllt einen Fotoauftrag aus der Lotsenkarte (`photo_prompts[].key`).
  photo_prompt_key      text,
  caption               text,

  uploaded_by_member_id uuid references project_member (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint media_bytes_positive check (bytes > 0),
  constraint media_sha256_shape   check (sha256 ~ '^[0-9a-f]{64}$'),
  -- Ein Fotoauftrag hängt immer an einem Vorgang. Ohne ihn wäre „erfüllt"
  -- eine Aussage ohne Bezug.
  constraint media_prompt_needs_task
    check (photo_prompt_key is null or task_id is not null)
);

comment on table media is
  'Baustellenfotos und Anhänge. Die Datei liegt im Objektspeicher, hier steht '
  'nur, wo sie liegt und was sie belegt.';
comment on column media.sha256 is
  'Prüfsumme des Originals, im Browser gebildet. Geht in den Hash des '
  'Tagebucheintrags ein — ein versiegeltes Foto ist damit nicht mehr '
  'austauschbar, ohne dass die Kette bricht.';

create unique index media_project_sha_key on media (project_id, sha256);
create index media_project_idx on media (project_id, created_at desc);
create index media_entry_idx on media (diary_entry_id) where diary_entry_id is not null;
create index media_prompt_idx on media (task_id, photo_prompt_key)
  where photo_prompt_key is not null;

create trigger media_touch_updated_at
  before update on media
  for each row execute function mbl.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Die kanonische Form
--
-- Jedes Feld einzeln genannt, Zeitpunkte als UTC-Text, Fotos nach ihrer
-- Prüfsumme sortiert. Was hier nicht steht, ist bewusst nicht Teil der
-- Aussage: `updated_at` ändert sich beim Zurückziehen, `retracted_at`
-- ebenfalls — beides darf die Kette nicht brechen, sonst wäre Zurückziehen
-- gleichbedeutend mit Fälschen.
-- ---------------------------------------------------------------------------

create or replace function mbl.diary_canonical(p_entry uuid)
returns jsonb
language sql
stable
security definer
set search_path = mbl, public
as $$
  select jsonb_build_object(
    'id',               e.id,
    'project_id',       e.project_id,
    'entry_date',       to_char(e.entry_date, 'YYYY-MM-DD'),
    'body',             e.body,
    'author_member_id', e.author_member_id,
    'author_role',      e.author_role::text,
    'weather',          coalesce(e.weather, 'null'::jsonb),
    'task_ids',         (select coalesce(jsonb_agg(t order by t), '[]'::jsonb)
                           from unnest(e.task_ids) as t),
    'created_at',       to_char(e.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'media',            (select coalesce(jsonb_agg(
                                  jsonb_build_object(
                                    'sha256',        m.sha256,
                                    'storage_path',  m.storage_path,
                                    'bytes',         m.bytes,
                                    'caption',       m.caption,
                                    'exif_taken_at', case when m.exif_taken_at is null then null
                                                      else to_char(m.exif_taken_at at time zone 'UTC',
                                                                   'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end
                                  ) order by m.sha256), '[]'::jsonb)
                           from media m where m.diary_entry_id = e.id)
  )
  from diary_entry e
  where e.id = p_entry
$$;

create or replace function mbl.diary_hash(p_entry uuid, p_prev text)
returns text
language sql
stable
security definer
set search_path = mbl, public
as $$
  select encode(
    sha256(convert_to(mbl.diary_canonical(p_entry)::text || coalesce(p_prev, ''), 'UTF8')),
    'hex')
$$;
comment on function mbl.diary_hash(uuid, text) is
  'sha256(canonical_json(entry) + prev_hash), Abschnitt 3.8.';

-- ---------------------------------------------------------------------------
-- Versiegeln
--
-- Eine Uhr löst keinen Trigger aus. Die Versiegelung passiert deshalb faul:
-- Die Anwendung ruft diese Funktion beim Lesen und Schreiben des Tagebuchs
-- auf, und sie holt nach, was fällig ist. Das genügt — ein Eintrag, den nie
-- jemand ansieht, muss auch nicht versiegelt sein, und sobald jemand ihn
-- ansieht, ist er es.
--
-- `security definer`, weil die Kette dem Bauvorhaben gehört und nicht dem
-- Verfasser: Der Bauherr, der sein Tagebuch aufschlägt, versiegelt damit auch
-- den Eintrag des Generalunternehmers von vorgestern. Er ändert ihn nicht — er
-- friert ihn ein.
-- ---------------------------------------------------------------------------

create or replace function mbl.seal_due_diary_entries(
  p_project uuid,
  p_now     timestamptz default now()
)
returns int
language plpgsql
security definer
set search_path = mbl, public
as $$
declare
  faellig   record;
  vorher    text;
  neuer     text;
  platz     int;
  anzahl    int := 0;
begin
  if not mbl.is_member(p_project) then
    return 0;
  end if;

  select content_hash, chain_index into vorher, platz
    from diary_entry
   where project_id = p_project and locked_at is not null
   order by chain_index desc
   limit 1;
  platz := coalesce(platz, 0);

  for faellig in
    select id from diary_entry
     where project_id = p_project
       and locked_at is null
       and created_at <= p_now - interval '24 hours'
     order by created_at, id
     for update
  loop
    platz := platz + 1;
    neuer := mbl.diary_hash(faellig.id, vorher);
    update diary_entry
       set locked_at    = p_now,
           chain_index  = platz,
           prev_hash    = vorher,
           content_hash = neuer
     where id = faellig.id;
    vorher := neuer;
    anzahl := anzahl + 1;
  end loop;

  if anzahl > 0 then
    update project set diary_head_hash = vorher where id = p_project;
  end if;
  return anzahl;
end
$$;

-- ---------------------------------------------------------------------------
-- Prüfen
--
-- Gibt je versiegeltem Eintrag zurück, ob er noch zu seinem Hash passt und ob
-- er noch am richtigen Vorgänger hängt. Der erste `ok = false` ist die
-- Fundstelle; alles danach ist Folgeschaden.
--
-- Diese Funktion ist der Grund, warum die ganze Mechanik existiert. Sie
-- beantwortet die einzige Frage, die im Streitfall zählt: Ist das hier noch
-- das, was damals aufgeschrieben wurde?
-- ---------------------------------------------------------------------------

create or replace function mbl.verify_diary_chain(p_project uuid)
returns table (
  chain_index int,
  entry_id    uuid,
  entry_date  date,
  ok          boolean,
  reason      text
)
language plpgsql
stable
security definer
set search_path = mbl, public
as $$
declare
  eintrag  record;
  erwartet text;
  vorher   text := null;
  platz    int  := 0;
begin
  if not mbl.is_member(p_project) then
    return;
  end if;

  for eintrag in
    select e.id, e.chain_index, e.entry_date, e.content_hash, e.prev_hash
      from diary_entry e
     where e.project_id = p_project and e.locked_at is not null
     order by e.chain_index
  loop
    platz := platz + 1;
    erwartet := mbl.diary_hash(eintrag.id, vorher);

    chain_index := eintrag.chain_index;
    entry_id    := eintrag.id;
    entry_date  := eintrag.entry_date;

    if eintrag.chain_index <> platz then
      ok := false;
      reason := format('In der Kette fehlt Platz %s.', platz);
    elsif eintrag.prev_hash is distinct from vorher then
      ok := false;
      reason := 'Der Eintrag hängt nicht mehr am vorherigen.';
    elsif eintrag.content_hash is distinct from erwartet then
      ok := false;
      reason := 'Der Inhalt passt nicht mehr zu seiner Prüfsumme.';
    else
      ok := true;
      reason := null;
    end if;

    return next;
    -- Weitergerechnet wird mit dem **gespeicherten** Hash, nicht mit dem
    -- erwarteten. Sonst meldete eine einzelne Änderung die ganze restliche
    -- Kette als kaputt, und die Fundstelle ginge im Rauschen unter.
    vorher := eintrag.content_hash;
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- Was nach dem Versiegeln noch geht
-- ---------------------------------------------------------------------------

create or replace function mbl.guard_diary_locked()
returns trigger
language plpgsql
as $$
begin
  if old.locked_at is null then
    return new;
  end if;

  if (to_jsonb(new) - 'retracted_at' - 'retraction_reason' - 'updated_at')
     is distinct from (to_jsonb(old) - 'retracted_at' - 'retraction_reason' - 'updated_at') then
    raise exception
      'Dieser Eintrag ist versiegelt. Zurückziehen kannst du ihn — er bleibt dann sichtbar und trägt deinen Grund.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;

create trigger diary_entry_guard_locked
  before update on diary_entry
  for each row execute function mbl.guard_diary_locked();

-- Ein versiegelter Eintrag trägt die Prüfsummen seiner Fotos im Hash. Ein Foto
-- danach zu tauschen oder zu entfernen bräche die Kette — deshalb wird es hier
-- gar nicht erst zugelassen, mit einer Fehlermeldung statt mit einem Befund.
create or replace function mbl.guard_media_sealed()
returns trigger
language plpgsql
as $$
declare
  betroffen uuid;
begin
  betroffen := coalesce(new.diary_entry_id, old.diary_entry_id);
  if tg_op = 'UPDATE' and old.diary_entry_id is distinct from new.diary_entry_id then
    -- Beide Seiten prüfen: weg von einem versiegelten Eintrag ist genauso
    -- wenig erlaubt wie hin zu einem.
    if exists (select 1 from diary_entry
                where id in (old.diary_entry_id, new.diary_entry_id)
                  and locked_at is not null) then
      raise exception 'Dieses Foto gehört zu einem versiegelten Eintrag und bleibt dort.'
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  if betroffen is not null
     and exists (select 1 from diary_entry where id = betroffen and locked_at is not null) then
    raise exception 'Dieses Foto gehört zu einem versiegelten Eintrag und bleibt, wie es ist.'
      using errcode = 'insufficient_privilege';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end
$$;

create trigger media_guard_sealed
  before update or delete on media
  for each row execute function mbl.guard_media_sealed();

-- ---------------------------------------------------------------------------
-- Rechte
-- ---------------------------------------------------------------------------

-- Kein `delete` auf diary_entry — nicht als Policy, sondern als entzogenes
-- Recht. Dieselbe Bauweise wie bei `schedule_change`: Eine Policy, die nichts
-- durchlässt, ist eine Meinung; ein fehlendes Recht ist eine Tatsache.
grant select, insert, update on diary_entry to authenticated;
grant select, insert, update, delete on media to authenticated;

alter table diary_entry enable row level security;
alter table media       enable row level security;

-- Der eigene Ausschnitt für Einzelgewerke: Ein Fliesenleger liest die Einträge
-- zu seinen Vorgängen, nicht das Tagebuch des Bauherrn.
create or replace function mbl.diary_in_scope(p_project uuid, p_tasks uuid[])
returns boolean
language sql
stable
security definer
set search_path = mbl, public
as $$
  select case
    when mbl.member_role(p_project) <> 'trade' then true
    else exists (
      select 1 from task t
       where t.id = any(p_tasks)
         and t.trade_id is not distinct from mbl.member_trade(p_project)
    )
  end
$$;

create policy diary_read on diary_entry for select to authenticated
  using (mbl.is_member(project_id) and mbl.diary_in_scope(project_id, task_ids));

create policy diary_create on diary_entry for insert to authenticated
  with check (
    mbl.has_perm(project_id, 'diary.write')
    -- Kein Eintrag im fremden Namen. Die Rechtematrix kennt die Zeile
    -- „Fremden Eintrag ändern" für keine Rolle; sie fremd anzulegen wäre
    -- dasselbe in schneller.
    and author_member_id = mbl.current_member_id(project_id)
  );

create policy diary_update on diary_entry for update to authenticated
  using (
    mbl.has_perm(project_id, 'diary.write')
    and author_member_id = mbl.current_member_id(project_id)
  )
  with check (
    mbl.has_perm(project_id, 'diary.write')
    and author_member_id = mbl.current_member_id(project_id)
  );

create policy media_read on media for select to authenticated
  using (mbl.is_member(project_id) and mbl.trade_scope_ok(project_id, (
    select t.trade_id from task t where t.id = media.task_id
  )));

create policy media_create on media for insert to authenticated
  with check (
    (mbl.has_perm(project_id, 'diary.write') or mbl.has_perm(project_id, 'defect.write'))
    and uploaded_by_member_id = mbl.current_member_id(project_id)
  );

create policy media_update on media for update to authenticated
  using (uploaded_by_member_id = mbl.current_member_id(project_id))
  with check (uploaded_by_member_id = mbl.current_member_id(project_id));

create policy media_delete on media for delete to authenticated
  using (uploaded_by_member_id = mbl.current_member_id(project_id));


-- ===========================================================================
--  Abschnitt: 0011_storage.sql
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- MeinBaulotse — Der Bildspeicher (Arbeitspaket 5)
--
-- Abschnitt 6.1, Zeile „Dateien": *S3-kompatibel, signierte Upload-URLs,
-- Fotos gehen nie durch den Anwendungsserver.* Auf Supabase heißt das:
-- Supabase Storage, und der Browser lädt mit **seiner eigenen** Sitzung hoch.
--
-- Damit bleibt Regel 1 unangetastet. Es gibt keinen Weg, auf dem ein Foto mit
-- erhöhten Rechten in den Speicher käme — die Rechteprüfung ist dieselbe
-- `mbl.is_member`, die auch über den Tabellen steht, nur an einer anderen
-- Tabelle. Der Nebeneffekt ist der eigentliche Gewinn: Ein 12-MB-Foto belegt
-- nie eine Vercel-Function, und die 4,5-MB-Grenze für Anfragekörper spielt
-- keine Rolle.
--
-- Der Ablageweg ist Teil der Rechteprüfung, nicht nur Ordnung:
--
--     <bauvorhaben-uuid>/<medien-uuid>.<endung>
--
-- Der erste Ordner **ist** das Bauvorhaben. Deshalb kann die Policy allein aus
-- dem Pfad entscheiden, ohne die Datei zu kennen.
--
-- Die ganze Datei läuft nur, wenn es das Schema `storage` gibt. Lokal gibt es
-- das nicht — dort läuft nacktes Postgres, und `pnpm db:reset` soll dadurch
-- nicht scheitern. Die Anwendung sagt dann beim Hochladen offen, dass der
-- Bildspeicher fehlt, statt so zu tun, als sei das Foto angekommen.
-- ---------------------------------------------------------------------------

-- Ein Ordnername, der keine Kennung ist, ist kein Fehler, sondern eine Datei,
-- die uns nichts angeht. Ohne diese Umleitung bräche ein einziger falsch
-- benannter Ordner jede Leseanfrage auf den ganzen Eimer.
create or replace function mbl.as_uuid(p_text text)
returns uuid
language plpgsql
immutable
as $$
begin
  return p_text::uuid;
exception when others then
  return null;
end
$$;

do $$
begin
  if not exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    raise notice 'Kein Schema "storage" — Bildspeicher übersprungen. Das ist lokal normal.';
    return;
  end if;

  -- 25 MB je Datei. Ein Handyfoto liegt bei 3 bis 8 MB; wer ein Video hochlädt,
  -- soll es merken, bevor er auf der Baustelle sein Datenvolumen verbraucht.
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'baustellenfotos', 'baustellenfotos', false, 26214400,
    array['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf']
  )
  on conflict (id) do update
     set public             = excluded.public,
         file_size_limit    = excluded.file_size_limit,
         allowed_mime_types = excluded.allowed_mime_types;

  execute $p$drop policy if exists baustellenfotos_read on storage.objects$p$;
  execute $p$drop policy if exists baustellenfotos_write on storage.objects$p$;
  execute $p$drop policy if exists baustellenfotos_replace on storage.objects$p$;
  execute $p$drop policy if exists baustellenfotos_remove on storage.objects$p$;

  -- Lesen darf jedes Mitglied. Die Zeilenschärfe für Einzelgewerke sitzt eine
  -- Ebene höher, an `media`: Ohne die Zeile dort ist ein Pfad nur eine
  -- Zeichenkette, die niemand kennt.
  execute $p$
    create policy baustellenfotos_read on storage.objects for select to authenticated
      using (
        bucket_id = 'baustellenfotos'
        and mbl.is_member(mbl.as_uuid((storage.foldername(name))[1]))
      )$p$;

  execute $p$
    create policy baustellenfotos_write on storage.objects for insert to authenticated
      with check (
        bucket_id = 'baustellenfotos'
        and (
          mbl.has_perm(mbl.as_uuid((storage.foldername(name))[1]), 'diary.write')
          or mbl.has_perm(mbl.as_uuid((storage.foldername(name))[1]), 'defect.write')
        )
      )$p$;

  -- Überschreiben ist die stille Form des Austauschens: derselbe Pfad, ein
  -- anderes Bild, und die Prüfsumme in `media` zeigt ins Leere. Deshalb gibt
  -- es dafür kein Recht. Ein neues Foto bekommt einen neuen Pfad.
  execute $p$
    create policy baustellenfotos_remove on storage.objects for delete to authenticated
      using (
        bucket_id = 'baustellenfotos'
        and mbl.has_perm(mbl.as_uuid((storage.foldername(name))[1]), 'diary.write')
      )$p$;
end
$$;


-- ===========================================================================
--  Abschnitt: 0012_guest.sql
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- MeinBaulotse — Abstimmung ohne Konto (Arbeitspaket 6)
--
-- Abschnitt 5.5 zeigt die ganze Ansicht in fünf Zeilen:
--
--     Für den Innenputz ist der 12.–21.05. eingetragen. Passt das?
--     [ Passt ]   [ Anderer Termin ]   [ Antworten ]
--
-- Wer sie benutzt, ist ein Polier auf einer Baustelle mit dem Handy in der
-- Hand. Er wird sich nicht registrieren, kein Passwort setzen und keine App
-- installieren. Tut er es doch nicht, bleibt jeder Termin im Plan eine
-- einseitige Behauptung — und genau darum geht es bei diesem Arbeitspaket.
--
-- Die schwierige Frage ist nicht die Ansicht, sondern die Rechteprüfung: Ein
-- Gast hat keine Kennung in `auth.users`, und trotzdem muss dieselbe RLS
-- gelten. Die Antwort steht schon seit 0002 als Kommentar über
-- `mbl.current_user_id` — „Ab AP 6 löst diese Funktion zusätzlich Gast-Token
-- auf". Hier wird sie eingelöst:
--
--   1. Der Anwendungsserver setzt `app.guest_token_hash` transaktionslokal.
--   2. `mbl.current_member_id` löst daraus die Mitgliedschaft auf.
--   3. Ab da gilt jede Policy unverändert weiter.
--
-- Kein zweiter Rechteweg, keine Sonderpolicy, keine privilegierte Rolle. Ein
-- Gast **ist** ein `project_member` — er hat nur einen anderen Türschlüssel.
--
-- Dazu kommt eine Verengung, die ein angemeldeter Nutzer nicht hat: Der Token
-- trägt Scopes (Abschnitt 2.3), und die schneiden die Rechte seiner Rolle
-- zusätzlich zu. Ein Bestätigungslink kann bestätigen — mehr nicht, auch wenn
-- die Rolle mehr dürfte.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Was ein Scope erlaubt — als Daten, nicht als Bedingung im Code
--
-- Dieselbe Bauweise wie `role_permission` (Regel 5): Die Rechtematrix steht in
-- einer Tabelle, und `mbl.has_perm` fragt sie ab. Ein Scope, der irgendwo als
-- `if` im Anwendungscode stünde, wäre die zweite Wahrheit neben der ersten.
-- ---------------------------------------------------------------------------

create table scope_permission (
  scope      text not null,
  permission text not null,
  primary key (scope, permission)
);
comment on table scope_permission is
  'Die vier Scopes aus Abschnitt 2.3 und die Rechte, die sie freigeben. Der '
  'Gast bekommt den Schnitt aus seiner Rolle und seinen Scopes.';

insert into scope_permission (scope, permission) values
  -- Ohne Lesen ist jeder Link eine leere Seite. Deshalb trägt jeder Scope es
  -- mit: Ein Bestätigungslink, der den Termin nicht anzeigen darf, den er
  -- bestätigen soll, wäre eine Zumutung.
  ('view:project',    'project.read'),
  ('view:trade',      'project.read'),
  ('confirm:task',    'project.read'),
  ('report:progress', 'project.read'),
  -- Bestätigen heißt auch: einen anderen Termin nennen dürfen. Ein „Passt
  -- nicht" ohne Gegenvorschlag ist für den Plan wertlos.
  ('confirm:task',    'task.confirm'),
  ('confirm:task',    'task.schedule'),
  ('report:progress', 'task.progress');

-- ---------------------------------------------------------------------------
-- Der Token
--
-- Gespeichert wird nur der Hash (Abschnitt 6.4). Wer die Datenbank liest, kann
-- damit keinen Link bauen — auch nicht der Eigentümer im SQL-Editor.
-- ---------------------------------------------------------------------------

create table guest_token (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references project (id) on delete cascade,
  member_id         uuid not null references project_member (id) on delete cascade,
  token_hash        text not null unique,
  scopes            text[] not null default '{}',
  -- de, pl, ro, tr, en. „Mehrsprachig ausliefern erhöht die Rücklaufquote auf
  -- der Baustelle spürbar und kostet fast nichts" (Abschnitt 2.3).
  locale            text not null default 'de',

  -- Bindung an eine Erreichbarkeit. Der Token wird darüber zugestellt; eine
  -- abweichende Nutzung ist kein Fehler, aber sie gehört ins Protokoll.
  bound_email       text,
  bound_phone       text,

  -- „Erste Nutzung erfasst optional Name und Firma."
  claimed_name      text,
  claimed_company   text,
  claimed_at        timestamptz,

  expires_at        timestamptz not null default now() + interval '180 days',
  last_used_at      timestamptz,
  use_count         int not null default 0,

  -- Ratenbegrenzung als gleitendes Fenster, in der Zeile statt in einem
  -- Zwischenspeicher: Eine Serverless-Funktion hat keinen gemeinsamen
  -- Speicher, und ein zweiter Dienst nur für diesen Zähler wäre mehr Betrieb
  -- als Nutzen.
  window_started_at timestamptz,
  window_count      int not null default 0,

  revoked_at        timestamptz,
  created_by        uuid references project_member (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint guest_token_locale check (locale in ('de','pl','ro','tr','en')),
  constraint guest_token_hash_shape check (token_hash ~ '^[0-9a-f]{64}$')
);
comment on column guest_token.token_hash is
  'sha256 des Links. Der Klartext verlässt den Server genau einmal — beim '
  'Anlegen. Danach ist er nicht mehr rekonstruierbar, auch nicht für uns.';

create index guest_token_project_idx on guest_token (project_id) where revoked_at is null;
create index guest_token_member_idx on guest_token (member_id);

create trigger guest_token_touch_updated_at
  before update on guest_token
  for each row execute function mbl.touch_updated_at();

-- Jeder Scope muss einer sein, den es gibt. Ein Tippfehler in `scopes` wäre
-- sonst ein Link, der nichts darf, und niemand fände heraus warum.
create or replace function mbl.guard_guest_scopes()
returns trigger
language plpgsql
security definer
set search_path = mbl, public
as $$
declare
  unbekannt text;
begin
  select s into unbekannt
    from unnest(new.scopes) as s
   where not exists (select 1 from scope_permission sp where sp.scope = s)
   limit 1;
  if unbekannt is not null then
    raise exception 'Den Scope „%" gibt es nicht.', unbekannt using errcode = 'check_violation';
  end if;
  return new;
end
$$;

create trigger guest_token_guard_scopes
  before insert or update on guest_token
  for each row execute function mbl.guard_guest_scopes();

-- ---------------------------------------------------------------------------
-- Auflösung
-- ---------------------------------------------------------------------------

create or replace function mbl.guest_token_id()
returns uuid
language sql
stable
security definer
set search_path = mbl, public
as $$
  select t.id
    from guest_token t
   where t.token_hash = nullif(current_setting('app.guest_token_hash', true), '')
     and t.revoked_at is null
     and t.expires_at > now()
$$;
comment on function mbl.guest_token_id() is
  'Der gültige Token dieser Transaktion, falls einer gesetzt ist. Abgelaufene '
  'und zurückgezogene lösen bewusst zu null auf — dann ist der Gast schlicht '
  'kein Mitglied mehr, und jede Policy greift von selbst.';

-- Die Erweiterung, auf die der Kommentar in 0002 verweist. Der Gast hat
-- Vorrang: Wer über einen Link hereinkommt, hat sich für diese Identität
-- entschieden, auch wenn zufällig eine Sitzung im selben Browser liegt.
create or replace function mbl.current_member_id(p_project uuid)
returns uuid
language sql
stable
security definer
set search_path = mbl, public, auth
as $$
  select coalesce(
    (
      select m.id
        from guest_token t
        join project_member m on m.id = t.member_id
       where t.id = mbl.guest_token_id()
         and m.project_id = p_project
         and m.revoked_at is null
    ),
    (
      select m.id
      from project_member m
      where m.project_id = p_project
        and m.revoked_at is null
        and (
          m.user_id = auth.uid()
          or (
            m.expert_org_id is not null
            and exists (
              select 1 from expert_org_member om
              where om.org_id = m.expert_org_id and om.user_id = auth.uid()
            )
          )
        )
      order by (m.user_id = auth.uid()) desc
      limit 1
    )
  )
$$;

-- ---------------------------------------------------------------------------
-- Der Schnitt aus Rolle und Scope
-- ---------------------------------------------------------------------------

create or replace function mbl.scope_allows(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = mbl, public
as $$
  select case
    -- Kein Token: ein angemeldeter Nutzer, für den es keine Scopes gibt.
    when mbl.guest_token_id() is null then true
    else exists (
      select 1
        from guest_token t
        join scope_permission sp on sp.scope = any (t.scopes)
       where t.id = mbl.guest_token_id()
         and sp.permission = p_permission
    )
  end
$$;

create or replace function mbl.has_perm(p_project uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = mbl, public, auth
as $$
  select exists (
    select 1
    from role_permission rp
    where rp.permission = p_permission
      and rp.role = mbl.member_role(p_project)
  ) and mbl.scope_allows(p_permission)
$$;
comment on function mbl.has_perm(uuid, text) is
  'Rechtematrix aus Abschnitt 2.2, für Gäste zusätzlich verengt auf die Scopes '
  'ihres Links (Abschnitt 2.3). Der Schnitt, nie die Vereinigung.';

-- Ein Token ohne Lesescope ist kein Mitglied. Damit greift die Verengung auch
-- dort, wo eine Policy nur `is_member` fragt — und das sind die meisten.
create or replace function mbl.is_member(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = mbl, public, auth
as $$
  select mbl.current_member_id(p_project) is not null
     and mbl.scope_allows('project.read')
$$;

-- ---------------------------------------------------------------------------
-- Benutzung festhalten und begrenzen
--
-- Eine Funktion statt zweier, weil beides in denselben Schreibvorgang gehört:
-- Wer zählt, ohne zu begrenzen, hat eine Statistik; wer begrenzt, ohne zu
-- zählen, hat eine Vermutung.
-- ---------------------------------------------------------------------------

create or replace function mbl.use_guest_token(
  p_ip_hash         text default null,
  p_user_agent_hash text default null,
  p_limit           int  default 60,
  p_window          interval default interval '1 minute'
)
returns table (allowed boolean, project_id uuid, member_id uuid, locale text, scopes text[])
language plpgsql
security definer
set search_path = mbl, public
as $$
declare
  zeile guest_token%rowtype;
begin
  select * into zeile from guest_token where id = mbl.guest_token_id() for update;
  if not found then
    return;
  end if;

  if zeile.window_started_at is null or zeile.window_started_at < now() - p_window then
    zeile.window_started_at := now();
    zeile.window_count := 0;
  end if;
  zeile.window_count := zeile.window_count + 1;

  update guest_token
     set window_started_at = zeile.window_started_at,
         window_count      = zeile.window_count,
         use_count         = use_count + 1,
         last_used_at      = now()
   where id = zeile.id;

  insert into audit_log (project_id, actor_member_id, actor_channel, action,
                         entity_type, entity_id, ip_hash, user_agent_hash, meta)
  values (zeile.project_id, zeile.member_id, 'guest_link', 'guest.open',
          'guest_token', zeile.id, p_ip_hash, p_user_agent_hash,
          jsonb_build_object('use_count', zeile.use_count + 1,
                             'rate_limited', zeile.window_count > p_limit));

  allowed    := zeile.window_count <= p_limit;
  project_id := zeile.project_id;
  member_id  := zeile.member_id;
  locale     := zeile.locale;
  scopes     := zeile.scopes;
  return next;
end
$$;

-- „Erste Nutzung erfasst optional Name und Firma." Danach nicht mehr: Wer
-- einmal gesagt hat, wer er ist, soll es nicht überschreiben können — sonst
-- steht in der Bauakte am Ende ein anderer Name über derselben Bestätigung.
create or replace function mbl.claim_guest_token(p_name text, p_company text)
returns void
language plpgsql
security definer
set search_path = mbl, public
as $$
declare
  zeile guest_token%rowtype;
begin
  select * into zeile from guest_token where id = mbl.guest_token_id();
  if not found or zeile.claimed_at is not null then
    return;
  end if;

  update guest_token
     set claimed_name = nullif(trim(p_name), ''),
         claimed_company = nullif(trim(p_company), ''),
         claimed_at = now()
   where id = zeile.id;

  -- Der Name wandert auch in die Mitgliedschaft: In jeder Ansicht steht
  -- danach „Bestätigt von Jörg Baumeister" statt „Bestätigt vom Gast".
  update project_member
     set display_name = coalesce(nullif(trim(p_name), ''), display_name),
         company      = coalesce(nullif(trim(p_company), ''), company),
         accepted_at  = coalesce(accepted_at, now())
   where id = zeile.member_id;
end
$$;

-- ---------------------------------------------------------------------------
-- Bestätigungsgrad (Abschnitt 3.4)
--
-- Vier Werte, und die Wortwahl im Produkt ist Absicht: *abgestimmt* statt
-- quittiert, *zwei Angaben* statt strittig. Dieselbe Datenlage, ein anderer
-- Ton.
--
-- Der Gegenvorschlag bekommt eigene Spalten, statt den Termin zu überschreiben.
-- Das ist der ganze Unterschied zwischen „zwei Angaben" und „der GU hat den
-- Termin geändert": Solange beide dastehen, entscheidet der Bauherr, welcher
-- gilt. Überschreibt der GU, hat er entschieden.
-- ---------------------------------------------------------------------------

alter table task
  add column counter_start date,
  add column counter_end   date,
  add column counter_by    uuid references project_member (id) on delete set null,
  add column counter_at    timestamptz,
  add column counter_note  text;

comment on column task.counter_start is
  'Der abweichende Termin der Gegenseite. Steht neben dem eingetragenen, nicht '
  'an seiner Stelle — „zwei Angaben" ist eine Datenlage, kein Zwischenzustand.';

-- Wer den Termin nennt, bestimmt den Bestätigungsgrad. Das ist keine Frage der
-- Höflichkeit, sondern die Definition aus Abschnitt 3.4 — und sie gehört in
-- einen Trigger, weil eine Anwendung sie an genau einer Stelle vergessen wird.
create or replace function mbl.stamp_confirmation()
returns trigger
language plpgsql
security definer
set search_path = mbl, public
as $$
declare
  rolle mbl.member_role;
begin
  if new.current_start is not distinct from old.current_start
     and new.current_end is not distinct from old.current_end then
    return new;
  end if;

  -- Die eine Ausnahme: Wer einen Gegenvorschlag übernimmt, trägt einen
  -- **fremden** Termin ein. Der Grad folgt dann dem Urheber und nicht dem, der
  -- gerade tippt — sonst stünde am Ende „von dir eingetragen" über einem
  -- Termin, den das Unternehmen genannt hat, und die anschließende Bestätigung
  -- des Bauherrn wäre eine Bestätigung seiner selbst.
  --
  -- Derselbe Weg wie bei `app.change_reason`: ein transaktionslokaler Wert,
  -- den die Anwendung setzt und der Trigger liest.
  if nullif(current_setting('app.confirmation_from', true), '') = 'counterparty' then
    new.confirmation  := 'counterparty_stated';
    new.confirmed_by  := null;
    new.confirmed_at  := null;
    new.counter_start := null;
    new.counter_end   := null;
    new.counter_by    := null;
    new.counter_at    := null;
    new.counter_note  := null;
    return new;
  end if;

  rolle := mbl.member_role(new.project_id);

  if rolle in ('owner','co_owner') then
    new.confirmation := 'self_stated';
  elsif rolle in ('contractor','trade') then
    new.confirmation := 'counterparty_stated';
  else
    -- Baubegleiter, Mitleser oder die Neuberechnung ohne Mitgliedschaft:
    -- Der Grad bleibt, wie er war. Wer nicht terminieren darf, ändert auch
    -- nicht, wessen Angabe das ist.
    return new;
  end if;

  -- Ein bewegter Termin ist nicht mehr derselbe Termin. Eine Abstimmung, die
  -- ihn überlebt, wäre eine Behauptung über etwas, worüber nie gesprochen
  -- wurde.
  new.confirmed_by  := null;
  new.confirmed_at  := null;
  new.counter_start := null;
  new.counter_end   := null;
  new.counter_by    := null;
  new.counter_at    := null;
  new.counter_note  := null;
  return new;
end
$$;

create trigger task_stamp_confirmation
  before update on task
  for each row execute function mbl.stamp_confirmation();

-- „Abgestimmt" heißt: beide Seiten. Nicht: derselbe zweimal.
create or replace function mbl.guard_confirmation()
returns trigger
language plpgsql
security definer
set search_path = mbl, public
as $$
declare
  rolle mbl.member_role;
begin
  if new.confirmation is not distinct from old.confirmation then
    return new;
  end if;
  rolle := mbl.member_role(new.project_id);

  if new.confirmation = 'mutual' then
    if new.confirmed_by is distinct from mbl.current_member_id(new.project_id) then
      raise exception 'Bestätigen kann nur, wer gerade da ist.'
        using errcode = 'insufficient_privilege';
    end if;
    if old.confirmation = 'self_stated' and rolle not in ('contractor','trade') then
      raise exception 'Diesen Termin hat die Bauherrenseite eingetragen. Bestätigen muss ihn das ausführende Unternehmen.'
        using errcode = 'insufficient_privilege';
    end if;
    if old.confirmation = 'counterparty_stated' and rolle not in ('owner','co_owner') then
      raise exception 'Diesen Termin hat das ausführende Unternehmen genannt. Bestätigen muss ihn die Bauherrenseite.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  if new.confirmation = 'disputed'
     and new.counter_start is null and new.counter_end is null then
    raise exception 'Zwei Angaben braucht eine zweite Angabe.'
      using errcode = 'check_violation';
  end if;

  return new;
end
$$;

create trigger task_guard_confirmation
  before update on task
  for each row execute function mbl.guard_confirmation();

-- ---------------------------------------------------------------------------
-- Der Gegenvorschlag in der Historie
--
-- Abnahme von AP 6, zweiter Satz: „Ein Gegenvorschlag erzeugt `disputed` und
-- einen Änderungseintrag mit Kanal `guest_link`." Der Kanal stand schon; der
-- Eintrag fehlte, denn `current_start` bewegt sich dabei gerade **nicht**.
--
-- Diese Fassung ersetzt die aus 0009 und ergänzt sie um die beiden
-- Gegenvorschlagsfelder. Alles andere ist unverändert.
-- ---------------------------------------------------------------------------

create or replace function mbl.log_task_change()
returns trigger
language plpgsql
security definer
set search_path = mbl, public
as $$
declare
  actor_member uuid;
  actor        mbl.member_role;
  reason       mbl.schedule_change_reason;
  reason_note  text;
  channel      mbl.actor_channel;
  effect       int;
begin
  actor_member := mbl.current_member_id(coalesce(new.project_id, old.project_id));
  actor := mbl.member_role(coalesce(new.project_id, old.project_id));
  channel := mbl.actor_channel();
  reason := nullif(current_setting('app.change_reason', true), '')::mbl.schedule_change_reason;
  reason_note := nullif(current_setting('app.change_reason_text', true), '');
  effect := nullif(current_setting('app.change_effect_days', true), '')::int;

  if tg_op = 'INSERT' then
    insert into schedule_change (
      project_id, task_id, field, old_value, new_value,
      actor_member_id, actor_role, actor_channel, reason_code, reason_text,
      effect_days_on_completion
    )
    values (
      new.project_id, new.id, 'task_created', null,
      jsonb_build_object(
        'name', new.name,
        'current_start', new.current_start,
        'current_end', new.current_end,
        'duration_days', new.duration_days,
        'status', new.status
      ),
      actor_member, actor, channel, coalesce(reason, 'planinitialisierung'), reason_note,
      effect
    );
    return new;
  end if;

  if new.current_start is distinct from old.current_start then
    insert into schedule_change (project_id, task_id, field, old_value, new_value,
      actor_member_id, actor_role, actor_channel, reason_code, reason_text,
      effect_days_on_completion)
    values (new.project_id, new.id, 'current_start', to_jsonb(old.current_start),
      to_jsonb(new.current_start), actor_member, actor, channel, reason, reason_note, effect);
  end if;

  if new.current_end is distinct from old.current_end then
    insert into schedule_change (project_id, task_id, field, old_value, new_value,
      actor_member_id, actor_role, actor_channel, reason_code, reason_text,
      effect_days_on_completion)
    values (new.project_id, new.id, 'current_end', to_jsonb(old.current_end),
      to_jsonb(new.current_end), actor_member, actor, channel, reason, reason_note, effect);
  end if;

  if new.duration_days is distinct from old.duration_days then
    insert into schedule_change (project_id, task_id, field, old_value, new_value,
      actor_member_id, actor_role, actor_channel, reason_code, reason_text,
      effect_days_on_completion)
    values (new.project_id, new.id, 'duration_days', to_jsonb(old.duration_days),
      to_jsonb(new.duration_days), actor_member, actor, channel, reason, reason_note, effect);
  end if;

  if new.status is distinct from old.status then
    insert into schedule_change (project_id, task_id, field, old_value, new_value,
      actor_member_id, actor_role, actor_channel, reason_code, reason_text,
      effect_days_on_completion)
    values (new.project_id, new.id, 'status', to_jsonb(old.status),
      to_jsonb(new.status), actor_member, actor, channel, reason, reason_note, effect);
  end if;

  -- Neu in 0012: Der Gegenvorschlag. Er bewegt keinen Termin und wäre sonst
  -- die einzige Aussage über einen Termin, die nirgends steht.
  if new.counter_start is distinct from old.counter_start
     or new.counter_end is distinct from old.counter_end then
    insert into schedule_change (project_id, task_id, field, old_value, new_value,
      actor_member_id, actor_role, actor_channel, reason_code, reason_text,
      effect_days_on_completion)
    values (new.project_id, new.id, 'counter_proposal',
      jsonb_build_object('start', old.counter_start, 'end', old.counter_end),
      jsonb_build_object('start', new.counter_start, 'end', new.counter_end,
                         'note', new.counter_note),
      actor_member, actor, channel, reason, reason_note, effect);
  end if;

  if new.confirmation is distinct from old.confirmation
     and new.confirmation = 'mutual' then
    insert into schedule_change (project_id, task_id, field, old_value, new_value,
      actor_member_id, actor_role, actor_channel, reason_code, reason_text,
      effect_days_on_completion)
    values (new.project_id, new.id, 'confirmation', to_jsonb(old.confirmation),
      to_jsonb(new.confirmation), actor_member, actor, channel, reason, reason_note, effect);
  end if;

  return new;
end
$$;

-- ---------------------------------------------------------------------------
-- Rechte
-- ---------------------------------------------------------------------------

grant select, insert, update on guest_token to authenticated;
grant select on scope_permission to authenticated;

alter table guest_token      enable row level security;
alter table scope_permission enable row level security;

create policy scope_permission_read on scope_permission for select to authenticated
  using (true);

-- Ein Gast sieht seine Links nicht — er hat ja einen. Sichtbar sind sie für
-- den, der einladen darf, und der Hash steht dabei bewusst nicht im Weg: Aus
-- ihm lässt sich kein Link bauen.
create policy guest_token_read on guest_token for select to authenticated
  using (mbl.has_perm(project_id, 'member.invite'));

-- Seinen eigenen Link sieht der Gast schon. Ohne diese Zeile bliebe ihm die
-- eigene Ablauffrist verborgen — und die Abstimmungsseite könnte nicht sagen,
-- bis wann der Link gilt und ob sie beim ersten Mal nach dem Namen fragen
-- muss. Der Hash steht darin, aber den Klartext hat er ohnehin in der Hand.
create policy guest_token_own on guest_token for select to authenticated
  using (id = mbl.guest_token_id());

create policy guest_token_create on guest_token for insert to authenticated
  with check (mbl.has_perm(project_id, 'member.invite'));

-- Zurückziehen ist eine Änderung, kein Löschen: Ein Link, der einmal gültig
-- war, hat womöglich etwas bestätigt. Wer ihn entfernt, entfernt die Spur.
create policy guest_token_revoke on guest_token for update to authenticated
  using (mbl.has_perm(project_id, 'member.invite'))
  with check (mbl.has_perm(project_id, 'member.invite'));


-- ===========================================================================
--  Abschnitt: 0013_assistant.sql
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- MeinBaulotse — Frag den Lotsen (Arbeitspaket 7)
--
-- Abschnitt 3.7. Der Assistent steht bewusst **hinter** der Redaktion und nicht
-- davor (Abschnitt 9, Punkt 4): „Er ist ein starkes Verkaufsargument, aber ohne
-- die Wissensschicht darunter halluziniert er."
--
-- Deshalb ist dieses Arbeitspaket vor allem eines: eine Datenschicht für
-- Nachvollziehbarkeit. Drei Spalten tragen sie:
--
--   context_snapshot     — was dem Modell tatsächlich mitgegeben wurde
--   cited_guide_card_ids — auf welchen redaktionellen Karten die Antwort steht
--   guardrails           — welche Leitplanken für diese Frage gegriffen haben
--
-- Ohne die erste lässt sich hinterher nicht sagen, ob eine falsche Antwort auf
-- falschen Daten beruhte oder auf einem falschen Modell. Ohne die zweite ist
-- „laut Lotsenkarte" eine Behauptung. Ohne die dritte weiß niemand, ob der
-- Rechtshinweis stand, weil die Regel griff, oder weil das Modell zufällig
-- höflich war.
--
-- Und eine vierte Spalte, die kein Produktmerkmal ist, sondern eine
-- Betriebsnotwendigkeit: `cost_cents`. Ein Assistent ohne Kostendeckel ist
-- keine Funktion, sondern eine offene Rechnung.
-- ---------------------------------------------------------------------------

create type mbl.assistant_role as enum ('user', 'assistant');

create table assistant_thread (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references project (id) on delete cascade,
  member_id  uuid references project_member (id) on delete set null,
  title      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index assistant_thread_project_idx on assistant_thread (project_id, created_at desc);

create table assistant_message (
  id         uuid primary key default gen_random_uuid(),
  thread_id  uuid not null references assistant_thread (id) on delete cascade,
  -- Redundant zur Unterhaltung, und mit Absicht: Jede Policy und jede
  -- Kostenabfrage will das Bauvorhaben, nicht den Umweg über zwei Verbünde.
  project_id uuid not null references project (id) on delete cascade,
  role       mbl.assistant_role not null,
  content    text not null,

  -- Was dem Modell mitgegeben wurde. Nur bei der Antwort gefüllt.
  context_snapshot     jsonb,
  cited_guide_card_ids uuid[] not null default '{}',
  -- Welche Leitplanken aus Abschnitt 3.7 für diese Frage gegriffen haben.
  guardrails           text[] not null default '{}',

  input_tokens  int,
  output_tokens int,
  -- In Zehntel-Cent, nicht in Cent: Eine einzelne Frage kostet weniger als
  -- einen Cent, und eine Spalte, die auf null rundet, summiert sich zu null.
  cost_millicents int not null default 0,

  created_at timestamptz not null default now()
);
create index assistant_message_thread_idx on assistant_message (thread_id, created_at);
create index assistant_message_cost_idx on assistant_message (project_id, created_at);

create trigger assistant_thread_touch_updated_at
  before update on assistant_thread
  for each row execute function mbl.touch_updated_at();

comment on column assistant_message.context_snapshot is
  'Was dem Modell mitgegeben wurde — der Nachweis für Abschnitt 3.7: „Der '
  'Kontext enthält ausschließlich Daten des eigenen Projekts."';

-- ---------------------------------------------------------------------------
-- Der Kostendeckel
--
-- Je Bauvorhaben und Kalendermonat. Nicht je Nutzer: Ein Bauvorhaben hat einen
-- Bauherrn, und der zahlt — ein Deckel je Beteiligtem wäre ein Deckel, den
-- man durch Einladen umgeht.
-- ---------------------------------------------------------------------------

create or replace function mbl.assistant_spent_millicents(p_project uuid)
returns bigint
language sql
stable
security definer
set search_path = mbl, public
as $$
  select coalesce(sum(cost_millicents), 0)::bigint
    from assistant_message
   where project_id = p_project
     and created_at >= date_trunc('month', now())
$$;

/** Wie viele Fragen dieses Mitglied in der letzten Stunde gestellt hat. */
create or replace function mbl.assistant_asked_last_hour(p_project uuid)
returns int
language sql
stable
security definer
set search_path = mbl, public
as $$
  select count(*)::int
    from assistant_message m
    join assistant_thread t on t.id = m.thread_id
   where m.project_id = p_project
     and m.role = 'user'
     and t.member_id = mbl.current_member_id(p_project)
     and m.created_at >= now() - interval '1 hour'
$$;

-- ---------------------------------------------------------------------------
-- Rechte
--
-- Der Assistent gehört dem, der fragt. Kein Beteiligter liest die Fragen eines
-- anderen — auch der Bauherr nicht die des Baubegleiters. Eine Frage ist oft
-- die ehrlichste Form von „ich weiß gerade nicht weiter", und wer sie mitlesen
-- kann, stellt sie nicht mehr.
-- ---------------------------------------------------------------------------

grant select, insert on assistant_thread   to authenticated;
grant select, insert on assistant_message  to authenticated;
grant update on assistant_thread to authenticated;

alter table assistant_thread  enable row level security;
alter table assistant_message enable row level security;

create policy assistant_thread_read on assistant_thread for select to authenticated
  using (member_id = mbl.current_member_id(project_id));

create policy assistant_thread_create on assistant_thread for insert to authenticated
  with check (
    mbl.is_member(project_id)
    and member_id = mbl.current_member_id(project_id)
  );

create policy assistant_thread_update on assistant_thread for update to authenticated
  using (member_id = mbl.current_member_id(project_id))
  with check (member_id = mbl.current_member_id(project_id));

create policy assistant_message_read on assistant_message for select to authenticated
  using (
    exists (
      select 1 from assistant_thread t
       where t.id = thread_id and t.member_id = mbl.current_member_id(t.project_id)
    )
  );

create policy assistant_message_create on assistant_message for insert to authenticated
  with check (
    exists (
      select 1 from assistant_thread t
       where t.id = thread_id
         and t.project_id = assistant_message.project_id
         and t.member_id = mbl.current_member_id(t.project_id)
    )
  );

-- Kein `update`, kein `delete`. Eine Unterhaltung mit einem Assistenten, die
-- sich nachträglich glätten lässt, taugt als Nachweis nichts — und genau als
-- Nachweis steht sie später in der Bauakte.


-- ===========================================================================
--  Abschnitt: 0014_defects_money.sql
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- MeinBaulotse — Mängel, Geld, Vertragsspiegel (Arbeitspaket 8)
--
-- Drei Themen in einer Migration, weil sie ein einziges sind: Der Satz aus
-- Abschnitt 3.10 verbindet sie.
--
--     „Freigabe erst möglich, wenn alle referenzierten Vorgänge fertig oder
--      abgenommen sind und kein offener Mangel mit Schwere wesentlich daran
--      hängt."
--
-- Das ist die teuerste Zeile der ganzen Spezifikation. Wer eine Rate freigibt,
-- während ein wesentlicher Mangel offen ist, gibt sein stärkstes Druckmittel
-- aus der Hand — und merkt es in dem Moment, in dem er es bräuchte. Genau
-- deshalb steht die Sperre als Trigger in der Datenbank und nicht als
-- Bestätigungsdialog in der Oberfläche.
--
-- Die drei Teile:
--
--   `defect`            — was nicht in Ordnung ist, mit Frist und Eskalation
--   `payment_milestone` — was zu zahlen ist, und woran es hängt
--   `contract_check`    — was am Vertrag auffällt, mit Gesetzesstelle
--
-- Und ein Grundsatz über allen dreien, aus Abschnitt 3.9: **Hinweise, nie
-- Bewertungen.** Die Anwendung sagt, was im Gesetz steht und was im Vertrag
-- steht. Ob das eine gegen das andere spricht, sagt ein Anwalt.
-- ---------------------------------------------------------------------------

create type mbl.defect_severity as enum ('geringfuegig', 'wesentlich');

-- Der Weg eines Mangels. `behoben_gemeldet` ist die Stufe, die man beim
-- Entwerfen vergisst und im Betrieb schmerzlich vermisst: Das Unternehmen sagt
-- „erledigt", der Bauherr hat es noch nicht gesehen. Ohne diesen Zustand steht
-- ein Mangel entweder offen (und das Unternehmen ärgert sich) oder behoben
-- (und niemand hat nachgesehen).
create type mbl.defect_status as enum (
  'offen', 'in_bearbeitung', 'behoben_gemeldet', 'behoben', 'abgelehnt'
);

create type mbl.payment_status as enum (
  'offen', 'faellig', 'freigegeben', 'teilfreigabe', 'bezahlt'
);

create type mbl.change_order_status as enum (
  'angefragt', 'vereinbart', 'abgelehnt', 'abgerechnet'
);

-- ---------------------------------------------------------------------------
-- Mängel
-- ---------------------------------------------------------------------------

create table defect (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid not null references project (id) on delete cascade,
  task_id              uuid references task (id) on delete set null,
  trade_id             uuid references trade (id) on delete set null,
  title                text not null,
  description          text,
  location_text        text,
  -- Die Unterscheidung, an der alles hängt: Nur ein **wesentlicher** Mangel
  -- sperrt eine Zahlung. Bei einem Kratzer in der Fensterbank wäre das
  -- unverhältnismäßig, und eine Anwendung, die es trotzdem täte, würde
  -- umgangen statt benutzt.
  severity             mbl.defect_severity not null default 'geringfuegig',
  reported_at          timestamptz not null default now(),
  reported_by          uuid references project_member (id) on delete set null,
  -- Die Frist zur Beseitigung. Ein Mangel ohne Frist ist eine Beschwerde.
  deadline             date,
  status               mbl.defect_status not null default 'offen',
  -- Was tatsächlich getan wurde, nicht was fällig wäre: 0 gemeldet,
  -- 1 Nachfrist gesetzt, 2 Nachfrist verstrichen und angezeigt,
  -- 3 Einbehalt oder Rechtsrat. Die *vorgeschlagene* Stufe rechnet die
  -- Anwendung aus der Frist; hier steht, wo der Bauherr wirklich steht.
  escalation_level     int not null default 0,
  resolved_at          timestamptz,
  accepted_at          timestamptz,
  -- Bei der Abnahme vorbehalten (§ 640 Abs. 3 BGB). Ohne Vorbehalt verliert
  -- der Bauherr Rechte an einem Mangel, den er kannte.
  reserved_at_handover boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint defect_escalation_range check (escalation_level between 0 and 3),
  constraint defect_resolved_needs_time
    check (status <> 'behoben' or resolved_at is not null)
);

create index defect_project_idx on defect (project_id, status);
create index defect_task_idx on defect (task_id) where task_id is not null;
create index defect_open_idx on defect (project_id, severity)
  where status in ('offen', 'in_bearbeitung', 'behoben_gemeldet');

create trigger defect_touch_updated_at
  before update on defect
  for each row execute function mbl.touch_updated_at();

-- „Behoben" trägt seinen Zeitpunkt selbst — dieselbe Überlegung wie bei
-- `decision.decided_at`: Der Zeitpunkt ist die halbe Aussage. „Behoben"
-- beantwortet nicht, ob es innerhalb der Frist war.
create or replace function mbl.stamp_defect_resolved()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'behoben' and new.resolved_at is null then
    new.resolved_at := now();
  elsif tg_op = 'UPDATE' and old.status = 'behoben' and new.status <> 'behoben' then
    new.resolved_at := null;
  end if;
  return new;
end
$$;

create trigger defect_stamp_resolved
  before insert or update on defect
  for each row execute function mbl.stamp_defect_resolved();

/**
 * Ein Mangel gilt als offen, solange ihn nicht der Bauherr abgehakt hat.
 *
 * „Behoben gemeldet" zählt ausdrücklich als offen. Sonst könnte das
 * ausführende Unternehmen die Zahlungssperre selbst aufheben, indem es
 * „erledigt" sagt — und genau davor schützt sie.
 */
create or replace function mbl.defect_is_open(p_status mbl.defect_status)
returns boolean
language sql
immutable
as $$
  select p_status in ('offen', 'in_bearbeitung', 'behoben_gemeldet')
$$;

-- Ein Mangel ohne Foto ist eine Behauptung. Die Spalte stand schon im
-- Datenmodell aus Abschnitt 4, konnte in 0010 aber noch nicht angelegt werden —
-- da gab es die Tabelle `defect` nicht.
alter table media add column defect_id uuid references defect (id) on delete set null;
create index media_defect_idx on media (defect_id) where defect_id is not null;

-- ---------------------------------------------------------------------------
-- Nachträge
-- ---------------------------------------------------------------------------

create table change_order (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references project (id) on delete cascade,
  title            text not null,
  -- Wer ihn ausgelöst hat: bauherr | unternehmen | behoerde | baugrund | sonstiges
  trigger_source   text,
  -- Auf welcher Grundlage: § 650b BGB (Anordnungsrecht), § 650c (Vergütung),
  -- freie Vereinbarung. Als Text, nicht als Aufzählung — die Grundlagen sind
  -- vielfältiger, als eine Liste sie fassen kann.
  bgb_basis        text,
  amount_cents     bigint not null default 0,
  days_impact      int not null default 0,
  affected_task_ids uuid[] not null default '{}',
  status           mbl.change_order_status not null default 'angefragt',
  requested_at     date,
  agreed_at        date,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index change_order_project_idx on change_order (project_id, status);

create trigger change_order_touch_updated_at
  before update on change_order
  for each row execute function mbl.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Zahlungen
-- ---------------------------------------------------------------------------

create table payment_milestone (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references project (id) on delete cascade,
  name             text not null,
  trigger_text     text,
  pct              numeric(5,2),
  amount_cents     bigint not null default 0,
  -- Die Vorgänge, an denen diese Rate hängt. Ohne sie ist eine Rate ein
  -- Datum im Kalender; mit ihnen ist sie an den Bau gekoppelt.
  requires_task_ids uuid[] not null default '{}',
  -- Der Einbehalt am Ende ist keine Rate, sondern ihr Gegenteil: Er wird nicht
  -- gezahlt, sondern zurückgehalten (§ 650m Abs. 2 BGB).
  is_retention     boolean not null default false,
  sort_order       int not null default 0,

  invoice_number   text,
  invoice_date     date,
  due_date         date,
  status           mbl.payment_status not null default 'offen',
  released_by      uuid references project_member (id) on delete set null,
  released_at      timestamptz,
  paid_at          date,
  withheld_cents   bigint not null default 0,
  withheld_reason  text,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint payment_amount_nonneg check (amount_cents >= 0),
  constraint payment_withheld_nonneg check (withheld_cents >= 0),
  constraint payment_withheld_le_amount check (withheld_cents <= amount_cents),
  -- Eine Teilfreigabe ohne Einbehalt ist eine Freigabe, und eine ohne Grund
  -- ist in einem halben Jahr nicht mehr erklärbar.
  constraint payment_partial_needs_reason
    check (status <> 'teilfreigabe' or (withheld_cents > 0 and coalesce(withheld_reason,'') <> ''))
);

create index payment_project_idx on payment_milestone (project_id, sort_order);

create trigger payment_touch_updated_at
  before update on payment_milestone
  for each row execute function mbl.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Die Sperre
--
-- Die teuerste Zeile der Spezifikation, als Trigger. Sie steht hier und nicht
-- in der Oberfläche, weil eine Sperre, die man mit einem zweiten Klick
-- übergehen kann, keine ist — und weil dieselbe Prüfung sonst an drei Stellen
-- stünde und an einer davon veralten würde.
--
-- Was sie prüft, ist Abschnitt 3.10 Wort für Wort:
--   1. alle referenzierten Vorgänge `fertig` oder `abgenommen`
--   2. kein offener Mangel mit Schwere `wesentlich` daran
--
-- Was sie **nicht** verhindert, ist die Teilfreigabe unter Vorbehalt. Der
-- Bauherr soll zahlen können, was unstrittig ist — er will sein Haus fertig
-- haben, nicht recht behalten. Nur muss der Einbehalt dann beziffert und
-- begründet sein, sonst ist er in einem halben Jahr nicht mehr erklärbar.
-- ---------------------------------------------------------------------------

create or replace function mbl.payment_blockers(p_payment uuid)
returns table (kind text, label text)
language sql
stable
security definer
set search_path = mbl, public
as $$
  with rate as (select * from payment_milestone where id = p_payment)
  select 'task'::text, t.name
    from rate, task t
   where t.id = any(rate.requires_task_ids)
     and t.status not in ('fertig', 'abgenommen')
  union all
  select 'defect'::text, d.title
    from rate, defect d
   where d.project_id = rate.project_id
     and d.severity = 'wesentlich'
     and mbl.defect_is_open(d.status)
     and (d.task_id is null or d.task_id = any(rate.requires_task_ids))
$$;
comment on function mbl.payment_blockers(uuid) is
  'Was einer vollen Freigabe im Weg steht — als Liste, nicht als Ja/Nein. Die '
  'Oberfläche soll sagen können, *was* fehlt (Abschnitt 3.10).';

create or replace function mbl.guard_payment_release()
returns trigger
language plpgsql
security definer
set search_path = mbl, public
as $$
declare
  hindernis record;
begin
  if new.status is not distinct from old.status or new.status <> 'freigegeben' then
    return new;
  end if;

  select * into hindernis from mbl.payment_blockers(new.id) limit 1;
  if found then
    raise exception
      'Diese Rate lässt sich noch nicht freigeben: %. Was du stattdessen tun kannst: einen Teil freigeben und den Rest mit Begründung einbehalten.',
      hindernis.label
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;

create trigger payment_guard_release
  before update on payment_milestone
  for each row execute function mbl.guard_payment_release();

-- Freigeben stempelt sich selbst. Ein „freigegeben" ohne Zeitpunkt und ohne
-- Namen ist in einer Bauakte wertlos.
create or replace function mbl.stamp_payment_release()
returns trigger
language plpgsql
security definer
set search_path = mbl, public
as $$
begin
  if new.status in ('freigegeben', 'teilfreigabe')
     and (old.status is null or old.status not in ('freigegeben', 'teilfreigabe')) then
    new.released_at := coalesce(new.released_at, now());
    new.released_by := coalesce(new.released_by, mbl.current_member_id(new.project_id));
  elsif new.status not in ('freigegeben', 'teilfreigabe', 'bezahlt') then
    new.released_at := null;
    new.released_by := null;
  end if;
  return new;
end
$$;

create trigger payment_stamp_release
  before update on payment_milestone
  for each row execute function mbl.stamp_payment_release();

-- ---------------------------------------------------------------------------
-- Zahlungsplan-Vorlage (Abschnitt 7.5), als Daten statt als Konstanten
-- ---------------------------------------------------------------------------

create table payment_template (
  key               text primary key,
  name              text not null,
  trigger_text      text not null,
  /** Vorlagen-Vorgangscode aus 7.2, an den die Rate hängt. */
  task_code         text,
  pct               numeric(5,2) not null,
  is_retention      boolean not null default false,
  sort_order        int not null,
  created_at        timestamptz not null default now()
);
comment on table payment_template is
  'Die Zahlungsplan-Vorlage aus Abschnitt 7.5. Summiert bewusst auf 90 % '
  'Abschläge plus 5 % Einbehalt — genau die Grenze aus § 650m BGB.';

insert into payment_template (key, name, trigger_text, task_code, pct, is_retention, sort_order)
values
  ('rate1', '1. Rate',  'Vertragsschluss, Baufreigabe',    't03', 10.00, false, 10),
  ('rate2', '2. Rate',  'Kellergeschoss fertig',           't11', 15.00, false, 20),
  ('rate3', '3. Rate',  'Rohbau fertig',                   't15', 20.00, false, 30),
  ('rate4', '4. Rate',  'Gebäude dicht',                   't19', 15.00, false, 40),
  ('rate5', '5. Rate',  'Rohinstallationen fertig',        't23', 10.00, false, 50),
  ('rate6', '6. Rate',  'Innenputz und Estrich fertig',    't26', 10.00, false, 60),
  ('rate7', '7. Rate',  'Fliesen und Maler fertig',        't30', 10.00, false, 70),
  ('rate8', '8. Rate',  'Abnahme',                         't37',  5.00, false, 80),
  ('einbehalt', 'Einbehalt Sicherheit',
   'Sicherheit für rechtzeitige Herstellung ohne wesentliche Mängel', null, 5.00, true, 90);

-- ---------------------------------------------------------------------------
-- Finanzierung und Bereitstellungszinsen
-- ---------------------------------------------------------------------------

create table financing (
  project_id             uuid primary key references project (id) on delete cascade,
  loan_amount_cents      bigint,
  own_funds_cents        bigint,
  /** Bereitstellungszins in Basispunkten je Jahr. 300 = 3,00 % p. a. */
  commitment_rate_bp     int,
  /** Bereitstellungsfreie Zeit in Monaten ab Darlehenszusage. */
  commitment_free_months int,
  loan_granted_on        date,
  bank_name              text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint financing_rate_range check (commitment_rate_bp is null or commitment_rate_bp between 0 and 2000)
);

create trigger financing_touch_updated_at
  before update on financing
  for each row execute function mbl.touch_updated_at();

create table loan_drawdown (
  id                        uuid primary key default gen_random_uuid(),
  project_id                uuid not null references project (id) on delete cascade,
  amount_cents              bigint not null,
  requested_at              date not null,
  paid_at                   date,
  /** Errechnet, nicht eingegeben — siehe `packages/schedule/src/interest.ts`. */
  commitment_interest_cents bigint,
  note                      text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint loan_drawdown_amount_positive check (amount_cents > 0)
);
create index loan_drawdown_project_idx on loan_drawdown (project_id, requested_at);

create trigger loan_drawdown_touch_updated_at
  before update on loan_drawdown
  for each row execute function mbl.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Vertragsspiegel
--
-- Abschnitt 3.9: „Automatische **Hinweise**, nie Bewertungen." Der Unterschied
-- ist nicht sprachlich. „Der Zahlungsplan summiert sich auf 95 %, § 650m Abs. 1
-- BGB begrenzt auf 90 %" ist eine Auskunft. „Dein Vertrag ist unwirksam" wäre
-- eine Rechtsberatung, und die darf hier niemand geben.
--
-- Gespeichert werden die Befunde, nicht nur die Regeln: Der Vertragsspiegel
-- gehört später in die Bauakte, und dort zählt, was zum damaligen Zeitpunkt
-- auffiel — nicht, was eine spätere Fassung der Prüfregeln gefunden hätte.
-- ---------------------------------------------------------------------------

create table contract_check (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references project (id) on delete cascade,
  rule_key         text not null,
  severity         text not null default 'hinweis',
  message          text not null,
  legal_reference  text,
  dismissed_at     timestamptz,
  dismissed_reason text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint contract_check_severity_values check (severity in ('hinweis', 'warnung'))
);
create unique index contract_check_rule_key on contract_check (project_id, rule_key);

create trigger contract_check_touch_updated_at
  before update on contract_check
  for each row execute function mbl.touch_updated_at();

-- Vertragsdaten, die es bisher nicht gab. `contract_sum_cents` und
-- `security_pct` stehen seit 0001 auf `project`; alles Weitere kommt hier dazu.
alter table project
  add column contract_signed_on   date,
  add column build_duration_days  int,
  add column building_description_complete boolean;

comment on column project.build_duration_days is
  'Bauzeit in Kalendertagen, falls der Vertrag keine Frist, sondern eine Dauer '
  'nennt. § 650k Abs. 3 BGB verlangt eines von beidem.';
comment on column project.building_description_complete is
  'Ob die Baubeschreibung die Punkte aus Art. 249 EGBGB enthält. Vom Bauherrn '
  'bestätigt, nicht von uns geprüft — wir haben den Vertrag nicht.';

-- ---------------------------------------------------------------------------
-- Rechte
-- ---------------------------------------------------------------------------

grant select on payment_template to authenticated;
grant select, insert, update on defect            to authenticated;
grant select, insert, update, delete on change_order      to authenticated;
grant select, insert, update on payment_milestone to authenticated;
grant select, insert, update on financing         to authenticated;
grant select, insert, update, delete on loan_drawdown     to authenticated;
grant select, insert, update on contract_check    to authenticated;

alter table payment_template  enable row level security;
alter table defect            enable row level security;
alter table change_order      enable row level security;
alter table payment_milestone enable row level security;
alter table financing         enable row level security;
alter table loan_drawdown     enable row level security;
alter table contract_check    enable row level security;

create policy payment_template_read on payment_template for select to authenticated
  using (true);

-- Mängel: lesen darf jedes Mitglied (ein Gewerk nur seine eigenen), erfassen
-- Bauherr und Baubegleiter, auf „behoben" setzen nur der Bauherr. Das
-- ausführende Unternehmen meldet „behoben_gemeldet" — den Haken setzt der,
-- der es nachgesehen hat.
create policy defect_read on defect for select to authenticated
  using (mbl.is_member(project_id) and mbl.trade_scope_ok(project_id, trade_id));

create policy defect_create on defect for insert to authenticated
  with check (mbl.has_perm(project_id, 'defect.write'));

create policy defect_update on defect for update to authenticated
  using (
    mbl.has_perm(project_id, 'defect.resolve')
    or (mbl.has_perm(project_id, 'defect.resolve.propose')
        and mbl.trade_scope_ok(project_id, trade_id))
  )
  with check (
    mbl.has_perm(project_id, 'defect.resolve')
    or (mbl.has_perm(project_id, 'defect.resolve.propose')
        and mbl.trade_scope_ok(project_id, trade_id))
  );

-- Nur der Bauherr darf einen Mangel endgültig abhaken. Wer ihn beheben soll,
-- soll nicht selbst entscheiden, dass er behoben ist.
create or replace function mbl.guard_defect_resolution()
returns trigger
language plpgsql
security definer
set search_path = mbl, public
as $$
begin
  if new.status in ('behoben', 'abgelehnt')
     and old.status is distinct from new.status
     and not mbl.has_perm(new.project_id, 'defect.resolve') then
    raise exception
      'Ob ein Mangel behoben ist, entscheidet der Bauherr. Melde ihn als behoben — dann sieht er nach.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;

create trigger defect_guard_resolution
  before update on defect
  for each row execute function mbl.guard_defect_resolution();

create policy change_order_read on change_order for select to authenticated
  using (mbl.is_member(project_id));
create policy change_order_write on change_order for insert to authenticated
  with check (mbl.has_perm(project_id, 'contract.write'));
create policy change_order_update on change_order for update to authenticated
  using (mbl.has_perm(project_id, 'contract.write'))
  with check (mbl.has_perm(project_id, 'contract.write'));
create policy change_order_delete on change_order for delete to authenticated
  using (mbl.has_perm(project_id, 'contract.write'));

-- Geld liest, wer im Bauvorhaben ist — der Zahlungsplan steht ohnehin im
-- Vertrag. Freigeben darf nur der Bauherr (Rechtematrix 2.2).
create policy payment_read on payment_milestone for select to authenticated
  using (mbl.is_member(project_id));
create policy payment_write on payment_milestone for insert to authenticated
  with check (mbl.has_perm(project_id, 'contract.write'));
create policy payment_update on payment_milestone for update to authenticated
  using (mbl.has_perm(project_id, 'payment.release'))
  with check (mbl.has_perm(project_id, 'payment.release'));

-- Die Finanzierung ist die private Seite des Bauens. Sie liest, wer den
-- Vertrag pflegen darf — nicht das ausführende Unternehmen und kein Gewerk.
create policy financing_read on financing for select to authenticated
  using (mbl.has_perm(project_id, 'contract.write'));
create policy financing_write on financing for insert to authenticated
  with check (mbl.has_perm(project_id, 'contract.write'));
create policy financing_update on financing for update to authenticated
  using (mbl.has_perm(project_id, 'contract.write'))
  with check (mbl.has_perm(project_id, 'contract.write'));

create policy loan_read on loan_drawdown for select to authenticated
  using (mbl.has_perm(project_id, 'contract.write'));
create policy loan_write on loan_drawdown for insert to authenticated
  with check (mbl.has_perm(project_id, 'contract.write'));
create policy loan_update on loan_drawdown for update to authenticated
  using (mbl.has_perm(project_id, 'contract.write'))
  with check (mbl.has_perm(project_id, 'contract.write'));
create policy loan_delete on loan_drawdown for delete to authenticated
  using (mbl.has_perm(project_id, 'contract.write'));

create policy contract_check_read on contract_check for select to authenticated
  using (mbl.is_member(project_id));
create policy contract_check_write on contract_check for insert to authenticated
  with check (mbl.has_perm(project_id, 'contract.write'));
create policy contract_check_update on contract_check for update to authenticated
  using (mbl.has_perm(project_id, 'contract.write'))
  with check (mbl.has_perm(project_id, 'contract.write'));

