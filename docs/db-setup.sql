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
--      (select count(*) from plan_template_task) as vorlagenvorgaenge;  -- 38
--
--    select count(*) filter (where rowsecurity) as mit_rls,
--           count(*)                            as tabellen
--    from pg_tables where schemaname = 'public';                -- 14 von 14
--
--  Die zweite Abfrage ist die wichtigere: Die Zählung oben stimmt auch
--  dann, wenn die Rechte nur zur Hälfte angekommen sind.
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

