/**
 * Die Wissensschicht auf der API-Seite (Arbeitspaket 2).
 *
 * Drei Dinge passieren hier, und die Reihenfolge ist Absicht:
 *
 * 1. **Die Karte finden.** Nicht über einen Fremdschlüssel am Vorgang, sondern
 *    über den Vorlagencode. Damit erreicht eine überarbeitete Karte auch die,
 *    die schon bauen — bei einer festen Zuordnung bliebe jeder Bauherr auf der
 *    Fassung sitzen, die beim Anlegen seines Projekts galt.
 * 2. **Das Lesen festhalten.** Eine Karte, die einmal offen war, muss nicht
 *    weiter unter „lies dich ein" stehen. Deshalb schreibt auch das Abrufen.
 * 3. **Die Checkliste bereitstellen.** Sie ist kein zweiter Text, sondern nur
 *    der Zustand zu den Punkten der Karte: abgehakt oder nicht. Der Text steht
 *    genau einmal, nämlich in der Karte.
 *
 * Wer abhaken darf, entscheidet die Datenbank (`checklist_item_write`). Hier
 * wird nur entschieden, ob wir es **versuchen** — ein stiller Mitleser soll
 * nicht bei jedem Öffnen einer Karte auf einen Rechtefehler laufen.
 */

import { HTTPException } from 'hono/http-exception';
import type { Transaction } from '@meinbaulotse/db';
import type {
  ChecklistItemDto,
  ChecklistUpdateRequest,
  GuideCardDto,
  GuideCardView,
} from '@meinbaulotse/shared';

type Tx = Pick<Transaction, 'query'>;

interface CardRow {
  id: string;
  key: string;
  version: number;
  title: string;
  phase_key: string;
  trade_code: string | null;
  whats_happening: string;
  watch_for: GuideCardDto['watchFor'];
  questions_for_contractor: GuideCardDto['questionsForContractor'];
  common_problems: GuideCardDto['commonProblems'];
  photo_prompts: GuideCardDto['photoPrompts'];
  expert_recommended: boolean;
  expert_reason: string | null;
  sources: GuideCardDto['sources'];
}

const toCard = (row: CardRow): GuideCardDto => ({
  id: row.id,
  key: row.key,
  version: row.version,
  title: row.title,
  phaseKey: row.phase_key,
  tradeCode: row.trade_code,
  whatsHappening: row.whats_happening,
  watchFor: row.watch_for,
  questionsForContractor: row.questions_for_contractor,
  commonProblems: row.common_problems,
  photoPrompts: row.photo_prompts,
  expertRecommended: row.expert_recommended,
  expertReason: row.expert_reason,
  sources: row.sources,
});

/**
 * Die Auswahl der Karte, an einer Stelle.
 *
 * `superseded_by is null` nimmt die aktuelle Fassung. Die Sortierung nach
 * Fassung ist die zweite Sicherung: Bliebe eine Verkettung einmal aus, käme
 * immer noch die neuere Karte und nicht irgendeine.
 */
const CARD_FOR_TASK = `
  select gc.id, gc.key, gc.version, gc.title, gc.phase_key, gc.trade_code,
         gc.whats_happening, gc.watch_for, gc.questions_for_contractor,
         gc.common_problems, gc.photo_prompts, gc.expert_recommended,
         gc.expert_reason, gc.sources
    from task t
    join guide_card gc
      on gc.published_at is not null
     and (
           gc.id = t.guide_card_id
           or (t.template_task_code is not null
               and t.template_task_code = any (gc.template_task_codes)
               and gc.superseded_by is null)
         )
   where t.id = $1 and t.project_id = $2
   order by (gc.id = t.guide_card_id) desc, gc.version desc
   limit 1`;

/**
 * Ein Klausel-Baustein für den Terminplan: Gibt es zu diesem Vorgang etwas zu
 * lesen, und war es schon offen?
 *
 * Der zweite Teil hängt am fragenden Mitglied, nicht am Projekt: Dass der GU
 * die Karte gelesen hat, nimmt dem Bauherrn die Einblendung nicht weg.
 */
export const GUIDE_CARD_KEY_JOIN = `
  left join lateral (
    select gc.id, gc.key
      from guide_card gc
     where gc.published_at is not null
       and (
             gc.id = t.guide_card_id
             or (t.template_task_code is not null
                 and t.template_task_code = any (gc.template_task_codes)
                 and gc.superseded_by is null)
           )
     order by (gc.id = t.guide_card_id) desc, gc.version desc
     limit 1
  ) guide on true
  left join guide_card_read gelesen
    on gelesen.guide_card_id = guide.id
   and gelesen.project_id = t.project_id
   and gelesen.member_id = mbl.current_member_id(t.project_id)`;

export async function loadGuideCardView(
  tx: Tx,
  projectId: string,
  taskId: string,
): Promise<GuideCardView> {
  const task = await tx.query<{ id: string; name: string }>(
    'select id, name from task where id = $1 and project_id = $2',
    [taskId, projectId],
  );
  const head = task.rows[0];
  if (head === undefined) {
    // Wie überall: Kein Fund heißt „du siehst ihn nicht", und das sieht von
    // außen aus wie „gibt es nicht". Ein 403 verriete, dass es ihn gibt.
    throw new HTTPException(404, {
      message: 'Diesen Vorgang gibt es in deinem Bauvorhaben nicht.',
    });
  }

  const cards = await tx.query<CardRow>(CARD_FOR_TASK, [taskId, projectId]);
  const row = cards.rows[0];
  if (row === undefined) {
    throw new HTTPException(404, {
      message: `Zu „${head.name}" gibt es noch keine Lotsenkarte.`,
      cause: {
        hint: 'Zwölf Karten decken die Bauphasen ab, in denen am meisten schiefgeht. Die übrigen kommen nach und nach dazu.',
      },
    });
  }
  const card = toCard(row);

  const darfAbhaken = await hasPermission(tx, projectId, 'diary.write');
  if (darfAbhaken) {
    await ensureChecklist(tx, projectId, taskId, card);
  }

  const checklist = await loadChecklist(tx, taskId, card.id);
  const read = await markAsRead(tx, projectId, taskId, card.id);

  return {
    card,
    taskId: head.id,
    taskName: head.name,
    checklist,
    read,
    canCheck: darfAbhaken,
  };
}

async function hasPermission(tx: Tx, projectId: string, permission: string): Promise<boolean> {
  const result = await tx.query<{ erlaubt: boolean }>(
    'select mbl.has_perm($1, $2) as erlaubt',
    [projectId, permission],
  );
  return result.rows[0]?.erlaubt === true;
}

/**
 * Legt die Zustandszeilen zu den Punkten der Karte an, einmal je Vorgang.
 *
 * `on conflict do nothing` über (task_id, guide_card_id, sort_order): Zwei
 * Beteiligte, die die Karte gleichzeitig öffnen, erzeugen keine Doppelten.
 */
async function ensureChecklist(
  tx: Tx,
  projectId: string,
  taskId: string,
  card: GuideCardDto,
): Promise<void> {
  if (card.watchFor.length === 0) return;

  const vorhanden = await tx.query<{ anzahl: string }>(
    'select count(*)::text as anzahl from checklist_item where task_id = $1 and guide_card_id = $2',
    [taskId, card.id],
  );
  if (Number(vorhanden.rows[0]?.anzahl ?? '0') === card.watchFor.length) return;

  for (const [index, point] of card.watchFor.entries()) {
    await tx.query(
      `insert into checklist_item (project_id, task_id, guide_card_id, text, why, sort_order)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (task_id, guide_card_id, sort_order) do nothing`,
      [projectId, taskId, card.id, point.text, point.why, index],
    );
  }
}

async function loadChecklist(tx: Tx, taskId: string, cardId: string): Promise<ChecklistItemDto[]> {
  const result = await tx.query<{
    id: string;
    text: string;
    why: string | null;
    sort_order: number;
    is_done: boolean;
    done_at: string | null;
    note: string | null;
  }>(
    `select id, text, why, sort_order, is_done, done_at, note
       from checklist_item
      where task_id = $1 and guide_card_id = $2
      order by sort_order`,
    [taskId, cardId],
  );

  return result.rows.map((row) => ({
    id: row.id,
    text: row.text,
    why: row.why,
    sortOrder: row.sort_order,
    isDone: row.is_done,
    doneAt: row.done_at === null ? null : new Date(row.done_at).toISOString(),
    note: row.note,
  }));
}

/**
 * Hält fest, dass diese Karte offen war.
 *
 * Ohne Mitgliedschaft — etwa bei einem Zugang über eine Organisation, dessen
 * Mitgliedszeile gerade fehlt — wird nichts geschrieben. Die Karte trotzdem
 * anzuzeigen ist richtiger, als das Lesen an der Buchführung scheitern zu
 * lassen.
 */
async function markAsRead(
  tx: Tx,
  projectId: string,
  taskId: string,
  cardId: string,
): Promise<GuideCardView['read']> {
  const member = await tx.query<{ id: string | null }>(
    'select mbl.current_member_id($1) as id',
    [projectId],
  );
  const memberId = member.rows[0]?.id ?? null;
  if (memberId === null) return null;

  const result = await tx.query<{ read_at: string; helpful: boolean | null }>(
    `insert into guide_card_read (project_id, guide_card_id, task_id, member_id)
     values ($1, $2, $3, $4)
     on conflict (project_id, guide_card_id, member_id)
       do update set read_at = now(), task_id = excluded.task_id
     returning read_at, helpful`,
    [projectId, cardId, taskId, memberId],
  );

  const row = result.rows[0];
  if (row === undefined) return null;
  return { readAt: new Date(row.read_at).toISOString(), helpful: row.helpful };
}

/** „War das hilfreich?" — zwei Knöpfe, und `null` nimmt die Antwort zurück. */
export async function recordFeedback(
  tx: Tx,
  projectId: string,
  taskId: string,
  helpful: boolean | null,
): Promise<GuideCardView['read']> {
  const cards = await tx.query<CardRow>(CARD_FOR_TASK, [taskId, projectId]);
  const card = cards.rows[0];
  if (card === undefined) {
    throw new HTTPException(404, { message: 'Zu diesem Vorgang gibt es keine Lotsenkarte.' });
  }

  const member = await tx.query<{ id: string | null }>(
    'select mbl.current_member_id($1) as id',
    [projectId],
  );
  const memberId = member.rows[0]?.id ?? null;
  if (memberId === null) {
    throw new HTTPException(403, {
      message: 'Für eine Rückmeldung fehlt deine Beteiligung an diesem Bauvorhaben.',
    });
  }

  const result = await tx.query<{ read_at: string; helpful: boolean | null }>(
    `insert into guide_card_read (project_id, guide_card_id, task_id, member_id, helpful)
     values ($1, $2, $3, $4, $5)
     on conflict (project_id, guide_card_id, member_id)
       do update set helpful = excluded.helpful, read_at = now()
     returning read_at, helpful`,
    [projectId, card.id, taskId, memberId, helpful],
  );

  const row = result.rows[0]!;
  return { readAt: new Date(row.read_at).toISOString(), helpful: row.helpful };
}

/**
 * Einen Punkt abhaken oder eine Notiz daranschreiben.
 *
 * `done_by` kommt aus der Datenbank, nicht aus der Anfrage: Wer abhakt, ist
 * der, der fragt — das lässt sich nicht mitschicken.
 */
export async function updateChecklistItem(
  tx: Tx,
  projectId: string,
  itemId: string,
  change: ChecklistUpdateRequest,
): Promise<ChecklistItemDto> {
  const felder: string[] = [];
  const werte: unknown[] = [itemId, projectId];

  if (change.isDone !== undefined) {
    werte.push(change.isDone);
    felder.push(`is_done = $${werte.length}`);
    felder.push(
      change.isDone
        ? `done_at = now(), done_by = mbl.current_member_id($2)`
        : 'done_at = null, done_by = null',
    );
  }
  if (change.note !== undefined) {
    werte.push(change.note);
    felder.push(`note = $${werte.length}`);
  }

  const result = await tx.query<{
    id: string;
    text: string;
    why: string | null;
    sort_order: number;
    is_done: boolean;
    done_at: string | null;
    note: string | null;
  }>(
    `update checklist_item set ${felder.join(', ')}
      where id = $1 and project_id = $2
      returning id, text, why, sort_order, is_done, done_at, note`,
    werte,
  );

  const row = result.rows[0];
  if (row === undefined) {
    throw new HTTPException(404, {
      message: 'Diesen Punkt gibt es in deinem Bauvorhaben nicht.',
    });
  }

  return {
    id: row.id,
    text: row.text,
    why: row.why,
    sortOrder: row.sort_order,
    isDone: row.is_done,
    doneAt: row.done_at === null ? null : new Date(row.done_at).toISOString(),
    note: row.note,
  };
}
