/**
 * Integrationstest der Abnahme von AP 5:
 *
 * „Im Flugmodus drei Fotos mit Notiz erfassen, Gerät online bringen, alle drei
 *  landen mit korrektem Aufnahmezeitpunkt. Ein manipulierter Eintrag bricht die
 *  Kettenprüfung."
 *
 * Der Flugmodus selbst steckt im Browser und wird dort geprüft
 * (`apps/web/src/lib/queue.test.ts`). Hier geht es um die Seite, auf der die
 * Warteschlange ankommt: Drei Anmeldungen mit den Aufnahmezeitpunkten von
 * vorgestern müssen vorgestern bleiben — auch wenn sie heute eintreffen.
 *
 * Und um den zweiten Satz, der die eigentliche Zusage des Produkts ist. Die
 * Manipulation läuft dabei bewusst **am Trigger vorbei**: Über die Anwendung
 * geht sie ohnehin nicht, das prüft der erste Fall. Die interessante Frage ist,
 * was passiert, wenn jemand mit Eigentümerrechten im SQL-Editor sitzt — genau
 * dort, wo keine Anwendung mehr schützt.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { closePool, withAdminTx } from '@meinbaulotse/db';
import {
  diaryChainCheck,
  diaryEntryDto,
  mediaDto,
  weatherInPlainWords,
  type DiaryChainCheck,
  type DiaryEntryDto,
  type MediaDto,
} from '@meinbaulotse/shared';
import { createApp } from './app.js';

const SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long';
process.env['SUPABASE_JWT_SECRET'] = SECRET;
// Kein Wetterdienst in der Gegenprobe. Ein Test, der ins Netz greift, ist kein
// Test, sondern eine Wette auf die Verfügbarkeit eines fremden Rechners.
process.env['WEATHER_API_URL'] = '';

const app = createApp();

let bauherrToken: string;
let guToken: string;
let projectId: string;
let gedeckterVorgang: string;

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

async function eintragen(body: unknown, token = bauherrToken): Promise<DiaryEntryDto> {
  const response = await request(`/api/v1/projects/${projectId}/diary`, {
    method: 'POST',
    token,
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(201);
  return diaryEntryDto.parse(await response.json());
}

async function tagebuch(token = bauherrToken): Promise<DiaryEntryDto[]> {
  const response = await request(`/api/v1/projects/${projectId}/diary`, { token });
  expect(response.status).toBe(200);
  return ((await response.json()) as { entries: unknown[] }).entries.map((entry) =>
    diaryEntryDto.parse(entry),
  );
}

async function pruefung(): Promise<DiaryChainCheck> {
  const response = await request(`/api/v1/projects/${projectId}/diary/verify`, {
    token: bauherrToken,
  });
  expect(response.status).toBe(200);
  return diaryChainCheck.parse(await response.json());
}

/**
 * Ein Foto anmelden, wie es die Warteschlange tut: Bytes sind längst im
 * Objektspeicher, hier kommt nur die Zeile an.
 */
async function fotoAnmelden(
  hash: string,
  extras: Record<string, unknown> = {},
  token = bauherrToken,
): Promise<Response> {
  return request(`/api/v1/projects/${projectId}/media`, {
    method: 'POST',
    token,
    body: JSON.stringify({
      storagePath: `${projectId}/${hash.slice(0, 8)}-${hash.slice(8, 16)}.jpg`,
      mime: 'image/jpeg',
      bytes: 2_400_000,
      sha256: hash,
      ...extras,
    }),
  });
}

/** 64 Hexziffern, aus einer Nummer gebaut — echte Prüfsummen braucht es nicht. */
function hash(nummer: number): string {
  return nummer.toString(16).padStart(64, 'a');
}

/** Verschiebt einen Eintrag in die Vergangenheit, damit er versiegelungsreif ist. */
async function alternLassen(entryId: string, stunden: number): Promise<void> {
  await withAdminTx(async (tx) => {
    await tx.query(
      `update diary_entry set created_at = now() - ($2 || ' hours')::interval where id = $1`,
      [entryId, String(stunden)],
    );
  });
}

beforeAll(async () => {
  await withAdminTx(async (tx) => {
    await tx.query(
      `truncate media, diary_entry, schedule_change, audit_log, checklist_item,
                guide_card_read, decision, dependency, task, project_member, project,
                expert_org_member, expert_org restart identity cascade`,
    );
    await tx.query('delete from auth.users');
  });

  const [bauherr, gu] = await withAdminTx(async (tx) => {
    const result = await tx.query<{ id: string }>(
      `insert into auth.users (email)
       values ('tagebuch@example.test'), ('tagebuch-gu@example.test')
       returning id`,
    );
    return [result.rows[0]!.id, result.rows[1]!.id];
  });
  bauherrToken = await tokenFor(bauherr!);
  guToken = await tokenFor(gu!);

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

  // Der Generalunternehmer darf Tagebuch schreiben (Rechtematrix 2.2), aber
  // keine fremden Einträge ändern. Beides wird unten geprüft.
  await withAdminTx(async (tx) => {
    await tx.query(
      `insert into project_member (project_id, user_id, role, display_name, accepted_at)
       values ($1, $2, 'contractor', 'Bau GmbH', now())`,
      [projectId, gu],
    );
    const task = await tx.query<{ id: string }>(
      `select id from task where project_id = $1 and guide_card_id is not null
        order by sort_order limit 1`,
      [projectId],
    );
    gedeckterVorgang = task.rows[0]!.id;
  });
});

afterAll(async () => {
  await closePool();
});

// ---------------------------------------------------------------------------

describe('Ein Eintrag entsteht', () => {
  it('gehört dem, der ihn schreibt, und nennt dessen Rolle', async () => {
    const eintrag = await eintragen({
      entryDate: '2026-04-02',
      body: 'Bodenplatte betoniert, Wetter trocken.',
    });

    expect(eintrag.authorRole).toBe('owner');
    expect(eintrag.body).toBe('Bodenplatte betoniert, Wetter trocken.');
    expect(eintrag.sealedAt).toBeNull();
    expect(eintrag.canEdit).toBe(true);
  });

  it('ist 24 Stunden lang bearbeitbar und sagt, wie lange noch', async () => {
    const eintrag = await eintragen({ entryDate: '2026-04-03', body: 'Schalung entfernt.' });
    expect(eintrag.editableForMinutes).toBeGreaterThan(23 * 60);
    expect(eintrag.editableForMinutes).toBeLessThanOrEqual(24 * 60);
  });

  it('bleibt ohne Wetterdienst ehrlich statt zu erfinden', async () => {
    const eintrag = await eintragen({ entryDate: '2026-04-04', body: 'Regen den ganzen Tag.' });
    expect(eintrag.weather).toBeNull();
    expect(weatherInPlainWords(eintrag.weather)).toBe('Wetter nicht erfasst.');
  });

  it('lässt sich vom Verfasser ändern, solange er offen ist', async () => {
    const eintrag = await eintragen({ entryDate: '2026-04-06', body: 'Erster Wurf.' });
    const response = await request(`/api/v1/projects/${projectId}/diary/${eintrag.id}`, {
      method: 'PATCH',
      token: bauherrToken,
      body: JSON.stringify({ body: 'Zweiter Wurf, genauer.' }),
    });
    expect(response.status).toBe(200);
    expect(diaryEntryDto.parse(await response.json()).body).toBe('Zweiter Wurf, genauer.');
  });

  it('lässt sich von einem anderen Beteiligten nicht ändern', async () => {
    const eintrag = await eintragen({ entryDate: '2026-04-07', body: 'Eintrag des Bauherrn.' });
    const response = await request(`/api/v1/projects/${projectId}/diary/${eintrag.id}`, {
      method: 'PATCH',
      token: guToken,
      body: JSON.stringify({ body: 'Nicht so, sondern so.' }),
    });
    // 404 und nicht 403: Ein 403 verriete, dass es den Eintrag gibt. Die
    // Rechtematrix kennt „Fremden Eintrag ändern" für keine einzige Rolle.
    expect(response.status).toBe(404);
  });
});

describe('Die Erfassung aus dem Funkloch', () => {
  it('behält den Aufnahmezeitpunkt der drei Fotos, obwohl sie heute ankommen', async () => {
    // Der Fall aus der Abnahme: drei Fotos, vorgestern aufgenommen, heute
    // abgeliefert. Der Tag, um den es geht, ist vorgestern.
    const eintrag = await eintragen({
      entryDate: '2026-05-04',
      body: 'Leitungsverlauf vor dem Estrich, drei Aufnahmen.',
      taskIds: [gedeckterVorgang],
    });

    const zeitpunkte = [
      '2026-05-04T09:12:00.000Z',
      '2026-05-04T09:13:30.000Z',
      '2026-05-04T09:15:10.000Z',
    ];

    const fotos: MediaDto[] = [];
    for (const [index, zeit] of zeitpunkte.entries()) {
      const response = await fotoAnmelden(hash(index + 1), {
        diaryEntryId: eintrag.id,
        taskId: gedeckterVorgang,
        capturedAt: zeit,
        statedDate: '2026-05-04',
        caption: `Aufnahme ${index + 1}`,
      });
      expect(response.status).toBe(201);
      fotos.push(mediaDto.parse(await response.json()));
    }

    expect(fotos).toHaveLength(3);
    for (const [index, foto] of fotos.entries()) {
      expect(new Date(foto.capturedAt!).toISOString()).toBe(zeitpunkte[index]);
      expect(foto.statedDate).toBe('2026-05-04');
    }

    const gelesen = (await tagebuch()).find((entry) => entry.id === eintrag.id);
    expect(gelesen?.media).toHaveLength(3);
  });

  it('nimmt dasselbe Foto zweimal an, ohne es zweimal abzulegen', async () => {
    // Eine Warteschlange, die nach einem Verbindungsabbruch noch einmal
    // abliefert, darf nicht in einer Fehlermeldung enden — und zwei Zeilen für
    // ein Bild wären in der Bauakte eine Doppelung, die niemand erklären kann.
    const erste = await fotoAnmelden(hash(99), { caption: 'Erster Anlauf' });
    expect(erste.status).toBe(201);
    const zweite = await fotoAnmelden(hash(99), { caption: 'Erster Anlauf' });
    expect(zweite.status).toBe(201);
    expect(mediaDto.parse(await zweite.json()).id).toBe(mediaDto.parse(await erste.json()).id);
  });

  it('weist einen Ablageweg ab, der in ein fremdes Bauvorhaben zeigt', async () => {
    const response = await request(`/api/v1/projects/${projectId}/media`, {
      method: 'POST',
      token: bauherrToken,
      body: JSON.stringify({
        storagePath: '00000000-0000-0000-0000-000000000000/geklaut.jpg',
        mime: 'image/jpeg',
        bytes: 1000,
        sha256: hash(1234),
      }),
    });
    expect(response.status).toBe(400);
  });
});

describe('Fotoaufträge', () => {
  it('führen den erfüllten Auftrag mit seiner Anzahl', async () => {
    const response = await request(
      `/api/v1/projects/${projectId}/photo-prompts?on=2026-05-04`,
      { token: bauherrToken },
    );
    expect(response.status).toBe(200);
    const { prompts } = (await response.json()) as {
      prompts: { taskId: string; key: string; fulfilledBy: number; what: string }[];
    };
    expect(prompts.length).toBeGreaterThan(0);
    for (const prompt of prompts) {
      expect(prompt.what.length).toBeGreaterThan(3);
    }
  });
});

describe('Die Kette', () => {
  it('versiegelt, was älter als 24 Stunden ist, und lässt Jüngeres offen', async () => {
    const alt = await eintragen({ entryDate: '2026-06-01', body: 'Alt genug.' });
    const jung = await eintragen({ entryDate: '2026-06-02', body: 'Noch frisch.' });
    await alternLassen(alt.id, 30);

    const eintraege = await tagebuch();
    const versiegelt = eintraege.find((entry) => entry.id === alt.id);
    const offen = eintraege.find((entry) => entry.id === jung.id);

    expect(versiegelt?.sealedAt).not.toBeNull();
    expect(versiegelt?.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(versiegelt?.canEdit).toBe(false);
    expect(offen?.sealedAt).toBeNull();
  });

  it('weist eine Änderung am versiegelten Eintrag ab', async () => {
    const eintrag = await eintragen({ entryDate: '2026-06-03', body: 'Wird gleich versiegelt.' });
    await alternLassen(eintrag.id, 30);
    await tagebuch(); // Lesen versiegelt.

    const response = await request(`/api/v1/projects/${projectId}/diary/${eintrag.id}`, {
      method: 'PATCH',
      token: bauherrToken,
      body: JSON.stringify({ body: 'Doch anders.' }),
    });
    expect(response.status).toBe(403);
  });

  it('lässt das Zurückziehen zu und behält den Eintrag sichtbar', async () => {
    const eintrag = await eintragen({ entryDate: '2026-06-04', body: 'Verwechselt.' });
    await alternLassen(eintrag.id, 30);
    await tagebuch();

    const response = await request(`/api/v1/projects/${projectId}/diary/${eintrag.id}`, {
      method: 'PATCH',
      token: bauherrToken,
      body: JSON.stringify({ retract: 'War der falsche Vorgang.' }),
    });
    expect(response.status).toBe(200);
    const zurueckgezogen = diaryEntryDto.parse(await response.json());
    expect(zurueckgezogen.retractedAt).not.toBeNull();
    expect(zurueckgezogen.retractionReason).toBe('War der falsche Vorgang.');
    // Sichtbar bleibt er. „Kein Eintrag löschbar" (Abschnitt 3.8).
    expect((await tagebuch()).some((entry) => entry.id === eintrag.id)).toBe(true);
  });

  it('bleibt heil, wenn niemand daran dreht', async () => {
    const zustand = await pruefung();
    expect(zustand.intact).toBe(true);
    expect(zustand.breaks).toHaveLength(0);
    expect(zustand.sealedCount).toBeGreaterThan(1);
    expect(zustand.headHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('bricht bei einem manipulierten Eintrag — und nennt genau den einen', async () => {
    const eintrag = await eintragen({
      entryDate: '2026-07-01',
      body: 'Die Dämmung war an diesem Tag noch nicht eingebaut.',
    });
    await alternLassen(eintrag.id, 30);
    const nachher = await eintragen({ entryDate: '2026-07-02', body: 'Weiter im Text.' });
    await alternLassen(nachher.id, 29);
    await tagebuch();

    const vorher = await pruefung();
    expect(vorher.intact).toBe(true);

    // Am Trigger vorbei — wie jemand mit Eigentümerrechten im SQL-Editor.
    // Über die Anwendung ginge das nicht; genau deshalb ist die Kette da.
    await withAdminTx(async (tx) => {
      await tx.query('alter table diary_entry disable trigger diary_entry_guard_locked');
      await tx.query('update diary_entry set body = $2 where id = $1', [
        eintrag.id,
        'Die Dämmung war an diesem Tag bereits eingebaut.',
      ]);
      await tx.query('alter table diary_entry enable trigger diary_entry_guard_locked');
    });

    const danach = await pruefung();
    expect(danach.intact).toBe(false);
    expect(danach.breaks).toHaveLength(1);
    expect(danach.breaks[0]!.entryId).toBe(eintrag.id);
    expect(danach.breaks[0]!.reason).toContain('Prüfsumme');
  });

  it('bricht auch, wenn nur das Foto getauscht wird', async () => {
    // Der Fall, den eine Kette über den Text allein nicht sieht: Der Eintrag
    // bleibt Wort für Wort derselbe, das Bild darunter ist ein anderes.
    const eintrag = await eintragen({ entryDate: '2026-08-01', body: 'Zwei Aufnahmen.' });
    expect((await fotoAnmelden(hash(4711), { diaryEntryId: eintrag.id })).status).toBe(201);
    await alternLassen(eintrag.id, 30);
    await tagebuch();

    // Gefragt wird nach **diesem** Eintrag, nicht nach der ganzen Kette: Die
    // vorherige Probe hat einen Bruch hinterlassen, und der bleibt — das ist
    // schließlich der Sinn der Sache. Eine Kette, die sich reparieren ließe,
    // wäre keine.
    const brichtHier = (zustand: DiaryChainCheck): boolean =>
      zustand.breaks.some((bruch) => bruch.entryId === eintrag.id);

    expect(brichtHier(await pruefung())).toBe(false);

    await withAdminTx(async (tx) => {
      await tx.query('alter table media disable trigger media_guard_sealed');
      await tx.query('update media set sha256 = $2 where sha256 = $1', [hash(4711), hash(4712)]);
      await tx.query('alter table media enable trigger media_guard_sealed');
    });

    expect(brichtHier(await pruefung())).toBe(true);
  });
});
