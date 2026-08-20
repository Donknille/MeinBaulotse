/**
 * Erzeugt die Datenlage, mit der der Styleguide die Planansicht zeigt.
 *
 * Bewusst ohne Datenbank und ohne laufenden Server: dieselbe Vorlage, derselbe
 * Berechnungskern wie im Betrieb, nur ohne Kennungen aus Postgres. Damit ist
 * die Vorschau deterministisch und der Styleguide ohne Anmeldung benutzbar.
 *
 * Aufruf: `pnpm --filter @meinbaulotse/web fixture`
 */

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  computeSchedule,
  criticalPath,
  decisionDueDates,
  DECISION_TEMPLATES,
  EFH_MASSIV_UNTERKELLERT,
  instantiateTemplate,
  PHASES,
  TRADES,
  type Calendar,
} from '@meinbaulotse/schedule';
import type {
  DecisionDto,
  PhaseProgress,
  ProjectSchedule,
  ScheduledTaskDto,
} from '@meinbaulotse/shared';

const PLANNED_START = '2026-04-01';
const CONTRACTUAL_END = '2026-09-30';
/**
 * Fester „Heute"-Bezug. Die Vorschau soll deterministisch sein: Ein Styleguide,
 * dessen Bild sich mit dem Kalender ändert, taugt nicht als Gegenprobe.
 */
const TODAY = '2026-06-15';
const calendar: Calendar = { federalState: 'BY' };

const plan = instantiateTemplate(EFH_MASSIV_UNTERKELLERT, { hasBasement: true });

/** Der ursprünglich vereinbarte Ablauf — die Baseline. */
const baseline = computeSchedule({
  tasks: plan.tasks,
  dependencies: plan.dependencies,
  calendar,
  projectStart: PLANNED_START,
});

/**
 * Und der heutige Stand.
 *
 * Ohne eine Verschiebung zeigte die Zeitachse zwei Spuren übereinander, die
 * deckungsgleich sind — also nichts. Deshalb wandert hier ein Vorgang, so wie
 * er es im Betrieb täte: `earliestStart` ist genau das, was `task.pinned_start`
 * in der Datenbank auslöst. Der Rest ergibt sich aus dem Bauablauf, nicht aus
 * hingeschriebenen Daten.
 */
const VERSCHOBEN = { code: 't18', start: '2026-07-13' } as const;

const currentTasks = plan.tasks.map((task) =>
  task.id === VERSCHOBEN.code ? { ...task, earliestStart: VERSCHOBEN.start } : task,
);
const schedule = computeSchedule({
  tasks: currentTasks,
  dependencies: plan.dependencies,
  calendar,
  projectStart: PLANNED_START,
});
const floats = criticalPath({
  tasks: currentTasks,
  dependencies: plan.dependencies,
  calendar,
  schedule,
  contractualEnd: CONTRACTUAL_END,
});

const tradeNameByCode = new Map(TRADES.map((trade) => [trade.code, trade.name]));

const tasks: ScheduledTaskDto[] = plan.tasks.map((task, index) => {
  const scheduled = schedule.tasks.get(task.id)!;
  const original = baseline.tasks.get(task.id)!;
  const float = floats.floats.get(task.id)!;
  return {
    id: `00000000-0000-4000-8000-${String(index + 100).padStart(12, '0')}`,
    name: task.name,
    phaseKey: task.phaseKey,
    tradeCode: task.tradeCode ?? null,
    tradeName: task.tradeCode === undefined ? null : (tradeNameByCode.get(task.tradeCode) ?? null),
    sortOrder: task.sortOrder,
    isMilestone: task.isMilestone === true,
    isWait: task.isWait === true,
    durationDays: task.durationDays,
    durationUnit: task.durationUnit ?? 'werktage',
    currentStart: scheduled.start,
    currentEnd: scheduled.end,
    baselineStart: original.start,
    baselineEnd: original.end,
    // Was vor dem Stichtag lag, ist erledigt — sonst zeigte die Vorschau eine
    // Baustelle, auf der seit April niemand etwas gemeldet hat.
    actualStart: scheduled.end < TODAY ? scheduled.start : null,
    actualEnd: scheduled.end < TODAY ? scheduled.end : null,
    status: scheduled.end < TODAY ? 'fertig' : 'terminiert',
    // Ein paar Bestätigungsgrade streuen, damit der Styleguide alle vier zeigt.
    confirmation:
      index % 7 === 0
        ? 'mutual'
        : index % 11 === 0
          ? 'disputed'
          : index % 5 === 0
            ? 'counterparty_stated'
            : 'self_stated',
    totalFloatDays: float.totalFloatDays,
    isCritical: float.isCritical,
  };
});

const phases: PhaseProgress[] = PHASES.map((phase) => {
  const inPhase = tasks.filter((task) => task.phaseKey === phase.key);
  const starts = inPhase.map((task) => task.currentStart).filter((v): v is string => v !== null);
  const ends = inPhase.map((task) => task.currentEnd).filter((v): v is string => v !== null);
  return {
    key: phase.key,
    name: phase.name,
    ordinal: phase.ordinal,
    taskCount: inPhase.length,
    firstStart: starts.length === 0 ? null : starts.reduce((a, b) => (a < b ? a : b)),
    lastEnd: ends.length === 0 ? null : ends.reduce((a, b) => (a > b ? a : b)),
  };
});

const fixture: ProjectSchedule = {
  project: {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Musterweg 4',
    federalState: 'BY',
    buildType: 'efh_massiv',
    contractType: 'verbraucherbauvertrag',
    hasBasement: true,
    plannedStart: PLANNED_START,
    contractualCompletion: CONTRACTUAL_END,
    role: 'owner',
    memberId: '00000000-0000-4000-8000-000000000002',
    // Dieselben Rechte, die role_permission dem Bauherrn gibt.
    permissions: [
      'contract.write',
      'decision.write',
      'defect.resolve',
      'defect.write',
      'diary.write',
      'export.file',
      'member.invite',
      'payment.release',
      'project.delete',
      'project.read',
      'task.confirm',
      'task.report',
      'task.schedule',
      'task.write',
    ],
    tradeId: null,
  },
  phases,
  tasks,
  computedEnd: schedule.projectEnd,
  contractualEnd: CONTRACTUAL_END,
  deviationWorkdays: floats.deviationWorkdays,
};

// -- Entscheidungen ----------------------------------------------------------
//
// Damit der Styleguide die Rauten auf der Zeitachse zeigt und nicht nur
// behauptet, dass es sie gibt.

const taskIdByCode = new Map(plan.tasks.map((task, index) => [task.code, tasks[index]!.id]));
const startByTaskId = new Map(tasks.map((task) => [task.id, task.currentStart!] as const));

const relevant = DECISION_TEMPLATES.filter((entry) => taskIdByCode.has(entry.blocksTaskCode));
const due = decisionDueDates(
  relevant.map((entry) => ({
    id: entry.key,
    blocksTaskId: taskIdByCode.get(entry.blocksTaskCode)!,
    leadTimeDays: entry.leadTimeDays,
    leadTimeUnit: entry.leadTimeUnit,
  })),
  startByTaskId,
  calendar,
  TODAY,
);

const decisions: DecisionDto[] = relevant.map((entry, index) => {
  const taskId = taskIdByCode.get(entry.blocksTaskCode)!;
  const computed = due.get(entry.key)!;
  return {
    id: `00000000-0000-4000-8000-${String(index + 500).padStart(12, '0')}`,
    title: entry.title,
    description: entry.description,
    helpText: entry.helpText,
    blocksTaskId: taskId,
    blocksTaskName: tasks.find((task) => task.id === taskId)!.name,
    blocksTaskStart: startByTaskId.get(taskId) ?? null,
    leadTimeDays: entry.leadTimeDays,
    leadTimeUnit: entry.leadTimeUnit,
    dueDate: computed.dueDate,
    status: index % 5 === 0 ? 'entschieden' : index % 3 === 0 ? 'in_bemusterung' : 'offen',
    decidedAt: index % 5 === 0 ? `${TODAY}T09:00:00.000Z` : null,
    decidedNote: null,
    estimatedCostCents: null,
    remainingWorkdays: computed.remainingWorkdays,
    isOverdue: computed.isOverdue,
  };
});

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, '..', 'src', 'routes', 'plan-fixture.ts');

writeFileSync(
  target,
  `/* Erzeugt von scripts/make-plan-fixture.ts — nicht von Hand bearbeiten. */\n\n` +
    `import type { DecisionDto, ProjectSchedule } from '@meinbaulotse/shared';\n\n` +
    `export const PLAN_FIXTURE: ProjectSchedule = ${JSON.stringify(fixture, null, 2)};\n\n` +
    `export const DECISION_FIXTURE: DecisionDto[] = ${JSON.stringify(decisions, null, 2)};\n`,
  'utf8',
);

console.log(
  `Vorschau geschrieben: ${target}\n` +
    `  ${tasks.length} Vorgänge, ${decisions.length} Entscheidungen, Ende ${schedule.projectEnd}, ` +
    `Abweichung ${floats.deviationWorkdays} Werktage.`,
);
