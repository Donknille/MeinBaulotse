/**
 * Integrationstest der Abnahme von AP 3:
 *
 * „Wird der Fliesenvorgang verschoben, rückt die Bemusterungsfrist mit und
 * erzeugt eine Warnung. Liegt die Frist in der Vergangenheit, wird sie als
 * überfällig geführt und als möglicher Verzugsgrund angeboten."
 *
 * Der zweite Satz zerfällt in zwei Nachweise an zwei Orten: dass die API eine
 * verstrichene Frist als solche ausweist, steht hier; dass die Oberfläche
 * daraus `bauherren_entscheidung` vorbelegt, steht in `apps/web`.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { closePool, withAdminTx } from '@meinbaulotse/db';
import { workdayOffset, type Calendar } from '@meinbaulotse/schedule';
import { decisionInPlainWords, type DecisionDto, type ProjectSchedule } from '@meinbaulotse/shared';
import { createApp } from './app.js';

const SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long';
process.env['SUPABASE_JWT_SECRET'] = SECRET;

const app = createApp();
const calendar: Calendar = { federalState: 'BY', catholicMunicipality: false };

let bauherrToken: string;
let guToken: string;
let fremderToken: string;
let projectId: string;

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

async function planOf(token = bauherrToken, id = projectId): Promise<ProjectSchedule> {
  const response = await request(`/api/v1/projects/${id}/schedule`, { token });
  expect(response.status).toBe(200);
  return (await response.json()) as ProjectSchedule;
}

function decisionByKey(plan: ProjectSchedule, key: string): DecisionDto {
  const found = plan.decisions.find((entry) => entry.templateKey === key);
  if (found === undefined) throw new Error(`Entscheidung „${key}" fehlt im Plan.`);
  return found;
}

function taskNamed(plan: ProjectSchedule, name: string): ProjectSchedule['tasks'][number] {
  const found = plan.tasks.find((task) => task.name.startsWith(name));
  if (found === undefined) throw new Error(`Vorgang „${name}" steht nicht im Plan.`);
  return found;
}

beforeAll(async () => {
  await withAdminTx(async (tx) => {
    await tx.query(
      `truncate schedule_change, audit_log, checklist_item, guide_card_read, decision,
                dependency, task, project_member, project, expert_org_member, expert_org
                restart identity cascade`,
    );
    await tx.query('delete from auth.users');
  });

  const bauherr = await createUser('entscheidung-bauherr@example.test');
  const gu = await createUser('entscheidung-gu@example.test');
  bauherrToken = await tokenFor(bauherr);
  guToken = await tokenFor(gu);
  fremderToken = await tokenFor(await createUser('entscheidung-fremder@example.test'));

  const created = await request('/api/v1/projects/onboarding', {
    method: 'POST',
    token: bauherrToken,
    body: JSON.stringify({
      name: 'Musterweg 4',
      buildType: 'efh_massiv',
      hasBasement: true,
      plannedStart: '2026-04-01',
      federalState: 'BY',
      contractType: 'verbraucherbauvertrag',
    }),
  });
  expect(created.status).toBe(201);
  projectId = ((await created.json()) as { projectId: string }).projectId;

  await withAdminTx(async (tx) =>
    tx.query(
      `insert into project_member (project_id, user_id, role, display_name, accepted_at)
       values ($1, $2, 'contractor', 'Jörg Baumeister', now())`,
      [projectId, gu],
    ),
  );
});

afterAll(async () => {
  await closePool();
});

describe('Beim Anlegen entstehen die Entscheidungen', () => {
  it('legt die Vorlagen an, die zu den Vorgängen dieses Plans passen', async () => {
    const plan = await planOf();
    expect(plan.decisions.length).toBeGreaterThan(0);
    expect(plan.decisions.every((entry) => entry.status === 'offen')).toBe(true);
    expect(plan.decisions.every((entry) => entry.blocksTaskId !== null)).toBe(true);
  });

  it('rechnet die Frist als Werktage vor dem Beginn des blockierten Vorgangs', async () => {
    const plan = await planOf();
    const fliesen = decisionByKey(plan, 'fliesen');
    const vorgang = taskNamed(plan, 'Fliesenarbeiten');

    expect(fliesen.blocksTaskId).toBe(vorgang.id);
    expect(fliesen.leadTimeDays).toBe(40);
    expect(fliesen.dueDate).toBe(workdayOffset(vorgang.currentStart!, -40, calendar));
  });

  it('kopiert die Entscheidungshilfe aus der Vorlage', async () => {
    const plan = await planOf();
    const fenster = decisionByKey(plan, 'fenster');

    // Die drei Fragen aus Abschnitt 3.2. Eine Frist ohne Hilfe ist eine
    // Aufforderung ohne Auskunft.
    expect(fenster.help.whatItIsAbout).toBeDefined();
    expect(fenster.help.whatDistinguishes).toBeDefined();
    expect(fenster.help.whatPeopleRegret).toBeDefined();
    // Und der Grund für die Vorlaufzeit, sonst liest sich die Frist wie
    // Bürokratie.
    expect(fenster.reason).not.toBeNull();
    expect(fenster.leadTimeDays).toBe(60);
  });

  it('lässt Entscheidungen weg, deren Vorgang es in diesem Plan nicht gibt', async () => {
    // Ohne Keller entstehen keine Kellervorgänge. Für die Entscheidungen aus
    // 7.3 ändert das nichts — keine hängt an einem Kellervorgang —, aber der
    // Weg muss stimmen: Die Wissensschicht folgt dem Plan, nicht der Vorlage.
    const created = await request('/api/v1/projects/onboarding', {
      method: 'POST',
      token: bauherrToken,
      body: JSON.stringify({
        name: 'Ohne Keller',
        buildType: 'efh_massiv',
        hasBasement: false,
        plannedStart: '2026-05-04',
        federalState: 'NI',
        contractType: 'einzelgewerke',
      }),
    });
    const result = (await created.json()) as { projectId: string; decisionCount: number };
    const plan = await planOf(bauherrToken, result.projectId);

    expect(plan.decisions).toHaveLength(result.decisionCount);
    for (const entscheidung of plan.decisions) {
      expect(
        plan.tasks.some((task) => task.id === entscheidung.blocksTaskId),
        `${entscheidung.title} hängt an keinem Vorgang dieses Plans`,
      ).toBe(true);
    }
  });
});

describe('Verschiebt sich der Vorgang, verschiebt sich die Frist', () => {
  it('zieht die Bemusterungsfrist mit, wenn der Fliesenvorgang später beginnt', async () => {
    const vorher = await planOf();
    const fliesen = taskNamed(vorher, 'Fliesenarbeiten');
    const fristVorher = decisionByKey(vorher, 'fliesen').dueDate!;

    // Zehn Werktage später.
    const spaeter = workdayOffset(fliesen.currentStart!, 10, calendar);
    const response = await request(`/api/v1/projects/${projectId}/tasks/${fliesen.id}`, {
      method: 'PATCH',
      token: bauherrToken,
      body: JSON.stringify({ earliestStart: spaeter, reason: 'lieferzeit' }),
    });
    expect(response.status).toBe(200);
    const nachher = (await response.json()) as ProjectSchedule;

    const verschoben = taskNamed(nachher, 'Fliesenarbeiten');
    expect(verschoben.currentStart).toBe(spaeter);

    // Und die Frist ist mitgewandert — genau das macht eine Verschiebung für
    // den Bauherren handlungsrelevant.
    const fristNachher = decisionByKey(nachher, 'fliesen').dueDate!;
    expect(fristNachher).toBe(workdayOffset(spaeter, -40, calendar));
    expect(fristNachher > fristVorher).toBe(true);
  });

  it('holt sie zurück, wenn die Verschiebung zurückgenommen wird', async () => {
    const vorher = await planOf();
    const fliesen = taskNamed(vorher, 'Fliesenarbeiten');

    const response = await request(`/api/v1/projects/${projectId}/tasks/${fliesen.id}`, {
      method: 'PATCH',
      token: bauherrToken,
      body: JSON.stringify({ earliestStart: null, reason: 'planungsaenderung' }),
    });
    const nachher = (await response.json()) as ProjectSchedule;

    const zurueck = taskNamed(nachher, 'Fliesenarbeiten');
    expect(decisionByKey(nachher, 'fliesen').dueDate).toBe(
      workdayOffset(zurueck.currentStart!, -40, calendar),
    );
  });

  it('zieht auch dann nach, wenn der Generalunternehmer verschiebt', async () => {
    // Der interessante Fall: Der GU darf Termine ändern, aber keine
    // Entscheidung pflegen. Ohne die Trennung im Trigger stünde die Anwendung
    // vor der Wahl, entweder veraltete Fristen zu zeigen oder ihm
    // Schreibrechte auf Entscheidungen zu geben.
    const vorher = await planOf(guToken);
    const putz = taskNamed(vorher, 'Innenputz');
    const spaeter = workdayOffset(putz.currentStart!, 5, calendar);

    const response = await request(`/api/v1/projects/${projectId}/tasks/${putz.id}`, {
      method: 'PATCH',
      token: guToken,
      body: JSON.stringify({ earliestStart: spaeter, reason: 'kapazitaet' }),
    });
    expect(response.status).toBe(200);
    const nachher = (await response.json()) as ProjectSchedule;

    const fliesenVorgang = taskNamed(nachher, 'Fliesenarbeiten');
    expect(decisionByKey(nachher, 'fliesen').dueDate).toBe(
      workdayOffset(fliesenVorgang.currentStart!, -40, calendar),
    );

    // Aufräumen, damit die folgenden Proben vom ursprünglichen Plan ausgehen.
    await request(`/api/v1/projects/${projectId}/tasks/${putz.id}`, {
      method: 'PATCH',
      token: bauherrToken,
      body: JSON.stringify({ earliestStart: null, reason: 'planungsaenderung' }),
    });
  });
});

describe('Eine Frist in der Vergangenheit', () => {
  it('wird als verstrichen geführt, wenn der Bau schon läuft', async () => {
    // Ein Bauvorhaben, das vor acht Wochen begonnen hat. Die Fenster hätten
    // sechzig Werktage vor dem Einbau bemustert sein müssen — dieser Zug ist
    // längst abgefahren, und genau das soll die Anwendung sagen.
    const created = await request('/api/v1/projects/onboarding', {
      method: 'POST',
      token: bauherrToken,
      body: JSON.stringify({
        name: 'Läuft schon',
        buildType: 'efh_massiv',
        hasBasement: true,
        plannedStart: new Date(Date.now() - 56 * 86_400_000).toISOString().slice(0, 10),
        federalState: 'BY',
        contractType: 'verbraucherbauvertrag',
      }),
    });
    const laufend = ((await created.json()) as { projectId: string }).projectId;
    const plan = await planOf(bauherrToken, laufend);

    const heute = new Date().toISOString().slice(0, 10);
    const verstrichen = plan.decisions.filter(
      (entry) => entry.dueDate !== null && entry.dueDate < heute,
    );
    expect(verstrichen.length).toBeGreaterThan(0);

    // Der Klartext dazu ist kein Vorwurf, sondern ein Sachverhalt (CI 11.2).
    expect(decisionInPlainWords(-3)).toBe('seit 3 Werktagen offen');
    expect(decisionInPlainWords(-1)).toBe('seit einem Werktag offen');
  });
});

describe('Eine Entscheidung pflegen', () => {
  it('hält Zustand und Notiz fest und stempelt den Zeitpunkt', async () => {
    const plan = await planOf();
    const fliesen = decisionByKey(plan, 'fliesen');

    const response = await request(`/api/v1/projects/${projectId}/decisions/${fliesen.id}`, {
      method: 'PATCH',
      token: bauherrToken,
      body: JSON.stringify({
        status: 'entschieden',
        decidedNote: 'Feinsteinzeug 60×120, matt',
      }),
    });
    expect(response.status).toBe(200);
    const nachher = (await response.json()) as DecisionDto;

    expect(nachher.status).toBe('entschieden');
    expect(nachher.decidedNote).toBe('Feinsteinzeug 60×120, matt');
    expect(nachher.decidedAt).not.toBeNull();
  });

  it('nimmt den Zeitpunkt zurück, wenn die Entscheidung wieder offen ist', async () => {
    const plan = await planOf();
    const fliesen = decisionByKey(plan, 'fliesen');

    const response = await request(`/api/v1/projects/${projectId}/decisions/${fliesen.id}`, {
      method: 'PATCH',
      token: bauherrToken,
      body: JSON.stringify({ status: 'offen' }),
    });
    const nachher = (await response.json()) as DecisionDto;
    expect(nachher.status).toBe('offen');
    expect(nachher.decidedAt).toBeNull();
  });

  it('lehnt eine Änderung ohne Inhalt ab', async () => {
    const plan = await planOf();
    const response = await request(
      `/api/v1/projects/${projectId}/decisions/${plan.decisions[0]!.id}`,
      { method: 'PATCH', token: bauherrToken, body: JSON.stringify({}) },
    );
    expect(response.status).toBe(422);
  });

  it('lässt den Generalunternehmer nicht entscheiden', async () => {
    const plan = await planOf(guToken);
    const fliesen = decisionByKey(plan, 'fliesen');

    const response = await request(`/api/v1/projects/${projectId}/decisions/${fliesen.id}`, {
      method: 'PATCH',
      token: guToken,
      body: JSON.stringify({ status: 'entschieden' }),
    });
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: string };
    // Auch die Fehlanzeige trägt den nächsten Schritt (CI 11.4).
    expect(body.error).toMatch(/pflegt der Bauherr/i);
  });

  it('zeigt sie dem Generalunternehmer trotzdem', async () => {
    const plan = await planOf(guToken);
    expect(plan.decisions.length).toBeGreaterThan(0);
  });

  it('verbirgt sie vor Fremden', async () => {
    const plan = await planOf();
    const response = await request(
      `/api/v1/projects/${projectId}/decisions/${plan.decisions[0]!.id}`,
      { method: 'PATCH', token: fremderToken, body: JSON.stringify({ status: 'entschieden' }) },
    );
    expect(response.status).toBe(404);
  });
});
