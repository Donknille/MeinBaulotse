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
--      (select count(*) from guide_card)         as lotsenkarten,      -- 12
--      (select count(*) from decision_template)  as entscheidungen;    -- 14
--
--    select count(*) filter (where rowsecurity) as mit_rls,
--           count(*)                            as tabellen
--    from pg_tables where schemaname = 'public';                -- 23 von 23
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
--  Abschnitt: 0005_guide_cards.sql
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- MeinBaulotse — Wissensschicht (Arbeitspaket 2)
--
-- Die Lotsenkarte aus Abschnitt 3.1 der Spezifikation: zu jedem Vorgang, der
-- in den Blick rückt, steht da, was gerade passiert, worauf der Bauherr selbst
-- achten kann, was er den GU fragen sollte und was hier typischerweise
-- schiefgeht.
--
-- Drei Entscheidungen, die den Aufbau erklären:
--
-- 1. **Karten sind global, nicht projekteigen.** Redaktionsinhalt gilt für
--    jeden Bau gleich. Projektbezogen ist nur, was der Nutzer damit tut —
--    gelesen (`guide_card_read`) und abgehakt (`checklist_item`).
--
-- 2. **Veröffentlicht heißt unveränderlich** (Invariante 4.1.6). Eine Karte,
--    die sich nachträglich ändern lässt, macht die Frage „welchen Rat hat der
--    Bauherr damals bekommen" unbeantwortbar — und genau diese Frage stellt
--    sich, wenn es später Streit gibt. Änderungen erzeugen eine neue Version;
--    die alte zeigt über `superseded_by` auf sie.
--
-- 3. **Die Zuordnung läuft über den Vorlagencode**, nicht über eine feste
--    Fremdschlüsselspalte am Vorgang. `task.guide_card_id` würde die Version
--    einfrieren, die beim Anlegen des Projekts galt: Eine überarbeitete Karte
--    erreichte dann niemanden, der schon baut. Über `template_task_codes`
--    findet jeder Vorgang die jeweils **neueste veröffentlichte** Karte.
--    Die Spalte bleibt trotzdem — als ausdrückliche Zuweisung von Hand.
-- ---------------------------------------------------------------------------

create table guide_card (
  id                       uuid primary key default gen_random_uuid(),
  key                      text not null,
  version                  int  not null default 1,
  phase_key                text not null references phase (key),
  trade_code               text,
  build_types              mbl.build_type[] not null
                             default '{efh_massiv,efh_fertighaus,sanierung,sonstiges}',
  template_task_codes      text[] not null default '{}',
  title                    text not null,
  whats_happening          text not null,
  watch_for                jsonb not null default '[]'::jsonb,
  questions_for_contractor jsonb not null default '[]'::jsonb,
  common_problems          jsonb not null default '[]'::jsonb,
  photo_prompts            jsonb not null default '[]'::jsonb,
  expert_recommended       boolean not null default false,
  expert_reason            text,
  sources                  jsonb not null default '[]'::jsonb,
  published_at             timestamptz,
  superseded_by            uuid references guide_card (id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (key, version),
  -- Eine Empfehlung ohne Begründung ist Angstmache. Wer eine Fachprüfung
  -- vorschlägt, sagt auch, wofür sie gut ist.
  constraint guide_card_expert_reason
    check (not expert_recommended or expert_reason is not null),
  constraint guide_card_version_positive check (version > 0),
  constraint guide_card_not_self check (superseded_by is distinct from id)
);
comment on table guide_card is
  'Lotsenkarte nach Abschnitt 3.1. Redaktionsinhalt als Daten, nicht als '
  'Konstanten im Code — pflegbar ohne Deployment. Nach published_at '
  'unveränderlich, siehe Trigger guide_card_immutable.';
comment on column guide_card.template_task_codes is
  'Vorgänge der Ablaufvorlage, für die diese Karte gilt (t01 … t38).';
comment on column guide_card.sources is
  'Herkunft jeder Aussage. Ohne Quelle keine Behauptung — daran hängt die '
  'Glaubwürdigkeit des ganzen Produkts (Abschnitt 6.3).';

create index guide_card_key_idx on guide_card (key, version desc);
create index guide_card_template_idx on guide_card using gin (template_task_codes);
create index guide_card_published_idx on guide_card (published_at) where published_at is not null;

-- Der Vorgang darf eine Karte ausdrücklich zugewiesen bekommen. Der
-- Fremdschlüssel stand in 0001 noch nicht, weil es die Tabelle nicht gab.
alter table task
  add constraint task_guide_card_fk
  foreign key (guide_card_id) references guide_card (id) on delete set null;

-- Was der Nutzer gesehen hat, und ob es ihm geholfen hat -------------------
--
-- „War das hilfreich?" ist laut Abschnitt 5.2 die einzige Metrik, die für die
-- Redaktion zählt. Deshalb steht sie hier und nicht in einem Analysewerkzeug.

create table guide_card_read (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references project (id) on delete cascade,
  guide_card_id uuid not null references guide_card (id) on delete cascade,
  task_id       uuid references task (id) on delete set null,
  member_id     uuid not null references project_member (id) on delete cascade,
  read_at       timestamptz not null default now(),
  helpful       boolean,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (project_id, guide_card_id, member_id)
);
comment on column guide_card_read.helpful is
  'NULL heißt: gelesen, nicht bewertet. Das ist der Normalfall und kein Mangel.';

create index guide_card_read_project_idx on guide_card_read (project_id, member_id);

-- Checkliste zum Vorgang ---------------------------------------------------
--
-- Entsteht aus `watch_for` der Karte, gehört aber dem Projekt: Der Haken ist
-- die Aussage „ich habe nachgesehen", und die überdauert die Kartenversion.

create table checklist_item (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references project (id) on delete cascade,
  task_id       uuid not null references task (id) on delete cascade,
  guide_card_id uuid references guide_card (id) on delete set null,
  text          text not null,
  why           text,
  sort_order    int  not null default 0,
  is_done       boolean not null default false,
  done_at       timestamptz,
  done_by       uuid references project_member (id) on delete set null,
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (task_id, guide_card_id, sort_order)
);
create index checklist_item_project_idx on checklist_item (project_id);
create index checklist_item_task_idx on checklist_item (task_id);

-- updated_at ---------------------------------------------------------------

do $$
declare
  target text;
begin
  foreach target in array array['guide_card','guide_card_read','checklist_item']
  loop
    execute format(
      'create trigger %I before update on %I for each row execute function mbl.touch_updated_at()',
      target || '_touch_updated_at', target
    );
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- Invariante 4.1.6: veröffentlichte Karten sind unveränderlich
--
-- Der Trigger vergleicht die ganze Zeile, nicht einzelne Spalten. Eine Liste
-- von Spaltennamen wäre spätestens bei der nächsten Erweiterung unvollständig,
-- und zwar still — die neue Spalte wäre dann ausgerechnet die änderbare.
--
-- Ausgenommen sind genau zwei Felder: `superseded_by`, denn die Verkettung zur
-- Nachfolgeversion entsteht zwangsläufig **nach** der Veröffentlichung, und
-- `updated_at`, das der Trigger daneben ohnehin setzt.
-- ---------------------------------------------------------------------------

create or replace function mbl.guard_guide_card()
returns trigger
language plpgsql
as $$
declare
  vorher jsonb;
  nachher jsonb;
begin
  if tg_op = 'DELETE' then
    if old.published_at is not null then
      raise exception 'Eine veröffentlichte Lotsenkarte wird nicht gelöscht: % (Fassung %)',
        old.key, old.version
        using errcode = 'raise_exception',
              hint = 'Veröffentliche eine neue Fassung und verkette sie über superseded_by.';
    end if;
    return old;
  end if;

  -- Solange sie unveröffentlicht ist, darf sich alles ändern.
  if old.published_at is null then
    return new;
  end if;

  vorher  := to_jsonb(old) - 'superseded_by' - 'updated_at';
  nachher := to_jsonb(new) - 'superseded_by' - 'updated_at';

  if vorher is distinct from nachher then
    raise exception 'Eine veröffentlichte Lotsenkarte ändert sich nicht: % (Fassung %)',
      old.key, old.version
      using errcode = 'raise_exception',
            hint = 'Sonst lässt sich später nicht mehr sagen, welchen Rat der Bauherr bekommen hat.';
  end if;

  return new;
end
$$;

create trigger guide_card_immutable
  before update or delete on guide_card
  for each row execute function mbl.guard_guide_card();

-- ---------------------------------------------------------------------------
-- Sichtbarkeit eines Vorgangs, für Tabellen, die an einem Vorgang hängen.
--
-- Ein Einzelgewerk sieht seinen eigenen Ausschnitt (Abschnitt 2.2, Zeile
-- „Lesen"). Ohne diese Prüfung sähe es über die Checkliste Vorgänge, die ihm
-- die Policy auf `task` gerade verwehrt.
-- ---------------------------------------------------------------------------

create or replace function mbl.task_visible(p_task uuid)
returns boolean
language sql
stable
security definer
set search_path = mbl, public, auth
as $$
  select exists (
    select 1 from task t
    where t.id = p_task
      and mbl.is_member(t.project_id)
      and mbl.trade_scope_ok(t.project_id, t.trade_id)
  )
$$;

-- Rechte und RLS -----------------------------------------------------------

-- Nur lesen. Redaktionsinhalt kommt über Migrationen herein, nicht über die
-- Anwendung — das ist die zweite Sperre neben dem Trigger.
grant select on guide_card to authenticated;
grant select, insert, update on guide_card_read to authenticated;
grant select, insert, update, delete on checklist_item to authenticated;

alter table guide_card      enable row level security;
alter table guide_card_read enable row level security;
alter table checklist_item  enable row level security;

-- Unveröffentlichte Entwürfe sieht niemand. Es gibt bewusst keine INSERT-,
-- UPDATE- oder DELETE-Policy auf guide_card.
create policy guide_card_read_published on guide_card for select to authenticated
  using (published_at is not null);

create policy guide_card_read_own on guide_card_read for select to authenticated
  using (mbl.is_member(project_id));

create policy guide_card_read_write on guide_card_read for insert to authenticated
  with check (
    mbl.is_member(project_id)
    and member_id = mbl.current_member_id(project_id)
  );

-- Die eigene Rückmeldung darf man ändern; eine fremde nicht.
create policy guide_card_read_update on guide_card_read for update to authenticated
  using (member_id = mbl.current_member_id(project_id))
  with check (member_id = mbl.current_member_id(project_id));

create policy checklist_item_read on checklist_item for select to authenticated
  using (mbl.is_member(project_id) and mbl.task_visible(task_id));

-- Wer abhaken darf, ist derselbe Kreis, der auch ins Tagebuch schreibt: Der
-- Haken ist eine Beobachtung, keine Terminänderung. Einzelgewerke und stille
-- Mitleser gehören nicht dazu.
create policy checklist_item_write on checklist_item for insert to authenticated
  with check (mbl.has_perm(project_id, 'diary.write') and mbl.task_visible(task_id));

create policy checklist_item_update on checklist_item for update to authenticated
  using (mbl.has_perm(project_id, 'diary.write') and mbl.task_visible(task_id))
  with check (mbl.has_perm(project_id, 'diary.write') and mbl.task_visible(task_id));

create policy checklist_item_delete on checklist_item for delete to authenticated
  using (mbl.has_perm(project_id, 'diary.write') and mbl.task_visible(task_id));

-- Nachfassen: Rechte auf die eben angelegten Funktionen in mbl.
grant execute on all functions in schema mbl to anon, authenticated;


-- ===========================================================================
--  Abschnitt: 0006_lotsenkarten.sql
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- MeinBaulotse — Lotsenkarten (erzeugt, nicht von Hand bearbeiten)
--
-- Erzeugt von packages/db/scripts/generate-guide-cards.ts aus:
--   content/lotsenkarten/*.md
--
-- Neu erzeugen: pnpm --filter @meinbaulotse/db guide-cards:generate
--
-- Eine veröffentlichte Karte ist unveränderlich (Invariante 4.1.6). Wer
-- Inhalt ändert, erhöht „fassung" in der Markdown-Datei; dieser Import legt
-- dann eine neue Fassung an und verkettet die alte über superseded_by.
-- Bereits eingespielte Zeilen bleiben unberührt: Jedes insert endet auf
-- „on conflict do nothing", und die Kennungen sind aus Schlüssel und
-- Fassung abgeleitet, nicht gewürfelt.
-- ---------------------------------------------------------------------------

-- Abnahme und Übergabe (abnahme, Fassung 1)
insert into guide_card (
  id, key, version, phase_key, trade_code, template_task_codes, title,
  whats_happening, watch_for, questions_for_contractor, common_problems,
  photo_prompts, expert_recommended, expert_reason, sources, published_at
) values (
  '49121e84-e9a9-5208-b35c-f9f5150134ca', 'abnahme', 1, 'abnahme',
  null, array['t37']::text[], 'Abnahme und Übergabe',
  'Bei der Abnahme erklärst du, dass du das Bauwerk als im Wesentlichen vertragsgemäß entgegennimmst. Ihr geht gemeinsam durch das Haus, alles Auffällige kommt in ein Protokoll, und beide Seiten unterschreiben.

Die Abnahme ist der wichtigste Termin des ganzen Baus, denn an ihm hängen drei Dinge gleichzeitig: die Fälligkeit der Schlusszahlung, der Beginn der Verjährungsfrist für Mängel und die Frage, wer künftig beweisen muss, dass ein Mangel vorliegt. Vor der Abnahme muss der Unternehmer beweisen, dass alles in Ordnung ist; danach musst du beweisen, dass es das nicht ist.

Das sind Hinweise auf Gesetzesstellen, keine Rechtsberatung.',
  '[{"text":"Nimm dir Zeit und geh nicht unter Termindruck durch das Haus","why":"eine Abnahme lässt sich nicht zurücknehmen"},{"text":"Jeder festgestellte Mangel kommt ins Protokoll, auch der kleine","why":"was nicht im Protokoll steht, musst du später selbst beweisen"},{"text":"Vorbehalt für Vertragsstrafe ausdrücklich erklären, falls eine vereinbart ist und der Termin überschritten wurde","why":"ohne Vorbehalt bei der Abnahme entfällt sie"},{"text":"Lass dir alle Unterlagen übergeben: Protokolle, Bedienungsanleitungen, Wartungshinweise, Bestandspläne, Nachweise zu Erdung, Dichtheit und Estrich","why":"sie sind später kaum noch zu beschaffen"},{"text":"Zähler ablesen und im Protokoll festhalten","why":"Strom, Wasser und Gas wechseln an diesem Tag den Verantwortlichen"}]'::jsonb,
  '[{"question":"Welche Unterlagen bekomme ich bei der Übergabe, und wann?","whyItMatters":"die Sammlung gehört zur Leistung und ist der Grundstock deiner Bauakte"},{"question":"Wie und bis wann werden die protokollierten Mängel beseitigt?","whyItMatters":"mit Datum im Protokoll, nicht als Absichtserklärung"},{"question":"Welche Restarbeiten sind noch offen, und was davon ist ein Mangel?","whyItMatters":"beides wird gern vermischt und hat verschiedene Folgen"},{"question":"Welche Wartungsarbeiten sind in welchem Rhythmus nötig, damit Gewährleistungsansprüche bestehen bleiben?","whyItMatters":"bei Heizung und Lüftung ist das regelmäßig eine Bedingung"}]'::jsonb,
  '[{"problem":"Die Abnahme wird zwischen Tür und Angel gemacht","howToSpot":"Mängel fallen erst beim Einzug auf und stehen dann in keinem Protokoll"},{"problem":"Es wird abgenommen, obwohl wesentliche Mängel offen sind","howToSpot":"die Beweislast dreht sich um, und die Schlusszahlung wird fällig"},{"problem":"Der Vorbehalt für die Vertragsstrafe fehlt","howToSpot":"der Anspruch ist weg, obwohl der Verzug unstrittig war"},{"problem":"Unterlagen werden nachgereicht und kommen nie","howToSpot":"ohne sie fehlen dir bei jedem späteren Schaden die Nachweise"}]'::jsonb,
  '[{"what":"Jeden Raum im Zustand der Abnahme, vollständig und mit Datum","why":"der Zustand ist danach nicht mehr rekonstruierbar"},{"what":"Jeden einzelnen im Protokoll genannten Mangel","why":"das Foto neben der Protokollzeile erspart später jede Diskussion darüber, was gemeint war"},{"what":"Alle Zählerstände","why":"sie sind der Stichtag für die Abrechnung"}]'::jsonb,
  true, 'Dies ist der Termin, an dem sich die Beweislast umkehrt und die Schlusszahlung fällig wird. Ein Sachverständiger sieht in zwei Stunden Dinge, die ein Laie nicht sehen kann, und ein Mangel, der ins Abnahmeprotokoll kommt, kostet dich nichts — derselbe Mangel drei Jahre später kostet ein Gutachten und Nerven. Baubegleiter setzen hier ihren letzten und wichtigsten Termin.',
  '[{"reference":"§ 640 BGB","note":"Abnahme, mit den Folgen der Abnahme und der Verweigerung wegen wesentlicher Mängel"},{"reference":"§ 650g BGB","note":"Zustandsfeststellung bei verweigerter Abnahme sowie Anforderungen an die Schlussrechnung"},{"reference":"§ 634a Absatz 1 Nummer 2 BGB","note":"Verjährung der Mängelansprüche bei Bauwerken in fünf Jahren ab Abnahme"},{"reference":"§ 650m BGB","note":"Abschlagszahlungen und Sicherheit beim Verbraucherbauvertrag"}]'::jsonb,
  now()
)
on conflict (id) do nothing;

-- Blower-Door-Vorabtest (blower-door, Fassung 1)
insert into guide_card (
  id, key, version, phase_key, trade_code, template_task_codes, title,
  whats_happening, watch_for, questions_for_contractor, common_problems,
  photo_prompts, expert_recommended, expert_reason, sources, published_at
) values (
  '8c03d351-7f47-5b8e-9c51-0cead040e2c0', 'blower-door', 1, 'rohinstallation',
  'pruefer', array['t23']::text[], 'Blower-Door-Vorabtest',
  'Ein Ventilator wird luftdicht in die Haustür eingebaut und erzeugt im Haus Unter- und Überdruck. Aus der Luftmenge, die dabei nachströmt, ergibt sich, wie dicht die Gebäudehülle ist.

Entscheidend ist das Wort Vorabtest: Er findet statt, solange die undichten Stellen noch zugänglich sind. Der Test am fertigen Haus liefert nur noch eine Zahl, keine Möglichkeit zur Nachbesserung mehr.',
  '[{"text":"Der Test findet vor Innenputz und Trockenbeplankung statt","why":"danach ist eine Leckage eine Baustelle und keine Nacharbeit"},{"text":"Geh während des Unterdrucks selbst durchs Haus und halte die Hand an Fensterlaibungen, Steckdosen, Rollladenkästen und Dachanschlüsse","why":"undichte Stellen spürst du deutlich"},{"text":"Der Prüfer erstellt eine Leckageliste, nicht nur einen Messwert","why":"die Liste ist der eigentliche Nutzen dieses Termins"},{"text":"Die gefundenen Stellen werden nachgearbeitet und danach erneut geprüft","why":"ohne Nachprüfung bleibt offen, ob es genutzt hat"},{"text":"Der Messwert wird zusammen mit dem gemessenen Gebäudevolumen dokumentiert","why":"die Zahl allein ist ohne Bezugsgröße nicht nachvollziehbar"}]'::jsonb,
  '[{"question":"Ist der Vorabtest im Vertrag enthalten, oder nur der Nachweis am fertigen Haus?","whyItMatters":"beides sind verschiedene Leistungen mit verschiedenem Zweck"},{"question":"Welchen Wert schulden wir nach dem Wärmeschutznachweis?","whyItMatters":"bei Lüftungsanlagen und Förderprogrammen gelten strengere Werte als der Regelfall"},{"question":"Wer arbeitet die Leckagen nach, und wann wird nachgemessen?","whyItMatters":"sonst bleibt die Liste ein Papier"},{"question":"Bekomme ich das Messprotokoll mit Leckageliste und Fotos?","whyItMatters":"das Protokoll gehört in die Bauakte und wird bei Förderungen verlangt"}]'::jsonb,
  '[{"problem":"Der Test wird erst am fertigen Haus gemacht","howToSpot":"der Wert stimmt vielleicht, aber gefundene Leckagen lassen sich nicht mehr wirtschaftlich beheben"},{"problem":"Typische Fundstellen bleiben unbearbeitet: Fensteranschlüsse, Rollladenkästen, Leitungsdurchführungen zum Dach, Übergang Mauerwerk zu Dachanschluss","howToSpot":"sie tauchen in jeder zweiten Leckageliste auf"},{"problem":"Der Test wird bei offenen Innentüren oder unverschlossenen Lüftungsöffnungen gefahren","howToSpot":"dann misst er etwas anderes als die Hülle"},{"problem":"Es gibt keine Nachmessung","howToSpot":"niemand kann sagen, ob die Nacharbeit gewirkt hat"}]'::jsonb,
  '[{"what":"Die Anzeige des Messgeräts mit dem Ergebnis","why":"sie gehört zusammen mit dem Protokoll in die Bauakte"},{"what":"Jede gefundene Leckagestelle vor der Nacharbeit","why":"danach sieht man ihr nichts mehr an"},{"what":"Dieselben Stellen nach der Nacharbeit","why":"das ist der Beleg, dass etwas passiert ist"}]'::jsonb,
  true, 'Der Test selbst wird von einem Prüfer durchgeführt — das ist bereits die Fachprüfung, und sie ist genau dann etwas wert, wenn sie früh stattfindet. Undichtheiten in der Hülle kosten dauerhaft Heizenergie und führen an kalten Stellen zu Feuchte im Bauteil. Beides ist am fertigen Haus nicht mehr korrigierbar.',
  '[{"reference":"DIN EN ISO 9972","note":"Bestimmung der Luftdurchlässigkeit von Gebäuden, Differenzdruckverfahren"},{"reference":"§ 26 Gebäudeenergiegesetz zusammen mit Anlage 4","note":"Anforderungen an die Dichtheit der Gebäudehülle"},{"reference":"DIN 4108-7","note":"Luftdichtheit von Gebäuden, mit den typischen Anschlussdetails"}]'::jsonb,
  now()
)
on conflict (id) do nothing;

-- Bodenplatte und Fundamenterder (bodenplatte, Fassung 1)
insert into guide_card (
  id, key, version, phase_key, trade_code, template_task_codes, title,
  whats_happening, watch_for, questions_for_contractor, common_problems,
  photo_prompts, expert_recommended, expert_reason, sources, published_at
) values (
  '0c31ed14-fc50-5070-b2d5-67b1de769b96', 'bodenplatte', 1, 'gruendung',
  'rohbau', array['t05', 't06']::text[], 'Bodenplatte und Fundamenterder',
  'Auf die Baugrubensohle kommt eine dünne Schicht Magerbeton, die Sauberkeitsschicht. Darauf werden der Fundamenterder — ein Ring aus Bandstahl, der später das ganze Haus erdet — sowie Bewehrung und Leerrohre verlegt. Dann wird die Bodenplatte betoniert.

Dieser Tag ist besonders: Alles, was hier eingebaut wird, liegt danach unter Beton. Korrigieren heißt ab dem nächsten Morgen aufstemmen.',
  '[{"text":"Die Anschlussfahnen des Fundamenterders stehen sichtbar heraus","why":"an den Ring im Beton kommt später niemand mehr heran"},{"text":"Die Bewehrung liegt auf Abstandhaltern, nicht auf der Sauberkeitsschicht","why":"liegt sie unten auf, fehlt ihr die Betondeckung und sie rostet von innen"},{"text":"Leerrohre und Durchführungen für Wasser, Abwasser und Strom stehen dort, wo sie im Plan stehen","why":"jede spätere Durchführung ist eine Kernbohrung durch ein fertiges Bauteil"},{"text":"Der Beton wird verdichtet und nicht nur eingefüllt","why":"unverdichteter Beton bildet Hohlstellen, die man erst beim Freilegen des Randes sieht"},{"text":"Bei Sonne, Wind oder Frost wird der frische Beton abgedeckt oder feucht gehalten","why":"Beton, der zu schnell austrocknet, reißt an der Oberfläche"}]'::jsonb,
  '[{"question":"Wo genau liegen die Anschlussfahnen des Fundamenterders?","whyItMatters":"ihre Lage bestimmt, wo Elektriker und später ein Blitzschutz anschließen können"},{"question":"Bekomme ich das Protokoll zum Fundamenterder nach DIN 18014?","whyItMatters":"die Dokumentation ist vorgeschrieben, und der Netzbetreiber fragt beim Hausanschluss danach"},{"question":"Welche Betongüte und welche Expositionsklasse verlangt die Statik, und was steht auf dem Lieferschein?","whyItMatters":"beides muss zusammenpassen, und der Lieferschein ist der einzige Beleg"},{"question":"Wie lange bleibt die Platte geschützt, bevor darauf gemauert wird?","whyItMatters":"die Aushärtung steht als eigener Vorgang in deinem Plan und ist keine Pufferzeit"}]'::jsonb,
  '[{"problem":"Der Fundamenterder fehlt oder ist nur teilweise verlegt","howToSpot":"es fehlen die Anschlussfahnen, und es fällt erst auf, wenn der Elektriker den Hausanschluss anmeldet"},{"problem":"Zu geringe Betondeckung der Bewehrung","howToSpot":"an der Untersicht zeigen sich später Rostfahnen, oft erst nach Jahren"},{"problem":"Durchführungen sitzen an der falschen Stelle","howToSpot":"es wird nachgebohrt, und jede Bohrung ist eine neue Schwachstelle in der Abdichtung"},{"problem":"Die Platte ist unebener als zulässig","howToSpot":"das fällt erst beim Estrich auf, und dann zahlt jemand den Ausgleich"}]'::jsonb,
  '[{"what":"Der fertig verlegte Fundamenterder mit allen Anschlussfahnen, vor dem Betonieren","why":"danach liegt der Ring für immer im Beton"},{"what":"Die Bewehrung auf ihren Abstandhaltern","why":"das ist der einzige Moment, in dem sich die Lage überhaupt belegen lässt"},{"what":"Alle Leerrohre und Durchführungen, mit einem Zollstock im Bild","why":"die Maße brauchst du beim Ausbau wieder"}]'::jsonb,
  true, 'Was hier falsch liegt, lässt sich nach dem Betonieren nicht mehr korrigieren, sondern nur noch reparieren. Erdung, Bewehrungslage und Durchführungen sind an genau einem Tag prüfbar, und dieser Tag liegt vor dem Betonieren. Baubegleiter setzen ihren ersten Termin üblicherweise genau hier.',
  '[{"reference":"DIN 18014","note":"Fundamenterder: Planung, Ausführung und Dokumentation"},{"reference":"DIN EN 13670 zusammen mit DIN 1045-3","note":"Ausführung von Tragwerken aus Beton, darunter Betondeckung, Verdichtung und Nachbehandlung"},{"reference":"DIN 18202","note":"Toleranzen im Hochbau, Ebenheit von Rohdecken"},{"reference":"VOB/C ATV DIN 18331","note":"Betonarbeiten, sofern die VOB/B vereinbart ist"}]'::jsonb,
  now()
)
on conflict (id) do nothing;

-- Dachstuhl, Eindeckung und Klempnerarbeiten (dachstuhl, Fassung 1)
insert into guide_card (
  id, key, version, phase_key, trade_code, template_task_codes, title,
  whats_happening, watch_for, questions_for_contractor, common_problems,
  photo_prompts, expert_recommended, expert_reason, sources, published_at
) values (
  'bb659d72-a79d-5b4f-bd25-c5ff50e1f8cf', 'dachstuhl', 1, 'dach_huelle',
  'zimmerer', array['t16', 't17']::text[], 'Dachstuhl, Eindeckung und Klempnerarbeiten',
  'Der Zimmerer stellt den Dachstuhl auf, danach deckt der Dachdecker das Dach ein und der Klempner baut Rinnen, Fallrohre und die Anschlüsse an Kamin und Durchdringungen ein. Zwischen beiden Schritten liegt die Unterdeckung — die wasserführende Schicht unter den Ziegeln.

Mit dem letzten Ziegel ist das Haus von oben dicht. Bis dahin ist alles darunter wetterabhängig.',
  '[{"text":"Das Holz ist trocken und trägt eine Kennzeichnung","why":"feucht eingebautes Bauholz arbeitet nach und reißt"},{"text":"Die Unterdeckbahn ist an allen Stößen und an den Rändern verklebt","why":"sie ist die zweite wasserführende Ebene und nicht nur eine Folie"},{"text":"Die Anschlüsse an Kamin, Dachfenster und Lüftungsrohre sind sauber ausgeführt","why":"dort tritt Wasser zuerst ein"},{"text":"Die Lüftungsquerschnitte an Traufe und First sind offen","why":"ein Dach ohne Hinterlüftung trocknet nicht ab"},{"text":"Rinnen und Fallrohre haben Gefälle und enden in einem Anschluss, der abgenommen ist","why":"Wasser, das am Haus versickert, landet an der Kellerwand"}]'::jsonb,
  '[{"question":"Welche Dachneigung hat das Dach, und liegt sie über der Regeldachneigung der eingebauten Deckung?","whyItMatters":"liegt sie darunter, sind Zusatzmaßnahmen zwingend"},{"question":"Welche Unterdeckung wird eingebaut, und in welcher Ausführungsklasse?","whyItMatters":"davon hängt ab, wie lange das Dach ohne Ziegel dicht ist"},{"question":"Wie sind die Sparren am Ringanker verankert?","whyItMatters":"die Verankerung nimmt die Windsogkräfte auf"},{"question":"Wann kommt der Blitzschutz, falls einer vorgesehen ist?","whyItMatters":"er wird an den Fundamenterder angeschlossen, und der liegt seit der Bodenplatte"}]'::jsonb,
  '[{"problem":"Die Unterdeckung ist nur lose verlegt statt verklebt","howToSpot":"bei Schlagregen mit Wind läuft Wasser über die Stöße hinein"},{"problem":"Anschlüsse an Durchdringungen sind mit Dichtmasse statt handwerklich ausgeführt","howToSpot":"die Masse reißt nach ein bis zwei Jahren"},{"problem":"Die Lüftungsquerschnitte sind mit Dämmung zugestopft","howToSpot":"die Folge zeigt sich Jahre später als Feuchteschaden am Sparren"},{"problem":"Fallrohre enden im Kiesbett statt in einer Leitung","howToSpot":"das Wasser läuft genau dort ins Erdreich, wo der Keller steht"}]'::jsonb,
  '[{"what":"Der offene Dachstuhl mit allen Verbindungen und Verankerungen, vor der Eindeckung","why":"danach ist die Konstruktion verdeckt"},{"what":"Die fertige Unterdeckung mit allen verklebten Stößen","why":"sie verschwindet unter der Lattung"},{"what":"Die Anschlüsse an Kamin und Dachfenster aus der Nähe","why":"es sind die Stellen mit dem höchsten Schadensrisiko"}]'::jsonb,
  false, null,
  '[{"reference":"Fachregeln des Deutschen Dachdeckerhandwerks (ZVDH)","note":"Regeldachneigung, Unterdeckung und Anschlüsse"},{"reference":"DIN 68800","note":"Holzschutz, mit den Anforderungen an Holzfeuchte und baulichen Holzschutz"},{"reference":"DIN 4108-3","note":"Klimabedingter Feuchteschutz, Anforderungen an belüftete Dachkonstruktionen"},{"reference":"VOB/C ATV DIN 18334 und DIN 18338","note":"Zimmer- und Holzbauarbeiten sowie Dachdeckungsarbeiten, sofern die VOB/B vereinbart ist"}]'::jsonb,
  now()
)
on conflict (id) do nothing;

-- Estrich und Belegreife (estrich, Fassung 1)
insert into guide_card (
  id, key, version, phase_key, trade_code, template_task_codes, title,
  whats_happening, watch_for, questions_for_contractor, common_problems,
  photo_prompts, expert_recommended, expert_reason, sources, published_at
) values (
  '7200363d-8e6e-5729-948f-80ddb5954449', 'estrich', 1, 'ausbau',
  'estrich', array['t26', 't27']::text[], 'Estrich und Belegreife',
  'Auf die Rohdecke kommen Dämmung, Folie und darauf der Estrich — die Schicht, die später den Bodenbelag trägt. Danach folgt die Trocknung bis zur Belegreife: dem Zustand, in dem der Estrich trocken genug ist, dass ein Belag darauf verlegt werden darf.

Diese Trocknung ist Wartezeit, keine Pufferzeit. Sie steht als eigener Vorgang in deinem Plan und lässt sich nicht verkürzen, indem jemand schneller arbeitet.',
  '[{"text":"Ringsum an allen Wänden steht ein Randdämmstreifen, auch an Türzargen und Rohren","why":"ohne ihn überträgt der Estrich Trittschall in die Wände"},{"text":"Die Aufbauhöhe passt zum Belag, den du ausgesucht hast","why":"Fliesen und Parkett bauen unterschiedlich hoch, und die Türen sind schon bestellt"},{"text":"Die Bewegungsfugen liegen nach Plan, insbesondere in Türdurchgängen","why":"ein Estrich ohne Fugenplan reißt an der ungünstigsten Stelle von selbst"},{"text":"Bei Fußbodenheizung wird das vorgeschriebene Aufheizprogramm gefahren und protokolliert","why":"ohne dieses Protokoll verweigert mancher Bodenleger die Verlegung"},{"text":"Die Belegreife wird gemessen und nicht geschätzt","why":"die Messung ist eine Zahl auf einem Protokoll, kein Blick auf den Boden"}]'::jsonb,
  '[{"question":"Welcher Estrich wird eingebaut, und welche Aufbauhöhe hat er?","whyItMatters":"Zement- und Calciumsulfatestrich trocknen unterschiedlich lang und vertragen unterschiedlich viel Feuchte"},{"question":"Wann wird die Belegreife gemessen, mit welchem Verfahren und wer bekommt das Protokoll?","whyItMatters":"üblich ist die CM-Messung, und der Grenzwert hängt von Estrichart und Fußbodenheizung ab"},{"question":"Gibt es einen Fugenplan, und wo liegen die Fugen?","whyItMatters":"die Lage der Fugen bestimmt später das Verlegebild"},{"question":"Wie wird während der Trocknung gelüftet und geheizt?","whyItMatters":"falsches Lüften in den ersten Tagen führt zu Rissen"}]'::jsonb,
  '[{"problem":"Zu früh belegt, weil der Termin drängte","howToSpot":"der Belag wirft Wellen oder löst sich, und die Ursache ist erst nach dem Herausreißen sichtbar"},{"problem":"Der Randdämmstreifen wird zu früh abgeschnitten oder fehlt hinter Zargen","howToSpot":"es entstehen Schallbrücken, die man hört und nicht mehr beheben kann"},{"problem":"Die Aufbauhöhe passt nicht zum Belag","howToSpot":"Türen schleifen oder es entsteht eine Stufe zum Nachbarraum"},{"problem":"Das Aufheizprotokoll fehlt","howToSpot":"der Bodenleger legt nicht los, und der Termin verschiebt sich um Wochen"}]'::jsonb,
  '[{"what":"Die verlegte Dämmung mit allen Leitungen darin, vor dem Estrich","why":"danach weiß niemand mehr, wo etwas liegt"},{"what":"Die Heizkreise der Fußbodenheizung, raumweise","why":"beim späteren Bohren in den Boden ist das der einzige Anhaltspunkt"},{"what":"Der Randdämmstreifen an den Wänden","why":"er verschwindet unter Sockelleiste und Belag"}]'::jsonb,
  false, null,
  '[{"reference":"DIN 18560-1 und -2","note":"Estriche im Bauwesen, unter anderem Estriche auf Dämmschichten"},{"reference":"Schnittstellenkoordination der Verbände von Estrich-, Fliesen- und Parkettgewerk","note":"Belegreife und CM-Messung"},{"reference":"DIN 18202","note":"Toleranzen im Hochbau, Ebenheit von Bodenflächen"},{"reference":"VOB/C ATV DIN 18353","note":"Estricharbeiten, sofern die VOB/B vereinbart ist"}]'::jsonb,
  now()
)
on conflict (id) do nothing;

-- Fenstereinbau und Anschlussdichtung (fenster, Fassung 1)
insert into guide_card (
  id, key, version, phase_key, trade_code, template_task_codes, title,
  whats_happening, watch_for, questions_for_contractor, common_problems,
  photo_prompts, expert_recommended, expert_reason, sources, published_at
) values (
  'e33fb3d7-774e-55e4-a791-5f3d9f46b02d', 'fenster', 1, 'dach_huelle',
  'fensterbau', array['t18']::text[], 'Fenstereinbau und Anschlussdichtung',
  'Fenster und Haustür werden eingebaut, ausgerichtet, befestigt und ringsum an das Mauerwerk angeschlossen. Der Anschluss besteht aus drei Schichten: innen luftdicht, in der Mitte gedämmt, außen schlagregendicht und dampfdurchlässig.

Der Grundsatz dahinter lautet innen dichter als außen. So kann Feuchte, die doch in die Fuge gelangt, nach außen wieder heraus.',
  '[{"text":"Die Fenster sind mechanisch befestigt, nicht nur eingeschäumt","why":"Bauschaum ist Dämmung und kein Befestigungsmittel"},{"text":"Innen läuft ein durchgehendes dichtes Band um jedes Fenster","why":"dieses Band entscheidet später über das Ergebnis des Luftdichtheitstests"},{"text":"Außen ist die Fuge abgedeckt oder mit einem dafür vorgesehenen Band geschlossen","why":"offener Schaum zerfällt unter Sonnenlicht innerhalb weniger Jahre"},{"text":"Die Fensterbänke haben Gefälle nach außen und seitliche Abschlüsse","why":"ohne sie läuft Wasser in die Laibung"},{"text":"Alle Flügel schließen gleichmäßig, und ein Blatt Papier klemmt ringsum gleich stark","why":"das ist die einfachste Prüfung der Anpressung, die du selbst machen kannst"}]'::jsonb,
  '[{"question":"Wird nach dem RAL-Leitfaden montiert, und wer stellt das sicher?","whyItMatters":"er ist der anerkannte Stand für Montage und Anschluss"},{"question":"Welche Werte haben Glas und Rahmen, und stimmen sie mit dem Wärmeschutznachweis überein?","whyItMatters":"die Werte stehen im Lieferschein und im Nachweis, beide müssen zusammenpassen"},{"question":"Wie wird der Anschluss an die spätere Luftdichtheitsebene hergestellt?","whyItMatters":"der Putz oder die Folie muss an das Fensterband anschließen, sonst hängt das Band im Nichts"},{"question":"Wann kommt der Blower-Door-Vorabtest?","whyItMatters":"er sollte stattfinden, solange die Anschlüsse noch zugänglich sind"}]'::jsonb,
  '[{"problem":"Fenster nur eingeschäumt","howToSpot":"sie setzen sich, und die Flügel schleifen nach einigen Monaten"},{"problem":"Das innere Dichtband fehlt oder ist unterbrochen","howToSpot":"im Luftdichtheitstest zieht es spürbar an den Laibungen"},{"problem":"Die Fensterbank ist ohne seitlichen Abschluss eingebaut","howToSpot":"an der Laibung darunter zeigen sich nach dem ersten Winter Wasserspuren"},{"problem":"Die Schutzfolie bleibt wochenlang in der Sonne kleben","howToSpot":"sie lässt sich danach nur mit Aufwand und Kratzern entfernen"}]'::jsonb,
  '[{"what":"Jede Fensterfuge innen mit dem umlaufenden Dichtband, vor dem Innenputz","why":"danach ist sie unter Putz"},{"what":"Die Befestigungspunkte in der Laibung","why":"sie belegen, dass mechanisch befestigt wurde"},{"what":"Die Anschlüsse der Fensterbänke außen, seitlich und unten","why":"dort entstehen die typischen Wasserschäden"}]'::jsonb,
  false, null,
  '[{"reference":"Leitfaden zur Montage der RAL-Gütegemeinschaft Fenster, Fassaden und Haustüren","note":"anerkannter Stand für Befestigung und Anschluss"},{"reference":"DIN 4108-7","note":"Luftdichtheit von Gebäuden, Planungs- und Ausführungsempfehlungen"},{"reference":"DIN 18202","note":"Toleranzen im Hochbau, maßgeblich für Öffnungs- und Einbaumaße"}]'::jsonb,
  now()
)
on conflict (id) do nothing;

-- Fliesenarbeiten und Abdichtung im Bad (fliesen, Fassung 1)
insert into guide_card (
  id, key, version, phase_key, trade_code, template_task_codes, title,
  whats_happening, watch_for, questions_for_contractor, common_problems,
  photo_prompts, expert_recommended, expert_reason, sources, published_at
) values (
  '077346f7-fd56-5df0-801b-ae9b61d89000', 'fliesen', 1, 'endausbau',
  'fliesen', array['t28']::text[], 'Fliesenarbeiten und Abdichtung im Bad',
  'Vor der ersten Fliese kommt im Bad die Abdichtung im Verbund — eine flüssig aufgetragene Schicht unter den Fliesen, die verhindert, dass Wasser in Wand und Boden zieht. Erst danach wird geklebt, verfugt und versiegelt.

Fliesen sind der häufigste Grund für Terminverschiebungen im Innenausbau, weil ihre Lieferzeit regelmäßig unterschätzt wird.',
  '[{"text":"Im Duschbereich und um die Wanne ist eine Verbundabdichtung aufgebracht, meist farbig erkennbar","why":"Fliesen und Fugen allein sind nicht wasserdicht"},{"text":"An Ecken, Übergängen und Durchführungen liegen Dichtbänder und Manschetten ein","why":"dort versagt eine Abdichtung zuerst"},{"text":"Die Fliesen liegen im vollen Kleberbett, besonders am Boden","why":"hohl liegende Fliesen klingen beim Klopfen dumpf und brechen unter Belastung"},{"text":"Bewegungsfugen des Estrichs werden in der Fliesenebene übernommen","why":"sonst reißt die Fliese über der Fuge"},{"text":"In Ecken und an Anschlüssen sitzt elastisches Material statt Mörtelfuge","why":"starre Fugen in bewegten Ecken reißen im ersten Jahr"}]'::jsonb,
  '[{"question":"Nach welcher Wassereinwirkungsklasse wird das Bad abgedichtet?","whyItMatters":"DIN 18534 unterscheidet die Beanspruchung, und eine bodengleiche Dusche liegt höher als ein Spritzbereich am Waschtisch"},{"question":"Wann muss ich die Fliesen spätestens ausgesucht und bestellt haben?","whyItMatters":"die Lieferzeit ist der häufigste Verzugsgrund in dieser Bauphase"},{"question":"Wie sieht der Verlegeplan aus, und wo landen die Schnitte?","whyItMatters":"der Plan bestimmt, ob am Ende ein Streifen von zwei Zentimetern in der Sichtachse liegt"},{"question":"Wird die Abdichtung vor dem Fliesen abgenommen oder dokumentiert?","whyItMatters":"danach ist sie unsichtbar"}]'::jsonb,
  '[{"problem":"Die Abdichtung fehlt oder ist unvollständig, besonders an Rohrdurchführungen","howToSpot":"der Schaden zeigt sich Jahre später an der Wand des Nebenraums"},{"problem":"Hohlliegende Fliesen","howToSpot":"sie klingen beim Abklopfen dumpf, und einzelne brechen bei Belastung"},{"problem":"Bewegungsfugen werden überfliest","howToSpot":"es entsteht ein Riss quer durch die Fläche"},{"problem":"Die Fliesen kommen zu spät, weil zu spät ausgesucht wurde","howToSpot":"der ganze Endausbau schiebt sich nach hinten"}]'::jsonb,
  '[{"what":"Die fertige Abdichtung im ganzen Nassbereich, vor der ersten Fliese","why":"sie ist danach dauerhaft verdeckt"},{"what":"Die Dichtbänder in Ecken und an allen Durchführungen","why":"genau diese Stellen sind später strittig"},{"what":"Die Wand mit den Anschlüssen und Maßen, bevor sie verfliest wird","why":"für spätere Bohrungen"}]'::jsonb,
  false, null,
  '[{"reference":"DIN 18534","note":"Abdichtung von Innenräumen, mit den Wassereinwirkungsklassen W0-I bis W3-I"},{"reference":"DIN 18157","note":"Ausführung keramischer Bekleidungen im Dünnbettverfahren"},{"reference":"DIN 18202","note":"Toleranzen im Hochbau, Ebenheit der Untergründe"},{"reference":"VOB/C ATV DIN 18352","note":"Fliesen- und Plattenarbeiten, sofern die VOB/B vereinbart ist"}]'::jsonb,
  now()
)
on conflict (id) do nothing;

-- Innenputz (innenputz, Fassung 1)
insert into guide_card (
  id, key, version, phase_key, trade_code, template_task_codes, title,
  whats_happening, watch_for, questions_for_contractor, common_problems,
  photo_prompts, expert_recommended, expert_reason, sources, published_at
) values (
  '08ae080d-36a5-521c-9a5d-2c0c87cfae8a', 'innenputz', 1, 'ausbau',
  'putzer', array['t24']::text[], 'Innenputz',
  'Die Wände bekommen ihren Putz. Er gleicht das Mauerwerk aus, bildet den Untergrund für Farbe und Fliesen und ist zugleich ein Teil der Luftdichtheitsebene: Auf Mauerwerk ist es der Putz, der die Wand dicht macht, nicht der Stein.

Mit dem Putz kommt viel Wasser ins Haus. Das muss wieder heraus, bevor der Estrich folgt.',
  '[{"text":"Der Putz läuft hinter Steckdosen und an Anschlüssen durch, wo die Luftdichtheit es verlangt","why":"an dieser Stelle entscheidet sich der spätere Messwert"},{"text":"An Übergängen zwischen verschiedenen Untergründen liegt Gewebe ein","why":"sonst reißt der Putz genau auf dieser Linie"},{"text":"Es wird gelüftet und bei Bedarf beheizt","why":"nasser Putz in einem geschlossenen Haus führt zu Schimmel an den kältesten Stellen"},{"text":"Kanten und Laibungen sind gerade und mit Profilen ausgeführt","why":"krumme Laibungen sieht man später bei Streiflicht in jedem Raum"},{"text":"Die vereinbarte Oberflächenqualität ist vorher festgelegt","why":"für glatte Farbanstriche und Streiflicht braucht es eine höhere Stufe als für Raufaser"}]'::jsonb,
  '[{"question":"Welche Oberflächenqualität ist vereinbart?","whyItMatters":"die Stufen Q1 bis Q4 unterscheiden sich deutlich in Aufwand und Ergebnis"},{"question":"Wie wird die Luftdichtheit an Steckdosen, Durchführungen und Anschlüssen sichergestellt?","whyItMatters":"der Putz ist hier das dichtende Bauteil"},{"question":"Wie lange muss der Putz trocknen, bevor der Estrich kommt?","whyItMatters":"beide bringen Wasser ein, und die Trocknungszeiten addieren sich"},{"question":"Wer sorgt fürs Lüften und Heizen in der Trocknungsphase?","whyItMatters":"ohne klare Zuständigkeit macht es niemand"}]'::jsonb,
  '[{"problem":"Zu schnelles Trocknen durch Heizlüfter direkt an der Wand","howToSpot":"der Putz reißt netzartig auf"},{"problem":"Zu langsames Trocknen ohne Lüften","howToSpot":"an Fensterlaibungen und Außenecken bildet sich Schimmel"},{"problem":"Fehlendes Gewebe an Materialübergängen","howToSpot":"nach einigen Monaten zeigt sich ein durchgehender Riss auf der Trennlinie"},{"problem":"Die Oberflächenqualität wurde nie vereinbart","howToSpot":"beim Streichen fällt auf, dass beide Seiten etwas anderes gemeint haben"}]'::jsonb,
  '[{"what":"Die Wände unmittelbar vor dem Putz, mit allen Leitungen und Dosen","why":"das ist die letzte Gelegenheit"},{"what":"Die Anschlüsse an Fenster und Decken nach dem Putzen","why":"sie zeigen, wie die Luftdichtheitsebene geschlossen wurde"},{"what":"Feuchte Stellen oder Verfärbungen während der Trocknung","why":"falls es später um Schimmel geht, ist der Verlauf belegt"}]'::jsonb,
  false, null,
  '[{"reference":"DIN 18550-1 und -2","note":"Planung, Zubereitung und Ausführung von Außen- und Innenputzen"},{"reference":"DIN 18202","note":"Toleranzen im Hochbau, Ebenheit von Wandflächen"},{"reference":"Merkblätter der deutschen Gipsindustrie zu Oberflächenqualitäten","note":"die Stufen Q1 bis Q4"},{"reference":"VOB/C ATV DIN 18350","note":"Putz- und Stuckarbeiten, sofern die VOB/B vereinbart ist"}]'::jsonb,
  now()
)
on conflict (id) do nothing;

-- Kellerabdichtung, Perimeterdämmung und Drainage (kellerabdichtung, Fassung 1)
insert into guide_card (
  id, key, version, phase_key, trade_code, template_task_codes, title,
  whats_happening, watch_for, questions_for_contractor, common_problems,
  photo_prompts, expert_recommended, expert_reason, sources, published_at
) values (
  'd72e2f6e-3f84-5d59-80e8-c95458077ee3', 'kellerabdichtung', 1, 'gruendung',
  'rohbau', array['t10']::text[], 'Kellerabdichtung, Perimeterdämmung und Drainage',
  'Die Kelleraußenwände bekommen ihre Abdichtung gegen Wasser aus dem Erdreich, darauf die Perimeterdämmung — die Dämmschicht, die außen auf der Wand liegt und im Erdreich bleibt. Wo es die Bodenverhältnisse verlangen, kommt eine Drainage dazu, die Sickerwasser vom Haus wegführt.

Welche Abdichtung richtig ist, hängt davon ab, wie das Wasser am Haus ansteht. Das steht im Baugrundgutachten, nicht im Ermessen des Ausführenden.',
  '[{"text":"Der Untergrund ist trocken, staubfrei und ohne Grate, bevor abgedichtet wird","why":"auf einer nicht vorbereiteten Wand hält keine Abdichtung"},{"text":"Die Kehle zwischen Bodenplatte und Wand ist ausgerundet und mit abgedichtet","why":"genau dort steht Wasser am längsten"},{"text":"Jede Durchführung für Wasser, Strom oder Kabel ist einzeln abgedichtet","why":"Rohre sind der häufigste Weg, auf dem Wasser doch hineinkommt"},{"text":"Die Abdichtung reicht bis über die spätere Geländehöhe hinauf","why":"wo sie zu früh endet, läuft Wasser dahinter"},{"text":"Die Drainage liegt mit Gefälle, im Filterkies und mit Spülschächten an den Ecken","why":"eine Drainage, die man nicht spülen kann, ist nach wenigen Jahren zu"}]'::jsonb,
  '[{"question":"Welche Wassereinwirkungsklasse nach DIN 18533 liegt dem Aufbau zugrunde?","whyItMatters":"sie entscheidet über die gesamte Bauart, und sie ergibt sich aus dem Baugrundgutachten"},{"question":"Welches Abdichtungssystem wird eingebaut, und in wie vielen Lagen?","whyItMatters":"die Anzahl der Lagen und die Trockenschichtdicke sind Teil des Systems und nicht verhandelbar"},{"question":"Wann wird verfüllt, und womit?","whyItMatters":"zu frühes Verfüllen und scharfkantiges Material beschädigen die frische Abdichtung"},{"question":"Braucht dieses Grundstück überhaupt eine Drainage?","whyItMatters":"eine Drainage ist bei drückendem Wasser kein Ersatz für die richtige Abdichtung"}]'::jsonb,
  '[{"problem":"Die Abdichtung wird zu dünn aufgetragen","howToSpot":"sichtbar wird es nur an der Verbrauchsmenge und an Messstellen in der frischen Schicht"},{"problem":"Zu früh verfüllt","howToSpot":"die Dämmplatten verrutschen, und an den Stößen entstehen Wege für Wasser"},{"problem":"Verfüllt wird mit dem Aushub statt mit Material, das Wasser durchlässt","howToSpot":"dann steht das Wasser im Arbeitsraum wie in einer Wanne"},{"problem":"Die Drainage wird ohne Gefälle oder ohne Filterschicht verlegt","howToSpot":"sie schlämmt zu und wirkt genau dann nicht mehr, wenn es lange regnet"}]'::jsonb,
  '[{"what":"Die fertige Abdichtung an der ganzen Wand, vor der Dämmung","why":"danach ist sie dauerhaft verdeckt"},{"what":"Jede einzelne Durchführung im abgedichteten Zustand","why":"das sind die Stellen, an denen später gestritten wird"},{"what":"Die verlegte Drainage mit Kiesbett und Schächten, vor dem Verfüllen","why":"später sieht man nur noch die Deckel"}]'::jsonb,
  true, 'Ein feuchter Keller ist der teuerste Mangel am ganzen Haus, weil er sich nur von außen beheben lässt — und dazu muss das Erdreich wieder weg. Ob die Abdichtung zur Wassereinwirkungsklasse passt und ob sie vollständig ist, lässt sich an genau einem Tag beurteilen: vor dem Verfüllen des Arbeitsraums.',
  '[{"reference":"DIN 18533","note":"Abdichtung von erdberührten Bauteilen, mit den Wassereinwirkungsklassen W1-E bis W4-E"},{"reference":"DIN 4095","note":"Dränung zum Schutz baulicher Anlagen"},{"reference":"DIN 4020","note":"Geotechnische Untersuchungen für bautechnische Zwecke, Grundlage des Baugrundgutachtens"},{"reference":"VOB/C ATV DIN 18336","note":"Abdichtungsarbeiten, sofern die VOB/B vereinbart ist"}]'::jsonb,
  now()
)
on conflict (id) do nothing;

-- Mauerwerk, Decken und Ringanker (rohbau-mauerwerk, Fassung 1)
insert into guide_card (
  id, key, version, phase_key, trade_code, template_task_codes, title,
  whats_happening, watch_for, questions_for_contractor, common_problems,
  photo_prompts, expert_recommended, expert_reason, sources, published_at
) values (
  'f1667c91-9cf0-53e5-a626-fce644c3ddfc', 'rohbau-mauerwerk', 1, 'rohbau',
  'rohbau', array['t12', 't14']::text[], 'Mauerwerk, Decken und Ringanker',
  'Die Außen- und Innenwände werden gemauert, die Geschossdecken eingebaut und der Ringanker hergestellt — ein umlaufendes Band aus Stahlbeton, das die Wände zusammenhält. Fenster- und Türöffnungen entstehen jetzt in genau der Größe, die später bestellt wird.

Ab hier wird das Haus zum ersten Mal begehbar, und die Räume bekommen ihre wirklichen Maße.',
  '[{"text":"Die Öffnungen für Fenster und Türen stimmen mit dem Plan überein","why":"nach dem Aufmaß werden die Fenster gefertigt, und eine falsche Öffnung merkt man erst bei der Montage"},{"text":"Die Steine werden mit vollen Fugen versetzt","why":"offene Stoßfugen sind Wege für Luft und damit für Wärmeverlust"},{"text":"Bei Regen werden angefangene Wände abgedeckt","why":"durchnässtes Mauerwerk trocknet monatelang und bringt die Feuchte in den Innenputz mit"},{"text":"Stürze über Öffnungen liegen mit dem vorgeschriebenen Auflager auf","why":"zu kurze Auflager reißen die Wand über der Öffnung"},{"text":"Die Wände stehen lotrecht und die Räume haben die Maße aus dem Plan","why":"Abweichungen summieren sich bis in die Küchenplanung"}]'::jsonb,
  '[{"question":"Wann wird das Aufmaß für die Fenster genommen, und wer macht es?","whyItMatters":"ab diesem Termin lassen sich Öffnungsmaße nicht mehr ändern"},{"question":"Welcher Stein mit welchem Wärmedurchgangswert ist eingebaut worden?","whyItMatters":"der Wert steht im Wärmeschutznachweis und bestimmt die Heizlast"},{"question":"Wie werden die Wärmebrücken an Ringanker, Rollladenkästen und Decken behandelt?","whyItMatters":"das sind die Stellen, an denen später Schimmel entsteht"},{"question":"Bleibt der Rohbau vor Regen geschützt, solange er offen ist?","whyItMatters":"Baufeuchte verzögert alles Folgende, vom Putz bis zum Estrich"}]'::jsonb,
  '[{"problem":"Öffnungsmaße weichen vom Plan ab","howToSpot":"es fällt bei der Fenstermontage auf, und dann ist Nacharbeit am Mauerwerk nötig"},{"problem":"Nicht vermörtelte Stoßfugen","howToSpot":"im späteren Luftdichtheitstest zeigt sich ein deutlich zu hoher Wert, ohne dass eine einzelne Stelle sichtbar wäre"},{"problem":"Der Rohbau steht über Wochen offen im Regen","howToSpot":"feuchte Wände, verzögerte Trocknungszeiten und im schlimmsten Fall Schimmel unter dem Putz"},{"problem":"Leitungsschlitze werden nachträglich zu tief gefräst","howToSpot":"die tragende Wand verliert Querschnitt, was in der Statik nicht vorgesehen war"}]'::jsonb,
  '[{"what":"Jede Wand mit ihren Öffnungen, raumweise und mit Maßband","why":"das ist die Grundlage jeder späteren Diskussion über Raumgrößen"},{"what":"Die Auflager der Decken und Stürze, bevor sie verputzt werden","why":"sie sind später vollständig verdeckt"},{"what":"Die Wände nach einem Regentag","why":"falls es später um Baufeuchte geht, ist der Zustand belegt"}]'::jsonb,
  false, null,
  '[{"reference":"DIN EN 1996 mit nationalem Anhang, Eurocode 6","note":"Bemessung und Ausführung von Mauerwerksbauten"},{"reference":"DIN 18202","note":"Toleranzen im Hochbau, unter anderem Winkel- und Ebenheitstoleranzen von Wänden"},{"reference":"DIN 4108","note":"Wärmeschutz im Hochbau, mit den Anforderungen an Wärmebrücken"},{"reference":"VOB/C ATV DIN 18330","note":"Mauerarbeiten, sofern die VOB/B vereinbart ist"}]'::jsonb,
  now()
)
on conflict (id) do nothing;

-- Rohinstallation Elektro (rohinstallation-elektro, Fassung 1)
insert into guide_card (
  id, key, version, phase_key, trade_code, template_task_codes, title,
  whats_happening, watch_for, questions_for_contractor, common_problems,
  photo_prompts, expert_recommended, expert_reason, sources, published_at
) values (
  '6e1e4465-dbc5-5316-84ee-3b335596ce40', 'rohinstallation-elektro', 1, 'rohinstallation',
  'elektro', array['t20']::text[], 'Rohinstallation Elektro',
  'Der Elektriker schlitzt die Wände, setzt Dosen und zieht alle Leitungen bis zum Verteiler. Verkabelt und angeschlossen wird später; jetzt entsteht die Struktur, an der zehn Jahre lang nichts mehr geändert wird.

Das ist der Vorgang, bei dem deine Entscheidungen unmittelbar sichtbar werden: Jede Steckdose, die jetzt fehlt, fehlt dauerhaft oder wird zum Nachtrag.',
  '[{"text":"Geh vor dem Schlitzen mit dem Elektriker durch jeden Raum und stell dir die Möbel vor","why":"hinter dem Schrank ist eine Steckdose wertlos"},{"text":"Die Leitungen laufen in den vorgesehenen Installationszonen","why":"nur dort kann später jemand gefahrlos in die Wand bohren"},{"text":"In Bad und Dusche werden die Schutzbereiche eingehalten","why":"sie sind vorgeschrieben und keine Frage des Geschmacks"},{"text":"Leerrohre für Netzwerk, Außenbeleuchtung, Ladepunkt und Beschattung sind gelegt, auch wenn du sie noch nicht brauchst","why":"ein Leerrohr kostet jetzt fast nichts und später eine Wandsanierung"},{"text":"Der Verteiler hat Platz für Reserve","why":"mit jeder späteren Erweiterung wird ein zu kleiner Verteiler zum eigenen Umbau"}]'::jsonb,
  '[{"question":"Wann ist der Termin, an dem wir gemeinsam die Positionen festlegen?","whyItMatters":"nach diesem Termin ist jede Änderung ein Nachtrag"},{"question":"Nach welcher Mindestausstattung wird geplant?","whyItMatters":"DIN 18015-2 nennt Mindestzahlen je Raum, und viele Angebote liegen darunter"},{"question":"In welchen Zonen werden die Leitungen geführt, und bekomme ich einen Bestandsplan?","whyItMatters":"ohne Plan bohrst du später auf gut Glück"},{"question":"Sind Rauchwarnmelder, Netzwerkdosen und Anschlüsse für Wallbox und Photovoltaik berücksichtigt?","whyItMatters":"nachträglich sind das alles Stemmarbeiten"}]'::jsonb,
  '[{"problem":"Zu wenige Steckdosen, weil nach Mindestausstattung kalkuliert wurde","howToSpot":"es fällt beim Einzug auf, wenn Mehrfachsteckdosen die Lösung sind"},{"problem":"Leitungen laufen quer durch die Wand statt in den Zonen","howToSpot":"der erste Bohrer im Bild an der Wand trifft sie"},{"problem":"Der Bestandsplan fehlt oder wird nie übergeben","howToSpot":"später weiß niemand, wo etwas liegt"},{"problem":"Dosen sitzen auf unterschiedlichen Höhen","howToSpot":"sichtbar wird es erst nach dem Streichen, korrigierbar ist es dann nicht mehr"}]'::jsonb,
  '[{"what":"Jede Wand mit allen Schlitzen und Dosen, raumweise, mit Zollstock im Bild","why":"nach dem Putz ist die Leitungsführung unsichtbar"},{"what":"Die Decken mit den Auslässen für Leuchten und Meldern","why":"auch sie verschwinden unter Putz"},{"what":"Der offene Verteilerplatz mit den ankommenden Leitungen","why":"das ist die Grundlage jeder späteren Erweiterung"}]'::jsonb,
  false, null,
  '[{"reference":"DIN 18015-1 bis -3","note":"Elektrische Anlagen in Wohngebäuden: Planungsgrundlagen, Mindestausstattung und Installationszonen"},{"reference":"DIN VDE 0100-410","note":"Schutzmaßnahmen gegen elektrischen Schlag"},{"reference":"DIN VDE 0100-701","note":"Räume mit Badewanne oder Dusche, mit den Schutzbereichen"},{"reference":"VOB/C ATV DIN 18382","note":"Elektrische Kabel- und Leitungsanlagen, sofern die VOB/B vereinbart ist"}]'::jsonb,
  now()
)
on conflict (id) do nothing;

-- Rohinstallation Sanitär und Heizung (rohinstallation-shk, Fassung 1)
insert into guide_card (
  id, key, version, phase_key, trade_code, template_task_codes, title,
  whats_happening, watch_for, questions_for_contractor, common_problems,
  photo_prompts, expert_recommended, expert_reason, sources, published_at
) values (
  '5fe1935a-3ba6-576c-ad47-8b3d9d650757', 'rohinstallation-shk', 1, 'rohinstallation',
  'shk', array['t21']::text[], 'Rohinstallation Sanitär und Heizung',
  'Alle Leitungen für Trinkwasser, Abwasser und Heizung werden verlegt, Vorwandinstallationen gestellt und die Anschlusspunkte für Wanne, Dusche, Waschtisch und Küche festgelegt. Danach wird die Anlage auf Dichtheit geprüft und protokolliert.

Wo die Anschlüsse sitzen, entscheidet über die Möblierung des Bades. Verschieben lässt sich das nur, solange die Wand offen ist.',
  '[{"text":"Die Positionen von Wanne, Dusche, WC und Waschtisch sind angezeichnet und du hast sie im Raum gesehen","why":"auf dem Plan wirkt jedes Bad größer"},{"text":"Rohre sind gedämmt, und zwar Warmwasser gegen Wärmeverlust und Kaltwasser gegen Schwitzwasser","why":"ungedämmte Kaltwasserleitungen tropfen im Estrich"},{"text":"Leitungen sind körperschallentkoppelt befestigt","why":"starr befestigte Abwasserrohre hört man im ganzen Haus"},{"text":"Das Abwasser hat durchgehend Gefälle","why":"zu geringes Gefälle führt zu Ablagerungen und regelmäßigen Verstopfungen"},{"text":"Die Dichtheitsprüfung wird durchgeführt und protokolliert, bevor irgendetwas verschlossen wird","why":"das Protokoll ist dein Beleg"}]'::jsonb,
  '[{"question":"Wann findet die Dichtheitsprüfung statt, und bekomme ich das Protokoll?","whyItMatters":"nach dem Verschließen der Wände ist eine Leckage eine Bauteilöffnung"},{"question":"Wie wird die Trinkwasserinstallation bis zur Inbetriebnahme behandelt?","whyItMatters":"stehendes Wasser in einer neuen Leitung ist ein Hygienethema, deshalb wird sie entweder gespült oder trocken belassen"},{"question":"Wie ist der Schallschutz der Abwasserleitungen an Wänden zu Schlaf- und Wohnräumen gelöst?","whyItMatters":"Schallschutz ist nachträglich kaum zu verbessern"},{"question":"Passt die Vorwand zu den Objekten, die ich ausgesucht habe?","whyItMatters":"Vorwandhöhe und Anschlussmaße hängen am konkreten Modell"}]'::jsonb,
  '[{"problem":"Anschlüsse sitzen so, dass die gewünschten Objekte nicht passen","howToSpot":"es fällt bei der Endmontage auf, wenn die Fliesen längst liegen"},{"problem":"Kaltwasserleitungen ungedämmt im Estrich","howToSpot":"an der Decke darunter zeigen sich Feuchtestellen, ohne dass ein Rohr undicht wäre"},{"problem":"Starr befestigte Fallleitungen","howToSpot":"im Schlafzimmer nebenan ist jede Spülung zu hören"},{"problem":"Die Dichtheitsprüfung wird mündlich bestätigt, aber nie protokolliert","howToSpot":"im Schadensfall gibt es nichts vorzulegen"}]'::jsonb,
  '[{"what":"Jede Wand mit allen Leitungen und Anschlusspunkten, mit Zollstock im Bild","why":"hier bohrst du später für Spiegel und Handtuchhalter"},{"what":"Die Vorwandinstallationen mit den Befestigungen","why":"sie sind nach dem Beplanken vollständig verdeckt"},{"what":"Das Manometer bei der Dichtheitsprüfung mit dem angezeigten Druck","why":"ein Foto ist kein Ersatz für das Protokoll, aber es ergänzt es"}]'::jsonb,
  true, 'Dies ist der Termin, den Baubegleiter als Rohinstallationsprüfung vor der Verkleidung setzen — er umfasst Elektro und Sanitär zugleich. Sobald Putz, Trockenbau und Estrich darüber sind, kostet jede Korrektur ein Vielfaches, und Fehler an wasserführenden Leitungen in Wand und Boden zeigen sich oft erst nach Jahren.',
  '[{"reference":"DIN EN 806 und DIN 1988-200","note":"Trinkwasser-Installationen, Planung und Ausführung"},{"reference":"VDI/DVGW 6023","note":"Hygiene in Trinkwasser-Installationen"},{"reference":"DIN 1986-100","note":"Entwässerungsanlagen für Gebäude und Grundstücke"},{"reference":"DIN 4109","note":"Schallschutz im Hochbau, mit den Anforderungen an haustechnische Anlagen"}]'::jsonb,
  now()
)
on conflict (id) do nothing;


-- ===========================================================================
--  Abschnitt: 0007_decisions.sql
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- MeinBaulotse — Entscheidungsassistent (Arbeitspaket 3)
--
-- Die zweite tragende Funktion aus Abschnitt 1.3. Der Bauherr scheitert nicht
-- daran, dass er die Fliesen nicht aussuchen kann — er sucht sie vier Wochen
-- vor dem Fliesenleger aus statt acht, und die Lieferzeit kippt den Termin.
--
-- Der ganze Mechanismus steht in einer Zeile aus Abschnitt 3.2:
--
--     decision.due_date = werktage_vor(task.current_start, lead_time_days)
--
-- Die Frist ist damit **kein eigener Termin**, sondern eine abgeleitete Größe.
-- Verschiebt sich der Vorgang, wandert die Frist mit; rückt er nach vorn, wird
-- sie enger. Genau das macht eine Verschiebung für den Bauherrn
-- handlungsrelevant — ohne diesen Schritt ist sie nur eine Zahl im Plan.
--
-- Deshalb wird `due_date` gespeichert und nicht bei jeder Abfrage gerechnet:
-- Die Neuberechnung läuft in derselben Transaktion wie die Verschiebung, und
-- eine gespeicherte Frist lässt sich später mit dem vergleichen, was der
-- Bauherr damals gesehen hat.
-- ---------------------------------------------------------------------------

create type mbl.decision_status as enum (
  'offen','in_bemusterung','entschieden','beauftragt','hinfaellig'
);

create table decision_template (
  key              text primary key,
  title            text not null,
  description      text not null,
  help_text        text not null,
  blocks_task_code text not null,
  lead_time_days   int  not null,
  lead_time_unit   mbl.duration_unit not null default 'werktage',
  sort_order       int  not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint decision_template_lead_positive check (lead_time_days > 0)
);
comment on table decision_template is
  'Die vierzehn Entscheidungen aus Abschnitt 7.3, als Daten statt als Konstanten '
  'im Code. Erstbefüllung in 0008.';

create table decision (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid not null references project (id) on delete cascade,
  template_key         text references decision_template (key) on delete set null,
  title                text not null,
  description          text,
  help_text            text,
  -- Der Vorgang, der ohne diese Entscheidung nicht laufen kann. Wird er
  -- gelöscht, bleibt die Entscheidung stehen und verliert nur ihre Frist:
  -- „Fliesen aussuchen" ist auch ohne Fliesenvorgang eine offene Aufgabe.
  blocks_task_id       uuid references task (id) on delete set null,
  lead_time_days       int  not null,
  lead_time_unit       mbl.duration_unit not null default 'werktage',
  due_date             date,
  status               mbl.decision_status not null default 'offen',
  decided_at           timestamptz,
  decided_note         text,
  estimated_cost_cents bigint,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint decision_lead_positive check (lead_time_days > 0),
  constraint decision_cost_nonneg check (estimated_cost_cents is null or estimated_cost_cents >= 0)
);
create index decision_project_idx on decision (project_id, due_date);
create index decision_task_idx on decision (blocks_task_id) where blocks_task_id is not null;
-- Eine Vorlage wird je Bauvorhaben genau einmal instanziiert. Eigene
-- Entscheidungen ohne Vorlage bleiben davon unberührt.
create unique index decision_template_once on decision (project_id, template_key)
  where template_key is not null;

comment on column decision.due_date is
  'Abgeleitet aus dem Beginn des blockierten Vorgangs. Wird bei jeder '
  'Neuberechnung des Plans mitgeführt, siehe apps/api/src/scheduling.ts.';

-- Ein entschiedener Zustand braucht einen Zeitpunkt, ein offener keiner.
-- Der Trigger setzt ihn, statt ihn der Anwendung zu überlassen: Sonst steht
-- irgendwann „entschieden" ohne Datum in der Akte.
create or replace function mbl.touch_decision_decided_at()
returns trigger
language plpgsql
as $$
begin
  if new.status in ('entschieden','beauftragt') and new.decided_at is null then
    new.decided_at := now();
  end if;
  if new.status in ('offen','in_bemusterung') then
    new.decided_at := null;
  end if;
  return new;
end
$$;

create trigger decision_decided_at
  before insert or update on decision
  for each row execute function mbl.touch_decision_decided_at();

do $$
declare
  target text;
begin
  foreach target in array array['decision_template','decision']
  loop
    execute format(
      'create trigger %I before update on %I for each row execute function mbl.touch_updated_at()',
      target || '_touch_updated_at', target
    );
  end loop;
end
$$;

-- Rechte und RLS -----------------------------------------------------------

grant select on decision_template to authenticated;
grant select, insert, update, delete on decision to authenticated;

alter table decision_template enable row level security;
alter table decision          enable row level security;

create policy decision_template_read on decision_template for select to authenticated
  using (true);

create policy decision_read on decision for select to authenticated
  using (mbl.is_member(project_id));

-- Entscheiden ist Sache des Bauherrn (Rechtematrix 2.2, Zeile „Entscheidung
-- pflegen"). Der Baubegleiter hat `decision.propose` und darf mitreden, sobald
-- es den Vorschlagsweg gibt; bis dahin ist die Spalte `decided_note` der Ort
-- dafür, und schreiben darf sie nur, wer auch entscheidet.
create policy decision_write on decision for insert to authenticated
  with check (mbl.has_perm(project_id, 'decision.write'));

create policy decision_update on decision for update to authenticated
  using (mbl.has_perm(project_id, 'decision.write'))
  with check (mbl.has_perm(project_id, 'decision.write'));

create policy decision_delete on decision for delete to authenticated
  using (mbl.has_perm(project_id, 'decision.write'));

grant execute on all functions in schema mbl to anon, authenticated;


-- ===========================================================================
--  Abschnitt: 0008_entscheidungen.sql
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- MeinBaulotse — Entscheidungsvorlagen (erzeugt, nicht von Hand bearbeiten)
--
-- Erzeugt von packages/db/scripts/generate-decisions.ts aus:
--   packages/schedule/src/templates/entscheidungen.ts
--
-- Neu erzeugen: pnpm --filter @meinbaulotse/db decisions:generate
--
-- Abschnitt 7.3 der Spezifikation. Die Vorlaufzeiten sind das Ergebnis der
-- Frage „wie lange vorher muss das feststehen, damit der Vorgang nicht
-- wartet" — nicht die Frage, wie lange jemand zum Überlegen braucht.
-- ---------------------------------------------------------------------------

insert into decision_template
  (key, title, description, help_text, blocks_task_code, lead_time_days, lead_time_unit, sort_order)
values
  ('versicherungen', 'Bauherrenhaftpflicht und Bauleistungsversicherung', 'Beides muss stehen, bevor die erste Maschine auf das Grundstück fährt. Danach ist es zu spät.',
   'Die Bauherrenhaftpflicht deckt Schäden, die von deiner Baustelle ausgehen — ein Passant stürzt in die offene Baugrube, ein Ziegel trifft ein Auto. Als Bauherr haftest du dafür, auch wenn ein Unternehmen gearbeitet hat. Die Bauleistungsversicherung deckt Schäden am Bau selbst, etwa durch Sturm, Vandalismus oder Diebstahl fest eingebauter Teile. Was du später bereust: einen Schaden in den ersten Wochen, weil die Policen erst zum Richtfest abgeschlossen wurden.',
   't03', 10, 'werktage', 10),
  ('bauhelfer-bg-bau', 'Bauhelfer bei der BG Bau anmelden', 'Wer auf deiner Baustelle unentgeltlich mithilft, ist gesetzlich unfallversichert — und muss gemeldet sein.',
   'Sobald Freunde oder Verwandte mit anpacken, bist du Unternehmer im Sinne der gesetzlichen Unfallversicherung. Die Anmeldung bei der Berufsgenossenschaft der Bauwirtschaft ist Pflicht und kostet wenig; ein nicht gemeldeter Helfer, dem etwas passiert, kostet sehr viel. Gemeldet wird vor dem ersten Einsatz, nicht danach. Auch reine Eigenleistung ohne Helfer wird angezeigt.',
   't03', 5, 'werktage', 20),
  ('dachziegel', 'Dachziegel: Modell und Farbe', 'Die Eindeckung wird bestellt, sobald der Dachstuhl steht.',
   'Form und Material bestimmen, welche Dachneigung zulässig ist und wie viel Gewicht der Dachstuhl trägt — beides ist mit der Statik verknüpft und keine reine Geschmacksfrage. Bei der Farbe entscheidet vor allem der Ort: Manche Bebauungspläne schreiben Farbtöne vor. Was du später bereust: eine Sonderfarbe mit langer Lieferzeit, die den ganzen Ausbau schiebt, weil das Haus bis dahin nicht dicht ist.',
   't17', 20, 'werktage', 30),
  ('fassade', 'Fassade: Putz oder Klinker, Farbton', 'Die Wahl bestimmt, wie lange das Gerüst steht — und was es kostet.',
   'Putz ist günstiger und in jeder Farbe zu haben, muss aber alle paar Jahrzehnte erneuert werden. Klinker kostet deutlich mehr, hält dafür ohne Pflege. Beides beeinflusst die Gerüststandzeit, und Gerüst wird nach Zeit berechnet. Prüf den Bebauungsplan, bevor du dich festlegst: Farbton und Material sind dort häufig vorgegeben. Was du später bereust: einen sehr dunklen Ton auf gedämmter Fassade — er heizt sich auf und arbeitet stärker.',
   't17', 25, 'werktage', 40),
  ('fenster', 'Fenster: Farbe, Verglasung, Rollladen, Griffe', 'Fenster werden für dein Haus gefertigt. Zwischen Bestellung und Einbau liegen Wochen.',
   'Drei Dinge entscheidest du hier gleichzeitig. Erstens die Verglasung: Zweifach oder Dreifach bestimmt den Wärmeschutz und muss zum Wärmeschutznachweis passen. Zweitens den Sonnenschutz: Rollladen, Raffstore oder nichts — nachträglich ist jeder Rollladenkasten ein Eingriff in die Wand. Drittens die Bedienung: abschließbare Griffe im Erdgeschoss, Fenstertüren mit oder ohne Schwelle. Was du später bereust: eine Sonderfarbe außen, die drei Wochen extra Lieferzeit kostet, und fehlende Verschattung nach Süden — die erste Hitzewelle beantwortet die Frage von selbst.',
   't18', 60, 'werktage', 50),
  ('elektroplanung', 'Elektroplanung: Steckdosen, Schalter, Netzwerk', 'Nach dem Schlitzen der Wände ist jede zusätzliche Dose ein Nachtrag mit Staub.',
   'Geh vor dem Termin mit dem Elektriker gedanklich durch jeden Raum und stell die Möbel auf: Wo steht das Bett, wo der Fernseher, wo der Schreibtisch. Eine Steckdose hinter dem Schrank ist verloren, eine fehlende neben dem Bett ärgert zehn Jahre lang. Denk an das, was du noch nicht hast: Leerrohre für Wallbox, Photovoltaik, Außenbeleuchtung und Netzwerk kosten jetzt fast nichts. Was du später bereust: nach Mindestausstattung geplant zu haben — sie ist ein Minimum, kein Vorschlag.',
   't20', 15, 'werktage', 60),
  ('kueche', 'Küchenplanung mit Anschlusspunkten', 'Starkstrom, Wasser und Abluft müssen liegen, bevor die Wände geschlossen werden.',
   'Die Küche wird zwar zuletzt geliefert, aber ihre Anschlüsse entstehen jetzt. Du brauchst dafür keine fertige Küche, sondern einen Plan mit Positionen: Herd, Spüle, Geschirrspüler, Kühlschrank, Dunstabzug. Kläre früh, ob abgesaugt oder umgeluftet wird — eine Außenwanddurchführung ist nachträglich eine Kernbohrung. Was du später bereust: eine Kücheninsel ohne Anschluss darunter, weil sie erst nach dem Estrich beschlossen wurde.',
   't20', 20, 'werktage', 70),
  ('heizsystem', 'Heizsystem und Wärmepumpe final', 'Lieferzeit und Förderantrag brauchen beide Vorlauf, und zwar nacheinander.',
   'Die Wahl des Wärmeerzeugers hängt am Wärmeschutznachweis und an der Heizlast, nicht am Geschmack. Wichtig ist die Reihenfolge: Ein Förderantrag wird vor dem Auftrag gestellt, sonst entfällt die Förderung — nachträglich lässt sich das nicht heilen. Klär außerdem den Aufstellort und die Abstände zum Nachbargrundstück, denn Wärmepumpen erzeugen Geräusche und dafür gelten Grenzwerte. Was du später bereust: die Anlage bestellt zu haben, bevor der Antrag durch war.',
   't21', 40, 'werktage', 80),
  ('sanitaerobjekte', 'Sanitärobjekte und Vorwandpositionen', 'Wo die Objekte hängen, entscheidet sich beim Stellen der Vorwand.',
   'Es geht nicht um Armaturen und Farben, sondern um Maße: Wandhängendes WC oder bodenstehend, Dusche bodengleich oder mit Wanne, Waschtisch als Möbel oder als Becken. Jede Variante hat andere Anschlusshöhen. Steh einmal im Rohbau im Bad und stell dir die Objekte vor — auf dem Plan wirkt jedes Bad größer als es ist. Was du später bereust: eine bodengleiche Dusche, die erst nach dem Estrich gewünscht wurde; die Bodenplatte gibt die Höhe dann nicht mehr her.',
   't21', 20, 'werktage', 90),
  ('bodenbelag', 'Bodenbelag und Aufbauhöhe', 'Die Aufbauhöhe bestimmt den Estrich — und der kommt zuerst.',
   'Fliesen, Parkett und Vinyl bauen unterschiedlich hoch auf. Diese Höhe geht in die Estrichdicke ein, und die wiederum in die Höhe der Türen und der Übergänge zwischen den Räumen. Deshalb wird der Belag ausgewählt, bevor der Estrich eingebracht wird, auch wenn er erst Monate später verlegt wird. Was du später bereust: unterschiedliche Beläge in angrenzenden Räumen ohne geplanten Höhenausgleich — die Stufe im Türrahmen bleibt.',
   't26', 15, 'werktage', 100),
  ('fliesen', 'Fliesen: Auswahl und Verlegemuster', 'Der häufigste Grund für Verzug im Innenausbau. Fliesen sind Lagerware oder eben nicht.',
   'Entscheide früher, als es sich anfühlt: Zwischen Aussuchen und Verlegen liegen Bemusterung, Bestellung und Lieferung, und bei Sonderformaten sind das schnell zwei Monate. Neben der Fliese selbst gehören zwei Dinge dazu: das Verlegemuster, das bestimmt, wo die Schnitte landen, und die Fugenfarbe, die das Bild stärker verändert als die meisten erwarten. Was du später bereust: eine schmale Restreihe in der Sichtachse, weil kein Verlegeplan gemacht wurde.',
   't28', 40, 'werktage', 110),
  ('innentueren', 'Innentüren: Modell, Zargen, Beschläge', 'Lange Lieferzeiten, und die Zargen brauchen das Maß aus dem Rohbau.',
   'Türblatt, Zarge und Beschlag werden zusammen bestellt und zusammen geliefert. Die Zargenbreite hängt an der fertigen Wandstärke, also an Putz und Estrichaufbau — deshalb wird nach dem Rohbau aufgemessen. Denk an die Details, die man erst im Alltag merkt: Türen, die in den Raum oder aus ihm heraus aufgehen, Lichtausschnitte in dunklen Fluren, Schwellen bei bodengleichen Übergängen. Was du später bereust: eine Standardhöhe, die nicht zur Deckenhöhe passt, oder fehlende Lüftungsspalte bei kontrollierter Wohnraumlüftung.',
   't29', 50, 'werktage', 120),
  ('treppe', 'Treppe: Material und Geländer', 'Aufgemessen wird am Rohbau, gefertigt wird danach — beides braucht Zeit.',
   'Die Treppe ist ein Möbelstück und wird für deinen Rohbau gebaut. Material und Bauart bestimmen den Preis stärker als die Größe: Beton mit Belag, Holz eingestemmt oder eine freitragende Konstruktion sind drei verschiedene Welten. Beim Geländer gelten Vorschriften zu Höhe und Abstand, die nicht verhandelbar sind. Was du später bereust: eine offene Treppe ohne Setzstufen im Haus mit kleinen Kindern, und eine Wahl, die den Schallschutz nicht berücksichtigt — eine Holztreppe überträgt jeden Schritt.',
   't32', 50, 'werktage', 130),
  ('aussenanlagen', 'Außenanlagen: Zufahrt, Terrasse, Zaun', 'Das Letzte am Bau, und regelmäßig das, wofür das Geld nicht mehr reicht.',
   'Plan die Außenanlagen früh, auch wenn sie zuletzt gebaut werden: Zufahrt, Stellplätze, Terrasse, Wege und Einfriedung summieren sich zu einem fünfstelligen Betrag, der in vielen Baubeschreibungen gar nicht enthalten ist. Kläre nebenbei zwei Dinge, die Vorlauf brauchen: die Entwässerung des Niederschlagswassers, für die es kommunale Vorgaben gibt, und Leerrohre für Außensteckdosen und Licht, solange der Graben noch offen ist. Was du später bereust: gepflastert zu haben, bevor die letzten schweren Fahrzeuge auf dem Grundstück waren.',
   't35', 25, 'werktage', 140)
on conflict (key) do nothing;


-- ===========================================================================
--  Abschnitt: 0009_tagebuch.sql
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- MeinBaulotse — Tagebuch, Fotos und Wetter (Arbeitspaket 5)
--
-- Abschnitt 3.8: „Der Nutzer erlebt davon nichts. Er sieht ein Fotoalbum
-- seiner Baustelle. Die Beweisqualität ist ein Nebenprodukt."
--
-- Genau deshalb steht die Beweisqualität hier unten in der Datenbank und
-- nicht in der Oberfläche. Sie besteht aus drei Dingen:
--
-- 1. **24 Stunden Bearbeitungszeit, dann versiegelt.** Wer am Abend etwas
--    nachträgt, korrigiert sich; wer nach drei Wochen etwas ändert, schreibt
--    Geschichte um. Die Grenze dazwischen muss die Datenbank ziehen.
-- 2. **Eine Hash-Kette.** Jeder versiegelte Eintrag trägt die Prüfsumme des
--    vorherigen in seiner eigenen. Ein geänderter Eintrag bricht damit alle
--    folgenden — und das ist der Unterschied zwischen „unveränderlich, weil
--    wir es versprechen" und „nachweisbar unverändert".
-- 3. **Getrennte Zeitangaben beim Foto.** Was die Kamera sagt (`exif_taken_at`)
--    und was der Nutzer sagt (`stated_date`) stehen nebeneinander. Weichen sie
--    ab, wird das angezeigt und nicht versteckt.
--
-- Gelöscht wird nichts. Ein zurückgezogener Eintrag bleibt sichtbar und trägt
-- den Vermerk — eine Akte mit Lücken ist keine Akte.
-- ---------------------------------------------------------------------------

create type mbl.weather_source as enum ('dwd', 'manuell', 'keine');

create table diary_entry (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references project (id) on delete cascade,
  entry_date        date not null,
  body              text not null,
  author_member_id  uuid references project_member (id) on delete set null,
  author_role       mbl.member_role,
  weather           jsonb,
  weather_source    mbl.weather_source not null default 'keine',
  task_ids          uuid[] not null default '{}',
  -- Versiegelung
  locked_at         timestamptz,
  content_hash      text,
  prev_hash         text,
  -- Rückzug statt Löschung
  retracted_at      timestamptz,
  retraction_reason text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint diary_body_not_empty check (length(btrim(body)) > 0),
  constraint diary_sealed_has_hash check (locked_at is null or content_hash is not null),
  constraint diary_retraction_has_reason
    check (retracted_at is null or length(btrim(coalesce(retraction_reason, ''))) > 0)
);
create index diary_entry_project_idx on diary_entry (project_id, entry_date desc);
create index diary_entry_chain_idx on diary_entry (project_id, locked_at)
  where locked_at is not null;

comment on table diary_entry is
  'Bautagebuch nach Abschnitt 3.8. Nach locked_at unveränderlich, verkettet '
  'über content_hash und prev_hash.';
comment on column diary_entry.weather is
  'Zum Zeitpunkt des Eintrags eingefroren. Wetter von gestern lässt sich '
  'später nicht mehr abrufen, und ein nachgeholter Wert wäre keine Aussage '
  'über den Tag, sondern über den Abruf.';

create table media (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references project (id) on delete cascade,
  diary_entry_id   uuid references diary_entry (id) on delete set null,
  task_id          uuid references task (id) on delete set null,
  storage_path     text not null,
  mime             text not null,
  bytes            bigint not null,
  sha256           text not null,
  -- Was die Kamera sagt …
  exif_taken_at    timestamptz,
  exif_lat         numeric(9,6),
  exif_lon         numeric(9,6),
  -- … und was der Mensch sagt. Beides nebeneinander, nie ineinander.
  stated_date      date,
  caption          text,
  /** Erfüllt einen Fotoauftrag der Lotsenkarte: `<kartenschlüssel>#<index>`. */
  photo_prompt_key text,
  uploaded_by      uuid references project_member (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint media_bytes_positive check (bytes > 0),
  constraint media_sha256_form check (sha256 ~ '^[0-9a-f]{64}$'),
  unique (project_id, sha256)
);
create index media_project_idx on media (project_id, created_at desc);
create index media_entry_idx on media (diary_entry_id) where diary_entry_id is not null;
create index media_task_idx on media (task_id) where task_id is not null;
create index media_prompt_idx on media (project_id, photo_prompt_key)
  where photo_prompt_key is not null;

comment on column media.sha256 is
  'Prüfsumme des Originals, im Browser gerechnet. Sie ist zugleich der '
  'Schutz gegen Doppelablage: dasselbe Foto zweimal hochgeladen ist ein '
  'Eintrag, kein zweiter.';

do $$
declare
  target text;
begin
  foreach target in array array['diary_entry','media']
  loop
    execute format(
      'create trigger %I before update on %I for each row execute function mbl.touch_updated_at()',
      target || '_touch_updated_at', target
    );
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- Invariante 3.8: versiegelt heißt unveränderlich
--
-- Nach `locked_at` sind nur noch `retracted_at` und `retraction_reason`
-- änderbar. Der Trigger vergleicht die ganze Zeile statt einer Spaltenliste —
-- eine Liste wäre bei der nächsten Erweiterung still unvollständig, und die
-- neue Spalte wäre dann ausgerechnet die änderbare.
-- ---------------------------------------------------------------------------

create or replace function mbl.guard_diary_entry()
returns trigger
language plpgsql
as $$
declare
  vorher jsonb;
  nachher jsonb;
begin
  if tg_op = 'DELETE' then
    raise exception 'Ein Tagebucheintrag wird nicht gelöscht.'
      using errcode = 'raise_exception',
            hint = 'Zieh ihn zurück; er bleibt dann sichtbar und trägt den Vermerk.';
  end if;

  if old.locked_at is null then
    return new;
  end if;

  vorher  := to_jsonb(old) - 'retracted_at' - 'retraction_reason' - 'updated_at';
  nachher := to_jsonb(new) - 'retracted_at' - 'retraction_reason' - 'updated_at';

  if vorher is distinct from nachher then
    raise exception 'Dieser Eintrag ist seit % versiegelt und ändert sich nicht mehr.', old.locked_at
      using errcode = 'raise_exception',
            hint = 'Schreib einen neuen Eintrag, der den alten richtigstellt.';
  end if;

  -- Ein Rückzug lässt sich nicht zurücknehmen: Sonst wäre er ein Schalter
  -- und keine Aussage.
  if old.retracted_at is not null and new.retracted_at is null then
    raise exception 'Ein zurückgezogener Eintrag bleibt zurückgezogen.'
      using errcode = 'raise_exception';
  end if;

  return new;
end
$$;

create trigger diary_entry_sealed
  before update or delete on diary_entry
  for each row execute function mbl.guard_diary_entry();

-- ---------------------------------------------------------------------------
-- Die Hash-Kette
--
-- `content_hash = sha256(prev_hash || kanonischer_inhalt)`.
--
-- Kanonisch ist hier `jsonb`: Postgres speichert es mit sortierten Schlüsseln
-- und ohne Leerraum, die Textfassung ist damit für gleiche Werte identisch.
-- Ausgenommen sind die Felder, die zur Kette selbst gehören oder sich danach
-- noch ändern dürfen — sonst hinge die Prüfsumme an ihrem eigenen Ergebnis.
-- ---------------------------------------------------------------------------

create or replace function mbl.diary_canonical(entry diary_entry)
returns text
language sql
immutable
as $$
  select (
    to_jsonb(entry)
      - 'content_hash' - 'prev_hash' - 'locked_at' - 'updated_at'
      - 'retracted_at' - 'retraction_reason'
  )::text
$$;

create or replace function mbl.seal_diary_entry(p_entry uuid)
returns diary_entry
language plpgsql
security definer
set search_path = mbl, public, auth
as $$
declare
  eintrag diary_entry;
  vorheriger text;
  neuer_hash text;
begin
  select * into eintrag from diary_entry where id = p_entry;
  if not found then
    raise exception 'Diesen Tagebucheintrag gibt es nicht.';
  end if;
  if eintrag.locked_at is not null then
    return eintrag;
  end if;

  -- Der letzte versiegelte Eintrag desselben Bauvorhabens.
  select diary_entry.content_hash into vorheriger
    from diary_entry
   where diary_entry.project_id = eintrag.project_id and diary_entry.locked_at is not null
   order by diary_entry.locked_at desc, diary_entry.id desc
   limit 1;

  neuer_hash := encode(
    digest(coalesce(vorheriger, '') || mbl.diary_canonical(eintrag), 'sha256'),
    'hex'
  );

  update diary_entry
     set locked_at = now(), prev_hash = vorheriger, content_hash = neuer_hash
   where id = p_entry
   returning * into eintrag;

  return eintrag;
end
$$;

/**
 * Versiegelt, was älter als 24 Stunden ist.
 *
 * Wird beim Lesen und beim Schreiben des Tagebuchs aufgerufen. Ein eigener
 * Zeitgeber wäre eine weitere Stelle, die laufen muss, damit die Akte
 * stimmt — und die dann irgendwann nicht läuft.
 */
create or replace function mbl.seal_due_diary_entries(p_project uuid)
returns int
language plpgsql
security definer
set search_path = mbl, public, auth
as $$
declare
  faellig uuid;
  anzahl int := 0;
begin
  for faellig in
    select id from diary_entry
     where project_id = p_project
       and locked_at is null
       and created_at < now() - interval '24 hours'
     order by created_at, id
  loop
    perform mbl.seal_diary_entry(faellig);
    anzahl := anzahl + 1;
  end loop;
  return anzahl;
end
$$;

/**
 * Prüft die Kette und nennt den ersten Bruch.
 *
 * Gibt eine Zeile je versiegeltem Eintrag zurück, in der Reihenfolge der
 * Versiegelung. `ok = false` heißt: Der gespeicherte Hash passt nicht zum
 * Inhalt, oder die Verkettung stimmt nicht.
 */
-- Die Ausgabespalten tragen ein `out_`-Präfix. Ohne das verdeckt der
-- Parameter `locked_at` die gleichnamige Tabellenspalte, und Postgres bricht
-- die Abfrage als mehrdeutig ab — ein Fehler, den erst der erste Aufruf zeigt.
create or replace function mbl.verify_diary_chain(p_project uuid)
returns table (out_entry_id uuid, out_entry_date date, out_locked_at timestamptz,
               out_ok boolean, out_grund text)
language plpgsql
security definer
set search_path = mbl, public, auth
as $$
declare
  eintrag diary_entry;
  erwartet text;
  vorheriger text := null;
begin
  for eintrag in
    select * from diary_entry
     where project_id = p_project and diary_entry.locked_at is not null
     order by diary_entry.locked_at, diary_entry.id
  loop
    erwartet := encode(
      digest(coalesce(vorheriger, '') || mbl.diary_canonical(eintrag), 'sha256'),
      'hex'
    );

    out_entry_id := eintrag.id;
    out_entry_date := eintrag.entry_date;
    out_locked_at := eintrag.locked_at;

    if eintrag.prev_hash is distinct from vorheriger then
      out_ok := false;
      out_grund := 'Die Verkettung zum vorherigen Eintrag stimmt nicht.';
    elsif eintrag.content_hash is distinct from erwartet then
      out_ok := false;
      out_grund := 'Der Inhalt passt nicht zur gespeicherten Prüfsumme.';
    else
      out_ok := true;
      out_grund := null;
    end if;

    return next;
    vorheriger := eintrag.content_hash;
  end loop;
end
$$;

-- Rechte und RLS -----------------------------------------------------------

grant select, insert, update on diary_entry to authenticated;
grant select, insert, update on media to authenticated;

alter table diary_entry enable row level security;
alter table media       enable row level security;

create policy diary_entry_read on diary_entry for select to authenticated
  using (mbl.is_member(project_id));

-- Tagebuch schreiben dürfen owner, co_owner, contractor und expert
-- (Rechtematrix 2.2). Der Verfasser trägt sich selbst ein, niemand sonst:
-- Ein Eintrag im Namen eines anderen wäre in einer Akte wertlos.
create policy diary_entry_write on diary_entry for insert to authenticated
  with check (
    mbl.has_perm(project_id, 'diary.write')
    and author_member_id = mbl.current_member_id(project_id)
  );

-- Ändern darf nur der Verfasser, und nur solange nichts versiegelt ist. Was
-- die Policy erlaubt, begrenzt der Trigger zusätzlich — „fremden Eintrag
-- ändern" steht in der Rechtematrix bei **keiner** Rolle.
create policy diary_entry_update on diary_entry for update to authenticated
  using (
    mbl.has_perm(project_id, 'diary.write')
    and author_member_id = mbl.current_member_id(project_id)
  )
  with check (author_member_id = mbl.current_member_id(project_id));

create policy media_read on media for select to authenticated
  using (mbl.is_member(project_id));

create policy media_write on media for insert to authenticated
  with check (mbl.has_perm(project_id, 'diary.write'));

-- Die Bildunterschrift darf man nachtragen, das Foto selbst nicht ersetzen:
-- Pfad und Prüfsumme bleiben, wie sie sind (siehe Trigger).
create policy media_update on media for update to authenticated
  using (mbl.has_perm(project_id, 'diary.write'))
  with check (mbl.has_perm(project_id, 'diary.write'));

create or replace function mbl.guard_media()
returns trigger
language plpgsql
as $$
begin
  if new.storage_path is distinct from old.storage_path
     or new.sha256 is distinct from old.sha256
     or new.bytes is distinct from old.bytes
     or new.exif_taken_at is distinct from old.exif_taken_at then
    raise exception 'Ein hochgeladenes Foto wird nicht ausgetauscht.'
      using errcode = 'raise_exception',
            hint = 'Lade das andere Foto als neues hoch.';
  end if;
  return new;
end
$$;

create trigger media_immutable_original
  before update on media
  for each row execute function mbl.guard_media();

grant execute on all functions in schema mbl to anon, authenticated;


-- ===========================================================================
--  Abschnitt: 0010_ablage.sql
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- MeinBaulotse — die Ablage für Fotos (Arbeitspaket 5)
--
-- Abschnitt 6.1: „Dateien: S3-kompatibel, signierte Upload-URLs — Fotos gehen
-- nie durch den Anwendungsserver." Genommen wird die Ablage des
-- Supabase-Projekts, in dem auch die Datenbank liegt. Der Browser lädt mit
-- der Sitzung des Nutzers hoch; wer worauf zugreifen darf, entscheiden
-- dieselben Hilfsfunktionen wie in der Datenbank.
--
-- Der Pfad ist die Rechteprüfung: `<projektkennung>/<prüfsumme>.jpg`. Aus dem
-- ersten Abschnitt ergibt sich das Bauvorhaben, und `mbl.is_member` sagt, ob
-- der Fragende dazugehört. Ein flacher Namensraum ohne diese Struktur ließe
-- sich nicht absichern, ohne für jede Datei eine Tabellenzeile zu lesen.
--
-- **Der ganze Abschnitt läuft nur dort, wo es das Schema `storage` gibt.**
-- Lokal steht ein nacktes Postgres, das keine Ablage kennt; die Migration
-- darf dort trotzdem nicht scheitern, sonst weicht die lokale Einrichtung von
-- der im Betrieb ab — und genau das kostet später einen Abend.
-- ---------------------------------------------------------------------------

/**
 * Zu welchem Bauvorhaben gehört diese Datei?
 *
 * Steht hier und nicht in der Policy, damit ein unsinniger Pfad nicht die
 * ganze Abfrage abbricht: Was nicht wie eine Kennung aussieht, ist `null`,
 * und `null` gehört zu keinem Bauvorhaben.
 */
create or replace function mbl.storage_project(p_name text)
returns uuid
language sql
immutable
as $$
  select case
    when split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(p_name, '/', 1)::uuid
  end
$$;

do $$
begin
  if not exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    raise notice 'Kein Schema storage — die Ablage wird übersprungen (lokale Entwicklung).';
    return;
  end if;

  -- Der Eimer. Nicht öffentlich: Jede Ansicht läuft über eine signierte,
  -- befristete Adresse (Abschnitt 6.4).
  execute $sql$
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('bauakte', 'bauakte', false, 26214400,
            array['image/jpeg','image/png','image/heic','image/webp'])
    on conflict (id) do nothing
  $sql$;

  -- Lesen darf jedes Mitglied des Bauvorhabens.
  if not exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects' and policyname = 'bauakte_read'
  ) then
    execute $sql$
      create policy bauakte_read on storage.objects for select to authenticated
        using (bucket_id = 'bauakte' and mbl.is_member(mbl.storage_project(name)))
    $sql$;
  end if;

  -- Hochladen darf, wer auch ins Tagebuch schreibt (Rechtematrix 2.2).
  if not exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects' and policyname = 'bauakte_write'
  ) then
    execute $sql$
      create policy bauakte_write on storage.objects for insert to authenticated
        with check (
          bucket_id = 'bauakte'
          and mbl.has_perm(mbl.storage_project(name), 'diary.write')
        )
    $sql$;
  end if;

  -- Überschreiben nur denselben Pfad — und derselbe Pfad ist dieselbe
  -- Prüfsumme, also dasselbe Bild. Das ist das Ende eines abgebrochenen
  -- Uploads, kein Austausch.
  if not exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects' and policyname = 'bauakte_update'
  ) then
    execute $sql$
      create policy bauakte_update on storage.objects for update to authenticated
        using (
          bucket_id = 'bauakte'
          and mbl.has_perm(mbl.storage_project(name), 'diary.write')
        )
    $sql$;
  end if;

  -- Es gibt bewusst **keine** DELETE-Policy. Ein Foto aus der Bauakte zu
  -- löschen, hieße eine Lücke zu hinterlassen, die niemand mehr erklären
  -- kann. Wer ein Bild nicht mehr sehen will, zieht den Eintrag zurück.
end
$$;

grant execute on all functions in schema mbl to anon, authenticated;


-- ===========================================================================
--  Abschnitt: 0011_gastzugang.sql
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- MeinBaulotse — Gast-Zugang und Terminabstimmung (Arbeitspaket 6)
--
-- Abschnitt 2.3: „Signierter Token im Link, projekt- und rollen-scoped. Kein
-- Passwort, keine Registrierung." Der Grund steht in Leitsatz 1.6.2: Keine
-- Funktion darf die Mitwirkung des GU voraussetzen — und nichts setzt sie so
-- sicher voraus wie ein Anmeldeverfahren. Ein Bauleiter, der ein Konto
-- anlegen soll, um einen Termin zu bestätigen, bestätigt keinen Termin.
--
-- In 0002 steht der Satz, an dem sich diese Migration messen lassen muss:
--
--   „Der Gast-Zugang aus AP 6 wird ausschließlich `mbl.current_user_id()` und
--    `mbl.current_member_id()` erweitern; keine einzige Policy muss dafür
--    angefasst werden."
--
-- Genau das passiert hier. Alle Policies der Anwendung bleiben unberührt: Ein
-- Gast ist für die Datenbank ein Mitglied wie jedes andere, nur eben eines,
-- das sich mit einem Token ausweist statt mit einem Konto.
-- ---------------------------------------------------------------------------

create table guest_token (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references project (id) on delete cascade,
  member_id         uuid not null references project_member (id) on delete cascade,
  -- Nur der Hash. Wer die Datenbank liest, kann damit keinen Link bauen
  -- (Abschnitt 6.4).
  token_hash        text not null unique,
  scopes            text[] not null default '{}',
  locale            text not null default 'de',
  -- An wen der Link ging. Wird der Token von woanders benutzt, steht das im
  -- Protokoll — gesperrt wird deswegen nicht, denn Bauleiter leiten Links
  -- weiter, und das ist meistens richtig so.
  sent_to           text,
  expires_at        timestamptz not null default now() + interval '180 days',
  last_used_at      timestamptz,
  use_count         int not null default 0,
  -- Ratenbegrenzung: ein Zeitfenster und ein Zähler darin.
  window_started_at timestamptz,
  window_count      int not null default 0,
  revoked_at        timestamptz,
  created_by        uuid references project_member (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint guest_token_locale check (locale in ('de','en','pl','ro','tr'))
);
create index guest_token_member_idx on guest_token (member_id) where revoked_at is null;
create index guest_token_project_idx on guest_token (project_id);

comment on table guest_token is
  'Zugang ohne Konto nach Abschnitt 2.3. Der Token steht nur im Link; hier '
  'liegt sein Hash.';

create trigger guest_token_touch_updated_at
  before update on guest_token
  for each row execute function mbl.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Die Erweiterung, die 0002 angekündigt hat
--
-- `mbl.current_member_id` kennt jetzt zwei Wege zur Mitgliedschaft: ein Konto
-- (`auth.uid()`) oder einen gültigen Gast-Token. Die Gültigkeit prüft die
-- Datenbank selbst — ein abgelaufener oder gesperrter Token ist damit auch
-- dann wertlos, wenn der Anwendungscode ihn durchwinkt.
-- ---------------------------------------------------------------------------

-- Der Wert kommt aus einem JWT-Claim und ist damit alles, was jemand
-- hineinschreiben kann. Deshalb wird er geprüft statt gecastet: Was nicht wie
-- eine Kennung aussieht, ist `null` — und `null` gehört zu keinem Token.
create or replace function mbl.current_guest_token()
returns uuid
language sql
stable
as $$
  select case
    when coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'mbl_token', '')
         ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'mbl_token')::uuid
  end
$$;

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
      -- Neu: der Weg über einen gültigen Gast-Token.
      or exists (
        select 1 from guest_token g
        where g.member_id = m.id
          and g.id = mbl.current_guest_token()
          and g.revoked_at is null
          and g.expires_at > now()
      )
    )
  -- Direkte Mitgliedschaft schlägt die Mitgliedschaft über eine Organisation.
  order by (m.user_id = auth.uid()) desc
  limit 1
$$;

-- ---------------------------------------------------------------------------
-- Bestätigungsgrad (Abschnitt 3.4)
--
-- Vier Zustände, und der Übergang zwischen ihnen ist eine Aussage über die
-- Datenlage, nicht über Schuld:
--
--   self_stated          nur eine Seite hat den Termin erfasst
--   counterparty_stated  vom GU genannt, nicht gegenbestätigt
--   mutual               beide Seiten haben bestätigt
--   disputed             die Gegenseite hat einen anderen Termin genannt
--
-- Die Wortwahl in der Oberfläche ist Absicht: „abgestimmt" statt „quittiert",
-- „zwei Angaben" statt „strittig". Dieselbe Datenlage, ein anderer Ton.
-- ---------------------------------------------------------------------------

create type mbl.confirmation_action as enum ('bestaetigt', 'gegenvorschlag');

/**
 * Ein Gegenvorschlag ist **keine** Terminänderung.
 *
 * Er wird festgehalten, nicht ausgeführt: Der Plan gehört dem Bauherrn. Wer
 * widerspricht, erzeugt zwei Angaben — und die Entscheidung darüber trifft
 * ein Mensch, nicht der Kalender.
 */
create table task_confirmation (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references project (id) on delete cascade,
  task_id        uuid not null references task (id) on delete cascade,
  member_id      uuid not null references project_member (id) on delete cascade,
  action         mbl.confirmation_action not null,
  /** Der Termin, auf den sich die Aussage bezieht. */
  stated_start   date,
  stated_end     date,
  /** Beim Gegenvorschlag: der Termin, den die Gegenseite nennt. */
  proposed_start date,
  proposed_end   date,
  note           text,
  actor_channel  mbl.actor_channel not null default 'app',
  created_at     timestamptz not null default now(),
  constraint task_confirmation_proposal
    check (action <> 'gegenvorschlag' or proposed_start is not null)
);
create index task_confirmation_task_idx on task_confirmation (task_id, created_at desc);

comment on table task_confirmation is
  'Append-only wie die Historie: Wer einmal zugestimmt hat, hat zugestimmt. '
  'Eine Meinungsänderung ist ein neuer Eintrag.';

-- Append-only, aus demselben Grund wie schedule_change.
create or replace function mbl.forbid_confirmation_change()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Eine Rückmeldung zum Termin ist append-only.'
    using errcode = 'raise_exception',
          hint = 'Gib eine neue Rückmeldung ab; die alte bleibt stehen.';
end
$$;

create trigger task_confirmation_append_only
  before update or delete on task_confirmation
  for each row execute function mbl.forbid_confirmation_change();

-- ---------------------------------------------------------------------------
-- Einen Token einlösen
--
-- Der einzige Zugriff im ganzen Produkt, der ohne Mitgliedschaft auskommen
-- muss — sonst käme man nie hinein. Deshalb steht er als `security definer`
-- in der Datenbank und nicht als privilegierte Abfrage im Anwendungscode:
-- Die Funktion gibt **nur zu einem gültigen Hash** etwas heraus und ist damit
-- kein Schlüssel, sondern ein Schloss.
--
-- Sie zählt die Nutzung gleich mit. Die Ratenbegrenzung aus Abschnitt 2.3
-- läuft über ein Zeitfenster von einer Minute; wer darüber liegt, bekommt den
-- Kontext trotzdem, aber mit `zu_oft = true`. Die Unterscheidung ist wichtig:
-- Ein überlastender Aufrufer soll abgewiesen werden, ein Bauleiter mit
-- hektischem Daumen soll wissen, warum.
-- ---------------------------------------------------------------------------

create or replace function mbl.use_guest_token(p_hash text, p_limit int default 30)
returns table (
  token_id uuid, project_id uuid, member_id uuid, role text,
  display_name text, scopes text[], locale text, zu_oft boolean
)
language plpgsql
security definer
set search_path = mbl, public, auth
as $$
declare
  g guest_token;
  m project_member;
  fenster_neu boolean;
begin
  select * into g from guest_token
   where guest_token.token_hash = p_hash
     and guest_token.revoked_at is null
     and guest_token.expires_at > now();
  if not found then
    return;
  end if;

  select * into m from project_member where project_member.id = g.member_id;
  if not found or m.revoked_at is not null then
    return;
  end if;

  fenster_neu := g.window_started_at is null or g.window_started_at < now() - interval '1 minute';

  update guest_token
     set last_used_at = now(),
         use_count = guest_token.use_count + 1,
         window_started_at = case when fenster_neu then now() else guest_token.window_started_at end,
         window_count = case when fenster_neu then 1 else guest_token.window_count + 1 end
   where guest_token.id = g.id
   returning * into g;

  token_id := g.id;
  project_id := g.project_id;
  member_id := g.member_id;
  role := m.role::text;
  display_name := m.display_name;
  scopes := g.scopes;
  locale := g.locale;
  zu_oft := g.window_count > p_limit;
  return next;
end
$$;

-- Rechte und RLS -----------------------------------------------------------

grant select, insert, update on guest_token to authenticated;
grant select, insert on task_confirmation to authenticated;

alter table guest_token       enable row level security;
alter table task_confirmation enable row level security;

-- Einladen darf, wer auch Mitglieder einlädt — ein Gast-Link ist nichts
-- anderes als eine Einladung ohne Konto (Rechtematrix 2.2).
create policy guest_token_read on guest_token for select to authenticated
  using (mbl.has_perm(project_id, 'member.invite'));

create policy guest_token_create on guest_token for insert to authenticated
  with check (mbl.has_perm(project_id, 'member.invite'));

-- Ändern heißt hier: sperren, und die Nutzung mitzählen. Deshalb darf es auch
-- der Gast selbst — sonst könnte er seinen eigenen Zugriff nicht protokollieren.
create policy guest_token_update on guest_token for update to authenticated
  using (mbl.has_perm(project_id, 'member.invite') or id = mbl.current_guest_token())
  with check (mbl.has_perm(project_id, 'member.invite') or id = mbl.current_guest_token());

create policy task_confirmation_read on task_confirmation for select to authenticated
  using (mbl.is_member(project_id));

-- Bestätigen darf, wer laut Rechtematrix Termine bestätigt — und ein
-- Einzelgewerk nur am eigenen Vorgang.
create policy task_confirmation_write on task_confirmation for insert to authenticated
  with check (
    mbl.has_perm(project_id, 'task.confirm')
    and mbl.task_visible(task_id)
    and member_id = mbl.current_member_id(project_id)
  );

grant execute on all functions in schema mbl to anon, authenticated;

