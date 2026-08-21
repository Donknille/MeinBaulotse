/**
 * Entscheidungsfristen.
 *
 * Jede Bauherren-Entscheidung hängt an einem Vorgang und einer Vorlaufzeit.
 * Verschiebt sich der Vorgang, verschiebt sich die Frist mit — genau das macht
 * eine Terminverschiebung für den Bauherren handlungsrelevant.
 */

import { addDays, compareDates, type IsoDate } from './civil-date.js';
import { workdayDifference, workdayOffset, type Calendar } from './calendar.js';
import type { DurationUnit, TaskId } from './types.js';

export type DecisionId = string;

export interface ScheduleDecision {
  id: DecisionId;
  /** Vorgang, der ohne diese Entscheidung nicht beginnen kann. */
  blocksTaskId: TaskId;
  /** Vorlaufzeit vor dem Beginn des blockierten Vorgangs. */
  leadTimeDays: number;
  /** Standard `werktage`. */
  leadTimeUnit?: DurationUnit;
}

export interface DecisionDueDate {
  decisionId: DecisionId;
  taskId: TaskId;
  dueDate: IsoDate;
  /** Verbleibende Werktage bis zur Frist, bezogen auf `today`. */
  remainingWorkdays: number;
  isOverdue: boolean;
}

/** Fälligkeitstag einer einzelnen Entscheidung. */
export function decisionDueDate(
  decision: ScheduleDecision,
  taskStart: IsoDate,
  calendar: Calendar,
): IsoDate {
  if (decision.leadTimeUnit === 'kalendertage') {
    return addDays(taskStart, -decision.leadTimeDays);
  }
  return workdayOffset(taskStart, -decision.leadTimeDays, calendar);
}

/**
 * Fristen aller Entscheidungen. Entscheidungen, deren Vorgang nicht im Plan
 * steht, werden übergangen — ein gelöschter Vorgang darf die Rechnung nicht
 * zum Absturz bringen.
 *
 * `today` wird hereingereicht, nicht aus der Systemuhr gelesen: Der
 * Berechnungskern kennt keine Uhrzeit.
 */
export function decisionDueDates(
  decisions: readonly ScheduleDecision[],
  taskStarts: ReadonlyMap<TaskId, IsoDate>,
  calendar: Calendar,
  today?: IsoDate,
): ReadonlyMap<DecisionId, DecisionDueDate> {
  const result = new Map<DecisionId, DecisionDueDate>();

  for (const decision of decisions) {
    const taskStart = taskStarts.get(decision.blocksTaskId);
    if (taskStart === undefined) continue;

    const dueDate = decisionDueDate(decision, taskStart, calendar);
    const remainingWorkdays =
      today === undefined ? 0 : workdayDifference(today, dueDate, calendar);

    result.set(decision.id, {
      decisionId: decision.id,
      taskId: decision.blocksTaskId,
      dueDate,
      remainingWorkdays,
      isOverdue: today !== undefined && compareDates(dueDate, today) < 0,
    });
  }

  return result;
}
