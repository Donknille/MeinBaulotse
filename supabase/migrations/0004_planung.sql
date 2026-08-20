-- ---------------------------------------------------------------------------
-- MeinBaulotse — Verschieben und Entscheidungsassistent
--
-- Zwei Ergänzungen, die zusammengehören:
--
--   1. `task.pinned_start` — ein von Hand gesetzter Anfangstermin ist eine
--      Beschränkung, kein Ergebnis. Ohne diese Spalte fiele jede Verschiebung
--      bei der nächsten Neuberechnung wieder auf den frühestmöglichen Tag
--      zurück, und der Bauherr fände seine Eingabe stillschweigend verworfen.
--
--   2. `decision` und `decision_template` — Abschnitt 3.2 und 7.3. Die Frist
--      wird nicht gespeichert und gepflegt, sondern aus dem Vorgang gerechnet.
--      Verschiebt sich der Vorgang, verschiebt sich die Frist mit; das ist der
--      ganze Sinn der Sache. `due_date` steht trotzdem in der Tabelle — als
--      abgeleiteter Wert, den die Anwendung bei jeder Neuberechnung mitführt,
--      damit Abfragen nach fälligen Entscheidungen ohne Rechenkern auskommen.
-- ---------------------------------------------------------------------------

-- 1. Von Hand gesetzte Anfangstermine ---------------------------------------

alter table task add column pinned_start date;

comment on column task.pinned_start is
  'Anfangsbeschränkung „nicht früher als", von Hand gesetzt. Geht als '
  'earliestStart in die Vorwärtsrechnung. Null bedeutet: der Vorgang folgt '
  'ausschließlich seinen Vorgängern.';

-- 2. Entscheidungen ---------------------------------------------------------

create type mbl.decision_status as enum (
  'offen','in_bemusterung','entschieden','beauftragt','hinfaellig'
);

create table decision_template (
  key            text primary key,
  title          text not null,
  description    text,
  help_text      text,
  /* Vorgang der Ablaufvorlage, der ohne diese Entscheidung nicht beginnt. */
  blocks_task_code text not null,
  lead_time_days int not null,
  lead_time_unit mbl.duration_unit not null default 'werktage',
  sort_order     int not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint decision_template_lead_nonneg check (lead_time_days >= 0)
);
comment on table decision_template is
  'Entscheidungsvorlagen aus Abschnitt 7.3. Redaktionsinhalt als Daten, nicht '
  'als Konstanten im Code.';

create table decision (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid not null references project (id) on delete cascade,
  template_key         text references decision_template (key) on delete set null,
  title                text not null,
  description          text,
  help_text            text,
  blocks_task_id       uuid references task (id) on delete set null,
  lead_time_days       int not null,
  lead_time_unit       mbl.duration_unit not null default 'werktage',
  /* Abgeleitet aus blocks_task.current_start minus Vorlaufzeit. */
  due_date             date,
  status               mbl.decision_status not null default 'offen',
  decided_at           timestamptz,
  decided_note         text,
  estimated_cost_cents bigint,
  sort_order           int not null default 0,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint decision_lead_nonneg check (lead_time_days >= 0),
  constraint decision_decided_note check (status <> 'entschieden' or decided_at is not null)
);
create index decision_project_idx on decision (project_id, due_date);
create index decision_task_idx on decision (blocks_task_id) where blocks_task_id is not null;
create unique index decision_template_key on decision (project_id, template_key)
  where template_key is not null;

comment on column decision.due_date is
  'Abgeleitet, nicht gepflegt: werktage_vor(task.current_start, lead_time_days). '
  'Die Anwendung schreibt den Wert bei jeder Neuberechnung mit, damit eine '
  'Abfrage nach fälligen Entscheidungen ohne Berechnungskern auskommt.';

-- updated_at ----------------------------------------------------------------

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

-- Rechte und RLS ------------------------------------------------------------

grant select on decision_template to authenticated;
grant select, insert, update, delete on decision to authenticated;

alter table decision_template enable row level security;
alter table decision          enable row level security;

create policy decision_template_read on decision_template for select to authenticated
  using (true);

-- Entscheidungen sind Sache des Bauherrn. Ein Einzelgewerk hat hier nichts zu
-- suchen: Was der Bauherr noch nicht entschieden hat, geht den Fliesenleger
-- nichts an — auch nicht der Preisrahmen.
create policy decision_read on decision for select to authenticated
  using (mbl.is_member(project_id) and mbl.member_role(project_id) <> 'trade');

create policy decision_write on decision for insert to authenticated
  with check (mbl.has_perm(project_id, 'decision.write'));

create policy decision_update on decision for update to authenticated
  using (mbl.has_perm(project_id, 'decision.write'))
  with check (mbl.has_perm(project_id, 'decision.write'));

create policy decision_delete on decision for delete to authenticated
  using (mbl.has_perm(project_id, 'decision.write'));

-- 3. Fortpflanzung schreiben -------------------------------------------------
--
-- Warum das eine eigene Funktion ist und nicht ein gewöhnliches UPDATE:
--
-- Verschiebt jemand den Estrich, wandern die Fliesen mit. Die Fliesen sind
-- aber nicht sein Vorgang — ein Einzelgewerk darf nach der Rechtematrix nur
-- den eigenen anfassen, und `task_update` setzt das durch. Ohne diesen Weg
-- könnte ein Einzelgewerk seinen Ist-Beginn melden, und der Rest des Plans
-- bliebe stehen: ein Terminplan, der die Folgen der eigenen Meldung nicht
-- kennt.
--
-- Die Trennung ist deshalb inhaltlich, nicht technisch:
--
--   * Was der Nutzer **behauptet** — Anfangstermin, Dauer, Status, Ist-Stände,
--     Bestätigung — geht durch das normale UPDATE. Dort gilt die Rechtematrix
--     Zeile für Zeile, inklusive Gewerke-Ausschnitt.
--   * Was daraus **folgt** — current_start, current_end, Puffer, kritischer
--     Pfad, Entscheidungsfristen — schreibt diese Funktion. Sie prüft einmal,
--     ob der Anrufer in diesem Projekt überhaupt Termine ändern darf, und
--     rührt ausschließlich abgeleitete Felder an.
--
-- Der Anwendungscode bekommt dadurch keine privilegierte Rolle: Er ruft eine
-- Funktion auf, deren Bedingung in der Datenbank steht. Die Historie entsteht
-- unverändert über `task_log_change`, mit Verursacher und Rolle.
create or replace function mbl.apply_plan(
  p_project   uuid,
  p_tasks     jsonb,
  p_decisions jsonb default '[]'::jsonb
)
returns integer
language plpgsql
security definer
set search_path = mbl, public
as $$
declare
  touched int := 0;
begin
  if not mbl.has_perm(p_project, 'task.schedule') then
    raise exception 'Diese Rolle darf in diesem Projekt keine Termine ändern.'
      using errcode = 'insufficient_privilege',
            hint = 'Wende dich an den Bauherrn, wenn der Termin nicht stimmt.';
  end if;

  update task t
     set current_start    = i.current_start,
         current_end      = i.current_end,
         total_float_days = i.total_float_days,
         is_critical      = i.is_critical
    from jsonb_to_recordset(p_tasks) as i(
           id uuid, current_start date, current_end date,
           total_float_days int, is_critical boolean)
   where t.id = i.id
     and t.project_id = p_project
     and (t.current_start    is distinct from i.current_start
       or t.current_end      is distinct from i.current_end
       or t.total_float_days is distinct from i.total_float_days
       or t.is_critical      is distinct from i.is_critical);
  get diagnostics touched = row_count;

  update decision d
     set due_date = i.due_date
    from jsonb_to_recordset(p_decisions) as i(id uuid, due_date date)
   where d.id = i.id
     and d.project_id = p_project
     and d.due_date is distinct from i.due_date;

  return touched;
end
$$;

revoke all on function mbl.apply_plan(uuid, jsonb, jsonb) from public, anon;
grant execute on function mbl.apply_plan(uuid, jsonb, jsonb) to authenticated;

-- 4. Ausgangslage für die Rechnung lesen -------------------------------------
--
-- Das Gegenstück zu `apply_plan`, aus demselben Grund.
--
-- Ein Einzelgewerk sieht über `task_read` nur die eigenen Vorgänge. Ein Plan
-- lässt sich daraus nicht rechnen: Die Abhängigkeiten des Projekts verweisen
-- auf Vorgänge, die in dieser Sicht fehlen, und die Vorwärtsrechnung bricht
-- auf einem unbekannten Vorgänger ab. Die Rechnung braucht den ganzen Graphen,
-- auch wenn der Anrufer ihn nicht sehen darf.
--
-- Diese Funktion liefert deshalb die vollständige Ausgangslage — an jeden, der
-- Mitglied des Projekts ist, und an sonst niemanden. Sie ist ausdrücklich
-- **keine Leseschnittstelle**: Was der Anrufer am Ende zu sehen bekommt,
-- entscheidet unverändert `task_read`. Der Anwendungscode gibt nur Zeilen
-- zurück, die er auf dem gewöhnlichen, RLS-geprüften Weg noch einmal gelesen
-- hat.
create or replace function mbl.plan_input(p_project uuid)
returns table (
  id            uuid,
  name          text,
  trade_code    text,
  duration_days int,
  duration_unit mbl.duration_unit,
  is_milestone  boolean,
  is_wait       boolean,
  pinned_start  date,
  actual_start  date,
  actual_end    date,
  current_start date,
  current_end   date
)
language plpgsql
stable
security definer
set search_path = mbl, public
as $$
begin
  if not mbl.is_member(p_project) then
    raise exception 'Dieses Projekt gibt es nicht.'
      using errcode = 'insufficient_privilege';
  end if;

  return query
    select t.id, t.name, tr.code, t.duration_days, t.duration_unit,
           t.is_milestone, t.is_wait, t.pinned_start, t.actual_start, t.actual_end,
           t.current_start, t.current_end
      from task t
      left join trade tr on tr.id = t.trade_id
     where t.project_id = p_project
     order by t.sort_order;
end
$$;

revoke all on function mbl.plan_input(uuid) from public, anon;
grant execute on function mbl.plan_input(uuid) to authenticated;

-- Dasselbe für die Abhängigkeiten: Ohne sie ist der Graph unvollständig.
create or replace function mbl.plan_dependencies(p_project uuid)
returns table (
  predecessor_id uuid,
  successor_id   uuid,
  type           mbl.dependency_type,
  lag_days       int,
  lag_unit       mbl.duration_unit
)
language plpgsql
stable
security definer
set search_path = mbl, public
as $$
begin
  if not mbl.is_member(p_project) then
    raise exception 'Dieses Projekt gibt es nicht.'
      using errcode = 'insufficient_privilege';
  end if;

  return query
    select d.predecessor_id, d.successor_id, d.type, d.lag_days, d.lag_unit
      from dependency d
     where d.project_id = p_project;
end
$$;

revoke all on function mbl.plan_dependencies(uuid) from public, anon;
grant execute on function mbl.plan_dependencies(uuid) to authenticated;

-- Und für die Entscheidungsfristen: Sie hängen an Vorgängen, die ein
-- Einzelgewerk nicht sieht. Lesen darf sie nach wie vor nur, wer nach
-- `decision_read` darf — diese Funktion liefert ausschließlich Kennung,
-- Vorlaufzeit und Vorgangsbezug, keinen Inhalt.
create or replace function mbl.plan_decisions(p_project uuid)
returns table (
  id             uuid,
  blocks_task_id uuid,
  lead_time_days int,
  lead_time_unit mbl.duration_unit
)
language plpgsql
stable
security definer
set search_path = mbl, public
as $$
begin
  if not mbl.is_member(p_project) then
    raise exception 'Dieses Projekt gibt es nicht.'
      using errcode = 'insufficient_privilege';
  end if;

  return query
    select d.id, d.blocks_task_id, d.lead_time_days, d.lead_time_unit
      from decision d
     where d.project_id = p_project and d.blocks_task_id is not null;
end
$$;

revoke all on function mbl.plan_decisions(uuid) from public, anon;
grant execute on function mbl.plan_decisions(uuid) to authenticated;
