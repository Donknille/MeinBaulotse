/**
 * Integrationstest der Abnahme von AP 5, zweiter Teil:
 *
 * „Ein manipulierter Eintrag bricht die Kettenprüfung."
 *
 * Der erste Teil — drei Fotos im Flugmodus — hängt an Kamera und
 * Offline-Schlange und wird in `apps/web` geprüft. Was hier zählt, ist die
 * Beweisqualität: Versiegelung, Kette, und dass niemand fremde Einträge
 * anfasst.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { SignJWT } from 'jose';
import { closePool, withAdminTx } from '@meinbaulotse/db';
import { diaryChainResult, type DiaryChainResult, type DiaryEntryDto } from '@meinbaulotse/shared';
import { createApp } from './app.js';

const SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long';
process.env['SUPABASE_JWT_SECRET'] = SECRET;

const app = createApp();

let bauherrToken: string;
let guToken: string;
let fremdToken: string;
let projektId: string;

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

async function schreibe(
  body: string,
  entryDate: string,
  token = bauherrToken,
): Promise<DiaryEntryDto> {
  const response = await request(`/api/v1/projects/${projektId}/diary`, {
    method: 'POST',
    token,
    body: JSON.stringify({ entryDate, body }),
  });
  expect(response.status, await response.clone().text()).toBe(201);
  return (await response.json()) as DiaryEntryDto;
}

async function liste(token = bauherrToken): Promise<DiaryEntryDto[]> {
  const response = await request(`/api/v1/projects/${projektId}/diary`, { token });
  return ((await response.json()) as { entries: DiaryEntryDto[] }).entries;
}

async function pruefe(token = bauherrToken): Promise<DiaryChainResult> {
  const response = await request(`/api/v1/projects/${projektId}/diary/verify`, { token });
  return (await response.json()) as DiaryChainResult;
}

/** Versiegelt sofort, statt 24 Stunden zu warten. */
async function versiegle(entryId: string): Promise<void> {
  await withAdminTx(async (tx) => tx.query('select mbl.seal_diary_entry($1)', [entryId]));
}

const sha = (text: string): string => createHash('sha256').update(text).digest('hex');

beforeAll(async () => {
  await withAdminTx(async (tx) => {
    await tx.query(
      `truncate media, diary_entry, schedule_change, audit_log, dependency, task,
                project_member, project, expert_org_member, expert_org restart identity cascade`,
    );
    await tx.query('delete from auth.users');
  });

  const bauherr = await createUser('tagebuch@example.test');
  const gu = await createUser('tagebuch-gu@example.test');
  bauherrToken = await tokenFor(bauherr);
  guToken = await tokenFor(gu);
  fremdToken = await tokenFor(await createUser('tagebuch-fremd@example.test'));

  const angelegt = await request('/api/v1/projects/onboarding', {
    method: 'POST',
    token: bauherrToken,
    body: JSON.stringify({
      name: 'Tagebuchweg 5',
      buildType: 'efh_massiv',
      hasBasement: true,
      plannedStart: '2026-04-01',
      federalState: 'BY',
      contractType: 'verbraucherbauvertrag',
    }),
  });
  projektId = ((await angelegt.json()) as { projectId: string }).projectId;

  // Der GU als zweiter Beteiligter: Er führt die Baustelle und schreibt
  // deshalb auch ins Tagebuch (Rechtematrix 2.2).
  await withAdminTx(async (tx) =>
    tx.query(
      `insert into project_member (project_id, user_id, role, display_name, accepted_at)
       values ($1, $2, 'contractor', 'Jörg Baumeister', now())`,
      [projektId, gu],
    ),
  );
});

afterAll(async () => {
  await closePool();
});

describe('Einen Eintrag schreiben', () => {
  it('hält Verfasser und Rolle fest, ohne dass die Anfrage sie nennt', async () => {
    const eintrag = await schreibe('Bodenplatte betoniert, 12 Kubikmeter.', '2026-05-04');
    expect(eintrag.authorRole).toBe('owner');
    expect(eintrag.body).toContain('Bodenplatte');
    expect(eintrag.lockedAt).toBeNull();
    expect(eintrag.editable).toBe(true);
  });

  it('lässt den GU schreiben — er führt die Baustelle', async () => {
    const eintrag = await schreibe('Kran steht, Bewehrung geliefert.', '2026-05-05', guToken);
    expect(eintrag.authorRole).toBe('contractor');
  });

  it('lässt einen Unbeteiligten nicht schreiben', async () => {
    const response = await request(`/api/v1/projects/${projektId}/diary`, {
      method: 'POST',
      token: fremdToken,
      body: JSON.stringify({ entryDate: '2026-05-06', body: 'Fremder Eintrag.' }),
    });
    expect(response.status).toBe(404);
  });

  it('nimmt keinen leeren Eintrag an', async () => {
    const response = await request(`/api/v1/projects/${projektId}/diary`, {
      method: 'POST',
      token: bauherrToken,
      body: JSON.stringify({ entryDate: '2026-05-06', body: '   ' }),
    });
    expect(response.status).toBe(422);
  });

  it('friert das Wetter mit dem Eintrag ein', async () => {
    const response = await request(`/api/v1/projects/${projektId}/diary`, {
      method: 'POST',
      token: bauherrToken,
      body: JSON.stringify({
        entryDate: '2026-05-07',
        body: 'Regen, Arbeiten unterbrochen.',
        weather: { temperatureC: 9.5, condition: 'Dauerregen' },
      }),
    });
    const eintrag = (await response.json()) as DiaryEntryDto;
    expect(eintrag.weatherSource).toBe('manuell');
    expect(eintrag.weather).toMatchObject({ temperatureC: 9.5, condition: 'Dauerregen' });
  });
});

describe('Vierundzwanzig Stunden, dann versiegelt', () => {
  it('lässt den eigenen Eintrag vor der Versiegelung ändern', async () => {
    const eintrag = await schreibe('Erster Wortlaut.', '2026-05-08');
    const response = await request(`/api/v1/projects/${projektId}/diary/${eintrag.id}`, {
      method: 'PATCH',
      token: bauherrToken,
      body: JSON.stringify({ body: 'Richtiggestellt: zweiter Wortlaut.' }),
    });
    expect(response.status).toBe(200);
    expect(((await response.json()) as DiaryEntryDto).body).toContain('zweiter Wortlaut');
  });

  it('lässt niemanden an einen fremden Eintrag — auch nicht den Bauherrn', async () => {
    const vomGu = await schreibe('Beton angeliefert.', '2026-05-09', guToken);
    const response = await request(`/api/v1/projects/${projektId}/diary/${vomGu.id}`, {
      method: 'PATCH',
      token: bauherrToken,
      body: JSON.stringify({ body: 'Vom Bauherrn geändert.' }),
    });
    // In der Rechtematrix steht „Fremden Eintrag ändern" bei keiner Rolle.
    expect(response.status).toBe(404);
  });

  it('verweigert die Änderung nach der Versiegelung', async () => {
    const eintrag = await schreibe('Estrich eingebracht.', '2026-05-10');
    await versiegle(eintrag.id);

    const response = await request(`/api/v1/projects/${projektId}/diary/${eintrag.id}`, {
      method: 'PATCH',
      token: bauherrToken,
      body: JSON.stringify({ body: 'Doch nicht.' }),
    });
    expect(response.status).toBe(500);
    expect(((await response.json()) as { detail?: string }).detail ?? '').toContain('versiegelt');
  });

  it('lässt einen versiegelten Eintrag zurückziehen, aber nicht löschen', async () => {
    const eintrag = await schreibe('Verwechselt: das war der Nachbarbau.', '2026-05-11');
    await versiegle(eintrag.id);

    const response = await request(`/api/v1/projects/${projektId}/diary/${eintrag.id}`, {
      method: 'PATCH',
      token: bauherrToken,
      body: JSON.stringify({ retractionReason: 'Verwechslung, betrifft ein anderes Grundstück.' }),
    });
    expect(response.status).toBe(200);

    const zurueckgezogen = (await response.json()) as DiaryEntryDto;
    expect(zurueckgezogen.retractedAt).not.toBeNull();
    expect(zurueckgezogen.retractionReason).toContain('Verwechslung');

    // Und er steht weiterhin in der Akte.
    const alle = await liste();
    expect(alle.some((entry) => entry.id === eintrag.id)).toBe(true);
  });

  it('löscht nichts, auch nicht mit den Rechten des Eigentümers', async () => {
    const alle = await liste();
    await expect(
      withAdminTx(async (tx) =>
        tx.query('delete from diary_entry where id = $1', [alle[0]!.id]),
      ),
    ).rejects.toThrow(/nicht gelöscht/i);
  });
});

describe('Die Kette', () => {
  it('verkettet die versiegelten Einträge und meldet sie als heil', async () => {
    const ergebnis = await pruefe();
    const parsed = diaryChainResult.safeParse(ergebnis);
    expect(parsed.success, JSON.stringify(parsed.error?.flatten())).toBe(true);

    expect(ergebnis.sealedCount).toBeGreaterThan(0);
    expect(ergebnis.intact).toBe(true);
    expect(ergebnis.headHash).toMatch(/^[0-9a-f]{64}$/);
    expect(ergebnis.entries.every((entry) => entry.ok)).toBe(true);
  });

  it('bricht, sobald jemand an einem versiegelten Eintrag dreht', async () => {
    const vorher = await pruefe();
    const betroffen = vorher.entries[0]!;

    // Der Trigger verhindert das im Betrieb. Für den Nachweis wird er
    // abgeschaltet — genau so sähe ein Zugriff an der Anwendung vorbei aus.
    await withAdminTx(async (tx) => {
      await tx.query('alter table diary_entry disable trigger diary_entry_sealed');
      await tx.query('update diary_entry set body = $2 where id = $1', [
        betroffen.entryId,
        'Nachträglich umgeschrieben.',
      ]);
      await tx.query('alter table diary_entry enable trigger diary_entry_sealed');
    });

    const nachher = await pruefe();
    expect(nachher.intact).toBe(false);

    const gebrochen = nachher.entries.find((entry) => entry.entryId === betroffen.entryId);
    expect(gebrochen?.ok).toBe(false);
    expect(gebrochen?.reason).toContain('Prüfsumme');
  });
});

describe('Fotos', () => {
  const pfad = 'projekt/foto-1.jpg';

  it('hält fest, was die Kamera sagt, und was der Mensch sagt', async () => {
    const response = await request(`/api/v1/projects/${projektId}/media`, {
      method: 'POST',
      token: bauherrToken,
      body: JSON.stringify({
        storagePath: pfad,
        mime: 'image/jpeg',
        bytes: 2_400_000,
        sha256: sha('foto-1'),
        exifTakenAt: '2026-05-04T09:12:00.000Z',
        exifLat: 48.137154,
        exifLon: 11.576124,
        statedDate: '2026-05-04',
        caption: 'Fundamenterder mit Anschlussfahnen',
        photoPromptKey: 'bodenplatte#0',
      }),
    });
    expect(response.status).toBe(201);

    const foto = (await response.json()) as {
      exifTakenAt: string;
      statedDate: string;
      photoPromptKey: string;
    };
    expect(foto.exifTakenAt).toContain('2026-05-04');
    expect(foto.statedDate).toBe('2026-05-04');
    expect(foto.photoPromptKey).toBe('bodenplatte#0');
  });

  it('legt dasselbe Foto nicht zweimal ab', async () => {
    const nochmal = await request(`/api/v1/projects/${projektId}/media`, {
      method: 'POST',
      token: bauherrToken,
      body: JSON.stringify({
        storagePath: pfad,
        mime: 'image/jpeg',
        bytes: 2_400_000,
        sha256: sha('foto-1'),
      }),
    });
    expect(nochmal.status).toBe(201);

    const anzahl = await withAdminTx(async (tx) =>
      (
        await tx.query<{ count: string }>(
          'select count(*)::text as count from media where project_id = $1',
          [projektId],
        )
      ).rows[0]!.count,
    );
    expect(anzahl).toBe('1');
  });

  it('meldet den erfüllten Fotoauftrag zurück', async () => {
    const response = await request(`/api/v1/projects/${projektId}/photo-prompts`, {
      token: bauherrToken,
    });
    const { fulfilled } = (await response.json()) as { fulfilled: string[] };
    expect(fulfilled).toContain('bodenplatte#0');
  });

  it('weist eine unsinnige Prüfsumme ab', async () => {
    const response = await request(`/api/v1/projects/${projektId}/media`, {
      method: 'POST',
      token: bauherrToken,
      body: JSON.stringify({
        storagePath: 'x.jpg',
        mime: 'image/jpeg',
        bytes: 100,
        sha256: 'zu kurz',
      }),
    });
    expect(response.status).toBe(422);
  });

  it('tauscht ein hochgeladenes Original nicht aus', async () => {
    await expect(
      withAdminTx(async (tx) =>
        tx.query("update media set sha256 = $1 where project_id = $2", [sha('anderes'), projektId]),
      ),
    ).rejects.toThrow(/nicht ausgetauscht/i);
  });
});
