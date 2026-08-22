/**
 * Integrationstest der Abnahme von AP 2:
 *
 * „Zu jedem der zwölf Vorgänge erscheint rechtzeitig die passende Karte mit
 * Quellenangaben."
 *
 * Der zweite Teil der Abnahme — „Eine veröffentlichte Karte lässt sich per SQL
 * nicht ändern" — steht dort, wo er hingehört: in
 * `packages/db/src/invariants.test.ts`, gegen die Datenbank statt gegen die
 * API. Eine Sperre, die nur der Anwendungscode einhält, ist keine Sperre.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { closePool, withAdminTx } from '@meinbaulotse/db';
import {
  guideCardView,
  isGuideCardDue,
  type GuideCardView,
  type ProjectSchedule,
} from '@meinbaulotse/shared';
import { createApp } from './app.js';

const SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long';
process.env['SUPABASE_JWT_SECRET'] = SECRET;

const app = createApp();

let bauherrToken: string;
let guToken: string;
let fremderToken: string;
let projectId: string;
let plan: ProjectSchedule;

/** Estrich — die Karte mit dem Lehrstück „Aufbauhöhe vor dem Estrich". */
const MIT_KARTE = 'Estrich';
/** Baugrundgutachten — für die zwölf MVP-Karten nicht vorgesehen. */
const OHNE_KARTE = 'Baugrundgutachten';

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

function taskNamed(name: string): ProjectSchedule['tasks'][number] {
  const found = plan.tasks.find((task) => task.name.startsWith(name));
  if (found === undefined) throw new Error(`Vorgang „${name}" steht nicht im Plan.`);
  return found;
}

async function cardOf(taskName: string, token: string): Promise<GuideCardView> {
  const response = await request(
    `/api/v1/projects/${projectId}/tasks/${taskNamed(taskName).id}/guide-card`,
    { token },
  );
  expect(response.status).toBe(200);
  return guideCardView.parse(await response.json());
}

beforeAll(async () => {
  await withAdminTx(async (tx) => {
    await tx.query(
      `truncate schedule_change, audit_log, checklist_item, guide_card_read, dependency,
                task, project_member, project, expert_org_member, expert_org
                restart identity cascade`,
    );
    await tx.query('delete from auth.users');
  });

  const bauherr = await createUser('karten-bauherr@example.test');
  const gu = await createUser('karten-gu@example.test');
  bauherrToken = await tokenFor(bauherr);
  guToken = await tokenFor(gu);
  fremderToken = await tokenFor(await createUser('karten-fremder@example.test'));

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
  const result = (await created.json()) as { projectId: string; guideCardCount: number };
  projectId = result.projectId;

  // Der GU kommt über eine Einladung herein, so wie im Betrieb.
  await withAdminTx(async (tx) =>
    tx.query(
      `insert into project_member (project_id, user_id, role, display_name, accepted_at)
       values ($1, $2, 'contractor', 'Jörg Baumeister', now())`,
      [projectId, gu],
    ),
  );

  const schedule = await request(`/api/v1/projects/${projectId}/schedule`, { token: bauherrToken });
  plan = (await schedule.json()) as ProjectSchedule;
});

afterAll(async () => {
  await closePool();
});

describe('Beim Anlegen bekommt der Plan seine Karten', () => {
  it('verknüpft die Vorgänge, für die es Redaktionsinhalt gibt', async () => {
    const mitKarte = plan.tasks.filter((task) => task.guideCardId !== null);
    expect(mitKarte.length).toBeGreaterThan(0);

    // Die Karten decken die Phasen ab, in denen am meisten schiefgeht — nicht
    // den ganzen Ablauf. Ein Plan, in dem jede Zeile eine Karte trägt, wäre ein
    // Hinweis darauf, dass die Zuordnung zu grob ist.
    expect(mitKarte.length).toBeLessThan(plan.tasks.length);
    expect(taskNamed(MIT_KARTE).guideCardId).not.toBeNull();
    expect(taskNamed(OHNE_KARTE).guideCardId).toBeNull();
  });

  it('meldet die Zahl der verknüpften Vorgänge beim Onboarding', async () => {
    const created = await request('/api/v1/projects/onboarding', {
      method: 'POST',
      token: bauherrToken,
      body: JSON.stringify({
        name: 'Zweites Bauvorhaben',
        buildType: 'efh_massiv',
        hasBasement: false,
        plannedStart: '2026-05-04',
        federalState: 'NI',
        contractType: 'einzelgewerke',
      }),
    });
    const result = (await created.json()) as { projectId: string; guideCardCount: number };
    expect(result.guideCardCount).toBeGreaterThan(0);

    // Ohne Keller fallen die Kellervorgänge weg — und mit ihnen die Karte zur
    // Kellerabdichtung. Die Wissensschicht folgt dem Plan, nicht der Vorlage.
    const schedule = await request(`/api/v1/projects/${result.projectId}/schedule`, {
      token: bauherrToken,
    });
    const ohneKeller = (await schedule.json()) as ProjectSchedule;
    expect(ohneKeller.tasks.filter((task) => task.guideCardId !== null)).toHaveLength(
      result.guideCardCount,
    );
    expect(result.guideCardCount).toBeLessThan(
      plan.tasks.filter((task) => task.guideCardId !== null).length,
    );
  });
});

describe('Eine Lotsenkarte lesen', () => {
  it('liefert Inhalt, Fragen und Quellen', async () => {
    const view = await cardOf(MIT_KARTE, bauherrToken);

    expect(view.card.title).toContain('Estrich');
    expect(view.card.whatsHappening.length).toBeGreaterThan(80);
    expect(view.card.watchFor.length).toBeGreaterThan(0);
    expect(view.card.questionsForContractor.length).toBeGreaterThan(0);
    expect(view.card.commonProblems.length).toBeGreaterThan(0);

    // Keine Aussage ohne Quelle. An dieser Stelle steht die Glaubwürdigkeit
    // des ganzen Produkts (Abschnitt 6.3).
    expect(view.card.sources.length).toBeGreaterThan(0);
    for (const source of view.card.sources) {
      expect(source.title.length).toBeGreaterThan(3);
    }

    // Die Fragen sind wörtlich verwendbar formuliert — sonst wandern sie nicht
    // in eine Nachricht an den GU.
    for (const question of view.card.questionsForContractor) {
      expect(question.question.endsWith('?')).toBe(true);
    }
  });

  it('nennt zu jedem Vorgang seinen eigenen Namen und Zeitraum', async () => {
    const view = await cardOf(MIT_KARTE, bauherrToken);
    const task = taskNamed(MIT_KARTE);
    expect(view.taskId).toBe(task.id);
    expect(view.taskName).toBe(task.name);
    expect(view.taskStart).toBe(task.currentStart);
  });

  it('begründet jede empfohlene Fachprüfung', async () => {
    const view = await cardOf('Bodenplatte', bauherrToken);
    expect(view.card.expertRecommended).toBe(true);
    expect(view.card.expertReason).not.toBeNull();
    expect((view.card.expertReason ?? '').length).toBeGreaterThan(20);
  });

  it('markiert die Karte mit einer Gesetzesstelle', async () => {
    // Nur die Abnahme nennt Paragrafen — und trägt damit den festen Zusatz aus
    // CI 11.3.
    const abnahme = await cardOf('Abnahme und Übergabe', bauherrToken);
    expect(abnahme.card.legalNote).toBe(true);

    const estrich = await cardOf(MIT_KARTE, bauherrToken);
    expect(estrich.card.legalNote).toBe(false);
  });

  it('sagt es offen, wenn es zu einem Vorgang keine Karte gibt', async () => {
    const response = await request(
      `/api/v1/projects/${projectId}/tasks/${taskNamed(OHNE_KARTE).id}/guide-card`,
      { token: bauherrToken },
    );
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/noch keine Lotsenkarte/i);
  });

  it('verbirgt die Karte vor Fremden', async () => {
    // Die Karte selbst ist kein Geheimnis — der Vorgang, an dem sie hängt,
    // schon. Deshalb 404 und nicht 403.
    const response = await request(
      `/api/v1/projects/${projectId}/tasks/${taskNamed(MIT_KARTE).id}/guide-card`,
      { token: fremderToken },
    );
    expect(response.status).toBe(404);
  });

  it('zeigt sie auch dem Generalunternehmer', async () => {
    const view = await cardOf(MIT_KARTE, guToken);
    expect(view.card.key).toBe('estrich');
    // Die Merkliste des Bauherrn ist nicht seine.
    expect(view.canEditChecklist).toBe(false);
  });
});

describe('Gelesen und hilfreich', () => {
  const gelesen = (token: string): Promise<Response> =>
    request(`/api/v1/projects/${projectId}/tasks/${taskNamed('Innenputz').id}/guide-card/read`, {
      method: 'POST',
      token,
      body: JSON.stringify({}),
    });

  it('hält fest, dass jemand die Karte gesehen hat', async () => {
    const vorher = await cardOf('Innenputz', bauherrToken);
    expect(vorher.readAt).toBeNull();

    const response = await gelesen(bauherrToken);
    expect(response.status).toBe(200);
    const view = guideCardView.parse(await response.json());
    expect(view.readAt).not.toBeNull();
    expect(view.helpful).toBeNull();
  });

  it('nimmt eine Bewertung entgegen und lässt sie danach stehen', async () => {
    const bewertet = await request(
      `/api/v1/projects/${projectId}/tasks/${taskNamed('Innenputz').id}/guide-card/read`,
      { method: 'POST', token: bauherrToken, body: JSON.stringify({ helpful: true }) },
    );
    expect(guideCardView.parse(await bewertet.json()).helpful).toBe(true);

    // Ein zweites Öffnen ist kein Meinungswechsel.
    const nochmal = guideCardView.parse(await (await gelesen(bauherrToken)).json());
    expect(nochmal.helpful).toBe(true);

    // Ausdrücklich `null` nimmt die Bewertung zurück, ohne den Gelesen-Stand
    // zu verlieren.
    const zurueckgenommen = await request(
      `/api/v1/projects/${projectId}/tasks/${taskNamed('Innenputz').id}/guide-card/read`,
      { method: 'POST', token: bauherrToken, body: JSON.stringify({ helpful: null }) },
    );
    const view = guideCardView.parse(await zurueckgenommen.json());
    expect(view.helpful).toBeNull();
    expect(view.readAt).not.toBeNull();
  });

  it('hält die Rückmeldungen zweier Beteiligter auseinander', async () => {
    const guSicht = guideCardView.parse(await (await gelesen(guToken)).json());
    expect(guSicht.helpful).toBeNull();

    const bauherrSicht = await cardOf('Innenputz', bauherrToken);
    expect(bauherrSicht.readAt).not.toBeNull();
  });
});

describe('Checkliste', () => {
  const haken = (sourceKey: string, isDone: boolean, token: string): Promise<Response> =>
    request(
      `/api/v1/projects/${projectId}/tasks/${taskNamed('Fliesenarbeiten').id}/checklist/${sourceKey}`,
      { method: 'PUT', token, body: JSON.stringify({ isDone }) },
    );

  it('steht anfangs vollständig und ungehakt da', async () => {
    const view = await cardOf('Fliesenarbeiten', bauherrToken);
    expect(view.checklist).toHaveLength(view.card.watchFor.length);
    expect(view.checklist.every((entry) => !entry.isDone)).toBe(true);
    // Der Text kommt aus der Karte, nicht aus einer eigenen Tabelle.
    expect(view.checklist[0]!.text).toBe(view.card.watchFor[0]!.text);
  });

  it('setzt einen Haken und nimmt ihn wieder weg', async () => {
    const gesetzt = await haken('w1', true, bauherrToken);
    expect(gesetzt.status).toBe(200);
    const nachher = guideCardView.parse(await gesetzt.json());
    expect(nachher.checklist.find((entry) => entry.sourceKey === 'w1')?.isDone).toBe(true);
    expect(nachher.checklist.find((entry) => entry.sourceKey === 'w1')?.doneAt).not.toBeNull();
    expect(nachher.checklist.filter((entry) => entry.isDone)).toHaveLength(1);

    const zurueck = guideCardView.parse(await (await haken('w1', false, bauherrToken)).json());
    expect(zurueck.checklist.find((entry) => entry.sourceKey === 'w1')?.isDone).toBe(false);
    expect(zurueck.checklist.find((entry) => entry.sourceKey === 'w1')?.doneAt).toBeNull();
  });

  it('nimmt eine Notiz auf und lässt sie beim nächsten Haken stehen', async () => {
    const mitNotiz = await request(
      `/api/v1/projects/${projectId}/tasks/${taskNamed('Fliesenarbeiten').id}/checklist/w2`,
      {
        method: 'PUT',
        token: bauherrToken,
        body: JSON.stringify({ isDone: true, note: 'Mit dem Fliesenleger am Montag durchgegangen.' }),
      },
    );
    const view = guideCardView.parse(await mitNotiz.json());
    expect(view.checklist.find((entry) => entry.sourceKey === 'w2')?.note).toMatch(/Montag/);

    // Ein Haken ohne Angabe zur Notiz ist keine Aussage über die Notiz.
    const ohneAngabe = guideCardView.parse(await (await haken('w2', false, bauherrToken)).json());
    expect(ohneAngabe.checklist.find((entry) => entry.sourceKey === 'w2')?.note).toMatch(/Montag/);
  });

  it('kennt nur die Punkte, die auf der Karte stehen', async () => {
    const response = await haken('w99', true, bauherrToken);
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/gibt es auf dieser Lotsenkarte nicht/i);
  });

  it('weist erfundene Kennungen ab, bevor sie die Datenbank sehen', async () => {
    const response = await haken('../../etc', true, bauherrToken);
    expect([400, 404]).toContain(response.status);
  });

  it('lässt den Generalunternehmer die Liste des Bauherrn nicht abhaken', async () => {
    const response = await haken('w1', true, guToken);
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: string };
    // Auch die Fehlanzeige trägt den nächsten Schritt (CI 11.4).
    expect(body.error).toMatch(/Der Bauherr kann das/);
  });

  it('lässt Fremde gar nicht erst an den Vorgang', async () => {
    const response = await haken('w1', true, fremderToken);
    expect(response.status).toBe(404);
  });
});

describe('Wann eine Karte in den Blick rückt', () => {
  it('blendet sie sieben Tage vor Beginn ein und nicht früher', () => {
    const task = { currentStart: '2026-06-15', currentEnd: '2026-06-19' };
    expect(isGuideCardDue(task, '2026-06-07')).toBe(false);
    expect(isGuideCardDue(task, '2026-06-08')).toBe(true);
    expect(isGuideCardDue(task, '2026-06-17')).toBe(true);
    expect(isGuideCardDue(task, '2026-06-26')).toBe(true);
    expect(isGuideCardDue(task, '2026-06-27')).toBe(false);
  });

  it('gilt für die Vorgänge, die im echten Plan eine Karte tragen', () => {
    const estrich = taskNamed(MIT_KARTE);
    expect(estrich.currentStart).not.toBeNull();
    // Sieben Tage vor Beginn ist die Karte fällig — an genau dem Tag, an dem
    // der Bauherr noch etwas ändern kann.
    const sieben = new Date(`${estrich.currentStart!}T00:00:00Z`);
    sieben.setUTCDate(sieben.getUTCDate() - 7);
    expect(isGuideCardDue(estrich, sieben.toISOString().slice(0, 10))).toBe(true);
  });
});
