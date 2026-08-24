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
