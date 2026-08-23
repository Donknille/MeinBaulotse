/**
 * Entscheidungen und ihre Fristen (Arbeitspaket 3).
 *
 * Die Rechnung selbst steht im Berechnungskern und ist eine Zeile lang. Was
 * hier passiert, ist die Buchführung darum herum — und die hat genau eine
 * Regel, die nicht gebrochen werden darf:
 *
 *   **Die Frist wird bei jeder Neuberechnung des Plans mitgeführt.**
 *
 * Eine Entscheidungsfrist, die stehen bleibt, während ihr Vorgang sich
 * verschiebt, ist schlimmer als gar keine: Der Bauherr verlässt sich auf ein
 * Datum, das nicht mehr gilt. Deshalb ruft `recomputeProject` diese Datei auf,
 * in derselben Transaktion, in der auch die Termine geschrieben werden.
 */

import { decisionDueDate, type Calendar, type DurationUnit } from '@meinbaulotse/schedule';
import { HTTPException } from 'hono/http-exception';
import type { Transaction } from '@meinbaulotse/db';
import type { DecisionDto, DecisionUpdateRequest } from '@meinbaulotse/shared';

type Tx = Pick<Transaction, 'query'>;

interface DecisionRow {
  id: string;
  template_key: string | null;
  title: string;
  description: string | null;
  help_text: string | null;
  blocks_task_id: string | null;
  blocks_task_name: string | null;
  blocks_task_start: string | null;
  lead_time_days: number;
  lead_time_unit: DurationUnit;
  due_date: string | null;
  status: DecisionDto['status'];
  decided_at: string | null;
  decided_note: string | null;
  estimated_cost_cents: string | null;
}

const toDecision = (row: DecisionRow): DecisionDto => ({
  id: row.id,
  templateKey: row.template_key,
  title: row.title,
  description: row.description,
  helpText: row.help_text,
  blocksTaskId: row.blocks_task_id,
  blocksTaskName: row.blocks_task_name,
  blocksTaskStart: row.blocks_task_start,
  leadTimeDays: row.lead_time_days,
  leadTimeUnit: row.lead_time_unit,
  dueDate: row.due_date,
  status: row.status,
  decidedAt: row.decided_at === null ? null : new Date(row.decided_at).toISOString(),
  decidedNote: row.decided_note,
  // bigint kommt als Zeichenkette aus dem Treiber. `Number` ist bei Centbeträgen
  // bis gut 90 Billionen genau — für einen Hausbau reicht das.
  estimatedCostCents: row.estimated_cost_cents === null ? null : Number(row.estimated_cost_cents),
});

const SELECT_DECISIONS = `
  select d.id, d.template_key, d.title, d.description, d.help_text,
         d.blocks_task_id, t.name as blocks_task_name, t.current_start as blocks_task_start,
         d.lead_time_days, d.lead_time_unit, d.due_date, d.status,
         d.decided_at, d.decided_note, d.estimated_cost_cents
    from decision d
    left join task t on t.id = d.blocks_task_id
   where d.project_id = $1
   order by d.due_date nulls last, d.title`;

export async function loadDecisions(tx: Tx, projectId: string): Promise<DecisionDto[]> {
  const result = await tx.query<DecisionRow>(SELECT_DECISIONS, [projectId]);
  return result.rows.map(toDecision);
}

/**
 * Legt beim Onboarding die Entscheidungen aus den Vorlagen an.
 *
 * Die Frist wird hier noch nicht gerechnet — das übernimmt gleich danach
 * `recomputeDecisionDueDates`, und zwar mit demselben Code, der sie auch bei
 * jeder Verschiebung neu rechnet. Zwei Rechenwege für dieselbe Zahl wären
 * zwei Gelegenheiten, sie unterschiedlich falsch zu machen.
 */
export async function createDecisionsFromTemplates(
  tx: Tx,
  projectId: string,
  taskIdByTemplateCode: ReadonlyMap<string, string>,
): Promise<number> {
  const templates = await tx.query<{
    key: string;
    title: string;
    description: string;
    help_text: string;
    blocks_task_code: string;
    lead_time_days: number;
    lead_time_unit: DurationUnit;
  }>(
    `select key, title, description, help_text, blocks_task_code, lead_time_days, lead_time_unit
       from decision_template order by sort_order`,
  );

  let angelegt = 0;
  for (const template of templates.rows) {
    const taskId = taskIdByTemplateCode.get(template.blocks_task_code);
    // Ohne Keller gibt es die Kellervorgänge nicht. Eine Entscheidung, die an
    // einem solchen Vorgang hängt, entfällt dann mit — sie wird nicht ohne
    // Frist angelegt, denn eine Aufgabe ohne Anlass ist nur eine Zeile mehr.
    if (taskId === undefined) continue;

    await tx.query(
      `insert into decision
         (project_id, template_key, title, description, help_text,
          blocks_task_id, lead_time_days, lead_time_unit)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict do nothing`,
      [
        projectId,
        template.key,
        template.title,
        template.description,
        template.help_text,
        taskId,
        template.lead_time_days,
        template.lead_time_unit,
      ],
    );
    angelegt += 1;
  }

  return angelegt;
}

/**
 * Rechnet die Fristen neu und schreibt nur, was sich geändert hat.
 *
 * Gibt zurück, wie viele Fristen sich verschoben haben — die Zahl beantwortet
 * dem Bauherrn nach einer Verschiebung die Frage, die er wirklich hat: nicht
 * „wie viele Vorgänge sind betroffen", sondern „muss ich jetzt etwas tun".
 */
export async function recomputeDecisionDueDates(
  tx: Tx,
  projectId: string,
  calendar: Calendar,
): Promise<number> {
  const rows = await tx.query<{
    id: string;
    lead_time_days: number;
    lead_time_unit: DurationUnit;
    due_date: string | null;
    task_start: string | null;
  }>(
    `select d.id, d.lead_time_days, d.lead_time_unit, d.due_date, t.current_start as task_start
       from decision d
       left join task t on t.id = d.blocks_task_id
      where d.project_id = $1`,
    [projectId],
  );

  let verschoben = 0;
  for (const row of rows.rows) {
    const neu =
      row.task_start === null
        ? null
        : decisionDueDate(
            {
              id: row.id,
              blocksTaskId: 'egal',
              leadTimeDays: row.lead_time_days,
              leadTimeUnit: row.lead_time_unit,
            },
            row.task_start,
            calendar,
          );

    if (neu === row.due_date) continue;
    verschoben += 1;
    await tx.query('update decision set due_date = $2 where id = $1', [row.id, neu]);
  }

  return verschoben;
}

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

  const updated = await tx.query<{ id: string }>(
    `update decision set ${felder.join(', ')} where id = $1 and project_id = $2 returning id`,
    werte,
  );
  if (updated.rowCount === 0) {
    // Wie überall: nicht gefunden und nicht sichtbar sehen von außen gleich aus.
    throw new HTTPException(404, {
      message: 'Diese Entscheidung gibt es in deinem Bauvorhaben nicht.',
    });
  }

  await tx.query(
    `insert into audit_log (project_id, actor_channel, action, entity_type, entity_id, meta)
     values ($1, 'app', 'decision.updated', 'decision', $2, $3)`,
    [projectId, decisionId, JSON.stringify(change)],
  );

  const result = await tx.query<DecisionRow>(
    `${SELECT_DECISIONS} `.replace('where d.project_id = $1', 'where d.project_id = $1 and d.id = $2'),
    [projectId, decisionId],
  );
  return toDecision(result.rows[0]!);
}
