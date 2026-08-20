/**
 * HTTP-Oberfläche der Anwendung.
 *
 * Jede Route öffnet eine Transaktion als Rolle `authenticated` mit dem
 * JWT-Claim des Anrufers. Autorisierung findet damit ausschließlich in der
 * Datenbank statt; hier wird nichts geprüft, was eine Policy prüfen kann.
 */

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { withUserTx } from '@meinbaulotse/db';
import {
  onboardingRequest,
  type PhaseProgress,
  type ProjectSchedule,
  type ProjectSummary,
  type ScheduledTaskDto,
} from '@meinbaulotse/shared';
import { requireAuth, type AuthedVariables } from './auth.js';
import { createProjectFromAnswers } from './onboarding.js';

type App = { Variables: AuthedVariables };

const uuid = z.string().uuid();

export function createApp(): Hono<App> {
  const app = new Hono<App>();

  app.get('/health', (c) => c.json({ ok: true }));

  const v1 = new Hono<App>();
  v1.use('*', requireAuth);

  // -- Onboarding -----------------------------------------------------------

  v1.post('/projects/onboarding', async (c) => {
    const parsed = onboardingRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      throw new HTTPException(422, {
        message: 'Diese Angaben reichen noch nicht. Sieh bitte die markierten Felder durch.',
        cause: parsed.error.flatten(),
      });
    }

    const claims = c.get('claims');
    const result = await withUserTx(claims, (tx) =>
      createProjectFromAnswers(tx, claims, parsed.data),
    );
    return c.json(result, 201);
  });

  // -- Lesen ----------------------------------------------------------------

  v1.get('/me/projects', async (c) => {
    const projects = await withUserTx(c.get('claims'), async (tx) => {
      const result = await tx.query<ProjectRow & { role: ProjectSummary['role'] }>(
        `select p.id, p.name, p.federal_state, p.build_type, p.contract_type,
                p.has_basement, p.planned_start, p.contractual_completion,
                m.role
         from project p
         join project_member m on m.project_id = p.id
         where m.revoked_at is null
         order by p.created_at desc`,
      );
      return result.rows.map(toProjectSummary);
    });
    return c.json({ projects });
  });

  v1.get('/projects/:id', async (c) => {
    const projectId = parseId(c.req.param('id'));
    const project = await withUserTx(c.get('claims'), (tx) => loadProject(tx, projectId));
    return c.json(project);
  });

  v1.get('/projects/:id/tasks', async (c) => {
    const projectId = parseId(c.req.param('id'));
    const tasks = await withUserTx(c.get('claims'), (tx) => loadTasks(tx, projectId));
    return c.json({ tasks });
  });

  v1.get('/projects/:id/schedule', async (c) => {
    const projectId = parseId(c.req.param('id'));
    const schedule = await withUserTx(c.get('claims'), async (tx): Promise<ProjectSchedule> => {
      const project = await loadProject(tx, projectId);
      const tasks = await loadTasks(tx, projectId);
      const phases = await loadPhases(tx, projectId);

      const ends = tasks.map((task) => task.currentEnd).filter((end): end is string => end !== null);
      const computedEnd = ends.length === 0 ? null : ends.reduce((a, b) => (a > b ? a : b));

      // Der Endtermin gegen den geschuldeten: negativer Puffer auf dem letzten
      // Vorgang bedeutet, dass der Plan hinter dem Vertrag liegt.
      const lastFloat = tasks
        .filter((task) => task.currentEnd === computedEnd)
        .map((task) => task.totalFloatDays)
        .find((value): value is number => value !== null);

      return {
        project,
        phases,
        tasks,
        computedEnd,
        contractualEnd: project.contractualCompletion,
        deviationWorkdays:
          project.contractualCompletion === null || lastFloat === undefined ? null : -lastFloat,
      };
    });
    return c.json(schedule);
  });

  app.route('/v1', v1);

  app.notFound((c) => c.json({ error: 'Diese Adresse gibt es nicht.' }, 404));

  app.onError((error, c) => {
    if (error instanceof HTTPException) {
      return c.json(
        {
          error: error.message,
          ...(error.cause === undefined ? {} : { details: error.cause }),
        },
        error.status,
      );
    }
    console.error('Unerwarteter Fehler:', error);
    return c.json(
      {
        error: 'Das hat nicht geklappt.',
        hint: 'Versuch es bitte noch einmal. Bleibt es dabei, melde dich bei uns.',
      },
      500,
    );
  });

  return app;
}

// -- Hilfsfunktionen --------------------------------------------------------

interface ProjectRow {
  id: string;
  name: string;
  federal_state: ProjectSummary['federalState'];
  build_type: ProjectSummary['buildType'];
  contract_type: ProjectSummary['contractType'];
  has_basement: boolean;
  planned_start: string;
  contractual_completion: string | null;
  role: ProjectSummary['role'];
}

function toProjectSummary(row: ProjectRow): ProjectSummary {
  return {
    id: row.id,
    name: row.name,
    federalState: row.federal_state,
    buildType: row.build_type,
    contractType: row.contract_type,
    hasBasement: row.has_basement,
    plannedStart: row.planned_start,
    contractualCompletion: row.contractual_completion,
    role: row.role,
  };
}

function parseId(raw: string | undefined): string {
  const parsed = uuid.safeParse(raw);
  if (!parsed.success) {
    throw new HTTPException(400, { message: 'Diese Projektkennung ist nicht gültig.' });
  }
  return parsed.data;
}

type Tx = Parameters<Parameters<typeof withUserTx>[1]>[0];

async function loadProject(tx: Tx, projectId: string): Promise<ProjectSummary> {
  const result = await tx.query<ProjectRow>(
    `select p.id, p.name, p.federal_state, p.build_type, p.contract_type,
            p.has_basement, p.planned_start, p.contractual_completion, m.role
     from project p
     join project_member m on m.project_id = p.id and m.revoked_at is null
     where p.id = $1`,
    [projectId],
  );
  if (result.rowCount === 0) {
    // Bewusst 404 statt 403: Ob es dieses Projekt gibt, geht Fremde nichts an.
    throw new HTTPException(404, { message: 'Dieses Projekt gibt es nicht.' });
  }
  return toProjectSummary(result.rows[0]!);
}

async function loadTasks(tx: Tx, projectId: string): Promise<ScheduledTaskDto[]> {
  const result = await tx.query<{
    id: string;
    name: string;
    phase_key: string;
    trade_code: string | null;
    trade_name: string | null;
    sort_order: number;
    is_milestone: boolean;
    is_wait: boolean;
    duration_days: number;
    duration_unit: ScheduledTaskDto['durationUnit'];
    current_start: string | null;
    current_end: string | null;
    baseline_start: string | null;
    baseline_end: string | null;
    actual_start: string | null;
    actual_end: string | null;
    status: ScheduledTaskDto['status'];
    confirmation: ScheduledTaskDto['confirmation'];
    total_float_days: number | null;
    is_critical: boolean;
  }>(
    `select t.id, t.name, t.phase_key, tr.code as trade_code, tr.name as trade_name,
            t.sort_order, t.is_milestone, t.is_wait, t.duration_days, t.duration_unit,
            t.current_start, t.current_end, t.baseline_start, t.baseline_end,
            t.actual_start, t.actual_end, t.status, t.confirmation,
            t.total_float_days, t.is_critical
     from task t
     left join trade tr on tr.id = t.trade_id
     where t.project_id = $1
     order by t.sort_order, t.current_start`,
    [projectId],
  );

  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    phaseKey: row.phase_key,
    tradeCode: row.trade_code,
    tradeName: row.trade_name,
    sortOrder: row.sort_order,
    isMilestone: row.is_milestone,
    isWait: row.is_wait,
    durationDays: row.duration_days,
    durationUnit: row.duration_unit,
    currentStart: row.current_start,
    currentEnd: row.current_end,
    baselineStart: row.baseline_start,
    baselineEnd: row.baseline_end,
    actualStart: row.actual_start,
    actualEnd: row.actual_end,
    status: row.status,
    confirmation: row.confirmation,
    totalFloatDays: row.total_float_days,
    isCritical: row.is_critical,
  }));
}

async function loadPhases(tx: Tx, projectId: string): Promise<PhaseProgress[]> {
  const result = await tx.query<{
    key: string;
    name: string;
    ordinal: number;
    task_count: string;
    first_start: string | null;
    last_end: string | null;
  }>(
    `select ph.key, ph.name, ph.ordinal,
            count(t.id)::text as task_count,
            min(t.current_start) as first_start,
            max(t.current_end)   as last_end
     from phase ph
     left join task t on t.phase_key = ph.key and t.project_id = $1
     group by ph.key, ph.name, ph.ordinal
     order by ph.ordinal`,
    [projectId],
  );

  return result.rows.map((row) => ({
    key: row.key,
    name: row.name,
    ordinal: row.ordinal,
    taskCount: Number(row.task_count),
    firstStart: row.first_start,
    lastEnd: row.last_end,
  }));
}
