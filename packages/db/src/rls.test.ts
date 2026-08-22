/**
 * Negativtests je Rolle (Abschnitt 6.4 der Spezifikation).
 *
 * Geprüft wird nicht, dass der Anwendungscode das Richtige tut, sondern dass
 * die Datenbank das Falsche verhindert — unabhängig davon, was der
 * Anwendungscode versucht. Jeder Zugriff läuft über `withUserTx`, also als
 * Rolle `authenticated` mit gesetztem JWT-Claim: derselbe Weg wie im Betrieb.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool, withAdminTx, withUserTx } from './client.js';
import { MEMBER_ROLES, permissionsOf, type MemberRole } from './permissions.js';
import { createProjectFixture, truncateAll, type ProjectFixture } from './test-fixtures.js';

let eigenes: ProjectFixture;
let fremdes: ProjectFixture;

beforeAll(async () => {
  await truncateAll();
  eigenes = await createProjectFixture('a');
  fremdes = await createProjectFixture('b');
});

afterAll(async () => {
  await truncateAll();
  await closePool();
});

function as<T>(userId: string, run: Parameters<typeof withUserTx<T>>[1]): Promise<T> {
  return withUserTx({ sub: userId }, run);
}

/** Führt eine Anweisung aus und meldet, ob sie erlaubt war. */
async function allowed(userId: string, sql: string, values: readonly unknown[] = []): Promise<boolean> {
  try {
    await as(userId, async (tx) => tx.query(sql, values));
    return true;
  } catch {
    return false;
  }
}

async function rowCount(userId: string, sql: string, values: readonly unknown[] = []): Promise<number> {
  return as(userId, async (tx) => (await tx.query(sql, values)).rowCount ?? 0);
}

describe('Projektübergreifung', () => {
  it('kein Mitglied sieht fremde Projekte', async () => {
    for (const role of MEMBER_ROLES) {
      const userId = eigenes.actors[role].userId;
      const visible = await rowCount(userId, 'select id from project where id = $1', [
        fremdes.projectId,
      ]);
      expect(visible, `${role} sieht fremdes Projekt`).toBe(0);
    }
  });

  it('kein Mitglied sieht fremde Vorgänge', async () => {
    for (const role of MEMBER_ROLES) {
      const userId = eigenes.actors[role].userId;
      const visible = await rowCount(userId, 'select id from task where project_id = $1', [
        fremdes.projectId,
      ]);
      expect(visible, `${role} sieht fremde Vorgänge`).toBe(0);
    }
  });

  it('kein Mitglied sieht die fremde Historie', async () => {
    for (const role of MEMBER_ROLES) {
      const userId = eigenes.actors[role].userId;
      const visible = await rowCount(
        userId,
        'select id from schedule_change where project_id = $1',
        [fremdes.projectId],
      );
      expect(visible, `${role} sieht fremde Historie`).toBe(0);
    }
  });

  it('kein Mitglied sieht fremde Mitgliederlisten', async () => {
    for (const role of MEMBER_ROLES) {
      const userId = eigenes.actors[role].userId;
      const visible = await rowCount(
        userId,
        'select id from project_member where project_id = $1',
        [fremdes.projectId],
      );
      expect(visible, `${role} sieht fremde Mitglieder`).toBe(0);
    }
  });

  it('ein Unbeteiligter sieht überhaupt nichts', async () => {
    const outsider = await withAdminTx(async (tx) => {
      const result = await tx.query<{ id: string }>(
        "insert into auth.users (email) values ('outsider@example.test') returning id",
      );
      return result.rows[0]!.id;
    });
    expect(await rowCount(outsider, 'select id from project')).toBe(0);
    expect(await rowCount(outsider, 'select id from task')).toBe(0);
    expect(await rowCount(outsider, 'select id from project_member')).toBe(0);
    // Nachschlagetabellen bleiben lesbar — sie enthalten keine Projektdaten.
    expect(await rowCount(outsider, 'select key from phase')).toBe(9);
  });
});

describe('Lesen im eigenen Projekt', () => {
  it('jede Rolle sieht das Projekt', async () => {
    for (const role of MEMBER_ROLES) {
      const visible = await rowCount(
        eigenes.actors[role].userId,
        'select id from project where id = $1',
        [eigenes.projectId],
      );
      expect(visible, role).toBe(1);
    }
  });

  it('ein Einzelgewerk sieht nur seinen eigenen Ausschnitt', async () => {
    const tradeUser = eigenes.actors.trade.userId;
    const tasks = await as(tradeUser, async (tx) =>
      (await tx.query<{ id: string }>('select id from task where project_id = $1', [eigenes.projectId]))
        .rows,
    );
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.id).toBe(eigenes.tileTaskId);
  });

  it('alle anderen Rollen sehen beide Vorgänge', async () => {
    for (const role of MEMBER_ROLES.filter((candidate) => candidate !== 'trade')) {
      const count = await rowCount(
        eigenes.actors[role].userId,
        'select id from task where project_id = $1',
        [eigenes.projectId],
      );
      expect(count, role).toBe(2);
    }
  });
});

describe('Schreiben nach Rechtematrix', () => {
  const canWriteTasks: readonly MemberRole[] = ['owner', 'co_owner', 'contractor'];

  it('Vorgänge anlegen dürfen nur owner, co_owner und contractor', async () => {
    for (const role of MEMBER_ROLES) {
      const ok = await allowed(
        eigenes.actors[role].userId,
        `insert into task (project_id, name, phase_key, duration_days, current_start, current_end)
         values ($1, $2, 'ausbau', 1, date '2026-05-04', date '2026-05-04')`,
        [eigenes.projectId, `Probe ${role}`],
      );
      expect(ok, `${role} darf Vorgänge anlegen: ${ok}`).toBe(canWriteTasks.includes(role));
    }
  });

  it('Termine ändern dürfen zusätzlich Einzelgewerke — aber nur am eigenen Vorgang', async () => {
    const tradeUser = eigenes.actors.trade.userId;
    expect(
      await allowed(tradeUser, 'update task set current_start = current_start where id = $1', [
        eigenes.tileTaskId,
      ]),
    ).toBe(true);

    // Der fremde Vorgang ist für das Gewerk nicht einmal sichtbar.
    const changed = await as(tradeUser, async (tx) =>
      (await tx.query('update task set current_start = current_start where id = $1', [
        eigenes.paintTaskId,
      ])).rowCount ?? 0,
    );
    expect(changed).toBe(0);
  });

  it('viewer und expert dürfen keine Termine ändern', async () => {
    for (const role of ['viewer', 'expert'] as const) {
      const changed = await as(eigenes.actors[role].userId, async (tx) =>
        (await tx.query('update task set current_start = current_start where id = $1', [
          eigenes.tileTaskId,
        ])).rowCount ?? 0,
      );
      expect(changed, role).toBe(0);
    }
  });

  it('Vorgänge löschen darf kein viewer und kein trade', async () => {
    for (const role of ['viewer', 'trade', 'expert'] as const) {
      const deleted = await as(eigenes.actors[role].userId, async (tx) =>
        (await tx.query('delete from task where id = $1', [eigenes.paintTaskId])).rowCount ?? 0,
      );
      expect(deleted, role).toBe(0);
    }
  });

  it('Mitglieder einladen dürfen nur owner und co_owner', async () => {
    for (const role of MEMBER_ROLES) {
      const ok = await allowed(
        eigenes.actors[role].userId,
        `insert into project_member (project_id, role, display_name, email)
         values ($1, 'viewer', $2, $3)`,
        [eigenes.projectId, `Gast von ${role}`, `gast-${role}@example.test`],
      );
      expect(ok, `${role} darf einladen`).toBe(role === 'owner' || role === 'co_owner');
    }
  });

  it('das Projekt löschen darf nur der owner', async () => {
    for (const role of MEMBER_ROLES.filter((candidate) => candidate !== 'owner')) {
      const deleted = await as(eigenes.actors[role].userId, async (tx) =>
        (await tx.query('delete from project where id = $1', [eigenes.projectId])).rowCount ?? 0,
      );
      expect(deleted, role).toBe(0);
    }
  });

  it('Vertragsdaten pflegen dürfen owner, co_owner und expert', async () => {
    for (const role of MEMBER_ROLES) {
      const changed = await as(eigenes.actors[role].userId, async (tx) =>
        (await tx.query('update project set contract_sum_cents = 42000000 where id = $1', [
          eigenes.projectId,
        ])).rowCount ?? 0,
      );
      const expected = permissionsOf(role).includes('contract.write') ? 1 : 0;
      expect(changed, role).toBe(expected);
    }
  });
});

describe('Die Rechtematrix in der Datenbank entspricht der Quelle', () => {
  it('mbl.has_perm antwortet für jede Rolle wie permissionsOf', async () => {
    const allPermissions = await withAdminTx(async (tx) =>
      (await tx.query<{ permission: string }>('select distinct permission from role_permission')).rows.map(
        (row) => row.permission,
      ),
    );

    for (const role of MEMBER_ROLES) {
      const expected = new Set(permissionsOf(role));
      const userId = eigenes.actors[role].userId;
      for (const permission of allPermissions) {
        const answer = await as(userId, async (tx) =>
          (
            await tx.query<{ ok: boolean }>('select mbl.has_perm($1, $2) as ok', [
              eigenes.projectId,
              permission,
            ])
          ).rows[0]!.ok,
        );
        expect(answer, `${role} / ${permission}`).toBe(expected.has(permission));
      }
    }
  });
});

describe('Wissensschicht', () => {
  it('jede Rolle liest die veröffentlichten Lotsenkarten', async () => {
    for (const role of MEMBER_ROLES) {
      const gelesen = await rowCount(
        eigenes.actors[role].userId,
        'select id from guide_card where published_at is not null',
      );
      expect(gelesen, `${role} sieht keine Karten`).toBeGreaterThan(0);
    }
  });

  it('niemand ändert Redaktionsinhalt aus der Anwendung heraus', async () => {
    // Erste Sperre: kein Recht. Zweite Sperre: keine Policy. Dritte: der
    // Trigger aus 0005. Hier wird die erste geprüft.
    for (const role of MEMBER_ROLES) {
      const darf = await allowed(
        eigenes.actors[role].userId,
        "update guide_card set title = 'übernommen' where key = 'estrich'",
      );
      expect(darf, `${role} darf Redaktionsinhalt ändern`).toBe(false);
    }
  });

  it('ein unveröffentlichter Entwurf ist für niemanden sichtbar', async () => {
    const id = await withAdminTx(async (tx) =>
      (
        await tx.query<{ id: string }>(
          `insert into guide_card (key, version, phase_key, title, whats_happening)
           values ('probe-unsichtbar', 1, 'ausbau', 'Entwurf', 'Text.')
           returning id`,
        )
      ).rows[0]!.id,
    );

    for (const role of MEMBER_ROLES) {
      const sichtbar = await rowCount(
        eigenes.actors[role].userId,
        'select id from guide_card where id = $1',
        [id],
      );
      expect(sichtbar, `${role} sieht einen Entwurf`).toBe(0);
    }

    await withAdminTx(async (tx) => tx.query('delete from guide_card where id = $1', [id]));
  });

  it('die eigene Rückmeldung darf jedes Mitglied abgeben, eine fremde nicht', async () => {
    const kartenId = await withAdminTx(async (tx) =>
      (
        await tx.query<{ id: string }>("select id from guide_card where key = 'estrich'")
      ).rows[0]!.id,
    );

    const eigeneRueckmeldung = await allowed(
      eigenes.actors.owner.userId,
      `insert into guide_card_read (project_id, guide_card_id, member_id, helpful)
       values ($1, $2, $3, true)`,
      [eigenes.projectId, kartenId, eigenes.actors.owner.memberId],
    );
    expect(eigeneRueckmeldung).toBe(true);

    // Im Namen eines anderen Mitglieds geht es nicht.
    const fremdeRueckmeldung = await allowed(
      eigenes.actors.owner.userId,
      `insert into guide_card_read (project_id, guide_card_id, member_id, helpful)
       values ($1, $2, $3, false)`,
      [eigenes.projectId, kartenId, eigenes.actors.contractor.memberId],
    );
    expect(fremdeRueckmeldung).toBe(false);
  });

  it('abhaken darf derselbe Kreis, der auch ins Tagebuch schreibt', async () => {
    for (const role of MEMBER_ROLES) {
      const darf = await allowed(
        eigenes.actors[role].userId,
        `insert into checklist_item (project_id, task_id, text, sort_order)
         values ($1, $2, 'Probe', $3)`,
        [eigenes.projectId, eigenes.tileTaskId, MEMBER_ROLES.indexOf(role) + 100],
      );
      expect(darf, `${role} darf abhaken: ${darf}`).toBe(permissionsOf(role).includes('diary.write'));
    }
  });

  it('ein Einzelgewerk sieht keine Checkliste zu einem fremden Vorgang', async () => {
    await withAdminTx(async (tx) =>
      tx.query(
        `insert into checklist_item (project_id, task_id, text, sort_order)
         values ($1, $2, 'Am Malervorgang', 200)`,
        [eigenes.projectId, eigenes.paintTaskId],
      ),
    );

    const sichtbarFuerFliesen = await rowCount(
      eigenes.actors.trade.userId,
      'select id from checklist_item where task_id = $1',
      [eigenes.paintTaskId],
    );
    expect(sichtbarFuerFliesen).toBe(0);

    const sichtbarFuerBauherrn = await rowCount(
      eigenes.actors.owner.userId,
      'select id from checklist_item where task_id = $1',
      [eigenes.paintTaskId],
    );
    expect(sichtbarFuerBauherrn).toBe(1);
  });

  it('kein Mitglied sieht Checklisten eines fremden Projekts', async () => {
    await withAdminTx(async (tx) =>
      tx.query(
        `insert into checklist_item (project_id, task_id, text, sort_order)
         values ($1, $2, 'Im fremden Projekt', 300)`,
        [fremdes.projectId, fremdes.tileTaskId],
      ),
    );

    for (const role of MEMBER_ROLES) {
      const sichtbar = await rowCount(
        eigenes.actors[role].userId,
        'select id from checklist_item where project_id = $1',
        [fremdes.projectId],
      );
      expect(sichtbar, `${role} sieht fremde Checkliste`).toBe(0);
    }
  });
});
