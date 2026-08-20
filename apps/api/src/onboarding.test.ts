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
import { SignJWT } from 'jose';
import { closePool, withAdminTx } from '@meinbaulotse/db';
import { projectSchedule, type ProjectSchedule } from '@meinbaulotse/shared';
import { createApp } from './app.js';

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
    const response = await request('/v1/me/projects');
    expect(response.status).toBe(401);
  });

  it('weist ein falsch signiertes Token ab', async () => {
    const fremdSigniert = await new SignJWT({ sub: bauherr })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode('ein-ganz-anderes-geheimnis-mit-32-zeichen'));
    const response = await request('/v1/me/projects', { token: fremdSigniert });
    expect(response.status).toBe(401);
  });

  it('lässt die Gesundheitsprüfung ohne Anmeldung zu', async () => {
    expect((await request('/health')).status).toBe(200);
  });
});

describe('Onboarding mit fünf Fragen', () => {
  let projectId: string;

  it('erzeugt einen vollständigen Plan', async () => {
    const response = await request('/v1/projects/onboarding', {
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
    const response = await request('/v1/me/projects', { token });
    const body = (await response.json()) as { projects: { id: string; role: string }[] };
    expect(body.projects).toHaveLength(1);
    expect(body.projects[0]!.role).toBe('owner');
  });

  it('liefert einen Terminplan mit Phasen und Puffern', async () => {
    const response = await request(`/v1/projects/${projectId}/schedule`, { token });
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
    const response = await request(`/v1/projects/${projectId}/schedule`, { token });
    const parsed = projectSchedule.safeParse(await response.json());
    expect(parsed.success ? null : parsed.error.issues).toBeNull();
  });

  it('setzt die Baseline gleich der ersten Terminlage', async () => {
    const response = await request(`/v1/projects/${projectId}/tasks`, { token });
    const body = (await response.json()) as { tasks: ProjectSchedule['tasks'] };
    for (const task of body.tasks) {
      expect(task.baselineStart, task.name).toBe(task.currentStart);
      expect(task.baselineEnd, task.name).toBe(task.currentEnd);
    }
  });

  it('ordnet jedem Arbeitsvorgang ein Gewerk zu, Meilensteinen keines', async () => {
    const response = await request(`/v1/projects/${projectId}/tasks`, { token });
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
    const entry = await withAdminTx(async (tx) =>
      (
        await tx.query<{ action: string }>(
          'select action from audit_log where project_id = $1',
          [projectId],
        )
      ).rows,
    );
    expect(entry.map((row) => row.action)).toContain('project.created');
  });

  it('verbirgt das Projekt vor Fremden', async () => {
    const response = await request(`/v1/projects/${projectId}/schedule`, { token: fremderToken });
    // 404 statt 403: Ob es dieses Projekt gibt, geht Fremde nichts an.
    expect(response.status).toBe(404);

    const list = await request('/v1/me/projects', { token: fremderToken });
    expect(((await list.json()) as { projects: unknown[] }).projects).toHaveLength(0);
  });
});

describe('Geschuldeter Endtermin', () => {
  it('nennt die Abweichung einmal, und lässt die Puffer der Vorgänge davon unberührt', async () => {
    const response = await request('/v1/projects/onboarding', {
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
      await request(`/v1/projects/${body.projectId}/schedule`, { token })
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
    const list = (await (await request('/v1/me/projects', { token })).json()) as {
      projects: { id: string; name: string }[];
    };
    const ohneTermin = list.projects.find((project) => project.name === 'Musterweg 4')!;
    const schedule = (await (
      await request(`/v1/projects/${ohneTermin.id}/schedule`, { token })
    ).json()) as ProjectSchedule;

    expect(schedule.contractualEnd).toBeNull();
    expect(schedule.deviationWorkdays).toBeNull();
  });
});

describe('Onboarding ohne Keller', () => {
  it('lässt die vier Kellervorgänge weg und wird früher fertig', async () => {
    const response = await request('/v1/projects/onboarding', {
      method: 'POST',
      token,
      body: JSON.stringify({ ...ANTWORTEN, name: 'Ohne Keller', hasBasement: false }),
    });
    const body = (await response.json()) as { projectId: string; taskCount: number; computedEnd: string };

    expect(body.taskCount).toBe(34);
    expect(body.computedEnd).toBe('2026-10-01');

    const schedule = (await (
      await request(`/v1/projects/${body.projectId}/schedule`, { token })
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
    const response = await request('/v1/projects/onboarding', {
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
    const response = await request('/v1/projects/onboarding', {
      method: 'POST',
      token,
      body: JSON.stringify({ name: 'X' }),
    });
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/Angaben/);
  });

  it('lehnt ein unsinniges Datum ab', async () => {
    const response = await request('/v1/projects/onboarding', {
      method: 'POST',
      token,
      body: JSON.stringify({ ...ANTWORTEN, plannedStart: '01.04.2026' }),
    });
    expect(response.status).toBe(422);
  });

  it('lehnt eine ungültige Projektkennung ab', async () => {
    const response = await request('/v1/projects/kein-uuid/schedule', { token });
    expect(response.status).toBe(400);
  });
});
