-- ---------------------------------------------------------------------------
-- MeinBaulotse — Mängel, Geld und Vertragsspiegel (Arbeitspaket 8)
--
-- Die drei Themen stehen in einer Datei, weil sie zusammen erst einen Sinn
-- ergeben: Ein Mangel ist die Begründung für einen Einbehalt, ein Einbehalt
-- ist die Folge eines Zahlungsplans, und ob der Zahlungsplan zulässig ist,
-- sagt der Vertragsspiegel.
--
-- Die Rechte dazu stehen bereits in der Rechtematrix aus 0003 — `defect.write`,
-- `defect.resolve`, `defect.resolve.propose`, `payment.release`,
-- `contract.write`. Sie warten dort seit dem ersten Tag; hier bekommen sie
-- ihre Tabellen.
--
-- Der Grundsatz aus Abschnitt 3.9 gilt in dieser ganzen Datei: **Hinweise,
-- nie Bewertungen.** Die Datenbank sagt, was der Fall ist und welche Stelle
-- dazu gehört. Was daraus folgt, entscheidet ein Mensch.
-- ---------------------------------------------------------------------------

create type mbl.defect_severity as enum ('geringfuegig', 'wesentlich');

/**
 * Die Zustände eines Mangels.
 *
 * `strittig` ist der wichtigste: Er hält fest, dass zwei Seiten es
 * unterschiedlich sehen, ohne zu entscheiden, wer recht hat. Dieselbe Haltung
 * wie bei den Terminen — „zwei Angaben" statt „Konflikt".
 */
create type mbl.defect_status as enum (
  'offen', 'anerkannt', 'behoben_gemeldet', 'behoben', 'strittig', 'zurueckgestellt'
);

create table defect (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid not null references project (id) on delete cascade,
  task_id              uuid references task (id) on delete set null,
  trade_id             uuid references trade (id) on delete set null,
  title                text not null,
  description          text,
  location_text        text,
  severity             mbl.defect_severity not null default 'geringfuegig',
  reported_at          timestamptz not null default now(),
  /** Die Frist zur Beseitigung. Ohne Frist gibt es keine Folgen (§ 637 BGB). */
  deadline             date,
  status               mbl.defect_status not null default 'offen',
  /** Wie weit die Sache gediehen ist — siehe mbl.defect_next_step. */
  escalation_level     int not null default 0,
  resolved_at          timestamptz,
  accepted_at          timestamptz,
  /** Bei der Abnahme vorbehalten (§ 640 Abs. 3 BGB). */
  reserved_at_handover boolean not null default false,
  reported_by          uuid references project_member (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint defect_title_not_empty check (length(btrim(title)) > 0),
  constraint defect_escalation_range check (escalation_level between 0 and 4)
);
create index defect_project_idx on defect (project_id, status, deadline);
create index defect_task_idx on defect (task_id) where task_id is not null;

create trigger defect_touch_updated_at
  before update on defect
  for each row execute function mbl.touch_updated_at();

/**
 * Was mit einem Mangel geschehen ist — append-only.
 *
 * Bei Streit ist nicht der heutige Stand die Frage, sondern wann angezeigt
 * wurde, welche Frist lief und was die Gegenseite gesagt hat. Ein Feld
 * `status`, das überschrieben wird, beantwortet davon nichts.
 */
create table defect_event (
  id            uuid primary key default gen_random_uuid(),
  defect_id     uuid not null references defect (id) on delete cascade,
  project_id    uuid not null references project (id) on delete cascade,
  action        text not null,
  note          text,
  old_status    mbl.defect_status,
  new_status    mbl.defect_status,
  actor_member_id uuid references project_member (id) on delete set null,
  actor_role    mbl.member_role,
  actor_channel mbl.actor_channel not null default 'app',
  created_at    timestamptz not null default now()
);
create index defect_event_idx on defect_event (defect_id, created_at);

create or replace function mbl.forbid_defect_event_change()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Der Verlauf eines Mangels ist append-only.'
    using errcode = 'raise_exception',
          hint = 'Trag den neuen Stand ein; der alte bleibt stehen.';
end
$$;

create trigger defect_event_append_only
  before update or delete on defect_event
  for each row execute function mbl.forbid_defect_event_change();

/**
 * Jede Änderung am Mangel schreibt ihren Eintrag selbst.
 *
 * Aus demselben Grund wie bei `schedule_change`: Ein Protokoll, das der
 * Anwendungscode führen muss, ist eines, das er vergessen kann — und zwar
 * genau in dem Zweig, den niemand getestet hat.
 */
create or replace function mbl.log_defect_change()
returns trigger
language plpgsql
security definer
set search_path = mbl, public, auth
as $$
declare
  m project_member;
begin
  select * into m from project_member
   where id = coalesce(mbl.current_member_id(new.project_id), new.reported_by);

  if tg_op = 'INSERT' then
    insert into defect_event (defect_id, project_id, action, new_status,
                              actor_member_id, actor_role, note)
    values (new.id, new.project_id, 'erfasst', new.status, m.id, m.role, new.title);
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into defect_event (defect_id, project_id, action, old_status, new_status,
                              actor_member_id, actor_role)
    values (new.id, new.project_id, 'stand', old.status, new.status, m.id, m.role);
  end if;

  if new.deadline is distinct from old.deadline then
    insert into defect_event (defect_id, project_id, action, actor_member_id, actor_role, note)
    values (new.id, new.project_id, 'frist', m.id, m.role,
            coalesce(new.deadline::text, 'entfernt'));
  end if;

  if new.escalation_level is distinct from old.escalation_level then
    insert into defect_event (defect_id, project_id, action, actor_member_id, actor_role, note)
    values (new.id, new.project_id, 'stufe', m.id, m.role, new.escalation_level::text);
  end if;

  return new;
end
$$;

create trigger defect_log_insert
  after insert on defect
  for each row execute function mbl.log_defect_change();

create trigger defect_log_update
  after update on defect
  for each row execute function mbl.log_defect_change();

-- Fotos gehören auch an einen Mangel, nicht nur an einen Tagebucheintrag.
alter table media add column defect_id uuid references defect (id) on delete set null;
create index media_defect_idx on media (defect_id) where defect_id is not null;

-- ---------------------------------------------------------------------------
-- Geld (Abschnitt 3.10)
-- ---------------------------------------------------------------------------

create type mbl.payment_status as enum (
  'geplant', 'faellig', 'freigegeben', 'teilfreigabe', 'bezahlt'
);

create table payment_milestone (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references project (id) on delete cascade,
  name              text not null,
  /** Anteil an der Gesamtvergütung. Die Summe ist die Prüfung aus 3.9. */
  pct               numeric(5,2),
  amount_cents      bigint,
  /** Welche Vorgänge fertig sein müssen, bevor freigegeben werden darf. */
  requires_task_ids uuid[] not null default '{}',
  invoice_number    text,
  invoice_date      date,
  due_date          date,
  status            mbl.payment_status not null default 'geplant',
  released_by       uuid references project_member (id) on delete set null,
  released_at       timestamptz,
  paid_at           timestamptz,
  withheld_cents    bigint,
  withheld_reason   text,
  sort_order        int not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint payment_pct_range check (pct is null or (pct >= 0 and pct <= 100)),
  -- Ein Einbehalt ohne Grund ist im Streit wertlos: Wer einbehält, muss sagen,
  -- wofür (§ 641 Abs. 3 BGB).
  constraint payment_withheld_reason
    check (withheld_cents is null or length(btrim(coalesce(withheld_reason, ''))) > 0)
);
create index payment_project_idx on payment_milestone (project_id, sort_order);

create trigger payment_touch_updated_at
  before update on payment_milestone
  for each row execute function mbl.touch_updated_at();

/**
 * Was einer Freigabe im Weg steht (Abschnitt 3.10).
 *
 * Gibt Zeilen zurück, keine Wahrheitswerte: Die Oberfläche soll nennen, was
 * fehlt, und nicht bloß „geht nicht" sagen. Eine Sperre ohne Begründung ist
 * für den Bauherrn dasselbe wie ein Fehler.
 */
create or replace function mbl.payment_blockers(p_milestone uuid)
returns table (kind text, label text)
language sql
stable
as $$
  select 'vorgang'::text, t.name
    from payment_milestone pm
    join task t on t.id = any (pm.requires_task_ids)
   where pm.id = p_milestone
     and t.status not in ('fertig', 'abgenommen')
  union all
  select 'mangel'::text, d.title
    from payment_milestone pm
    join defect d on d.project_id = pm.project_id
                 and d.task_id = any (pm.requires_task_ids)
   where pm.id = p_milestone
     and d.severity = 'wesentlich'
     and d.status not in ('behoben', 'zurueckgestellt')
$$;

/**
 * Die Sperre selbst — in der Datenbank, nicht in der Ansicht.
 *
 * Eine Freigabe, die nur die Oberfläche verhindert, verhindert nichts: Es
 * gibt einen zweiten Weg an jede Oberfläche vorbei, und beim Geld ist genau
 * das der Weg, den jemand findet.
 *
 * `teilfreigabe` bleibt erlaubt. Abschnitt 3.10 verlangt sie ausdrücklich —
 * mit Einbehalt und mit Grund, und beides erzwingt der Constraint oben.
 */
create or replace function mbl.guard_payment_release()
returns trigger
language plpgsql
as $$
declare
  hindernis text;
begin
  if new.status = 'freigegeben' and old.status is distinct from 'freigegeben' then
    select string_agg(label, ', ') into hindernis from mbl.payment_blockers(new.id);
    if hindernis is not null then
      raise exception 'Diese Zahlung ist noch nicht freizugeben: %', hindernis
        using errcode = 'raise_exception',
              hint = 'Du kannst einen Teil unter Vorbehalt freigeben und den Rest einbehalten.';
    end if;
  end if;
  return new;
end
$$;

create trigger payment_guard_release
  before update on payment_milestone
  for each row execute function mbl.guard_payment_release();

create type mbl.change_order_status as enum (
  'angefragt', 'vereinbart', 'abgelehnt', 'zurueckgezogen'
);

create table change_order (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references project (id) on delete cascade,
  title             text not null,
  -- Heißt in der Spezifikation `trigger`; das ist in Postgres ein
  -- Schlüsselwort und würde bei jeder Abfrage Anführungszeichen verlangen.
  trigger_text      text,
  bgb_basis         text,
  amount_cents      bigint,
  days_impact       int,
  affected_task_ids uuid[] not null default '{}',
  status            mbl.change_order_status not null default 'angefragt',
  requested_at      timestamptz not null default now(),
  agreed_at         timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index change_order_project_idx on change_order (project_id, status);

create trigger change_order_touch_updated_at
  before update on change_order
  for each row execute function mbl.touch_updated_at();

create table loan_drawdown (
  id                        uuid primary key default gen_random_uuid(),
  project_id                uuid not null references project (id) on delete cascade,
  label                     text,
  amount_cents              bigint not null,
  requested_at              date not null,
  paid_at                   date,
  commitment_interest_cents bigint,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create index loan_project_idx on loan_drawdown (project_id, requested_at);

create trigger loan_touch_updated_at
  before update on loan_drawdown
  for each row execute function mbl.touch_updated_at();

-- Was die Bank für das noch nicht abgerufene Geld verlangt. Steht am Projekt,
-- weil es zum Vertrag gehört und nicht zum einzelnen Abruf.
alter table project add column loan_total_cents bigint;
alter table project add column commitment_interest_pct numeric(5,3);
alter table project add column commitment_free_months int;

-- ---------------------------------------------------------------------------
-- Vertragsspiegel (Abschnitt 3.9)
--
-- Die Prüfregeln stehen im Anwendungscode, ihre Ergebnisse hier: Eine Regel
-- ist Logik und gehört dorthin, wo sie getestet werden kann; ein Befund ist
-- Datenlage und muss beiseitegelegt werden können, ohne bei der nächsten
-- Prüfung wieder aufzupoppen.
-- ---------------------------------------------------------------------------

create table contract_check (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references project (id) on delete cascade,
  rule_key          text not null,
  severity          text not null,
  message           text not null,
  legal_reference   text,
  dismissed_at      timestamptz,
  dismissed_reason  text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint contract_check_unique unique (project_id, rule_key),
  constraint contract_check_dismissal
    check (dismissed_at is null or length(btrim(coalesce(dismissed_reason, ''))) > 0)
);

create trigger contract_check_touch_updated_at
  before update on contract_check
  for each row execute function mbl.touch_updated_at();

/**
 * Die Punkte der Baubeschreibung nach Art. 249 § 2 EGBGB.
 *
 * Was fehlt, kann die Anwendung nicht lesen — sie kennt den Vertrag nicht.
 * Sie kann nur fragen. Deshalb hakt der Bauherr ab, was seine Baubeschreibung
 * enthält, und der Vertragsspiegel nennt den Rest. Solange gar nichts
 * abgehakt ist, sagt er „noch nicht durchgesehen" statt „alles fehlt".
 */
create table contract_description_item (
  project_id uuid not null references project (id) on delete cascade,
  item_key   text not null,
  present    boolean not null default false,
  note       text,
  updated_at timestamptz not null default now(),
  primary key (project_id, item_key)
);

create trigger contract_description_touch_updated_at
  before update on contract_description_item
  for each row execute function mbl.touch_updated_at();

-- Rechte und RLS -----------------------------------------------------------

grant select, insert, update, delete on defect to authenticated;
grant select, insert on defect_event to authenticated;
grant select, insert, update, delete on payment_milestone to authenticated;
grant select, insert, update, delete on change_order to authenticated;
grant select, insert, update, delete on loan_drawdown to authenticated;
grant select, insert, update, delete on contract_check to authenticated;
grant select, insert, update, delete on contract_description_item to authenticated;

alter table defect                    enable row level security;
alter table defect_event              enable row level security;
alter table payment_milestone         enable row level security;
alter table change_order              enable row level security;
alter table loan_drawdown             enable row level security;
alter table contract_check            enable row level security;
alter table contract_description_item enable row level security;

-- Mängel sieht, wer im Projekt ist — ein Einzelgewerk nur die eigenen. Es
-- soll erfahren, was ihm angelastet wird, und sonst nichts.
create policy defect_read on defect for select to authenticated
  using (
    mbl.is_member(project_id)
    and (
      -- Für alle außer `trade` ist das immer wahr; für ein Einzelgewerk ist
      -- es die Grenze auf das eigene Gewerk. Dieselbe Funktion, die schon
      -- die Vorgänge zuschneidet.
      mbl.trade_scope_ok(project_id, trade_id)
      or (task_id is not null and mbl.task_visible(task_id))
    )
  );

create policy defect_write on defect for insert to authenticated
  with check (mbl.has_perm(project_id, 'defect.write'));

-- Ändern darf, wer erfasst — und wer den Stand ändern darf. Beides sind
-- verschiedene Rechte, und beide enden an derselben Zeile.
create policy defect_update on defect for update to authenticated
  using (mbl.has_perm(project_id, 'defect.write') or mbl.has_perm(project_id, 'defect.resolve'))
  with check (mbl.has_perm(project_id, 'defect.write') or mbl.has_perm(project_id, 'defect.resolve'));

create policy defect_delete on defect for delete to authenticated
  using (mbl.has_perm(project_id, 'defect.write'));

create policy defect_event_read on defect_event for select to authenticated
  using (exists (select 1 from defect d where d.id = defect_id));

-- Einen Eintrag von Hand schreibt, wer mitreden darf: Auch ein Vorschlag des
-- Unternehmers gehört in den Verlauf (Rechtematrix 2.2).
create policy defect_event_write on defect_event for insert to authenticated
  with check (
    mbl.has_perm(project_id, 'defect.write')
    or mbl.has_perm(project_id, 'defect.resolve')
    or mbl.has_perm(project_id, 'defect.resolve.propose')
  );

create policy payment_read on payment_milestone for select to authenticated
  using (mbl.has_perm(project_id, 'payment.release') or mbl.has_perm(project_id, 'contract.write'));

create policy payment_write on payment_milestone for all to authenticated
  using (mbl.has_perm(project_id, 'payment.release'))
  with check (mbl.has_perm(project_id, 'payment.release'));

-- Nachträge betreffen Termine und Geld. Lesen darf sie jedes Mitglied, denn
-- sie verschieben den Plan; ändern nur, wer den Vertrag pflegt.
create policy change_order_read on change_order for select to authenticated
  using (mbl.is_member(project_id));

create policy change_order_write on change_order for all to authenticated
  using (mbl.has_perm(project_id, 'contract.write'))
  with check (mbl.has_perm(project_id, 'contract.write'));

-- Darlehen gehen nur den Bauherrn etwas an.
create policy loan_all on loan_drawdown for all to authenticated
  using (mbl.has_perm(project_id, 'payment.release'))
  with check (mbl.has_perm(project_id, 'payment.release'));

create policy contract_check_read on contract_check for select to authenticated
  using (mbl.has_perm(project_id, 'contract.write'));

create policy contract_check_write on contract_check for all to authenticated
  using (mbl.has_perm(project_id, 'contract.write'))
  with check (mbl.has_perm(project_id, 'contract.write'));

create policy contract_description_read on contract_description_item for select to authenticated
  using (mbl.has_perm(project_id, 'contract.write'));

create policy contract_description_write on contract_description_item for all to authenticated
  using (mbl.has_perm(project_id, 'contract.write'))
  with check (mbl.has_perm(project_id, 'contract.write'));

grant execute on all functions in schema mbl to anon, authenticated;
