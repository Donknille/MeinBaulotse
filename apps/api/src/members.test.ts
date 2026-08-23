/**
 * Der Einladungsvorgang (Abschnitt 2.2).
 *
 * Bis hierher kam ein Generalunternehmer nur über den Demo-Seed in ein
 * Bauvorhaben. Das Recht `member.invite` stand seit dem ersten Tag in der
 * Rechtematrix, die Policy seit 0002 — es fehlte der Weg vom Eintrag zur
 * Person.
 *
 * Der Test, auf den es ankommt, ist deshalb nicht „die Zeile wurde
 * angelegt", sondern: **Der Eingeladene sieht das Bauvorhaben, wenn er sich
 * das erste Mal anmeldet.** Alles andere ist Buchhaltung.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { closePool, withAdminTx } from '@meinbaulotse/db';
import type { ProjectMemberDto, ProjectSummary } from '@meinbaulotse/shared';
import { createApp } from './app.js';

const SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long';
process.env['SUPABASE_JWT_SECRET'] = SECRET;

const app = createApp({ lotseModel: null });

let bauherrToken: string;
let guToken: string;
let fremdToken: string;
let projektId: string;

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

const meineProjekte = async (token: string): Promise<ProjectSummary[]> =>
  (
    (await (await request('/api/v1/me/projects', { token })).json()) as {
      projects: ProjectSummary[];
    }
  ).projects;

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

  const [bauherr, gu, fremd] = await withAdminTx(async (tx) => {
    const ids: string[] = [];
    for (const adresse of [
      'einladung-bauherr@example.test',
      'joerg@baumeister-bau.test',
      'niemand@example.test',
    ]) {
      const result = await tx.query<{ id: string }>(
        'insert into auth.users (email) values ($1) returning id',
        [adresse],
      );
      ids.push(result.rows[0]!.id);
    }
    return ids;
  });
  bauherrToken = await tokenFor(bauherr!);
  guToken = await tokenFor(gu!);
  fremdToken = await tokenFor(fremd!);

  const angelegt = await request('/api/v1/projects/onboarding', {
    method: 'POST',
    token: bauherrToken,
    body: JSON.stringify({
      name: 'Einladungsweg 5',
      buildType: 'efh_massiv',
      hasBasement: true,
      plannedStart: '2026-06-01',
      federalState: 'BY',
      contractType: 'verbraucherbauvertrag',
    }),
  });
  projektId = ((await angelegt.json()) as { projectId: string }).projectId;
});

afterAll(async () => {
  await closePool();
});

describe('Einladen', () => {
  it('trägt den Generalunternehmer mit seiner Adresse ein', async () => {
    const antwort = await request(`/api/v1/projects/${projektId}/members`, {
      method: 'POST',
      token: bauherrToken,
      body: JSON.stringify({
        displayName: 'Jörg Baumeister',
        role: 'contractor',
        company: 'Baumeister Bau GmbH',
        email: 'joerg@baumeister-bau.test',
      }),
    });
    expect(antwort.status).toBe(201);

    const { members } = (await antwort.json()) as { members: ProjectMemberDto[] };
    const gu = members.find((mitglied) => mitglied.role === 'contractor');
    expect(gu?.displayName).toBe('Jörg Baumeister');
    // Noch kein Konto verbunden — er hat sich ja noch nicht angemeldet.
    expect(gu?.hasAccount).toBe(false);
  });

  it('holt den Eingeladenen beim ersten Anmelden herein — darum geht es', async () => {
    const vorher = await meineProjekte(guToken);
    expect(vorher).toHaveLength(1);
    expect(vorher[0]!.name).toBe('Einladungsweg 5');
    // Und mit seiner Rolle, nicht mit der des Bauherrn.
    expect(vorher[0]!.role).toBe('contractor');
  });

  it('macht aus der Einladung eine angenommene Mitgliedschaft', async () => {
    const { members } = (await (
      await request(`/api/v1/projects/${projektId}/schedule`, { token: bauherrToken })
    ).json()) as { members: ProjectMemberDto[] };
    const gu = members.find((mitglied) => mitglied.role === 'contractor');
    expect(gu?.hasAccount).toBe(true);
  });

  it('lässt einen Fremden nicht herein, nur weil er angemeldet ist', async () => {
    expect(await meineProjekte(fremdToken)).toHaveLength(0);
  });

  it('trägt ein Einzelgewerk auch ohne Adresse ein', async () => {
    // Ein Fliesenleger soll kein Konto brauchen (Leitsatz 1.6.2). Eine Maske,
    // die eine Adresse verlangte, verlangte sie ausgerechnet ihm ab.
    const antwort = await request(`/api/v1/projects/${projektId}/members`, {
      method: 'POST',
      token: bauherrToken,
      body: JSON.stringify({
        displayName: 'Kraft Fliesen',
        role: 'trade',
        tradeCode: 'fliesen',
      }),
    });
    expect(antwort.status).toBe(201);

    const { members } = (await antwort.json()) as { members: ProjectMemberDto[] };
    const gewerk = members.find((mitglied) => mitglied.role === 'trade');
    expect(gewerk?.tradeName).not.toBeNull();
    expect(gewerk?.hasAccount).toBe(false);
  });

  it('sagt beim Einzelgewerk ohne Gewerk, was fehlt', async () => {
    // „Gewerk" ohne Gewerk schneidet nichts zu, und die Zeilenschärfe aus 2.2
    // hängt genau daran. Die Datenbank weist es ab — die Anwendung erklärt es.
    const antwort = await request(`/api/v1/projects/${projektId}/members`, {
      method: 'POST',
      token: bauherrToken,
      body: JSON.stringify({ displayName: 'Irgendein Gewerk', role: 'trade' }),
    });
    expect(antwort.status).toBe(422);
    const fehler = (await antwort.json()) as { error: string; details?: { hint?: string } };
    expect(fehler.error).toContain('gehört ein Gewerk');
    expect(fehler.details?.hint).toContain('zuständig');
  });

  it('lässt dieselbe Adresse nicht zweimal eintragen', async () => {
    // Zwei Zeilen für dieselbe Person ergäben zwei Rollen, und welche gilt,
    // entschiede die Sortierung — also der Zufall.
    const antwort = await request(`/api/v1/projects/${projektId}/members`, {
      method: 'POST',
      token: bauherrToken,
      body: JSON.stringify({
        displayName: 'Jörg noch einmal',
        role: 'viewer',
        email: 'joerg@baumeister-bau.test',
      }),
    });
    expect(antwort.status).toBe(409);
    expect(((await antwort.json()) as { error: string }).error).toContain('schon eingetragen');
  });

  it('lässt den GU niemanden einladen', async () => {
    // Rechtematrix 2.2: `member.invite` hat nur owner und co_owner.
    const antwort = await request(`/api/v1/projects/${projektId}/members`, {
      method: 'POST',
      token: guToken,
      body: JSON.stringify({ displayName: 'Sein Subunternehmer', role: 'trade' }),
    });
    expect(antwort.status).toBe(403);
  });
});

describe('Wieder hinausnehmen', () => {
  it('sperrt statt zu löschen und nimmt die Links gleich mit', async () => {
    const { members } = (await (
      await request(`/api/v1/projects/${projektId}/schedule`, { token: bauherrToken })
    ).json()) as { members: ProjectMemberDto[] };
    const gewerk = members.find((mitglied) => mitglied.role === 'trade')!;

    await request(`/api/v1/projects/${projektId}/guest-links`, {
      method: 'POST',
      token: bauherrToken,
      body: JSON.stringify({ memberId: gewerk.id }),
    });

    const antwort = await request(`/api/v1/projects/${projektId}/members/${gewerk.id}`, {
      method: 'DELETE',
      token: bauherrToken,
    });
    expect(antwort.status).toBe(200);

    const stand = await withAdminTx(async (tx) => ({
      mitglied: (
        await tx.query<{ revoked_at: string | null }>(
          'select revoked_at from project_member where id = $1',
          [gewerk.id],
        )
      ).rows[0]!.revoked_at,
      offeneLinks: (
        await tx.query<{ count: string }>(
          'select count(*)::text as count from guest_token where member_id = $1 and revoked_at is null',
          [gewerk.id],
        )
      ).rows[0]!.count,
    }));

    // Gesperrt, nicht gelöscht: Was jemand getan hat, bleibt in der Historie
    // stehen — es ist ja passiert.
    expect(stand.mitglied).not.toBeNull();
    expect(Number(stand.offeneLinks)).toBe(0);
  });

  it('lässt den Bauherrn sich nicht selbst hinausnehmen', async () => {
    const { members } = (await (
      await request(`/api/v1/projects/${projektId}/schedule`, { token: bauherrToken })
    ).json()) as { members: ProjectMemberDto[] };
    const selbst = members.find((mitglied) => mitglied.role === 'owner')!;

    const antwort = await request(`/api/v1/projects/${projektId}/members/${selbst.id}`, {
      method: 'DELETE',
      token: bauherrToken,
    });
    expect(antwort.status).toBe(409);
    // Sonst käme niemand mehr an das Bauvorhaben heran.
    expect(((await antwort.json()) as { error: string }).error).toContain('nicht hinausnehmen');
  });

  it('nimmt dem Gesperrten das Bauvorhaben aus der Liste', async () => {
    const guProjekte = await meineProjekte(guToken);
    expect(guProjekte).toHaveLength(1);

    const { members } = (await (
      await request(`/api/v1/projects/${projektId}/schedule`, { token: bauherrToken })
    ).json()) as { members: ProjectMemberDto[] };
    const gu = members.find((mitglied) => mitglied.role === 'contractor')!;

    await request(`/api/v1/projects/${projektId}/members/${gu.id}`, {
      method: 'DELETE',
      token: bauherrToken,
    });
    expect(await meineProjekte(guToken)).toHaveLength(0);
  });
});
