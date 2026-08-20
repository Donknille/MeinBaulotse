/**
 * Erzeugt die Seed-Migration aus den Quelldaten.
 *
 * Aufruf: `pnpm --filter @meinbaulotse/db seed:generate`
 *
 * Die erzeugte Datei wird eingecheckt. Sie ist ab dann eine gewöhnliche
 * Migration und wird nicht mehr angefasst — Änderungen an den Stammdaten
 * kommen als neue Migration oder, im Regelfall, über die Redaktionsoberfläche
 * direkt in der Datenbank.
 */

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DECISION_TEMPLATES,
  EFH_MASSIV_UNTERKELLERT,
  PHASES,
  TRADES,
} from '@meinbaulotse/schedule';
import { PERMISSIONS } from '../src/permissions.js';

const here = dirname(fileURLToPath(import.meta.url));
const migrations = join(here, '..', '..', '..', 'supabase', 'migrations');
const target = join(migrations, '0003_seed.sql');

// Die Entscheidungsvorlagen stehen in einer eigenen Datei, weil ihre Tabelle
// erst in 0004 entsteht. Eine Seed-Anweisung vor ihrer Tabelle wäre keine
// Migration, sondern ein Fehler beim ersten Einspielen.
const decisionTarget = join(migrations, '0005_seed_entscheidungen.sql');

const q = (value: string | null | undefined): string =>
  value === null || value === undefined ? 'null' : `'${value.replace(/'/g, "''")}'`;

const lines: string[] = [
  '-- ---------------------------------------------------------------------------',
  '-- MeinBaulotse — Stammdaten (erzeugt, nicht von Hand bearbeiten)',
  '--',
  '-- Erzeugt von packages/db/scripts/generate-seed.ts aus:',
  '--   - packages/schedule/src/templates/efh-massiv-unterkellert.ts',
  '--   - packages/db/src/permissions.ts',
  '--',
  '-- Enthält die neun Bauphasen aus Abschnitt 7.1, die Gewerke, die',
  '-- Rechtematrix aus Abschnitt 2.2 und die Ablaufvorlage aus Abschnitt 7.2.',
  '-- ---------------------------------------------------------------------------',
  '',
  '-- Bauphasen -----------------------------------------------------------------',
  '',
  'insert into phase (key, name, ordinal) values',
  PHASES.map((phase) => `  (${q(phase.key)}, ${q(phase.name)}, ${phase.ordinal})`).join(',\n') +
    '\non conflict (key) do nothing;',
  '',
  '-- Gewerke -------------------------------------------------------------------',
  '',
  'insert into trade (project_id, code, name, sort_order) values',
  TRADES.map((trade) => `  (null, ${q(trade.code)}, ${q(trade.name)}, ${trade.sortOrder})`).join(
    ',\n',
  ) + '\non conflict do nothing;',
  '',
  '-- Rechtematrix (Abschnitt 2.2) ----------------------------------------------',
  '',
  'insert into role_permission (role, permission) values',
];

const permissionRows = PERMISSIONS.flatMap((entry) =>
  entry.roles.map((role) => ({ role, permission: entry.permission, matrixRow: entry.matrixRow })),
);
// Das Komma muss VOR den Kommentar, sonst verschluckt der Zeilenkommentar es
// und die Anweisung bricht ab.
lines.push(
  permissionRows
    .map(
      (row, index) =>
        `  (${q(row.role)}, ${q(row.permission)})${index < permissionRows.length - 1 ? ',' : ''}` +
        `  -- ${row.matrixRow}`,
    )
    .join('\n') + '\non conflict do nothing;',
);

lines.push(
  '',
  '-- Ablaufvorlage (Abschnitt 7.2) ---------------------------------------------',
  '',
  `insert into plan_template (key, name, build_types, version) values`,
  `  (${q(EFH_MASSIV_UNTERKELLERT.key)}, ${q(EFH_MASSIV_UNTERKELLERT.name)},` +
    ` '{efh_massiv,efh_fertighaus,sanierung,sonstiges}', 1)`,
  'on conflict (key) do nothing;',
  '',
  'insert into plan_template_task',
  '  (template_key, code, name, trade_code, phase_key, duration_days, duration_unit,',
  '   is_milestone, is_wait, include_when, sort_order)',
  'values',
);

lines.push(
  EFH_MASSIV_UNTERKELLERT.tasks
    .map(
      (task) =>
        `  (${q(EFH_MASSIV_UNTERKELLERT.key)}, ${q(task.code)}, ${q(task.name)}, ` +
        `${q(task.tradeCode ?? null)}, ${q(task.phaseKey)}, ${task.durationDays}, ` +
        `${q(task.durationUnit)}, ${task.isMilestone}, ${task.isWait}, ` +
        `${q(task.includeWhen)}, ${task.sortOrder})`,
    )
    .join(',\n') + '\non conflict (template_key, code) do nothing;',
);

lines.push(
  '',
  'insert into plan_template_dependency',
  '  (template_key, predecessor_code, successor_code, type, lag_days, lag_unit)',
  'values',
);

lines.push(
  EFH_MASSIV_UNTERKELLERT.dependencies
    .map(
      (dependency) =>
        `  (${q(EFH_MASSIV_UNTERKELLERT.key)}, ${q(dependency.predecessorCode)}, ` +
        `${q(dependency.successorCode)}, ${q(dependency.type)}, ${dependency.lagDays}, ` +
        `${q(dependency.lagUnit)})`,
    )
    .join(',\n') + '\non conflict do nothing;',
  '',
);

writeFileSync(target, lines.join('\n'), 'utf8');

// -- Entscheidungsvorlagen (Abschnitt 7.3) ----------------------------------

const decisionLines: string[] = [
  '-- ---------------------------------------------------------------------------',
  '-- MeinBaulotse — Entscheidungsvorlagen (erzeugt, nicht von Hand bearbeiten)',
  '--',
  '-- Erzeugt von packages/db/scripts/generate-seed.ts aus:',
  '--   - packages/schedule/src/templates/decisions.ts',
  '--',
  '-- Abschnitt 7.3 der Spezifikation. `blocks_task_code` verweist auf die',
  '-- Nummern der Ablaufvorlage aus 7.2.',
  '-- ---------------------------------------------------------------------------',
  '',
  'insert into decision_template',
  '  (key, title, description, help_text, blocks_task_code, lead_time_days,',
  '   lead_time_unit, sort_order)',
  'values',
  DECISION_TEMPLATES.map(
    (entry) =>
      `  (${q(entry.key)}, ${q(entry.title)}, ${q(entry.description)},\n` +
      `   ${q(entry.helpText)},\n` +
      `   ${q(entry.blocksTaskCode)}, ${entry.leadTimeDays}, ${q(entry.leadTimeUnit)}, ` +
      `${entry.sortOrder})`,
  ).join(',\n') + '\non conflict (key) do nothing;',
  '',
];

writeFileSync(decisionTarget, decisionLines.join('\n'), 'utf8');

console.log(
  `Seed geschrieben: ${target}\n` +
    `  ${PHASES.length} Phasen, ${TRADES.length} Gewerke, ${permissionRows.length} Rechte, ` +
    `${EFH_MASSIV_UNTERKELLERT.tasks.length} Vorlagenvorgänge, ` +
    `${EFH_MASSIV_UNTERKELLERT.dependencies.length} Abhängigkeiten.\n` +
    `Seed geschrieben: ${decisionTarget}\n` +
    `  ${DECISION_TEMPLATES.length} Entscheidungsvorlagen.`,
);
