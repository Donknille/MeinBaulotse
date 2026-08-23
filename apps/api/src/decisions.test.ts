/**
 * Integrationstest der Abnahme von AP 3:
 *
 * „Wird der Fliesenvorgang um zehn Werktage vorgezogen, rückt die
 * Bemusterungsfrist mit und erzeugt eine Warnung. Liegt die Frist in der
 * Vergangenheit, wird sie als überfällig geführt und als möglicher
 * Verzugsgrund angeboten."
 *
 * Die Frist ist eine abgeleitete Größe, kein eigener Termin. Genau das wird
 * hier geprüft: Sie darf nirgendwo eigenständig stehen bleiben.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { closePool, withAdminTx } from '@meinbaulotse/db';
import { workdayOffset, type Calendar } from '@meinbaulotse/schedule';
import {
  decisionDueInPlainWords,
  projectSchedule,
  type DecisionDto,
  type ProjectSchedule,
} from '@meinbaulotse/shared';
import { createApp } from './app.js';

const SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long';
process.env['SUPABASE_JWT_SECRET'] = SECRET;

const app = createApp();
const KALENDER: Calendar = { federalState: 'BY', catholicMunicipality: false };

let bauherrToken: string;
let gastToken: string;
let projektId: string;

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

async function plan(token = bauherrToken): Promise<ProjectSchedule> {
  const response = await request(`/api/v1/projects/${projektId}/schedule`, { token });
  return (await response.json()) as ProjectSchedule;
}

const finde = (schedule: ProjectSchedule, key: string): DecisionDto => {
  const entscheidung = schedule.decisions.find((d) => d.templateKey === key);
  if (entscheidung === undefined) throw new Error(`Entscheidung „${key}" fehlt im Plan.`);
  return entscheidung;
};

beforeAll(async () => {
  await withAdminTx(async (tx) => {
    await tx.query(
      `truncate schedule_change, audit_log, dependency, task, project_member, project,
                expert_org_member, expert_org restart identity cascade`,
    );
    await tx.query('delete from auth.users');
  });

  bauherrToken = await tokenFor(await createUser('entscheider@example.test'));
  gastToken = await tokenFor(await createUser('entscheider-fremd@example.test'));

  const angelegt = await request('/api/v1/projects/onboarding', {
    method: 'POST',
    token: bauherrToken,
    body: JSON.stringify({
      name: 'Entscheiderweg 3',
      buildType: 'efh_massiv',
      hasBasement: true,
      plannedStart: '2026-04-01',
      federalState: 'BY',
      contractType: 'verbraucherbauvertrag',
    }),
  });
  projektId = ((await angelegt.json()) as { projectId: string }).projectId;
});

afterAll(async () => {
  await closePool();
});

describe('Die Entscheidungen entstehen beim Onboarding', () => {
  it('legt alle vierzehn Vorlagen an', async () => {
    const schedule = await plan();
    expect(schedule.decisions).toHaveLength(14);
    expect(schedule.decisions.every((d) => d.status === 'offen')).toBe(true);
  });

  it('genügt dem geteilten Vertrag', async () => {
    // Was hier durchgeht, kann die Oberfläche auch verarbeiten.
    expect(() => projectSchedule.parse(plan)).toBeTruthy();
    const response = await request(`/api/v1/projects/${projektId}/schedule`, {
      token: bauherrToken,
    });
    expect(() => projectSchedule.parse(response.clone().json())).toBeTruthy();
    const parsed = projectSchedule.safeParse(await response.json());
    expect(parsed.success, JSON.stringify(parsed.error?.flatten())).toBe(true);
  });

  it('rechnet die Frist als Werktage vor dem Beginn des Vorgangs', async () => {
    const schedule = await plan();
    const fliesen = finde(schedule, 'fliesen');
    const vorgang = schedule.tasks.find((task) => task.id === fliesen.blocksTaskId)!;

    expect(fliesen.leadTimeDays).toBe(40);
    expect(fliesen.dueDate).toBe(workdayOffset(vorgang.currentStart!, -40, KALENDER));
  });

  it('trägt zu jeder Entscheidung eine Entscheidungshilfe', async () => {
    const schedule = await plan();
    for (const entscheidung of schedule.decisions) {
      expect(entscheidung.helpText, entscheidung.title).not.toBeNull();
      expect(entscheidung.helpText!.length, entscheidung.title).toBeGreaterThan(120);
    }
  });

  it('nennt den Vorgang, an dem die Frist hängt', async () => {
    const schedule = await plan();
    expect(finde(schedule, 'fliesen').blocksTaskName).toContain('Fliesen');
    expect(finde(schedule, 'fenster').blocksTaskName).toContain('Fenster');
  });
});

describe('Die Frist wandert mit dem Vorgang', () => {
  it('rückt mit, wenn der Vorgang vorgezogen wird — die Abnahme von AP 3', async () => {
    const anfang = await plan();
    const fliesenAnfang = finde(anfang, 'fliesen');
    const vorgang = anfang.tasks.find((task) => task.id === fliesenAnfang.blocksTaskId)!;

    // Erst nach hinten schieben. Ohne diesen Schritt ginge „vorziehen" gar
    // nicht: Vor dem Fliesenvorgang liegt die Estrichtrocknung, und die ist
    // eine technologische Wartezeit — der Vorgang sitzt an seinem frühesten
    // möglichen Tag und lässt sich von dort nicht wegziehen. Genau diese
    // Eigenart des Bauablaufs macht die Rechnung erst interessant.
    const geschoben = workdayOffset(vorgang.currentStart!, 20, KALENDER);
    const nachDemSchieben = (await (
      await request(`/api/v1/projects/${projektId}/tasks/${vorgang.id}`, {
        method: 'PATCH',
        token: bauherrToken,
        body: JSON.stringify({ earliestStart: geschoben, reason: 'lieferzeit' }),
      })
    ).json()) as ProjectSchedule;

    const startVorher = nachDemSchieben.tasks.find((t) => t.id === vorgang.id)!.currentStart!;
    const fristVorher = finde(nachDemSchieben, 'fliesen').dueDate!;
    expect(fristVorher).toBe(workdayOffset(startVorher, -40, KALENDER));

    // Und jetzt zehn Werktage vorziehen.
    const vorgezogen = workdayOffset(startVorher, -10, KALENDER);
    const antwort = await request(`/api/v1/projects/${projektId}/tasks/${vorgang.id}`, {
      method: 'PATCH',
      token: bauherrToken,
      body: JSON.stringify({ earliestStart: vorgezogen, reason: 'planungsaenderung' }),
    });
    expect(antwort.status).toBe(200);

    const nachher = (await antwort.json()) as ProjectSchedule;
    const startNachher = nachher.tasks.find((t) => t.id === vorgang.id)!.currentStart!;
    const fristNachher = finde(nachher, 'fliesen').dueDate!;

    expect(startNachher).toBe(vorgezogen);
    // Die Frist ist mitgewandert, und zwar um dieselben zehn Werktage.
    expect(fristNachher).toBe(workdayOffset(startNachher, -40, KALENDER));
    expect(fristNachher).toBe(workdayOffset(fristVorher, -10, KALENDER));
    expect(fristNachher < fristVorher).toBe(true);

    // Beschränkung wieder herausnehmen, damit die folgenden Fälle auf dem
    // ursprünglichen Plan stehen.
    await request(`/api/v1/projects/${projektId}/tasks/${vorgang.id}`, {
      method: 'PATCH',
      token: bauherrToken,
      body: JSON.stringify({ earliestStart: null, reason: 'planungsaenderung' }),
    });
    expect(finde(await plan(), 'fliesen').dueDate).toBe(fliesenAnfang.dueDate);
  });

  it('wandert auch nach hinten, wenn der Vorgang später liegt', async () => {
    const vorher = await plan();
    const innentueren = finde(vorher, 'innentueren');
    const vorgang = vorher.tasks.find((task) => task.id === innentueren.blocksTaskId)!;

    const spaeter = workdayOffset(vorgang.currentStart!, 15, KALENDER);
    const antwort = await request(`/api/v1/projects/${projektId}/tasks/${vorgang.id}`, {
      method: 'PATCH',
      token: bauherrToken,
      body: JSON.stringify({ earliestStart: spaeter, reason: 'lieferzeit' }),
    });

    const nachher = (await antwort.json()) as ProjectSchedule;
    const nachherEntscheidung = finde(nachher, 'innentueren');
    expect(nachherEntscheidung.dueDate! > innentueren.dueDate!).toBe(true);
  });

  it('rührt Fristen nicht an, deren Vorgang sich nicht bewegt hat', async () => {
    const vorher = await plan();
    const versicherungen = finde(vorher, 'versicherungen');

    const irgendeinSpaeter = vorher.tasks.find((task) => task.name.includes('Malerarbeiten'))!;
    await request(`/api/v1/projects/${projektId}/tasks/${irgendeinSpaeter.id}`, {
      method: 'PATCH',
      token: bauherrToken,
      body: JSON.stringify({
        earliestStart: workdayOffset(irgendeinSpaeter.currentStart!, 3, KALENDER),
        reason: 'kapazitaet',
      }),
    });

    const nachher = await plan();
    expect(finde(nachher, 'versicherungen').dueDate).toBe(versicherungen.dueDate);
  });
});

describe('Eine Entscheidung treffen', () => {
  it('nimmt Stand, Notiz und geschätzte Kosten an', async () => {
    const vorher = await plan();
    const dachziegel = finde(vorher, 'dachziegel');

    const antwort = await request(
      `/api/v1/projects/${projektId}/decisions/${dachziegel.id}`,
      {
        method: 'PATCH',
        token: bauherrToken,
        body: JSON.stringify({
          status: 'entschieden',
          decidedNote: 'Flachdachziegel anthrazit, wie im Bebauungsplan verlangt.',
          estimatedCostCents: 480_000,
        }),
      },
    );
    expect(antwort.status).toBe(200);

    const nachher = (await antwort.json()) as ProjectSchedule;
    const gepflegt = finde(nachher, 'dachziegel');
    expect(gepflegt.status).toBe('entschieden');
    expect(gepflegt.decidedNote).toContain('anthrazit');
    expect(gepflegt.estimatedCostCents).toBe(480_000);
    // Der Zeitpunkt kommt aus der Datenbank, nicht aus der Anfrage.
    expect(gepflegt.decidedAt).not.toBeNull();
  });

  it('nimmt den Zeitpunkt zurück, wenn die Entscheidung wieder aufgemacht wird', async () => {
    const vorher = await plan();
    const dachziegel = finde(vorher, 'dachziegel');

    const antwort = await request(`/api/v1/projects/${projektId}/decisions/${dachziegel.id}`, {
      method: 'PATCH',
      token: bauherrToken,
      body: JSON.stringify({ status: 'in_bemusterung' }),
    });
    const nachher = (await antwort.json()) as ProjectSchedule;
    expect(finde(nachher, 'dachziegel').decidedAt).toBeNull();
  });

  it('antwortet mit dem ganzen Plan, nicht nur mit der Zeile', async () => {
    const vorher = await plan();
    const fassade = finde(vorher, 'fassade');
    const antwort = await request(`/api/v1/projects/${projektId}/decisions/${fassade.id}`, {
      method: 'PATCH',
      token: bauherrToken,
      body: JSON.stringify({ status: 'beauftragt' }),
    });

    const nachher = (await antwort.json()) as ProjectSchedule;
    expect(nachher.tasks.length).toBeGreaterThan(30);
    expect(nachher.computedEnd).not.toBeNull();
  });

  it('lehnt eine Änderung ohne Aussage ab', async () => {
    const schedule = await plan();
    const antwort = await request(
      `/api/v1/projects/${projektId}/decisions/${schedule.decisions[0]!.id}`,
      { method: 'PATCH', token: bauherrToken, body: JSON.stringify({}) },
    );
    expect(antwort.status).toBe(422);
  });

  it('lässt einen Unbeteiligten nicht an fremde Entscheidungen', async () => {
    const schedule = await plan();
    const antwort = await request(
      `/api/v1/projects/${projektId}/decisions/${schedule.decisions[0]!.id}`,
      { method: 'PATCH', token: gastToken, body: JSON.stringify({ status: 'entschieden' }) },
    );
    expect(antwort.status).toBe(404);
  });
});

describe('Klartext für die Frist', () => {
  it('sagt, wie viel Zeit bleibt', () => {
    expect(decisionDueInPlainWords(4)).toBe('Noch 4 Werktage.');
    expect(decisionDueInPlainWords(1)).toBe('Noch ein Werktag.');
    expect(decisionDueInPlainWords(0)).toContain('letzte Tag');
  });

  it('beschuldigt niemanden, wenn die Frist verstrichen ist', () => {
    const text = decisionDueInPlainWords(-3);
    expect(text).toContain('3 Werktagen offen');
    // „überfällig" ist ein Vorwurf, und jede schlechte Nachricht trägt einen
    // nächsten Schritt (CI 11.2 und 11.4).
    expect(text).not.toContain('überfällig');
    expect(text).toContain('desto enger');
  });

  it('sagt es auch, wenn es gar keine Frist gibt', () => {
    expect(decisionDueInPlainWords(null)).toContain('noch keine Frist');
  });
});
