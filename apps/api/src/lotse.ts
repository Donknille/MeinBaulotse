/**
 * Frag den Lotsen (Abschnitt 3.7).
 *
 * Die Reihenfolge in `frage()` ist die ganze Architektur:
 *
 *   1. Zug anfordern — Ratenbegrenzung und Kostendeckel, in der Datenbank
 *   2. Kontext bauen — serverseitig, unter den Rechten des Fragenden
 *   3. Modell fragen — hinter einer Schnittstelle, austauschbar
 *   4. Antwort entschärfen — Karten prüfen, Leitplanken anhängen
 *   5. Beitrag festschreiben — append-only, mit Kosten
 *
 * Schritt 4 kommt nach Schritt 3 und nicht statt seiner. Das Modell wird
 * angewiesen **und** die Antwort wird ergänzt: Ein Systemprompt ist eine
 * Bitte, und eine Bitte ist keine Leitplanke.
 */

import { HTTPException } from 'hono/http-exception';
import type { Transaction } from '@meinbaulotse/db';
import type { IsoDate } from '@meinbaulotse/schedule';
import type {
  LotseAnswer,
  LotseConversation,
  LotseHint,
  LotseMessage,
} from '@meinbaulotse/shared';
import { buildLotseContext } from './lotse-context.js';
import { hinweiseFuer, karten } from './lotse-guardrails.js';
import { kostenInCent, type LotseModel } from './lotse-model.js';

type Tx = Pick<Transaction, 'query'>;

/** Fragen je Minute und Bauvorhaben. */
const LIMIT_PRO_MINUTE = 6;

/** Kostendeckel je Bauvorhaben und Monat, in Cent. */
const DECKEL_CENT = 500;

/** Wie viele frühere Beiträge in den Verlauf gehen. */
const VERLAUF_TIEFE = 12;

/**
 * Der Systemprompt.
 *
 * Er wiederholt die Leitplanken, obwohl sie zusätzlich deterministisch
 * greifen — nicht doppelt gemoppelt, sondern arbeitsteilig: Der Prompt sorgt
 * dafür, dass die Antwort **von sich aus** richtig gebaut ist, die Prüfung
 * dafür, dass sie es auch dann ist, wenn er nicht gewirkt hat.
 */
export function systemprompt(kontext: string): string {
  return [
    'Du bist der Lotse in MeinBaulotse. Du hilfst einem privaten Bauherrn, seinen Hausbau zu',
    'verstehen. Er ist kein Fachmann und steht unter Anspannung.',
    '',
    'Ton:',
    '- Du sagst „du". Kein „Sie", kein unpersönliches Passiv.',
    '- Kurze Sätze, ein Gedanke je Satz. Keine Ausrufezeichen.',
    '- Fachbegriffe erklärst du beim ersten Auftreten.',
    '- Du beschuldigst niemanden. Nicht „der Unternehmer hat versäumt", sondern „der Termin',
    '  wurde bisher nicht bestätigt".',
    '- Jede schlechte Nachricht bekommt einen nächsten Schritt.',
    '',
    'Grenzen, die du nicht überschreitest:',
    '- Du erteilst keine Rechtsberatung. Bei rechtlichen Fragen nennst du die Gesetzesstelle,',
    '  sagst, was dort steht, und verweist auf einen Fachanwalt für Bau- und Architektenrecht.',
    '  Du bewertest nicht, wer im Recht ist.',
    '- Du beurteilst keinen Baumangel aus der Ferne und schon gar nicht aus einem Foto. Du',
    '  verweist auf einen Bausachverständigen und sagst, was bis dahin sinnvoll ist.',
    '- Du nennst keine Kosten, die als verbindlich gelesen werden könnten. Größenordnungen',
    '  ja, Preise nein.',
    '- Du erfindest keine Termine, Beträge oder Namen. Was nicht im Kontext steht, weißt du',
    '  nicht — und dann sagst du das und schreibst dazu, was im Bauvorhaben erfasst werden',
    '  müsste, damit die Frage beantwortbar wird.',
    '',
    // Die Anleitung nennt bewusst keinen Beispielschlüssel: Ein Platzhalter,
    // der aussieht wie eine echte Markierung, wird gelegentlich wörtlich
    // abgeschrieben — und stünde dann als Quellenangabe in der Antwort.
    'Lotsenkarten: Der Kontext enthält Karten, deren Titelzeile mit einer Markierung der Form',
    'doppelte eckige Klammer, karte, Doppelpunkt, Schlüssel, doppelte eckige Klammer beginnt.',
    'Wenn deine Antwort auf einer Karte beruht, schreibst du genau diese Markierung mit in die',
    'Antwort. Nur Schlüssel, die im Kontext vorkommen. Erfinde keine.',
    '',
    'Antworte in höchstens sechs Absätzen. Fang mit der Antwort an, nicht mit einer',
    'Wiederholung der Frage.',
    '',
    '--- Kontext zu diesem Bauvorhaben ---',
    kontext,
  ].join('\n');
}

async function zugAnfordern(tx: Tx, projectId: string): Promise<void> {
  const result = await tx.query<{
    zu_oft: boolean;
    deckel_voll: boolean;
    spent_cents: number;
    cap_cents: number;
  }>('select * from mbl.claim_assistant_turn($1, $2, $3)', [
    projectId,
    LIMIT_PRO_MINUTE,
    DECKEL_CENT,
  ]);

  const zustand = result.rows[0];
  if (zustand === undefined) {
    throw new HTTPException(404, { message: 'Dieses Bauvorhaben gibt es nicht.' });
  }
  if (zustand.zu_oft) {
    throw new HTTPException(429, {
      message: 'Das ging gerade sehr schnell hintereinander. Frag in einer Minute noch einmal.',
    });
  }
  if (zustand.deckel_voll) {
    // Kein Fehler im engeren Sinn, sondern eine Aussage über den Monat — und
    // deshalb mit einem nächsten Schritt statt mit einer Absage.
    throw new HTTPException(429, {
      message:
        'Für diesen Monat ist der Lotse ausgeschöpft. Ab dem Ersten geht es weiter; bis dahin '
        + 'stehen die Lotsenkarten zu jedem Vorgang bereit.',
    });
  }
}

/**
 * Der Verlauf, wie ihn die Oberfläche zeigt.
 *
 * Die Kartentitel kommen aus der Datenbank und nicht aus dem gespeicherten
 * Beitrag: Der Titel darf sich ändern, der Verweis nicht. Was der Beitrag
 * festhält, ist der Schlüssel — die Aussage „diese Antwort beruht auf dieser
 * Karte" —, und der Titel ist die heutige Beschriftung dazu.
 */
async function verlaufLesen(tx: Tx, conversationId: string): Promise<LotseMessage[]> {
  const result = await tx.query<{
    id: string;
    role: 'frage' | 'antwort';
    text: string;
    guide_card_keys: string[];
    hints: LotseHint[];
    created_at: string;
    cards: { key: string; title: string }[] | null;
  }>(
    `select m.id, m.role::text as role, m.text, m.guide_card_keys, m.hints, m.created_at,
            (select coalesce(json_agg(json_build_object('key', gc.key, 'title', gc.title)), '[]')
               from guide_card gc
              where gc.key = any (m.guide_card_keys)
                and gc.published_at is not null and gc.superseded_by is null) as cards
       from assistant_message m
      where m.conversation_id = $1 order by m.created_at`,
    [conversationId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    role: row.role,
    text: row.text,
    cards: row.cards ?? [],
    hints: row.hints,
    createdAt: new Date(row.created_at).toISOString(),
  }));
}

/**
 * Ein Gesprächstitel aus der ersten Frage.
 *
 * Reine Zeichenarbeit, kein Modellaufruf: Ein zweiter Aufruf für eine
 * Überschrift wäre die Hälfte der Kosten für ein Zehntel des Nutzens.
 */
export function titelAus(frage: string): string {
  const sauber = frage.replace(/\s+/g, ' ').trim();
  if (sauber.length <= 60) return sauber;
  const schnitt = sauber.slice(0, 60);
  const luecke = schnitt.lastIndexOf(' ');
  return `${luecke > 30 ? schnitt.slice(0, luecke) : schnitt}…`;
}

export async function loadConversations(
  tx: Tx,
  projectId: string,
): Promise<LotseConversation[]> {
  const result = await tx.query<{ id: string; title: string; updated_at: string }>(
    `select id, title, updated_at from assistant_conversation
      where project_id = $1 order by updated_at desc limit 30`,
    [projectId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    title: row.title,
    updatedAt: new Date(row.updated_at).toISOString(),
  }));
}

export async function loadConversation(
  tx: Tx,
  projectId: string,
  conversationId: string,
): Promise<{ conversation: LotseConversation; messages: LotseMessage[] }> {
  const kopf = await tx.query<{ id: string; title: string; updated_at: string }>(
    'select id, title, updated_at from assistant_conversation where id = $1 and project_id = $2',
    [conversationId, projectId],
  );
  const row = kopf.rows[0];
  if (row === undefined) {
    throw new HTTPException(404, { message: 'Dieses Gespräch gibt es nicht.' });
  }
  return {
    conversation: {
      id: row.id,
      title: row.title,
      updatedAt: new Date(row.updated_at).toISOString(),
    },
    messages: await verlaufLesen(tx, conversationId),
  };
}

export interface FrageOptions {
  model: LotseModel;
  frage: string;
  conversationId?: string;
  today: IsoDate;
}

export async function frage(
  tx: Tx,
  projectId: string,
  options: FrageOptions,
): Promise<LotseAnswer> {
  await zugAnfordern(tx, projectId);

  const kontext = await buildLotseContext(tx, projectId, options.today);

  let conversationId = options.conversationId;
  if (conversationId === undefined) {
    const angelegt = await tx.query<{ id: string }>(
      `insert into assistant_conversation (project_id, member_id, title)
       values ($1, mbl.current_member_id($1), $2) returning id`,
      [projectId, titelAus(options.frage)],
    );
    conversationId = angelegt.rows[0]!.id;
  }

  const bisher = await verlaufLesen(tx, conversationId);
  if (options.conversationId !== undefined && bisher.length === 0) {
    // Kein Beitrag und trotzdem eine Kennung: Entweder gibt es das Gespräch
    // nicht, oder es gehört jemand anderem. Von außen ist das dasselbe.
    const gibtEs = await tx.query(
      'select 1 from assistant_conversation where id = $1 and project_id = $2',
      [conversationId, projectId],
    );
    if (gibtEs.rowCount === 0) {
      throw new HTTPException(404, { message: 'Dieses Gespräch gibt es nicht.' });
    }
  }

  const antwort = await options.model.antworte({
    system: systemprompt(kontext.text),
    verlauf: [
      ...bisher.slice(-VERLAUF_TIEFE).map((beitrag) => ({
        role: beitrag.role === 'frage' ? ('user' as const) : ('assistant' as const),
        content: beitrag.text,
      })),
      { role: 'user' as const, content: options.frage },
    ],
  });

  const geprueft = karten(antwort.text, kontext.cardKeys);
  const kosten = kostenInCent(options.model, antwort);
  const hinweise: LotseHint[] = hinweiseFuer(options.frage).map((hinweis) => ({
    kind: hinweis.art,
    title: hinweis.titel,
    text: hinweis.text,
    ...(hinweis.stelle === undefined ? {} : { reference: hinweis.stelle }),
  }));

  await tx.query(
    `insert into assistant_message (conversation_id, project_id, role, text)
     values ($1, $2, 'frage', $3)`,
    [conversationId, projectId, options.frage],
  );
  const gespeichert = await tx.query<{ id: string; created_at: string }>(
    `insert into assistant_message
       (conversation_id, project_id, role, text, guide_card_keys, guardrails, hints,
        input_tokens, output_tokens, cost_cents)
     values ($1, $2, 'antwort', $3, $4, $5, $6, $7, $8, $9)
     returning id, created_at`,
    [
      conversationId,
      projectId,
      geprueft.text,
      geprueft.keys,
      hinweise.map((hinweis) => hinweis.kind),
      JSON.stringify(hinweise),
      antwort.inputTokens,
      antwort.outputTokens,
      kosten,
    ],
  );
  await tx.query('update assistant_conversation set updated_at = now() where id = $1', [
    conversationId,
  ]);

  return {
    conversationId,
    message: {
      id: gespeichert.rows[0]!.id,
      role: 'antwort',
      text: geprueft.text,
      cards: kontext.karten
        .filter((karte) => geprueft.keys.includes(karte.key))
        .map((karte) => ({ key: karte.key, title: karte.title })),
      hints: hinweise,
      createdAt: new Date(gespeichert.rows[0]!.created_at).toISOString(),
    },
  };
}
