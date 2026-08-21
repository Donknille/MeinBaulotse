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
import { describeConnection, withUserTx } from '@meinbaulotse/db';
import {
  workdayDifference,
  workdayOffset,
  type Calendar,
  type FederalState,
} from '@meinbaulotse/schedule';
import {
  onboardingRequest,
  taskUpdateRequest,
  type PhaseProgress,
  type ProjectSchedule,
  type ProjectSummary,
  type ScheduledTaskDto,
} from '@meinbaulotse/shared';
import { requireAuth, type AuthedVariables } from './auth.js';
import { demoLoginKey, demoRoutes } from './demo.js';
import { createProjectFromAnswers } from './onboarding.js';
import { recomputeProject } from './scheduling.js';
import { checkSchema } from './schema-check.js';

type App = { Variables: AuthedVariables };

const uuid = z.string().uuid();

/**
 * Die Kennung, unter der die Datenbankprüfung fragt.
 *
 * Bewusst die Nullkennung und kein echter Nutzer: Die Prüfung liest nur
 * Stammdaten, die jede angemeldete Kennung lesen darf (`phase_read`,
 * `role_permission_read`). Sie läuft damit innerhalb der RLS und braucht keine
 * privilegierte Rolle — Regel 1 gilt auch für eine Gesundheitsprüfung.
 */
const HEALTH_PROBE_USER = '00000000-0000-0000-0000-000000000000';

/**
 * Riecht dieser Fehler nach einer nicht eingespielten Migration?
 *
 * Postgres nennt die Spalte, nicht die Datei. Der Sprung von der einen zur
 * anderen hat im Betrieb eine ganze Runde gekostet.
 */
function missingColumnHint(error: unknown): string | null {
  const text = error instanceof Error ? error.message : String(error);
  const treffer = /column\s+(?:\w+\.)?(\w+)\s+does not exist/i.exec(text);
  if (treffer === null) return null;
  return `Die Datenbank kennt die Spalte „${treffer[1]}" nicht. Vermutlich fehlt eine Migration aus supabase/migrations — /api/health/db sagt welche.`;
}

/**
 * Zugangsdaten dürfen nicht in einer Fehlermeldung landen. Postgres-Adressen
 * tragen das Passwort im Klartext zwischen `//` und `@`.
 */
export function withoutSecrets(text: string): string {
  return text.replace(/:\/\/[^@\s]*@/g, '://***@');
}

export function createApp(): Hono<App> {
  // Die App haengt unter `/api`, nicht unter der Wurzel.
  //
  // Auf Vercel liegt die Funktion unter `/api`, und der Hono-Adapter reicht die
  // Anfrage unveraendert durch — er entfernt kein Praefix. Die App bekommt dort
  // also `/api/v1/...`. Damit lokal derselbe Pfad gilt, schneidet der
  // Vite-Proxy bewusst nichts ab. Ein Unterschied zwischen Entwicklung und
  // Betrieb faellt sonst erst im Betrieb auf, und dann als 404 auf jeder Route.
  const app = new Hono<App>().basePath('/api');

  // Die Gesundheitsprüfung nennt den Pfad, den Hono tatsächlich gesehen hat.
  // Im Betrieb ist das die schnellste Auskunft darüber, ob die Function
  // erreicht wurde und ob Vercel den Pfad beim Umschreiben vollständig
  // durchreicht: `/api/health` muss hier wieder als `/api/health` auftauchen.
  app.get('/health', (c) => c.json({ ok: true, path: c.req.path }));

  // Die Gegenprobe zur Datenbank, ohne Anmeldung.
  //
  // `/api/health` sagt, ob die Function läuft. Diese Route sagt, ob sie an die
  // Datenbank kommt — und das ist die zweite Frage, die im Betrieb immer
  // gestellt wird, wenn eine Liste leer bleibt. Ohne sie ist von außen nicht
  // zu unterscheiden, ob eine Antwort leer ist, weil nichts da ist, oder weil
  // die Verbindung fehlt.
  //
  // Gezählt werden Stammdaten, keine Projektdaten: Phasen und Rechteeinträge
  // stehen in jeder eingerichteten Datenbank und verraten nichts über einen
  // Nutzer. Fehlen die Migrationen, scheitert schon die Abfrage — dann steht
  // der Grund in `detail`.
  //
  // Die Route steht bewusst ohne Anmeldung offen, denn genau dann braucht man
  // sie: wenn keine Anmeldung durchkommt. Was sie preisgibt, ist abgegrenzt.
  // `connection` nennt nur Port, TLS und Benutzerform, nie Host, Benutzer oder
  // Passwort. `detail` ist der Rohtext des Fehlers mit maskierten Zugangsdaten;
  // darin kann ein Hostname stehen, und das ist vertretbar — die Adresse des
  // Supabase-Projekts steht als `VITE_SUPABASE_URL` ohnehin im Browser-Bundle.
  app.get('/health/db', async (c) => {
    try {
      const zustand = await withUserTx({ sub: HEALTH_PROBE_USER }, async (tx) => {
        const result = await tx.query<{ phases: string; roles: string }>(
          `select (select count(*) from phase)::text           as phases,
                  (select count(*) from role_permission)::text as roles`,
        );
        return { counts: result.rows[0]!, schema: await checkSchema(tx) };
      });

      // Eine stehende Verbindung ist nicht dasselbe wie eine brauchbare
      // Datenbank. Fehlt eine Migration, die der Code voraussetzt, laeuft jede
      // Planansicht in einen 500er — und diese Pruefung meldete trotzdem
      // „ok". Genau so ist es im Betrieb passiert.
      if (!zustand.schema.current) {
        return c.json(
          {
            ok: false,
            error: 'Die Datenbank ist nicht auf dem Stand dieser Fassung.',
            detail: `Fehlende Migration: ${zustand.schema.missingMigrations.join(', ')}. Einzuspielen im SQL-Editor, aus supabase/migrations.`,
            schema: zustand.schema,
            connection: describeConnection(),
          },
          503,
        );
      }

      return c.json({
        ok: true,
        phases: Number(zustand.counts.phases),
        roles: Number(zustand.counts.roles),
        schema: zustand.schema,
        connection: describeConnection(),
      });
    } catch (error) {
      console.error('Die Datenbank antwortet nicht:', error);
      return c.json(
        {
          ok: false,
          error: 'Die Datenbank antwortet nicht.',
          detail: withoutSecrets(error instanceof Error ? error.message : String(error)),
          // Die Form der Adresse, ohne Host, Benutzer oder Passwort. Sie
          // beantwortet die häufigste Ursache ohne weitere Rückfrage:
          // `port: 5432` heißt Direktverbindung, und die ist von Vercel aus
          // nicht erreichbar.
          connection: describeConnection(),
        },
        503,
      );
    }
  });

  // Testzugang ohne Mailversand. Ohne eingestellten Schlüssel gibt es diese
  // Route nicht — sie antwortet dann wie jede unbekannte Adresse mit 404.
  // Warum das vertretbar ist, steht in `demo.ts`.
  const demoKey = demoLoginKey();
  if (demoKey !== null) {
    console.info('Testzugang aktiv: POST /api/demo/session');
    app.route('/demo', demoRoutes(demoKey));
  }

  const v1 = new Hono<App>();
  v1.use('*', requireAuth);

  // -- Wer fragt hier eigentlich? -------------------------------------------

  // Diese Route beantwortet die Frage, an der jede leere Liste hängt: Erkennt
  // die **Datenbank** denselben Nutzer, den das Token nennt?
  //
  // `databaseUserId` kommt aus `mbl.current_user_id()`, also aus `auth.uid()`.
  // Steht dort `null`, während `tokenSub` gefüllt ist, löst die Datenbank den
  // JWT-Claim nicht auf — dann bleibt jede Liste leer, obwohl die Daten da
  // sind. Ohne diese Unterscheidung sieht das genauso aus wie „noch nichts
  // angelegt", und man sucht an der falschen Stelle.
  v1.get('/me', async (c) => {
    const claims = c.get('claims');
    const seen = await withUserTx(claims, async (tx) => {
      const result = await tx.query<{ user_id: string | null; memberships: string }>(
        `select mbl.current_user_id() as user_id,
                (select count(*) from project_member
                  where user_id = mbl.current_user_id() and revoked_at is null)::text
                  as memberships`,
      );
      return result.rows[0]!;
    });

    return c.json({
      tokenSub: claims.sub,
      databaseUserId: seen.user_id,
      email: typeof claims.email === 'string' ? claims.email : null,
      memberships: Number(seen.memberships),
    });
  });

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

  // Der Verbund geht über `m.user_id = mbl.current_user_id()`, nicht über die
  // Mitgliedschaft schlechthin: Sonst liefert ein Projekt mit drei Beteiligten
  // dieselbe Zeile dreimal, und `role` wäre die Rolle irgendeines Mitglieds
  // statt der des Fragenden. Solange jedes Projekt nur den Bauherrn kannte,
  // fiel das nicht auf.
  v1.get('/me/projects', async (c) => {
    const projects = await withUserTx(c.get('claims'), async (tx) => {
      const result = await tx.query<ProjectRow & { role: ProjectSummary['role'] }>(
        `select p.id, p.name, p.federal_state, p.build_type, p.contract_type,
                p.has_basement, p.planned_start, p.contractual_completion,
                m.role
         from project p
         join project_member m on m.project_id = p.id
         where m.user_id = mbl.current_user_id() and m.revoked_at is null
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

  // -- Ändern ----------------------------------------------------------------

  // Ein Vorgang verschiebt sich, oder es wird gemeldet, was auf der Baustelle
  // wirklich passiert ist. Beides führt zur selben Frage — sind wir noch im
  // Plan? —, deshalb antwortet die Route mit dem neu gerechneten Plan und
  // nicht mit dem geänderten Vorgang.
  //
  // Wer das darf, entscheidet die Datenbank: Die Policy `task_update` verlangt
  // `task.schedule` und beschränkt Einzelgewerke zusätzlich auf ihre eigenen
  // Vorgänge. Hier wird nichts geprüft, was eine Policy prüfen kann.
  v1.patch('/projects/:id/tasks/:taskId', async (c) => {
    const projectId = parseId(c.req.param('id'));
    const taskId = parseId(c.req.param('taskId'));
    const parsed = taskUpdateRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      throw new HTTPException(422, {
        message: 'Diese Angaben reichen noch nicht. Sieh bitte die markierten Felder durch.',
        cause: parsed.error.flatten(),
      });
    }
    const change = parsed.data;

    const schedule = await withUserTx(
      c.get('claims'),
      async (tx): Promise<ProjectSchedule> => {
        // Erst die Aussage festhalten, dann neu rechnen. Beides in derselben
        // Transaktion: Scheitert die Rechnung, gab es auch die Aussage nicht.
        const felder: string[] = [];
        const werte: unknown[] = [taskId, projectId];
        const setze = (spalte: string, wert: unknown): void => {
          werte.push(wert);
          felder.push(`${spalte} = $${werte.length}`);
        };

        if (change.earliestStart !== undefined) setze('earliest_start', change.earliestStart);
        if (change.actualStart !== undefined) setze('actual_start', change.actualStart);
        if (change.actualEnd !== undefined) setze('actual_end', change.actualEnd);
        if (change.status !== undefined) setze('status', change.status);

        const result = await tx.query(
          `update task set ${felder.join(', ')} where id = $1 and project_id = $2`,
          werte,
        );

        // Kein Treffer heißt: Es gibt den Vorgang nicht, oder die RLS lässt
        // diese Kennung nicht an ihn heran. Von außen ist das dasselbe, und
        // das ist Absicht — sonst verrät ein 403, dass es ihn gibt.
        if (result.rowCount === 0) {
          throw new HTTPException(404, {
            message: 'Diesen Vorgang gibt es in deinem Bauvorhaben nicht.',
          });
        }

        await recomputeProject(tx, projectId);
        return loadSchedule(tx, projectId);
      },
      {
        // Der Grund wandert über die Transaktion in jeden Historieneintrag,
        // den der Trigger schreibt.
        ...(change.reason === undefined ? {} : { changeReason: change.reason }),
        ...(change.reasonText === undefined || change.reasonText === ''
          ? {}
          : { changeReasonText: change.reasonText }),
      },
    );

    return c.json(schedule);
  });

  v1.get('/projects/:id/schedule', async (c) => {
    const projectId = parseId(c.req.param('id'));
    const schedule = await withUserTx(c.get('claims'), (tx) => loadSchedule(tx, projectId));
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
    // Der Grund gehört in die Antwort, nicht nur ins Protokoll.
    //
    // „Das hat nicht geklappt" allein kostete eine ganze Runde: Die Function
    // lief, die Datenlage stand, und trotzdem war von außen nicht zu sehen,
    // dass die Datenbankverbindung scheiterte. Wer hier fragt, ist angemeldet,
    // und Zugangsdaten sind maskiert — die Auskunft ist die richtige Wahl.
    return c.json(
      {
        error: 'Das hat nicht geklappt.',
        hint: 'Versuch es bitte noch einmal. Bleibt es dabei, melde dich bei uns.',
        detail: withoutSecrets(error instanceof Error ? error.message : String(error)),
        // Auch hier, nicht nur unter /api/health/db: Wer einen Fehler sieht,
        // erreicht womoeglich keine zweite Adresse mehr. Die Auskunft muss an
        // der Stelle stehen, an der der Fehler auftaucht.
        connection: describeConnection(),
        // „column t.earliest_start does not exist" ist fuer den Betreiber ein
        // Raetsel, „spiel Migration 0004 ein" eine Anweisung.
        ...(missingColumnHint(error) === null ? {} : { schemaHint: missingColumnHint(error) }),
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
     join project_member m on m.project_id = p.id
       and m.user_id = mbl.current_user_id()
       and m.revoked_at is null
     where p.id = $1`,
    [projectId],
  );
  if (result.rowCount === 0) {
    // Bewusst 404 statt 403: Ob es dieses Projekt gibt, geht Fremde nichts an.
    throw new HTTPException(404, { message: 'Dieses Projekt gibt es nicht.' });
  }
  return toProjectSummary(result.rows[0]!);
}

/**
 * Die Rechte des Fragenden in diesem Projekt, gelesen aus der Rechtematrix.
 *
 * Die Oberfläche soll nichts anbieten, was die Datenbank hinterher ablehnt.
 * Deshalb kommt die Liste aus `role_permission` und nicht aus einer Konstante
 * im Anwendungscode — es ist dieselbe Tabelle, die `mbl.has_perm()` befragt.
 */
async function loadPermissions(tx: Tx, projectId: string): Promise<string[]> {
  const result = await tx.query<{ permission: string }>(
    `select rp.permission
     from project_member m
     join role_permission rp on rp.role = m.role
     where m.project_id = $1
       and m.user_id = mbl.current_user_id()
       and m.revoked_at is null
     order by rp.permission`,
    [projectId],
  );
  return result.rows.map((row) => row.permission);
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
    earliest_start: string | null;
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
            t.earliest_start, t.actual_start, t.actual_end, t.status, t.confirmation,
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
    earliestStart: row.earliest_start,
    actualStart: row.actual_start,
    actualEnd: row.actual_end,
    status: row.status,
    confirmation: row.confirmation,
    totalFloatDays: row.total_float_days,
    isCritical: row.is_critical,
  }));
}

/** Der Feiertagskalender des Projekts — Bundesland plus Gemeindetyp. */
/**
 * Die vollständige Planansicht eines Bauvorhabens.
 *
 * Sie steht hier und nicht in der Route, weil zwei Wege sie brauchen: das
 * Lesen und — nach einer Verschiebung — die Antwort auf das Ändern. Beide
 * müssen dasselbe liefern, sonst zeigt die Oberfläche nach dem Speichern etwas
 * anderes als nach dem Neuladen.
 */
async function loadSchedule(tx: Tx, projectId: string): Promise<ProjectSchedule> {
  const project = await loadProject(tx, projectId);
  const permissions = await loadPermissions(tx, projectId);
  const tasks = await loadTasks(tx, projectId);
  const phases = await loadPhases(tx, projectId);

  const ends = tasks.map((task) => task.currentEnd).filter((end): end is string => end !== null);
  const computedEnd = ends.length === 0 ? null : ends.reduce((a, b) => (a > b ? a : b));

  // Die Abweichung wird gerechnet, nicht aus einem Puffer abgeleitet: Der
  // Puffer je Vorgang misst gegen den eigenen Plan, die Abweichung gegen den
  // Vertrag. Das sind zwei verschiedene Zahlen.
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
    permissions,
    phases,
    tasks,
    computedEnd,
    contractualEnd: project.contractualCompletion,
    deviationWorkdays,
  };
}

async function calendarOf(tx: Tx, projectId: string): Promise<Calendar> {
  const result = await tx.query<{
    federal_state: FederalState;
    catholic_municipality: boolean;
  }>('select federal_state, catholic_municipality from project where id = $1', [projectId]);
  const row = result.rows[0]!;
  return { federalState: row.federal_state, catholicMunicipality: row.catholic_municipality };
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
