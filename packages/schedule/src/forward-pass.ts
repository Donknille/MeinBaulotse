/**
 * Vorwärtsrechnung über den Abhängigkeitsgraphen.
 *
 * Der Kern der Terminlogik. Zwei Dinge unterscheiden ihn von einer
 * Lehrbuch-CPM-Rechnung, und beide kommen aus dem Bauablauf:
 *
 * 1. **Wartezeiten laufen in Kalendertagen.** Estrich trocknet auch sonntags.
 *    Eine Wartezeit darf am Samstag beginnen und am Sonntag enden; erst ihr
 *    Nachfolger wird wieder auf einen Werktag gelegt.
 * 2. **Ist-Termine schlagen die Rechnung.** Was gemeldet wurde, gilt — und
 *    pflanzt sich vorwärts fort.
 */

import { addDays, compareDates, maxDate, type IsoDate } from './civil-date.js';
import { nextWorkday, previousWorkday, workdayOffset, type Calendar } from './calendar.js';
import { buildGraph, topologicalSort, type DependencyGraph } from './graph.js';
import type {
  ScheduleDependency,
  ScheduleResult,
  ScheduleTask,
  ScheduledTask,
  TaskId,
} from './types.js';

export interface ComputeScheduleInput {
  tasks: readonly ScheduleTask[];
  dependencies: readonly ScheduleDependency[];
  calendar: Calendar;
  /** Frühestmöglicher Beginn des gesamten Vorhabens. */
  projectStart: IsoDate;
}

export class DuplicateTaskError extends Error {
  constructor(taskId: TaskId) {
    super(`Vorgang ${JSON.stringify(taskId)} kommt mehrfach vor`);
    this.name = 'DuplicateTaskError';
  }
}

/** Läuft der Vorgang in Kalendertagen? */
function isCalendarTask(task: ScheduleTask): boolean {
  return task.isWait === true || task.durationUnit === 'kalendertage';
}

function effectiveDurationUnit(task: ScheduleTask): 'werktage' | 'kalendertage' {
  return isCalendarTask(task) ? 'kalendertage' : 'werktage';
}

/** Legt ein Datum auf einen zulässigen Anfangstag für diesen Vorgang. */
function normalizeStart(task: ScheduleTask, date: IsoDate, calendar: Calendar): IsoDate {
  if (isCalendarTask(task)) return date;
  return nextWorkday(date, calendar, task.tradeCode);
}

/** Endtermin aus Anfang und Dauer, einschließend gezählt. */
export function endFromStart(task: ScheduleTask, start: IsoDate, calendar: Calendar): IsoDate {
  if (task.isMilestone === true || task.durationDays <= 0) return start;
  if (isCalendarTask(task)) return addDays(start, task.durationDays - 1);
  return workdayOffset(start, task.durationDays - 1, calendar, task.tradeCode);
}

/** Anfangstermin aus Ende und Dauer — Umkehrung von {@link endFromStart}. */
export function startFromEnd(task: ScheduleTask, end: IsoDate, calendar: Calendar): IsoDate {
  if (task.isMilestone === true || task.durationDays <= 0) return end;
  if (isCalendarTask(task)) return addDays(end, -(task.durationDays - 1));
  return workdayOffset(end, -(task.durationDays - 1), calendar, task.tradeCode);
}

/**
 * Frühester Anfang des Nachfolgers, der sich aus einer einzelnen Abhängigkeit
 * ergibt. Gibt `undefined` zurück, wenn die Beziehung keinen Anfang erzwingt
 * (das kommt bei `FF` vor, wenn die Dauer 0 ist).
 */
function constraintFromDependency(
  dependency: ScheduleDependency,
  predecessor: ScheduledTask,
  successor: ScheduleTask,
  calendar: Calendar,
): IsoDate {
  const type = dependency.type ?? 'FS';
  const lag = dependency.lagDays ?? 0;
  const lagInCalendarDays = dependency.lagUnit === 'kalendertage';
  const successorIsCalendar = isCalendarTask(successor);

  const shift = (anchor: IsoDate, days: number): IsoDate => {
    if (lagInCalendarDays || successorIsCalendar) {
      const shifted = addDays(anchor, days);
      return successorIsCalendar ? shifted : nextWorkday(shifted, calendar, successor.tradeCode);
    }
    return workdayOffset(anchor, days, calendar, successor.tradeCode);
  };

  switch (type) {
    case 'FS':
      return shift(predecessor.end, 1 + lag);
    case 'SS':
      return shift(predecessor.start, lag);
    case 'FF': {
      const requiredEnd = shift(predecessor.end, lag);
      return startFromEnd(successor, requiredEnd, calendar);
    }
  }
}

/**
 * Rechnet den gesamten Plan durch: topologische Sortierung, dann Vorwärtspass.
 *
 * @throws {CycleError} wenn die Abhängigkeiten einen Zyklus enthalten
 */
export function computeSchedule(input: ComputeScheduleInput): ScheduleResult {
  const { tasks, dependencies, calendar, projectStart } = input;

  const byId = new Map<TaskId, ScheduleTask>();
  for (const task of tasks) {
    if (byId.has(task.id)) throw new DuplicateTaskError(task.id);
    byId.set(task.id, task);
  }

  const graph: DependencyGraph = buildGraph([...byId.keys()], dependencies);
  const order = topologicalSort(graph);

  const scheduled = new Map<TaskId, ScheduledTask>();

  for (const id of order) {
    const task = byId.get(id)!;
    const candidates: IsoDate[] = [projectStart];

    if (task.earliestStart !== undefined) candidates.push(task.earliestStart);

    for (const dependency of graph.predecessors.get(id) ?? []) {
      const predecessor = scheduled.get(dependency.predecessorId);
      if (predecessor === undefined) continue;
      candidates.push(constraintFromDependency(dependency, predecessor, task, calendar));
    }

    let start = normalizeStart(task, maxDate(...candidates), calendar);
    let end = endFromStart(task, start, calendar);

    const pinned = task.actualStart !== undefined || task.actualEnd !== undefined;
    if (task.actualStart !== undefined) {
      start = task.actualStart;
      end = endFromStart(task, start, calendar);
    }
    if (task.actualEnd !== undefined) {
      end = task.actualEnd;
      if (task.actualStart === undefined) start = startFromEnd(task, end, calendar);
    }

    scheduled.set(id, {
      id,
      start,
      end,
      earlyStart: start,
      earlyFinish: end,
      isWait: task.isWait === true,
      isMilestone: task.isMilestone === true,
      durationDays: task.durationDays,
      durationUnit: effectiveDurationUnit(task),
      pinned,
    });
  }

  const projectEnd =
    order.length === 0
      ? projectStart
      : maxDate(...order.map((id) => scheduled.get(id)!.end));

  return { tasks: scheduled, order, projectStart, projectEnd };
}

/**
 * Legt ein Datum auf den nächsten für den Vorgang zulässigen Arbeitstag —
 * exportiert, weil die Verschiebelogik in AP 4 dasselbe braucht.
 */
export function alignStart(task: ScheduleTask, date: IsoDate, calendar: Calendar): IsoDate {
  return normalizeStart(task, date, calendar);
}

/** Legt ein Ende auf einen für den Vorgang zulässigen Tag. */
export function alignEnd(task: ScheduleTask, date: IsoDate, calendar: Calendar): IsoDate {
  if (isCalendarTask(task)) return date;
  return previousWorkday(date, calendar, task.tradeCode);
}

/** Liegt `a` vor `b`? Kleine Hilfe für Aufrufer außerhalb des Pakets. */
export function isBefore(a: IsoDate, b: IsoDate): boolean {
  return compareDates(a, b) < 0;
}
