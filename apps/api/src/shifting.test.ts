/**
 * Integrationstest der Abnahme von AP 4, erster Teil:
 *
 * „Ein verschobener Vorgang schlägt korrekt sieben Folgevorgänge vor, der
 * Endtermin verschiebt sich um den erwarteten Wert, der Änderungseintrag ist
 * per SQL nicht änderbar."
 *
 * Der dritte Satz steht seit AP 1 in `packages/db/src/invariants.test.ts` und
 * wird dort gegen die Datenbank geprüft. Hier geht es um die ersten beiden —
 * und um die Frage, die dazwischen steht: Zeigt die Vorschau dasselbe, was
 * hinterher passiert?
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { closePool, withAdminTx } from '@meinbaulotse/db';
import { workdayOffset, type Calendar } from '@meinbaulotse/schedule';
import {
  shiftEffectInPlainWords,
  shiftPreview,
  type ProjectSchedule,
  type ShiftPreview,
} from '@meinbaulotse/shared';
import { createApp } from './app.js';

const SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long';
process.env['SUPABASE_JWT_SECRET'] = SECRET;

const app = createApp();
const calendar: Calendar = { federalState: 'BY', catholicMunicipality: false };

let bauherrToken: string;
let projectId: string;

async function tokenFor(userId: string): Promise<string> {
  return new SignJWT({ sub: userId, role: 'authenticated', email: `${userId}@example.test` })
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

async function planOf(): Promise<ProjectSchedule> {
  const response = await request(`/api/v1/projects/${projectId}/schedule`, { token: bauherrToken });
  expect(response.status).toBe(200);
  return (await response.json()) as ProjectSchedule;
}

function taskNamed(plan: ProjectSchedule, name: string): ProjectSchedule['tasks'][number] {
  const found = plan.tasks.find((task) => task.name.startsWith(name));
  if (found === undefined) throw new Error(`Vorgang „${name}" steht nicht im Plan.`);
  return found;
}

async function preview(taskId: string, body: unknown): Promise<ShiftPreview> {
  const response = await request(`/api/v1/projects/${projectId}/tasks/${taskId}/shift-preview`, {
    method: 'POST',
    token: bauherrToken,
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(200);
  return shiftPreview.parse(await response.json());
}

/** Legt ein frisches Bauvorhaben an — jede Probe fängt beim selben Plan an. */
async function frischesProjekt(): Promise<string> {
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
  return ((await created.json()) as { projectId: string }).projectId;
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

  const bauherr = await withAdminTx(async (tx) => {
    const result = await tx.query<{ id: string }>(
      "insert into auth.users (email) values ('verschieben@example.test') returning id",
    );
    return result.rows[0]!.id;
  });
  bauherrToken = await tokenFor(bauherr);
  projectId = await frischesProjekt();
});

afterAll(async () => {
  await closePool();
});

describe('Die Vorschau', () => {
  it('schlägt für die Malerarbeiten genau sieben Folgevorgänge vor', async () => {
    const plan = await planOf();
    const maler = taskNamed(plan, 'Malerarbeiten');
    const spaeter = workdayOffset(maler.currentStart!, 10, calendar);

    const vorschau = await preview(maler.id, { earliestStart: spaeter, reason: 'kapazitaet' });

    expect(vorschau.affected).toHaveLength(7);
    expect(vorschau.trigger?.toStart).toBe(spaeter);
  });

  it('nennt für jeden Folgevorgang, woher wohin', async () => {
    const plan = await planOf();
    const maler = taskNamed(plan, 'Malerarbeiten');
    const vorschau = await preview(maler.id, {
      earliestStart: workdayOffset(maler.currentStart!, 10, calendar),
      reason: 'kapazitaet',
    });

    const boden = vorschau.affected.find((eintrag) => eintrag.name.startsWith('Bodenbeläge'));
    expect(boden).toBeDefined();
    expect(boden!.fromStart).toBe(taskNamed(plan, 'Bodenbeläge').currentStart);
    expect(boden!.toStart > boden!.fromStart).toBe(true);
    expect(boden!.shiftWorkdays).toBe(10);
  });

  it('sagt, was es den Endtermin kostet', async () => {
    const plan = await planOf();
    const maler = taskNamed(plan, 'Malerarbeiten');
    const vorschau = await preview(maler.id, {
      earliestStart: workdayOffset(maler.currentStart!, 10, calendar),
      reason: 'kapazitaet',
    });

    expect(vorschau.effectWorkdays).toBe(10);
    expect(shiftEffectInPlainWords(vorschau.effectWorkdays)).toBe(
      'Der Endtermin verschiebt sich um 10 Werktage nach hinten.',
    );
  });

  it('nennt die Entscheidungsfristen, die mitwandern', async () => {
    const plan = await planOf();
    const fliesen = taskNamed(plan, 'Fliesenarbeiten');
    const vorschau = await preview(fliesen.id, {
      earliestStart: workdayOffset(fliesen.currentStart!, 10, calendar),
      reason: 'lieferzeit',
    });

    // Genau der Fall aus Abschnitt 1.2: Die Fliesen rutschen, und mit ihnen
    // die Bemusterungsfrist. Das ist die Auskunft, die eine Verschiebung für
    // den Bauherren überhaupt handlungsrelevant macht.
    const bemusterung = vorschau.decisions.find((eintrag) => eintrag.title.startsWith('Fliesen'));
    expect(bemusterung).toBeDefined();
    expect(bemusterung!.toDueDate! > bemusterung!.fromDueDate!).toBe(true);
  });

  it('schreibt dabei nichts', async () => {
    const vorher = await planOf();
    const maler = taskNamed(vorher, 'Malerarbeiten');
    await preview(maler.id, {
      earliestStart: workdayOffset(maler.currentStart!, 10, calendar),
      reason: 'kapazitaet',
    });

    const nachher = await planOf();
    expect(nachher.computedEnd).toBe(vorher.computedEnd);
    expect(taskNamed(nachher, 'Malerarbeiten').currentStart).toBe(maler.currentStart);
  });
});

describe('Die Verschiebung selbst', () => {
  it('macht genau das, was die Vorschau angekündigt hat', async () => {
    // Der eigentliche Prüfstein. Eine Vorschau, die etwas anderes zeigt als
    // das, was hinterher passiert, ist schlimmer als gar keine.
    projectId = await frischesProjekt();
    const plan = await planOf();
    const maler = taskNamed(plan, 'Malerarbeiten');
    const spaeter = workdayOffset(maler.currentStart!, 10, calendar);
    const body = { earliestStart: spaeter, reason: 'kapazitaet' };

    const vorschau = await preview(maler.id, body);
    const response = await request(`/api/v1/projects/${projectId}/tasks/${maler.id}`, {
      method: 'PATCH',
      token: bauherrToken,
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(200);
    const nachher = (await response.json()) as ProjectSchedule;

    expect(nachher.computedEnd).toBe(vorschau.computedEndAfter);
    for (const angekuendigt of vorschau.affected) {
      const tatsaechlich = nachher.tasks.find((task) => task.id === angekuendigt.taskId)!;
      expect(tatsaechlich.currentStart, angekuendigt.name).toBe(angekuendigt.toStart);
      expect(tatsaechlich.currentEnd, angekuendigt.name).toBe(angekuendigt.toEnd);
    }
  });

  it('schreibt die Auswirkung auf den Endtermin in die Historie', async () => {
    // Abschnitt 3.5, Punkt 7. Die Spalte gibt es seit 0001 und war bis AP 4
    // immer null — eine Auskunft, die nie eine war.
    const eintraege = await withAdminTx(async (tx) => {
      const result = await tx.query<{ effect_days_on_completion: number | null }>(
        `select effect_days_on_completion
           from schedule_change
          where project_id = $1 and field = 'current_start' and reason_code = 'kapazitaet'
          order by created_at desc limit 1`,
        [projectId],
      );
      return result.rows;
    });

    expect(eintraege).toHaveLength(1);
    expect(eintraege[0]!.effect_days_on_completion).toBe(10);
  });

  it('hält den Grund an jedem mitgezogenen Vorgang fest', async () => {
    const anzahl = await withAdminTx(async (tx) => {
      const result = await tx.query<{ anzahl: string }>(
        `select count(*)::text as anzahl
           from schedule_change
          where project_id = $1 and field = 'current_start' and reason_code = 'kapazitaet'`,
        [projectId],
      );
      return Number(result.rows[0]!.anzahl);
    });
    // Der ausgelöste Vorgang und seine sieben Folgevorgänge.
    expect(anzahl).toBe(8);
  });
});

describe('Einzelentkopplung', () => {
  beforeAll(async () => {
    projectId = await frischesProjekt();
  });

  it('kündigt die Überlappung in der Vorschau an', async () => {
    const plan = await planOf();
    const maler = taskNamed(plan, 'Malerarbeiten');
    const treppe = taskNamed(plan, 'Treppe');

    const vorschau = await preview(maler.id, {
      earliestStart: workdayOffset(maler.currentStart!, 10, calendar),
      reason: 'kapazitaet',
      decouple: [treppe.id],
    });

    expect(vorschau.affected.map((eintrag) => eintrag.taskId)).not.toContain(treppe.id);
    expect(vorschau.decoupled.map((eintrag) => eintrag.taskId)).toContain(treppe.id);
    expect(vorschau.decoupled[0]!.name).toContain('Treppe');
    // Was das in den Daten bedeutet, steht vorher da und nicht erst hinterher.
    expect(vorschau.overlaps).toHaveLength(1);
    expect(vorschau.overlaps[0]!.successorName).toContain('Treppe');
    expect(vorschau.overlaps[0]!.workdays).toBeGreaterThan(0);
  });

  it('lässt den entkoppelten Vorgang stehen', async () => {
    const vorher = await planOf();
    const maler = taskNamed(vorher, 'Malerarbeiten');
    const treppe = taskNamed(vorher, 'Treppe');

    const response = await request(`/api/v1/projects/${projectId}/tasks/${maler.id}`, {
      method: 'PATCH',
      token: bauherrToken,
      body: JSON.stringify({
        earliestStart: workdayOffset(maler.currentStart!, 10, calendar),
        reason: 'kapazitaet',
        decouple: [treppe.id],
      }),
    });
    expect(response.status).toBe(200);
    const nachher = (await response.json()) as ProjectSchedule;

    expect(taskNamed(nachher, 'Treppe').currentStart).toBe(treppe.currentStart);
    expect(taskNamed(nachher, 'Malerarbeiten').currentStart! > maler.currentStart!).toBe(true);
  });

  it('schreibt die Überlappung als negativen Vorlauf in die Beziehung', async () => {
    const vorlaeufe = await withAdminTx(async (tx) => {
      const result = await tx.query<{ lag_days: number; name: string }>(
        `select d.lag_days, t.name
           from dependency d join task t on t.id = d.successor_id
          where d.project_id = $1 and d.lag_days <> 0`,
        [projectId],
      );
      return result.rows;
    });

    expect(vorlaeufe).toHaveLength(1);
    expect(vorlaeufe[0]!.lag_days).toBeLessThan(0);
    expect(vorlaeufe[0]!.name).toContain('Treppe');
  });

  it('hinterlässt einen Historieneintrag, der die Überlappung erklärt', async () => {
    // Sonst stünde später eine Überlappung im Plan, die niemand erklären kann.
    const eintraege = await withAdminTx(async (tx) => {
      const result = await tx.query<{ old_value: number; new_value: number; reason_text: string }>(
        `select old_value::int, new_value::int, reason_text
           from schedule_change
          where project_id = $1 and field = 'dependency_lag'`,
        [projectId],
      );
      return result.rows;
    });

    expect(eintraege).toHaveLength(1);
    expect(eintraege[0]!.old_value).toBe(0);
    expect(eintraege[0]!.new_value).toBeLessThan(0);
    expect(eintraege[0]!.reason_text).toMatch(/[Ee]ntkoppelt/);
  });

  it('hält den entkoppelten Vorgang auch gegen ein Vorziehen fest', async () => {
    const plan = await planOf();
    const treppe = taskNamed(plan, 'Treppe');
    // Die Anfangsbeschränkung ist die zweite Hälfte der Entkopplung: Ohne sie
    // rutschte der Vorgang nach vorn, sobald der gesenkte Vorlauf ihn nicht
    // mehr hält.
    expect(treppe.earliestStart).toBe(treppe.currentStart);
  });
});
