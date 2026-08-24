/**
 * Wie dringend eine Entscheidung ist.
 *
 * Gerechnet wird im Browser, mit demselben Feiertagskalender wie auf dem
 * Server — deshalb trägt `ProjectSummary` das Bundesland **und** den
 * Gemeindetyp. Ohne den zweiten läge die Anwendung in Bayern an drei Tagen im
 * Jahr um einen Werktag daneben, und zwar ausgerechnet dort, wo sie „noch 1
 * Werktag" anzeigt.
 *
 * Das heutige Datum kommt aus dem Browser und nicht aus dem Berechnungskern:
 * Es ist eine Frage der Darstellung, keine der Terminlogik — dieselbe
 * Begründung wie in `progress.ts`.
 */

import { workdayDifference, type Calendar } from '@meinbaulotse/schedule';
import { isDecisionOpen, type DecisionDto, type ProjectSummary } from '@meinbaulotse/shared';
import { todayIso } from './progress';

export function calendarOf(project: ProjectSummary): Calendar {
  return {
    federalState: project.federalState,
    catholicMunicipality: project.catholicMunicipality,
  };
}

/**
 * Verbleibende Werktage bis zur Frist. Negativ heißt: die Frist ist verstrichen.
 * `null`, solange der blockierte Vorgang keinen Termin hat.
 */
export function remainingWorkdays(
  decision: DecisionDto,
  calendar: Calendar,
  today = todayIso(),
): number | null {
  if (decision.dueDate === null) return null;
  return workdayDifference(today, decision.dueDate, calendar);
}

/**
 * Wie ernst die Lage ist — in drei Stufen, nicht in einer Zahl.
 *
 * `knapp` beginnt fünf Werktage vor der Frist. Das ist keine Wissenschaft,
 * sondern die Spanne, in der sich eine Bemusterung noch verabreden lässt.
 */
export type DecisionUrgency = 'offen' | 'knapp' | 'verstrichen' | 'erledigt';

export const URGENT_WITHIN_WORKDAYS = 5;

export function urgencyOf(
  decision: DecisionDto,
  calendar: Calendar,
  today = todayIso(),
): DecisionUrgency {
  if (!isDecisionOpen(decision)) return 'erledigt';
  const remaining = remainingWorkdays(decision, calendar, today);
  if (remaining === null) return 'offen';
  if (remaining < 0) return 'verstrichen';
  return remaining <= URGENT_WITHIN_WORKDAYS ? 'knapp' : 'offen';
}

/**
 * Die Entscheidungen, die jetzt anstehen: offen, mit Frist, nach Dringlichkeit.
 *
 * Verstrichene zuerst — nicht um zu mahnen, sondern weil sie die einzigen sind,
 * bei denen jeder weitere Tag etwas kostet.
 */
export function pendingDecisions(
  decisions: readonly DecisionDto[],
  calendar: Calendar,
  today = todayIso(),
): DecisionDto[] {
  return decisions
    .filter((entry) => isDecisionOpen(entry) && entry.dueDate !== null)
    .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''))
    .filter((entry) => urgencyOf(entry, calendar, today) !== 'erledigt');
}

/**
 * Gibt es zu diesem Vorgang eine Entscheidung, deren Frist verstrichen ist?
 *
 * Beantwortet die zweite Hälfte der Abnahme von AP 3: Eine überfällige Frist
 * wird „als möglicher Verzugsgrund angeboten". Wer den Vorgang verschiebt,
 * bekommt `bauherren_entscheidung` vorbelegt — statt selbst darauf zu kommen.
 */
export function overdueDecisionFor(
  taskId: string,
  decisions: readonly DecisionDto[],
  calendar: Calendar,
  today = todayIso(),
): DecisionDto | null {
  return (
    decisions.find(
      (entry) =>
        entry.blocksTaskId === taskId && urgencyOf(entry, calendar, today) === 'verstrichen',
    ) ?? null
  );
}
