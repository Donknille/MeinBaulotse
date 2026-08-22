/**
 * Erzeugt die Migration mit den Lotsenkarten aus dem Redaktionsordner.
 *
 * Aufruf: `pnpm --filter @meinbaulotse/db cards:generate`
 * Quelle: `content/lotsenkarten/*.md`
 * Ziel:   `supabase/migrations/0006_guide_cards.sql`
 *
 * Warum ein eigener Schritt und kein Import zur Laufzeit: Der Redaktionsinhalt
 * gehört in die Datenbank (Regel 5), damit eine Korrektur keine Auslieferung
 * braucht. Die Dateien sind die Erstbefüllung und die Fassung, an der
 * redaktionell gearbeitet wird — so wie `efh-massiv-unterkellert.ts` die
 * Erstbefüllung der Ablaufvorlage ist.
 *
 * Der Parser ist bewusst klein und streng. Er versteht genau das Format, das
 * `content/lotsenkarten/README.md` beschreibt, und bricht bei allem anderen mit
 * einer Meldung ab, die Datei und Zeile nennt. Eine Redaktionsdatei, die still
 * halb eingelesen wird, ist schlimmer als eine, die gar nicht durchgeht.
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EFH_MASSIV_UNTERKELLERT, PHASES, TRADES } from '@meinbaulotse/schedule';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const sourceDir = join(root, 'content', 'lotsenkarten');
const target = join(root, 'supabase', 'migrations', '0006_guide_cards.sql');

// -- Format ------------------------------------------------------------------

/** Die sechs Abschnitte. Die Überschriften werden wörtlich erkannt. */
const SECTIONS = {
  whatsHappening: 'Was passiert',
  watchFor: 'Worauf du achten kannst',
  questions: 'Fragen an den GU',
  problems: 'Was typischerweise schiefgeht',
  photos: 'Jetzt fotografieren',
  sources: 'Quellen',
} as const;

/** Trennt Haupttext und Zusätze einer Listenzeile. */
const SEPARATOR = ' — ';

interface ListItem {
  text: string;
  labels: Map<string, string>;
}

interface Card {
  file: string;
  key: string;
  version: number;
  title: string;
  phaseKey: string;
  tradeCode: string | null;
  taskCodes: string[];
  buildTypes: string[];
  expertRecommended: boolean;
  expertReason: string | null;
  legalNote: boolean;
  whatsHappening: string;
  watchFor: { key: string; text: string; why: string | null }[];
  questions: { key: string; question: string; whyItMatters: string | null }[];
  problems: { key: string; problem: string; howToSpot: string | null }[];
  photoPrompts: { key: string; what: string; why: string | null; beforeTaskCode: string | null }[];
  sources: { title: string; note: string | null }[];
}

class CardError extends Error {
  constructor(file: string, message: string) {
    super(`${file}: ${message}`);
    this.name = 'CardError';
  }
}

// -- Parser ------------------------------------------------------------------

function splitFrontmatter(file: string, raw: string): { head: string[]; body: string[] } {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  if (lines[0]?.trim() !== '---') {
    throw new CardError(file, 'Die Datei beginnt nicht mit einem Kopfteil (---).');
  }
  const end = lines.indexOf('---', 1);
  if (end === -1) {
    throw new CardError(file, 'Der Kopfteil wird nicht geschlossen (--- fehlt).');
  }
  return { head: lines.slice(1, end), body: lines.slice(end + 1) };
}

function parseFrontmatter(file: string, head: string[]): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of head) {
    if (line.trim() === '') continue;
    const colon = line.indexOf(':');
    if (colon === -1) {
      throw new CardError(file, `Kopfzeile ohne Doppelpunkt: „${line}"`);
    }
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (values.has(key)) {
      throw new CardError(file, `Das Kopffeld „${key}" steht zweimal.`);
    }
    values.set(key, value);
  }
  return values;
}

/** Zerlegt den Rumpf an den `## `-Überschriften. */
function parseSections(file: string, body: string[]): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  let current: string | null = null;
  for (const line of body) {
    if (line.startsWith('## ')) {
      current = line.slice(3).trim();
      if (sections.has(current)) {
        throw new CardError(file, `Der Abschnitt „${current}" steht zweimal.`);
      }
      sections.set(current, []);
      continue;
    }
    if (current !== null) sections.get(current)!.push(line);
  }
  return sections;
}

function parseListItem(file: string, line: string): ListItem {
  const parts = line.slice(2).split(SEPARATOR);
  const text = parts[0]!.trim();
  if (text === '') {
    throw new CardError(file, `Listenzeile ohne Text: „${line}"`);
  }
  const labels = new Map<string, string>();
  for (const part of parts.slice(1)) {
    const colon = part.indexOf(':');
    if (colon === -1) {
      throw new CardError(file, `Zusatz ohne Label in „${line}". Erwartet wird „ — Label: Wert".`);
    }
    labels.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim());
  }
  return { text, labels };
}

function listOf(file: string, sections: Map<string, string[]>, heading: string): ListItem[] {
  const lines = sections.get(heading) ?? [];
  return lines.filter((line) => line.startsWith('- ')).map((line) => parseListItem(file, line));
}

/** Fließtext: Absätze bleiben Absätze, Zeilenumbrüche innerhalb werden zu Leerzeichen. */
function proseOf(sections: Map<string, string[]>, heading: string): string {
  const lines = sections.get(heading) ?? [];
  const paragraphs: string[] = [];
  let buffer: string[] = [];
  for (const line of lines) {
    if (line.trim() === '') {
      if (buffer.length > 0) paragraphs.push(buffer.join(' '));
      buffer = [];
      continue;
    }
    buffer.push(line.trim());
  }
  if (buffer.length > 0) paragraphs.push(buffer.join(' '));
  return paragraphs.join('\n\n');
}

function flag(values: Map<string, string>, key: string): boolean {
  const value = values.get(key);
  return value === 'ja' || value === 'true';
}

function commaList(values: Map<string, string>, key: string): string[] {
  const value = values.get(key);
  if (value === undefined || value.trim() === '') return [];
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

function parseCard(file: string, raw: string): Card {
  const { head, body } = splitFrontmatter(file, raw);
  const values = parseFrontmatter(file, head);
  const sections = parseSections(file, body);

  const required = (key: string): string => {
    const value = values.get(key);
    if (value === undefined || value === '') {
      throw new CardError(file, `Das Kopffeld „${key}" fehlt.`);
    }
    return value;
  };

  const whatsHappening = proseOf(sections, SECTIONS.whatsHappening);
  if (whatsHappening === '') {
    throw new CardError(file, `Der Abschnitt „${SECTIONS.whatsHappening}" fehlt oder ist leer.`);
  }

  const expertRecommended = flag(values, 'fachpruefung');
  const expertReason = values.get('fachpruefung_grund') ?? null;
  if (expertRecommended && (expertReason === null || expertReason === '')) {
    throw new CardError(file, 'Bei „fachpruefung: ja" fehlt „fachpruefung_grund".');
  }

  const version = Number(values.get('fassung') ?? '1');
  if (!Number.isInteger(version) || version < 1) {
    throw new CardError(file, `„fassung" muss eine ganze Zahl ab 1 sein, gelesen: ${version}`);
  }

  const numbered = <T>(
    items: ListItem[],
    prefix: string,
    build: (item: ListItem, key: string) => T,
  ): T[] => items.map((item, index) => build(item, `${prefix}${index + 1}`));

  return {
    file,
    key: required('schluessel'),
    version,
    title: required('titel'),
    phaseKey: required('phase'),
    tradeCode: values.get('gewerk') ?? null,
    taskCodes: commaList(values, 'vorgaenge'),
    buildTypes: commaList(values, 'bauweisen'),
    expertRecommended,
    expertReason: expertRecommended ? expertReason : null,
    legalNote: flag(values, 'rechtshinweis'),
    whatsHappening,
    watchFor: numbered(listOf(file, sections, SECTIONS.watchFor), 'w', (item, key) => ({
      key,
      text: item.text,
      why: item.labels.get('Warum') ?? null,
    })),
    questions: numbered(listOf(file, sections, SECTIONS.questions), 'q', (item, key) => ({
      key,
      question: item.text,
      whyItMatters: item.labels.get('Warum') ?? null,
    })),
    problems: numbered(listOf(file, sections, SECTIONS.problems), 'c', (item, key) => ({
      key,
      problem: item.text,
      howToSpot: item.labels.get('Erkennbar') ?? null,
    })),
    photoPrompts: numbered(listOf(file, sections, SECTIONS.photos), 'p', (item, key) => ({
      key,
      what: item.text,
      why: item.labels.get('Warum') ?? null,
      beforeTaskCode: item.labels.get('Vor') ?? null,
    })),
    sources: listOf(file, sections, SECTIONS.sources).map((item) => ({
      title: item.text,
      note: item.labels.get('Wozu') ?? null,
    })),
  };
}

// -- Prüfungen ---------------------------------------------------------------

/**
 * Was hier durchrutscht, fällt erst im Betrieb auf — als Karte, die zu keinem
 * Vorgang gehört, oder als Vorgang, der zwei Karten hat. Beides ist von außen
 * nicht von „es gibt noch keine Karte" zu unterscheiden.
 */
function validate(cards: Card[]): void {
  const phaseKeys = new Set(PHASES.map((phase) => phase.key));
  const tradeCodes = new Set(TRADES.map((trade) => trade.code));
  const taskCodes = new Set(EFH_MASSIV_UNTERKELLERT.tasks.map((task) => task.code));

  const seenKeys = new Set<string>();
  const claimedTasks = new Map<string, string>();
  const problems: string[] = [];

  for (const card of cards) {
    if (seenKeys.has(card.key)) {
      problems.push(`${card.file}: Der Schlüssel „${card.key}" wird von zwei Karten benutzt.`);
    }
    seenKeys.add(card.key);

    if (!phaseKeys.has(card.phaseKey)) {
      problems.push(`${card.file}: Die Bauphase „${card.phaseKey}" gibt es nicht.`);
    }
    if (card.tradeCode !== null && !tradeCodes.has(card.tradeCode)) {
      problems.push(`${card.file}: Das Gewerk „${card.tradeCode}" gibt es nicht.`);
    }
    if (card.taskCodes.length === 0) {
      problems.push(`${card.file}: Die Karte nennt keinen Vorgang.`);
    }

    for (const code of card.taskCodes) {
      if (!taskCodes.has(code)) {
        problems.push(`${card.file}: Der Vorgang „${code}" steht nicht in der Ablaufvorlage.`);
        continue;
      }
      const other = claimedTasks.get(code);
      if (other !== undefined) {
        problems.push(
          `${card.file}: Der Vorgang „${code}" gehört bereits zur Karte „${other}". ` +
            'Ein Vorgang trägt genau eine Karte.',
        );
        continue;
      }
      claimedTasks.set(code, card.key);
    }

    for (const prompt of card.photoPrompts) {
      if (prompt.beforeTaskCode !== null && !taskCodes.has(prompt.beforeTaskCode)) {
        problems.push(
          `${card.file}: Der Fotoauftrag verweist auf den Vorgang „${prompt.beforeTaskCode}", ` +
            'den es in der Ablaufvorlage nicht gibt.',
        );
      }
    }

    if (card.sources.length === 0) {
      problems.push(
        `${card.file}: Die Karte nennt keine Quelle. Keine Aussage ohne Quelle (Abschnitt 6.3).`,
      );
    }
  }

  if (problems.length > 0) {
    throw new Error(`Die Redaktionsdateien sind nicht in Ordnung:\n  ${problems.join('\n  ')}`);
  }
}

// -- SQL ---------------------------------------------------------------------

const q = (value: string | null): string =>
  value === null ? 'null' : `'${value.replace(/'/g, "''")}'`;

const json = (value: unknown): string => `${q(JSON.stringify(value))}::jsonb`;

const textArray = (values: string[]): string =>
  values.length === 0 ? `'{}'::text[]` : `array[${values.map((v) => q(v)).join(', ')}]::text[]`;

const buildTypeArray = (values: string[]): string =>
  values.length === 0
    ? `'{}'::mbl.build_type[]`
    : `array[${values.map((v) => q(v)).join(', ')}]::mbl.build_type[]`;

function cardStatement(card: Card): string {
  const lines = [
    `-- ${card.title} (${card.file})`,
    'insert into guide_card (',
    '  key, version, phase_key, trade_code, build_types, task_codes, title, whats_happening,',
    '  watch_for, questions_for_contractor, common_problems, photo_prompts,',
    '  expert_recommended, expert_reason, legal_note, sources, published_at',
    ') values (',
    `  ${q(card.key)}, ${card.version}, ${q(card.phaseKey)}, ${q(card.tradeCode)},`,
    `  ${buildTypeArray(card.buildTypes)}, ${textArray(card.taskCodes)},`,
    `  ${q(card.title)},`,
    `  ${q(card.whatsHappening)},`,
    `  ${json(card.watchFor)},`,
    `  ${json(card.questions)},`,
    `  ${json(card.problems)},`,
    `  ${json(card.photoPrompts)},`,
    `  ${card.expertRecommended}, ${q(card.expertReason)}, ${card.legalNote},`,
    `  ${json(card.sources)},`,
    '  now()',
    ')',
    'on conflict (key, version) do nothing;',
  ];

  if (card.version > 1) {
    lines.push(
      '',
      '-- Die überholte Fassung wird abgelöst, nicht ersetzt: Sonst lässt sich',
      '-- hinterher nicht mehr sagen, welchen Rat der Bauherr damals bekam.',
      'update guide_card alt',
      `   set superseded_by = (select id from guide_card where key = ${q(card.key)} and version = ${card.version})`,
      ` where alt.key = ${q(card.key)}`,
      `   and alt.version < ${card.version}`,
      '   and alt.superseded_by is null;',
    );
  }

  return lines.join('\n');
}

// -- Ausführung --------------------------------------------------------------

const files = readdirSync(sourceDir)
  .filter((name) => name.endsWith('.md') && name !== 'README.md')
  .sort();

if (files.length === 0) {
  throw new Error(`Keine Lotsenkarten in ${sourceDir} gefunden.`);
}

const cards = files.map((file) => parseCard(file, readFileSync(join(sourceDir, file), 'utf8')));
validate(cards);

const out = [
  '-- ---------------------------------------------------------------------------',
  '-- MeinBaulotse — Lotsenkarten (erzeugt, nicht von Hand bearbeiten)',
  '--',
  '-- Erzeugt von packages/db/scripts/generate-guide-cards.ts aus',
  '-- content/lotsenkarten/*.md. Neu erzeugen:',
  '--   pnpm --filter @meinbaulotse/db cards:generate',
  '--',
  `-- ${cards.length} Karten aus Abschnitt 7.4 der Spezifikation. Sie decken die Phasen ab,`,
  '-- in denen am meisten schiefgeht.',
  '--',
  '-- Die Karten werden mit gesetztem published_at eingespielt und sind damit ab',
  '-- diesem Moment unveränderlich. Eine Korrektur ist eine neue Fassung.',
  '-- ---------------------------------------------------------------------------',
  '',
  ...cards.map((card) => `${cardStatement(card)}\n`),
  '-- ---------------------------------------------------------------------------',
  '-- Zuordnung zu bestehenden Bauvorhaben',
  '--',
  '-- Neue Projekte bekommen ihre Karten beim Anlegen (apps/api/src/onboarding.ts).',
  '-- Projekte, die es vor dieser Migration schon gab, hier — sonst stünde die',
  '-- Wissensschicht ausgerechnet den Bauherren nicht zur Verfügung, die schon',
  '-- bauen.',
  '--',
  '-- Die Zuordnung friert die Fassung ein, die der Bauherr tatsächlich zu sehen',
  '-- bekommt. Eine spätere Fassung ändert nichts an einem laufenden Bauvorhaben,',
  '-- solange die Zuordnung nicht ausdrücklich nachgezogen wird.',
  '-- ---------------------------------------------------------------------------',
  '',
  'update task t',
  '   set guide_card_id = c.id',
  '  from guide_card c',
  ' where c.published_at is not null',
  '   and c.superseded_by is null',
  '   and t.template_task_code = any (c.task_codes)',
  '   and t.guide_card_id is distinct from c.id;',
  '',
].join('\n');

writeFileSync(target, out, 'utf8');

const withExpert = cards.filter((card) => card.expertRecommended);
console.log(
  `Lotsenkarten geschrieben: ${target}\n` +
    `  ${cards.length} Karten, ${cards.reduce((sum, card) => sum + card.taskCodes.length, 0)} zugeordnete Vorgänge,\n` +
    `  ${cards.reduce((sum, card) => sum + card.sources.length, 0)} Quellenangaben,\n` +
    `  ${withExpert.length} mit empfohlener Fachprüfung: ${withExpert.map((card) => card.key).join(', ')}`,
);
