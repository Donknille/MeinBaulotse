/**
 * Erzeugt die Datenlage, mit der der Styleguide die Planansicht zeigt.
 *
 * Bewusst ohne Datenbank und ohne laufenden Server: dieselbe Vorlage, derselbe
 * Berechnungskern wie im Betrieb, nur ohne Kennungen aus Postgres. Damit ist
 * die Vorschau deterministisch und der Styleguide ohne Anmeldung benutzbar.
 *
 * Aufruf: `pnpm --filter @meinbaulotse/web fixture`
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  computeSchedule,
  criticalPath,
  DECISION_TEMPLATES,
  decisionDueDate,
  EFH_MASSIV_UNTERKELLERT,
  instantiateTemplate,
  PHASES,
  TRADES,
  type Calendar,
} from '@meinbaulotse/schedule';
import { permissionsOf } from '@meinbaulotse/db';
import type {
  DecisionDto,
  PhaseProgress,
  ProjectSchedule,
  ScheduledTaskDto,
} from '@meinbaulotse/shared';

const PLANNED_START = '2026-04-01';
const CONTRACTUAL_END = '2026-09-30';
const calendar: Calendar = { federalState: 'BY' };

const plan = instantiateTemplate(EFH_MASSIV_UNTERKELLERT, { hasBasement: true });
const schedule = computeSchedule({
  tasks: plan.tasks,
  dependencies: plan.dependencies,
  calendar,
  projectStart: PLANNED_START,
});
const floats = criticalPath({
  tasks: plan.tasks,
  dependencies: plan.dependencies,
  calendar,
  schedule,
  contractualEnd: CONTRACTUAL_END,
});

const tradeNameByCode = new Map(TRADES.map((trade) => [trade.code, trade.name]));

/**
 * Welche Vorgänge eine Lotsenkarte tragen.
 *
 * Gelesen wird nur das eine Kopffeld `vorgaenge` aus den Redaktionsdateien —
 * nicht der ganze Inhalt. Der Styleguide braucht keine Karten, sondern nur die
 * Auskunft, an welchen Zeilen der Knopf „Was passiert?" steht. Die
 * Erstbefüllung der Datenbank macht weiterhin allein
 * `packages/db/scripts/generate-guide-cards.ts`.
 *
 * Die Kennung ist erfunden und deterministisch: Im Styleguide gibt es keine
 * Datenbank, und geladen wird die Karte dort ohnehin nicht.
 */
function taskCodesWithGuideCard(): Set<string> {
  const dir = join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    '..',
    'content',
    'lotsenkarten',
  );
  const codes = new Set<string>();
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.md') || file === 'README.md') continue;
    const treffer = /^vorgaenge:(.*)$/m.exec(readFileSync(join(dir, file), 'utf8'));
    if (treffer === null) continue;
    for (const code of treffer[1]!.split(',')) {
      const bereinigt = code.trim();
      if (bereinigt !== '') codes.add(bereinigt);
    }
  }
  return codes;
}

const mitKarte = taskCodesWithGuideCard();

const tasks: ScheduledTaskDto[] = plan.tasks.map((task, index) => {
  const scheduled = schedule.tasks.get(task.id)!;
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
    baselineStart: scheduled.start,
    baselineEnd: scheduled.end,
    earliestStart: null,
    actualStart: null,
    actualEnd: null,
    status: 'terminiert',
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
    guideCardId: mitKarte.has(task.code)
      ? `00000000-0000-4000-8000-${String(index + 900).padStart(12, '0')}`
      : null,
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

/**
 * Die Entscheidungen entstehen aus denselben Vorlagen wie im Betrieb, nur ohne
 * Datenbank. Zwei stehen bewusst nicht mehr auf „offen" — sonst zeigte der
 * Styleguide nur einen einzigen Zustand von fünfen.
 */
const startByCode = new Map(
  plan.tasks.map((task) => [task.code, schedule.tasks.get(task.id)!.start]),
);
const taskIdByCode = new Map(tasks.map((task, index) => [plan.tasks[index]!.code, task.id]));
const taskNameByCode = new Map(plan.tasks.map((task) => [task.code, task.name]));

const decisions: DecisionDto[] = DECISION_TEMPLATES.filter((template) =>
  startByCode.has(template.blocksTaskCode),
)
  .map((template, index) => {
    const start = startByCode.get(template.blocksTaskCode)!;
    const status: DecisionDto['status'] =
      index === 0 ? 'beauftragt' : index === 1 ? 'in_bemusterung' : 'offen';
    return {
      id: `00000000-0000-4000-8000-${String(index + 500).padStart(12, '0')}`,
      templateKey: template.key,
      title: template.title,
      description: template.description,
      reason: template.reason,
      help: template.help,
      blocksTaskId: taskIdByCode.get(template.blocksTaskCode) ?? null,
      blocksTaskName: taskNameByCode.get(template.blocksTaskCode) ?? null,
      blocksTaskStart: start,
      leadTimeDays: template.leadTimeDays,
      leadTimeUnit: template.leadTimeUnit,
      dueDate: decisionDueDate(
        {
          id: template.key,
          blocksTaskId: template.blocksTaskCode,
          leadTimeDays: template.leadTimeDays,
          leadTimeUnit: template.leadTimeUnit,
        },
        start,
        calendar,
      ),
      status,
      decidedAt: status === 'beauftragt' ? '2026-03-02T09:00:00.000Z' : null,
      decidedNote: null,
      estimatedCostCents: null,
    };
  })
  .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));

const fixture: ProjectSchedule = {
  project: {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Musterweg 4',
    federalState: 'BY',
    buildType: 'efh_massiv',
    contractType: 'verbraucherbauvertrag',
    catholicMunicipality: false,
    hasBasement: true,
    plannedStart: PLANNED_START,
    contractualCompletion: CONTRACTUAL_END,
    role: 'owner',
  },
  // Aus derselben Quelle, aus der die Seed-Migration `role_permission` befüllt.
  // Eine zweite Liste im Code wäre genau die Doppelpflege, die Regel 5 verbietet.
  permissions: [...permissionsOf('owner')],
  phases,
  tasks,
  decisions,
  computedEnd: schedule.projectEnd,
  contractualEnd: CONTRACTUAL_END,
  deviationWorkdays: floats.deviationWorkdays,
};

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, '..', 'src', 'routes', 'plan-fixture.ts');

writeFileSync(
  target,
  `/* Erzeugt von scripts/make-plan-fixture.ts — nicht von Hand bearbeiten. */\n\n` +
    `import type { ProjectSchedule } from '@meinbaulotse/shared';\n\n` +
    `export const PLAN_FIXTURE: ProjectSchedule = ${JSON.stringify(fixture, null, 2)};\n`,
  'utf8',
);

console.log(
  `Vorschau geschrieben: ${target}\n` +
    `  ${tasks.length} Vorgänge, Ende ${schedule.projectEnd}, ` +
    `Abweichung ${floats.deviationWorkdays} Werktage,\n` +
    `  ${tasks.filter((task) => task.guideCardId !== null).length} davon mit Lotsenkarte,\n` +
    `  ${decisions.length} Entscheidungen.`,
);
