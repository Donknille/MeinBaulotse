/**
 * Fortpflanzung einer Verschiebung — Abschnitt 3.5 der Spezifikation.
 *
 * Wer einen Vorgang verschiebt, verschiebt selten nur einen. Diese Datei
 * beantwortet die Frage, die davor steht: **Was zieht mit?** Sie rechnet den
 * Plan zweimal durch — einmal wie er ist, einmal wie er wäre — und gibt den
 * Unterschied zurück. Geschrieben wird nichts; das ist Sache der Anwendung.
 *
 * ## Einzelentkopplung
 *
 * Punkt 6 aus Abschnitt 3.5 verlangt, dass sich betroffene Folgevorgänge
 * **einzeln entkoppeln** lassen. Auf der Baustelle ist das der Normalfall: Der
 * Innenputz rutscht eine Woche, der Trockenbauer kommt trotzdem wie geplant,
 * weil er im Dachgeschoss anfängt.
 *
 * Entkoppeln heißt hier nicht „Beziehung löschen". Es heißt, zwei Aussagen in
 * die Daten zu schreiben, die beide stimmen und beide vorher schon ausdrückbar
 * waren:
 *
 * 1. **Der Vorgang bleibt, wo er ist** — `earliestStart` auf seinen bisherigen
 *    Anfang. Das ist wörtlich, was das Feld bedeutet: nicht früher als.
 * 2. **Die Beziehung erlaubt jetzt eine Überlappung** — der Vorlauf der
 *    betroffenen Abhängigkeit wird negativ. Auch das ist kein Kunstgriff:
 *    `lag_days` darf laut Datenmodell negativ sein und heißt dann genau das.
 *
 * Der Vorteil gegenüber einer gelöschten Beziehung ist, dass die Aussage
 * erhalten bleibt. „Malerarbeiten beginnen sechs Werktage vor Ende der
 * Fliesenarbeiten" ist eine Planungsentscheidung, die man später wiederfindet.
 * „Zwischen Fliesen und Malern besteht kein Zusammenhang" wäre gelogen.
 *
 * Wer einen Vorgang entkoppelt, schirmt damit automatisch alles ab, was hinter
 * ihm liegt: Sein Nachfolger sieht einen Vorgänger, der sich nicht bewegt hat.
 */

import { compareDates, type IsoDate } from './civil-date.js';
import { workdayDifference, type Calendar } from './calendar.js';
import { computeSchedule, dependencyConstraint } from './forward-pass.js';
import type {
  ScheduleDependency,
  ScheduleResult,
  ScheduleTask,
  ScheduledTask,
  TaskId,
} from './types.js';

/** Ein Vorgang, der sich durch die Verschiebung bewegt. */
export interface ProposedChange {
  taskId: TaskId;
  fromStart: IsoDate;
  fromEnd: IsoDate;
  toStart: IsoDate;
  toEnd: IsoDate;
  /** Werktage, um die sich der Anfang verschiebt. Positiv heißt später. */
  shiftWorkdays: number;
}

/** Ein Vorlauf, der sich durch eine Entkopplung ändert. */
export interface LagAdjustment {
  predecessorId: TaskId;
  successorId: TaskId;
  type: NonNullable<ScheduleDependency['type']>;
  fromLagDays: number;
  toLagDays: number;
}

export interface ShiftProposal {
  /** Der ausgelöste Vorgang selbst. `null`, wenn er sich gar nicht bewegt. */
  trigger: ProposedChange | null;
  /** Alle anderen, die mitziehen — in der Reihenfolge des Plans. */
  affected: ProposedChange[];
  /** Vorgänge, die auf Wunsch stehen bleiben. */
  decoupled: TaskId[];
  lagAdjustments: LagAdjustment[];
  /**
   * Anfangsbeschränkungen, die für die Entkopplung nötig sind — Vorgang und
   * der Tag, an dem er bleiben soll.
   */
  pinnedStarts: { taskId: TaskId; earliestStart: IsoDate }[];
  projectEndBefore: IsoDate;
  projectEndAfter: IsoDate;
  /** Werktage, um die sich das prognostizierte Ende verschiebt. */
  effectWorkdays: number;
  /** Der durchgerechnete Plan nach der Änderung. */
  after: ScheduleResult;
}

export interface ProposeShiftInput {
  /** Der Zustand, wie er ist. */
  tasks: readonly ScheduleTask[];
  /** Dieselben Vorgänge, mit der beabsichtigten Änderung an genau einem. */
  changed: readonly ScheduleTask[];
  dependencies: readonly ScheduleDependency[];
  calendar: Calendar;
  projectStart: IsoDate;
  /** Der Vorgang, an dem die Änderung ansetzt. */
  triggerTaskId: TaskId;
  /** Vorgänge, die trotz der Verschiebung stehen bleiben sollen. */
  decouple?: readonly TaskId[];
}

/**
 * Wie oft die Entkopplung höchstens nachjustiert.
 *
 * Jede Runde kann Vorläufe nur verkleinern, und der Plan ist darin monoton —
 * mehr als eine Handvoll Runden braucht es nie. Die Schranke steht trotzdem
 * da: Eine Schleife ohne Ausgang in der Terminrechnung wäre ein hängender
 * Server, und der ist schlimmer als ein ungenauer Vorschlag.
 */
const MAX_ROUNDS = 8;

/** Wie weit ein einzelner Vorlauf je Runde höchstens sinkt. */
const MAX_LAG_STEPS = 400;

function keyOf(dependency: ScheduleDependency): string {
  return `${dependency.predecessorId}→${dependency.successorId}→${dependency.type ?? 'FS'}`;
}

export function proposeShift(input: ProposeShiftInput): ShiftProposal {
  const { tasks, changed, dependencies, calendar, projectStart, triggerTaskId } = input;
  const decouple = [...new Set(input.decouple ?? [])];

  const before = computeSchedule({ tasks, dependencies, calendar, projectStart });

  // Die Vorgänge, die stehen bleiben sollen, mit dem Tag, an dem sie stehen.
  const keepStart = new Map<TaskId, IsoDate>();
  for (const taskId of decouple) {
    const bisher = before.tasks.get(taskId);
    if (bisher !== undefined) keepStart.set(taskId, bisher.start);
  }

  let lagByKey = new Map<string, number>();
  let pinned = new Map<TaskId, IsoDate>();
  let after = computeWith(changed, dependencies, lagByKey, pinned, calendar, projectStart);

  for (let round = 0; round < MAX_ROUNDS && keepStart.size > 0; round += 1) {
    const nextLags = new Map(lagByKey);
    const nextPins = new Map(pinned);
    let veraendert = false;

    for (const [taskId, bleibtAm] of keepStart) {
      const jetzt = after.tasks.get(taskId);
      if (jetzt === undefined) continue;

      // Steht er schon richtig, ist nichts zu tun — außer die Beschränkung
      // festzuschreiben, damit ihn die nächste Rechnung nicht vorzieht.
      if (nextPins.get(taskId) !== bleibtAm) {
        nextPins.set(taskId, bleibtAm);
        veraendert = true;
      }
      if (compareDates(jetzt.start, bleibtAm) <= 0) continue;

      const successorTask = taskById(changed, taskId);
      if (successorTask === undefined) continue;

      for (const dependency of incoming(dependencies, taskId)) {
        const predecessor = after.tasks.get(dependency.predecessorId);
        if (predecessor === undefined) continue;

        const aktuellerLag = nextLags.get(keyOf(dependency)) ?? dependency.lagDays ?? 0;
        const gesenkt = lowerLagUntilReached(
          dependency,
          aktuellerLag,
          predecessor,
          successorTask,
          bleibtAm,
          calendar,
        );
        if (gesenkt !== aktuellerLag) {
          nextLags.set(keyOf(dependency), gesenkt);
          veraendert = true;
        }
      }
    }

    if (!veraendert) break;
    lagByKey = nextLags;
    pinned = nextPins;
    after = computeWith(changed, dependencies, lagByKey, pinned, calendar, projectStart);
  }

  const trigger = changeOf(triggerTaskId, before, after, calendar);
  const affected: ProposedChange[] = [];
  for (const task of changed) {
    if (task.id === triggerTaskId) continue;
    const eintrag = changeOf(task.id, before, after, calendar);
    if (eintrag !== null) affected.push(eintrag);
  }

  const lagAdjustments: LagAdjustment[] = [];
  for (const dependency of dependencies) {
    const neu = lagByKey.get(keyOf(dependency));
    const alt = dependency.lagDays ?? 0;
    if (neu === undefined || neu === alt) continue;
    lagAdjustments.push({
      predecessorId: dependency.predecessorId,
      successorId: dependency.successorId,
      type: dependency.type ?? 'FS',
      fromLagDays: alt,
      toLagDays: neu,
    });
  }

  return {
    trigger,
    affected,
    decoupled: [...keepStart.keys()],
    lagAdjustments,
    pinnedStarts: [...pinned].map(([taskId, earliestStart]) => ({ taskId, earliestStart })),
    projectEndBefore: before.projectEnd,
    projectEndAfter: after.projectEnd,
    effectWorkdays: workdayDifference(before.projectEnd, after.projectEnd, calendar),
    after,
  };
}

// -- Hilfsfunktionen ---------------------------------------------------------

function taskById(tasks: readonly ScheduleTask[], id: TaskId): ScheduleTask | undefined {
  return tasks.find((task) => task.id === id);
}

function incoming(
  dependencies: readonly ScheduleDependency[],
  successorId: TaskId,
): ScheduleDependency[] {
  return dependencies.filter((dependency) => dependency.successorId === successorId);
}

/** Rechnet mit den bisher gesenkten Vorläufen und den festgehaltenen Anfängen. */
function computeWith(
  tasks: readonly ScheduleTask[],
  dependencies: readonly ScheduleDependency[],
  lagByKey: ReadonlyMap<string, number>,
  pinned: ReadonlyMap<TaskId, IsoDate>,
  calendar: Calendar,
  projectStart: IsoDate,
): ScheduleResult {
  return computeSchedule({
    tasks: tasks.map((task) => {
      const halt = pinned.get(task.id);
      return halt === undefined ? task : { ...task, earliestStart: halt };
    }),
    dependencies: dependencies.map((dependency) => {
      const lag = lagByKey.get(keyOf(dependency));
      return lag === undefined ? dependency : { ...dependency, lagDays: lag };
    }),
    calendar,
    projectStart,
  });
}

/**
 * Senkt den Vorlauf so weit, bis die Beziehung den Nachfolger nicht mehr über
 * seinen Haltetag hinausschiebt.
 *
 * Der erste Schritt trifft es fast immer: Bei Werktagsvorlauf und einem
 * Vorgang in Werktagen ist die Rechnung linear, die Differenz also exakt. Die
 * Schleife danach fängt die krummen Fälle ab — Vorlauf in Kalendertagen,
 * Nachfolger in Werktagen —, in denen ein Tag mehr oder weniger auf denselben
 * Werktag fällt.
 */
function lowerLagUntilReached(
  dependency: ScheduleDependency,
  currentLag: number,
  predecessor: ScheduledTask,
  successor: ScheduleTask,
  keepStart: IsoDate,
  calendar: Calendar,
): number {
  const erreicht = (lag: number): boolean =>
    compareDates(
      dependencyConstraint({ ...dependency, lagDays: lag }, predecessor, successor, calendar),
      keepStart,
    ) <= 0;

  if (erreicht(currentLag)) return currentLag;

  const zuViel = workdayDifference(
    keepStart,
    dependencyConstraint({ ...dependency, lagDays: currentLag }, predecessor, successor, calendar),
    calendar,
  );
  let lag = currentLag - Math.max(zuViel, 1);

  for (let schritt = 0; schritt < MAX_LAG_STEPS && !erreicht(lag); schritt += 1) {
    lag -= 1;
  }
  return lag;
}

function changeOf(
  taskId: TaskId,
  before: ScheduleResult,
  after: ScheduleResult,
  calendar: Calendar,
): ProposedChange | null {
  const vorher = before.tasks.get(taskId);
  const nachher = after.tasks.get(taskId);
  if (vorher === undefined || nachher === undefined) return null;
  if (vorher.start === nachher.start && vorher.end === nachher.end) return null;

  return {
    taskId,
    fromStart: vorher.start,
    fromEnd: vorher.end,
    toStart: nachher.start,
    toEnd: nachher.end,
    shiftWorkdays: workdayDifference(vorher.start, nachher.start, calendar),
  };
}
