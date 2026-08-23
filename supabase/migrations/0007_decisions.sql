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
