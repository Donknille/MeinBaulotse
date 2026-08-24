/**
 * Integrationstest der Abnahme von AP 6:
 *
 * „Abstimmungslink in fremdem Browser ohne Konto bestätigen, Status wechselt
 *  auf `mutual`. Ein Gegenvorschlag erzeugt `disputed` und einen
 *  Änderungseintrag mit Kanal `guest_link`."
 *
 * „Fremder Browser ohne Konto" heißt hier: keine einzige Anfrage trägt einen
 * `authorization`-Kopf. Genau darum geht es — ein Polier registriert sich
 * nicht, und ein Termin, den niemand gegenbestätigt, bleibt eine einseitige
 * Behauptung.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { closePool, withAdminTx } from '@meinbaulotse/db';
import {
  confirmationInPlainWords,
  guestLinkCreated,
  guestView,
  type GuestLinkCreateRequest,
  type GuestView,
} from '@meinbaulotse/shared';
import { createApp } from './app.js';

const SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long';
process.env['SUPABASE_JWT_SECRET'] = SECRET;
process.env['WEATHER_API_URL'] = '';

const app = createApp();

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

/**
 * Eine Anfrage aus dem fremden Browser: kein `authorization`-Kopf, nirgends.
 *
 * Der Kopf wird bewusst nie gesetzt und nicht nur weggelassen — würde ein
 * Test versehentlich eine Anmeldung mitschicken, bewiese er das Gegenteil von
 * dem, was er behauptet.
 */
function gast(path: string, body: unknown): Promise<Response> {
  return app.request(`http://localhost/api/v1/guest${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': 'Baustellenhandy/1.0',
      'x-forwarded-for': '203.0.113.7',
    },
    body: JSON.stringify(body),
  });
}

async function linkAnlegen(wunsch: Partial<GuestLinkCreateRequest> = {}): Promise<{
  url: string;
  token: string;
  id: string;
}> {
  const response = await request(`/api/v1/projects/${projectId}/guest-links`, {
    method: 'POST',
    token: bauherrToken,
    body: JSON.stringify({
      role: 'contractor',
      displayName: 'Bau GmbH',
      company: 'Bau GmbH',
      email: 'polier@example.test',
      scopes: ['confirm:task'],
      locale: 'de',
      ...wunsch,
    }),
  });
  expect(response.status).toBe(201);
  const angelegt = guestLinkCreated.parse(await response.json());
  return {
    url: angelegt.url,
    token: angelegt.url.split('#')[1]!,
    id: angelegt.link.id,
  };
}

async function sicht(token: string, name?: string): Promise<GuestView> {
  const response = await gast('/open', name === undefined ? { token } : { token, name });
  expect(response.status).toBe(200);
  return guestView.parse(await response.json());
}

function vorgang(view: GuestView, name: string): GuestView['tasks'][number] {
  const gefunden = view.tasks.find((task) => task.name.startsWith(name));
  if (gefunden === undefined) throw new Error(`Vorgang „${name}" steht nicht in der Sicht.`);
  return gefunden;
}

async function historie(taskId: string): Promise<
  { field: string; actor_channel: string; new_value: unknown; reason_code: string | null }[]
> {
  return withAdminTx(async (tx) => {
    const result = await tx.query<{
      field: string;
      actor_channel: string;
      new_value: unknown;
      reason_code: string | null;
    }>(
      `select field, actor_channel, new_value, reason_code
         from schedule_change where task_id = $1 order by created_at`,
      [taskId],
    );
    return result.rows;
  });
}

beforeAll(async () => {
  await withAdminTx(async (tx) => {
    await tx.query(
      `truncate media, diary_entry, guest_token, schedule_change, audit_log, checklist_item,
                guide_card_read, decision, dependency, task, project_member, project,
                expert_org_member, expert_org restart identity cascade`,
    );
    await tx.query('delete from auth.users');
  });

  const bauherr = await withAdminTx(async (tx) => {
    const result = await tx.query<{ id: string }>(
      "insert into auth.users (email) values ('abstimmung@example.test') returning id",
    );
    return result.rows[0]!.id;
  });
  bauherrToken = await tokenFor(bauherr);

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
});

afterAll(async () => {
  await closePool();
});

// ---------------------------------------------------------------------------

describe('Der Link', () => {
  it('trägt den Token im Fragment, nicht im Pfad', async () => {
    const { url } = await linkAnlegen();
    // Fragmente sendet kein Browser an einen Server. Der Token steht damit
    // weder im Zugriffsprotokoll noch im Referrer (Abschnitt 6.4).
    expect(url).toMatch(/\/abstimmung#[A-Za-z0-9_-]{40,}$/);
    expect(url.split('#')[0]).not.toContain('token');
  });

  it('hinterlässt in der Datenbank nur den Hash', async () => {
    const { token, id } = await linkAnlegen();
    const gespeichert = await withAdminTx(async (tx) => {
      const result = await tx.query<{ token_hash: string }>(
        'select token_hash from guest_token where id = $1',
        [id],
      );
      return result.rows[0]!.token_hash;
    });
    expect(gespeichert).toMatch(/^[0-9a-f]{64}$/);
    expect(gespeichert).not.toContain(token);
  });

  it('läuft nach 180 Tagen ab, wenn nichts anderes gesagt wird', async () => {
    const { token } = await linkAnlegen();
    const view = await sicht(token);
    const tage = (new Date(view.expiresAt).getTime() - Date.now()) / 86_400_000;
    expect(Math.round(tage)).toBe(180);
  });

  it('verlangt für ein Einzelgewerk sein Gewerk', async () => {
    const response = await request(`/api/v1/projects/${projectId}/guest-links`, {
      method: 'POST',
      token: bauherrToken,
      body: JSON.stringify({
        role: 'trade',
        displayName: 'Ohne Gewerk',
        scopes: ['view:trade'],
      }),
    });
    expect(response.status).toBe(422);
  });
});

describe('Der fremde Browser ohne Konto', () => {
  it('sieht das Bauvorhaben und seine Vorgänge', async () => {
    const { token } = await linkAnlegen();
    const view = await sicht(token);

    expect(view.projectName).toBe('Musterweg 4');
    expect(view.tasks.length).toBeGreaterThan(20);
    expect(view.locale).toBe('de');
    expect(view.scopes).toEqual(['confirm:task']);
  });

  it('wird beim ersten Mal nach Name und Firma gefragt, danach nicht mehr', async () => {
    const { token } = await linkAnlegen();
    expect((await sicht(token)).needsIntroduction).toBe(true);

    const nachher = await sicht(token, 'Jörg Baumeister');
    expect(nachher.needsIntroduction).toBe(false);
    expect(nachher.memberName).toBe('Jörg Baumeister');

    // Ein zweiter Name überschreibt den ersten nicht: Sonst stünde in der
    // Bauakte am Ende jemand anderes über derselben Bestätigung.
    const nochmal = await sicht(token, 'Jemand ganz anderes');
    expect(nochmal.memberName).toBe('Jörg Baumeister');
  });

  it('bekommt für einen zurückgezogenen Link dieselbe Antwort wie für einen erfundenen', async () => {
    const { token, id } = await linkAnlegen();
    await request(`/api/v1/projects/${projectId}/guest-links/${id}`, {
      method: 'DELETE',
      token: bauherrToken,
    });

    const zurueckgezogen = await gast('/open', { token });
    const erfunden = await gast('/open', { token: 'x'.repeat(43) });
    expect(zurueckgezogen.status).toBe(401);
    expect(erfunden.status).toBe(401);
    expect(await zurueckgezogen.json()).toEqual(await erfunden.json());
  });

  it('kommt mit einem abgelaufenen Link nicht mehr herein', async () => {
    const { token, id } = await linkAnlegen();
    await withAdminTx(async (tx) => {
      await tx.query("update guest_token set expires_at = now() - interval '1 day' where id = $1", [
        id,
      ]);
    });
    expect((await gast('/open', { token })).status).toBe(401);
  });
});

describe('Passt', () => {
  it('macht aus „von dir eingetragen" ein „abgestimmt"', async () => {
    const { token } = await linkAnlegen();
    const vorher = await sicht(token, 'Jörg Baumeister');
    const innenputz = vorgang(vorher, 'Innenputz');

    expect(innenputz.confirmation).toBe('self_stated');
    expect(innenputz.canConfirm).toBe(true);

    const response = await gast(`/tasks/${innenputz.id}/confirm`, { token });
    expect(response.status).toBe(200);
    const nachher = guestView.parse(await response.json());

    const bestaetigt = vorgang(nachher, 'Innenputz');
    expect(bestaetigt.confirmation).toBe('mutual');
    expect(bestaetigt.canConfirm).toBe(false);
    expect(confirmationInPlainWords('mutual')).toBe('Abgestimmt');
  });

  it('hält die Abstimmung in der Historie fest, mit Kanal guest_link', async () => {
    const { token } = await linkAnlegen();
    const view = await sicht(token, 'Jörg Baumeister');
    const estrich = vorgang(view, 'Estrich');
    await gast(`/tasks/${estrich.id}/confirm`, { token });

    const eintraege = await historie(estrich.id);
    const abstimmung = eintraege.find((eintrag) => eintrag.field === 'confirmation');
    expect(abstimmung).toBeDefined();
    expect(abstimmung!.actor_channel).toBe('guest_link');
  });

  it('lässt einen Nur-Leser nicht bestätigen', async () => {
    const { token } = await linkAnlegen({
      role: 'viewer',
      displayName: 'Die Bank',
      scopes: ['view:project'],
    });
    const view = await sicht(token);
    const irgendein = view.tasks[0]!;
    expect(irgendein.canConfirm).toBe(false);

    const response = await gast(`/tasks/${irgendein.id}/confirm`, { token });
    // Die Policy lässt die Zeile gar nicht erst an sich heran, also findet das
    // UPDATE nichts. Von außen ist „darf nicht" und „gibt es nicht" dasselbe,
    // und das ist Absicht.
    expect([403, 404]).toContain(response.status);
  });

  it('lässt einen Link, der nur melden darf, nicht bestätigen', async () => {
    // Der Schnitt aus Rolle und Scope: Die Rolle `contractor` dürfte
    // bestätigen, dieser Link nicht.
    const { token } = await linkAnlegen({
      displayName: 'Nur Meldungen',
      scopes: ['report:progress'],
    });
    const view = await sicht(token);
    expect(view.tasks[0]!.canConfirm).toBe(false);
    const response = await gast(`/tasks/${view.tasks[0]!.id}/confirm`, { token });
    expect([403, 404]).toContain(response.status);
  });
});

describe('Anderer Termin', () => {
  it('erzeugt zwei Angaben statt einer Überschreibung', async () => {
    const { token } = await linkAnlegen();
    const view = await sicht(token, 'Jörg Baumeister');
    const fliesen = vorgang(view, 'Fliesen');
    const urspruenglich = fliesen.start;

    const response = await gast(`/tasks/${fliesen.id}/counter`, {
      token,
      start: '2027-01-11',
      end: '2027-01-22',
      note: 'Wir haben in der Woche davor eine andere Baustelle.',
    });
    expect(response.status).toBe(200);
    const nachher = guestView.parse(await response.json());
    const strittig = vorgang(nachher, 'Fliesen');

    expect(strittig.confirmation).toBe('disputed');
    expect(strittig.counterStart).toBe('2027-01-11');
    expect(strittig.counterEnd).toBe('2027-01-22');
    expect(strittig.counterNote).toContain('andere Baustelle');
    expect(strittig.counterBy).toBe('Jörg Baumeister');
    // Der eingetragene Termin steht unverändert daneben. Genau das ist der
    // Unterschied zwischen „zwei Angaben" und „der GU hat geändert".
    expect(strittig.start).toBe(urspruenglich);
    expect(confirmationInPlainWords('disputed')).toBe('Zwei Angaben');
  });

  it('schreibt einen Änderungseintrag mit Kanal guest_link', async () => {
    const { token } = await linkAnlegen();
    const view = await sicht(token, 'Jörg Baumeister');
    const maler = vorgang(view, 'Malerarbeiten');

    await gast(`/tasks/${maler.id}/counter`, {
      token,
      start: '2027-02-01',
      end: '2027-02-10',
      note: 'Lieferung der Farbe verschiebt sich.',
      reason: 'lieferzeit',
    });

    const eintraege = await historie(maler.id);
    const gegenvorschlag = eintraege.find((eintrag) => eintrag.field === 'counter_proposal');
    expect(gegenvorschlag).toBeDefined();
    expect(gegenvorschlag!.actor_channel).toBe('guest_link');
    expect(gegenvorschlag!.reason_code).toBe('lieferzeit');
    expect(gegenvorschlag!.new_value).toMatchObject({ start: '2027-02-01', end: '2027-02-10' });
  });

  it('weist ein Ende vor dem Beginn ab', async () => {
    const { token } = await linkAnlegen();
    const view = await sicht(token, 'Jörg Baumeister');
    const response = await gast(`/tasks/${view.tasks[0]!.id}/counter`, {
      token,
      start: '2027-02-10',
      end: '2027-02-01',
    });
    expect(response.status).toBe(422);
  });
});

describe('Was danach passiert', () => {
  it('nimmt eine Abstimmung zurück, sobald der Termin sich bewegt', async () => {
    const { token } = await linkAnlegen();
    const view = await sicht(token, 'Jörg Baumeister');
    const dachstuhl = vorgang(view, 'Dachstuhl');
    await gast(`/tasks/${dachstuhl.id}/confirm`, { token });
    expect(vorgang(await sicht(token), 'Dachstuhl').confirmation).toBe('mutual');

    // Der Bauherr verschiebt. Ein bewegter Termin ist nicht mehr derselbe
    // Termin — eine Abstimmung, die ihn überlebt, wäre eine Behauptung über
    // etwas, worüber nie gesprochen wurde.
    const verschoben = await request(
      `/api/v1/projects/${projectId}/tasks/${dachstuhl.id}`,
      {
        method: 'PATCH',
        token: bauherrToken,
        body: JSON.stringify({ earliestStart: '2026-12-14', reason: 'planungsaenderung' }),
      },
    );
    expect(verschoben.status).toBe(200);

    expect(vorgang(await sicht(token), 'Dachstuhl').confirmation).toBe('self_stated');
  });

  it('räumt mit der Bestätigung auch den Gegenvorschlag ab', async () => {
    const { token } = await linkAnlegen();
    const view = await sicht(token, 'Jörg Baumeister');
    const bodenbelaege = vorgang(view, 'Bodenbeläge');

    await gast(`/tasks/${bodenbelaege.id}/counter`, {
      token,
      start: '2027-03-01',
      end: '2027-03-05',
    });
    expect(vorgang(await sicht(token), 'Bodenbeläge').confirmation).toBe('disputed');

    // „Passt doch." Wer zustimmt, hat seinen eigenen Einwand zurückgenommen.
    await gast(`/tasks/${bodenbelaege.id}/confirm`, { token });
    const danach = vorgang(await sicht(token), 'Bodenbeläge');
    expect(danach.confirmation).toBe('mutual');
    expect(danach.counterStart).toBeNull();
  });

  it('lässt den Bauherrn sehen, was der Gast gemeldet hat', async () => {
    const { token } = await linkAnlegen({ scopes: ['confirm:task', 'report:progress'] });
    const view = await sicht(token, 'Jörg Baumeister');
    const erdarbeiten = vorgang(view, 'Erdarbeiten');

    const gemeldet = await gast(`/tasks/${erdarbeiten.id}/progress`, {
      token,
      actualStart: '2026-04-08',
    });
    expect(gemeldet.status).toBe(200);

    const plan = await request(`/api/v1/projects/${projectId}/schedule`, { token: bauherrToken });
    const tasks = ((await plan.json()) as { tasks: { id: string; actualStart: string | null }[] })
      .tasks;
    expect(tasks.find((task) => task.id === erdarbeiten.id)?.actualStart).toBe('2026-04-08');
  });
});

describe('Das Protokoll', () => {
  it('hält jede Benutzung fest, mit Streuwert statt Adresse', async () => {
    const { token, id } = await linkAnlegen();
    await sicht(token);
    await sicht(token);

    const eintraege = await withAdminTx(async (tx) => {
      const result = await tx.query<{
        action: string;
        actor_channel: string;
        ip_hash: string | null;
        user_agent_hash: string | null;
      }>(
        `select action, actor_channel, ip_hash, user_agent_hash
           from audit_log where entity_id = $1 order by created_at`,
        [id],
      );
      return result.rows;
    });

    expect(eintraege.length).toBe(2);
    expect(eintraege[0]!.action).toBe('guest.open');
    expect(eintraege[0]!.actor_channel).toBe('guest_link');
    // Ein Streuwert beantwortet „derselbe Link, plötzlich von woanders" und
    // sonst nichts. Die Adresse selbst steht nirgends (Abschnitt 6.5).
    expect(eintraege[0]!.ip_hash).toMatch(/^[0-9a-f]{32}$/);
    expect(eintraege[0]!.ip_hash).not.toContain('203.0.113');
    expect(eintraege[0]!.user_agent_hash).toMatch(/^[0-9a-f]{32}$/);
  });

  it('bremst einen Link, der zu oft anklopft', async () => {
    const { token, id } = await linkAnlegen();
    await withAdminTx(async (tx) => {
      // Das Fenster kurz vor der Grenze — sechzig echte Aufrufe wären ein
      // langsamer Test für eine Zahl, die ohnehin einstellbar ist.
      await tx.query(
        "update guest_token set window_started_at = now(), window_count = 60 where id = $1",
        [id],
      );
    });

    expect((await gast('/open', { token })).status).toBe(429);
  });
});

describe('Zwei Angaben auflösen', () => {
  it('macht aus dem übernommenen Termin einen abgestimmten', async () => {
    const { token } = await linkAnlegen();
    const view = await sicht(token, 'Jörg Baumeister');
    const putz = vorgang(view, 'Innenputz');

    await gast(`/tasks/${putz.id}/counter`, {
      token,
      start: '2027-02-15',
      end: '2027-02-26',
      note: 'Vorher haben wir keine Kolonne frei.',
    });

    const antwort = await request(`/api/v1/projects/${projectId}/tasks/${putz.id}/dispute`, {
      method: 'POST',
      token: bauherrToken,
      body: JSON.stringify({ accept: true }),
    });
    expect(antwort.status).toBe(200);

    const plan = (await antwort.json()) as {
      tasks: {
        id: string;
        currentStart: string | null;
        confirmation: string;
        counterStart: string | null;
      }[];
    };
    const danach = plan.tasks.find((task) => task.id === putz.id)!;

    // Der Termin des Unternehmens gilt — und ist damit im selben Zug
    // abgestimmt. Hier stand einmal `self_stated`: Die Neuberechnung
    // überschrieb das Ende, der Trigger sah eine Terminänderung und räumte die
    // gerade hergestellte Einigkeit wieder ab.
    expect(danach.currentStart).toBe('2027-02-15');
    expect(danach.confirmation).toBe('mutual');
    expect(danach.counterStart).toBeNull();
  });

  it('schreibt die Auswirkung auf den Endtermin in die Historie', async () => {
    const { token } = await linkAnlegen();
    const view = await sicht(token, 'Jörg Baumeister');
    const estrich = vorgang(view, 'Estrich');
    const spaeter = '2027-03-01';

    await gast(`/tasks/${estrich.id}/counter`, { token, start: spaeter, end: '2027-03-05' });
    await request(`/api/v1/projects/${projectId}/tasks/${estrich.id}/dispute`, {
      method: 'POST',
      token: bauherrToken,
      body: JSON.stringify({ accept: true }),
    });

    const eintraege = await historie(estrich.id);
    const verschiebung = eintraege.filter((eintrag) => eintrag.field === 'current_start').at(-1);
    expect(verschiebung).toBeDefined();
    expect(verschiebung!.reason_code).toBe('kapazitaet');
  });

  it('lässt den Bauherrn beim eingetragenen Termin bleiben', async () => {
    const { token } = await linkAnlegen();
    const view = await sicht(token, 'Jörg Baumeister');
    const dach = vorgang(view, 'Dacheindeckung');
    const urspruenglich = dach.start;

    await gast(`/tasks/${dach.id}/counter`, { token, start: '2027-04-01', end: '2027-04-08' });
    const antwort = await request(`/api/v1/projects/${projectId}/tasks/${dach.id}/dispute`, {
      method: 'POST',
      token: bauherrToken,
      body: JSON.stringify({ accept: false }),
    });
    expect(antwort.status).toBe(200);

    const plan = (await antwort.json()) as {
      tasks: { id: string; currentStart: string | null; confirmation: string }[];
    };
    const danach = plan.tasks.find((task) => task.id === dach.id)!;
    expect(danach.currentStart).toBe(urspruenglich);
    // Wieder eine einseitige Angabe. Das ist kein Rückschritt, sondern die
    // Wahrheit: Man hat gesprochen und ist sich nicht einig geworden.
    expect(danach.confirmation).toBe('self_stated');
  });
});
