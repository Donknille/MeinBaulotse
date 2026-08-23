-- ---------------------------------------------------------------------------
-- MeinBaulotse — Folgevorgänge einzeln entkoppeln (Abschnitt 3.5, Punkt 6)
--
-- „Betroffene Folgevorgänge als Vorschlag anzeigen, einzeln entkoppelbar."
--
-- Die erste Hälfte steht seit AP 4: Wer einen Termin verschiebt, sieht
-- vorher, was mitwandert. Die zweite fehlte, und sie ist die wichtigere.
--
-- Der Fall aus der Wirklichkeit: Der Estrich verzögert sich um zwei Wochen,
-- und die Rechnung schiebt alles nach — auch den Maler, der im Erdgeschoss
-- arbeitet und auf den Estrich im Obergeschoss gar nicht wartet. In der
-- Vorlage steht die Kante, weil sie meistens stimmt. Hier stimmt sie nicht.
--
-- Der Bauherr braucht dafür keinen Weg, den Ablaufplan umzubauen. Er braucht
-- einen Satz: „Der wartet nicht darauf." Genau das ist eine entkoppelte
-- Kante.
--
-- Gelöscht wird sie nicht, und das ist der Punkt: Eine gelöschte Kante ist
-- weg, eine entkoppelte steht mit Grund und Datum da. Wenn in vier Wochen
-- jemand fragt, warum der Maler vor dem Estrich dran war, steht die Antwort
-- in der Zeile.
-- ---------------------------------------------------------------------------

alter table dependency add column decoupled_at timestamptz;
alter table dependency add column decoupled_reason text;
alter table dependency add column decoupled_by uuid references project_member (id) on delete set null;

/**
 * Der Termin, an dem der Nachfolger beim Lösen stand.
 *
 * Ohne ihn tut das Lösen etwas anderes, als der Bauherr meint. Hat der
 * Vorgang nur diese eine Kante, hält ihn danach gar nichts mehr — die
 * Vorwärtsrechnung setzt ihn an den Baubeginn, und der Maler steht plötzlich
 * im Mai statt im September. „Der wartet nicht darauf" heißt aber: Er bleibt,
 * wo er ist.
 *
 * Deshalb wird sein Termin beim Lösen als frühester Beginn festgehalten — und
 * beim Wiederverbinden wieder gelöst, sofern ihn niemand zwischenzeitlich
 * anders gesetzt hat.
 */
alter table dependency add column pinned_successor_start date;

comment on column dependency.decoupled_at is
  'Gesetzt heißt: Diese Abhängigkeit rechnet nicht mehr mit. Die Kante bleibt '
  'stehen, damit später nachvollziehbar ist, dass jemand sie gelöst hat.';

-- Ein Grund ist Pflicht, aus demselben Grund wie bei einer Verschiebung: Wer
-- eine Abhängigkeit löst, greift in die Bauablauflogik ein, und in vier
-- Wochen weiß niemand mehr, warum.
alter table dependency add constraint dependency_decoupled_reason
  check (decoupled_at is null or length(btrim(coalesce(decoupled_reason, ''))) > 0);

create index dependency_decoupled_idx on dependency (project_id) where decoupled_at is not null;

-- Ändern darf, wer auch Termine ändert: Es ist eine Terminentscheidung.
create policy dependency_decouple on dependency for update to authenticated
  using (mbl.has_perm(project_id, 'task.schedule'))
  with check (mbl.has_perm(project_id, 'task.schedule'));

grant update on dependency to authenticated;
