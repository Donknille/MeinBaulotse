/**
 * Lotsenkarten aus Markdown lesen.
 *
 * Abschnitt 6.3 der Spezifikation legt die Ablage fest: Markdown mit
 * Frontmatter im Repository, Import über eine Migration. Der Grund ist
 * redaktioneller Natur — wer Bauwissen schreibt, soll Text schreiben und
 * nicht SQL. Was hier steht, ist deshalb bewusst eine kleine, strenge
 * Formatprüfung und kein allgemeiner Markdown-Übersetzer.
 *
 * Streng heißt: Jede Abweichung bricht mit einer Meldung ab, die Datei und
 * Zeile nennt. Ein Redaktionsfehler, der still zu einer leeren Liste wird,
 * fällt erst dem Bauherrn auf — und der hält dann eine Karte in der Hand, auf
 * der die Hälfte fehlt.
 */

/** Ein Eintrag der Form „Aussage — Begründung". */
export interface GuidePoint {
  text: string;
  why: string;
}

export interface GuideQuestion {
  question: string;
  whyItMatters: string;
}

export interface GuideProblem {
  problem: string;
  howToSpot: string;
}

export interface GuidePhotoPrompt {
  what: string;
  why: string;
}

export interface GuideSource {
  reference: string;
  note: string;
}

export interface GuideCardSource {
  key: string;
  version: number;
  title: string;
  phaseKey: string;
  tradeCode: string | null;
  templateTaskCodes: readonly string[];
  whatsHappening: string;
  watchFor: readonly GuidePoint[];
  questionsForContractor: readonly GuideQuestion[];
  commonProblems: readonly GuideProblem[];
  photoPrompts: readonly GuidePhotoPrompt[];
  expertRecommended: boolean;
  expertReason: string | null;
  sources: readonly GuideSource[];
}

/**
 * Der Trenner zwischen Aussage und Begründung.
 *
 * Ein Geviertstrich mit Leerzeichen, wie ihn die Tonalität aus dem
 * Gestaltungssystem ohnehin benutzt. Getrennt wird am **ersten** Vorkommen:
 * In der Begründung darf derselbe Strich noch einmal auftauchen.
 */
const SEPARATOR = ' — ';

const REQUIRED_FRONTMATTER = ['key', 'titel', 'phase', 'vorgaenge', 'fassung'] as const;

const SECTIONS = {
  whatsHappening: 'Was passiert',
  watchFor: 'Worauf du achten kannst',
  questions: 'Fragen an den GU',
  problems: 'Was oft schiefgeht',
  photos: 'Jetzt fotografieren',
  expert: 'Warum eine Fachprüfung',
  sources: 'Quellen',
} as const;

class GuideCardError extends Error {
  constructor(file: string, message: string) {
    super(`${file}: ${message}`);
    this.name = 'GuideCardError';
  }
}

/** Zerlegt „--- … ---" am Dateianfang in Schlüssel und Wert. */
function parseFrontmatter(file: string, block: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const line of block.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    const colon = trimmed.indexOf(':');
    if (colon === -1) {
      throw new GuideCardError(file, `Frontmatter-Zeile ohne Doppelpunkt: „${trimmed}"`);
    }
    const key = trimmed.slice(0, colon).trim();
    if (fields.has(key)) {
      throw new GuideCardError(file, `Frontmatter-Feld doppelt: „${key}"`);
    }
    fields.set(key, trimmed.slice(colon + 1).trim());
  }
  return fields;
}

/** Zerlegt den Rumpf an „## " in benannte Abschnitte. */
function parseSections(file: string, body: string): Map<string, string> {
  const sections = new Map<string, string>();
  // Der erste Teil vor der ersten Überschrift gehört niemandem und muss leer
  // sein — sonst steht Text in der Karte, den keine Ansicht je zeigt.
  const parts = body.split(/^## /m);
  const preamble = parts.shift() ?? '';
  if (preamble.trim() !== '') {
    throw new GuideCardError(
      file,
      'Text vor der ersten Überschrift. Jede Aussage gehört in einen Abschnitt.',
    );
  }
  for (const part of parts) {
    const newline = part.indexOf('\n');
    const title = (newline === -1 ? part : part.slice(0, newline)).trim();
    const content = (newline === -1 ? '' : part.slice(newline + 1)).trim();
    if (sections.has(title)) {
      throw new GuideCardError(file, `Abschnitt doppelt: „${title}"`);
    }
    sections.set(title, content);
  }
  return sections;
}

/** Listenpunkte der Form „- Aussage — Begründung". */
function parsePoints(file: string, section: string, content: string): GuidePoint[] {
  const points: GuidePoint[] = [];
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (line === '') continue;
    if (!line.startsWith('- ')) {
      throw new GuideCardError(
        file,
        `Abschnitt „${section}": Zeile ist kein Listenpunkt: „${line}"`,
      );
    }
    const rest = line.slice(2).trim();
    const at = rest.indexOf(SEPARATOR);
    if (at === -1) {
      throw new GuideCardError(
        file,
        `Abschnitt „${section}": „${rest}" trägt keine Begründung. ` +
          `Erwartet wird „Aussage${SEPARATOR}Begründung".`,
      );
    }
    const text = rest.slice(0, at).trim();
    const why = rest.slice(at + SEPARATOR.length).trim();
    if (text === '' || why === '') {
      throw new GuideCardError(file, `Abschnitt „${section}": leere Hälfte in „${rest}"`);
    }
    points.push({ text, why });
  }
  if (points.length === 0) {
    throw new GuideCardError(file, `Abschnitt „${section}" ist leer.`);
  }
  return points;
}

function requireSection(file: string, sections: Map<string, string>, title: string): string {
  const content = sections.get(title);
  if (content === undefined || content.trim() === '') {
    throw new GuideCardError(file, `Abschnitt „## ${title}" fehlt oder ist leer.`);
  }
  return content;
}

function parseBoolean(file: string, field: string, value: string | undefined): boolean {
  if (value === undefined || value === 'nein') return false;
  if (value === 'ja') return true;
  throw new GuideCardError(file, `Feld „${field}" erwartet „ja" oder „nein", nicht „${value}".`);
}

/**
 * Liest eine Karte. `file` dient nur der Fehlermeldung.
 */
export function parseGuideCard(file: string, markdown: string): GuideCardSource {
  const normalised = markdown.replace(/\r\n/g, '\n').trimStart();
  if (!normalised.startsWith('---\n')) {
    throw new GuideCardError(file, 'Die Datei beginnt nicht mit einem Frontmatter-Block.');
  }
  const end = normalised.indexOf('\n---\n', 3);
  if (end === -1) {
    throw new GuideCardError(file, 'Der Frontmatter-Block ist nicht geschlossen.');
  }

  const fields = parseFrontmatter(file, normalised.slice(4, end));
  for (const required of REQUIRED_FRONTMATTER) {
    if (!fields.has(required)) {
      throw new GuideCardError(file, `Frontmatter-Feld „${required}" fehlt.`);
    }
  }

  const sections = parseSections(file, normalised.slice(end + 5));

  const version = Number(fields.get('fassung'));
  if (!Number.isInteger(version) || version < 1) {
    throw new GuideCardError(file, `Feld „fassung" ist keine ganze Zahl ab 1: „${fields.get('fassung')}".`);
  }

  const codes = (fields.get('vorgaenge') ?? '')
    .split(',')
    .map((code) => code.trim().toLowerCase())
    .filter((code) => code !== '');
  if (codes.length === 0) {
    throw new GuideCardError(file, 'Feld „vorgaenge" nennt keinen Vorgang.');
  }
  for (const code of codes) {
    if (!/^t\d{2}$/.test(code)) {
      throw new GuideCardError(file, `„${code}" ist kein Vorlagencode der Form t01 … t38.`);
    }
  }

  const expertRecommended = parseBoolean(file, 'fachpruefung', fields.get('fachpruefung'));
  const expertSection = sections.get(SECTIONS.expert)?.trim() ?? '';
  if (expertRecommended && expertSection === '') {
    throw new GuideCardError(
      file,
      `„fachpruefung: ja" ohne Abschnitt „## ${SECTIONS.expert}". ` +
        'Eine Empfehlung ohne Begründung ist Angstmache.',
    );
  }
  if (!expertRecommended && expertSection !== '') {
    throw new GuideCardError(
      file,
      `Abschnitt „## ${SECTIONS.expert}" ohne „fachpruefung: ja".`,
    );
  }

  const trade = fields.get('gewerk') ?? '';

  const bekannt = new Set<string>(Object.values(SECTIONS));
  for (const title of sections.keys()) {
    if (!bekannt.has(title)) {
      throw new GuideCardError(
        file,
        `Unbekannter Abschnitt „## ${title}". Erlaubt sind: ${[...bekannt].join(', ')}.`,
      );
    }
  }

  return {
    key: fields.get('key')!,
    version,
    title: fields.get('titel')!,
    phaseKey: fields.get('phase')!,
    tradeCode: trade === '' ? null : trade,
    templateTaskCodes: codes,
    whatsHappening: requireSection(file, sections, SECTIONS.whatsHappening),
    watchFor: parsePoints(file, SECTIONS.watchFor, requireSection(file, sections, SECTIONS.watchFor)),
    questionsForContractor: parsePoints(
      file,
      SECTIONS.questions,
      requireSection(file, sections, SECTIONS.questions),
    ).map((point) => ({ question: point.text, whyItMatters: point.why })),
    commonProblems: parsePoints(
      file,
      SECTIONS.problems,
      requireSection(file, sections, SECTIONS.problems),
    ).map((point) => ({ problem: point.text, howToSpot: point.why })),
    photoPrompts: parsePoints(
      file,
      SECTIONS.photos,
      requireSection(file, sections, SECTIONS.photos),
    ).map((point) => ({ what: point.text, why: point.why })),
    expertRecommended,
    expertReason: expertRecommended ? expertSection : null,
    sources: parsePoints(file, SECTIONS.sources, requireSection(file, sections, SECTIONS.sources)).map(
      (point) => ({ reference: point.text, note: point.why }),
    ),
  };
}

/**
 * Feste Kennung je Karte und Fassung.
 *
 * Der Import muss sich beliebig oft einspielen lassen, ohne Doppelgänger zu
 * erzeugen — auf Supabase fügt jemand die Sammeldatei womöglich zweimal ein.
 * Mit `gen_random_uuid()` ginge das nicht: Beim zweiten Lauf stünde dieselbe
 * Karte ein zweites Mal in der Tabelle, mit anderer Kennung und ohne dass
 * `on conflict` etwas merkt.
 *
 * Deshalb UUID Fassung 5 (SHA-1, RFC 4122) über „schlüssel@fassung" in einem
 * festen Namensraum: gleiche Karte, gleiche Kennung, überall.
 */
export function guideCardId(hash: (input: Uint8Array) => Uint8Array, key: string, version: number): string {
  // Namensraum, einmal gewürfelt und ab jetzt fest.
  const namespace = 'b7c1f0e2-5a3d-4c8b-9e2f-6d4a1b8c3e07';
  const namespaceBytes = Uint8Array.from(
    (namespace.replace(/-/g, '').match(/../g) ?? []).map((byte) => parseInt(byte, 16)),
  );
  const nameBytes = new TextEncoder().encode(`${key}@${version}`);
  const input = new Uint8Array(namespaceBytes.length + nameBytes.length);
  input.set(namespaceBytes, 0);
  input.set(nameBytes, namespaceBytes.length);

  const digest = hash(input).slice(0, 16);
  digest[6] = (digest[6]! & 0x0f) | 0x50; // Fassung 5
  digest[8] = (digest[8]! & 0x3f) | 0x80; // Variante RFC 4122

  const hex = [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const quote = (value: string | null): string =>
  value === null ? 'null' : `'${value.replace(/'/g, "''")}'`;

const quoteJson = (value: unknown): string => `${quote(JSON.stringify(value))}::jsonb`;

const quoteArray = (values: readonly string[]): string =>
  `array[${values.map((value) => quote(value)).join(', ')}]::text[]`;

/**
 * Erzeugt das SQL für einen Satz Karten.
 *
 * Getrennt vom Dateizugriff, damit sich beides einzeln prüfen lässt: das
 * Einlesen an einer Datei, das Erzeugen an einer Kartenliste.
 */
export function renderGuideCardSql(
  cards: readonly GuideCardSource[],
  hash: (input: Uint8Array) => Uint8Array,
): string {
  const lines: string[] = [
    '-- ---------------------------------------------------------------------------',
    '-- MeinBaulotse — Lotsenkarten (erzeugt, nicht von Hand bearbeiten)',
    '--',
    '-- Erzeugt von packages/db/scripts/generate-guide-cards.ts aus:',
    '--   content/lotsenkarten/*.md',
    '--',
    '-- Neu erzeugen: pnpm --filter @meinbaulotse/db guide-cards:generate',
    '--',
    '-- Eine veröffentlichte Karte ist unveränderlich (Invariante 4.1.6). Wer',
    '-- Inhalt ändert, erhöht „fassung" in der Markdown-Datei; dieser Import legt',
    '-- dann eine neue Fassung an und verkettet die alte über superseded_by.',
    '-- Bereits eingespielte Zeilen bleiben unberührt: Jedes insert endet auf',
    '-- „on conflict do nothing", und die Kennungen sind aus Schlüssel und',
    '-- Fassung abgeleitet, nicht gewürfelt.',
    '-- ---------------------------------------------------------------------------',
    '',
  ];

  const sorted = [...cards].sort(
    (a, b) => a.key.localeCompare(b.key) || a.version - b.version,
  );

  for (const card of sorted) {
    const id = guideCardId(hash, card.key, card.version);
    lines.push(
      `-- ${card.title} (${card.key}, Fassung ${card.version})`,
      'insert into guide_card (',
      '  id, key, version, phase_key, trade_code, template_task_codes, title,',
      '  whats_happening, watch_for, questions_for_contractor, common_problems,',
      '  photo_prompts, expert_recommended, expert_reason, sources, published_at',
      ') values (',
      `  ${quote(id)}, ${quote(card.key)}, ${card.version}, ${quote(card.phaseKey)},`,
      `  ${quote(card.tradeCode)}, ${quoteArray([...card.templateTaskCodes])}, ${quote(card.title)},`,
      `  ${quote(card.whatsHappening)},`,
      `  ${quoteJson(card.watchFor)},`,
      `  ${quoteJson(card.questionsForContractor)},`,
      `  ${quoteJson(card.commonProblems)},`,
      `  ${quoteJson(card.photoPrompts)},`,
      `  ${card.expertRecommended}, ${quote(card.expertReason)},`,
      `  ${quoteJson(card.sources)},`,
      '  now()',
      ')',
      'on conflict (id) do nothing;',
      '',
    );
  }

  // Verkettung der Fassungen. Bei nur einer Fassung je Karte entsteht hier
  // nichts — der Fall tritt erst bei der ersten Überarbeitung ein.
  const chains: string[] = [];
  for (const card of sorted) {
    const nachfolger = sorted.find(
      (other) => other.key === card.key && other.version === card.version + 1,
    );
    if (nachfolger === undefined) continue;
    chains.push(
      `update guide_card set superseded_by = ${quote(guideCardId(hash, nachfolger.key, nachfolger.version))}` +
        `\n  where id = ${quote(guideCardId(hash, card.key, card.version))} and superseded_by is null;`,
    );
  }
  if (chains.length > 0) {
    lines.push('-- Ältere Fassungen zeigen auf ihre Nachfolger ----------------------------', '');
    lines.push(...chains, '');
  }

  return lines.join('\n');
}
