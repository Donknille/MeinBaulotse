/**
 * Erzeugt die Import-Migration für die Lotsenkarten.
 *
 * Aufruf: `pnpm --filter @meinbaulotse/db guide-cards:generate`
 *
 * Quelle sind die Markdown-Dateien in `content/lotsenkarten/`. Wer Inhalt
 * ändert, ändert dort — und erhöht dabei `fassung`, denn eine veröffentlichte
 * Karte ist unveränderlich (Invariante 4.1.6). Diese Datei übersetzt nur.
 *
 * Die CI prüft, dass die erzeugte Migration zu ihren Quellen passt. Eine
 * geänderte Karte ohne neu erzeugte Migration fällt damit auf, bevor sie
 * jemanden erreicht.
 */

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGuideCard, renderGuideCardSql, type GuideCardSource } from '../src/guide-cards.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const source = join(root, 'content', 'lotsenkarten');
const target = join(root, 'supabase', 'migrations', '0006_lotsenkarten.sql');

const sha1 = (input: Uint8Array): Uint8Array =>
  new Uint8Array(createHash('sha1').update(input).digest());

const files = readdirSync(source)
  .filter((name) => name.endsWith('.md'))
  .sort();

if (files.length === 0) {
  throw new Error(`Keine Lotsenkarten in ${source} gefunden.`);
}

const cards: GuideCardSource[] = files.map((name) =>
  parseGuideCard(name, readFileSync(join(source, name), 'utf8')),
);

// Zwei Karten dürfen sich nicht um denselben Vorgang streiten: Sonst hinge es
// von der Sortierung ab, welche der Bauherr zu sehen bekommt.
const belegt = new Map<string, string>();
for (const card of cards) {
  for (const code of card.templateTaskCodes) {
    const schon = belegt.get(code);
    if (schon !== undefined && schon !== card.key) {
      throw new Error(
        `Vorgang ${code} ist zwei Karten zugeordnet: „${schon}" und „${card.key}".`,
      );
    }
    belegt.set(code, card.key);
  }
}

writeFileSync(target, renderGuideCardSql(cards, sha1), 'utf8');

const mitPruefung = cards.filter((card) => card.expertRecommended);
console.log(
  `Lotsenkarten geschrieben: ${target}\n` +
    `  ${cards.length} Karten, ${belegt.size} zugeordnete Vorgänge, ` +
    `${mitPruefung.length} mit empfohlener Fachprüfung ` +
    `(${mitPruefung.map((card) => card.key).join(', ')}).`,
);
