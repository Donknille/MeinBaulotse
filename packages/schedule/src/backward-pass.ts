/**
 * Rückwärtsrechnung: späteste Lagen, Gesamtpuffer, kritischer Pfad.
 *
 * Für den Bauherren ist nicht der kritische Pfad die interessante Zahl, sondern
 * der Puffer eines einzelnen Vorgangs — „darf sich um 12 Werktage verschieben,
 * ohne dass der Endtermin kippt". Der Puffer wird deshalb konsequent in
 * **Werktagen** ausgegeben, auch für Wartezeiten.
 */

import { addDays, compareDates, minDate, type IsoDate } from './civil-date.js';
import { previousWorkday, workdayDifference, workdayOffset, type Calendar } from './calendar.js';
import { buildGraph } from './graph.js';
import { startFromEnd, endFromStart } from './forward-pass.js';
import type {
  CriticalPathResult,
  FloatResult,
  ScheduleDependency,
  ScheduleResult,
  ScheduleTask,
  TaskId,
} from './types.js';

export interface CriticalPathInput {
  tasks: readonly ScheduleTask[];
  dependencies: readonly ScheduleDependency[];
  calendar: Calendar;
  schedule: ScheduleResult;
  /**
   * Vertraglich geschuldeter Fertigstellungstermin. Er beeinflusst
   * standardmäßig **nur** `deviationWorkdays`, nicht die Puffer der einzelnen
   * Vorgänge — siehe `floatsAgainst`.
   */
  contractualEnd?: IsoDate;
  /**
   * Wogegen der Puffer je Vorgang gemessen wird.
   *
   * - `plan` (Standard): gegen das errechnete Ende. Der Puffer beantwortet
   *   dann die Frage, die sich der Bauherr an der einzelnen Zeile stellt:
   *   „Wie viel Luft habe ich hier, ohne dass sich mein Endtermin verschiebt?"
   * - `contract`: gegen den geschuldeten Termin. Liegt der Plan dahinter,
   *   werden alle Puffer negativ.
   *
   * Der Standard ist mit Bedacht `plan`. Andernfalls trägt bei einem Rückstand
   * jede einzelne Zeile dieselbe schlechte Nachricht — und eine Nachricht, die
   * 38-mal wiederholt wird, wird nicht mehr gelesen. Die Abweichung vom
   * Vertrag ist eine Aussage über das Projekt und steht deshalb genau einmal,
   * oben.
   */
  floatsAgainst?: 'plan' | 'contract';
}

function isCalendarTask(task: ScheduleTask): boolean {
  return task.isWait === true || task.durationUnit === 'kalendertage';
}

/** Legt ein spätestes Ende auf einen für den Vorgang zulässigen Tag. */
function alignLateFinish(task: ScheduleTask, date: IsoDate, calendar: Calendar): IsoDate {
  if (isCalendarTask(task)) return date;
  return previousWorkday(date, calendar, task.tradeCode);
}

/**
 * Spätestes Ende des Vorgängers, das sich aus einer Beziehung ergibt —
 * die Spiegelung von `constraintFromDependency` der Vorwärtsrechnung.
 */
function latestFinishFromDependency(
  dependency: ScheduleDependency,
  predecessor: ScheduleTask,
  successorLateStart: IsoDate,
  successorLateFinish: IsoDate,
  calendar: Calendar,
): IsoDate {
  const type = dependency.type ?? 'FS';
  const lag = dependency.lagDays ?? 0;
  const lagInCalendarDays = dependency.lagUnit === 'kalendertage';
  const predecessorIsCalendar = isCalendarTask(predecessor);

  const shiftBack = (anchor: IsoDate, days: number): IsoDate => {
    if (lagInCalendarDays || predecessorIsCalendar) {
      const shifted = addDays(anchor, -days);
      return predecessorIsCalendar
        ? shifted
        : previousWorkday(shifted, calendar, predecessor.tradeCode);
    }
    return workdayOffset(anchor, -days, calendar, predecessor.tradeCode);
  };

  switch (type) {
    case 'FS':
      return shiftBack(successorLateStart, 1 + lag);
    case 'SS': {
      const latestStart = shiftBack(successorLateStart, lag);
      return endFromStart(predecessor, latestStart, calendar);
    }
    case 'FF':
      return shiftBack(successorLateFinish, lag);
  }
}

/**
 * Rückwärtspass vom Bezugsende. Liefert je Vorgang die späteste Lage, den
 * Gesamtpuffer in Werktagen und die Angabe, ob er kritisch ist.
 */
export function criticalPath(input: CriticalPathInput): CriticalPathResult {
  const { tasks, dependencies, calendar, schedule, contractualEnd } = input;

  const byId = new Map<TaskId, ScheduleTask>(tasks.map((task) => [task.id, task]));
  const graph = buildGraph([...byId.keys()], dependencies);
  const reverseOrder = [...schedule.order].reverse();

  const targetEnd =
    input.floatsAgainst === 'contract' && contractualEnd !== undefined
      ? contractualEnd
      : schedule.projectEnd;
  const lateFinish = new Map<TaskId, IsoDate>();
  const lateStart = new Map<TaskId, IsoDate>();

  for (const id of reverseOrder) {
    const task = byId.get(id)!;
    const successors = graph.successors.get(id) ?? [];

    const candidates: IsoDate[] = [];
    for (const dependency of successors) {
      const successor = byId.get(dependency.successorId);
      const successorLateStart = lateStart.get(dependency.successorId);
      const successorLateFinish = lateFinish.get(dependency.successorId);
      if (
        successor === undefined ||
        successorLateStart === undefined ||
        successorLateFinish === undefined
      ) {
        continue;
      }
      candidates.push(
        latestFinishFromDependency(
          dependency,
          task,
          successorLateStart,
          successorLateFinish,
          calendar,
        ),
      );
    }

    // Ein Vorgang ohne Nachfolger endet spätestens am Bezugsende.
    if (candidates.length === 0) candidates.push(targetEnd);

    const finish = alignLateFinish(task, minDate(...candidates), calendar);
    lateFinish.set(id, finish);
    lateStart.set(id, startFromEnd(task, finish, calendar));
  }

  const floats = new Map<TaskId, FloatResult>();
  const critical: TaskId[] = [];

  for (const id of schedule.order) {
    const scheduled = schedule.tasks.get(id)!;
    const finish = lateFinish.get(id)!;
    const start = lateStart.get(id)!;

    // Puffer immer in Werktagen — das ist die Einheit, in der der Bauherr denkt.
    //
    // Gemessen wird über den frühestmöglichen Anfang eines Nachfolgers, nicht
    // über das Ende selbst. Für Arbeitsvorgänge ist das dieselbe Zahl. Für
    // Wartezeiten ist es der Unterschied zwischen richtig und irreführend: Eine
    // Trocknung, die am Freitag statt am Sonntag fertig wird, verschafft
    // niemandem einen Werktag Luft, weil der Nachfolger so oder so am Montag
    // beginnt.
    const anchorEarly = workdayOffset(scheduled.earlyFinish, 1, calendar);
    const anchorLate = workdayOffset(finish, 1, calendar);
    const totalFloatDays = workdayDifference(anchorEarly, anchorLate, calendar);

    const isCritical = totalFloatDays <= 0;
    if (isCritical) critical.push(id);

    floats.set(id, {
      taskId: id,
      lateStart: start,
      lateFinish: finish,
      totalFloatDays,
      isCritical,
    });
  }

  const deviationWorkdays =
    contractualEnd === undefined
      ? 0
      : workdayDifference(
          workdayOffset(contractualEnd, 1, calendar),
          workdayOffset(schedule.projectEnd, 1, calendar),
          calendar,
        );

  return { floats, critical, targetEnd, deviationWorkdays };
}

/** Ist `a` später als `b`? */
export function isAfter(a: IsoDate, b: IsoDate): boolean {
  return compareDates(a, b) > 0;
}
