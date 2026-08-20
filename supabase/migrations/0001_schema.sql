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
