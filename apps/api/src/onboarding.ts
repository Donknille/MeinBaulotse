/**
 * Aus fünf Antworten wird ein vollständiger Terminplan.
 *
 * Der Ablauf ist bewusst geradlinig: Vorlage aus der Datenbank lesen, mit dem
 * Berechnungskern instanziieren und durchrechnen, das Ergebnis in einer
 * Transaktion schreiben. Gerechnet wird ausschließlich in `packages/schedule`;
 * diese Datei kennt keine Werktagslogik.
 */

import {
  computeSchedule,
  criticalPath,
  instantiateTemplate,
  type Calendar,
  type DependencyType,
  type DurationUnit,
  type IncludeWhen,
  type PlanTemplate,
} from '@meinbaulotse/schedule';
import type { JwtClaims, Transaction } from '@meinbaulotse/db';
import type { OnboardingRequest } from '@meinbaulotse/shared';

/**
 * In Stufe 1 gibt es genau eine Vorlage. Fertighaus und Sanierung greifen
 * darauf zurück; die Oberfläche sagt das offen, statt einen Plan vorzugaukeln,
 * der für diese Bauweise nicht gedacht ist.
 */
export const DEFAULT_TEMPLATE_KEY = 'efh_massiv_unterkellert';

export async function loadTemplate(tx: Transaction, key: string): Promise<PlanTemplate> {
  const header = await tx.query<{ key: string; name: string }>(
    'select key, name from plan_template where key = $1',
    [key],
  );
  if (header.rowCount === 0) {
    throw new Error(`Ablaufvorlage ${key} ist nicht hinterlegt.`);
  }

  const tasks = await tx.query<{
    code: string;
    name: string;
    trade_code: string | null;
    phase_key: string;
    duration_days: number;
    duration_unit: DurationUnit;
    is_milestone: boolean;
    is_wait: boolean;
    include_when: IncludeWhen;
    sort_order: number;
  }>(
    `select code, name, trade_code, phase_key, duration_days, duration_unit,
            is_milestone, is_wait, include_when, sort_order
     from plan_template_task where template_key = $1 order by sort_order`,
    [key],
  );

  const dependencies = await tx.query<{
    predecessor_code: string;
    successor_code: string;
    type: DependencyType;
    lag_days: number;
    lag_unit: DurationUnit;
  }>(
    `select predecessor_code, successor_code, type, lag_days, lag_unit
     from plan_template_dependency where template_key = $1`,
    [key],
  );

  return {
    key: header.rows[0]!.key,
    name: header.rows[0]!.name,
    tasks: tasks.rows.map((row) => ({
      code: row.code,
      name: row.name,
      phaseKey: row.phase_key,
      durationDays: row.duration_days,
      durationUnit: row.duration_unit,
      isMilestone: row.is_milestone,
      isWait: row.is_wait,
      includeWhen: row.include_when,
      sortOrder: row.sort_order,
      ...(row.trade_code === null ? {} : { tradeCode: row.trade_code }),
    })),
    dependencies: dependencies.rows.map((row) => ({
      predecessorCode: row.predecessor_code,
      successorCode: row.successor_code,
      type: row.type,
      lagDays: row.lag_days,
      lagUnit: row.lag_unit,
    })),
  };
}

export interface OnboardingResult {
  projectId: string;
  taskCount: number;
  dependencyCount: number;
  computedEnd: string;
  deviationWorkdays: number | null;
}

export async function createProjectFromAnswers(
  tx: Transaction,
  claims: JwtClaims,
  answers: OnboardingRequest,
): Promise<OnboardingResult> {
  const template = await loadTemplate(tx, DEFAULT_TEMPLATE_KEY);
  const plan = instantiateTemplate(template, { hasBasement: answers.hasBasement });

  const calendar: Calendar = {
    federalState: answers.federalState,
    catholicMunicipality: answers.catholicMunicipality ?? false,
  };

  const schedule = computeSchedule({
    tasks: plan.tasks,
    dependencies: plan.dependencies,
    calendar,
    projectStart: answers.plannedStart,
  });

  const floats = criticalPath({
    tasks: plan.tasks,
    dependencies: plan.dependencies,
    calendar,
    schedule,
    ...(answers.contractualCompletion === undefined
      ? {}
      : { contractualEnd: answers.contractualCompletion }),
  });

  const project = await tx.query<{ id: string }>(
    `insert into project (
       name, federal_state, catholic_municipality, build_type, contract_type,
       has_basement, plan_template_key, planned_start, contractual_completion, created_by
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     returning id`,
    [
      answers.name,
      answers.federalState,
      answers.catholicMunicipality ?? false,
      answers.buildType,
      answers.contractType,
      answers.hasBasement,
      template.key,
      answers.plannedStart,
      answers.contractualCompletion ?? null,
      claims.sub,
    ],
  );
  const projectId = project.rows[0]!.id;

  // Der Bauherr muss vor den Vorgängen eingetragen sein: Erst dadurch greift
  // sein Schreibrecht, und erst dadurch kann der Historien-Trigger den
  // Verursacher benennen.
  await tx.query(
    `insert into project_member (project_id, user_id, role, display_name, email, accepted_at)
     values ($1, $2, 'owner', $3, $4, now())`,
    [
      projectId,
      claims.sub,
      typeof claims['name'] === 'string' ? claims['name'] : null,
      typeof claims.email === 'string' ? claims.email : null,
    ],
  );

  const trades = await tx.query<{ id: string; code: string }>(
    'select id, code from trade where project_id is null',
  );
  const tradeIdByCode = new Map(trades.rows.map((row) => [row.code, row.id]));

  const idByCode = new Map<string, string>();
  for (const task of plan.tasks) {
    const scheduled = schedule.tasks.get(task.id)!;
    const float = floats.floats.get(task.id);
    const inserted = await tx.query<{ id: string }>(
      `insert into task (
         project_id, trade_id, name, phase_key, template_task_code, sort_order,
         is_milestone, is_wait, duration_days, duration_unit,
         baseline_start, baseline_end, current_start, current_end,
         status, confirmation, total_float_days, is_critical
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'terminiert','self_stated',$15,$16)
       returning id`,
      [
        projectId,
        task.tradeCode === undefined ? null : (tradeIdByCode.get(task.tradeCode) ?? null),
        task.name,
        task.phaseKey,
        task.code,
        task.sortOrder,
        task.isMilestone ?? false,
        task.isWait ?? false,
        task.durationDays,
        task.durationUnit ?? 'werktage',
        scheduled.start,
        scheduled.end,
        scheduled.start,
        scheduled.end,
        float?.totalFloatDays ?? null,
        float?.isCritical ?? false,
      ],
    );
    idByCode.set(task.code, inserted.rows[0]!.id);
  }

  for (const dependency of plan.dependencies) {
    await tx.query(
      `insert into dependency (project_id, predecessor_id, successor_id, type, lag_days, lag_unit)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        projectId,
        idByCode.get(dependency.predecessorId),
        idByCode.get(dependency.successorId),
        dependency.type ?? 'FS',
        dependency.lagDays ?? 0,
        dependency.lagUnit ?? 'werktage',
      ],
    );
  }

  await tx.query(
    `insert into audit_log (project_id, actor_channel, action, entity_type, entity_id, meta)
     values ($1, 'app', 'project.created', 'project', $1, $2)`,
    [
      projectId,
      JSON.stringify({
        template: template.key,
        hasBasement: answers.hasBasement,
        taskCount: plan.tasks.length,
      }),
    ],
  );

  return {
    projectId,
    taskCount: plan.tasks.length,
    dependencyCount: plan.dependencies.length,
    computedEnd: schedule.projectEnd,
    deviationWorkdays:
      answers.contractualCompletion === undefined ? null : floats.deviationWorkdays,
  };
}
