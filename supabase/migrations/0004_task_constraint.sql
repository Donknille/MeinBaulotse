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
