/**
 * Die Wissensschicht: Lotsenkarten, Checklisten, Rückmeldung.
 *
 * Drei Dinge liegen hier zusammen, weil der Nutzer sie als eines erlebt — er
 * öffnet eine Karte, hakt etwas ab, sagt ob es geholfen hat. In der Datenbank
 * sind es drei Tabellen mit drei verschiedenen Eigentümern: Der Inhalt gehört
 * der Redaktion, der Haken und die Bewertung gehören dem Menschen, der sie
 * gesetzt hat.
 *
 * Zwei Entwurfsentscheidungen, die sich durchziehen:
 *
 * 1. **Die Karte hängt am Vorgang, nicht an der Phase.** Ein Bauherr fragt nie
 *    „was passiert in der Gründungsphase", sondern „was passiert am Montag".
 *    Die Zuordnung entsteht einmalig beim Anlegen des Projekts und friert
 *    damit die Fassung ein, die er tatsächlich gesehen hat.
 * 2. **Der Text einer Checklistenzeile kommt aus der Karte, nie aus der
 *    Anfrage.** Sonst könnte sich jeder eigene Zeilen in seine Bauakte
 *    schreiben, die aussehen, als stammten sie aus der Redaktion.
 */

import { HTTPException } from 'hono/http-exception';
import type { Transaction } from '@meinbaulotse/db';
import type {
  ChecklistEntry,
  ChecklistUpdateRequest,
  GuideCardDto,
  GuideCardView,
} from '@meinbaulotse/shared';

type Tx = Pick<Transaction, 'query'>;

/** Rollen, die Haken setzen dürfen. Dieselbe Liste wie in `checklist_item_insert`. */
const CHECKLIST_ROLES = new Set(['owner', 'co_owner', 'expert']);

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
  legal_note: boolean;
  sources: GuideCardDto['sources'];
}

function toCard(row: CardRow): GuideCardDto {
  return {
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
    legalNote: row.legal_note,
    sources: row.sources,
  };
}

/**
 * Die vollständige Ansicht einer Lotsenkarte zu einem Vorgang.
 *
 * Der Verbund geht über `task.guide_card_id` und nicht über `task_codes`: Die
 * Zuordnung ist eine Tatsache des Projekts, keine Suche zur Laufzeit. Sonst
 * bekäme ein Bauvorhaben aus dem Mai im September stillschweigend eine andere
 * Karte.
 */
export async function loadGuideCardView(
  tx: Tx,
  projectId: string,
  taskId: string,
): Promise<GuideCardView> {
  const result = await tx.query<
    CardRow & {
      task_name: string;
      current_start: string | null;
      current_end: string | null;
      member_role: string | null;
    }
  >(
    `select c.id, c.key, c.version, c.title, c.phase_key, c.trade_code, c.whats_happening,
            c.watch_for, c.questions_for_contractor, c.common_problems, c.photo_prompts,
            c.expert_recommended, c.expert_reason, c.legal_note, c.sources,
            t.name as task_name, t.current_start, t.current_end,
            mbl.member_role(t.project_id)::text as member_role
       from task t
       join guide_card c on c.id = t.guide_card_id
      where t.id = $1 and t.project_id = $2`,
    [taskId, projectId],
  );

  const row = result.rows[0];
  if (row === undefined) {
    // Kein Fund heißt dreierlei: Es gibt den Vorgang nicht, die RLS lässt
    // diese Kennung nicht an ihn heran, oder es gibt schlicht keine Karte
    // dazu. Von außen sieht alles gleich aus, und das ist Absicht.
    throw new HTTPException(404, {
      message: 'Zu diesem Vorgang gibt es noch keine Lotsenkarte.',
    });
  }

  const card = toCard(row);
  const [checklist, read] = await Promise.all([
    loadChecklist(tx, projectId, taskId, card),
    loadRead(tx, projectId, card.id),
  ]);

  return {
    card,
    taskId,
    taskName: row.task_name,
    taskStart: row.current_start,
    taskEnd: row.current_end,
    checklist,
    readAt: read.readAt,
    helpful: read.helpful,
    canEditChecklist: row.member_role !== null && CHECKLIST_ROLES.has(row.member_role),
  };
}

/**
 * Für jede Zeile aus `watchFor` genau ein Eintrag, auch die ungehakten.
 *
 * Die Liste entsteht aus der Karte und wird mit dem ergänzt, was in der
 * Datenbank steht — nicht umgekehrt. Eine Zeile, die es in der Karte nicht mehr
 * gibt, verschwindet damit aus der Ansicht, ohne dass ihr Haken gelöscht wird.
 */
async function loadChecklist(
  tx: Tx,
  projectId: string,
  taskId: string,
  card: GuideCardDto,
): Promise<ChecklistEntry[]> {
  const result = await tx.query<{
    source_key: string;
    is_done: boolean;
    done_at: string | null;
    note: string | null;
  }>(
    `select source_key, is_done, done_at, note
       from checklist_item
      where project_id = $1 and task_id = $2`,
    [projectId, taskId],
  );
  const bySourceKey = new Map(result.rows.map((row) => [row.source_key, row]));

  return card.watchFor.map((item) => {
    const stored = bySourceKey.get(item.key);
    return {
      sourceKey: item.key,
      text: item.text,
      isDone: stored?.is_done ?? false,
      doneAt: stored?.done_at ?? null,
      note: stored?.note ?? null,
    };
  });
}

async function loadRead(
  tx: Tx,
  projectId: string,
  cardId: string,
): Promise<{ readAt: string | null; helpful: boolean | null }> {
  const result = await tx.query<{ read_at: string; helpful: boolean | null }>(
    `select read_at, helpful
       from guide_card_read
      where project_id = $1
        and guide_card_id = $2
        and member_id = mbl.current_member_id($1)`,
    [projectId, cardId],
  );
  const row = result.rows[0];
  return { readAt: row?.read_at ?? null, helpful: row?.helpful ?? null };
}

/**
 * Hält fest, dass jemand die Karte gesehen hat, und nimmt seine Bewertung
 * entgegen.
 *
 * Ohne Angabe zu `helpful` bleibt eine bereits abgegebene Bewertung stehen.
 * Das ist der Unterschied zwischen „ich sehe sie mir noch einmal an" und „ich
 * ändere meine Meinung".
 */
export async function markGuideCardRead(
  tx: Tx,
  projectId: string,
  taskId: string,
  helpful: boolean | null | undefined,
): Promise<GuideCardView> {
  const view = await loadGuideCardView(tx, projectId, taskId);

  if (helpful === undefined) {
    await tx.query(
      `insert into guide_card_read (project_id, guide_card_id, member_id)
       values ($1, $2, mbl.current_member_id($1))
       on conflict (project_id, guide_card_id, member_id)
       do update set read_at = now()`,
      [projectId, view.card.id],
    );
  } else {
    await tx.query(
      `insert into guide_card_read (project_id, guide_card_id, member_id, helpful)
       values ($1, $2, mbl.current_member_id($1), $3)
       on conflict (project_id, guide_card_id, member_id)
       do update set read_at = now(), helpful = excluded.helpful`,
      [projectId, view.card.id, helpful],
    );
  }

  return loadGuideCardView(tx, projectId, taskId);
}

/** Einen Haken setzen oder wegnehmen. */
export async function setChecklistItem(
  tx: Tx,
  projectId: string,
  taskId: string,
  sourceKey: string,
  change: ChecklistUpdateRequest,
): Promise<GuideCardView> {
  const view = await loadGuideCardView(tx, projectId, taskId);
  const item = view.card.watchFor.find((entry) => entry.key === sourceKey);
  if (item === undefined) {
    throw new HTTPException(404, {
      message: 'Diesen Punkt gibt es auf dieser Lotsenkarte nicht.',
    });
  }

  const noteGiven = change.note !== undefined;
  try {
    await upsertChecklistItem(
      tx,
      projectId,
      taskId,
      view.card.id,
      sourceKey,
      item.text,
      change,
      noteGiven,
    );
  } catch (cause) {
    // Die Policy `checklist_item_insert` hat abgelehnt. Postgres meldet das als
    // 42501, und ohne diese Übersetzung käme beim Nutzer ein 500 an — „Das hat
    // nicht geklappt" für etwas, das schlicht nicht seine Rolle ist.
    //
    // Geprüft hat weiterhin die Datenbank. Hier wird nur übersetzt, nicht
    // entschieden; eine zweite Rechteprüfung im Anwendungscode wäre genau die
    // Doppelung, die Regel 1 verbietet.
    if (
      typeof cause === 'object' &&
      cause !== null &&
      (cause as { code?: string }).code === '42501'
    ) {
      throw new HTTPException(403, {
        message: 'In deiner Rolle lässt sich diese Liste nicht abhaken. Der Bauherr kann das.',
      });
    }
    throw cause;
  }

  return loadGuideCardView(tx, projectId, taskId);
}

async function upsertChecklistItem(
  tx: Tx,
  projectId: string,
  taskId: string,
  cardId: string,
  sourceKey: string,
  text: string,
  change: ChecklistUpdateRequest,
  noteGiven: boolean,
): Promise<void> {
  await tx.query(
    `insert into checklist_item
       (project_id, task_id, guide_card_id, source_key, text, is_done, done_at, done_by, note)
     values (
       $1, $2, $3, $4, $5, $6,
       case when $6 then now() else null end,
       case when $6 then mbl.current_member_id($1) else null end,
       $7
     )
     on conflict (project_id, task_id, source_key) do update
        set is_done       = excluded.is_done,
            done_at       = excluded.done_at,
            done_by       = excluded.done_by,
            guide_card_id = excluded.guide_card_id,
            -- Der Text folgt der Karte: Bekommt sie eine neue Fassung, steht
            -- an der Zeile wieder das, was der Nutzer gerade liest.
            text          = excluded.text,
            note          = case when $8 then excluded.note else checklist_item.note end`,
    [projectId, taskId, cardId, sourceKey, text, change.isDone, change.note ?? null, noteGiven],
  );
}

/**
 * Verknüpft die Vorgänge eines Bauvorhabens mit den gültigen Lotsenkarten.
 *
 * Läuft einmal beim Anlegen. Der Ausdruck ist derselbe wie in der Migration
 * 0006, die es für die Bauvorhaben nachholt, die es vorher schon gab.
 *
 * Kein Historieneintrag: Der Trigger `mbl.log_task_change` schreibt nur bei
 * Termin-, Dauer- und Statusänderungen, und eine Karte ist nichts davon.
 */
export async function linkGuideCards(tx: Tx, projectId: string): Promise<number> {
  const result = await tx.query(
    `update task t
        set guide_card_id = c.id
       from guide_card c
      where t.project_id = $1
        and c.published_at is not null
        and c.superseded_by is null
        and t.template_task_code = any (c.task_codes)
        and t.guide_card_id is distinct from c.id`,
    [projectId],
  );
  return result.rowCount ?? 0;
}
