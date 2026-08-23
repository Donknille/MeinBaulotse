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
  checklistUpdateRequest,
  decisionUpdateRequest,
  guestAnswerRequest,
  guestTokenCreateRequest,
  diaryCreateRequest,
  diaryUpdateRequest,
  mediaCreateRequest,
  changeOrderCreateRequest,
  contractUpdateRequest,
  defectCreateRequest,
  defectUpdateRequest,
  guideFeedbackRequest,
  lotseAskRequest,
  paymentCreateRequest,
  paymentReleaseRequest,
  onboardingRequest,
  taskUpdateRequest,
  type PhaseProgress,
  type ProjectSchedule,
  type ProjectMemberDto,
  type ProjectSummary,
  type ScheduledTaskDto,
} from '@meinbaulotse/shared';
import { requireAuth, type AuthedVariables } from './auth.js';
import {
  GUIDE_CARD_KEY_JOIN,
  loadGuideCardView,
  recordFeedback,
  updateChecklistItem,
} from './guide-cards.js';
import { loadDecisions, updateDecision } from './decisions.js';
import { buildWeeklyReport } from './weekly-report.js';
import {
  createDiaryEntry,
  fulfilledPhotoPrompts,
  loadDiary,
  registerMedia,
  updateDiaryEntry,
  verifyDiaryChain,
} from './diary.js';
import { demoLoginKey, demoRoutes } from './demo.js';
import {
  answerTask,
  claimsFor,
  createGuestToken,
  guestView,
  resolveGuestToken,
  revokeGuestToken,
} from './guests.js';
import { createProjectFromAnswers } from './onboarding.js';
import { previewChange, recomputeProject } from './scheduling.js';
import { checkSchema } from './schema-check.js';
import { frage, loadConversation, loadConversations } from './lotse.js';
import { modelAusUmgebung, type LotseModel } from './lotse-model.js';
import { createDefect, loadDefectEvents, loadDefects, updateDefect } from './defects.js';
import {
  loadChangeOrders,
  loadContractMirror,
  loadMoneyView,
  refreshContractChecks,
  releasePayment,
} from './money.js';

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

/**
 * Der heutige Tag, als `YYYY-MM-DD`.
 *
 * `?today=` verschiebt ihn — für den Wochenbericht, die Mängelfristen und die
 * Geldansicht. Es ist ausdrücklich **keine** Zeitreise: Gezeigt wird, wie die
 * Anwendung an diesem Tag rechnete, nicht, was an diesem Tag in der Datenbank
 * stand.
 *
 * Beim Lotsen gibt es diesen Griff nicht — dort wäre er der erste am Kontext,
 * und der gehört nach 6.4 nicht dem Client.
 */
function heute(c: { req: { query: (name: string) => string | undefined } }): string {
  const angefragt = c.req.query('today');
  return angefragt !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(angefragt)
    ? angefragt
    : new Date().toISOString().slice(0, 10);
}

export interface AppOptions {
  /**
   * Das Modell hinter „Frag den Lotsen".
   *
   * Steckbar, damit die Leitplanken prüfbar bleiben: Der Test setzt ein
   * Modell ein, das absichtlich Rechtsberatung erteilt, und prüft, dass die
   * Antwort trotzdem richtig herauskommt. Ohne diesen Griff prüfte er ein
   * Modell statt dieses Produkts.
   */
  lotseModel?: LotseModel | null;
}

export function createApp(options: AppOptions = {}): Hono<App> {
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

  // -- Der Gast-Zugang -------------------------------------------------------
  //
  // Ohne Anmeldung, und das ist der Punkt (Leitsatz 1.6.2): Ein Bauleiter,
  // der ein Konto anlegen soll, um einen Termin zu bestätigen, bestätigt
  // keinen Termin. Der Token im Link ist der ganze Ausweis; die Datenbank
  // prüft ihn bei jedem Zugriff erneut.
  const gast = new Hono<App>();

  gast.get('/session', async (c) => {
    const kontext = await resolveGuestToken(tokenAus(c.req.header('authorization')));
    const view = await withUserTx(claimsFor(kontext), (tx) => guestView(tx, kontext));
    return c.json(view);
  });

  gast.post('/tasks/:taskId/answer', async (c) => {
    const kontext = await resolveGuestToken(tokenAus(c.req.header('authorization')));
    if (!kontext.scopes.includes('confirm:task')) {
      throw new HTTPException(403, {
        message: 'Dieser Link ist zum Mitlesen gedacht, nicht zum Bestätigen.',
      });
    }

    const taskId = parseId(c.req.param('taskId'));
    const parsed = guestAnswerRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      throw new HTTPException(422, {
        message: 'Für einen anderen Termin brauchen wir ein Datum.',
        cause: parsed.error.flatten(),
      });
    }

    const task = await withUserTx(claimsFor(kontext), (tx) =>
      answerTask(tx, kontext, taskId, parsed.data),
    );
    return c.json(task);
  });

  app.route('/guest', gast);

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
                p.has_basement, p.catholic_municipality, p.planned_start, p.contractual_completion,
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

  // Was eine Verschiebung nach sich zöge, ohne sie zu tun (Abschnitt 3.5.6).
  // Bewusst POST, obwohl nichts geschrieben wird: Die Anfrage trägt einen
  // Körper, und GET mit Körper ist ein Weg in Ärger mit Zwischenspeichern.
  v1.post('/projects/:id/tasks/:taskId/preview', async (c) => {
    const projectId = parseId(c.req.param('id'));
    const taskId = parseId(c.req.param('taskId'));
    const parsed = taskUpdateRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      throw new HTTPException(422, {
        message: 'Diese Angaben reichen noch nicht. Sieh bitte die markierten Felder durch.',
        cause: parsed.error.flatten(),
      });
    }

    const preview = await withUserTx(c.get('claims'), (tx) =>
      previewChange(tx, projectId, taskId, parsed.data),
    );
    return c.json(preview);
  });

  v1.get('/projects/:id/schedule', async (c) => {
    const projectId = parseId(c.req.param('id'));
    const schedule = await withUserTx(c.get('claims'), (tx) => loadSchedule(tx, projectId));
    return c.json(schedule);
  });

  // -- Gast-Links verwalten ---------------------------------------------------

  // Der Token steht genau einmal in dieser Antwort. Danach liegt in der
  // Datenbank nur noch sein Hash — wer ihn verliert, bekommt einen neuen.
  v1.post('/projects/:id/guest-links', async (c) => {
    const projectId = parseId(c.req.param('id'));
    const parsed = guestTokenCreateRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      throw new HTTPException(422, {
        message: 'Für einen Link brauchen wir, an wen er gehen soll.',
        cause: parsed.error.flatten(),
      });
    }

    const created = await withUserTx(c.get('claims'), (tx) =>
      createGuestToken(tx, projectId, parsed.data.memberId, {
        ...(parsed.data.locale === undefined ? {} : { locale: parsed.data.locale }),
        ...(parsed.data.sentTo === undefined ? {} : { sentTo: parsed.data.sentTo }),
        ...(parsed.data.expiresInDays === undefined
          ? {}
          : { expiresInDays: parsed.data.expiresInDays }),
      }),
    );
    return c.json(created, 201);
  });

  v1.get('/projects/:id/guest-links', async (c) => {
    const projectId = parseId(c.req.param('id'));
    const links = await withUserTx(c.get('claims'), async (tx) => {
      const result = await tx.query(
        `select g.id, g.member_id as "memberId", m.display_name as "displayName",
                m.role::text as role, g.scopes, g.locale, g.sent_to as "sentTo",
                g.expires_at as "expiresAt", g.last_used_at as "lastUsedAt",
                g.use_count as "useCount", g.revoked_at as "revokedAt"
           from guest_token g join project_member m on m.id = g.member_id
          where g.project_id = $1
          order by g.created_at desc`,
        [projectId],
      );
      return result.rows;
    });
    return c.json({ links });
  });

  v1.delete('/projects/:id/guest-links/:linkId', async (c) => {
    const projectId = parseId(c.req.param('id'));
    const linkId = parseId(c.req.param('linkId'));
    await withUserTx(c.get('claims'), (tx) => revokeGuestToken(tx, projectId, linkId));
    return c.json({ ok: true });
  });

  // -- Mängel ----------------------------------------------------------------

  v1.get('/projects/:id/defects', async (c) => {
    const projectId = parseId(c.req.param('id'));
    const defects = await withUserTx(c.get('claims'), (tx) => loadDefects(tx, projectId));
    return c.json({ defects });
  });

  v1.post('/projects/:id/defects', async (c) => {
    const projectId = parseId(c.req.param('id'));
    const parsed = defectCreateRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      throw new HTTPException(422, {
        message: 'Beschreib den Mangel bitte in einem Satz — drei Zeichen sind zu wenig.',
        cause: parsed.error.flatten(),
      });
    }
    const defect = await withUserTx(c.get('claims'), (tx) =>
      createDefect(tx, projectId, parsed.data),
    );
    return c.json(defect, 201);
  });

  v1.patch('/projects/:id/defects/:defectId', async (c) => {
    const projectId = parseId(c.req.param('id'));
    const defectId = parseId(c.req.param('defectId'));
    const parsed = defectUpdateRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      throw new HTTPException(422, {
        message: 'Diese Angaben reichen noch nicht. Sieh bitte die markierten Felder durch.',
        cause: parsed.error.flatten(),
      });
    }
    const defect = await withUserTx(c.get('claims'), (tx) =>
      updateDefect(tx, projectId, defectId, parsed.data, heute(c)),
    );
    return c.json(defect);
  });

  v1.get('/projects/:id/defects/:defectId/events', async (c) => {
    const projectId = parseId(c.req.param('id'));
    const defectId = parseId(c.req.param('defectId'));
    const events = await withUserTx(c.get('claims'), (tx) =>
      loadDefectEvents(tx, projectId, defectId),
    );
    return c.json({ events });
  });

  // -- Geld ------------------------------------------------------------------

  v1.get('/projects/:id/money', async (c) => {
    const projectId = parseId(c.req.param('id'));
    const money = await withUserTx(c.get('claims'), (tx) =>
      loadMoneyView(tx, projectId, heute(c)),
    );
    return c.json(money);
  });

  v1.post('/projects/:id/payments', async (c) => {
    const projectId = parseId(c.req.param('id'));
    const parsed = paymentCreateRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      throw new HTTPException(422, {
        message: 'Eine Zahlung braucht mindestens einen Namen.',
        cause: parsed.error.flatten(),
      });
    }
    const money = await withUserTx(c.get('claims'), async (tx) => {
      const angelegt = await tx.query(
        `insert into payment_milestone (project_id, name, pct, amount_cents, requires_task_ids,
                                        due_date, sort_order)
         values ($1, $2, $3, $4, coalesce($5::uuid[], '{}'), $6, coalesce($7, 0))`,
        [
          projectId,
          parsed.data.name,
          parsed.data.pct ?? null,
          parsed.data.amountCents ?? null,
          parsed.data.requiresTaskIds ?? null,
          parsed.data.dueDate ?? null,
          parsed.data.sortOrder ?? null,
        ],
      );
      if (angelegt.rowCount === 0) {
        throw new HTTPException(403, { message: 'Zahlungen pflegt der Bauherr.' });
      }
      // Der Zahlungsplan ist die Grundlage der Prüfung aus 3.9 — wer ihn
      // ändert, ändert das Ergebnis. Deshalb gleich mit.
      await refreshContractChecks(tx, projectId);
      return loadMoneyView(tx, projectId, heute(c));
    });
    return c.json(money, 201);
  });

  v1.post('/projects/:id/payments/:paymentId/release', async (c) => {
    const projectId = parseId(c.req.param('id'));
    const paymentId = parseId(c.req.param('paymentId'));
    const parsed = paymentReleaseRequest.safeParse(
      await c.req.json().catch(() => ({})),
    );
    if (!parsed.success) {
      throw new HTTPException(422, {
        message: 'Ein Einbehalt braucht einen Grund.',
        cause: parsed.error.flatten(),
      });
    }
    if (
      parsed.data.withheldCents !== undefined
      && parsed.data.withheldCents > 0
      && parsed.data.withheldReason === undefined
    ) {
      throw new HTTPException(422, {
        message: 'Ein Einbehalt ohne Grund ist im Streit wertlos. Schreib kurz, wofür.',
      });
    }
    const payment = await withUserTx(c.get('claims'), (tx) =>
      releasePayment(tx, projectId, paymentId, parsed.data),
    );
    return c.json(payment);
  });

  v1.post('/projects/:id/change-orders', async (c) => {
    const projectId = parseId(c.req.param('id'));
    const parsed = changeOrderCreateRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      throw new HTTPException(422, {
        message: 'Ein Nachtrag braucht einen Titel.',
        cause: parsed.error.flatten(),
      });
    }
    const orders = await withUserTx(c.get('claims'), async (tx) => {
      const angelegt = await tx.query(
        `insert into change_order (project_id, title, trigger_text, bgb_basis, amount_cents,
                                   days_impact, status, agreed_at)
         values ($1, $2, $3, $4, $5, $6, coalesce($7::mbl.change_order_status, 'angefragt'),
                 case when $7 = 'vereinbart' then now() end)`,
        [
          projectId,
          parsed.data.title,
          parsed.data.triggerText ?? null,
          parsed.data.bgbBasis ?? null,
          parsed.data.amountCents ?? null,
          parsed.data.daysImpact ?? null,
          parsed.data.status ?? null,
        ],
      );
      if (angelegt.rowCount === 0) {
        throw new HTTPException(403, { message: 'Nachträge pflegt, wer den Vertrag pflegt.' });
      }
      await refreshContractChecks(tx, projectId);
      return loadChangeOrders(tx, projectId);
    });
    return c.json({ changeOrders: orders }, 201);
  });

  // -- Vertragsspiegel -------------------------------------------------------

  v1.get('/projects/:id/contract', async (c) => {
    const projectId = parseId(c.req.param('id'));
    // Beim Ansehen wird neu geprüft: Ein Spiegel, der einen alten Stand
    // zeigt, ist schlimmer als keiner.
    const mirror = await withUserTx(c.get('claims'), (tx) =>
      refreshContractChecks(tx, projectId),
    );
    return c.json(mirror);
  });

  v1.patch('/projects/:id/contract', async (c) => {
    const projectId = parseId(c.req.param('id'));
    const parsed = contractUpdateRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      throw new HTTPException(422, {
        message: 'Diese Angaben reichen noch nicht. Sieh bitte die markierten Felder durch.',
        cause: parsed.error.flatten(),
      });
    }

    const mirror = await withUserTx(c.get('claims'), async (tx) => {
      const daten = parsed.data;
      const geaendert = await tx.query(
        `update project
            set contract_sum_cents = case when $2::boolean then $3 else contract_sum_cents end,
                contractual_completion = case when $4::boolean then $5 else contractual_completion end,
                security_pct = case when $6::boolean then $7 else security_pct end,
                loan_total_cents = case when $8::boolean then $9 else loan_total_cents end,
                commitment_interest_pct = case when $10::boolean then $11 else commitment_interest_pct end,
                commitment_free_months = case when $12::boolean then $13 else commitment_free_months end
          where id = $1`,
        [
          projectId,
          daten.contractSumCents !== undefined, daten.contractSumCents ?? null,
          daten.contractualCompletion !== undefined, daten.contractualCompletion ?? null,
          daten.securityPct !== undefined, daten.securityPct ?? null,
          daten.loanTotalCents !== undefined, daten.loanTotalCents ?? null,
          daten.commitmentInterestPct !== undefined, daten.commitmentInterestPct ?? null,
          daten.commitmentFreeMonths !== undefined, daten.commitmentFreeMonths ?? null,
        ],
      );
      if (geaendert.rowCount === 0) {
        throw new HTTPException(403, { message: 'Vertragsdaten pflegt der Bauherr.' });
      }

      for (const punkt of daten.descriptionItems ?? []) {
        await tx.query(
          `insert into contract_description_item (project_id, item_key, present, note)
           values ($1, $2, $3, $4)
           on conflict (project_id, item_key) do update
              set present = excluded.present, note = excluded.note`,
          [projectId, punkt.key, punkt.present, punkt.note ?? null],
        );
      }

      return refreshContractChecks(tx, projectId);
    });
    return c.json(mirror);
  });

  v1.post('/projects/:id/contract/findings/:findingId/dismiss', async (c) => {
    const projectId = parseId(c.req.param('id'));
    const findingId = parseId(c.req.param('findingId'));
    const body = (await c.req.json().catch(() => ({}))) as { reason?: string };
    const grund = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (grund.length < 3) {
      throw new HTTPException(422, {
        message: 'Schreib kurz, warum der Hinweis für euch erledigt ist.',
      });
    }
    const mirror = await withUserTx(c.get('claims'), async (tx) => {
      const geaendert = await tx.query(
        `update contract_check set dismissed_at = now(), dismissed_reason = $3
          where id = $1 and project_id = $2`,
        [findingId, projectId, grund],
      );
      if (geaendert.rowCount === 0) {
        throw new HTTPException(404, { message: 'Diesen Hinweis gibt es nicht.' });
      }
      return loadContractMirror(tx, projectId);
    });
    return c.json(mirror);
  });

  // -- Frag den Lotsen -------------------------------------------------------

  /**
   * Ohne Schlüssel gibt es den Lotsen nicht — und er sagt das.
   *
   * 501 und nicht 500: Der Server ist heil, die Funktion ist nur nicht
   * eingerichtet. Dieselbe Haltung wie bei den Fotos ohne Ablage.
   */
  const lotseModel = options.lotseModel === undefined ? modelAusUmgebung() : options.lotseModel;

  v1.post('/projects/:id/lotse', async (c) => {
    const projectId = parseId(c.req.param('id'));
    if (lotseModel === null) {
      throw new HTTPException(501, {
        message: 'Der Lotse ist auf dieser Umgebung nicht eingerichtet.',
        cause: {
          hint: 'Es fehlt ANTHROPIC_API_KEY. Die Lotsenkarten zu jedem Vorgang stehen trotzdem bereit.',
        },
      });
    }

    const parsed = lotseAskRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      throw new HTTPException(422, {
        message: 'Stell die Frage bitte in ganzen Worten — drei Zeichen sind zu wenig.',
        cause: parsed.error.flatten(),
      });
    }

    const antwort = await withUserTx(c.get('claims'), (tx) =>
      frage(tx, projectId, {
        model: lotseModel,
        frage: parsed.data.question,
        ...(parsed.data.conversationId === undefined
          ? {}
          : { conversationId: parsed.data.conversationId }),
        // Das Datum kommt vom Server, nicht aus der Anfrage. Beim
        // Wochenbericht ist `?today=` eine Bequemlichkeit; hier wäre es der
        // erste Griff am Kontext, und der gehört laut 6.4 nicht dem Client.
        today: new Date().toISOString().slice(0, 10),
      }),
    );
    return c.json(antwort, 201);
  });

  v1.get('/projects/:id/lotse', async (c) => {
    const projectId = parseId(c.req.param('id'));
    const conversations = await withUserTx(c.get('claims'), (tx) =>
      loadConversations(tx, projectId),
    );
    return c.json({ conversations, available: lotseModel !== null });
  });

  v1.get('/projects/:id/lotse/:conversationId', async (c) => {
    const projectId = parseId(c.req.param('id'));
    const conversationId = parseId(c.req.param('conversationId'));
    const gespraech = await withUserTx(c.get('claims'), (tx) =>
      loadConversation(tx, projectId, conversationId),
    );
    return c.json(gespraech);
  });

  // -- Tagebuch und Fotos ----------------------------------------------------

  v1.get('/projects/:id/diary', async (c) => {
    const projectId = parseId(c.req.param('id'));
    const entries = await withUserTx(c.get('claims'), (tx) => loadDiary(tx, projectId));
    return c.json({ entries });
  });

  v1.post('/projects/:id/diary', async (c) => {
    const projectId = parseId(c.req.param('id'));
    const parsed = diaryCreateRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      throw new HTTPException(422, {
        message: 'Diese Angaben reichen noch nicht. Sieh bitte die markierten Felder durch.',
        cause: parsed.error.flatten(),
      });
    }
    const entry = await withUserTx(c.get('claims'), (tx) =>
      createDiaryEntry(tx, projectId, parsed.data),
    );
    return c.json(entry, 201);
  });

  v1.patch('/projects/:id/diary/:entryId', async (c) => {
    const projectId = parseId(c.req.param('id'));
    const entryId = parseId(c.req.param('entryId'));
    const parsed = diaryUpdateRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      throw new HTTPException(422, {
        message: 'Diese Angaben reichen noch nicht. Sieh bitte die markierten Felder durch.',
        cause: parsed.error.flatten(),
      });
    }
    const entry = await withUserTx(c.get('claims'), (tx) =>
      updateDiaryEntry(tx, projectId, entryId, parsed.data),
    );
    return c.json(entry);
  });

  // Die Datei liegt schon im Ablagedienst, wenn diese Anfrage kommt — Fotos
  // gehen nie durch diesen Server (Abschnitt 6.1). Hier wird nur festgehalten,
  // was über sie bekannt ist.
  v1.post('/projects/:id/media', async (c) => {
    const projectId = parseId(c.req.param('id'));
    const parsed = mediaCreateRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      throw new HTTPException(422, {
        message: 'Zu diesem Foto fehlen Angaben.',
        cause: parsed.error.flatten(),
      });
    }
    const item = await withUserTx(c.get('claims'), (tx) =>
      registerMedia(tx, projectId, parsed.data),
    );
    return c.json(item, 201);
  });

  // Die Gegenprobe zur Beweiskette. Der Kopf der Kette gehört auf das
  // Deckblatt der Bauakte.
  v1.get('/projects/:id/diary/verify', async (c) => {
    const projectId = parseId(c.req.param('id'));
    const result = await withUserTx(c.get('claims'), (tx) => verifyDiaryChain(tx, projectId));
    return c.json(result);
  });

  v1.get('/projects/:id/photo-prompts', async (c) => {
    const projectId = parseId(c.req.param('id'));
    const fulfilled = await withUserTx(c.get('claims'), (tx) =>
      fulfilledPhotoPrompts(tx, projectId),
    );
    return c.json({ fulfilled });
  });

  // -- Wochenbericht ---------------------------------------------------------

  // Derselbe Bericht, den die Montagsmail verschickt — nur als Ansicht. Er
  // wird unter den Rechten des Fragenden gebaut, wie jede andere Abfrage: Ein
  // Bericht, der mehr sieht als sein Empfänger, wäre ein Leck mit Zustellung.
  //
  // `today` ist überschreibbar, damit sich der Bericht für einen bestimmten
  // Montag ansehen lässt, ohne die Systemuhr zu stellen. Es verschiebt das
  // Fenster, spielt aber keine Vergangenheit nach: Der Block „was sich
  // verschoben hat" misst am tatsächlichen Zeitpunkt der Änderung.
  v1.get('/projects/:id/weekly-report', async (c) => {
    const projectId = parseId(c.req.param('id'));
    const report = await withUserTx(c.get('claims'), (tx) =>
      buildWeeklyReport(tx, projectId, heute(c)),
    );
    return c.json(report);
  });

  // -- Entscheidungen --------------------------------------------------------

  // Antwortet mit dem ganzen Plan, nicht mit der Entscheidung: Wer eine
  // Entscheidung trifft, will als Nächstes wissen, ob der Vorgang dahinter
  // jetzt sicher ist — und das steht im Plan, nicht in der Zeile.
  v1.patch('/projects/:id/decisions/:decisionId', async (c) => {
    const projectId = parseId(c.req.param('id'));
    const decisionId = parseId(c.req.param('decisionId'));
    const parsed = decisionUpdateRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      throw new HTTPException(422, {
        message: 'Diese Angaben reichen noch nicht. Sieh bitte die markierten Felder durch.',
        cause: parsed.error.flatten(),
      });
    }

    const schedule = await withUserTx(c.get('claims'), async (tx) => {
      await updateDecision(tx, projectId, decisionId, parsed.data);
      return loadSchedule(tx, projectId);
    });
    return c.json(schedule);
  });

  // -- Wissensschicht --------------------------------------------------------

  // Die Lotsenkarte zu einem Vorgang. Das Abrufen hält zugleich fest, dass sie
  // offen war — sonst stünde sie weiter unter „lies dich ein", obwohl der
  // Bauherr sie längst gelesen hat.
  v1.get('/projects/:id/tasks/:taskId/guide-card', async (c) => {
    const projectId = parseId(c.req.param('id'));
    const taskId = parseId(c.req.param('taskId'));
    const view = await withUserTx(c.get('claims'), (tx) =>
      loadGuideCardView(tx, projectId, taskId),
    );
    return c.json(view);
  });

  v1.post('/projects/:id/tasks/:taskId/guide-card/feedback', async (c) => {
    const projectId = parseId(c.req.param('id'));
    const taskId = parseId(c.req.param('taskId'));
    const parsed = guideFeedbackRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      throw new HTTPException(422, {
        message: 'Diese Angaben reichen noch nicht. Sieh bitte die markierten Felder durch.',
        cause: parsed.error.flatten(),
      });
    }

    const read = await withUserTx(c.get('claims'), (tx) =>
      recordFeedback(tx, projectId, taskId, parsed.data.helpful),
    );
    return c.json(read);
  });

  v1.patch('/projects/:id/checklist/:itemId', async (c) => {
    const projectId = parseId(c.req.param('id'));
    const itemId = parseId(c.req.param('itemId'));
    const parsed = checklistUpdateRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      throw new HTTPException(422, {
        message: 'Diese Angaben reichen noch nicht. Sieh bitte die markierten Felder durch.',
        cause: parsed.error.flatten(),
      });
    }

    const item = await withUserTx(c.get('claims'), (tx) =>
      updateChecklistItem(tx, projectId, itemId, parsed.data),
    );
    return c.json(item);
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
    // Ein Schreibversuch, den die RLS abweist, ist kein Serverfehler.
    //
    // Postgres meldet ihn als 42501 — „new row violates row-level security
    // policy". Ohne diese Zeilen käme er als 500 heraus, mit dem Satz „Das
    // hat nicht geklappt" und dem Rat, es noch einmal zu versuchen. Beides
    // wäre falsch: Es hat geklappt, die Antwort lautet nur nein, und ein
    // zweiter Versuch ändert daran nichts.
    //
    // Die Zuordnung steht hier und nicht in jedem Modul, weil sie sonst in
    // dem einen Modul fehlt, in dem sie zählt.
    if (istRechteFehler(error)) {
      return c.json(
        {
          error: 'Das darfst du in diesem Bauvorhaben nicht.',
          details: {
            hint: 'Was deine Rolle darf, steht im Plan unter deinem Namen.',
          },
        },
        403,
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

/**
 * Hat die Datenbank den Schreibversuch aus Rechtegründen abgewiesen?
 *
 * `42501` ist `insufficient_privilege` und deckt beides ab: eine verweigerte
 * `with check`-Bedingung und ein fehlendes Tabellenrecht. Beides bedeutet für
 * den Fragenden dasselbe — er darf es nicht.
 */
function istRechteFehler(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return code === '42501';
}

interface ProjectRow {
  id: string;
  name: string;
  federal_state: ProjectSummary['federalState'];
  build_type: ProjectSummary['buildType'];
  contract_type: ProjectSummary['contractType'];
  has_basement: boolean;
  catholic_municipality: boolean;
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
    catholicMunicipality: row.catholic_municipality,
  };
}

/** Der Gast-Token aus dem Kopf `Authorization: Bearer …`. */
function tokenAus(header: string | undefined): string {
  const token = header?.replace(/^Bearer\s+/i, '').trim() ?? '';
  if (token === '') {
    throw new HTTPException(401, {
      message: 'Dieser Link ist unvollständig.',
      cause: { hint: 'Öffne ihn noch einmal aus der Nachricht, die du bekommen hast.' },
    });
  }
  return token;
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
            p.has_basement, p.catholic_municipality, p.planned_start,
                p.contractual_completion, m.role
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

/**
 * Wer beteiligt ist.
 *
 * `hasGuestLink` sagt nur, **ob** es einen gültigen Link gibt — nie welchen.
 * Der Token steht genau einmal in einer Antwort, nämlich beim Anlegen.
 */
async function loadMembers(tx: Tx, projectId: string): Promise<ProjectMemberDto[]> {
  const result = await tx.query<{
    id: string;
    role: ProjectMemberDto['role'];
    display_name: string | null;
    company: string | null;
    email: string | null;
    trade_name: string | null;
    has_account: boolean;
    has_guest_link: boolean;
  }>(
    `select m.id, m.role, m.display_name, m.company, m.email, tr.name as trade_name,
            (m.user_id is not null) as has_account,
            exists (
              select 1 from guest_token g
               where g.member_id = m.id and g.revoked_at is null and g.expires_at > now()
            ) as has_guest_link
       from project_member m
       left join trade tr on tr.id = m.trade_id
      where m.project_id = $1 and m.revoked_at is null
      order by m.role, m.display_name`,
    [projectId],
  );

  return result.rows.map((row) => ({
    id: row.id,
    role: row.role,
    displayName: row.display_name,
    company: row.company,
    email: row.email,
    tradeName: row.trade_name,
    hasAccount: row.has_account,
    hasGuestLink: row.has_guest_link,
  }));
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
    guide_card_key: string | null;
    guide_card_read: boolean;
  }>(
    `select t.id, t.name, t.phase_key, tr.code as trade_code, tr.name as trade_name,
            t.sort_order, t.is_milestone, t.is_wait, t.duration_days, t.duration_unit,
            t.current_start, t.current_end, t.baseline_start, t.baseline_end,
            t.earliest_start, t.actual_start, t.actual_end, t.status, t.confirmation,
            t.total_float_days, t.is_critical, guide.key as guide_card_key,
            (gelesen.id is not null) as guide_card_read
     from task t
     left join trade tr on tr.id = t.trade_id
     ${GUIDE_CARD_KEY_JOIN}
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
    guideCardKey: row.guide_card_key,
    guideCardRead: row.guide_card_read,
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
  const decisions = await loadDecisions(tx, projectId);
  const members = await loadMembers(tx, projectId);

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
    members,
    phases,
    tasks,
    decisions,
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
