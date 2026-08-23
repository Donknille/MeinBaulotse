/**
 * Entscheidungen aus der Sicht des Bauherrn.
 *
 * Die Frist selbst rechnet der Server, weil sie zum Plan gehört. Was hier
 * entsteht, ist die zweite Hälfte der Auskunft: **wie viel Zeit noch bleibt**
 * — und die hängt am heutigen Tag, also an etwas, das der Berechnungskern
 * bewusst nicht kennt.
 *
 * Gerechnet wird mit demselben Feiertagskalender wie auf dem Server, sonst
 * zählt die Oberfläche in Bayern drei Werktage zu viel.
 */

import {
  workdayDifference,
  type Calendar,
  type FederalState,
} from '@meinbaulotse/schedule';
import {
  decisionIsSettled,
  type DecisionDto,
  type ProjectSummary,
} from '@meinbaulotse/shared';
import { todayIso } from './progress';

/** Ab hier wird es eng. Zwei Wochen sind kurz genug, um zu handeln. */
export const DRINGLICH_AB_WERKTAGEN = 10;

export interface DecisionState {
  decision: DecisionDto;
  /** `null`, solange der Vorgang keinen Termin hat. */
  remainingWorkdays: number | null;
  isOverdue: boolean;
  isSettled: boolean;
  /** Braucht diese Entscheidung jetzt Aufmerksamkeit? */
  isUrgent: boolean;
}

export function calendarOf(project: ProjectSummary): Calendar {
  return {
    federalState: project.federalState as FederalState,
    catholicMunicipality: project.catholicMunicipality,
  };
}

export function decisionState(
  decision: DecisionDto,
  calendar: Calendar,
  today = todayIso(),
): DecisionState {
  const isSettled = decisionIsSettled(decision.status);
  if (decision.dueDate === null) {
    return { decision, remainingWorkdays: null, isOverdue: false, isSettled, isUrgent: false };
  }

  // Von heute bis zur Frist. Negativ heißt: der Tag ist vorbei.
  const remainingWorkdays = workdayDifference(today, decision.dueDate, calendar);
  const isOverdue = !isSettled && decision.dueDate < today;

  return {
    decision,
    remainingWorkdays,
    isOverdue,
    isSettled,
    isUrgent: !isSettled && remainingWorkdays <= DRINGLICH_AB_WERKTAGEN,
  };
}

/**
 * Die offenen Entscheidungen, die dringendste zuerst.
 *
 * Erledigte fallen heraus: Eine Liste, in der Abgehaktes mitläuft, wird mit
 * jedem Tag länger und mit jedem Tag weniger gelesen.
 */
export function offeneEntscheidungen(
  decisions: readonly DecisionDto[],
  calendar: Calendar,
  today = todayIso(),
): DecisionState[] {
  return decisions
    .map((decision) => decisionState(decision, calendar, today))
    .filter((state) => !state.isSettled)
    .sort((a, b) => {
      if (a.decision.dueDate === null) return 1;
      if (b.decision.dueDate === null) return -1;
      return a.decision.dueDate.localeCompare(b.decision.dueDate);
    });
}

/**
 * Gibt es zu diesem Vorgang eine Entscheidung, die schon zu spät ist?
 *
 * Das beantwortet die Frage aus der Abnahme von AP 3: Eine verstrichene Frist
 * wird „als möglicher Verzugsgrund angeboten". Wer den Vorgang verschiebt,
 * bekommt sie im Blatt zu sehen, statt sich den Grund selbst zusammenzureimen.
 */
export function ueberfaelligeEntscheidungenZu(
  taskId: string,
  decisions: readonly DecisionDto[],
  calendar: Calendar,
  today = todayIso(),
): DecisionDto[] {
  return decisions
    .filter((decision) => decision.blocksTaskId === taskId)
    .map((decision) => decisionState(decision, calendar, today))
    .filter((state) => state.isOverdue)
    .map((state) => state.decision);
}

/** Der Stand einer Entscheidung, in der Sprache der Oberfläche. */
export const DECISION_STATUS_LABEL: Readonly<Record<DecisionDto['status'], string>> = {
  offen: 'Offen',
  in_bemusterung: 'In Bemusterung',
  entschieden: 'Entschieden',
  beauftragt: 'Beauftragt',
  hinfaellig: 'Hinfällig',
};
