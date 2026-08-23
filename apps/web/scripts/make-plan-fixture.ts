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
import { parseGuideCard, permissionsOf } from '@meinbaulotse/db';
import type {
  DecisionDto,
  GuideCardView,
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
 * Welcher Vorgang trägt eine Lotsenkarte?
 *
 * Aus denselben Markdown-Dateien, aus denen die Import-Migration entsteht.
 * Eine zweite Liste im Skript wäre still veraltet, sobald eine Karte
 * dazukommt — und dann zeigte der Styleguide Knöpfe, die es nicht gibt, oder
 * keine, wo es welche gibt.
 */
const kartenVerzeichnis = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'content',
  'lotsenkarten',
);
const guideCardKeyByTaskCode = new Map<string, string>();
const karten = readdirSync(kartenVerzeichnis)
  .filter((name) => name.endsWith('.md'))
  .map((datei) => parseGuideCard(datei, readFileSync(join(kartenVerzeichnis, datei), 'utf8')));
for (const karte of karten) {
  for (const code of karte.templateTaskCodes) guideCardKeyByTaskCode.set(code, karte.key);
}

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
    guideCardKey: guideCardKeyByTaskCode.get(task.code) ?? null,
    // Im Styleguide ist nichts gelesen: Er soll die Einblendung zeigen, nicht
    // ihren Ruhezustand.
    guideCardRead: false,
  };
});

/**
 * Die Entscheidungen, aus denselben Vorlagen wie im Betrieb und mit derselben
 * Rechnung. Zwei davon stehen bewusst schon auf „entschieden": Der Styleguide
 * soll auch zeigen, wie eine erledigte Sache aussieht.
 */
const taskByCode = new Map(plan.tasks.map((task) => [task.code, task]));
const decisions: DecisionDto[] = DECISION_TEMPLATES.flatMap((template, index) => {
  const task = taskByCode.get(template.blocksTaskCode);
  if (task === undefined) return [];
  const start = schedule.tasks.get(task.id)!.start;

  return [
    {
      id: `00000000-0000-4000-8000-${String(index + 500).padStart(12, '0')}`,
      templateKey: template.key,
      title: template.title,
      description: template.description,
      helpText: template.helpText,
      blocksTaskId: `00000000-0000-4000-8000-${String(plan.tasks.indexOf(task) + 100).padStart(12, '0')}`,
      blocksTaskName: task.name,
      blocksTaskStart: start,
      leadTimeDays: template.leadTimeDays,
      leadTimeUnit: template.leadTimeUnit,
      dueDate: decisionDueDate(
        {
          id: template.key,
          blocksTaskId: task.id,
          leadTimeDays: template.leadTimeDays,
          leadTimeUnit: template.leadTimeUnit,
        },
        start,
        calendar,
      ),
      status: index < 2 ? ('entschieden' as const) : ('offen' as const),
      decidedAt: index < 2 ? '2026-03-02T10:00:00.000Z' : null,
      decidedNote: index < 2 ? 'Beim Termin am 02.03. festgelegt.' : null,
      estimatedCostCents: index === 2 ? 480_000 : null,
    },
  ];
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
    catholicMunicipality: false,
  },
  // Zwei Beteiligte: der Bauherr mit Konto, der GU nur über einen Link. Genau
  // dieser Unterschied ist der Punkt von Abschnitt 2.3.
  members: [
    {
      id: '00000000-0000-4000-8000-000000000801',
      role: 'owner' as const,
      displayName: 'Familie Muster',
      company: null,
      email: 'bauherr@example.test',
      tradeName: null,
      hasAccount: true,
      hasGuestLink: false,
    },
    {
      id: '00000000-0000-4000-8000-000000000802',
      role: 'contractor' as const,
      displayName: 'Jörg Baumeister',
      company: 'Baumeister Bau',
      email: 'gu@example.test',
      tradeName: null,
      hasAccount: false,
      hasGuestLink: true,
    },
  ],
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

/**
 * Eine echte Lotsenkarte für den Styleguide.
 *
 * Aus derselben Markdown-Datei, aus der die Import-Migration entsteht — der
 * Styleguide ist die lebende Gegenprobe zum Gestaltungssystem (CI 15), und
 * eine nachgebaute Beispielkarte wäre genau das nicht.
 */
const beispielKarte = karten.find((karte) => karte.key === 'estrich');
if (beispielKarte === undefined) {
  throw new Error('Die Karte „estrich" fehlt — ohne sie hat der Styleguide keine Lotsenkarte.');
}
const beispielVorgang = tasks.find((task) => task.guideCardKey === beispielKarte.key)!;

const guideFixture: GuideCardView = {
  card: {
    id: '00000000-0000-4000-8000-000000000900',
    key: beispielKarte.key,
    version: beispielKarte.version,
    title: beispielKarte.title,
    phaseKey: beispielKarte.phaseKey,
    tradeCode: beispielKarte.tradeCode,
    whatsHappening: beispielKarte.whatsHappening,
    watchFor: [...beispielKarte.watchFor],
    questionsForContractor: [...beispielKarte.questionsForContractor],
    commonProblems: [...beispielKarte.commonProblems],
    photoPrompts: [...beispielKarte.photoPrompts],
    expertRecommended: beispielKarte.expertRecommended,
    expertReason: beispielKarte.expertReason,
    sources: [...beispielKarte.sources],
  },
  taskId: beispielVorgang.id,
  taskName: beispielVorgang.name,
  // Der erste Punkt abgehakt: So zeigt der Styleguide beide Zustände.
  checklist: beispielKarte.watchFor.map((point, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 910).padStart(12, '0')}`,
    text: point.text,
    why: point.why,
    sortOrder: index,
    isDone: index === 0,
    doneAt: index === 0 ? '2026-07-30T09:12:00.000Z' : null,
    note: null,
  })),
  read: null,
  canCheck: true,
};

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, '..', 'src', 'routes', 'plan-fixture.ts');

writeFileSync(
  target,
  `/* Erzeugt von scripts/make-plan-fixture.ts — nicht von Hand bearbeiten. */\n\n` +
    `import type { GuideCardView, ProjectSchedule } from '@meinbaulotse/shared';\n\n` +
    `export const PLAN_FIXTURE: ProjectSchedule = ${JSON.stringify(fixture, null, 2)};\n\n` +
    `export const GUIDE_CARD_FIXTURE: GuideCardView = ${JSON.stringify(guideFixture, null, 2)};\n`,
  'utf8',
);

console.log(
  `Vorschau geschrieben: ${target}\n` +
    `  ${tasks.length} Vorgänge, Ende ${schedule.projectEnd}, ` +
    `Abweichung ${floats.deviationWorkdays} Werktage.\n` +
    `  Lotsenkarte für den Styleguide: „${beispielKarte.title}".\n` +
    `  ${decisions.length} Entscheidungen, nächste Frist ${
      [...decisions].sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''))[0]?.dueDate ?? '—'
    }.`,
);
