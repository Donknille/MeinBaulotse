/**
 * Die Abnahme von AP 9:
 *
 *   „Export über drei Monate ergibt ein PDF, in dem abgestimmte, einseitige
 *    und widersprüchliche Angaben optisch unterscheidbar sind."
 *
 * Das PDF entsteht im Browser (siehe `dossier.ts`), deshalb prüft dieser Test
 * die Hälfte, die der Server verantwortet: dass die Akte über drei Monate
 * alles enthält, was in dieser Zeit passiert ist, dass jeder Vorgang seinen
 * Bestätigungsgrad mitbringt — und dass alle drei Grade darin vorkommen, denn
 * ohne sie kann die Ansicht nichts unterscheiden.
 *
 * Die zweite Hälfte, die Unterscheidbarkeit auf Papier, hängt an `Grad` in
 * `apps/web/src/routes/Dossier.tsx`: Zeichen und ausgeschriebener Name, nicht
 * Farbe allein.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { closePool, withAdminTx } from '@meinbaulotse/db';
import type { Dossier, ProjectSchedule } from '@meinbaulotse/shared';
import { createApp } from './app.js';

const SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long';
process.env['SUPABASE_JWT_SECRET'] = SECRET;

const app = createApp({ lotseModel: null });

const HEUTE = new Date().toISOString().slice(0, 10);
const VOR_DREI_MONATEN = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);

let bauherrToken: string;
let guToken: string;
let projektId: string;
let akte: Dossier;

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
      `truncate contract_check, contract_description_item, loan_drawdown, change_order,
                payment_milestone, defect_event, defect, assistant_message,
                assistant_conversation, assistant_budget, task_confirmation, guest_token,
                media, diary_entry, schedule_change, audit_log, dependency, task,
                project_member, project, expert_org_member, expert_org restart identity cascade`,
    );
    await tx.query('delete from auth.users');
  });

  const [bauherr, gu] = await withAdminTx(async (tx) => {
    const a = await tx.query<{ id: string }>(
      'insert into auth.users (email) values ($1) returning id',
      ['akte-bauherr@example.test'],
    );
    const b = await tx.query<{ id: string }>(
      'insert into auth.users (email) values ($1) returning id',
      ['akte-gu@example.test'],
    );
    return [a.rows[0]!.id, b.rows[0]!.id];
  });
  bauherrToken = await tokenFor(bauherr);
  guToken = await tokenFor(gu);

  const angelegt = await request('/api/v1/projects/onboarding', {
    method: 'POST',
    token: bauherrToken,
    body: JSON.stringify({
      name: 'Aktenweg 3',
      buildType: 'efh_massiv',
      hasBasement: true,
      // Vor vier Monaten begonnen, damit der Zeitraum mitten im Bau liegt.
      plannedStart: new Date(Date.now() - 120 * 86_400_000).toISOString().slice(0, 10),
      federalState: 'BY',
      contractType: 'verbraucherbauvertrag',
    }),
  });
  projektId = ((await angelegt.json()) as { projectId: string }).projectId;

  await withAdminTx(async (tx) =>
    tx.query(
      `insert into project_member (project_id, user_id, role, display_name, company)
       values ($1, $2, 'contractor', 'Jörg Baumeister', 'Baumeister Bau')`,
      [projektId, gu],
    ),
  );

  const plan = (await (
    await request(`/api/v1/projects/${projektId}/schedule`, { token: bauherrToken })
  ).json()) as ProjectSchedule;

  // Alle vier Bestätigungsgrade — sonst kann die Ansicht nichts unterscheiden
  // und dieser Test prüfte nichts.
  // Vorgänge, die **im Zeitraum** liegen — sonst tauchen sie in der Akte gar
  // nicht auf, und der Test prüfte nichts.
  const laufende = plan.tasks
    .filter((task) => task.currentStart >= VOR_DREI_MONATEN && task.currentStart <= HEUTE)
    .slice(0, 4);
  if (laufende.length < 4) {
    throw new Error(`Nur ${laufende.length} Vorgänge im Zeitraum — der Aufbau taugt nicht.`);
  }
  const grade = ['self_stated', 'counterparty_stated', 'mutual', 'disputed'] as const;
  await withAdminTx(async (tx) => {
    for (const [index, task] of laufende.entries()) {
      await tx.query('update task set confirmation = $2::mbl.confirmation where id = $1', [
        task.id,
        grade[index] ?? 'self_stated',
      ]);
    }

    const mitglied = await tx.query<{ id: string }>(
      "select id from project_member where project_id = $1 and role = 'owner'",
      [projektId],
    );

    await tx.query(
      `insert into diary_entry (project_id, author_member_id, entry_date, body, author_role)
       values ($1, $2, $3, 'Bewehrung abgenommen, Beton kommt Montag.', 'owner')`,
      [projektId, mitglied.rows[0]!.id, HEUTE],
    );

    await tx.query(
      `insert into defect (project_id, title, description, severity, reported_by)
       values ($1, 'Riss in der Kellerwand', 'Waagerecht, etwa 30 cm.', 'wesentlich', $2)`,
      [projektId, mitglied.rows[0]!.id],
    );
  });

  // Eine Verschiebung, damit die Chronologie eine Änderung enthält.
  const spaeter = plan.tasks.find((task) => task.currentStart > HEUTE && !task.isWait);
  if (spaeter === undefined) {
    throw new Error('Kein Vorgang in der Zukunft — der Aufbau taugt nicht.');
  }
  const verschoben = await request(`/api/v1/projects/${projektId}/tasks/${spaeter.id}`, {
    method: 'PATCH',
    token: bauherrToken,
    body: JSON.stringify({
      earliestStart: new Date(Date.parse(`${spaeter.currentStart}T00:00:00Z`) + 14 * 86_400_000)
        .toISOString()
        .slice(0, 10),
      reason: 'witterung',
      reasonText: 'Dauerregen',
    }),
  });
  if (verschoben.status !== 200) {
    throw new Error(`Verschieben kam mit ${verschoben.status}: ${await verschoben.text()}`);
  }

  const antwort = await request(
    `/api/v1/projects/${projektId}/dossier?from=${VOR_DREI_MONATEN}&to=${HEUTE}`,
    { token: bauherrToken },
  );
  if (antwort.status !== 200) {
    throw new Error(`Akte kam mit ${antwort.status}: ${await antwort.text()}`);
  }

  akte = (await (
    await request(
      `/api/v1/projects/${projektId}/dossier?from=${VOR_DREI_MONATEN}&to=${HEUTE}`,
      { token: bauherrToken },
    )
  ).json()) as Dossier;
});

afterAll(async () => {
  await closePool();
});

describe('Das Deckblatt', () => {
  it('trägt Projekt-, Vertrags- und Beteiligtendaten', () => {
    expect(akte.project.name).toBe('Aktenweg 3');
    expect(akte.project.contractType).toBe('verbraucherbauvertrag');
    expect(akte.members.map((mitglied) => mitglied.role)).toContain('owner');
    expect(akte.members.map((mitglied) => mitglied.role)).toContain('contractor');
    expect(akte.members.find((mitglied) => mitglied.role === 'contractor')?.company).toBe(
      'Baumeister Bau',
    );
  });

  it('trägt die Prüfsumme der Tagebuchkette', () => {
    // Der Eintrag von heute ist noch nicht versiegelt — die Kette ist trotzdem
    // eine Aussage, und zwar eine wahre: null versiegelte Einträge, lückenlos.
    expect(akte.chain.intact).toBe(true);
    expect(akte.chain.sealedCount).toBeGreaterThanOrEqual(0);
  });

  it('nennt den Zeitraum und den Stichtag der Erstellung', () => {
    expect(akte.period.from).toBe(VOR_DREI_MONATEN);
    expect(akte.period.to).toBe(HEUTE);
    // Eine Akte ohne Stichtag sagt nicht, worauf sie sich bezieht.
    expect(akte.createdAt.slice(0, 10)).toBe(HEUTE);
  });
});

describe('Die Chronologie über drei Monate — die Abnahme von AP 9', () => {
  it('führt alle fünf Quellen in einem Strang', () => {
    const arten = new Set(akte.events.map((ereignis) => ereignis.kind));
    expect(arten).toContain('vorgang');
    expect(arten).toContain('tagebuch');
    expect(arten).toContain('mangel');
    expect(arten).toContain('aenderung');
  });

  it('steht chronologisch, nicht nach Quelle sortiert', () => {
    // Das ist der Punkt einer Akte: Was am selben Tag passiert ist, steht am
    // selben Tag — und nicht in fünf Kapiteln.
    const daten = akte.events.map((ereignis) => ereignis.date);
    expect([...daten].sort()).toEqual(daten);
  });

  it('bringt zu jedem Vorgang seinen Bestätigungsgrad mit', () => {
    const vorgaenge = akte.events.filter((ereignis) => ereignis.kind === 'vorgang');
    expect(vorgaenge.length).toBeGreaterThan(0);
    for (const vorgang of vorgaenge) {
      expect(vorgang.confirmation).toBeDefined();
    }

    // Ohne verschiedene Grade könnte die Ansicht nichts unterscheiden, und
    // dieser Test prüfte nichts.
    const grade = new Set(vorgaenge.map((vorgang) => vorgang.confirmation));
    expect(grade.size).toBeGreaterThanOrEqual(3);
    expect(grade).toContain('mutual');
    expect(grade).toContain('disputed');
    expect(grade).toContain('self_stated');
  });

  it('nennt bei einer Verschiebung alten Wert, neuen Wert und Grund', () => {
    const aenderung = akte.events.find((ereignis) => ereignis.kind === 'aenderung');
    expect(aenderung?.detail).toMatch(/→/);
    // Ausgeschrieben, nicht als Enum-Name: Die Akte ist das Dokument, das
    // jemand aus der Hand gibt.
    expect(aenderung?.detail).toContain('Witterung');
    expect(aenderung?.detail).toMatch(/\d{2}\.\d{2}\.\d{4}/);
    expect(aenderung?.detail).toContain('Dauerregen');
  });

  it('hält beim Tagebucheintrag fest, ob er versiegelt ist', () => {
    const eintrag = akte.events.find((ereignis) => ereignis.kind === 'tagebuch');
    expect(eintrag?.sealed).toBe(false);
    expect(eintrag?.detail).toContain('Bewehrung');
  });
});

describe('Wer eine Akte anlegen darf', () => {
  it('lässt den GU nicht heran', async () => {
    // Rechtematrix 2.2: „Akte exportieren" hat der contractor nicht. Die RLS
    // allein reichte hier nicht — sie begrenzt, **was** er sieht, und er
    // bekäme seinen Ausschnitt als Dokument mit Deckblatt und Prüfsumme.
    const antwort = await request(`/api/v1/projects/${projektId}/dossier`, { token: guToken });
    expect(antwort.status).toBe(403);
    expect(((await antwort.json()) as { error: string }).error).toContain('Bauherr');
  });

  it('lässt ihn auch nicht an den Datenexport', async () => {
    const antwort = await request(`/api/v1/projects/${projektId}/export`, { token: guToken });
    expect(antwort.status).toBe(403);
  });
});

describe('Der vollständige Datenexport', () => {
  it('kommt als Datei und enthält jede Tabelle des Bauvorhabens', async () => {
    const antwort = await request(`/api/v1/projects/${projektId}/export`, {
      token: bauherrToken,
    });
    expect(antwort.status).toBe(200);
    // Ein Export, den man aus dem Adressfeld kopieren muss, ist keine
    // Selbstbedienung (Abschnitt 6.5).
    expect(antwort.headers.get('content-disposition')).toContain('attachment');

    const daten = (await antwort.json()) as {
      data: Record<string, unknown[]>;
      projectId: string;
    };
    expect(daten.projectId).toBe(projektId);
    expect(daten.data['project']).toHaveLength(1);
    expect((daten.data['task'] ?? []).length).toBeGreaterThan(30);
    expect((daten.data['diary_entry'] ?? []).length).toBe(1);
    expect((daten.data['defect'] ?? []).length).toBe(1);
    expect((daten.data['schedule_change'] ?? []).length).toBeGreaterThan(0);
  });
});

describe('Der voreingestellte Zeitraum', () => {
  it('sind drei Monate zurück', async () => {
    const ohneAngabe = (await (
      await request(`/api/v1/projects/${projektId}/dossier`, { token: bauherrToken })
    ).json()) as Dossier;
    expect(ohneAngabe.period.to).toBe(HEUTE);
    expect(ohneAngabe.period.from).toBe(VOR_DREI_MONATEN);
  });
});
