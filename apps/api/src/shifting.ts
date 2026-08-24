/**
 * Verschieben mit Vorschlag — Abschnitt 3.5 der Spezifikation.
 *
 * Bis hierher war eine Verschiebung ein Sprung ins Dunkle: Man trug einen
 * neuen Termin ein und sah hinterher, was daraus geworden war. Punkt 6 der
 * Spezifikation verlangt das Gegenteil — die betroffenen Folgevorgänge werden
 * **vorher** als Vorschlag angezeigt, und sie sind einzeln entkoppelbar.
 *
 * Deshalb führen zwei Wege zur selben Rechnung:
 *
 * - `previewShift` rechnet und schreibt nichts.
 * - `applyShift` rechnet dasselbe, schreibt das Ergebnis und hält die
 *   Auswirkung auf den Endtermin in der Historie fest.
 *
 * Dass beide dieselbe Funktion im Berechnungskern benutzen, ist kein Detail:
 * Eine Vorschau, die etwas anderes zeigt als das, was hinterher passiert, ist
 * schlimmer als gar keine.
 */

import { HTTPException } from 'hono/http-exception';
import {
  decisionDueDate,
  proposeShift,
  type ScheduleTask,
  type ShiftProposal,
} from '@meinbaulotse/schedule';
import type { Transaction } from '@meinbaulotse/db';
import type { ShiftPreview, TaskUpdateRequest } from '@meinbaulotse/shared';
import { loadPlan, type LoadedPlan } from './scheduling.js';

type Tx = Pick<Transaction, 'query'>;

/**
 * Die beabsichtigte Änderung auf die Vorgangsliste anwenden — im Speicher.
 *
 * Nur die drei Felder, die einen Termin bewegen. `status` ist eine
 * Einschätzung und verschiebt nichts; `reason` beschreibt die Änderung, statt
 * sie zu sein.
 */
function withChange(
  tasks: readonly ScheduleTask[],
  taskId: string,
  change: TaskUpdateRequest,
): ScheduleTask[] {
  return tasks.map((task) => {
    if (task.id !== taskId) return task;
    const next: ScheduleTask = { ...task };

    if (change.earliestStart !== undefined) {
      if (change.earliestStart === null) delete next.earliestStart;
      else next.earliestStart = change.earliestStart;
    }
    if (change.actualStart !== undefined) {
      if (change.actualStart === null) delete next.actualStart;
      else next.actualStart = change.actualStart;
    }
    if (change.actualEnd !== undefined) {
      if (change.actualEnd === null) delete next.actualEnd;
      else next.actualEnd = change.actualEnd;
    }
    return next;
  });
}

interface DecisionRow {
  id: string;
  title: string;
  blocks_task_id: string | null;
  lead_time_days: number;
  lead_time_unit: 'werktage' | 'kalendertage';
  due_date: string | null;
}

async function loadDecisionRows(tx: Tx, projectId: string): Promise<DecisionRow[]> {
  const result = await tx.query<DecisionRow>(
    `select id, title, blocks_task_id, lead_time_days, lead_time_unit, due_date
       from decision where project_id = $1 and blocks_task_id is not null`,
    [projectId],
  );
  return result.rows;
}

export interface Proposal {
  plan: LoadedPlan;
  core: ShiftProposal;
  preview: ShiftPreview;
}

/**
 * Rechnet die Verschiebung durch, ohne etwas zu schreiben.
 *
 * Gibt neben der Vorschau auch den geladenen Plan und das rohe Ergebnis des
 * Kerns zurück — `applyShift` braucht beides und soll nicht ein zweites Mal
 * lesen und rechnen müssen.
 */
export async function buildProposal(
  tx: Tx,
  projectId: string,
  taskId: string,
  change: TaskUpdateRequest,
): Promise<Proposal> {
  const plan = await loadPlan(tx, projectId);

  const betroffen = plan.rows.find((row) => row.id === taskId);
  if (betroffen === undefined) {
    // Wie überall: Ob es diesen Vorgang gibt, geht Fremde nichts an.
    throw new HTTPException(404, {
      message: 'Diesen Vorgang gibt es in deinem Bauvorhaben nicht.',
    });
  }

  const core = proposeShift({
    tasks: plan.tasks,
    changed: withChange(plan.tasks, taskId, change),
    dependencies: plan.dependencies,
    calendar: plan.calendar,
    projectStart: plan.projectStart,
    triggerTaskId: taskId,
    ...(change.decouple === undefined ? {} : { decouple: change.decouple }),
  });

  const nameOf = new Map(plan.rows.map((row) => [row.id, row.name]));
  const criticalOf = new Map(plan.rows.map((row) => [row.id, row.is_critical]));
  const benenne = (eintrag: ShiftProposal['affected'][number]) => ({
    taskId: eintrag.taskId,
    name: nameOf.get(eintrag.taskId) ?? 'Vorgang',
    fromStart: eintrag.fromStart,
    fromEnd: eintrag.fromEnd,
    toStart: eintrag.toStart,
    toEnd: eintrag.toEnd,
    shiftWorkdays: eintrag.shiftWorkdays,
    isCritical: criticalOf.get(eintrag.taskId) ?? false,
  });

  // Was sich für den Bauherren ändert, sind selten die Termine — es sind die
  // Fristen davor. Deshalb steht in der Vorschau, welche Entscheidung
  // mitwandert und wohin.
  const entscheidungen = await loadDecisionRows(tx, projectId);
  const decisions = entscheidungen
    .map((row) => {
      const nachher = core.after.tasks.get(row.blocks_task_id!);
      const neu =
        nachher === undefined
          ? null
          : decisionDueDate(
              {
                id: row.id,
                blocksTaskId: row.blocks_task_id!,
                leadTimeDays: row.lead_time_days,
                leadTimeUnit: row.lead_time_unit,
              },
              nachher.start,
              plan.calendar,
            );
      return { id: row.id, title: row.title, fromDueDate: row.due_date, toDueDate: neu };
    })
    .filter((eintrag) => eintrag.fromDueDate !== eintrag.toDueDate);

  const overlaps = core.lagAdjustments.map((eintrag) => ({
    predecessorName: nameOf.get(eintrag.predecessorId) ?? 'Vorgang',
    successorName: nameOf.get(eintrag.successorId) ?? 'Vorgang',
    workdays: Math.abs(eintrag.toLagDays),
  }));

  return {
    plan,
    core,
    preview: {
      taskId,
      taskName: betroffen.name,
      trigger: core.trigger === null ? null : benenne(core.trigger),
      affected: core.affected.map(benenne),
      decoupled: core.decoupled.map((taskId) => ({
        taskId,
        name: nameOf.get(taskId) ?? 'Vorgang',
      })),
      decisions,
      overlaps,
      computedEndBefore: core.projectEndBefore,
      computedEndAfter: core.projectEndAfter,
      effectWorkdays: core.effectWorkdays,
    },
  };
}

/**
 * Schreibt fest, was die Verschiebung den Endtermin kostet.
 *
 * Muss vor der Änderung geschehen: Der Trigger `mbl.log_task_change` liest den
 * Wert, wenn er den Historieneintrag schreibt, und `schedule_change` ist
 * danach nicht mehr änderbar. Deshalb steht die Vorausrechnung überhaupt am
 * Anfang dieses Ablaufs und nicht am Ende.
 */
export async function stampChangeEffect(tx: Tx, effectWorkdays: number): Promise<void> {
  await tx.query('select set_config($1, $2, true)', [
    'app.change_effect_days',
    String(effectWorkdays),
  ]);
}

/**
 * Schreibt die Entkopplungen: Anfangsbeschränkung und überlappender Vorlauf.
 *
 * Beides sind Aussagen über den Bau, keine technischen Hilfsmittel — deshalb
 * bekommt die Änderung am Vorlauf auch einen eigenen Historieneintrag. Sonst
 * stünde später eine Überlappung im Plan, die niemand erklären kann.
 */
export async function applyDecoupling(
  tx: Tx,
  projectId: string,
  proposal: Proposal,
): Promise<void> {
  const { core } = proposal;
  if (core.decoupled.length === 0) return;

  for (const { taskId, earliestStart } of core.pinnedStarts) {
    await tx.query('update task set earliest_start = $3 where id = $1 and project_id = $2', [
      taskId,
      projectId,
      earliestStart,
    ]);
  }

  for (const anpassung of core.lagAdjustments) {
    const result = await tx.query(
      `update dependency
          set lag_days = $4
        where project_id = $1 and predecessor_id = $2 and successor_id = $3`,
      [projectId, anpassung.predecessorId, anpassung.successorId, anpassung.toLagDays],
    );
    if (result.rowCount === 0) continue;

    await tx.query(
      `insert into schedule_change
         (project_id, task_id, field, old_value, new_value,
          actor_member_id, actor_role, actor_channel, reason_code, reason_text)
       values ($1, $2, 'dependency_lag', to_jsonb($3::int), to_jsonb($4::int),
               mbl.current_member_id($1), mbl.member_role($1), mbl.actor_channel(),
               'planungsaenderung', $5)`,
      [
        projectId,
        anpassung.successorId,
        anpassung.fromLagDays,
        anpassung.toLagDays,
        `Entkoppelt: überlappt jetzt mit dem Vorgänger.`,
      ],
    );
  }
}
