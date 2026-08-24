/**
 * Erzeugt die Migration mit den Entscheidungsvorlagen.
 *
 * Aufruf: `pnpm --filter @meinbaulotse/db decisions:generate`
 * Quelle: `packages/schedule/src/templates/entscheidungen.ts`
 * Ziel:   `supabase/migrations/0008_decision_templates.sql`
 *
 * Dieselbe Aufteilung wie bei der Ablaufvorlage und den Lotsenkarten: Die
 * Datei im Repository ist die Erstbefüllung, die Datenbank ist ab dem
 * Einspielen die Autorität (Regel 5).
 */

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DECISION_TEMPLATES, EFH_MASSIV_UNTERKELLERT } from '@meinbaulotse/schedule';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const target = join(root, 'supabase', 'migrations', '0008_decision_templates.sql');

const q = (value: string | null): string =>
  value === null ? 'null' : `'${value.replace(/'/g, "''")}'`;

// Eine Vorlage, die auf einen Vorgang zeigt, den es nicht gibt, erzeugt später
// eine Entscheidung ohne Frist — und die fällt niemandem auf, weil sie schlicht
// nirgends erscheint.
const taskCodes = new Set(EFH_MASSIV_UNTERKELLERT.tasks.map((task) => task.code));
const unbekannt = DECISION_TEMPLATES.filter((template) => !taskCodes.has(template.blocksTaskCode));
if (unbekannt.length > 0) {
  throw new Error(
    'Diese Entscheidungsvorlagen zeigen auf Vorgänge, die es in der Ablaufvorlage nicht gibt:\n  ' +
      unbekannt.map((t) => `${t.key} → ${t.blocksTaskCode}`).join('\n  '),
  );
}

const doppelt = DECISION_TEMPLATES.map((t) => t.key).filter(
  (key, index, alle) => alle.indexOf(key) !== index,
);
if (doppelt.length > 0) {
  throw new Error(`Doppelte Schlüssel in den Entscheidungsvorlagen: ${doppelt.join(', ')}`);
}

const lines = [
  '-- ---------------------------------------------------------------------------',
  '-- MeinBaulotse — Entscheidungsvorlagen (erzeugt, nicht von Hand bearbeiten)',
  '--',
  '-- Erzeugt von packages/db/scripts/generate-decisions.ts aus',
  '-- packages/schedule/src/templates/entscheidungen.ts. Neu erzeugen:',
  '--   pnpm --filter @meinbaulotse/db decisions:generate',
  '--',
  `-- ${DECISION_TEMPLATES.length} Vorlagen aus Abschnitt 7.3 der Spezifikation.`,
  '-- ---------------------------------------------------------------------------',
  '',
  'insert into decision_template',
  '  (key, title, blocks_task_code, lead_time_days, lead_time_unit, reason,',
  '   description, help, sort_order)',
  'values',
];

lines.push(
  DECISION_TEMPLATES.map(
    (template) =>
      `  (${q(template.key)}, ${q(template.title)}, ${q(template.blocksTaskCode)},\n` +
      `   ${template.leadTimeDays}, ${q(template.leadTimeUnit)}, ${q(template.reason)},\n` +
      `   ${q(template.description)},\n` +
      `   ${q(JSON.stringify(template.help))}::jsonb, ${template.sortOrder})`,
  ).join(',\n') + '\non conflict (key) do nothing;',
  '',
);

writeFileSync(target, lines.join('\n'), 'utf8');

const summe = DECISION_TEMPLATES.reduce((max, t) => Math.max(max, t.leadTimeDays), 0);
console.log(
  `Entscheidungsvorlagen geschrieben: ${target}\n` +
    `  ${DECISION_TEMPLATES.length} Vorlagen, längste Vorlaufzeit ${summe} Werktage.`,
);
