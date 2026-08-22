/**
 * Integrationstest der Abnahme von AP 2:
 *
 * „Zu jedem der zwölf Vorgänge erscheint rechtzeitig die passende Karte mit
 * Quellenangaben. Eine veröffentlichte Karte lässt sich per SQL nicht ändern."
 *
 * Der zweite Satz steht als Invariante in `packages/db`; hier geht es um den
 * ersten — und um die Frage, wer was damit tun darf.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { closePool, withAdminTx } from '@meinbaulotse/db';
import { guideCardView, type GuideCardView, type ProjectSchedule } from '@meinbaulotse/shared';
import { createApp } from './app.js';

const SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long';
process.env['SUPABASE_JWT_SECRET'] = SECRET;

const app = createApp();

let bauherrToken: string;
let gastToken: string;
let projektId: string;
let plan: ProjectSchedule;

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

/** Der Vorgang, zu dem es eine Karte gibt — gesucht über den Schlüssel im Plan. */
function taskWithCard(key: string): { id: string; name: string } {
  const task = plan.tasks.find((entry) => entry.guideCardKey === key);
  if (task === undefined) throw new Error(`Kein Vorgang mit der Karte „${key}" im Plan.`);
  return { id: task.id, name: task.name };
}

beforeAll(async () => {
  await withAdminTx(async (tx) => {
    await tx.query(
      `truncate schedule_change, audit_log, dependency, task, project_member, project,
                expert_org_member, expert_org restart identity cascade`,
    );
    await tx.query('delete from auth.users');
  });

  const bauherr = await createUser('karten-bauherr@example.test');
  bauherrToken = await tokenFor(bauherr);
  gastToken = await tokenFor(await createUser('karten-gast@example.test'));

  const angelegt = await request('/api/v1/projects/onboarding', {
    method: 'POST',
    token: bauherrToken,
    body: JSON.stringify({
      name: 'Kartenweg 7',
      buildType: 'efh_massiv',
      hasBasement: true,
      plannedStart: '2026-04-01',
      federalState: 'BY',
      contractType: 'verbraucherbauvertrag',
    }),
  });
  projektId = ((await angelegt.json()) as { projectId: string }).projectId;

  plan = (await (
    await request(`/api/v1/projects/${projektId}/schedule`, { token: bauherrToken })
  ).json()) as ProjectSchedule;
});

afterAll(async () => {
  await closePool();
});

describe('Welcher Vorgang trägt eine Karte', () => {
  it('nennt im Plan zu genau den Vorgängen eine Karte, für die es eine gibt', () => {
    const mitKarte = plan.tasks.filter((task) => task.guideCardKey !== null);
    // Zwölf Karten auf sechzehn Vorgänge: Manche Karte deckt zwei ab, etwa
    // Estrich und Trocknung.
    expect(mitKarte).toHaveLength(16);
    expect(new Set(mitKarte.map((task) => task.guideCardKey)).size).toBe(12);
  });

  it('ordnet die Karte dem richtigen Vorgang zu', () => {
    expect(taskWithCard('estrich').name).toMatch(/Estrich|Trocknung/);
    expect(taskWithCard('abnahme').name).toContain('Abnahme');
    expect(taskWithCard('bodenplatte').name).toMatch(/Bodenplatte|Sauberkeitsschicht/);
  });

  it('lässt Vorgänge ohne Karte ausdrücklich leer', () => {
    const ohne = plan.tasks.find((task) => task.name.includes('Baugrundgutachten'));
    expect(ohne?.guideCardKey).toBeNull();
  });
});

describe('Die Karte lesen', () => {
  it('liefert eine vollständige Karte mit Quellen', async () => {
    const task = taskWithCard('estrich');
    const response = await request(
      `/api/v1/projects/${projektId}/tasks/${task.id}/guide-card`,
      { token: bauherrToken },
    );
    expect(response.status).toBe(200);

    // Gegen den geteilten Vertrag, nicht gegen die Erwartung dieses Tests:
    // Was hier durchgeht, kann die Oberfläche auch verarbeiten.
    const view = guideCardView.parse(await response.json());

    expect(view.card.key).toBe('estrich');
    expect(view.card.title).toContain('Estrich');
    expect(view.card.whatsHappening.length).toBeGreaterThan(50);
    expect(view.card.watchFor.length).toBeGreaterThan(0);
    expect(view.card.questionsForContractor.length).toBeGreaterThan(0);
    expect(view.card.sources.length).toBeGreaterThan(0);
    expect(view.taskId).toBe(task.id);
  });

  it('nennt bei fünf Karten eine empfohlene Fachprüfung, samt Begründung', async () => {
    for (const key of ['bodenplatte', 'kellerabdichtung', 'blower-door', 'abnahme']) {
      const task = taskWithCard(key);
      const view = (await (
        await request(`/api/v1/projects/${projektId}/tasks/${task.id}/guide-card`, {
          token: bauherrToken,
        })
      ).json()) as GuideCardView;

      expect(view.card.expertRecommended, key).toBe(true);
      expect(view.card.expertReason, key).not.toBeNull();
    }
  });

  it('sagt es, wenn es zu einem Vorgang noch keine Karte gibt', async () => {
    const ohne = plan.tasks.find((task) => task.guideCardKey === null)!;
    const response = await request(
      `/api/v1/projects/${projektId}/tasks/${ohne.id}/guide-card`,
      { token: bauherrToken },
    );

    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: string };
    // Keine Fehlermeldung ohne nächsten Schritt (CI 11.4).
    expect(body.error).toContain('noch keine Lotsenkarte');
  });

  it('lässt einen Unbeteiligten nicht an die Karte eines fremden Bauvorhabens', async () => {
    const task = taskWithCard('estrich');
    const response = await request(
      `/api/v1/projects/${projektId}/tasks/${task.id}/guide-card`,
      { token: gastToken },
    );
    expect(response.status).toBe(404);
  });

  it('hält fest, dass die Karte offen war', async () => {
    const task = taskWithCard('innenputz');
    const erst = (await (
      await request(`/api/v1/projects/${projektId}/tasks/${task.id}/guide-card`, {
        token: bauherrToken,
      })
    ).json()) as GuideCardView;

    // Beim ersten Abruf entsteht der Eintrag, deshalb steht er schon in der
    // Antwort. Ohne ihn stünde die Karte weiter unter „lies dich ein".
    expect(erst.read).not.toBeNull();
    expect(erst.read?.helpful).toBeNull();
  });
});

describe('Die Checkliste', () => {
  it('entsteht aus den Punkten der Karte, in derselben Reihenfolge', async () => {
    const task = taskWithCard('fenster');
    const view = (await (
      await request(`/api/v1/projects/${projektId}/tasks/${task.id}/guide-card`, {
        token: bauherrToken,
      })
    ).json()) as GuideCardView;

    expect(view.checklist).toHaveLength(view.card.watchFor.length);
    expect(view.checklist.map((item) => item.text)).toEqual(
      view.card.watchFor.map((point) => point.text),
    );
    expect(view.checklist.every((item) => !item.isDone)).toBe(true);
    expect(view.canCheck).toBe(true);
  });

  it('entsteht bei einem zweiten Abruf nicht noch einmal', async () => {
    const task = taskWithCard('fliesen');
    const pfad = `/api/v1/projects/${projektId}/tasks/${task.id}/guide-card`;

    const erst = (await (await request(pfad, { token: bauherrToken })).json()) as GuideCardView;
    const nochmal = (await (await request(pfad, { token: bauherrToken })).json()) as GuideCardView;

    expect(nochmal.checklist).toHaveLength(erst.checklist.length);
    expect(nochmal.checklist.map((item) => item.id)).toEqual(
      erst.checklist.map((item) => item.id),
    );
  });

  it('lässt sich abhaken und wieder freigeben', async () => {
    const task = taskWithCard('dachstuhl');
    const view = (await (
      await request(`/api/v1/projects/${projektId}/tasks/${task.id}/guide-card`, {
        token: bauherrToken,
      })
    ).json()) as GuideCardView;
    const punkt = view.checklist[0]!;

    const abgehakt = await request(`/api/v1/projects/${projektId}/checklist/${punkt.id}`, {
      method: 'PATCH',
      token: bauherrToken,
      body: JSON.stringify({ isDone: true }),
    });
    expect(abgehakt.status).toBe(200);
    const nachher = (await abgehakt.json()) as { isDone: boolean; doneAt: string | null };
    expect(nachher.isDone).toBe(true);
    expect(nachher.doneAt).not.toBeNull();

    const zurueck = await request(`/api/v1/projects/${projektId}/checklist/${punkt.id}`, {
      method: 'PATCH',
      token: bauherrToken,
      body: JSON.stringify({ isDone: false }),
    });
    const wieder = (await zurueck.json()) as { isDone: boolean; doneAt: string | null };
    expect(wieder.isDone).toBe(false);
    expect(wieder.doneAt).toBeNull();
  });

  it('lässt einen Unbeteiligten nicht an fremde Punkte', async () => {
    const task = taskWithCard('dachstuhl');
    const view = (await (
      await request(`/api/v1/projects/${projektId}/tasks/${task.id}/guide-card`, {
        token: bauherrToken,
      })
    ).json()) as GuideCardView;

    const response = await request(
      `/api/v1/projects/${projektId}/checklist/${view.checklist[0]!.id}`,
      { method: 'PATCH', token: gastToken, body: JSON.stringify({ isDone: true }) },
    );
    expect(response.status).toBe(404);
  });
});

describe('War das hilfreich', () => {
  it('nimmt beide Antworten an und lässt sie zurücknehmen', async () => {
    const task = taskWithCard('rohinstallation-elektro');
    const pfad = `/api/v1/projects/${projektId}/tasks/${task.id}/guide-card`;
    await request(pfad, { token: bauherrToken });

    for (const antwort of [true, false, null]) {
      const response = await request(`${pfad}/feedback`, {
        method: 'POST',
        token: bauherrToken,
        body: JSON.stringify({ helpful: antwort }),
      });
      expect(response.status).toBe(200);
      expect(((await response.json()) as { helpful: boolean | null }).helpful).toBe(antwort);
    }
  });

  it('steht beim nächsten Abruf der Karte wieder da', async () => {
    const task = taskWithCard('rohbau-mauerwerk');
    const pfad = `/api/v1/projects/${projektId}/tasks/${task.id}/guide-card`;

    await request(pfad, { token: bauherrToken });
    await request(`${pfad}/feedback`, {
      method: 'POST',
      token: bauherrToken,
      body: JSON.stringify({ helpful: true }),
    });

    const view = (await (await request(pfad, { token: bauherrToken })).json()) as GuideCardView;
    expect(view.read?.helpful).toBe(true);
  });

  it('weist eine Rückmeldung ohne Aussage ab', async () => {
    const task = taskWithCard('rohbau-mauerwerk');
    const response = await request(
      `/api/v1/projects/${projektId}/tasks/${task.id}/guide-card/feedback`,
      { method: 'POST', token: bauherrToken, body: JSON.stringify({}) },
    );
    expect(response.status).toBe(422);
  });
});
