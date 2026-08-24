/**
 * Der Entscheidungsassistent — Abschnitt 3.2 der Spezifikation.
 *
 * Die Rechnung ist eine Zeile: Die Frist liegt so viele Werktage vor dem
 * Beginn des blockierten Vorgangs, wie die Vorlaufzeit sagt. Der Wert steckt
 * darin, dass sie wiederholt wird — jedes Mal, wenn sich ein Termin ändert.
 *
 * Deshalb steht hier keine eigene Werktagsarithmetik. `decisionDueDate` kommt
 * aus `packages/schedule` und rechnet mit demselben Feiertagskalender wie der
 * Terminplan. Zwei Rechenwege für dieselbe Frage sind ein Fehler, der erst
 * auffällt, wenn beide auseinanderlaufen.
 */

import { HTTPException } from 'hono/http-exception';
import { decisionDueDate, type Calendar, type IsoDate } from '@meinbaulotse/schedule';
import type { Transaction } from '@meinbaulotse/db';
import type { DecisionDto, DecisionUpdateRequest } from '@meinbaulotse/shared';

type Tx = Pick<Transaction, 'query'>;

interface DecisionRow {
  id: string;
  template_key: string | null;
  title: string;
  description: string | null;
  reason: string | null;
  help: DecisionDto['help'];
  blocks_task_id: string | null;
  blocks_task_name: string | null;
  blocks_task_start: string | null;
  lead_time_days: number;
  lead_time_unit: DecisionDto['leadTimeUnit'];
  due_date: string | null;
  status: DecisionDto['status'];
  decided_at: string | null;
  decided_note: string | null;
  estimated_cost_cents: string | null;
}

function toDecision(row: DecisionRow): DecisionDto {
  return {
    id: row.id,
    templateKey: row.template_key,
    title: row.title,
    description: row.description,
    reason: row.reason,
    help: row.help,
    blocksTaskId: row.blocks_task_id,
    blocksTaskName: row.blocks_task_name,
    blocksTaskStart: row.blocks_task_start,
    leadTimeDays: row.lead_time_days,
    leadTimeUnit: row.lead_time_unit,
    dueDate: row.due_date,
    status: row.status,
    decidedAt: row.decided_at,
    decidedNote: row.decided_note,
    // `bigint` kommt als Zeichenkette aus dem Treiber. Beträge in Cent bleiben
    // weit unter der sicheren Ganzzahlgrenze, deshalb ist die Umwandlung hier
    // unbedenklich.
    estimatedCostCents: row.estimated_cost_cents === null ? null : Number(row.estimated_cost_cents),
  };
}

/**
 * Die Entscheidungen eines Bauvorhabens, nach Frist sortiert.
 *
 * Ohne Frist ganz nach hinten: Eine Entscheidung, deren Vorgang keinen Termin
 * hat, ist nicht dringend, sondern unbestimmt.
 */
export async function loadDecisions(tx: Tx, projectId: string): Promise<DecisionDto[]> {
  const result = await tx.query<DecisionRow>(
    `select d.id, d.template_key, d.title, d.description, d.reason, d.help,
            d.blocks_task_id, t.name as blocks_task_name, t.current_start as blocks_task_start,
            d.lead_time_days, d.lead_time_unit, d.due_date, d.status,
            d.decided_at, d.decided_note, d.estimated_cost_cents
       from decision d
       left join task t on t.id = d.blocks_task_id
      where d.project_id = $1
      order by d.due_date asc nulls last, d.title`,
    [projectId],
  );
  return result.rows.map(toDecision);
}

/**
 * Legt die Entscheidungen eines frisch angelegten Bauvorhabens an.
 *
 * Beschreibung, Grund und Entscheidungshilfe werden aus der Vorlage **kopiert**
 * und nicht verknüpft. Dieselbe Überlegung wie bei den Lotsenkarten: Eine
 * spätere Korrektur an der Vorlage soll kein laufendes Bauvorhaben umschreiben.
 *
 * Vorlagen, deren Vorgang in diesem Plan nicht vorkommt, werden übergangen —
 * ohne Keller gibt es keine Kellervorgänge, und eine Entscheidung ohne Bezug
 * wäre eine Frist ins Leere.
 */
export async function createDecisionsFromTemplates(
  tx: Tx,
  projectId: string,
  taskIdByCode: ReadonlyMap<string, string>,
  startByCode: ReadonlyMap<string, IsoDate>,
  calendar: Calendar,
): Promise<number> {
  const templates = await tx.query<{
    key: string;
    title: string;
    blocks_task_code: string;
    lead_time_days: number;
    lead_time_unit: 'werktage' | 'kalendertage';
    reason: string | null;
    description: string;
    help: unknown;
  }>(
    `select key, title, blocks_task_code, lead_time_days, lead_time_unit,
            reason, description, help
       from decision_template order by sort_order`,
  );

  let angelegt = 0;
  for (const template of templates.rows) {
    const taskId = taskIdByCode.get(template.blocks_task_code);
    if (taskId === undefined) continue;

    const start = startByCode.get(template.blocks_task_code);
    const dueDate =
      start === undefined
        ? null
        : decisionDueDate(
            {
              id: template.key,
              blocksTaskId: taskId,
              leadTimeDays: template.lead_time_days,
              leadTimeUnit: template.lead_time_unit,
            },
            start,
            calendar,
          );

    await tx.query(
      `insert into decision
         (project_id, template_key, title, description, reason, help,
          blocks_task_id, lead_time_days, lead_time_unit, due_date)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        projectId,
        template.key,
        template.title,
        template.description,
        template.reason,
        JSON.stringify(template.help),
        taskId,
        template.lead_time_days,
        template.lead_time_unit,
        dueDate,
      ],
    );
    angelegt += 1;
  }
  return angelegt;
}

/**
 * Zieht die Fristen nach, nachdem sich Termine geändert haben.
 *
 * Das ist der Schritt, der eine Verschiebung für den Bauherren
 * handlungsrelevant macht (Abschnitt 3.5, Punkt 8). Ohne ihn wäre eine
 * verschobene Frist erst dann sichtbar, wenn sie schon verstrichen ist.
 *
 * Geschrieben wird nur, was sich wirklich geändert hat: Der Generalunternehmer
 * darf diese Zeilen anfassen, aber ausschließlich in diesem einen Feld — der
 * Trigger `mbl.guard_decision_fields` sorgt dafür. Ein `update` auf
 * unveränderte Werte wäre nicht falsch, aber vierzehn überflüssige Anweisungen
 * je Verschiebung sind es auch nicht wert.
 */
export async function syncDecisionDueDates(
  tx: Tx,
  projectId: string,
  calendar: Calendar,
  startByTaskId: ReadonlyMap<string, IsoDate>,
): Promise<number> {
  const result = await tx.query<{
    id: string;
    blocks_task_id: string | null;
    lead_time_days: number;
    lead_time_unit: 'werktage' | 'kalendertage';
    due_date: string | null;
  }>(
    `select id, blocks_task_id, lead_time_days, lead_time_unit, due_date
       from decision where project_id = $1`,
    [projectId],
  );

  let verschoben = 0;
  for (const row of result.rows) {
    const start = row.blocks_task_id === null ? undefined : startByTaskId.get(row.blocks_task_id);
    const next =
      start === undefined
        ? null
        : decisionDueDate(
            {
              id: row.id,
              blocksTaskId: row.blocks_task_id!,
              leadTimeDays: row.lead_time_days,
              leadTimeUnit: row.lead_time_unit,
            },
            start,
            calendar,
          );

    if (row.due_date === next) continue;
    await tx.query('update decision set due_date = $2 where id = $1', [row.id, next]);
    verschoben += 1;
  }
  return verschoben;
}

/**
 * Eine Entscheidung pflegen.
 *
 * Wer das darf, entscheidet die Datenbank: Die Policy `decision_update`
 * verlangt `decision.write` oder `task.schedule`, und der Trigger
 * `mbl.guard_decision_fields` lässt die zweite Rolle nur an die errechnete
 * Frist. Hier wird nichts geprüft, was eine Policy prüfen kann — nur übersetzt,
 * wenn sie ablehnt.
 */
export async function updateDecision(
  tx: Tx,
  projectId: string,
  decisionId: string,
  change: DecisionUpdateRequest,
): Promise<DecisionDto> {
  const felder: string[] = [];
  const werte: unknown[] = [decisionId, projectId];
  const setze = (spalte: string, wert: unknown): void => {
    werte.push(wert);
    felder.push(`${spalte} = $${werte.length}`);
  };

  if (change.status !== undefined) setze('status', change.status);
  if (change.decidedNote !== undefined) setze('decided_note', change.decidedNote);
  if (change.estimatedCostCents !== undefined) {
    setze('estimated_cost_cents', change.estimatedCostCents);
  }

  let result;
  try {
    result = await tx.query(
      `update decision set ${felder.join(', ')} where id = $1 and project_id = $2`,
      werte,
    );
  } catch (cause) {
    // Die Policy oder der Feldwächter haben abgelehnt. Beide melden 42501.
    if (
      typeof cause === 'object' &&
      cause !== null &&
      (cause as { code?: string }).code === '42501'
    ) {
      throw new HTTPException(403, {
        message: 'Entscheidungen pflegt der Bauherr. Du kannst sie sehen, aber nicht ändern.',
      });
    }
    throw cause;
  }

  if (result.rowCount === 0) {
    // Wie überall: Ob es diese Entscheidung gibt, geht Fremde nichts an.
    throw new HTTPException(404, {
      message: 'Diese Entscheidung gibt es in deinem Bauvorhaben nicht.',
    });
  }

  const geladen = await tx.query<DecisionRow>(
    `select d.id, d.template_key, d.title, d.description, d.reason, d.help,
            d.blocks_task_id, t.name as blocks_task_name, t.current_start as blocks_task_start,
            d.lead_time_days, d.lead_time_unit, d.due_date, d.status,
            d.decided_at, d.decided_note, d.estimated_cost_cents
       from decision d
       left join task t on t.id = d.blocks_task_id
      where d.id = $1`,
    [decisionId],
  );
  return toDecision(geladen.rows[0]!);
}
