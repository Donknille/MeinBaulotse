/**
 * Entscheidungen des Bauherrn (Abschnitt 3.2).
 *
 * Die Frist wird nicht gepflegt, sondern gerechnet: `due_date` ist der
 * Vorlauf vor dem Beginn des blockierten Vorgangs. Verschiebt sich der
 * Vorgang, verschiebt sich die Frist mit — das erledigt `recomputePlan`.
 * Hier steht nur, wie aus den Vorlagen die Entscheidungen eines Projekts
 * werden und wie ihr Zustand fortschreitet.
 */

import { HTTPException } from 'hono/http-exception';
import {
  decisionDueDates,
  type Calendar,
  type DurationUnit,
  type IsoDate,
  type ScheduleDecision,
} from '@meinbaulotse/schedule';
import type { Transaction } from '@meinbaulotse/db';
import type { DecisionDto, DecisionPatchRequest } from '@meinbaulotse/shared';

interface DecisionRow {
  id: string;
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
  decided_at: Date | null;
  decided_note: string | null;
  estimated_cost_cents: number | null;
}

const SELECT_DECISIONS = `
  select d.id, d.title, d.description, d.help_text,
         d.blocks_task_id, t.name as blocks_task_name, t.current_start as blocks_task_start,
         d.lead_time_days, d.lead_time_unit, d.due_date, d.status,
         d.decided_at, d.decided_note, d.estimated_cost_cents
  from decision d
  left join task t on t.id = d.blocks_task_id
  where d.project_id = $1
  order by d.due_date nulls last, d.sort_order`;

/**
 * Legt die Entscheidungen eines frischen Projekts an.
 *
 * Übergangen werden Vorlagen, deren Vorgang in diesem Plan nicht vorkommt —
 * ein Haus ohne Keller hat keine Kellerabdichtung, und eine Entscheidung ohne
 * Vorgang hätte keine Frist.
 */
export async function instantiateDecisions(
  tx: Transaction,
  projectId: string,
): Promise<number> {
  const result = await tx.query(
    `insert into decision
       (project_id, template_key, title, description, help_text,
        blocks_task_id, lead_time_days, lead_time_unit, sort_order)
     select $1, dt.key, dt.title, dt.description, dt.help_text,
            t.id, dt.lead_time_days, dt.lead_time_unit, dt.sort_order
       from decision_template dt
       join task t
         on t.project_id = $1
        and t.template_task_code = dt.blocks_task_code
     on conflict do nothing`,
    [projectId],
  );
  return result.rowCount ?? 0;
}

export async function listDecisions(
  tx: Transaction,
  projectId: string,
  calendar: Calendar,
  today: IsoDate,
): Promise<DecisionDto[]> {
  const result = await tx.query<DecisionRow>(SELECT_DECISIONS, [projectId]);

  // Die verbleibenden Werktage werden hier gerechnet und nicht gespeichert:
  // Sie ändern sich jeden Morgen, ganz ohne dass jemand etwas anfasst.
  const withTask = result.rows.filter(
    (row): row is DecisionRow & { blocks_task_start: string } => row.blocks_task_start !== null,
  );
  const decisions: ScheduleDecision[] = withTask.map((row) => ({
    id: row.id,
    blocksTaskId: row.blocks_task_id!,
    leadTimeDays: row.lead_time_days,
    leadTimeUnit: row.lead_time_unit,
  }));
  const starts = new Map(withTask.map((row) => [row.blocks_task_id!, row.blocks_task_start]));
  const due = decisionDueDates(decisions, starts, calendar, today);

  return result.rows.map((row) => {
    const computed = due.get(row.id);
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      helpText: row.help_text,
      blocksTaskId: row.blocks_task_id,
      blocksTaskName: row.blocks_task_name,
      blocksTaskStart: row.blocks_task_start,
      leadTimeDays: row.lead_time_days,
      leadTimeUnit: row.lead_time_unit,
      dueDate: row.due_date ?? computed?.dueDate ?? null,
      status: row.status,
      decidedAt: row.decided_at?.toISOString() ?? null,
      decidedNote: row.decided_note,
      estimatedCostCents: row.estimated_cost_cents,
      remainingWorkdays: computed?.remainingWorkdays ?? null,
      isOverdue: computed?.isOverdue ?? false,
    };
  });
}

export async function patchDecision(
  tx: Transaction,
  projectId: string,
  decisionId: string,
  input: DecisionPatchRequest,
  calendar: Calendar,
  today: IsoDate,
): Promise<DecisionDto> {
  const existing = await tx.query<{ status: DecisionDto['status'] }>(
    'select status from decision where project_id = $1 and id = $2',
    [projectId, decisionId],
  );
  if (existing.rowCount === 0) {
    throw new HTTPException(404, { message: 'Diese Entscheidung gibt es nicht.' });
  }

  const updated = await tx.query(
    `update decision
        set status               = coalesce($3, status),
            decided_note         = case when $4::boolean then $5 else decided_note end,
            estimated_cost_cents = case when $6::boolean then $7 else estimated_cost_cents end,
            -- Der Zeitpunkt der Entscheidung wird gesetzt, wenn sie fällt, und
            -- nicht wieder gelöscht: Ein zurückgenommener Zustand macht die
            -- Entscheidung nicht ungeschehen.
            decided_at = case
              when $3 in ('entschieden','beauftragt') and decided_at is null then now()
              else decided_at
            end
      where project_id = $1 and id = $2`,
    [
      projectId,
      decisionId,
      input.status ?? null,
      input.decidedNote !== undefined,
      input.decidedNote ?? null,
      input.estimatedCostCents !== undefined,
      input.estimatedCostCents ?? null,
    ],
  );
  if (updated.rowCount === 0) {
    throw new HTTPException(403, {
      message: 'Entscheidungen pflegt der Bauherr.',
      cause: { hint: 'Als Baubegleiter kannst du einen Vorschlag machen — sprich ihn an.' },
    });
  }

  const all = await listDecisions(tx, projectId, calendar, today);
  return all.find((entry) => entry.id === decisionId)!;
}
