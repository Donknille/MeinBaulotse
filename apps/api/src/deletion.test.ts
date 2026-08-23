/**
 * Löschung als Selbstbedienung (Abschnitt 6.5).
 *
 * Der Satz steht neben einem zweiten im selben Abschnitt: „Aufbewahrung bis
 * 5 Jahre nach Abnahme wegen Gewährleistung, danach Erinnerung statt stiller
 * Löschung." Beides gilt, und aus dem Widerspruch folgt die Bauweise: Der
 * Bauherr beantragt, der Betreiber löscht, und dazwischen liegt eine Frist,
 * in der sich der Antrag zurücknehmen lässt.
 *
 * Der wichtigste Test steht deshalb ganz unten: Die Anwendung kann Historie
 * **nicht** löschen, auch wenn sie es wollte.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { closePool, withAdminTx } from '@meinbaulotse/db';
import type { ProjectSummary } from '@meinbaulotse/shared';
import { createApp } from './app.js';

const SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long';
process.env['SUPABASE_JWT_SECRET'] = SECRET;

const app = createApp({ lotseModel: null });

interface DeletionState {
  requestedAt: string | null;
  purgeAfter: string | null;
  withinWarranty: boolean;
  graceDays: number;
}

let bauherrToken: string;
let guToken: string;
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

const meineProjekte = async (): Promise<ProjectSummary[]> =>
  (
    (await (await request('/api/v1/me/projects', { token: bauherrToken })).json()) as {
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

  const [bauherr, gu] = await withAdminTx(async (tx) => {
    const a = await tx.query<{ id: string }>(
      'insert into auth.users (email) values ($1) returning id',
      ['loeschung-bauherr@example.test'],
    );
    const b = await tx.query<{ id: string }>(
      'insert into auth.users (email) values ($1) returning id',
      ['loeschung-gu@example.test'],
    );
    return [a.rows[0]!.id, b.rows[0]!.id];
  });
  bauherrToken = await tokenFor(bauherr!);
  guToken = await tokenFor(gu!);

  const angelegt = await request('/api/v1/projects/onboarding', {
    method: 'POST',
    token: bauherrToken,
    body: JSON.stringify({
      name: 'Abschiedsweg 1',
      buildType: 'efh_massiv',
      hasBasement: true,
      plannedStart: '2026-05-01',
      federalState: 'BY',
      contractType: 'verbraucherbauvertrag',
    }),
  });
  projektId = ((await angelegt.json()) as { projectId: string }).projectId;

  await withAdminTx(async (tx) =>
    tx.query(
      `insert into project_member (project_id, user_id, role, display_name)
       values ($1, $2, 'contractor', 'Jörg Baumeister')`,
      [projektId, gu!],
    ),
  );
});

afterAll(async () => {
  await closePool();
});

describe('Beantragen', () => {
  it('lässt nur den Bauherrn löschen', async () => {
    const antwort = await request(`/api/v1/projects/${projektId}/deletion`, {
      method: 'POST',
      token: guToken,
      body: JSON.stringify({ reason: 'Weil ich es kann' }),
    });
    expect(antwort.status).toBe(403);
    expect(((await antwort.json()) as { error: string }).error).toContain('angelegt hat');
  });

  it('merkt das Bauvorhaben vor und nennt den Tag der Löschung', async () => {
    const antwort = await request(`/api/v1/projects/${projektId}/deletion`, {
      method: 'POST',
      token: bauherrToken,
      body: JSON.stringify({ reason: 'Bau ist abgeschlossen' }),
    });
    expect(antwort.status).toBe(200);

    const stand = (await antwort.json()) as DeletionState;
    expect(stand.requestedAt).not.toBeNull();
    expect(stand.graceDays).toBe(30);
    // Die Frist ist der Punkt: Wer abends aus Ärger drückt, ruft morgens an.
    const tage =
      (Date.parse(stand.purgeAfter!) - Date.parse(stand.requestedAt!)) / 86_400_000;
    expect(Math.round(tage)).toBe(30);
  });

  it('nimmt es aus der Liste, ohne etwas zu löschen', async () => {
    expect(await meineProjekte()).toHaveLength(0);

    const zeilen = await withAdminTx(async (tx) =>
      Number(
        (
          await tx.query<{ count: string }>(
            'select count(*)::text as count from task where project_id = $1',
            [projektId],
          )
        ).rows[0]!.count,
      ),
    );
    // Vorgemerkt heißt vorgemerkt. Die Akte steht noch vollständig da.
    expect(zeilen).toBeGreaterThan(30);
  });

  it('lässt das Bauvorhaben erreichbar, damit man zurückkann', async () => {
    const antwort = await request(`/api/v1/projects/${projektId}/schedule`, {
      token: bauherrToken,
    });
    expect(antwort.status).toBe(200);
  });
});

describe('Zurücknehmen', () => {
  it('holt das Bauvorhaben zurück', async () => {
    const antwort = await request(`/api/v1/projects/${projektId}/deletion`, {
      method: 'DELETE',
      token: bauherrToken,
    });
    expect(antwort.status).toBe(200);
    expect(((await antwort.json()) as DeletionState).requestedAt).toBeNull();
    expect(await meineProjekte()).toHaveLength(1);
  });

  it('sagt es offen, wenn gar nichts anliegt', async () => {
    const antwort = await request(`/api/v1/projects/${projektId}/deletion`, {
      method: 'DELETE',
      token: bauherrToken,
    });
    expect(antwort.status).toBe(404);
  });

  it('hält beide Schritte im Protokoll fest', async () => {
    const eintraege = await withAdminTx(async (tx) =>
      (
        await tx.query<{ action: string }>(
          "select action from audit_log where project_id = $1 and action like 'project.deletion%' order by created_at",
          [projektId],
        )
      ).rows.map((row) => row.action),
    );
    expect(eintraege).toEqual([
      'project.deletion_requested',
      'project.deletion_cancelled',
    ]);
  });
});

describe('Die Grenze, an der es hängen soll', () => {
  it('lässt die Anwendungsrolle keine Historie löschen — auch nicht über das Projekt', async () => {
    // Das ist der wichtigste Test dieser Datei. Ein Fehler im Anwendungscode
    // darf keine Akte vernichten können, und deshalb löscht die Anwendung
    // nicht — sie merkt vor. Der Versuch scheitert an derselben Sperre wie
    // jeder andere Änderungsversuch an der Historie.
    const claims = { sub: 'egal' };
    await expect(
      (async () => {
        const { withUserTx } = await import('@meinbaulotse/db');
        await withUserTx(claims as never, async (tx) =>
          tx.query('delete from schedule_change where project_id = $1', [projektId]),
        );
      })(),
    ).rejects.toThrow();

    const geblieben = await withAdminTx(async (tx) =>
      Number(
        (
          await tx.query<{ count: string }>(
            'select count(*)::text as count from schedule_change where project_id = $1',
            [projektId],
          )
        ).rows[0]!.count,
      ),
    );
    expect(geblieben).toBeGreaterThan(0);
  });

  it('lässt den Betreiber löschen, sobald die Trigger aus sind', async () => {
    // So arbeitet `pnpm project:purge`: Trigger aus, löschen, Trigger an —
    // alles in einer Transaktion. Bricht etwas ab, war nichts.
    await withAdminTx(async (tx) => {
      for (const [tabelle, trigger] of [
        ['schedule_change', 'schedule_change_append_only'],
        ['diary_entry', 'diary_entry_sealed'],
        ['task_confirmation', 'task_confirmation_append_only'],
        ['defect_event', 'defect_event_append_only'],
        ['assistant_message', 'assistant_message_append_only'],
        ['media', 'media_immutable_original'],
      ] as const) {
        await tx.query(`alter table ${tabelle} disable trigger ${trigger}`);
      }
      try {
        await tx.query('delete from project where id = $1', [projektId]);
      } finally {
        for (const [tabelle, trigger] of [
          ['schedule_change', 'schedule_change_append_only'],
          ['diary_entry', 'diary_entry_sealed'],
          ['task_confirmation', 'task_confirmation_append_only'],
          ['defect_event', 'defect_event_append_only'],
          ['assistant_message', 'assistant_message_append_only'],
          ['media', 'media_immutable_original'],
        ] as const) {
          await tx.query(`alter table ${tabelle} enable trigger ${trigger}`);
        }
      }
    });

    const uebrig = await withAdminTx(async (tx) =>
      Number(
        (
          await tx.query<{ count: string }>(
            'select count(*)::text as count from project where id = $1',
            [projektId],
          )
        ).rows[0]!.count,
      ),
    );
    expect(uebrig).toBe(0);
  });
});
