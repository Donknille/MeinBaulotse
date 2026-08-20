/**
 * Integrationstest der Abnahme von AP 3 und AP 4:
 *
 *   „Ein verschobener Vorgang schlägt korrekt Folgevorgänge vor, der
 *    Endtermin verschiebt sich um den erwarteten Wert, der Änderungseintrag
 *    ist per SQL nicht änderbar."
 *
 *   „Wird der Fliesenvorgang vorgezogen, rückt die Bemusterungsfrist mit."
 *
 * Und die Rechtematrix aus Abschnitt 2.2 an der Stelle, an der sie am meisten
 * weh tut: Ein Einzelgewerk meldet seinen Ist-Beginn, und der Rest des Plans
 * muss trotzdem mitwandern — obwohl es die anderen Vorgänge nicht anfassen
 * darf.
 *
 * Geprüft wird der ganze Weg — HTTP, JWT, RLS, Berechnungskern, Datenbank.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { closePool, withAdminTx } from '@meinbaulotse/db';
import type {
  DecisionDto,
  ProjectMemberDto,
  ProjectSchedule,
  ScheduleChangeEntry,
  TaskPatchResult,
} from '@meinbaulotse/shared';
import { createApp } from './app.js';

const SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long';
process.env['SUPABASE_JWT_SECRET'] = SECRET;

const app = createApp();

let bauherr: string;
let token: string;
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

async function schedule(): Promise<ProjectSchedule> {
  const response = await request(`/api/v1/projects/${projectId}/schedule`, { token });
  expect(response.status).toBe(200);
  return (await response.json()) as ProjectSchedule;
}

async function taskNamed(name: string): Promise<ProjectSchedule['tasks'][number]> {
  const plan = await schedule();
  const task = plan.tasks.find((entry) => entry.name.startsWith(name));
  if (task === undefined) throw new Error(`Vorgang ${name} steht nicht im Plan.`);
  return task;
}

beforeAll(async () => {
  await withAdminTx(async (tx) => {
    await tx.query(
      `truncate schedule_change, audit_log, decision, dependency, task, project_member,
                project, expert_org_member, expert_org restart identity cascade`,
    );
    await tx.query('delete from auth.users');
  });

  bauherr = await createUser('bauherr@example.test');
  token = await tokenFor(bauherr);

  const created = await request('/api/v1/projects/onboarding', {
    method: 'POST',
    token,
    body: JSON.stringify({
      name: 'Musterweg 4',
      buildType: 'efh_massiv',
      hasBasement: true,
      plannedStart: '2026-04-01',
      federalState: 'BY',
      contractType: 'verbraucherbauvertrag',
      contractualCompletion: '2026-11-30',
    }),
  });
  expect(created.status).toBe(201);
  projectId = ((await created.json()) as { projectId: string }).projectId;
});

afterAll(async () => {
  await closePool();
});

describe('Rechte an der Oberfläche', () => {
  it('liefert die Rechtematrix aus der Datenbank, nicht aus dem Code', async () => {
    const response = await request('/api/v1/roles', { token });
    const body = (await response.json()) as { matrix: Record<string, string[]> };

    expect(body.matrix['owner']).toContain('task.schedule');
    expect(body.matrix['viewer']).toEqual(['project.read']);
    expect(body.matrix['trade']).toContain('task.confirm');
    expect(body.matrix['trade']).not.toContain('member.invite');
  });

  it('nennt dem Anrufer seine eigenen Rechte am Projekt', async () => {
    const plan = await schedule();
    expect(plan.project.role).toBe('owner');
    expect(plan.project.permissions).toContain('member.invite');
    expect(plan.project.memberId).not.toBeNull();
  });
});

describe('Vorgang verschieben', () => {
  it('schiebt die Folgevorgänge mit und nennt die Wirkung auf das Bauende', async () => {
    const estrich = await taskNamed('Estrich');
    const vorher = await schedule();

    const response = await request(`/api/v1/projects/${projectId}/tasks/${estrich.id}`, {
      method: 'PATCH',
      token,
      body: JSON.stringify({
        currentStart: shiftIso(estrich.currentStart!, 14),
        reasonCode: 'lieferzeit',
        reasonText: 'Estrichpumpe erst in zwei Wochen frei',
      }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as TaskPatchResult;

    // Der Estrich hängt vor Trocknung, Fliesen, Maler, Boden, Endmontagen und
    // Abnahme — es darf nicht bei einem einzigen Folgevorgang bleiben.
    expect(body.shifted.length).toBeGreaterThan(5);
    expect(body.endShiftWorkdays).toBeGreaterThan(0);
    expect(body.computedEndAfter! > body.computedEndBefore!).toBe(true);
    expect(body.computedEndBefore).toBe(vorher.computedEnd);

    const nachher = await schedule();
    expect(nachher.computedEnd).toBe(body.computedEndAfter);
  });

  it('hält den verschobenen Termin über die nächste Neuberechnung hinweg', async () => {
    const estrich = await taskNamed('Estrich');
    const gehalten = estrich.currentStart;

    // Irgendeine andere Änderung löst eine vollständige Neurechnung aus.
    const innenputz = await taskNamed('Innenputz');
    await request(`/api/v1/projects/${projectId}/tasks/${innenputz.id}`, {
      method: 'PATCH',
      token,
      body: JSON.stringify({ confirmation: 'mutual' }),
    });

    expect((await taskNamed('Estrich')).currentStart).toBe(gehalten);
  });

  it('zieht einen Vorgang nicht vor seinen Vorgänger, sondern sagt, wo er landet', async () => {
    const fliesen = await taskNamed('Fliesenarbeiten');
    const response = await request(`/api/v1/projects/${projectId}/tasks/${fliesen.id}`, {
      method: 'PATCH',
      token,
      body: JSON.stringify({ currentStart: '2026-04-06' }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as TaskPatchResult;

    // Vor den Fliesen liegt die Trocknung bis Belegreife. Der Wunschtermin
    // wird nicht stillschweigend übernommen — er wird zur Untergrenze, und
    // die Rechnung setzt den Vorgang dahin, wo er hingehört.
    expect(body.task.currentStart).not.toBe('2026-04-06');
    expect(body.task.currentStart! > '2026-04-06').toBe(true);
  });

  it('schreibt jede Änderung in die Historie, mit Grund und Verursacher', async () => {
    const response = await request(`/api/v1/projects/${projectId}/changes`, { token });
    const body = (await response.json()) as { changes: ScheduleChangeEntry[] };

    const verschiebung = body.changes.find(
      (entry) => entry.reasonCode === 'lieferzeit' && entry.field === 'current_start',
    );
    expect(verschiebung).toBeDefined();
    expect(verschiebung!.actorRole).toBe('owner');
    expect(verschiebung!.reasonText).toBe('Estrichpumpe erst in zwei Wochen frei');
    expect(verschiebung!.actorChannel).toBe('app');
  });

  it('lässt die Historie per SQL nicht ändern', async () => {
    await expect(
      withAdminTx((tx) => tx.query('update schedule_change set reason_text = $1', ['umgeschrieben'])),
    ).rejects.toThrow(/append-only/i);
  });
});

describe('Entscheidungen', () => {
  it('legt beim Onboarding die Entscheidungen mit Fristen an', async () => {
    const response = await request(
      `/api/v1/projects/${projectId}/decisions?today=2026-04-01`,
      { token },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { decisions: DecisionDto[] };

    expect(body.decisions.length).toBe(14);
    const fenster = body.decisions.find((entry) => entry.title.startsWith('Fenster'));
    expect(fenster).toBeDefined();
    expect(fenster!.dueDate).not.toBeNull();
    expect(fenster!.blocksTaskName).toContain('Fenster');
    // 60 Werktage Vorlauf vor einem Vorgang im Juni: Die Frist liegt vor dem
    // Baubeginn — genau die Aussage, die der Bauherr braucht.
    expect(fenster!.isOverdue).toBe(true);
  });

  it('lässt die Frist mitwandern, wenn der Vorgang wandert', async () => {
    const fliesenEntscheidung = async (): Promise<DecisionDto> => {
      const response = await request(
        `/api/v1/projects/${projectId}/decisions?today=2026-04-01`,
        { token },
      );
      const body = (await response.json()) as { decisions: DecisionDto[] };
      return body.decisions.find((entry) => entry.title.startsWith('Fliesen'))!;
    };

    const vorher = await fliesenEntscheidung();
    const fliesen = await taskNamed('Fliesenarbeiten');

    await request(`/api/v1/projects/${projectId}/tasks/${fliesen.id}`, {
      method: 'PATCH',
      token,
      body: JSON.stringify({
        currentStart: shiftIso(fliesen.currentStart!, 20),
        reasonCode: 'lieferzeit',
      }),
    });

    const nachher = await fliesenEntscheidung();
    expect(nachher.dueDate! > vorher.dueDate!).toBe(true);
  });

  it('führt den Zustand fort und hält den Zeitpunkt fest', async () => {
    const list = await request(`/api/v1/projects/${projectId}/decisions`, { token });
    const { decisions } = (await list.json()) as { decisions: DecisionDto[] };
    const treppe = decisions.find((entry) => entry.title.startsWith('Treppe'))!;

    const response = await request(
      `/api/v1/projects/${projectId}/decisions/${treppe.id}`,
      {
        method: 'PATCH',
        token,
        body: JSON.stringify({ status: 'entschieden', decidedNote: 'Eiche, Ganzglasgeländer' }),
      },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as DecisionDto;
    expect(body.status).toBe('entschieden');
    expect(body.decidedAt).not.toBeNull();
    expect(body.decidedNote).toBe('Eiche, Ganzglasgeländer');
  });
});

describe('Beteiligte und Rollen', () => {
  let gewerkMemberId: string;
  let gewerkToken: string;
  let elektroTaskId: string;

  it('lädt ein Einzelgewerk mit Gewerkebindung ein', async () => {
    const trades = (await (await request('/api/v1/trades', { token })).json()) as {
      trades: Array<{ id: string; code: string }>;
    };
    const elektro = trades.trades.find((trade) => trade.code === 'elektro')!;

    const response = await request(`/api/v1/projects/${projectId}/members`, {
      method: 'POST',
      token,
      body: JSON.stringify({
        role: 'trade',
        displayName: 'Elektro Meier',
        company: 'Meier GmbH',
        email: 'meier@example.test',
        tradeId: elektro.id,
      }),
    });
    expect(response.status).toBe(201);
    const member = (await response.json()) as ProjectMemberDto;
    expect(member.role).toBe('trade');
    expect(member.tradeCode).toBe('elektro');
    gewerkMemberId = member.id;
  });

  it('weist ein Einzelgewerk ohne Gewerk ab', async () => {
    const response = await request(`/api/v1/projects/${projectId}/members`, {
      method: 'POST',
      token,
      body: JSON.stringify({ role: 'trade', displayName: 'Ohne Gewerk' }),
    });
    expect(response.status).toBe(422);
  });

  it('zeigt dem Einzelgewerk nur die eigenen Vorgänge', async () => {
    const gewerkUser = await createUser('meier@example.test');
    await withAdminTx((tx) =>
      tx.query('update project_member set user_id = $2, accepted_at = now() where id = $1', [
        gewerkMemberId,
        gewerkUser,
      ]),
    );
    gewerkToken = await tokenFor(gewerkUser);

    const response = await request(`/api/v1/projects/${projectId}/schedule`, {
      token: gewerkToken,
    });
    expect(response.status).toBe(200);
    const plan = (await response.json()) as ProjectSchedule;

    expect(plan.project.role).toBe('trade');
    expect(plan.tasks.length).toBeGreaterThan(0);
    expect(plan.tasks.every((task) => task.tradeCode === 'elektro')).toBe(true);
    elektroTaskId = plan.tasks[0]!.id;
  });

  it('lässt das Einzelgewerk den eigenen Vorgang melden — und den Plan mitwandern', async () => {
    const vorher = await schedule();

    const response = await request(`/api/v1/projects/${projectId}/tasks/${elektroTaskId}`, {
      method: 'PATCH',
      token: gewerkToken,
      body: JSON.stringify({
        // Deutlich genug, dass der Vorgang den Blower-Door-Test und alles
        // danach mitzieht — sonst prüfte der Test nur die Rechte, nicht die
        // Fortpflanzung.
        currentStart: shiftIso((await taskNamed('Rohinstallation Elektro')).currentStart!, 40),
        reasonCode: 'kapazitaet',
      }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as TaskPatchResult;

    // Das ist der eigentliche Prüfstein: Das Gewerk darf fremde Vorgänge nicht
    // anfassen, trotzdem muss der Bauablauf die Folge kennen.
    expect(body.shiftedCount).toBeGreaterThan(1);

    // Namentlich erfährt das Gewerk nur, was ohnehin in seinem Ausschnitt
    // liegt — die Endmontage Elektro. Dass darüber hinaus etwas mitwandert,
    // sagt ihm die Zahl, nicht die Liste.
    const eigeneVorgaenge = new Set(
      (
        (await (
          await request(`/api/v1/projects/${projectId}/schedule`, { token: gewerkToken })
        ).json()) as ProjectSchedule
      ).tasks.map((task) => task.id),
    );
    expect(body.shifted.every((entry) => eigeneVorgaenge.has(entry.id))).toBe(true);
    expect(body.shifted.length).toBeLessThan(body.shiftedCount);

    const nachher = await schedule();
    expect(nachher.computedEnd! > vorher.computedEnd!).toBe(true);
  });

  it('lässt das Einzelgewerk fremde Vorgänge nicht anfassen', async () => {
    const fremder = await taskNamed('Malerarbeiten');
    const response = await request(`/api/v1/projects/${projectId}/tasks/${fremder.id}`, {
      method: 'PATCH',
      token: gewerkToken,
      body: JSON.stringify({ currentStart: '2026-12-01' }),
    });
    expect(response.status).toBe(404);
  });

  it('lässt das Einzelgewerk niemanden einladen', async () => {
    const response = await request(`/api/v1/projects/${projectId}/members`, {
      method: 'POST',
      token: gewerkToken,
      body: JSON.stringify({ role: 'viewer', displayName: 'Schwiegermutter' }),
    });
    expect(response.status).toBe(403);
  });

  it('wechselt die Rolle eines Beteiligten', async () => {
    const response = await request(
      `/api/v1/projects/${projectId}/members/${gewerkMemberId}`,
      {
        method: 'PATCH',
        token,
        body: JSON.stringify({ role: 'contractor' }),
      },
    );
    expect(response.status).toBe(200);
    const member = (await response.json()) as ProjectMemberDto;
    expect(member.role).toBe('contractor');
    // Die Gewerkebindung fällt mit der Rolle weg, sonst bliebe eine
    // Einschränkung stehen, die niemand mehr sieht.
    expect(member.tradeId).toBeNull();

    const plan = (await (
      await request(`/api/v1/projects/${projectId}/schedule`, { token: gewerkToken })
    ).json()) as ProjectSchedule;
    expect(plan.tasks.length).toBeGreaterThan(30);
    expect(plan.project.permissions).toContain('task.schedule');
    expect(plan.project.permissions).not.toContain('member.invite');
  });

  it('macht niemanden zum Bauherrn und entzieht dem Bauherrn nichts', async () => {
    const members = (await (
      await request(`/api/v1/projects/${projectId}/members`, { token })
    ).json()) as { members: ProjectMemberDto[] };
    const eigener = members.members.find((member) => member.isSelf)!;

    expect(
      (
        await request(`/api/v1/projects/${projectId}/members/${eigener.id}`, {
          method: 'PATCH',
          token,
          body: JSON.stringify({ role: 'viewer' }),
        })
      ).status,
    ).toBe(409);

    expect(
      (
        await request(`/api/v1/projects/${projectId}/members/${eigener.id}`, {
          method: 'DELETE',
          token,
        })
      ).status,
    ).toBe(409);

    expect(
      (
        await request(`/api/v1/projects/${projectId}/members`, {
          method: 'POST',
          token,
          body: JSON.stringify({ role: 'owner', displayName: 'Zweiter Bauherr' }),
        })
      ).status,
    ).toBe(422);
  });

  it('entzieht einen Zugang und schließt ihn damit aus', async () => {
    const response = await request(
      `/api/v1/projects/${projectId}/members/${gewerkMemberId}`,
      { method: 'DELETE', token },
    );
    expect(response.status).toBe(200);

    const nach = await request(`/api/v1/projects/${projectId}/schedule`, { token: gewerkToken });
    expect(nach.status).toBe(404);
  });
});

describe('Vertragsdaten', () => {
  it('rechnet die Abweichung neu, sobald der geschuldete Termin steht', async () => {
    const response = await request(`/api/v1/projects/${projectId}`, {
      method: 'PATCH',
      token,
      body: JSON.stringify({ contractualCompletion: '2026-10-01' }),
    });
    expect(response.status).toBe(200);

    const plan = await schedule();
    expect(plan.contractualEnd).toBe('2026-10-01');
    expect(plan.deviationWorkdays).not.toBeNull();
  });
});

/** Kalendertage aufaddieren — für den Test genügt das, gerechnet wird serverseitig. */
function shiftIso(date: string, days: number): string {
  const epochDay = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000) + days;
  return new Date(epochDay * 86_400_000).toISOString().slice(0, 10);
}
