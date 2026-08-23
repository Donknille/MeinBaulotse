/**
 * Folgevorgänge einzeln entkoppeln (Abschnitt 3.5, Punkt 6).
 *
 * Der Fall aus der Wirklichkeit: Der Estrich verzögert sich, und die Rechnung
 * schiebt alles nach — auch das, was gar nicht darauf wartet. In der Vorlage
 * steht die Kante, weil sie meistens stimmt. Manchmal stimmt sie nicht, und
 * dann braucht der Bauherr keinen Weg, den Ablaufplan umzubauen, sondern
 * einen Satz: „Der wartet nicht darauf."
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { closePool, withAdminTx } from '@meinbaulotse/db';
import type { DependencyDto, ProjectSchedule, SchedulePreview } from '@meinbaulotse/shared';
import { createApp } from './app.js';

const SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long';
process.env['SUPABASE_JWT_SECRET'] = SECRET;

const app = createApp({ lotseModel: null });

let bauherrToken: string;
let projektId: string;
let estrichId: string;
let trocknungId: string;

async function tokenFor(userId: string): Promise<string> {
  return new SignJWT({ sub: userId, role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(SECRET));
}

function request(path: string, init: RequestInit & { token?: string } = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  if (init.token !== undefined) headers.set('authorization', `Bearer ${init.token}`);
  return app.request(`http://localhost${path}`, { ...init, headers });
}

const plan = async (): Promise<ProjectSchedule> =>
  (await (
    await request(`/api/v1/projects/${projektId}/schedule`, { token: bauherrToken })
  ).json()) as ProjectSchedule;

const kanten = async (): Promise<DependencyDto[]> =>
  (
    (await (
      await request(`/api/v1/projects/${projektId}/dependencies`, { token: bauherrToken })
    ).json()) as { dependencies: DependencyDto[] }
  ).dependencies;

beforeAll(async () => {
  await withAdminTx(async (tx) => {
    await tx.query(
      `truncate contract_check, contract_description_item, loan_drawdown, change_order,
                payment_milestone, defect_event, defect, assistant_message,
                assistant_conversation, assistant_budget, task_confirmation, guest_token,
                media, diary_entry, schedule_change, audit_log, dependency, task,
                project_member, project, expert_org_member, expert_org restart identity cascade`,
    );
    await tx.query('delete from auth.users');
  });

  const bauherr = await withAdminTx(async (tx) =>
    (
      await tx.query<{ id: string }>('insert into auth.users (email) values ($1) returning id', [
        'entkopplung@example.test',
      ])
    ).rows[0]!.id,
  );
  bauherrToken = await tokenFor(bauherr);

  const angelegt = await request('/api/v1/projects/onboarding', {
    method: 'POST',
    token: bauherrToken,
    body: JSON.stringify({
      name: 'Entkoppelweg 2',
      buildType: 'efh_massiv',
      hasBasement: true,
      plannedStart: '2026-05-04',
      federalState: 'BY',
      contractType: 'verbraucherbauvertrag',
    }),
  });
  projektId = ((await angelegt.json()) as { projectId: string }).projectId;

  const aktuell = await plan();
  estrichId = aktuell.tasks.find((task) => task.name === 'Estrich')!.id;
  trocknungId = aktuell.tasks.find((task) => task.name.includes('Trocknung'))!.id;
});

afterAll(async () => {
  await closePool();
});

describe('Die Vorschau sagt, worüber gezogen wird', () => {
  it('nennt zu jedem mitgezogenen Vorgang die Kante', async () => {
    const antwort = await request(
      `/api/v1/projects/${projektId}/tasks/${estrichId}/preview`,
      {
        method: 'POST',
        token: bauherrToken,
        body: JSON.stringify({ earliestStart: '2026-11-02' }),
      },
    );
    expect(antwort.status, await antwort.clone().text()).toBe(200);
    const vorschau = (await antwort.json()) as SchedulePreview;

    const trocknung = vorschau.tasks.find((task) => task.id === trocknungId);
    expect(trocknung).toBeDefined();
    // Ohne diese Angabe wüsste die Oberfläche nicht, welche Kante sie zum
    // Lösen anbieten soll — und „irgendeine lösen" wäre schlimmer als nichts.
    expect(trocknung!.viaDependencies.length).toBeGreaterThan(0);
    expect(trocknung!.viaDependencies[0]!.predecessorName).toBe('Estrich');
  });

  it('hängt an den angefassten Vorgang selbst keine Kante', async () => {
    const vorschau = (await (
      await request(`/api/v1/projects/${projektId}/tasks/${estrichId}/preview`, {
        method: 'POST',
        token: bauherrToken,
        body: JSON.stringify({ earliestStart: '2026-11-02' }),
      })
    ).json()) as SchedulePreview;

    // Er bewegt sich, weil jemand ihn bewegt, nicht weil etwas ihn zieht.
    const estrich = vorschau.tasks.find((task) => task.id === estrichId)!;
    expect(estrich.viaDependencies).toEqual([]);
  });
});

describe('Eine Kante lösen', () => {
  let kante: DependencyDto;

  beforeAll(async () => {
    kante = (await kanten()).find(
      (eintrag) => eintrag.predecessorId === estrichId && eintrag.successorId === trocknungId,
    )!;
  });

  it('verlangt einen Grund', async () => {
    const antwort = await request(
      `/api/v1/projects/${projektId}/dependencies/${kante.id}/decouple`,
      { method: 'POST', token: bauherrToken, body: JSON.stringify({ reason: 'x' }) },
    );
    expect(antwort.status).toBe(422);
    // In vier Wochen weiß sonst niemand mehr, warum der Plan so aussieht.
    expect(((await antwort.json()) as { error: string }).error).toContain('warum');
  });

  it('nimmt den Vorgang aus der Rechnung heraus', async () => {
    const vorher = await plan();
    const trocknungVorher = vorher.tasks.find((task) => task.id === trocknungId)!;

    await request(`/api/v1/projects/${projektId}/dependencies/${kante.id}/decouple`, {
      method: 'POST',
      token: bauherrToken,
      body: JSON.stringify({ reason: 'Trocknung läuft im anderen Geschoss schon' }),
    });

    // Der Estrich um vier Wochen nach hinten — die Trocknung folgt nicht mehr.
    await request(`/api/v1/projects/${projektId}/tasks/${estrichId}`, {
      method: 'PATCH',
      token: bauherrToken,
      body: JSON.stringify({
        earliestStart: '2026-11-02',
        reason: 'lieferzeit',
        reasonText: 'Estrich kommt später',
      }),
    });

    const nachher = await plan();
    const estrichNachher = nachher.tasks.find((task) => task.id === estrichId)!;
    const trocknungNachher = nachher.tasks.find((task) => task.id === trocknungId)!;

    expect(estrichNachher.currentStart).not.toBe(
      vorher.tasks.find((task) => task.id === estrichId)!.currentStart,
    );
    expect(trocknungNachher.currentStart).toBe(trocknungVorher.currentStart);
  });

  it('lässt die Kante stehen, statt sie zu löschen', async () => {
    const alle = await kanten();
    const gelöst = alle.find((eintrag) => eintrag.id === kante.id);
    // Eine gelöschte Kante ist weg; eine gelöste steht mit Grund und Datum da.
    expect(gelöst).toBeDefined();
    expect(gelöst!.decoupledAt).not.toBeNull();
    expect(gelöst!.decoupledReason).toContain('anderen Geschoss');
  });

  it('hält den Eingriff im Protokoll fest', async () => {
    const eintraege = await withAdminTx(async (tx) =>
      (
        await tx.query<{ action: string }>(
          "select action from audit_log where project_id = $1 and action like 'dependency.%'",
          [projektId],
        )
      ).rows.map((row) => row.action),
    );
    expect(eintraege).toContain('dependency.decoupled');
  });

  it('verbindet sie auf Wunsch wieder', async () => {
    const antwort = await request(
      `/api/v1/projects/${projektId}/dependencies/${kante.id}/decouple`,
      { method: 'DELETE', token: bauherrToken },
    );
    expect(antwort.status).toBe(200);

    const wieder = (await kanten()).find((eintrag) => eintrag.id === kante.id)!;
    expect(wieder.decoupledAt).toBeNull();

    // Und die Rechnung zieht die Trocknung wieder nach.
    const nachher = await plan();
    const estrich = nachher.tasks.find((task) => task.id === estrichId)!;
    const trocknung = nachher.tasks.find((task) => task.id === trocknungId)!;
    expect(trocknung.currentStart >= estrich.currentEnd!).toBe(true);
  });

  it('sagt es offen, wenn nichts zu lösen ist', async () => {
    const antwort = await request(
      `/api/v1/projects/${projektId}/dependencies/${kante.id}/decouple`,
      { method: 'DELETE', token: bauherrToken },
    );
    expect(antwort.status).toBe(404);
  });
});
