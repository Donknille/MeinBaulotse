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
import { withUserTx, type JwtClaims, type Transaction } from '@meinbaulotse/db';
import {
  workdayDifference,
  workdayOffset,
  type Calendar,
  type FederalState,
} from '@meinbaulotse/schedule';
import {
  decisionPatchRequest,
  memberInviteRequest,
  memberUpdateRequest,
  onboardingRequest,
  projectPatchRequest,
  taskPatchRequest,
  type MemberRole,
  type PhaseProgress,
  type ProjectSchedule,
  type ProjectSummary,
  type ScheduleChangeEntry,
  type ScheduledTaskDto,
  type TaskPatchResult,
  type TradeOption,
} from '@meinbaulotse/shared';
import { requireAuth, type AuthedVariables } from './auth.js';
import { createProjectFromAnswers } from './onboarding.js';
import { inviteMember, listMembers, revokeMember, updateMember } from './members.js';
import { listDecisions, patchDecision } from './decisions.js';
import { loadPlanContext, recomputePlan } from './plan.js';

type App = { Variables: AuthedVariables };

const uuid = z.string().uuid();

export function createApp(): Hono<App> {
  // Die App haengt unter `/api`, nicht unter der Wurzel.
  //
  // Auf Vercel liegt die Funktion unter `/api`, und der Hono-Adapter reicht die
  // Anfrage unveraendert durch — er entfernt kein Praefix. Die App bekommt dort
  // also `/api/v1/...`. Damit lokal derselbe Pfad gilt, schneidet der
  // Vite-Proxy bewusst nichts ab. Ein Unterschied zwischen Entwicklung und
  // Betrieb faellt sonst erst im Betrieb auf, und dann als 404 auf jeder Route.
  const app = new Hono<App>().basePath('/api');

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

  // -- Stammdaten -----------------------------------------------------------

  /**
   * Die Rechtematrix, wie sie in `role_permission` steht.
   *
   * Die Oberfläche blendet danach Knöpfe ein und aus. Sie erfindet die Matrix
   * bewusst nicht selbst: Zwei Kopien derselben Regel laufen früher oder
   * später auseinander, und dann zeigt die App einen Knopf, den die Datenbank
   * ablehnt.
   */
  v1.get('/roles', async (c) => {
    const matrix = await withUserTx(c.get('claims'), async (tx) => {
      const result = await tx.query<{ role: MemberRole; permission: string }>(
        'select role, permission from role_permission order by role, permission',
      );
      const grouped: Partial<Record<MemberRole, string[]>> = {};
      for (const row of result.rows) {
        (grouped[row.role] ??= []).push(row.permission);
      }
      return grouped;
    });
    return c.json({ matrix });
  });

  v1.get('/trades', async (c) => {
    const trades = await withUserTx(c.get('claims'), async (tx) => {
      const result = await tx.query<TradeOption>(
        'select id, code, name from trade where project_id is null order by sort_order',
      );
      return result.rows;
    });
    return c.json({ trades });
  });

  // -- Lesen ----------------------------------------------------------------

  v1.get('/me/projects', async (c) => {
    const projects = await withUserTx(c.get('claims'), async (tx) => {
      const result = await tx.query<ProjectRow>(`${PROJECT_SELECT} order by p.created_at desc`);
      return result.rows.map(toProjectSummary);
    });
    return c.json({ projects });
  });

  v1.get('/projects/:id', async (c) => {
    const projectId = parseId(c.req.param('id'));
    const project = await withUserTx(c.get('claims'), (tx) => loadProject(tx, projectId));
    return c.json(project);
  });

  v1.patch('/projects/:id', async (c) => {
    const projectId = parseId(c.req.param('id'));
    const parsed = projectPatchRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      throw new HTTPException(422, {
        message: 'Diese Angaben passen nicht.',
        cause: parsed.error.flatten(),
      });
    }

    const project = await withUserTx(c.get('claims'), async (tx) => {
      const updated = await tx.query(
        `update project
            set name = coalesce($2, name),
                contractual_completion =
                  case when $3::boolean then $4::date else contractual_completion end
          where id = $1`,
        [
          projectId,
          parsed.data.name ?? null,
          parsed.data.contractualCompletion !== undefined,
          parsed.data.contractualCompletion ?? null,
        ],
      );
      if (updated.rowCount === 0) {
        throw new HTTPException(403, {
          message: 'Vertragsdaten pflegt der Bauherr.',
          cause: { hint: 'Wenn der Termin nicht stimmt, sag es ihm — er trägt ihn nach.' },
        });
      }
      // Der geschuldete Termin geht in die Puffer ein; ohne Neurechnung stünde
      // im Plan noch die Abweichung von gestern.
      await recomputePlan(tx, await loadPlanContext(tx, projectId));
      return loadProject(tx, projectId);
    });
    return c.json(project);
  });

  v1.get('/projects/:id/tasks', async (c) => {
    const projectId = parseId(c.req.param('id'));
    const tasks = await withUserTx(c.get('claims'), (tx) => loadTasks(tx, projectId));
    return c.json({ tasks });
  });

  v1.get('/projects/:id/schedule', async (c) => {
    const projectId = parseId(c.req.param('id'));
    const schedule = await withUserTx(c.get('claims'), (tx) => loadSchedule(tx, projectId));
    return c.json(schedule);
  });

  // -- Vorgänge ändern ------------------------------------------------------

  v1.patch('/projects/:id/tasks/:taskId', async (c) => {
    const projectId = parseId(c.req.param('id'));
    const taskId = parseId(c.req.param('taskId'));
    const parsed = taskPatchRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      throw new HTTPException(422, {
        message: 'Diese Änderung ist so nicht vollständig.',
        cause: parsed.error.flatten(),
      });
    }
    const input = parsed.data;

    const claims = c.get('claims');
    const result = await withUserTx<TaskPatchResult>(
      claims,
      async (tx) => {
        const before = await tx.query<{ id: string; confirmation: string }>(
          'select id, confirmation from task where project_id = $1 and id = $2',
          [projectId, taskId],
        );
        if (before.rowCount === 0) {
          throw new HTTPException(404, { message: 'Diesen Vorgang gibt es nicht.' });
        }

        const memberId = await currentMemberId(tx, projectId);

        // Was der Nutzer behauptet, geht durch das gewöhnliche UPDATE — dort
        // gilt die Rechtematrix samt Gewerke-Ausschnitt. Was daraus folgt,
        // rechnet danach `recomputePlan`.
        const updated = await tx.query(
          `update task
              set pinned_start  = case when $3::boolean then $4::date else pinned_start end,
                  duration_days = coalesce($5, duration_days),
                  actual_start  = case when $6::boolean then $7::date else actual_start end,
                  actual_end    = case when $8::boolean then $9::date else actual_end end,
                  status        = coalesce($10, status),
                  confirmation  = coalesce($11, confirmation),
                  confirmed_by  = case when $11 = 'mutual' then $12::uuid else confirmed_by end,
                  confirmed_at  = case when $11 = 'mutual' then now() else confirmed_at end
            where project_id = $1 and id = $2`,
          [
            projectId,
            taskId,
            input.currentStart !== undefined,
            input.currentStart ?? null,
            input.durationDays ?? null,
            input.actualStart !== undefined,
            input.actualStart ?? null,
            input.actualEnd !== undefined,
            input.actualEnd ?? null,
            input.status ?? null,
            input.confirmation ?? null,
            memberId,
          ],
        );
        if (updated.rowCount === 0) {
          throw new HTTPException(403, {
            message: 'Diesen Vorgang darfst du nicht ändern.',
            cause: {
              hint: 'Einzelgewerke ändern nur den eigenen Vorgang. Melde dich beim Bauherrn.',
            },
          });
        }

        const context = await loadPlanContext(tx, projectId);
        const recomputed = await recomputePlan(tx, context);

        const tasks = await loadTasks(tx, projectId);
        const task = tasks.find((entry) => entry.id === taskId);
        if (task === undefined) {
          // Kann nur eintreten, wenn der Vorgang zu einem Gewerkeausschnitt
          // gehört, den der Anrufer nach der Änderung nicht mehr sieht.
          throw new HTTPException(404, { message: 'Diesen Vorgang gibt es nicht.' });
        }

        // Die Rechnung kennt den ganzen Graphen; die Antwort nennt nur, was
        // dieser Anrufer ohnehin lesen darf. `loadTasks` läuft über die
        // gewöhnliche RLS — die Sichtbarkeit entscheidet also weiterhin die
        // Datenbank, nicht diese Zeile.
        const visible = new Set(tasks.map((entry) => entry.id));
        const shifted = recomputed.shifted.filter((entry) => entry.id !== taskId);

        return {
          task,
          shifted: shifted.filter((entry) => visible.has(entry.id)),
          shiftedCount: shifted.length,
          computedEndBefore: recomputed.computedEndBefore,
          computedEndAfter: recomputed.computedEndAfter,
          endShiftWorkdays: recomputed.endShiftWorkdays,
        };
      },
      {
        actorChannel: 'app',
        ...(input.reasonCode === undefined ? {} : { changeReason: input.reasonCode }),
        ...(input.reasonText === undefined ? {} : { changeReasonText: input.reasonText }),
      },
    );

    return c.json(result);
  });

  // -- Änderungshistorie ----------------------------------------------------

  v1.get('/projects/:id/changes', async (c) => {
    const projectId = parseId(c.req.param('id'));
    const limit = Math.min(Number(c.req.query('limit') ?? 100) || 100, 500);
    const changes = await withUserTx(c.get('claims'), async (tx) => {
      const result = await tx.query<{
        id: string;
        task_id: string | null;
        task_name: string | null;
        field: string;
        old_value: unknown;
        new_value: unknown;
        actor_role: ScheduleChangeEntry['actorRole'];
        actor_name: string | null;
        actor_channel: ScheduleChangeEntry['actorChannel'];
        reason_code: ScheduleChangeEntry['reasonCode'];
        reason_text: string | null;
        created_at: Date;
      }>(
        `select sc.id, sc.task_id, t.name as task_name, sc.field,
                sc.old_value, sc.new_value, sc.actor_role,
                coalesce(m.display_name, m.company, m.email) as actor_name,
                sc.actor_channel, sc.reason_code, sc.reason_text, sc.created_at
         from schedule_change sc
         left join task t on t.id = sc.task_id
         left join project_member m on m.id = sc.actor_member_id
         where sc.project_id = $1
         order by sc.created_at desc, sc.id desc
         limit $2`,
        [projectId, limit],
      );
      return result.rows.map(
        (row): ScheduleChangeEntry => ({
          id: row.id,
          taskId: row.task_id,
          taskName: row.task_name,
          field: row.field,
          oldValue: row.old_value,
          newValue: row.new_value,
          actorRole: row.actor_role,
          actorName: row.actor_name,
          actorChannel: row.actor_channel,
          reasonCode: row.reason_code,
          reasonText: row.reason_text,
          createdAt: row.created_at.toISOString(),
        }),
      );
    });
    return c.json({ changes });
  });

  // -- Beteiligte -----------------------------------------------------------

  v1.get('/projects/:id/members', async (c) => {
    const projectId = parseId(c.req.param('id'));
    const claims = c.get('claims');
    const members = await withUserTx(claims, (tx) => listMembers(tx, projectId, claims.sub));
    return c.json({ members });
  });

  v1.post('/projects/:id/members', async (c) => {
    const projectId = parseId(c.req.param('id'));
    const parsed = memberInviteRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      throw new HTTPException(422, {
        message: 'So können wir die Einladung noch nicht anlegen.',
        cause: parsed.error.flatten(),
      });
    }
    const claims = c.get('claims');
    const member = await withUserTx(claims, (tx) =>
      inviteMember(tx, projectId, claims.sub, parsed.data),
    );
    return c.json(member, 201);
  });

  v1.patch('/projects/:id/members/:memberId', async (c) => {
    const projectId = parseId(c.req.param('id'));
    const memberId = parseId(c.req.param('memberId'));
    const parsed = memberUpdateRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      throw new HTTPException(422, {
        message: 'Diese Änderung passt nicht.',
        cause: parsed.error.flatten(),
      });
    }
    const claims = c.get('claims');
    const member = await withUserTx(claims, (tx) =>
      updateMember(tx, projectId, memberId, claims.sub, parsed.data),
    );
    return c.json(member);
  });

  v1.delete('/projects/:id/members/:memberId', async (c) => {
    const projectId = parseId(c.req.param('id'));
    const memberId = parseId(c.req.param('memberId'));
    const claims = c.get('claims');
    const member = await withUserTx(claims, (tx) =>
      revokeMember(tx, projectId, memberId, claims.sub),
    );
    return c.json(member);
  });

  // -- Entscheidungen -------------------------------------------------------

  v1.get('/projects/:id/decisions', async (c) => {
    const projectId = parseId(c.req.param('id'));
    const today = parseToday(c.req.query('today'));
    const decisions = await withUserTx(c.get('claims'), async (tx) => {
      const context = await loadPlanContext(tx, projectId);
      return listDecisions(tx, projectId, context.calendar, today);
    });
    return c.json({ decisions });
  });

  v1.patch('/projects/:id/decisions/:decisionId', async (c) => {
    const projectId = parseId(c.req.param('id'));
    const decisionId = parseId(c.req.param('decisionId'));
    const today = parseToday(c.req.query('today'));
    const parsed = decisionPatchRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      throw new HTTPException(422, {
        message: 'Diese Angaben passen nicht.',
        cause: parsed.error.flatten(),
      });
    }
    const decision = await withUserTx(c.get('claims'), async (tx) => {
      const context = await loadPlanContext(tx, projectId);
      return patchDecision(tx, projectId, decisionId, parsed.data, context.calendar, today);
    });
    return c.json(decision);
  });

  app.route('/v1', v1);

  app.notFound((c) => c.json({ error: 'Diese Adresse gibt es nicht.' }, 404));

  app.onError((error, c) => {
    if (error instanceof HTTPException) {
      const cause = error.cause;
      const hint =
        typeof cause === 'object' && cause !== null && 'hint' in cause
          ? (cause as { hint?: string }).hint
          : undefined;
      return c.json(
        {
          error: error.message,
          ...(hint === undefined ? {} : { hint }),
          ...(cause === undefined || hint !== undefined ? {} : { details: cause }),
        },
        error.status,
      );
    }

    // Ein Verstoß gegen eine Policy ist kein Serverfehler, sondern eine
    // Antwort: Diese Rolle darf das nicht.
    const code = (error as { code?: string }).code;
    if (code === '42501') {
      return c.json(
        {
          error: 'Das darf deine Rolle in diesem Projekt nicht.',
          hint: 'Frag den Bauherrn — er kann dir die passende Rolle geben.',
        },
        403,
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
  role: MemberRole;
  member_id: string;
  trade_id: string | null;
  permissions: string[];
}

/**
 * Projekt samt eigener Rolle **und** eigenen Rechten.
 *
 * Die Rechte kommen aus derselben Tabelle, die auch `mbl.has_perm()` liest.
 * Damit kann die Oberfläche keinen Knopf zeigen, den die Datenbank ablehnt —
 * und keinen verstecken, den sie erlaubt.
 */
const PROJECT_SELECT = `
  select p.id, p.name, p.federal_state, p.build_type, p.contract_type,
         p.has_basement, p.planned_start, p.contractual_completion,
         m.role, m.id as member_id, m.trade_id,
         coalesce(
           (select array_agg(rp.permission order by rp.permission)
              from role_permission rp where rp.role = m.role),
           '{}'
         ) as permissions
  from project p
  -- Verbunden wird auf die EIGENE Mitgliedszeile, nicht auf irgendeine.
  -- Ein Mitglied darf alle Zeilen des Projekts lesen; ein Join über
  -- project_id lieferte deshalb je Beteiligtem eine Zeile, und die erste
  -- davon entschiede zufällig über die angezeigte Rolle. current_member_id
  -- kennt zusätzlich den Weg über eine Sachverständigen-Organisation.
  join project_member m on m.id = mbl.current_member_id(p.id)`;

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
    memberId: row.member_id,
    permissions: row.permissions,
    tradeId: row.trade_id,
  };
}

function parseId(raw: string | undefined): string {
  const parsed = uuid.safeParse(raw);
  if (!parsed.success) {
    throw new HTTPException(400, { message: 'Diese Kennung ist nicht gültig.' });
  }
  return parsed.data;
}

/**
 * Das heutige Datum kommt vom Anrufer, nicht aus der Serveruhr.
 *
 * Der Bauherr steht in seiner Zeitzone auf der Baustelle, der Server irgendwo
 * anders. Für „noch vier Werktage" zählt seine, nicht unsere. Fehlt die
 * Angabe, greift das Datum des Servers in UTC — das ist die einzige Stelle,
 * an der überhaupt eine Uhr gelesen wird.
 */
function parseToday(raw: string | undefined): string {
  const parsed = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .safeParse(raw);
  return parsed.success ? parsed.data : new Date().toISOString().slice(0, 10);
}

async function currentMemberId(tx: Transaction, projectId: string): Promise<string | null> {
  const result = await tx.query<{ id: string }>('select mbl.current_member_id($1) as id', [
    projectId,
  ]);
  return result.rows[0]?.id ?? null;
}

async function loadProject(tx: Transaction, projectId: string): Promise<ProjectSummary> {
  const result = await tx.query<ProjectRow>(`${PROJECT_SELECT} where p.id = $1`, [projectId]);
  if (result.rowCount === 0) {
    // Bewusst 404 statt 403: Ob es dieses Projekt gibt, geht Fremde nichts an.
    throw new HTTPException(404, { message: 'Dieses Projekt gibt es nicht.' });
  }
  return toProjectSummary(result.rows[0]!);
}

async function loadTasks(tx: Transaction, projectId: string): Promise<ScheduledTaskDto[]> {
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

async function loadSchedule(tx: Transaction, projectId: string): Promise<ProjectSchedule> {
  const project = await loadProject(tx, projectId);
  const tasks = await loadTasks(tx, projectId);
  const phases = await loadPhases(tx, projectId);

  const ends = tasks.map((task) => task.currentEnd).filter((end): end is string => end !== null);
  const computedEnd = ends.length === 0 ? null : ends.reduce((a, b) => (a > b ? a : b));

  // Die Abweichung wird gerechnet, nicht aus einem Puffer abgeleitet: Der
  // Puffer je Vorgang misst gegen den eigenen Plan, die Abweichung gegen
  // den Vertrag. Das sind zwei verschiedene Zahlen.
  let deviationWorkdays: number | null = null;
  if (project.contractualCompletion !== null && computedEnd !== null) {
    const calendar = await calendarOf(tx, projectId);
    deviationWorkdays = workdayDifference(
      workdayOffset(project.contractualCompletion, 1, calendar),
      workdayOffset(computedEnd, 1, calendar),
      calendar,
    );
  }

  return {
    project,
    phases,
    tasks,
    computedEnd,
    contractualEnd: project.contractualCompletion,
    deviationWorkdays,
  };
}

/** Der Feiertagskalender des Projekts — Bundesland plus Gemeindetyp. */
async function calendarOf(tx: Transaction, projectId: string): Promise<Calendar> {
  const result = await tx.query<{
    federal_state: FederalState;
    catholic_municipality: boolean;
  }>('select federal_state, catholic_municipality from project where id = $1', [projectId]);
  const row = result.rows[0]!;
  return { federalState: row.federal_state, catholicMunicipality: row.catholic_municipality };
}

async function loadPhases(tx: Transaction, projectId: string): Promise<PhaseProgress[]> {
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

export type { JwtClaims };
