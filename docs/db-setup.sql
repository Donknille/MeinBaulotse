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

