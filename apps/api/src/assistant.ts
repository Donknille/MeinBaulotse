/**
 * Frag den Lotsen — Abschnitt 3.7.
 *
 * Ein Chat mit Kontext auf das eigene Projekt. Der schwierigste Teil ist nicht
 * das Gespräch, sondern der Satz, mit dem der Abschnitt endet:
 *
 *     „Der Assistent bekommt ausschließlich Daten des eigenen Projekts in den
 *      Kontext; der Kontextaufbau ist serverseitig und nicht vom Client
 *      steuerbar."
 *
 * Beides ist hier wörtlich umgesetzt, und zwar auf die einzige Art, die man
 * hinterher beweisen kann:
 *
 * - **Serverseitig** heißt: Der Client schickt eine Frage und höchstens eine
 *   Unterhaltungskennung. Sonst nichts. Es gibt keinen Parameter, mit dem sich
 *   der Kontext erweitern ließe — auch keinen versteckten.
 * - **Ausschließlich das eigene Projekt** heißt: Jede Abfrage in `buildContext`
 *   läuft über `withUserTx` und damit unter derselben RLS wie alles andere.
 *   Die Zusicherung stammt nicht aus einem `where project_id = $1`, das man
 *   vergessen kann, sondern aus den Policies. Das `where` steht trotzdem da —
 *   zwei Schlösser sind besser als eins.
 *
 * Was das Modell gesehen hat, wird mit der Antwort gespeichert
 * (`context_snapshot`). Ohne das ließe sich eine falsche Auskunft nie
 * einordnen: War die Datenlage falsch oder die Antwort?
 */

import { HTTPException } from 'hono/http-exception';
import type { Transaction } from '@meinbaulotse/db';
import type {
  AssistantMessageDto,
  AssistantStatus,
  AssistantThreadDto,
} from '@meinbaulotse/shared';
import { assistantConfigured, costInMillicents, type ModelClient } from './anthropic.js';
import {
  classifyQuestion,
  GUARDRAIL_INSTRUCTION,
  withGuardrailNotes,
  type Guardrail,
} from './assistant-guardrails.js';

type Tx = Pick<Transaction, 'query'>;

/**
 * `timestamptz` kommt als Date-Objekt aus dem Treiber, der Vertrag verlangt
 * eine Zeichenkette. Über HTTP fällt das nicht auf — `JSON.stringify` macht
 * ohnehin ISO daraus. Wer die Funktion direkt aufruft, bekommt sonst ein
 * Objekt, wo eine Zeichenkette stehen sollte, und die Prüfung schlägt an einer
 * Stelle fehl, an der niemand einen Fehler vermutet.
 */
function asIso(wert: Date | string): string {
  return wert instanceof Date ? wert.toISOString() : wert;
}

/**
 * Zwanzig Fragen je Stunde und Mitglied.
 *
 * Großzügig genug, dass niemand beim Nachhaken auf eine Wand läuft, und eng
 * genug, dass ein durchgedrehtes Skript nicht über Nacht eine Rechnung
 * schreibt. Abschnitt 6.4 verlangt die Begrenzung ausdrücklich.
 */
const FRAGEN_JE_STUNDE = 20;

/**
 * Der Monatsdeckel je Bauvorhaben, in Zehntel-Cent.
 *
 * Fünf Euro sind bei den Preisen aus `anthropic.ts` mehrere hundert Fragen —
 * mehr, als ein Bauherr in einem Monat stellt. Der Deckel ist keine Sparmaßnahme,
 * sondern eine Sicherung: Er verhindert die Rechnung, die niemand kommen sah.
 */
function monatsdeckel(): number {
  const roh = Number(process.env['ASSISTANT_MONTHLY_CENTS'] ?? '500');
  return (Number.isFinite(roh) && roh > 0 ? roh : 500) * 10;
}

// ---------------------------------------------------------------------------
// Der Kontext
// ---------------------------------------------------------------------------

export interface AssistantContext {
  project: {
    name: string;
    federalState: string;
    buildType: string;
    contractType: string;
    plannedStart: string;
    contractualCompletion: string | null;
    contractSumCents: number | null;
  };
  currentPhase: string | null;
  running: { name: string; start: string | null; end: string | null; status: string }[];
  upcoming: { name: string; start: string | null; end: string | null }[];
  decisions: { title: string; dueDate: string | null; status: string; reason: string | null }[];
  recentShifts: { taskName: string; field: string; from: string; to: string; reason: string | null }[];
  diary: { date: string; body: string; author: string | null }[];
  cards: { id: string; key: string; title: string; whatsHappening: string; watchFor: string[] }[];
}

/**
 * Baut zusammen, was das Modell wissen darf.
 *
 * Die Auswahl ist eine fachliche Entscheidung, keine technische: Abschnitt 3.7
 * nennt aktuelle Bauphase, laufende Vorgänge, offene Entscheidungen,
 * Vertragsdaten und das Tagebuch der letzten Wochen. Dazu kommen die
 * Lotsenkarten der laufenden und der nächsten Vorgänge — sie sind der
 * eigentliche Grund, warum dieser Assistent hinter der Redaktion steht und
 * nicht davor.
 *
 * Was **nicht** hineingeht, ist genauso überlegt: keine Mitgliederliste, keine
 * Kontaktdaten, keine Gast-Token. Das Modell soll über den Bau reden, nicht
 * über die Menschen.
 */
export async function buildContext(
  tx: Tx,
  projectId: string,
  today: string,
): Promise<AssistantContext> {
  const projekt = await tx.query<{
    name: string;
    federal_state: string;
    build_type: string;
    contract_type: string;
    planned_start: string;
    contractual_completion: string | null;
    contract_sum_cents: number | null;
  }>(
    `select name, federal_state, build_type, contract_type, planned_start,
            contractual_completion, contract_sum_cents
       from project where id = $1`,
    [projectId],
  );
  if (projekt.rows.length === 0) {
    throw new HTTPException(404, { message: 'Dieses Bauvorhaben gibt es nicht.' });
  }

  const vorgaenge = await tx.query<{
    name: string;
    current_start: string | null;
    current_end: string | null;
    status: string;
    phase_key: string;
    laeuft: boolean;
  }>(
    `select t.name, t.current_start, t.current_end, t.status::text, t.phase_key,
            (t.current_start <= $2::date and coalesce(t.current_end, t.current_start) >= $2::date)
              as laeuft
       from task t
      where t.project_id = $1
        and t.status <> 'entfallen'
        and t.current_start is not null
        and t.current_start <= $2::date + 28
        and coalesce(t.current_end, t.current_start) >= $2::date - 14
      order by t.current_start, t.sort_order`,
    [projectId, today],
  );

  const entscheidungen = await tx.query<{
    title: string;
    due_date: string | null;
    status: string;
    reason: string | null;
  }>(
    `select title, due_date, status::text, reason
       from decision
      where project_id = $1 and status in ('offen','in_bemusterung')
      order by due_date nulls last
      limit 10`,
    [projectId],
  );

  const verschiebungen = await tx.query<{
    task_name: string;
    field: string;
    old_value: unknown;
    new_value: unknown;
    reason_code: string | null;
  }>(
    `select t.name as task_name, c.field, c.old_value, c.new_value, c.reason_code::text
       from schedule_change c
       join task t on t.id = c.task_id
      where c.project_id = $1
        and c.field in ('current_start','current_end')
        and c.created_at >= now() - interval '21 days'
      order by c.created_at desc
      limit 12`,
    [projectId],
  );

  const tagebuch = await tx.query<{ entry_date: string; body: string; author: string | null }>(
    `select e.entry_date, e.body, m.display_name as author
       from diary_entry e
       left join project_member m on m.id = e.author_member_id
      where e.project_id = $1
        and e.retracted_at is null
        and e.body <> ''
      order by e.entry_date desc
      limit 15`,
    [projectId],
  );

  // Die Karten der Vorgänge, die gerade in den Blick rücken. Nicht alle zwölf:
  // Was der Bauherr im November fragt, beantwortet die Karte zum Estrich, nicht
  // die zur Abnahme — und jede mitgeschickte Karte kostet Eingabetoken.
  const karten = await tx.query<{
    id: string;
    key: string;
    title: string;
    whats_happening: string;
    watch_for: { text: string }[];
  }>(
    `select distinct on (c.id) c.id, c.key, c.title, c.whats_happening, c.watch_for
       from task t
       join guide_card c on c.id = t.guide_card_id
      where t.project_id = $1
        and t.status <> 'entfallen'
        and t.current_start is not null
        and t.current_start <= $2::date + 21
        and coalesce(t.current_end, t.current_start) >= $2::date - 14`,
    [projectId, today],
  );

  const zeile = projekt.rows[0]!;
  const laufend = vorgaenge.rows.filter((row) => row.laeuft);

  return {
    project: {
      name: zeile.name,
      federalState: zeile.federal_state,
      buildType: zeile.build_type,
      contractType: zeile.contract_type,
      plannedStart: zeile.planned_start,
      contractualCompletion: zeile.contractual_completion,
      contractSumCents: zeile.contract_sum_cents,
    },
    currentPhase: laufend[0]?.phase_key ?? null,
    running: laufend.map((row) => ({
      name: row.name,
      start: row.current_start,
      end: row.current_end,
      status: row.status,
    })),
    upcoming: vorgaenge.rows
      .filter((row) => !row.laeuft && (row.current_start ?? '') > today)
      .slice(0, 8)
      .map((row) => ({ name: row.name, start: row.current_start, end: row.current_end })),
    decisions: entscheidungen.rows.map((row) => ({
      title: row.title,
      dueDate: row.due_date,
      status: row.status,
      reason: row.reason,
    })),
    recentShifts: verschiebungen.rows.map((row) => ({
      taskName: row.task_name,
      field: row.field,
      from: String(row.old_value ?? '—'),
      to: String(row.new_value ?? '—'),
      reason: row.reason_code,
    })),
    diary: tagebuch.rows.map((row) => ({
      date: row.entry_date,
      body: row.body.slice(0, 400),
      author: row.author,
    })),
    cards: karten.rows.map((row) => ({
      id: row.id,
      key: row.key,
      title: row.title,
      whatsHappening: row.whats_happening,
      watchFor: row.watch_for.map((item) => item.text),
    })),
  };
}

// ---------------------------------------------------------------------------
// Der Systemprompt
// ---------------------------------------------------------------------------

/**
 * Wer der Lotse ist und was er nicht tut.
 *
 * Der Ton ist nicht Beiwerk: Regel 6 dieses Repositories und Abschnitt 11.4 des
 * Gestaltungssystems verlangen, dass auch eine schlechte Nachricht einen
 * nächsten Schritt trägt. Ein Assistent, der das nicht tut, ist im Ton ein
 * anderes Produkt als der Rest der Anwendung — und der Bauherr merkt es sofort.
 */
export function systemPrompt(context: AssistantContext, guardrails: readonly Guardrail[]): string {
  const teile: string[] = [
    'Du bist der Lotse in „MeinBaulotse". Du hilfst einem privaten Bauherrn, der zum',
    'ersten Mal baut, durch seinen Hausbau. Er ist kein Fachmann und muss keiner werden.',
    '',
    'So redest du:',
    '- Kurz. Zwei bis fünf Sätze, wenn es geht. Kein Aufzählungsgewitter.',
    '- In Alltagssprache. Fachbegriffe erklärst du beim ersten Mal in einem Halbsatz.',
    '- Ruhig. Auch eine schlechte Nachricht endet mit dem nächsten Schritt.',
    '- Ehrlich. Wenn die Datenlage für eine Aussage nicht reicht, sagst du das,',
    '  statt zu raten. „Dazu steht in deinem Projekt nichts" ist eine gute Antwort.',
    '',
    'Was du nicht tust:',
    '- Keine Rechtsberatung. Gesetzesstellen nennst du, den Einzelfall bewertest du nicht.',
    '- Keine Mängelbeurteilung aus der Ferne oder von einem Foto.',
    '- Keine verbindlich klingenden Kostenschätzungen.',
    '- Keine Produktempfehlungen und keine Firmennamen.',
    '',
    'Wenn deine Antwort auf einer der unten stehenden Lotsenkarten beruht, nenne',
    'ihren Titel im Text, damit der Bauherr nachlesen kann.',
  ];

  for (const rail of guardrails) {
    teile.push('', `Für diese Frage gilt außerdem: ${GUARDRAIL_INSTRUCTION[rail]}`);
  }

  teile.push(
    '',
    '--- Daten dieses Bauvorhabens ---',
    // Bewusst JSON und keine Prosa: Was das Modell sieht, ist damit Zeichen für
    // Zeichen dasselbe, was in `context_snapshot` gespeichert wird. Eine schöner
    // formulierte Fassung wäre eine zweite Wahrheit.
    JSON.stringify(context, null, 1),
  );

  return teile.join('\n');
}

// ---------------------------------------------------------------------------
// Fragen und antworten
// ---------------------------------------------------------------------------

export async function assistantStatusFor(tx: Tx, projectId: string): Promise<AssistantStatus> {
  if (!assistantConfigured()) {
    return {
      available: false,
      reason:
        'Der Lotse ist in dieser Umgebung nicht eingerichtet. Alles andere funktioniert wie gewohnt.',
      questionsLeftThisHour: 0,
      budgetUsedPercent: 0,
    };
  }

  const zahlen = await tx.query<{ gefragt: number; verbraucht: string }>(
    `select mbl.assistant_asked_last_hour($1) as gefragt,
            mbl.assistant_spent_millicents($1)::text as verbraucht`,
    [projectId],
  );
  const gefragt = zahlen.rows[0]?.gefragt ?? 0;
  const verbraucht = Number(zahlen.rows[0]?.verbraucht ?? 0);
  const deckel = monatsdeckel();

  const uebrig = Math.max(0, FRAGEN_JE_STUNDE - gefragt);
  const anteil = Math.min(100, Math.round((verbraucht / deckel) * 100));

  return {
    available: uebrig > 0 && verbraucht < deckel,
    reason:
      verbraucht >= deckel
        ? 'Für diesen Monat ist das Fragenbudget aufgebraucht. Ab dem Ersten geht es weiter — bis dahin helfen die Lotsenkarten zu jedem Vorgang.'
        : uebrig === 0
          ? 'Das waren viele Fragen in kurzer Zeit. In einer Stunde geht es weiter.'
          : null,
    questionsLeftThisHour: uebrig,
    budgetUsedPercent: anteil,
  };
}

export async function listThreads(tx: Tx, projectId: string): Promise<AssistantThreadDto[]> {
  const faeden = await tx.query<{ id: string; title: string | null; created_at: Date }>(
    `select id, title, created_at from assistant_thread
      where project_id = $1 order by created_at desc limit 30`,
    [projectId],
  );
  if (faeden.rows.length === 0) return [];

  const nachrichten = await loadMessages(
    tx,
    faeden.rows.map((row) => row.id),
  );

  return faeden.rows.map((row) => ({
    id: row.id,
    title: row.title,
    createdAt: asIso(row.created_at),
    messages: nachrichten.get(row.id) ?? [],
  }));
}

async function loadMessages(
  tx: Tx,
  threadIds: readonly string[],
): Promise<Map<string, AssistantMessageDto[]>> {
  const gruppiert = new Map<string, AssistantMessageDto[]>();
  if (threadIds.length === 0) return gruppiert;

  const result = await tx.query<{
    id: string;
    thread_id: string;
    role: AssistantMessageDto['role'];
    content: string;
    guardrails: AssistantMessageDto['guardrails'];
    created_at: Date;
    cited: { id: string; key: string; title: string }[] | null;
  }>(
    `select m.id, m.thread_id, m.role::text as role, m.content, m.guardrails, m.created_at,
            (select coalesce(jsonb_agg(jsonb_build_object(
                      'id', c.id, 'key', c.key, 'title', c.title) order by c.key), '[]'::jsonb)
               from guide_card c where c.id = any(m.cited_guide_card_ids)) as cited
       from assistant_message m
      where m.thread_id = any($1::uuid[])
      order by m.created_at`,
    [threadIds],
  );

  for (const row of result.rows) {
    const liste = gruppiert.get(row.thread_id) ?? [];
    liste.push({
      id: row.id,
      role: row.role,
      content: row.content,
      citedCards: row.cited ?? [],
      guardrails: row.guardrails,
      createdAt: asIso(row.created_at),
    });
    gruppiert.set(row.thread_id, liste);
  }
  return gruppiert;
}

/**
 * Eine Frage stellen und beantworten lassen.
 *
 * Der Ablauf ist bewusst geradlinig und ohne Abkürzung:
 *
 *   1. Deckel und Rate prüfen — vor jedem Aufruf, nicht danach.
 *   2. Kontext bauen. Serverseitig, unter RLS, aus nichts als der Projektkennung.
 *   3. Leitplanken bestimmen. Aus der Frage, deterministisch.
 *   4. Fragen. Mit Verlauf, damit Nachhaken funktioniert.
 *   5. Hinweise anhängen — ob das Modell sie schon gab oder nicht.
 *   6. Beides speichern, mit Kontext, Karten, Leitplanken und Kosten.
 */
export async function ask(
  tx: Tx,
  projectId: string,
  model: ModelClient,
  frage: { threadId: string | null; question: string },
  today: string,
): Promise<AssistantThreadDto> {
  const zustand = await assistantStatusFor(tx, projectId);
  if (!zustand.available) {
    throw new HTTPException(429, {
      message: zustand.reason ?? 'Der Lotse ist gerade nicht erreichbar.',
    });
  }

  const threadId = frage.threadId ?? (await createThread(tx, projectId, frage.question));
  const verlauf = (await loadMessages(tx, [threadId])).get(threadId) ?? [];

  const context = await buildContext(tx, projectId, today);
  const guardrails = classifyQuestion(frage.question);

  await tx.query(
    `insert into assistant_message (thread_id, project_id, role, content, guardrails)
     values ($1, $2, 'user', $3, $4::text[])`,
    [threadId, projectId, frage.question, guardrails],
  );

  const antwort = await model.complete({
    system: systemPrompt(context, guardrails),
    messages: [
      ...verlauf.map((eintrag) => ({ role: eintrag.role, content: eintrag.content })),
      { role: 'user' as const, content: frage.question },
    ],
  });

  const text = antwort.refused
    ? 'Diese Frage kann ich nicht beantworten. Wenn sie mit deinem Bau zu tun hat, formulier sie gern anders — und bei allem, was rechtlich oder bautechnisch heikel ist, ist ohnehin ein Fachmann die bessere Adresse.'
    : withGuardrailNotes(antwort.text, guardrails);

  // Welche Karten die Antwort trägt: Erkannt wird am Titel, den der
  // Systemprompt ausdrücklich zu nennen verlangt. Bewusst keine Rückfrage an
  // das Modell, welche Karten es benutzt hat — eine zweite Anfrage kostet
  // Geld und liefert eine zweite Behauptung statt eines Belegs.
  const zitiert = context.cards.filter((karte) => text.includes(karte.title)).map((k) => k.id);

  await tx.query(
    `insert into assistant_message
       (thread_id, project_id, role, content, context_snapshot, cited_guide_card_ids,
        guardrails, input_tokens, output_tokens, cost_millicents)
     values ($1, $2, 'assistant', $3, $4::jsonb, $5::uuid[], $6::text[], $7, $8, $9)`,
    [
      threadId,
      projectId,
      text,
      JSON.stringify(context),
      zitiert,
      guardrails,
      antwort.inputTokens,
      antwort.outputTokens,
      costInMillicents(antwort.inputTokens, antwort.outputTokens),
    ],
  );

  const alle = await listThreads(tx, projectId);
  return alle.find((faden) => faden.id === threadId)!;
}

async function createThread(tx: Tx, projectId: string, frage: string): Promise<string> {
  const result = await tx
    .query<{ id: string }>(
      `insert into assistant_thread (project_id, member_id, title)
       values ($1, mbl.current_member_id($1), $2)
       returning id`,
      [projectId, frage.slice(0, 80)],
    )
    .catch((cause: unknown) => {
      if ((cause as { code?: string } | null)?.code === '42501') {
        throw new HTTPException(403, { message: 'In deiner Rolle gibt es den Lotsen nicht.' });
      }
      throw cause;
    });
  return result.rows[0]!.id;
}
