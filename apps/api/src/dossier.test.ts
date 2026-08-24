/**
 * Integrationstest der Abnahme von AP 9:
 *
 * „Export über drei Monate ergibt ein PDF, in dem abgestimmte, einseitige und
 *  widersprüchliche Angaben optisch unterscheidbar sind."
 *
 * Das PDF entsteht im Browser (warum, steht in `dossier.ts`). Prüfbar ist hier
 * die Hälfte, auf der es beruht: **dass die Akte die drei Grade überhaupt
 * getrennt führt** und dass jeder Eintrag die Unterscheidung mitbringt, statt
 * sie der Darstellung zu überlassen. Eine Chronik, die den Bestätigungsgrad
 * verliert, kann keine Gestaltung mehr retten.
 *
 * Der Zeitraum ist bewusst nicht fest verdrahtet: Er läuft ab heute drei
 * Monate, denn Mängel, Freigaben und Änderungen tragen `now()`. Ein Test mit
 * festem Datum wäre irgendwann grün, ohne noch etwas zu prüfen.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { closePool, withAdminTx } from '@meinbaulotse/db';
import {
  CONFIRMATION_MARK,
  dossier as dossierSchema,
  guestLinkCreated,
  guestView,
  type Dossier,
  type GuestView,
} from '@meinbaulotse/shared';
import { createApp } from './app.js';

const SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long';
process.env['SUPABASE_JWT_SECRET'] = SECRET;
process.env['WEATHER_API_URL'] = '';

const app = createApp();

let bauherrToken: string;
let guToken: string;
let projectId: string;
/** Der Zeitraum der Akte: heute plus drei Monate. */
let heute: string;
let inDreiMonaten: string;

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

/** Eine Anfrage aus dem fremden Browser — ohne `authorization`, wie in AP 6. */
function gast(path: string, body: unknown): Promise<Response> {
  return app.request(`http://localhost/api/v1/guest${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function akte(
  von = heute,
  bis = inDreiMonaten,
  token = bauherrToken,
): Promise<Dossier> {
  const response = await request(
    `/api/v1/projects/${projectId}/dossier?from=${von}&to=${bis}`,
    { token },
  );
  expect(response.status).toBe(200);
  // Nicht bloß `as Dossier`: Der Vertrag aus `packages/shared` ist die halbe
  // Abnahme — er ist es, der jedem Eintrag den Bestätigungsgrad abverlangt.
  return dossierSchema.parse(await response.json());
}

function vorgang(view: GuestView, name: string): GuestView['tasks'][number] {
  const gefunden = view.tasks.find((task) => task.name.startsWith(name));
  if (gefunden === undefined) throw new Error(`Vorgang „${name}" steht nicht in der Sicht.`);
  return gefunden;
}

function eintraege(inhalt: Dossier, kind: Dossier['entries'][number]['kind']) {
  return inhalt.entries.filter((eintrag) => eintrag.kind === kind);
}

beforeAll(async () => {
  await withAdminTx(async (tx) => {
    await tx.query(
      `truncate contract_check, loan_drawdown, financing, payment_milestone, change_order,
                defect, assistant_message, assistant_thread, media, diary_entry, guest_token,
                schedule_change, audit_log, checklist_item, guide_card_read, decision,
                dependency, task, project_member, project, expert_org_member, expert_org
                restart identity cascade`,
    );
    await tx.query('delete from auth.users');

    const datum = await tx.query<{ heute: string; spaeter: string }>(
      `select current_date::text as heute,
              (current_date + interval '3 months')::date::text as spaeter`,
    );
    heute = datum.rows[0]!.heute;
    inDreiMonaten = datum.rows[0]!.spaeter;
  });

  const [bauherr, gu] = await withAdminTx(async (tx) => {
    const result = await tx.query<{ id: string }>(
      `insert into auth.users (email)
       values ('akte@example.test'), ('akte-gu@example.test') returning id`,
    );
    return [result.rows[0]!.id, result.rows[1]!.id];
  });
  bauherrToken = await tokenFor(bauherr!);
  guToken = await tokenFor(gu!);

  const created = await request('/api/v1/projects/onboarding', {
    method: 'POST',
    token: bauherrToken,
    body: JSON.stringify({
      name: 'Ahornweg 12',
      buildType: 'efh_massiv',
      hasBasement: true,
      plannedStart: heute,
      federalState: 'BY',
      contractType: 'verbraucherbauvertrag',
    }),
  });
  expect(created.status).toBe(201);
  projectId = ((await created.json()) as { projectId: string }).projectId;

  await withAdminTx(async (tx) => {
    await tx.query(
      `insert into project_member (project_id, user_id, role, display_name, company, accepted_at)
       values ($1, $2, 'contractor', 'Jörg Baumeister', 'Bau GmbH', now())`,
      [projectId, gu],
    );
  });

  // -- Die drei Bestätigungsgrade, jeder auf seinem eigenen Weg ---------------
  //
  // Nichts davon wird gesetzt: Alle drei entstehen so, wie sie im Betrieb
  // entstehen. Ein Grad, den der Test selbst in die Tabelle schreibt, beweist
  // nur, dass SQL funktioniert.

  const angelegt = await request(`/api/v1/projects/${projectId}/guest-links`, {
    method: 'POST',
    token: bauherrToken,
    body: JSON.stringify({
      role: 'contractor',
      displayName: 'Jörg Baumeister',
      company: 'Bau GmbH',
      scopes: ['confirm:task'],
    }),
  });
  expect(angelegt.status).toBe(201);
  const gastToken = guestLinkCreated.parse(await angelegt.json()).url.split('#')[1]!;

  const geoeffnet = await gast('/open', { token: gastToken, name: 'Jörg Baumeister' });
  const sicht = guestView.parse(await geoeffnet.json());

  // Abgestimmt: Der Polier bestätigt.
  const erdarbeiten = sicht.tasks[0]!;
  expect((await gast(`/tasks/${erdarbeiten.id}/confirm`, { token: gastToken })).status).toBe(200);

  // Zwei Angaben: Er nennt einen anderen Termin.
  const strittig = vorgang(sicht, 'Rohbau');
  expect(
    (
      await gast(`/tasks/${strittig.id}/counter`, {
        token: gastToken,
        start: '2027-03-01',
        end: '2027-03-12',
        note: 'In der Woche davor sind wir auf einer anderen Baustelle.',
        reason: 'kapazitaet',
      })
    ).status,
  ).toBe(200);

  // Einseitig bleibt alles Übrige — das ist der Ausgangszustand nach dem
  // Anlegen und braucht keinen eigenen Handgriff.

  // -- Tagebuch, Foto, Mangel, Freigabe --------------------------------------

  const eintrag = await request(`/api/v1/projects/${projectId}/diary`, {
    method: 'POST',
    token: bauherrToken,
    body: JSON.stringify({
      entryDate: heute,
      body: 'Baugrube abgesteckt, Sohle nach Plan. Bodengutachter war da.',
    }),
  });
  expect(eintrag.status).toBe(201);
  // Zwei Tage zurückgestellt, damit er versiegelungsreif ist: Die Akte soll
  // beides zeigen können — den festen Eintrag mit Prüfsumme und den frischen,
  // der noch änderbar ist.
  await withAdminTx(async (tx) => {
    await tx.query(`update diary_entry set created_at = now() - interval '48 hours' where id = $1`, [
      ((await eintrag.json()) as { id: string }).id,
    ]);
  });

  const frisch = await request(`/api/v1/projects/${projectId}/diary`, {
    method: 'POST',
    token: bauherrToken,
    body: JSON.stringify({
      entryDate: heute,
      body: 'Schalung für die Bodenplatte steht.',
    }),
  });
  expect(frisch.status).toBe(201);

  const foto = await request(`/api/v1/projects/${projectId}/media`, {
    method: 'POST',
    token: bauherrToken,
    body: JSON.stringify({
      storagePath: `${projectId}/baugrube-nord.jpg`,
      mime: 'image/jpeg',
      bytes: 2_400_000,
      sha256: 'b'.repeat(64),
      statedDate: heute,
      caption: 'Baugrube von Norden',
    }),
  });
  expect(foto.status).toBe(201);

  // Eine freigegebene Rate — damit auch Geld in der Chronik vorkommt.
  const vertrag = await request(`/api/v1/projects/${projectId}/contract`, {
    method: 'PATCH',
    token: bauherrToken,
    body: JSON.stringify({ contractSumCents: 40_000_000, securityPct: 5 }),
  });
  expect(vertrag.status).toBe(200);

  await withAdminTx(async (tx) => {
    await tx.query(
      `update task set status = 'fertig'
        where id in (select unnest(requires_task_ids) from payment_milestone
                      where project_id = $1 and name = '1. Rate')`,
      [projectId],
    );
  });
  const raten = (await (
    await request(`/api/v1/projects/${projectId}/contract`, { token: bauherrToken })
  ).json()) as { payments: { id: string; name: string }[] };
  const erste = raten.payments.find((rate) => rate.name === '1. Rate')!;
  const freigabe = await request(`/api/v1/projects/${projectId}/payments/${erste.id}`, {
    method: 'PATCH',
    token: bauherrToken,
    body: JSON.stringify({ status: 'freigegeben' }),
  });
  expect(freigabe.status).toBe(200);

  // Der Mangel kommt zuletzt, und das ist keine Willkür: Ein offener
  // wesentlicher Mangel ohne Vorgang sperrt jede Rate (AP 8). Vorher gemeldet,
  // gäbe es die Freigabe oben nicht — die Sperre wirkt auch hier.
  const mangel = await request(`/api/v1/projects/${projectId}/defects`, {
    method: 'POST',
    token: bauherrToken,
    body: JSON.stringify({
      title: 'Kellerwand feucht an der Nordseite',
      severity: 'wesentlich',
      locationText: 'Keller, Nordwand',
      deadline: inDreiMonaten,
    }),
  });
  expect(mangel.status).toBe(201);
});

afterAll(async () => {
  await closePool();
});

// ---------------------------------------------------------------------------

describe('Die Unterscheidbarkeit', () => {
  it('führt abgestimmte, einseitige und widersprüchliche Angaben getrennt', async () => {
    // Der Satz aus der Abnahme, so wörtlich er sich prüfen lässt.
    const inhalt = await akte();

    expect(inhalt.confirmationCounts.mutual).toBe(1);
    expect(inhalt.confirmationCounts.disputed).toBe(1);
    expect(inhalt.confirmationCounts.self_stated).toBeGreaterThan(0);

    const vorgaenge = eintraege(inhalt, 'vorgang');
    expect(vorgaenge.some((eintrag) => eintrag.confirmation === 'mutual')).toBe(true);
    expect(vorgaenge.some((eintrag) => eintrag.confirmation === 'disputed')).toBe(true);
    expect(vorgaenge.some((eintrag) => eintrag.confirmation === 'self_stated')).toBe(true);
  });

  it('gibt jedem Grad ein eigenes Zeichen — die Unterscheidung trägt ohne Farbe', () => {
    // Ein ausgedrucktes PDF ist oft schwarzweiß. Eine Unterscheidung, die den
    // Bürodrucker nicht übersteht, ist im Streitfall keine.
    const zeichen = Object.values(CONFIRMATION_MARK);
    expect(new Set(zeichen).size).toBe(zeichen.length);
    expect(zeichen.every((mark) => mark.trim().length > 0)).toBe(true);
  });

  it('nennt beim strittigen Vorgang beide Termine, nicht nur den eigenen', async () => {
    const strittig = eintraege(await akte(), 'vorgang').find(
      (eintrag) => eintrag.confirmation === 'disputed',
    );
    expect(strittig).toBeDefined();
    // Ohne die Gegenangabe wäre „zwei Angaben" eine Behauptung ohne Inhalt.
    // Und auf Deutsch: Die Akte wird gelesen, nicht abgefragt.
    expect(strittig!.detail).toContain('01.03.2027');
    expect(strittig!.detail).toContain('Jörg Baumeister');
  });

  it('hält beim abgestimmten Vorgang fest, wann und mit wem', async () => {
    const abgestimmt = eintraege(await akte(), 'vorgang').find(
      (eintrag) => eintrag.confirmation === 'mutual',
    );
    expect(abgestimmt!.detail).toContain('abgestimmt am');
  });
});

describe('Das Deckblatt', () => {
  it('trägt Projekt-, Vertrags- und Beteiligtendaten', async () => {
    const inhalt = await akte();

    expect(inhalt.project.name).toBe('Ahornweg 12');
    expect(inhalt.project.contractType).toBe('verbraucherbauvertrag');
    expect(inhalt.project.contractSumCents).toBe(40_000_000);
    expect(inhalt.project.computedEnd).not.toBeNull();

    const rollen = inhalt.members.map((mitglied) => mitglied.role);
    expect(rollen).toContain('owner');
    expect(rollen).toContain('contractor');
    expect(inhalt.members.find((m) => m.role === 'contractor')!.company).toBe('Bau GmbH');
  });

  it('trägt die Prüfsumme der Tagebuchkette', async () => {
    const inhalt = await akte();
    expect(inhalt.chain.intact).toBe(true);
    expect(inhalt.chain.sealedCount).toBe(1);
    expect(inhalt.chain.headHash).toMatch(/^[0-9a-f]{64}$/);
    // Der zweite Eintrag ist keine 24 Stunden alt: offen, noch änderbar. Auch
    // das gehört aufs Deckblatt — sonst behauptet die Akte eine Festigkeit,
    // die dieser Eintrag noch nicht hat.
    expect(inhalt.chain.openCount).toBe(1);
  });
});

describe('Die Chronologie', () => {
  it('steht in der Reihenfolge, in der es passiert ist', async () => {
    const zeiten = (await akte()).entries.map((eintrag) => eintrag.at);
    expect([...zeiten].sort((links, rechts) => links.localeCompare(rechts))).toEqual(zeiten);
  });

  it('führt Tagebuch, Mangel, Abstimmung und Zahlung nebeneinander', async () => {
    const inhalt = await akte();

    expect(eintraege(inhalt, 'tagebuch')[0]!.detail).toContain('Bodengutachter');
    expect(eintraege(inhalt, 'mangel')[0]!.title).toContain('Kellerwand feucht');
    expect(eintraege(inhalt, 'mangel')[0]!.detail).toContain('wesentlich');
    expect(eintraege(inhalt, 'zahlung')[0]!.title).toContain('1. Rate');
    expect(eintraege(inhalt, 'abstimmung').length).toBeGreaterThan(0);
  });

  it('nennt bei jeder Änderung den Kanal, über den sie hereinkam', async () => {
    // Der Unterschied zwischen „der GU hat zugestimmt" und „jemand hat es für
    // ihn eingetragen" ist im Streitfall der ganze Punkt.
    const abstimmung = eintraege(await akte(), 'abstimmung');
    expect(abstimmung.some((eintrag) => eintrag.channel === 'über den Abstimmungslink')).toBe(true);
  });

  it('lässt das Anlegen des Plans weg', async () => {
    // Über dreißig Zeilen „— → Termin" aus einem einzigen Klick. Sie sagen
    // dasselbe wie die Vorgänge und würden die Chronik unlesbar machen.
    const inhalt = await akte();
    expect(inhalt.entries.every((eintrag) => eintrag.detail?.includes('Plan angelegt') !== true))
      .toBe(true);
  });

  it('trägt zum versiegelten Tagebucheintrag seine Prüfsumme', async () => {
    // Und zum offenen keine — eine Prüfsumme an einem noch änderbaren Eintrag
    // wäre eine Zusage, die 24 Stunden lang nicht gilt.
    const geschrieben = eintraege(await akte(), 'tagebuch');
    expect(geschrieben).toHaveLength(2);
    expect(geschrieben[0]!.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(geschrieben[1]!.hash).toBeNull();
  });

  it('hält sich an den Zeitraum', async () => {
    // Ein Tag, an dem nichts war, weit vor dem Baubeginn.
    const leer = await akte('2020-01-01', '2020-03-31');
    expect(leer.entries).toHaveLength(0);
    expect(leer.media).toHaveLength(0);
    // Das Deckblatt steht trotzdem — eine Akte ohne Kopf ist keine.
    expect(leer.project.name).toBe('Ahornweg 12');
  });

  it('weist einen Zeitraum ohne Anfang und Ende ab', async () => {
    const ohne = await request(`/api/v1/projects/${projectId}/dossier`, { token: bauherrToken });
    expect(ohne.status).toBe(400);

    const verdreht = await request(
      `/api/v1/projects/${projectId}/dossier?from=${inDreiMonaten}&to=${heute}`,
      { token: bauherrToken },
    );
    expect(verdreht.status).toBe(422);
  });
});

describe('Der Fotoanhang', () => {
  it('führt jedes Foto mit Zeitpunkt und Prüfsumme', async () => {
    const inhalt = await akte();
    expect(inhalt.media).toHaveLength(1);
    expect(inhalt.media[0]!.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(inhalt.media[0]!.statedDate).toBe(heute);
    // Die Bytes kommen hier nie vor — nur der Ort. Geholt werden sie vom
    // Browser mit seiner eigenen Sitzung.
    expect(inhalt.media[0]!.storagePath).toContain(projectId);
  });
});

describe('Der Export', () => {
  it('gibt dem Bauherrn alles, was zu seinem Bauvorhaben gespeichert ist', async () => {
    const response = await request(`/api/v1/projects/${projectId}/export`, {
      token: bauherrToken,
    });
    expect(response.status).toBe(200);
    const daten = (await response.json()) as Record<string, unknown[]>;

    for (const tabelle of ['project', 'task', 'diary_entry', 'media', 'defect', 'guest_token']) {
      expect(Array.isArray(daten[tabelle])).toBe(true);
      expect((daten[tabelle] as unknown[]).length).toBeGreaterThan(0);
    }
    expect((daten['task'] as unknown[]).length).toBeGreaterThan(20);
  });

  it('enthält vom Gast-Link nur den Hash', async () => {
    const daten = (await (
      await request(`/api/v1/projects/${projectId}/export`, { token: bauherrToken })
    ).json()) as { guest_token: { token_hash: string }[] };
    // Der Klartext existiert nirgends mehr, auch nicht für uns.
    expect(daten.guest_token[0]!.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(daten)).not.toContain('/abstimmung#');
  });

  it('bleibt dem ausführenden Unternehmen verschlossen', async () => {
    const response = await request(`/api/v1/projects/${projectId}/export`, { token: guToken });
    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: string }).error).toContain('Bauherr');
  });

  it('lässt das ausführende Unternehmen die Akte trotzdem lesen', async () => {
    // Die Akte ist die Zusammenstellung, der Export sind die Rohdaten. Wer
    // mitbaut, darf nachlesen, was vereinbart wurde — RLS entscheidet, was
    // davon er sieht, nicht eine zweite Rechteprüfung im Anwendungscode.
    const inhalt = await akte(heute, inDreiMonaten, guToken);
    expect(inhalt.entries.length).toBeGreaterThan(0);
  });
});
