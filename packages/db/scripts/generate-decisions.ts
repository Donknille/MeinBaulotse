/**
 * Erzeugt die Migration mit den Entscheidungsvorlagen aus Abschnitt 7.3.
 *
 * Aufruf: `pnpm --filter @meinbaulotse/db decisions:generate`
 *
 * Quelle ist `packages/schedule/src/templates/entscheidungen.ts`. Wie bei den
 * Lotsenkarten gilt: Die erzeugte Datei wird eingecheckt, die CI prüft, dass
 * sie zu ihrer Quelle passt, und ein zweiter Durchlauf ändert nichts —
 * jedes `insert` endet auf `on conflict do nothing`.
 */

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DECISION_TEMPLATES, EFH_MASSIV_UNTERKELLERT } from '@meinbaulotse/schedule';

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, '..', '..', '..', 'supabase', 'migrations', '0008_entscheidungen.sql');

const q = (value: string): string => `'${value.replace(/'/g, "''")}'`;

// Eine Vorlage, die auf einen Vorgang zeigt, den es nicht gibt, wäre eine
// Frist ohne Termin — und die fiele erst dem Bauherrn auf.
const codes = new Set(EFH_MASSIV_UNTERKELLERT.tasks.map((task) => task.code));
for (const template of DECISION_TEMPLATES) {
  if (!codes.has(template.blocksTaskCode)) {
    throw new Error(
      `Entscheidung „${template.key}" hängt an Vorgang ${template.blocksTaskCode}, ` +
        'den die Ablaufvorlage nicht kennt.',
    );
  }
}

const lines = [
  '-- ---------------------------------------------------------------------------',
  '-- MeinBaulotse — Entscheidungsvorlagen (erzeugt, nicht von Hand bearbeiten)',
  '--',
  '-- Erzeugt von packages/db/scripts/generate-decisions.ts aus:',
  '--   packages/schedule/src/templates/entscheidungen.ts',
  '--',
  '-- Neu erzeugen: pnpm --filter @meinbaulotse/db decisions:generate',
  '--',
  '-- Abschnitt 7.3 der Spezifikation. Die Vorlaufzeiten sind das Ergebnis der',
  '-- Frage „wie lange vorher muss das feststehen, damit der Vorgang nicht',
  '-- wartet" — nicht die Frage, wie lange jemand zum Überlegen braucht.',
  '-- ---------------------------------------------------------------------------',
  '',
  'insert into decision_template',
  '  (key, title, description, help_text, blocks_task_code, lead_time_days, lead_time_unit, sort_order)',
  'values',
  [...DECISION_TEMPLATES]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(
      (template) =>
        `  (${q(template.key)}, ${q(template.title)}, ${q(template.description)},\n` +
        `   ${q(template.helpText)},\n` +
        `   ${q(template.blocksTaskCode)}, ${template.leadTimeDays}, ` +
        `${q(template.leadTimeUnit)}, ${template.sortOrder})`,
    )
    .join(',\n') + '\non conflict (key) do nothing;',
  '',
];

writeFileSync(target, lines.join('\n'), 'utf8');

const längsteFrist = Math.max(...DECISION_TEMPLATES.map((t) => t.leadTimeDays));
console.log(
  `Entscheidungsvorlagen geschrieben: ${target}\n` +
    `  ${DECISION_TEMPLATES.length} Vorlagen, längste Vorlaufzeit ${längsteFrist} Werktage.`,
);
