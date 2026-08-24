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
