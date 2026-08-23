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
  daysBetween,
  decisionDueDate,
  workdayDifference,
  type Calendar,
  type FederalState,
  type ScheduleDependency,
  type ScheduleTask,
} from '@meinbaulotse/schedule';
import { HTTPException } from 'hono/http-exception';
import type { Transaction } from '@meinbaulotse/db';
import type { SchedulePreview } from '@meinbaulotse/shared';
import { recomputeDecisionDueDates } from './decisions.js';

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
    // Entkoppelte Kanten bleiben in der Tabelle stehen, aber sie rechnen
    // nicht mehr mit (Abschnitt 3.5, Punkt 6). Der Filter steht hier und
    // nicht im Berechnungskern: Der Kern kennt keine Datenbank und soll von
    // dieser Unterscheidung nichts wissen — er bekommt einen Graphen, und
    // welche Kanten darin sind, entscheidet der Aufrufer.
    `select predecessor_id, successor_id, type, lag_days, lag_unit
     from dependency where project_id = $1 and decoupled_at is null`,
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
  /**
   * Wie viele Entscheidungsfristen mitgewandert sind.
   *
   * Das ist die Zahl, die den Bauherrn wirklich betrifft. „Sieben Vorgänge
   * verschoben" ist eine Auskunft über den Plan; „zwei Fristen sind enger
   * geworden" ist eine Aufforderung an ihn.
   */
  movedDecisions: number;
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

  // Schritt 8 aus Abschnitt 3.5: Entscheidungsfristen neu rechnen. Er steht
  // dort zuletzt und ist trotzdem der wichtigste — ohne ihn ist eine
  // Verschiebung für den Bauherrn folgenlos, bis es zu spät ist.
  const movedDecisions = await recomputeDecisionDueDates(tx, projectId, plan.calendar);

  return {
    movedTasks,
    movedDecisions,
    computedEnd: schedule.projectEnd,
    deviationWorkdays: plan.contractualEnd === null ? null : floats.deviationWorkdays,
  };
}

/**
 * Was eine Änderung bewirken würde, ohne sie zu tun.
 *
 * Abschnitt 3.5.6 verlangt, betroffene Folgevorgänge „als Vorschlag" zu
 * zeigen. Das ist mehr als Höflichkeit: Eine Verschiebung um drei Tage, die
 * sieben Gewerke nachzieht und den Endtermin kostet, ist eine andere
 * Entscheidung als eine, die im Puffer verschwindet — und der Unterschied ist
 * dem Plan nicht anzusehen, solange man nicht gerechnet hat.
 *
 * Gerechnet wird vollständig im Speicher. Es wird nichts geschrieben, keine
 * Transaktion zurückgerollt und nichts protokolliert: Eine Vorschau, die
 * Spuren hinterlässt, wäre in einer append-only-Historie ein Problem.
 */
export async function previewChange(
  tx: Tx,
  projectId: string,
  taskId: string,
  change: {
    earliestStart?: string | null;
    actualStart?: string | null;
    actualEnd?: string | null;
  },
): Promise<SchedulePreview> {
  const plan = await loadPlan(tx, projectId);
  const namen = await tx.query<{ id: string; name: string }>(
    'select id, name from task where project_id = $1',
    [projectId],
  );
  const nameById = new Map(namen.rows.map((row) => [row.id, row.name]));

  if (!nameById.has(taskId)) {
    throw new HTTPException(404, {
      message: 'Diesen Vorgang gibt es in deinem Bauvorhaben nicht.',
    });
  }

  const angepasst = plan.tasks.map((task) => {
    if (task.id !== taskId) return task;
    const kopie = { ...task };
    // `undefined` heißt „dazu sage ich nichts", `null` heißt „wegnehmen".
    if (change.earliestStart !== undefined) {
      if (change.earliestStart === null) delete kopie.earliestStart;
      else kopie.earliestStart = change.earliestStart;
    }
    if (change.actualStart !== undefined) {
      if (change.actualStart === null) delete kopie.actualStart;
      else kopie.actualStart = change.actualStart;
    }
    if (change.actualEnd !== undefined) {
      if (change.actualEnd === null) delete kopie.actualEnd;
      else kopie.actualEnd = change.actualEnd;
    }
    return kopie;
  });

  const neu = computeSchedule({
    tasks: angepasst,
    dependencies: plan.dependencies,
    calendar: plan.calendar,
    projectStart: plan.projectStart,
  });

  const bewegt: SchedulePreview['tasks'] = [];
  for (const row of plan.rows) {
    const nachher = neu.tasks.get(row.id)!;
    if (row.current_start === nachher.start && row.current_end === nachher.end) continue;
    bewegt.push({
      id: row.id,
      name: nameById.get(row.id) ?? 'Vorgang',
      fromStart: row.current_start,
      toStart: nachher.start,
      fromEnd: row.current_end,
      toEnd: nachher.end,
      shiftDays:
        row.current_start === null ? 0 : daysBetween(row.current_start, nachher.start),
      viaDependencies: [],
    });
  }

  // Über welche Kanten die Vorgänge mitgezogen werden (Abschnitt 3.5,
  // Punkt 6).
  //
  // Gezählt wird die eingehende Kante, deren Vorgänger sich ebenfalls bewegt:
  // Sie ist der Weg, auf dem die Verschiebung ankommt. Eine Kante von einem
  // Vorgang, der stehen bleibt, zieht nichts — sie zu lösen brächte nichts
  // und stünde nur im Weg.
  const bewegteIds = new Set(bewegt.map((eintrag) => eintrag.id));
  bewegteIds.add(taskId);
  const kanten = await tx.query<{
    id: string;
    predecessor_id: string;
    successor_id: string;
    type: 'FS' | 'SS' | 'FF';
    lag_days: number;
  }>(
    `select id, predecessor_id, successor_id, type, lag_days
       from dependency where project_id = $1 and decoupled_at is null`,
    [projectId],
  );

  const nachId = new Map(bewegt.map((eintrag) => [eintrag.id, eintrag]));
  for (const kante of kanten.rows) {
    if (!bewegteIds.has(kante.predecessor_id)) continue;
    const ziel = nachId.get(kante.successor_id);
    if (ziel === undefined) continue;
    ziel.viaDependencies.push({
      id: kante.id,
      predecessorId: kante.predecessor_id,
      predecessorName: nameById.get(kante.predecessor_id) ?? 'Vorgang',
      type: kante.type,
      lagDays: kante.lag_days,
    });
  }

  // Die Fristen, die mitwandern. Sie sind der Grund, warum eine Verschiebung
  // den Bauherrn überhaupt betrifft.
  const entscheidungen = await tx.query<{
    id: string;
    title: string;
    due_date: string | null;
    lead_time_days: number;
    lead_time_unit: 'werktage' | 'kalendertage';
    blocks_task_id: string | null;
  }>(
    `select id, title, due_date, lead_time_days, lead_time_unit, blocks_task_id
       from decision
      where project_id = $1 and blocks_task_id is not null
        and status in ('offen','in_bemusterung')`,
    [projectId],
  );

  const fristen: SchedulePreview['decisions'] = [];
  for (const row of entscheidungen.rows) {
    const nachher = neu.tasks.get(row.blocks_task_id!);
    if (nachher === undefined) continue;
    const neueFrist = decisionDueDate(
      {
        id: row.id,
        blocksTaskId: row.blocks_task_id!,
        leadTimeDays: row.lead_time_days,
        leadTimeUnit: row.lead_time_unit,
      },
      nachher.start,
      plan.calendar,
    );
    if (neueFrist === row.due_date) continue;
    fristen.push({
      id: row.id,
      title: row.title,
      fromDueDate: row.due_date,
      toDueDate: neueFrist,
    });
  }

  const vorherEnde = plan.rows
    .map((row) => row.current_end)
    .filter((end): end is string => end !== null)
    .reduce<string | null>((a, b) => (a === null || b > a ? b : a), null);

  return {
    taskId,
    tasks: bewegt,
    decisions: fristen,
    previousEnd: vorherEnde,
    computedEnd: neu.projectEnd,
    endShiftWorkdays:
      vorherEnde === null ? 0 : workdayDifference(vorherEnde, neu.projectEnd, plan.calendar),
    deviationWorkdays:
      plan.contractualEnd === null
        ? null
        : workdayDifference(plan.contractualEnd, neu.projectEnd, plan.calendar),
  };
}
