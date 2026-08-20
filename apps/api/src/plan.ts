/**
 * Den Plan neu rechnen und das Ergebnis zurückschreiben.
 *
 * Gerechnet wird ausschließlich in `packages/schedule`. Diese Datei liest die
 * Ausgangslage aus der Datenbank, reicht sie an den Berechnungskern und
 * schreibt das Ergebnis zurück — sie kennt selbst weder Werktage noch
 * Feiertage.
 *
 * Die Unterscheidung, die alles trägt: Ein von Hand gesetzter Anfangstermin
 * ist eine **Beschränkung** (`pinned_start` → `earliestStart`), kein Ergebnis.
 * Deshalb überlebt er die nächste Neuberechnung, und deshalb rutscht er
 * trotzdem nach hinten, wenn ein Vorgänger ihn schiebt. Wer ohne diese
 * Trennung rechnet, wirft entweder die Eingabe des Nutzers weg oder den
 * Bauablauf.
 *
 * Gelesen wird über `mbl.plan_input` und geschrieben über `mbl.apply_plan` —
 * beide prüfen in der Datenbank, wer fragt. Der Grund steht in
 * `0004_planung.sql`: Ein Einzelgewerk sieht nur den eigenen Vorgang, aber
 * gerechnet werden muss der ganze Graph. Was dieser Anrufer am Ende zu sehen
 * bekommt, entscheidet weiterhin die RLS — `recomputePlan` gibt bewusst keine
 * Vorgangsnamen zurück, die der Aufrufer nicht ohnehin lesen darf.
 */

import {
  computeSchedule,
  criticalPath,
  decisionDueDates,
  workdayDifference,
  workdayOffset,
  type Calendar,
  type DependencyType,
  type DurationUnit,
  type FederalState,
  type IsoDate,
  type ScheduleDecision,
  type ScheduleDependency,
  type ScheduleTask,
} from '@meinbaulotse/schedule';
import type { Transaction } from '@meinbaulotse/db';
import type { ShiftedTask } from '@meinbaulotse/shared';

export interface PlanContext {
  projectId: string;
  calendar: Calendar;
  projectStart: IsoDate;
  contractualEnd: IsoDate | null;
}

interface TaskRow {
  id: string;
  name: string;
  trade_code: string | null;
  duration_days: number;
  duration_unit: DurationUnit;
  is_milestone: boolean;
  is_wait: boolean;
  pinned_start: string | null;
  actual_start: string | null;
  actual_end: string | null;
  current_start: string | null;
  current_end: string | null;
}

export interface PlanSnapshot {
  /** Termine, wie sie vor der Rechnung in der Datenbank standen. */
  before: Map<string, { start: string | null; end: string | null; name: string }>;
  computedEnd: string | null;
}

export interface RecomputeResult {
  computedEndBefore: string | null;
  computedEndAfter: string | null;
  /** Positiv: das Bauende rutscht nach hinten. */
  endShiftWorkdays: number;
  /** Alle Vorgänge, deren Termine sich bewegt haben. */
  shifted: ShiftedTask[];
}

export async function loadPlanContext(tx: Transaction, projectId: string): Promise<PlanContext> {
  const result = await tx.query<{
    federal_state: FederalState;
    catholic_municipality: boolean;
    planned_start: string;
    contractual_completion: string | null;
  }>(
    `select federal_state, catholic_municipality, planned_start, contractual_completion
     from project where id = $1`,
    [projectId],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error('Dieses Projekt gibt es nicht.');
  }
  return {
    projectId,
    calendar: {
      federalState: row.federal_state,
      catholicMunicipality: row.catholic_municipality,
    },
    projectStart: row.planned_start,
    contractualEnd: row.contractual_completion,
  };
}

async function loadRows(tx: Transaction, projectId: string): Promise<TaskRow[]> {
  const result = await tx.query<TaskRow>('select * from mbl.plan_input($1)', [projectId]);
  return result.rows;
}

async function loadDependencies(
  tx: Transaction,
  projectId: string,
): Promise<ScheduleDependency[]> {
  const result = await tx.query<{
    predecessor_id: string;
    successor_id: string;
    type: DependencyType;
    lag_days: number;
    lag_unit: DurationUnit;
  }>('select * from mbl.plan_dependencies($1)', [projectId]);
  return result.rows.map((row) => ({
    predecessorId: row.predecessor_id,
    successorId: row.successor_id,
    type: row.type,
    lagDays: row.lag_days,
    lagUnit: row.lag_unit,
  }));
}

function toScheduleTask(row: TaskRow): ScheduleTask {
  return {
    id: row.id,
    durationDays: row.duration_days,
    durationUnit: row.duration_unit,
    isMilestone: row.is_milestone,
    isWait: row.is_wait,
    ...(row.trade_code === null ? {} : { tradeCode: row.trade_code }),
    ...(row.actual_start === null ? {} : { actualStart: row.actual_start }),
    ...(row.actual_end === null ? {} : { actualEnd: row.actual_end }),
    ...(row.pinned_start === null ? {} : { earliestStart: row.pinned_start }),
  };
}

/** Der Zustand vor der Rechnung — Bezugspunkt für „was hat sich bewegt". */
export function snapshotOf(rows: readonly TaskRow[]): PlanSnapshot {
  const before = new Map<string, { start: string | null; end: string | null; name: string }>();
  let computedEnd: string | null = null;
  for (const row of rows) {
    before.set(row.id, { start: row.current_start, end: row.current_end, name: row.name });
    if (row.current_end !== null && (computedEnd === null || row.current_end > computedEnd)) {
      computedEnd = row.current_end;
    }
  }
  return { before, computedEnd };
}

/**
 * Rechnet den Plan des Projekts neu und schreibt die abgeleiteten Felder
 * zurück. Rückgabe ist, was sich bewegt hat — daraus wird die Rückmeldung an
 * den Nutzer, nicht aus einer Vermutung.
 */
export async function recomputePlan(
  tx: Transaction,
  context: PlanContext,
): Promise<RecomputeResult> {
  const rows = await loadRows(tx, context.projectId);
  const snapshot = snapshotOf(rows);

  if (rows.length === 0) {
    return {
      computedEndBefore: null,
      computedEndAfter: null,
      endShiftWorkdays: 0,
      shifted: [],
    };
  }

  const tasks = rows.map(toScheduleTask);
  const dependencies = await loadDependencies(tx, context.projectId);

  const schedule = computeSchedule({
    tasks,
    dependencies,
    calendar: context.calendar,
    projectStart: context.projectStart,
  });

  const floats = criticalPath({
    tasks,
    dependencies,
    calendar: context.calendar,
    schedule,
    floatsAgainst: 'plan',
    ...(context.contractualEnd === null ? {} : { contractualEnd: context.contractualEnd }),
  });

  const taskPayload = rows.map((row) => {
    const computed = schedule.tasks.get(row.id)!;
    const float = floats.floats.get(row.id);
    return {
      id: row.id,
      current_start: computed.start,
      current_end: computed.end,
      total_float_days: float?.totalFloatDays ?? null,
      is_critical: float?.isCritical ?? false,
    };
  });

  // Entscheidungsfristen hängen am Beginn des blockierten Vorgangs. Verschiebt
  // sich der Vorgang, verschiebt sich die Frist mit — Abschnitt 3.2.
  const decisionPayload = await recomputeDecisionDueDates(tx, context, schedule.tasks);

  await tx.query('select mbl.apply_plan($1, $2::jsonb, $3::jsonb)', [
    context.projectId,
    JSON.stringify(taskPayload),
    JSON.stringify(decisionPayload),
  ]);

  const shifted: ShiftedTask[] = [];
  for (const row of rows) {
    const previous = snapshot.before.get(row.id)!;
    const computed = schedule.tasks.get(row.id)!;
    if (previous.start === computed.start && previous.end === computed.end) continue;
    shifted.push({
      id: row.id,
      name: row.name,
      fromStart: previous.start,
      toStart: computed.start,
      fromEnd: previous.end,
      toEnd: computed.end,
    });
  }

  const computedEndAfter = schedule.projectEnd;
  return {
    computedEndBefore: snapshot.computedEnd,
    computedEndAfter,
    endShiftWorkdays: endShift(snapshot.computedEnd, computedEndAfter, context.calendar),
    shifted,
  };
}

/**
 * Abstand zweier Endtermine in Werktagen.
 *
 * `workdayDifference` zählt von Werktag zu Werktag; die Enden selbst können
 * auf einen Samstag fallen, wenn eine Trocknungszeit dort ausläuft. Deshalb
 * wird jeweils auf den nächsten Werktag normiert — dieselbe Behandlung wie
 * bei der Abweichung vom geschuldeten Termin in `app.ts`.
 */
function endShift(before: string | null, after: string | null, calendar: Calendar): number {
  if (before === null || after === null) return 0;
  return workdayDifference(
    workdayOffset(before, 1, calendar),
    workdayOffset(after, 1, calendar),
    calendar,
  );
}

async function recomputeDecisionDueDates(
  tx: Transaction,
  context: PlanContext,
  scheduled: ReadonlyMap<string, { start: IsoDate }>,
): Promise<Array<{ id: string; due_date: string | null }>> {
  const result = await tx.query<{
    id: string;
    blocks_task_id: string | null;
    lead_time_days: number;
    lead_time_unit: DurationUnit;
  }>('select * from mbl.plan_decisions($1)', [context.projectId]);
  if (result.rowCount === 0) return [];

  const decisions: ScheduleDecision[] = result.rows.map((row) => ({
    id: row.id,
    blocksTaskId: row.blocks_task_id!,
    leadTimeDays: row.lead_time_days,
    leadTimeUnit: row.lead_time_unit,
  }));

  const starts = new Map<string, IsoDate>();
  for (const [id, task] of scheduled) starts.set(id, task.start);

  const due = decisionDueDates(decisions, starts, context.calendar);
  return result.rows.map((row) => ({
    id: row.id,
    due_date: due.get(row.id)?.dueDate ?? null,
  }));
}
