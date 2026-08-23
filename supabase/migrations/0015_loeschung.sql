-- ---------------------------------------------------------------------------
-- MeinBaulotse — Löschung als Selbstbedienung (Abschnitt 6.5)
--
-- „Vollständiger Datenexport und Löschung als Selbstbedienung." Der Export
-- steht seit 0013. Die Löschung ist der schwierigere Teil, und zwar wegen
-- eines Widerspruchs, der im selben Abschnitt steht:
--
--   „Aufbewahrung bis 5 Jahre nach Abnahme wegen Gewährleistung, danach
--    Erinnerung statt stiller Löschung."
--
-- Ein Knopf, der sofort alles wegwirft, wäre deshalb falsch. Er stünde auch
-- im Widerspruch zu allem anderen in diesem Schema: `schedule_change` ist
-- append-only, `diary_entry` versiegelt, `guide_card` unveränderlich. Ein
-- Produkt, das seine Historie um jeden Preis schützt und sie dann auf einen
-- Klick verliert, schützt sie nicht.
--
-- Deshalb zwei Schritte:
--
--   1. **Der Bauherr beantragt.** Das Bauvorhaben wird als zur Löschung
--      vorgemerkt geführt, verschwindet aus seiner Liste und lässt sich
--      innerhalb der Frist zurückholen.
--   2. **Der Betreiber löscht.** Erst danach, mit einem Werkzeug, das die
--      Anwendung nicht hat — sie kann Historie nicht löschen, und das soll
--      so bleiben.
--
-- Der zweite Schritt braucht Tabellenrechte, die die Anwendungsrolle nicht
-- besitzt. Das ist die Grenze, an der es hier hängen soll: Ein Fehler im
-- Anwendungscode kann keine Akte vernichten.
-- ---------------------------------------------------------------------------

alter table project add column deletion_requested_at timestamptz;
alter table project add column deletion_requested_by uuid references project_member (id) on delete set null;
alter table project add column deletion_reason text;

comment on column project.deletion_requested_at is
  'Gesetzt heißt: vorgemerkt zur Löschung. Die Zeilen stehen noch; entfernt '
  'werden sie erst vom Betreiber (pnpm project:purge).';

/**
 * Wie lange zwischen Antrag und Löschung liegt.
 *
 * Dreißig Tage. Kurz genug, dass es eine Löschung ist, und lang genug, dass
 * ein Fehlgriff kein Verlust wird — der Bauherr, der abends aus Ärger auf den
 * Knopf drückt, ruft am nächsten Morgen an.
 */
create or replace function mbl.deletion_grace_days()
returns int language sql immutable as $$ select 30 $$;

/**
 * Wann darf gelöscht werden?
 *
 * Nicht bloß „Frist abgelaufen": Die Gewährleistung läuft fünf Jahre ab
 * Abnahme (§ 634a Abs. 1 Nr. 2 BGB), und in dieser Zeit ist die Akte das
 * Einzige, worauf sich der Bauherr berufen kann. Wer trotzdem löschen will,
 * darf das — es sind seine Daten —, aber er soll wissen, was er weggibt.
 * Deshalb gibt diese Funktion nicht ja oder nein zurück, sondern den Grund.
 */
create or replace function mbl.deletion_state(p_project uuid)
returns table (requested_at timestamptz, purge_after timestamptz, within_warranty boolean)
language sql
stable
as $$
  select p.deletion_requested_at,
         p.deletion_requested_at + make_interval(days => mbl.deletion_grace_days()),
         exists (
           select 1 from task t
           where t.project_id = p.id
             and t.template_task_code = 't37'
             and t.actual_end is not null
             and t.actual_end > current_date - interval '5 years'
         )
    from project p
   where p.id = p_project
$$;

-- Ein vorgemerktes Bauvorhaben verschwindet aus der Liste, bleibt aber
-- erreichbar, solange die Frist läuft: Wer zurückholen will, muss hinkommen.
grant execute on all functions in schema mbl to anon, authenticated;
