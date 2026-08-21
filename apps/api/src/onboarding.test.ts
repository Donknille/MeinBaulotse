/**
 * Integrationstest der Abnahme von AP 1:
 *
 * „Onboarding mit fünf Fragen erzeugt einen vollständigen Plan mit 38
 * Vorgängen und plausiblen Terminen."
 *
 * Geprüft wird der ganze Weg — HTTP, JWT, RLS, Berechnungskern, Datenbank —
 * nicht die Einzelteile.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rootCertificates } from 'node:tls';
import { SignJWT } from 'jose';
import {
  closePool,
  describeConnection,
  permissionsOf,
  sslOptions,
  SUPABASE_ROOT_CA_2021,
  withAdminTx,
} from '@meinbaulotse/db';
import { projectSchedule, type ProjectSchedule, type ScheduledTaskDto } from '@meinbaulotse/shared';
import { addDays } from '@meinbaulotse/schedule';
import { createApp, withoutSecrets } from './app.js';

const SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long';
process.env['SUPABASE_JWT_SECRET'] = SECRET;

const app = createApp();
let bauherr: string;
let token: string;
let fremderToken: string;

async function tokenFor(userId: string): Promise<string> {
  return new SignJWT({ sub: userId, role: 'authenticated', email: `${userId}@example.test` })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(SECRET));
}

async function createUser(email: string): Promise<string> {
  return withAdminTx(async (tx) => {
    const result = await tx.query<{ id: string }>(
      'insert into auth.users (email) values ($1) returning id',
      [email],
    );
    return result.rows[0]!.id;
  });
}

function request(path: string, init: RequestInit & { token?: string } = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  if (init.token !== undefined) headers.set('authorization', `Bearer ${init.token}`);
  return app.request(`http://localhost${path}`, { ...init, headers });
}

const ANTWORTEN = {
  name: 'Musterweg 4',
  buildType: 'efh_massiv',
  hasBasement: true,
  plannedStart: '2026-04-01',
  federalState: 'BY',
  contractType: 'verbraucherbauvertrag',
} as const;

beforeAll(async () => {
  await withAdminTx(async (tx) => {
    await tx.query(
      `truncate schedule_change, audit_log, dependency, task, project_member, project,
                expert_org_member, expert_org restart identity cascade`,
    );
    await tx.query('delete from auth.users');
  });
  bauherr = await createUser('bauherr@example.test');
  token = await tokenFor(bauherr);
  fremderToken = await tokenFor(await createUser('fremder@example.test'));
});

afterAll(async () => {
  await closePool();
});

describe('Anmeldung', () => {
  it('weist Anfragen ohne Token ab', async () => {
    const response = await request('/api/v1/me/projects');
    expect(response.status).toBe(401);
  });

  it('weist ein falsch signiertes Token ab', async () => {
    const fremdSigniert = await new SignJWT({ sub: bauherr })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode('ein-ganz-anderes-geheimnis-mit-32-zeichen'));
    const response = await request('/api/v1/me/projects', { token: fremdSigniert });
    expect(response.status).toBe(401);
  });

  it('lässt die Gesundheitsprüfung ohne Anmeldung zu', async () => {
    expect((await request('/api/health')).status).toBe(200);
  });
});

/**
 * Die beiden Auskünfte, die eine leere Liste erklären.
 *
 * Sie sind entstanden, weil im Betrieb eine leere Liste und eine gescheiterte
 * Anfrage gleich aussahen. Wer sie prüft, prüft die Fehlersuche selbst.
 */
describe('Auskunft über Verbindung und Identität', () => {
  it('meldet die Datenbank als erreichbar, ohne Anmeldung', async () => {
    const response = await request('/api/health/db');
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      ok: boolean;
      phases: number;
      roles: number;
      connection: { configured: boolean; port: number | null; poolerUser: boolean };
    };
    expect(body.ok).toBe(true);
    // Die Stammdaten aus 0003_seed.sql. Steht hier 0, fehlen die Migrationen.
    expect(body.phases).toBeGreaterThan(0);
    expect(body.roles).toBeGreaterThan(0);
    expect(body.connection.configured).toBe(true);
  });

  it('nennt die Form der Verbindung, aber kein Geheimnis', async () => {
    // Die Auskunft darf im Betrieb offenstehen. Sie muss deshalb belegbar
    // frei von Host, Benutzer und Passwort sein.
    const shape = describeConnection('postgresql://postgres.abcdef:s3cret@pooler.example:6543/db');
    expect(shape).toEqual({
      configured: true,
      port: 6543,
      tls: true,
      verifyTls: true,
      poolerUser: true,
    });

    const direkt = describeConnection('postgresql://postgres:s3cret@db.example:5432/db');
    expect(direkt).toEqual({
      configured: true,
      port: 5432,
      tls: true,
      verifyTls: true,
      poolerUser: false,
    });

    expect(describeConnection('')).toEqual({
      configured: false,
      port: null,
      tls: false,
      verifyTls: false,
      poolerUser: false,
    });

    const alsText = JSON.stringify(describeConnection('postgresql://u:s3cret@h.example:6543/db'));
    expect(alsText).not.toContain('s3cret');
    expect(alsText).not.toContain('h.example');
  });

  it('hält Zugangsdaten aus Fehlermeldungen heraus', async () => {
    // Der Grund, warum die Fehlermeldung dieser Route überhaupt gezeigt werden
    // darf: Postgres-Adressen tragen das Passwort zwischen `//` und `@`.
    expect(withoutSecrets('connect failed: postgresql://user:s3cret@db.example:5432/x')).toBe(
      'connect failed: postgresql://***@db.example:5432/x',
    );
    expect(withoutSecrets('nichts zu maskieren')).toBe('nichts zu maskieren');
  });

  it('vertraut Supabases Wurzel zusätzlich zu den bekannten', () => {
    // Der Pooler weist sich mit einer selbstsignierten Wurzel aus. Ohne diesen
    // Anker endet jede Verbindung in „self-signed certificate in certificate
    // chain", und zwar erst im Betrieb — lokal läuft Postgres ohne TLS.
    const optionen = sslOptions('postgresql://u:p@pooler.example:6543/db');
    expect(optionen).not.toBe(false);
    const { ca, rejectUnauthorized } = optionen as { ca: string[]; rejectUnauthorized: boolean };

    // Die Prüfung bleibt scharf. Abgeschaltet wird sie nur über eine
    // ausdrücklich gesetzte Umgebungsvariable.
    expect(rejectUnauthorized).toBe(true);

    // `ca` ersetzt in Node den Vertrauensspeicher, statt ihn zu ergänzen.
    // Stünde hier nur Supabases Wurzel, liefe keine andere Datenbank mit
    // öffentlichem Zertifikat mehr.
    expect(ca).toContain(SUPABASE_ROOT_CA_2021);
    expect(ca.length).toBe(rootCertificates.length + 1);
    for (const bekannt of rootCertificates) expect(ca).toContain(bekannt);

    // Lokal ohne TLS, sonst bräuchte die Entwicklungsdatenbank ein Zertifikat.
    expect(sslOptions('postgresql://postgres:postgres@localhost:5432/db')).toBe(false);
  });

  it('schaltet die Prüfung nur auf ausdrückliche Ansage ab', () => {
    const vorher = process.env['DATABASE_SSL_NO_VERIFY'];
    try {
      process.env['DATABASE_SSL_NO_VERIFY'] = '1';
      expect(sslOptions('postgresql://u:p@pooler.example:6543/db')).toEqual({
        rejectUnauthorized: false,
      });
      expect(describeConnection('postgresql://u:p@pooler.example:6543/db').verifyTls).toBe(false);
    } finally {
      if (vorher === undefined) delete process.env['DATABASE_SSL_NO_VERIFY'];
      else process.env['DATABASE_SSL_NO_VERIFY'] = vorher;
    }
  });

  it('meldet eine nicht eingespielte Migration, statt „ok" zu sagen', async () => {
    // Der teuerste Fehler dieser Sitzung: Migration 0004 fügte
    // `task.earliest_start` hinzu, die Auslieferung ging live, die Migration
    // fehlte — und jede Planansicht endete in „column t.earliest_start does
    // not exist". Diese Prüfung meldete dabei `ok: true`, weil sie nur die
    // Verbindung ansah. Eine stehende Verbindung ist keine brauchbare
    // Datenbank.
    // Eine eigene Kennung mit eigenem Bauvorhaben, damit dieser Test keine
    // Datenlage hinterlässt, über die spätere Fälle stolpern.
    const eigener = await tokenFor(await createUser('schemaprobe@example.test'));
    const angelegt = await request('/api/v1/projects/onboarding', {
      method: 'POST',
      token: eigener,
      body: JSON.stringify({ ...ANTWORTEN, name: 'Schemaprobe' }),
    });
    const { projectId } = (await angelegt.json()) as { projectId: string };

    await withAdminTx((tx) => tx.query('alter table task drop column earliest_start'));
    try {
      const response = await request('/api/health/db');
      expect(response.status).toBe(503);

      const body = (await response.json()) as {
        ok: boolean;
        detail: string;
        schema: { current: boolean; missingMigrations: string[] };
      };
      expect(body.ok).toBe(false);
      expect(body.schema.current).toBe(false);
      // Nicht die Spalte nennen, sondern die Datei — daraus folgt eine
      // Handlung.
      expect(body.schema.missingMigrations).toEqual(['0004_task_constraint.sql']);
      expect(body.detail).toContain('0004_task_constraint.sql');

      // Und der 500er einer echten Route nennt denselben Zusammenhang.
      const plan = await request(`/api/v1/projects/${projectId}/schedule`, { token: eigener });
      expect(plan.status).toBe(500);
      const fehler = (await plan.json()) as { schemaHint?: string };
      expect(fehler.schemaHint).toContain('earliest_start');
    } finally {
      await withAdminTx((tx) => tx.query('alter table task add column earliest_start date'));
    }
  });

  it('verlangt für die Identität eine Anmeldung', async () => {
    expect((await request('/api/v1/me')).status).toBe(401);
  });

  it('nennt dieselbe Kennung, die im Token steht', async () => {
    const response = await request('/api/v1/me', { token });
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      tokenSub: string;
      databaseUserId: string | null;
      email: string | null;
      memberships: number;
    };

    // Der Kern: Was das Token behauptet, und was die Datenbank daraus macht.
    // Fällt das auseinander, bleibt jede Liste leer, obwohl Daten da sind.
    expect(body.tokenSub).toBe(bauherr);
    expect(body.databaseUserId).toBe(bauherr);
    expect(body.email).toBe(`${bauherr}@example.test`);
  });

  it('zählt nur die Beteiligungen der eigenen Kennung', async () => {
    // Eine eigene Kennung, damit dieser Test keine Datenlage hinterlässt, auf
    // die spätere Fälle stoßen.
    const eigener = await tokenFor(await createUser('zaehlprobe@example.test'));

    const vorher = (await (await request('/api/v1/me', { token: eigener })).json()) as {
      memberships: number;
    };
    expect(vorher.memberships).toBe(0);

    await request('/api/v1/projects/onboarding', {
      method: 'POST',
      token: eigener,
      body: JSON.stringify({ ...ANTWORTEN, name: 'Zählprobe' }),
    });

    const nachher = (await (await request('/api/v1/me', { token: eigener })).json()) as {
      memberships: number;
    };
    expect(nachher.memberships).toBe(1);

    // Ein Unbeteiligter zählt nicht mit — die Zahl kommt aus der RLS, nicht
    // aus einer Gesamtsumme.
    const fremder = (await (await request('/api/v1/me', { token: fremderToken })).json()) as {
      memberships: number;
    };
    expect(fremder.memberships).toBe(0);
  });
});

describe('Onboarding mit fünf Fragen', () => {
  let projectId: string;

  it('erzeugt einen vollständigen Plan', async () => {
    const response = await request('/api/v1/projects/onboarding', {
      method: 'POST',
      token,
      body: JSON.stringify(ANTWORTEN),
    });

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      projectId: string;
      taskCount: number;
      dependencyCount: number;
      computedEnd: string;
    };

    projectId = body.projectId;
    expect(body.taskCount).toBe(38);
    expect(body.dependencyCount).toBe(43);
    expect(body.computedEnd).toBe('2026-10-19');
  });

  it('trägt den Bauherrn als owner ein', async () => {
    const response = await request('/api/v1/me/projects', { token });
    const body = (await response.json()) as { projects: { id: string; role: string }[] };
    expect(body.projects).toHaveLength(1);
    expect(body.projects[0]!.role).toBe('owner');
  });

  it('liefert einen Terminplan mit Phasen und Puffern', async () => {
    const response = await request(`/api/v1/projects/${projectId}/schedule`, { token });
    expect(response.status).toBe(200);
    const schedule = (await response.json()) as ProjectSchedule;

    expect(schedule.tasks).toHaveLength(38);
    expect(schedule.phases).toHaveLength(9);
    expect(schedule.computedEnd).toBe('2026-10-19');

    const estrich = schedule.tasks.find((task) => task.name === 'Estrich')!;
    expect(estrich.currentStart).toBe('2026-07-31');
    expect(estrich.isCritical).toBe(true);

    const trocknung = schedule.tasks.find((task) => task.name === 'Trocknung bis Belegreife')!;
    expect(trocknung.isWait).toBe(true);
    expect(trocknung.durationUnit).toBe('kalendertage');
    expect(trocknung.durationDays).toBe(35);

    const innentueren = schedule.tasks.find((task) => task.name === 'Innentüren')!;
    expect(innentueren.totalFloatDays).toBe(35);
    expect(innentueren.isCritical).toBe(false);
  });

  it('liefert Daten, die dem geteilten Vertrag entsprechen', async () => {
    // Fängt unter anderem ab, dass der Treiber aus einer date-Spalte einen
    // Zeitstempel macht — der häufigste Weg, wie sich ein Termin um einen Tag
    // verschiebt.
    const response = await request(`/api/v1/projects/${projectId}/schedule`, { token });
    const parsed = projectSchedule.safeParse(await response.json());
    expect(parsed.success ? null : parsed.error.issues).toBeNull();
  });

  it('setzt die Baseline gleich der ersten Terminlage', async () => {
    const response = await request(`/api/v1/projects/${projectId}/tasks`, { token });
    const body = (await response.json()) as { tasks: ProjectSchedule['tasks'] };
    for (const task of body.tasks) {
      expect(task.baselineStart, task.name).toBe(task.currentStart);
      expect(task.baselineEnd, task.name).toBe(task.currentEnd);
    }
  });

  it('ordnet jedem Arbeitsvorgang ein Gewerk zu, Meilensteinen keines', async () => {
    const response = await request(`/api/v1/projects/${projectId}/tasks`, { token });
    const body = (await response.json()) as { tasks: ProjectSchedule['tasks'] };
    const ohneGewerk = body.tasks.filter((task) => task.tradeCode === null);
    // Die vier Meilensteine und die beiden Wartezeiten haben kein Gewerk.
    expect(ohneGewerk).toHaveLength(6);
  });

  it('legt für jeden Vorgang einen Historieneintrag an', async () => {
    const count = await withAdminTx(async (tx) =>
      Number(
        (
          await tx.query<{ count: string }>(
            `select count(*)::text as count from schedule_change
             where project_id = $1 and field = 'task_created'`,
            [projectId],
          )
        ).rows[0]!.count,
      ),
    );
    expect(count).toBe(38);
  });

  it('hält den Projektstart im Protokoll fest', async () => {
    const entry = await withAdminTx(
      async (tx) =>
        (
          await tx.query<{ action: string }>('select action from audit_log where project_id = $1', [
            projectId,
          ])
        ).rows,
    );
    expect(entry.map((row) => row.action)).toContain('project.created');
  });

  it('verbirgt das Projekt vor Fremden', async () => {
    const response = await request(`/api/v1/projects/${projectId}/schedule`, {
      token: fremderToken,
    });
    // 404 statt 403: Ob es dieses Projekt gibt, geht Fremde nichts an.
    expect(response.status).toBe(404);

    const list = await request('/api/v1/me/projects', { token: fremderToken });
    expect(((await list.json()) as { projects: unknown[] }).projects).toHaveLength(0);
  });
});

describe('Geschuldeter Endtermin', () => {
  it('nennt die Abweichung einmal, und lässt die Puffer der Vorgänge davon unberührt', async () => {
    const response = await request('/api/v1/projects/onboarding', {
      method: 'POST',
      token,
      body: JSON.stringify({
        ...ANTWORTEN,
        name: 'Mit Vertragstermin',
        contractualCompletion: '2026-09-30',
      }),
    });
    const body = (await response.json()) as { projectId: string; deviationWorkdays: number | null };

    // Errechnet 19.10., geschuldet 30.09. — dazwischen liegen 13 Werktage.
    expect(body.deviationWorkdays).toBe(13);

    const schedule = (await (
      await request(`/api/v1/projects/${body.projectId}/schedule`, { token })
    ).json()) as ProjectSchedule;

    expect(schedule.deviationWorkdays).toBe(13);
    expect(schedule.contractualEnd).toBe('2026-09-30');

    // Der Puffer je Vorgang misst gegen den eigenen Plan. Wäre er gegen den
    // Vertrag gemessen, trüge jede der 38 Zeilen dieselbe schlechte Nachricht.
    const negative = schedule.tasks.filter(
      (task) => task.totalFloatDays !== null && task.totalFloatDays < 0,
    );
    expect(negative).toHaveLength(0);

    const innentueren = schedule.tasks.find((task) => task.name === 'Innentüren')!;
    expect(innentueren.totalFloatDays).toBe(35);
  });

  it('lässt die Abweichung offen, solange kein Termin erfasst ist', async () => {
    const list = (await (await request('/api/v1/me/projects', { token })).json()) as {
      projects: { id: string; name: string }[];
    };
    const ohneTermin = list.projects.find((project) => project.name === 'Musterweg 4')!;
    const schedule = (await (
      await request(`/api/v1/projects/${ohneTermin.id}/schedule`, { token })
    ).json()) as ProjectSchedule;

    expect(schedule.contractualEnd).toBeNull();
    expect(schedule.deviationWorkdays).toBeNull();
  });
});

describe('Onboarding ohne Keller', () => {
  it('lässt die vier Kellervorgänge weg und wird früher fertig', async () => {
    const response = await request('/api/v1/projects/onboarding', {
      method: 'POST',
      token,
      body: JSON.stringify({ ...ANTWORTEN, name: 'Ohne Keller', hasBasement: false }),
    });
    const body = (await response.json()) as {
      projectId: string;
      taskCount: number;
      computedEnd: string;
    };

    expect(body.taskCount).toBe(34);
    expect(body.computedEnd).toBe('2026-10-01');

    const schedule = (await (
      await request(`/api/v1/projects/${body.projectId}/schedule`, { token })
    ).json()) as ProjectSchedule;

    const namen = schedule.tasks.map((task) => task.name);
    expect(namen).not.toContain('Kellerwände');
    expect(namen).not.toContain('Verfüllung Arbeitsraum');

    // Das Erdgeschoss hängt jetzt direkt an der Aushärtung der Bodenplatte.
    const aushaertung = schedule.tasks.find((task) => task.name === 'Aushärtung Bodenplatte')!;
    const erdgeschoss = schedule.tasks.find((task) => task.name === 'Erdgeschoss-Mauerwerk')!;
    expect(aushaertung.currentEnd).toBe('2026-04-23');
    expect(erdgeschoss.currentStart).toBe('2026-04-24');
  });
});

describe('Das Bundesland verändert den Plan', () => {
  it('bringt Niedersachsen früher ans Ziel als Bayern', async () => {
    const response = await request('/api/v1/projects/onboarding', {
      method: 'POST',
      token,
      body: JSON.stringify({ ...ANTWORTEN, name: 'Niedersachsen', federalState: 'NI' }),
    });
    const body = (await response.json()) as { computedEnd: string };
    expect(body.computedEnd < '2026-10-19').toBe(true);
  });
});

describe('Eingabeprüfung', () => {
  it('lehnt unvollständige Angaben mit einem hilfreichen Hinweis ab', async () => {
    const response = await request('/api/v1/projects/onboarding', {
      method: 'POST',
      token,
      body: JSON.stringify({ name: 'X' }),
    });
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/Angaben/);
  });

  it('lehnt ein unsinniges Datum ab', async () => {
    const response = await request('/api/v1/projects/onboarding', {
      method: 'POST',
      token,
      body: JSON.stringify({ ...ANTWORTEN, plannedStart: '01.04.2026' }),
    });
    expect(response.status).toBe(422);
  });

  it('lehnt eine ungültige Projektkennung ab', async () => {
    const response = await request('/api/v1/projects/kein-uuid/schedule', { token });
    expect(response.status).toBe(400);
  });
});

/**
 * Ein Projekt mit zwei Beteiligten.
 *
 * Solange nur der Bauherr im Projekt stand, konnte eine Abfrage über
 * `project_member` ohne Bezug auf den Fragenden richtig aussehen und trotzdem
 * falsch sein. Diese Fälle halten das fest.
 */
describe('Zwei Rollen in einem Projekt', () => {
  let projectId: string;
  let guToken: string;

  beforeAll(async () => {
    const response = await request('/api/v1/projects/onboarding', {
      method: 'POST',
      token,
      body: JSON.stringify({ ...ANTWORTEN, name: 'Zwei Beteiligte' }),
    });
    projectId = ((await response.json()) as { projectId: string }).projectId;

    const gu = await createUser('gu@example.test');
    guToken = await tokenFor(gu);
    await withAdminTx((tx) =>
      tx.query(
        `insert into project_member (project_id, user_id, role, display_name, accepted_at)
         values ($1, $2, 'contractor', 'Baumeister', now())`,
        [projectId, gu],
      ),
    );
  });

  it('nennt jedem seine eigene Rolle, und das Projekt genau einmal', async () => {
    const alsBauherr = (await (await request('/api/v1/me/projects', { token })).json()) as {
      projects: { id: string; role: string }[];
    };
    const alsGu = (await (await request('/api/v1/me/projects', { token: guToken })).json()) as {
      projects: { id: string; role: string }[];
    };

    expect(alsBauherr.projects.filter((p) => p.id === projectId)).toHaveLength(1);
    expect(alsBauherr.projects.find((p) => p.id === projectId)?.role).toBe('owner');

    expect(alsGu.projects).toHaveLength(1);
    expect(alsGu.projects[0]!.role).toBe('contractor');
  });

  it('liefert die Rechte aus der Rechtematrix der Datenbank', async () => {
    const alsBauherr = (await (
      await request(`/api/v1/projects/${projectId}/schedule`, { token })
    ).json()) as ProjectSchedule;
    const alsGu = (await (
      await request(`/api/v1/projects/${projectId}/schedule`, { token: guToken })
    ).json()) as ProjectSchedule;

    expect([...alsBauherr.permissions].sort()).toEqual([...permissionsOf('owner')].sort());
    expect([...alsGu.permissions].sort()).toEqual([...permissionsOf('contractor')].sort());

    // Die Stellen, an denen sich die beiden Rollen unterscheiden müssen.
    expect(alsGu.permissions).toContain('task.schedule');
    expect(alsGu.permissions).not.toContain('payment.release');
    expect(alsGu.permissions).not.toContain('member.invite');
  });
});

/**
 * Abnahme von AP 4, Kern: „Ein verschobener Vorgang schlaegt korrekt
 * Folgevorgaenge vor, der Endtermin verschiebt sich um den erwarteten Wert,
 * der Aenderungseintrag ist per SQL nicht aenderbar."
 *
 * Geprueft wird der ganze Weg — HTTP, RLS, Berechnungskern, Trigger —, nicht
 * die Einzelteile.
 */
describe('Verschieben und Fortschritt melden', () => {
  let projectId: string;
  let tasks: ScheduledTaskDto[];

  async function planLaden(token: string): Promise<ProjectSchedule> {
    const response = await request(`/api/v1/projects/${projectId}/schedule`, { token });
    return projectSchedule.parse(await response.json());
  }

  beforeAll(async () => {
    const response = await request('/api/v1/projects/onboarding', {
      method: 'POST',
      token,
      body: JSON.stringify({ ...ANTWORTEN, name: 'Verschiebeprobe' }),
    });
    projectId = ((await response.json()) as { projectId: string }).projectId;
    tasks = (await planLaden(token)).tasks;
  });

  it('zieht die Folgevorgänge nach und verschiebt den Endtermin', async () => {
    const vorher = await planLaden(token);
    // Der erste Vorgang auf dem kritischen Pfad: Was hier passiert, muss bis
    // ans Ende durchschlagen.
    const vorgang = vorher.tasks.find((t) => t.isCritical && !t.isMilestone)!;
    const nachfolger = vorher.tasks.filter(
      (t) => t.currentStart !== null && t.currentStart > vorgang.currentEnd!,
    ).length;
    expect(nachfolger).toBeGreaterThan(0);

    const verschobenAuf = addDays(vorgang.currentStart!, 14);
    const response = await request(`/api/v1/projects/${projectId}/tasks/${vorgang.id}`, {
      method: 'PATCH',
      token,
      body: JSON.stringify({ earliestStart: verschobenAuf, reason: 'lieferzeit' }),
    });
    expect(response.status).toBe(200);

    const nachher = projectSchedule.parse(await response.json());
    const neu = nachher.tasks.find((t) => t.id === vorgang.id)!;

    // Der Vorgang liegt nicht mehr vor der Beschränkung.
    expect(neu.currentStart! >= verschobenAuf).toBe(true);
    // Und das Bauvorhaben endet später als vorher.
    expect(nachher.computedEnd! > vorher.computedEnd!).toBe(true);
    // Die Antwort ist derselbe Plan, den ein erneutes Lesen liefert.
    expect(await planLaden(token)).toEqual(nachher);
  });

  it('schreibt die Verschiebung mit Grund in die Historie', async () => {
    const eintraege = await withAdminTx(async (tx) =>
      tx.query<{ field: string; reason_code: string | null; actor_channel: string }>(
        `select field, reason_code, actor_channel from schedule_change
          where project_id = $1 and field in ('current_start', 'current_end')
          order by created_at desc limit 5`,
        [projectId],
      ),
    );
    expect(eintraege.rows.length).toBeGreaterThan(0);
    expect(eintraege.rows.every((r) => r.reason_code === 'lieferzeit')).toBe(true);
    expect(eintraege.rows.every((r) => r.actor_channel === 'app')).toBe(true);
  });

  it('verlangt für eine Verschiebung einen Grund', async () => {
    const response = await request(`/api/v1/projects/${projectId}/tasks/${tasks[0]!.id}`, {
      method: 'PATCH',
      token,
      body: JSON.stringify({ earliestStart: '2027-01-04' }),
    });
    expect(response.status).toBe(422);
  });

  it('nimmt einen gemeldeten Ist-Beginn als Tatsache, nicht als Wunsch', async () => {
    const vorher = await planLaden(token);
    const vorgang = vorher.tasks[0]!;
    // Zwei Werktage vor dem gerechneten Beginn: Eine Beschränkung koennte das
    // nicht, ein Ist-Termin schon — er ueberschreibt die Rechnung.
    const frueher = addDays(vorgang.currentStart!, -4);

    const response = await request(`/api/v1/projects/${projectId}/tasks/${vorgang.id}`, {
      method: 'PATCH',
      token,
      body: JSON.stringify({ actualStart: frueher, status: 'laeuft' }),
    });
    expect(response.status).toBe(200);

    const nachher = projectSchedule.parse(await response.json());
    const neu = nachher.tasks.find((t) => t.id === vorgang.id)!;
    expect(neu.actualStart).toBe(frueher);
    expect(neu.currentStart).toBe(frueher);
    expect(neu.status).toBe('laeuft');
  });

  it('lässt einen Unbeteiligten nicht an fremde Vorgänge', async () => {
    const response = await request(`/api/v1/projects/${projectId}/tasks/${tasks[0]!.id}`, {
      method: 'PATCH',
      token: fremderToken,
      body: JSON.stringify({ status: 'entfallen' }),
    });
    // Nicht 403: Ein 403 verriete, dass es diesen Vorgang gibt.
    expect(response.status).toBe(404);
  });

  it('nimmt eine Verschiebung zurück, wenn die Beschränkung gelöscht wird', async () => {
    const vorgang = (await planLaden(token)).tasks.find((t) => t.isCritical && !t.isMilestone)!;
    const response = await request(`/api/v1/projects/${projectId}/tasks/${vorgang.id}`, {
      method: 'PATCH',
      token,
      body: JSON.stringify({ earliestStart: null, reason: 'planungsaenderung' }),
    });
    expect(response.status).toBe(200);

    const nachher = projectSchedule.parse(await response.json());
    const neu = nachher.tasks.find((t) => t.id === vorgang.id)!;
    // Ohne Beschränkung rechnet der Kern wieder frei — der Vorgang rutscht
    // nach vorn, soweit seine Vorgaenger es zulassen.
    expect(neu.currentStart! < vorgang.currentStart!).toBe(true);
  });
});
