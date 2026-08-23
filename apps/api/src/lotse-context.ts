/**
 * Der Kontext, den der Lotse bekommt (Abschnitt 3.7 und 6.4).
 *
 * Der entscheidende Satz steht in 6.4:
 *
 *   „Der Assistent bekommt ausschließlich Daten des eigenen Projekts in den
 *    Kontext; der Kontextaufbau ist serverseitig und nicht vom Client
 *    steuerbar."
 *
 * Beide Hälften sind hier eingelöst, und die erste auf die einzige Art, die
 * trägt: Es gibt in dieser Datei keine Abfrage ohne `project_id`, und alle
 * laufen in der Transaktion des Fragenden — also unter denselben Policies wie
 * jede andere Abfrage der Anwendung. Ein Kontext, der ein fremdes Projekt
 * enthielte, müsste an der RLS vorbei, und dafür gibt es keinen Weg. Die
 * Prüfung „enthält nachweislich keine Daten fremder Projekte" ist damit keine
 * Zusicherung dieser Datei, sondern eine der Datenbank.
 *
 * Die zweite Hälfte ist eine Auslassung: Der Client schickt eine Frage, sonst
 * nichts. Keine Vorgangskennung, kein Ausschnitt, kein „nimm auch noch". Was
 * hineingeht, entscheidet der Server anhand des Datums.
 */

import type { Transaction } from '@meinbaulotse/db';
import { HTTPException } from 'hono/http-exception';
import type { IsoDate } from '@meinbaulotse/schedule';

type Tx = Pick<Transaction, 'query'>;

/** Wie weit der Kontext nach vorn schaut. */
const VORSCHAU_TAGE = 28;

/** Wie weit er zurückblickt — Tagebuch und Verschiebungen. */
const RUECKBLICK_TAGE = 42;

export interface LotseKarte {
  key: string;
  title: string;
  text: string;
}

export interface LotseContext {
  projectId: string;
  projectName: string;
  today: IsoDate;
  /** Der Fließtext, der in den Systemprompt geht. */
  text: string;
  /** Welche Karten mitgegeben wurden — nur diese darf die Antwort verlinken. */
  cardKeys: string[];
  karten: LotseKarte[];
  /** Was im Projekt fehlt, um bestimmte Fragen zu beantworten. */
  luecken: string[];
}

function plusDays(date: IsoDate, days: number): IsoDate {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

function euro(cents: number | null): string {
  if (cents === null) return 'nicht erfasst';
  return `${(cents / 100).toLocaleString('de-DE', { maximumFractionDigits: 0 })} Euro`;
}

function liste(zeilen: string[]): string {
  return zeilen.length === 0 ? '  (nichts)' : zeilen.map((zeile) => `  - ${zeile}`).join('\n');
}

/**
 * Aus einer Lotsenkarte wird ein Absatz.
 *
 * Nicht das ganze JSON: Ein Modell liest Fließtext besser als eine Struktur,
 * und die Struktur ist hier ohnehin nur Aufzählung. Die Quellenangaben
 * bleiben draußen — sie gehören in die Karte, nicht in eine Chatantwort.
 */
function karteAlsText(row: {
  key: string;
  title: string;
  whats_happening: string;
  watch_for: { text: string }[];
  questions_for_contractor: { text: string }[];
  common_problems: { text: string }[];
  expert_recommended: boolean;
  expert_reason: string | null;
}): LotseKarte {
  const teile = [row.whats_happening.trim()];
  if (row.watch_for.length > 0) {
    teile.push(`Worauf zu achten ist: ${row.watch_for.map((p) => p.text).join(' ')}`);
  }
  if (row.common_problems.length > 0) {
    teile.push(`Was oft schiefgeht: ${row.common_problems.map((p) => p.text).join(' ')}`);
  }
  if (row.questions_for_contractor.length > 0) {
    teile.push(`Fragen an den Unternehmer: ${row.questions_for_contractor.map((p) => p.text).join(' ')}`);
  }
  if (row.expert_recommended) {
    teile.push(`Fachprüfung empfohlen: ${row.expert_reason ?? 'siehe Karte'}`);
  }
  return { key: row.key, title: row.title, text: teile.join('\n') };
}

export async function buildLotseContext(
  tx: Tx,
  projectId: string,
  today: IsoDate,
): Promise<LotseContext> {
  const kopf = await tx.query<{
    name: string;
    federal_state: string;
    build_type: string;
    contract_type: string;
    has_basement: boolean;
    planned_start: string;
    contractual_completion: string | null;
    contract_sum_cents: string | null;
    rolle: string | null;
  }>(
    `select p.name, p.federal_state::text as federal_state, p.build_type::text as build_type,
            p.contract_type::text as contract_type, p.has_basement, p.planned_start,
            p.contractual_completion, p.contract_sum_cents,
            (select m.role::text from project_member m
              where m.id = mbl.current_member_id(p.id)) as rolle
       from project p where p.id = $1`,
    [projectId],
  );
  const p = kopf.rows[0];
  if (p === undefined) {
    throw new HTTPException(404, { message: 'Dieses Bauvorhaben gibt es nicht.' });
  }

  const bis = plusDays(today, VORSCHAU_TAGE);
  const seit = plusDays(today, -RUECKBLICK_TAGE);

  const vorgaenge = await tx.query<{
    name: string;
    current_start: string | null;
    current_end: string | null;
    status: string;
    confirmation: string;
    phase_key: string;
    is_wait: boolean;
    card_key: string | null;
  }>(
    `select t.name, t.current_start, t.current_end, t.status::text as status,
            t.confirmation::text as confirmation, t.phase_key,
            t.is_wait, guide.key as card_key
       from task t
       left join lateral (
         select gc.key from guide_card gc
          where gc.published_at is not null
            and (gc.id = t.guide_card_id
                 or (t.template_task_code is not null
                     and t.template_task_code = any (gc.template_task_codes)
                     and gc.superseded_by is null))
          order by (gc.id = t.guide_card_id) desc, gc.version desc limit 1
       ) guide on true
      where t.project_id = $1
        and t.current_start is not null
        and t.current_start <= $2
        and coalesce(t.current_end, t.current_start) >= $3
      order by t.current_start`,
    [projectId, bis, today],
  );

  const entscheidungen = await tx.query<{
    title: string;
    due_date: string | null;
    status: string;
    description: string | null;
  }>(
    `select title, due_date, status::text as status, description
       from decision
      where project_id = $1 and status <> 'entschieden'
      order by due_date nulls last limit 12`,
    [projectId],
  );

  const verschiebungen = await tx.query<{
    name: string;
    reason_text: string | null;
    reason_code: string | null;
    new_value: string | null;
  }>(
    `select t.name, c.reason_text, c.reason_code::text as reason_code,
            c.new_value #>> '{}' as new_value
       from schedule_change c join task t on t.id = c.task_id
      where c.project_id = $1 and c.created_at >= $2::date and c.field = 'earliest_start'
      order by c.created_at desc limit 10`,
    [projectId, seit],
  );

  const tagebuch = await tx.query<{ entry_date: string; body: string }>(
    `select entry_date, body from diary_entry
      where project_id = $1 and entry_date >= $2 and retracted_at is null
      order by entry_date desc limit 12`,
    [projectId, seit],
  );

  const ende = await tx.query<{ letztes_ende: string | null }>(
    `select max(coalesce(current_end, current_start))::text as letztes_ende
       from task where project_id = $1`,
    [projectId],
  );

  // Die Karten der Vorgänge, die gerade im Blick sind. Volltext, denn sie
  // sind der Redaktionsinhalt aus 6.3 — genau das, worauf der Lotse sich
  // stützen soll, statt zu erfinden.
  const kartenKeys = [
    ...new Set(vorgaenge.rows.map((row) => row.card_key).filter((key): key is string => key !== null)),
  ];
  const karten =
    kartenKeys.length === 0
      ? []
      : (
          await tx.query<Parameters<typeof karteAlsText>[0]>(
            `select key, title, whats_happening, watch_for, questions_for_contractor,
                    common_problems, expert_recommended, expert_reason
               from guide_card
              where key = any ($1) and published_at is not null and superseded_by is null
              order by key`,
            [kartenKeys],
          )
        ).rows.map(karteAlsText);

  // Was fehlt, wird benannt statt umschifft (Abschnitt 3.7, letzte Leitplanke).
  const luecken: string[] = [];
  if (p.contractual_completion === null) luecken.push('kein vertraglich geschuldeter Fertigstellungstermin erfasst');
  if (p.contract_sum_cents === null) luecken.push('keine Gesamtvergütung erfasst');
  if (tagebuch.rows.length === 0) luecken.push('keine Tagebucheinträge in den letzten sechs Wochen');

  const laufend = vorgaenge.rows.filter((row) => row.status === 'laeuft');
  const text = [
    `Bauvorhaben: ${p.name}`,
    `Heute ist der ${today}.`,
    `Bundesland: ${p.federal_state}. Bauweise: ${p.build_type}. Vertragsart: ${p.contract_type}.`,
    `${p.has_basement ? 'Mit' : 'Ohne'} Keller. Baubeginn geplant: ${p.planned_start}.`,
    `Geschuldeter Fertigstellungstermin: ${p.contractual_completion ?? 'nicht erfasst'}.`,
    `Errechnetes Bauende nach heutigem Plan: ${ende.rows[0]?.letztes_ende ?? 'unbekannt'}.`,
    `Gesamtvergütung: ${euro(p.contract_sum_cents === null ? null : Number(p.contract_sum_cents))}.`,
    `Der Fragende ist im Projekt: ${p.rolle ?? 'unbekannt'}.`,
    '',
    `Laufende Vorgänge (${laufend.length}):`,
    liste(laufend.map((row) => `${row.name} (${row.current_start} bis ${row.current_end})`)),
    '',
    `Vorgänge in den nächsten ${VORSCHAU_TAGE} Tagen:`,
    liste(
      vorgaenge.rows
        .filter((row) => row.status !== 'laeuft')
        .map(
          (row) =>
            `${row.name}${row.is_wait ? ' (Wartezeit)' : ''}: ${row.current_start} bis ${row.current_end}` +
            `, Stand ${row.status}, Bestätigungsgrad ${row.confirmation}`,
        ),
    ),
    '',
    'Offene Entscheidungen:',
    liste(
      entscheidungen.rows.map(
        (row) => `${row.title} — Frist ${row.due_date ?? 'offen'}, Stand ${row.status}`,
      ),
    ),
    '',
    'Terminänderungen der letzten Wochen:',
    liste(
      verschiebungen.rows.map(
        (row) =>
          `${row.name} auf ${row.new_value ?? 'unbekannt'}` +
          `${row.reason_code === null ? '' : ` — Grund: ${row.reason_code}`}` +
          `${row.reason_text === null ? '' : ` (${row.reason_text})`}`,
      ),
    ),
    '',
    'Bautagebuch der letzten Wochen:',
    liste(
      tagebuch.rows.map(
        (row) => `${row.entry_date}: ${row.body.replace(/\s+/g, ' ').slice(0, 200)}`,
      ),
    ),
    '',
    'Lücken in der Datenlage:',
    liste(luecken),
    '',
    'Lotsenkarten zu den Vorgängen, die jetzt im Blick sind:',
    karten.length === 0
      ? '  (zu diesen Vorgängen gibt es keine Karte)'
      : karten
          .map((karte) => `\n[[karte:${karte.key}]] ${karte.title}\n${karte.text}`)
          .join('\n'),
  ].join('\n');

  return {
    projectId,
    projectName: p.name,
    today,
    text,
    cardKeys: karten.map((karte) => karte.key),
    karten,
    luecken,
  };
}
