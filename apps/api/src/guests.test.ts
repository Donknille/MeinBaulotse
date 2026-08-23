/**
 * Integrationstest der Abnahme von AP 6:
 *
 * „Abstimmungslink in fremdem Browser ohne Konto bestätigen, Status wechselt
 * auf `mutual`. Ein Gegenvorschlag erzeugt `disputed` und einen
 * Änderungseintrag mit Kanal `guest_link`."
 *
 * „Fremder Browser ohne Konto" heißt hier: eine Anfrage ohne jeden
 * Anmeldekopf, nur mit dem Token aus dem Link.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { closePool, withAdminTx } from '@meinbaulotse/db';
import { guestSession, type GuestSession, type ProjectSchedule } from '@meinbaulotse/shared';
import { createApp } from './app.js';

const SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long';
process.env['SUPABASE_JWT_SECRET'] = SECRET;

const app = createApp();

let bauherrToken: string;
let projektId: string;
let guMemberId: string;
let fliesenMemberId: string;
let guLink: string;
let fliesenLink: string;
let innenputzId: string;
let fliesenTaskId: string;

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

beforeAll(async () => {
  await withAdminTx(async (tx) => {
    await tx.query(
      `truncate task_confirmation, guest_token, media, diary_entry, schedule_change, audit_log,
                dependency, task, project_member, project, expert_org_member, expert_org
                restart identity cascade`,
    );
    await tx.query('delete from auth.users');
  });

  const bauherr = await withAdminTx(async (tx) => {
    const result = await tx.query<{ id: string }>(
      'insert into auth.users (email) values ($1) returning id',
      ['gast-bauherr@example.test'],
    );
    return result.rows[0]!.id;
  });
  bauherrToken = await tokenFor(bauherr);

  const angelegt = await request('/api/v1/projects/onboarding', {
    method: 'POST',
    token: bauherrToken,
    body: JSON.stringify({
      name: 'Gastweg 12',
      buildType: 'efh_massiv',
      hasBasement: true,
      plannedStart: '2026-04-01',
      federalState: 'BY',
      contractType: 'verbraucherbauvertrag',
    }),
  });
  projektId = ((await angelegt.json()) as { projectId: string }).projectId;

  // Ein GU ohne Konto und ein Einzelgewerk — beide bekommen nur einen Link.
  const ids = await withAdminTx(async (tx) => {
    const gu = await tx.query<{ id: string }>(
      `insert into project_member (project_id, role, display_name, company, email)
       values ($1, 'contractor', 'Jörg Baumeister', 'Baumeister Bau', 'gu@example.test')
       returning id`,
      [projektId],
    );
    const fliesenTrade = await tx.query<{ id: string }>(
      "select id from trade where code = 'fliesen' and project_id is null",
    );
    const gewerk = await tx.query<{ id: string }>(
      `insert into project_member (project_id, role, display_name, trade_id, email)
       values ($1, 'trade', 'Fliesen Kraft', $2, 'fliesen@example.test')
       returning id`,
      [projektId, fliesenTrade.rows[0]!.id],
    );
    return { gu: gu.rows[0]!.id, gewerk: gewerk.rows[0]!.id };
  });
  guMemberId = ids.gu;
  fliesenMemberId = ids.gewerk;

  const plan = (await (
    await request(`/api/v1/projects/${projektId}/schedule`, { token: bauherrToken })
  ).json()) as ProjectSchedule;
  innenputzId = plan.tasks.find((task) => task.name.includes('Innenputz'))!.id;
  fliesenTaskId = plan.tasks.find((task) => task.name.includes('Fliesenarbeiten'))!.id;

  guLink = (
    (await (
      await request(`/api/v1/projects/${projektId}/guest-links`, {
        method: 'POST',
        token: bauherrToken,
        body: JSON.stringify({ memberId: guMemberId, sentTo: 'gu@example.test' }),
      })
    ).json()) as { token: string }
  ).token;

  fliesenLink = (
    (await (
      await request(`/api/v1/projects/${projektId}/guest-links`, {
        method: 'POST',
        token: bauherrToken,
        body: JSON.stringify({ memberId: fliesenMemberId, locale: 'pl' }),
      })
    ).json()) as { token: string }
  ).token;
});

afterAll(async () => {
  await closePool();
});

describe('Den Link anlegen', () => {
  it('gibt den Token genau einmal heraus und speichert nur den Hash', async () => {
    expect(guLink).toMatch(/^mblg_/);

    const gespeichert = await withAdminTx(async (tx) =>
      (
        await tx.query<{ token_hash: string }>(
          'select token_hash from guest_token where member_id = $1',
          [guMemberId],
        )
      ).rows[0]!.token_hash,
    );
    expect(gespeichert).toMatch(/^[0-9a-f]{64}$/);
    expect(gespeichert).not.toContain(guLink);
  });

  it('leitet die Rechte aus der Rolle ab, nicht aus der Anfrage', async () => {
    const response = await request(`/api/v1/projects/${projektId}/guest-links`, {
      token: bauherrToken,
    });
    const { links } = (await response.json()) as {
      links: { role: string; scopes: string[]; locale: string }[];
    };

    const gu = links.find((link) => link.role === 'contractor')!;
    expect(gu.scopes).toContain('confirm:task');
    expect(gu.scopes).toContain('view:project');

    const gewerk = links.find((link) => link.role === 'trade')!;
    expect(gewerk.scopes).toContain('view:trade');
    expect(gewerk.scopes).not.toContain('view:project');
    expect(gewerk.locale).toBe('pl');
  });

  it('lässt niemanden Links anlegen, der keine Mitglieder einlädt', async () => {
    const fremd = await withAdminTx(async (tx) => {
      const result = await tx.query<{ id: string }>(
        'insert into auth.users (email) values ($1) returning id',
        ['gast-fremd@example.test'],
      );
      return result.rows[0]!.id;
    });

    const response = await request(`/api/v1/projects/${projektId}/guest-links`, {
      method: 'POST',
      token: await tokenFor(fremd),
      body: JSON.stringify({ memberId: guMemberId }),
    });
    expect(response.status).toBe(404);
  });
});

describe('Der fremde Browser ohne Konto', () => {
  it('sieht das Bauvorhaben mit dem Token allein', async () => {
    const response = await request('/api/guest/session', { token: guLink });
    expect(response.status).toBe(200);

    const parsed = guestSession.safeParse(await response.json());
    expect(parsed.success, JSON.stringify(parsed.error?.flatten())).toBe(true);

    const session = parsed.data!;
    expect(session.projectName).toBe('Gastweg 12');
    expect(session.displayName).toBe('Jörg Baumeister');
    expect(session.role).toBe('contractor');
    expect(session.tasks.length).toBeGreaterThan(0);
  });

  it('zeigt einem Einzelgewerk nur seinen eigenen Ausschnitt', async () => {
    const session = (await (
      await request('/api/guest/session', { token: fliesenLink })
    ).json()) as GuestSession;

    expect(session.role).toBe('trade');
    expect(session.tasks.length).toBeGreaterThan(0);
    // Zeilenschärfe aus Abschnitt 2.2 — durchgesetzt von der RLS, nicht hier.
    expect(session.tasks.every((task) => task.tradeName === 'Fliesenleger')).toBe(true);
  });

  it('weist einen erfundenen Token ab, ohne zu verraten, welche es gibt', async () => {
    const response = await request('/api/guest/session', { token: 'mblg_ausgedacht' });
    expect(response.status).toBe(401);
    expect(((await response.json()) as { error: string }).error).toContain('gilt nicht mehr');
  });

  it('weist einen gesperrten Link ab', async () => {
    const { id, token } = (await (
      await request(`/api/v1/projects/${projektId}/guest-links`, {
        method: 'POST',
        token: bauherrToken,
        body: JSON.stringify({ memberId: guMemberId }),
      })
    ).json()) as { id: string; token: string };

    // Vor dem Sperren trägt der Link: Sonst prüfte der Test nur, dass ein
    // erfundener Token nicht funktioniert — das steht schon darüber.
    expect((await request('/api/guest/session', { token })).status).toBe(200);

    await request(`/api/v1/projects/${projektId}/guest-links/${id}`, {
      method: 'DELETE',
      token: bauherrToken,
    });

    const response = await request('/api/guest/session', { token });
    expect(response.status).toBe(401);
  });

  /**
   * Ratenbegrenzung, Abschnitt 2.3.
   *
   * Der Link ist öffentlich — wer ihn hat, kommt hinein, und wer ihn
   * weitergibt, gibt ihn an mehrere weiter. Ohne Deckel wäre er ein offener
   * Hahn auf die Datenbank. Der Deckel sitzt in der Datenbank, nicht im
   * Anwendungscode: Ein zweiter Server-Prozess zählt sonst wieder von vorn.
   *
   * Abgewiesen wird nur der Zugriff, nicht der Link. Ein Bauleiter mit
   * hektischem Daumen soll eine Minute später wieder hineinkommen.
   */
  it('bremst einen Link, der zu oft aufgerufen wird — und lässt ihn danach wieder herein', async () => {
    const { id, token } = (await (
      await request(`/api/v1/projects/${projektId}/guest-links`, {
        method: 'POST',
        token: bauherrToken,
        body: JSON.stringify({ memberId: guMemberId }),
      })
    ).json()) as { id: string; token: string };

    // Nacheinander, nicht parallel: Der Zähler ist eine Zeile, und
    // gleichzeitige Aufrufe würden sich gegenseitig sperren statt zählen.
    let letzter = 0;
    for (let i = 0; i < 32; i += 1) {
      letzter = (await request('/api/guest/session', { token })).status;
      if (letzter === 429) break;
    }
    expect(letzter).toBe(429);

    // Das Fenster ist eine Minute. Statt sie abzuwarten, wird es
    // vorgestellt — geprüft werden soll die Erholung, nicht die Uhr.
    await withAdminTx(async (tx) =>
      tx.query(
        "update guest_token set window_started_at = now() - interval '2 minutes' where id = $1",
        [id],
      ),
    );

    expect((await request('/api/guest/session', { token })).status).toBe(200);
  });
});

describe('Passt das?', () => {
  it('hebt den Bestätigungsgrad auf abgestimmt — die Abnahme von AP 6', async () => {
    const antwort = await request(`/api/guest/tasks/${innenputzId}/answer`, {
      method: 'POST',
      token: guLink,
      body: JSON.stringify({ agree: true }),
    });
    expect(antwort.status).toBe(200);
    expect(((await antwort.json()) as { confirmation: string }).confirmation).toBe('mutual');

    // Und der Bauherr sieht es in seinem Plan.
    const plan = (await (
      await request(`/api/v1/projects/${projektId}/schedule`, { token: bauherrToken })
    ).json()) as ProjectSchedule;
    expect(plan.tasks.find((task) => task.id === innenputzId)!.confirmation).toBe('mutual');
  });

  it('erzeugt bei einem Gegenvorschlag zwei Angaben und einen Eintrag mit Kanal guest_link', async () => {
    const vorher = (await (
      await request(`/api/v1/projects/${projektId}/schedule`, { token: bauherrToken })
    ).json()) as ProjectSchedule;
    const fliesen = vorher.tasks.find((task) => task.id === fliesenTaskId)!;

    const antwort = await request(`/api/guest/tasks/${fliesenTaskId}/answer`, {
      method: 'POST',
      token: guLink,
      body: JSON.stringify({
        agree: false,
        start: '2026-11-02',
        note: 'Der Trupp ist erst ab November frei.',
      }),
    });
    expect(antwort.status).toBe(200);
    expect(((await antwort.json()) as { confirmation: string }).confirmation).toBe('disputed');

    const eintrag = await withAdminTx(async (tx) =>
      (
        await tx.query<{
          field: string;
          actor_channel: string;
          old_value: string;
          new_value: string;
          reason_text: string;
        }>(
          `select field, actor_channel::text as actor_channel,
                  old_value #>> '{}' as old_value, new_value #>> '{}' as new_value, reason_text
             from schedule_change
            where task_id = $1 and field = 'proposed_start'
            order by created_at desc limit 1`,
          [fliesenTaskId],
        )
      ).rows[0],
    );

    expect(eintrag).toBeDefined();
    expect(eintrag!.actor_channel).toBe('guest_link');
    expect(eintrag!.new_value).toBe('2026-11-02');
    expect(eintrag!.reason_text).toContain('November');

    // Der Plan selbst hat sich **nicht** bewegt: Ein Gegenvorschlag ist eine
    // Aussage, keine Änderung. Der Termin gehört dem Bauherrn.
    const nachher = (await (
      await request(`/api/v1/projects/${projektId}/schedule`, { token: bauherrToken })
    ).json()) as ProjectSchedule;
    const danach = nachher.tasks.find((task) => task.id === fliesenTaskId)!;
    expect(danach.currentStart).toBe(fliesen.currentStart);
    expect(danach.confirmation).toBe('disputed');
  });

  it('verlangt für einen anderen Termin ein Datum', async () => {
    const response = await request(`/api/guest/tasks/${innenputzId}/answer`, {
      method: 'POST',
      token: guLink,
      body: JSON.stringify({ agree: false, note: 'Passt nicht.' }),
    });
    expect(response.status).toBe(422);
  });

  it('lässt ein Einzelgewerk nicht an fremde Vorgänge', async () => {
    const response = await request(`/api/guest/tasks/${innenputzId}/answer`, {
      method: 'POST',
      token: fliesenLink,
      body: JSON.stringify({ agree: true }),
    });
    // Der Innenputz gehört dem Putzer, nicht dem Fliesenleger. Für das
    // Einzelgewerk ist er deshalb gar nicht da — nicht gefunden und nicht
    // sichtbar sehen von außen gleich aus, wie überall im Produkt.
    expect(response.status).toBe(404);
  });

  it('hält jede Rückmeldung fest, auch die überholte', async () => {
    await request(`/api/guest/tasks/${innenputzId}/answer`, {
      method: 'POST',
      token: guLink,
      body: JSON.stringify({ agree: true }),
    });

    const anzahl = await withAdminTx(async (tx) =>
      (
        await tx.query<{ count: string }>(
          'select count(*)::text as count from task_confirmation where task_id = $1',
          [innenputzId],
        )
      ).rows[0]!.count,
    );
    expect(Number(anzahl)).toBeGreaterThan(1);
  });

  it('lässt eine Rückmeldung nicht nachträglich ändern', async () => {
    await expect(
      withAdminTx(async (tx) =>
        tx.query("update task_confirmation set note = 'anders' where task_id = $1", [innenputzId]),
      ),
    ).rejects.toThrow(/append-only/i);
  });
});
