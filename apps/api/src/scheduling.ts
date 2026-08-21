/**
 * Neuberechnung eines Bauvorhabens nach einer Änderung.
 *
 * Der Berechnungskern konnte das von Anfang an, die Anwendung hat es nur nie
 * benutzt: Bis hierher entstand ein Plan genau einmal, beim Onboarding, und
 * war danach ein Bild an der Wand. Diese Datei macht ihn wieder rechenbar.
 *
 * Die Zuständigkeiten bleiben getrennt, und das ist der Punkt:
 *
 * - `packages/schedule` rechnet. Keine Datenbank, keine Uhrzeit, keine
 *   Abhängigkeiten (Regel 3). Es bekommt Vorgänge, Beziehungen, Kalender und
 *   Baustart herein und gibt Termine heraus.
 * - Diese Datei holt die Zahlen aus der Datenbank, reicht sie hinein und
 *   schreibt das Ergebnis zurück.
 * - Die Historie schreibt niemand von Hand. Der Trigger `mbl.log_task_change`
 *   hängt an jeder Terminänderung und macht daraus einen Eintrag in
 *   `schedule_change` — mit dem Grund, der als `app.change_reason` in der
 *   Transaktion steht.
 *
 * Zurückgeschrieben wird nur, was sich wirklich geändert hat. Ein `update` auf
 * unveränderte Werte wäre nicht falsch — der Trigger prüft `is distinct from`
 * —, aber 38 überflüssige Anweisungen je Verschiebung wären es auch nicht wert.
 */

import {
  computeSchedule,
  criticalPath,
  type Calendar,
  type FederalState,
  type ScheduleDependency,
  type ScheduleTask,
} from '@meinbaulotse/schedule';
import { HTTPException } from 'hono/http-exception';
import type { Transaction } from '@meinbaulotse/db';

type Tx = Pick<Transaction, 'query'>;

interface TaskRow {
  id: string;
  duration_days: number;
  duration_unit: 'werktage' | 'kalendertage';
  is_milestone: boolean;
  is_wait: boolean;
  trade_code: string | null;
  earliest_start: string | null;
  actual_start: string | null;
  actual_end: string | null;
  current_start: string | null;
  current_end: string | null;
  total_float_days: number | null;
  is_critical: boolean;
}

/**
 * Der Zustand eines Bauvorhabens, so wie ihn der Berechnungskern braucht.
 *
 * `null` aus der Datenbank wird zu `undefined`, weil der Kern zwischen „nicht
 * gesetzt" und „auf null gesetzt" nicht unterscheidet — er kennt nur
 * vorhanden oder nicht.
 */
async function loadPlan(
  tx: Tx,
  projectId: string,
): Promise<{
  rows: TaskRow[];
  tasks: ScheduleTask[];
  dependencies: ScheduleDependency[];
  calendar: Calendar;
  projectStart: string;
  contractualEnd: string | null;
}> {
  const project = await tx.query<{
    federal_state: FederalState;
    catholic_municipality: boolean;
    planned_start: string;
    contractual_completion: string | null;
  }>(
    `select federal_state, catholic_municipality, planned_start, contractual_completion
     from project where id = $1`,
    [projectId],
  );
  const head = project.rows[0];
  if (head === undefined) {
    // Kein Fund heißt hier nie „gibt es nicht", sondern „du siehst es nicht" —
    // die RLS blendet fremde Projekte aus, statt sie zu verweigern.
    throw new HTTPException(404, { message: 'Dieses Bauvorhaben gibt es nicht.' });
  }

  const tasks = await tx.query<TaskRow>(
    `select t.id, t.duration_days, t.duration_unit, t.is_milestone, t.is_wait,
            tr.code as trade_code, t.earliest_start, t.actual_start, t.actual_end,
            t.current_start, t.current_end, t.total_float_days, t.is_critical
     from task t
     left join trade tr on tr.id = t.trade_id
     where t.project_id = $1
     order by t.sort_order`,
    [projectId],
  );

  const dependencies = await tx.query<{
    predecessor_id: string;
    successor_id: string;
    type: 'FS' | 'SS' | 'FF';
    lag_days: number;
    lag_unit: 'werktage' | 'kalendertage';
  }>(
    `select predecessor_id, successor_id, type, lag_days, lag_unit
     from dependency where project_id = $1`,
    [projectId],
  );

  return {
    rows: tasks.rows,
    tasks: tasks.rows.map((row) => ({
      id: row.id,
      durationDays: row.duration_days,
      durationUnit: row.duration_unit,
      isMilestone: row.is_milestone,
      isWait: row.is_wait,
      ...(row.trade_code === null ? {} : { tradeCode: row.trade_code }),
      ...(row.earliest_start === null ? {} : { earliestStart: row.earliest_start }),
      ...(row.actual_start === null ? {} : { actualStart: row.actual_start }),
      ...(row.actual_end === null ? {} : { actualEnd: row.actual_end }),
    })),
    dependencies: dependencies.rows.map((row) => ({
      predecessorId: row.predecessor_id,
      successorId: row.successor_id,
      type: row.type,
      lagDays: row.lag_days,
      lagUnit: row.lag_unit,
    })),
    calendar: {
      federalState: head.federal_state,
      catholicMunicipality: head.catholic_municipality,
    },
    projectStart: head.planned_start,
    contractualEnd: head.contractual_completion,
  };
}

export interface Recomputation {
  /** Wie viele Vorgänge sich tatsächlich verschoben haben. */
  movedTasks: number;
  computedEnd: string;
  /** Positiv heißt: später fertig als geschuldet. `null` ohne Vertragstermin. */
  deviationWorkdays: number | null;
}

/**
 * Rechnet das Bauvorhaben neu und schreibt das Ergebnis zurück.
 *
 * Aufzurufen innerhalb der Transaktion, die auch die Änderung geschrieben hat —
 * dann steht der Grund noch als `app.change_reason` bereit und landet in
 * jedem erzeugten Historieneintrag.
 */
export async function recomputeProject(tx: Tx, projectId: string): Promise<Recomputation> {
  const plan = await loadPlan(tx, projectId);
  if (plan.tasks.length === 0) {
    throw new HTTPException(409, {
      message: 'Dieses Bauvorhaben hat noch keine Vorgänge.',
    });
  }

  const schedule = computeSchedule({
    tasks: plan.tasks,
    dependencies: plan.dependencies,
    calendar: plan.calendar,
    projectStart: plan.projectStart,
  });

  const floats = criticalPath({
    tasks: plan.tasks,
    dependencies: plan.dependencies,
    calendar: plan.calendar,
    schedule,
    // Der Puffer misst gegen den eigenen Plan, die Abweichung gegen den
    // Vertrag. Zwei Zahlen, zwei Fragen — siehe backward-pass.ts.
    floatsAgainst: 'plan',
    ...(plan.contractualEnd === null ? {} : { contractualEnd: plan.contractualEnd }),
  });

  let movedTasks = 0;
  for (const row of plan.rows) {
    const scheduled = schedule.tasks.get(row.id)!;
    const float = floats.floats.get(row.id);
    const nextFloat = float?.totalFloatDays ?? null;
    const nextCritical = float?.isCritical ?? false;

    const termineGleich =
      row.current_start === scheduled.start && row.current_end === scheduled.end;
    if (termineGleich && row.total_float_days === nextFloat && row.is_critical === nextCritical) {
      continue;
    }
    if (!termineGleich) movedTasks += 1;

    await tx.query(
      `update task
          set current_start = $2, current_end = $3,
              total_float_days = $4, is_critical = $5
        where id = $1`,
      [row.id, scheduled.start, scheduled.end, nextFloat, nextCritical],
    );
  }

  return {
    movedTasks,
    computedEnd: schedule.projectEnd,
    deviationWorkdays: plan.contractualEnd === null ? null : floats.deviationWorkdays,
  };
}
