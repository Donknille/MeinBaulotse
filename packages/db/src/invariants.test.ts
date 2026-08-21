/**
 * Nachweise für die Datenbank-Invarianten aus Abschnitt 4.1 der Spezifikation.
 *
 * Sie werden bewusst gegen die Datenbank geprüft, nicht gegen den
 * Anwendungscode: Eine Invariante, die nur der Anwendungscode einhält, ist
 * keine Invariante.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool, withAdminTx, withUserTx } from './client.js';
import { createProjectFixture, truncateAll, type ProjectFixture } from './test-fixtures.js';

let fixture: ProjectFixture;

beforeAll(async () => {
  await truncateAll();
  fixture = await createProjectFixture('inv');
});

afterAll(async () => {
  await truncateAll();
  await closePool();
});

const asOwner = <T>(run: Parameters<typeof withUserTx<T>>[1], options = {}): Promise<T> =>
  withUserTx({ sub: fixture.ownerUserId }, run, options);

describe('(1) schedule_change ist append-only', () => {
  it('lässt sich als Anwendungsrolle nicht ändern', async () => {
    await expect(
      asOwner(async (tx) => tx.query('update schedule_change set reason_text = $1', ['manipuliert'])),
    ).rejects.toThrow();
  });

  it('lässt sich als Anwendungsrolle nicht löschen', async () => {
    await expect(
      asOwner(async (tx) => tx.query('delete from schedule_change')),
    ).rejects.toThrow();
  });

  it('lässt sich auch mit den Rechten des Eigentümers nicht ändern', async () => {
    // Zweite Sperre: der Trigger greift unabhängig von den vergebenen Rechten.
    await expect(
      withAdminTx(async (tx) => tx.query("update schedule_change set reason_text = 'manipuliert'")),
    ).rejects.toThrow(/append-only/i);
  });

  it('nimmt neue Einträge an', async () => {
    const before = await countChanges();
    await asOwner(async (tx) =>
      tx.query(
        `insert into schedule_change (project_id, task_id, field, new_value)
         values ($1, $2, 'probe', '"wert"'::jsonb)`,
        [fixture.projectId, fixture.tileTaskId],
      ),
    );
    expect(await countChanges()).toBe(before + 1);
  });
});

describe('(4) Jede Terminänderung erzeugt einen Eintrag', () => {
  it('protokolliert das Anlegen eines Vorgangs', async () => {
    const entries = await withAdminTx(async (tx) =>
      (
        await tx.query<{ field: string; reason_code: string }>(
          `select field, reason_code from schedule_change
           where task_id = $1 and field = 'task_created'`,
          [fixture.tileTaskId],
        )
      ).rows,
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]!.reason_code).toBe('planinitialisierung');
  });

  it('protokolliert eine Terminverschiebung mit altem und neuem Wert', async () => {
    await asOwner(
      async (tx) =>
        tx.query("update task set current_start = date '2026-09-16' where id = $1", [
          fixture.tileTaskId,
        ]),
      { changeReason: 'lieferzeit', changeReasonText: 'Fliesen kommen später' },
    );

    const entry = await withAdminTx(async (tx) =>
      (
        await tx.query<{
          old_value: string;
          new_value: string;
          reason_code: string;
          reason_text: string;
          actor_role: string;
          actor_channel: string;
        }>(
          `select old_value, new_value, reason_code, reason_text, actor_role, actor_channel
           from schedule_change
           where task_id = $1 and field = 'current_start'
           order by created_at desc limit 1`,
          [fixture.tileTaskId],
        )
      ).rows[0],
    );

    expect(entry).toBeDefined();
    expect(entry!.old_value).toBe('2026-09-09');
    expect(entry!.new_value).toBe('2026-09-16');
    expect(entry!.reason_code).toBe('lieferzeit');
    expect(entry!.reason_text).toBe('Fliesen kommen später');
    expect(entry!.actor_role).toBe('owner');
    expect(entry!.actor_channel).toBe('app');
  });

  it('hält den Kanal fest, über den die Änderung kam', async () => {
    await withUserTx(
      { sub: fixture.ownerUserId },
      async (tx) =>
        tx.query("update task set current_end = date '2026-09-25' where id = $1", [
          fixture.tileTaskId,
        ]),
      { actorChannel: 'guest_link' },
    );

    const channel = await withAdminTx(async (tx) =>
      (
        await tx.query<{ actor_channel: string }>(
          `select actor_channel from schedule_change
           where task_id = $1 and field = 'current_end'
           order by created_at desc limit 1`,
          [fixture.tileTaskId],
        )
      ).rows[0]!.actor_channel,
    );
    expect(channel).toBe('guest_link');
  });

  it('protokolliert Statuswechsel und Dauerkorrekturen', async () => {
    await asOwner(async (tx) =>
      tx.query("update task set status = 'laeuft', duration_days = 9 where id = $1", [
        fixture.tileTaskId,
      ]),
    );
    const fields = await withAdminTx(async (tx) =>
      (
        await tx.query<{ field: string }>(
          `select field from schedule_change where task_id = $1 and field in ('status','duration_days')`,
          [fixture.tileTaskId],
        )
      ).rows.map((row) => row.field),
    );
    expect(new Set(fields)).toEqual(new Set(['status', 'duration_days']));
  });

  it('schreibt nichts, wenn sich nichts ändert', async () => {
    const before = await countChanges();
    await asOwner(async (tx) =>
      tx.query('update task set name = name where id = $1', [fixture.tileTaskId]),
    );
    expect(await countChanges()).toBe(before);
  });
});

describe('(3) Die Baseline ist nach dem Sperren unveränderlich', () => {
  it('lässt Baseline-Termine vor dem Sperren zu', async () => {
    await expect(
      asOwner(async (tx) =>
        tx.query("update task set baseline_start = date '2026-09-09' where id = $1", [
          fixture.paintTaskId,
        ]),
      ),
    ).resolves.toBeDefined();
  });

  it('verweigert die Änderung nach dem Sperren', async () => {
    await withAdminTx(async (tx) =>
      tx.query('update project set baseline_locked_at = now() where id = $1', [fixture.projectId]),
    );

    await expect(
      asOwner(async (tx) =>
        tx.query("update task set baseline_start = date '2026-10-01' where id = $1", [
          fixture.paintTaskId,
        ]),
      ),
    ).rejects.toThrow(/gesperrt/i);
  });

  it('lässt andere Felder weiterhin zu', async () => {
    await expect(
      asOwner(async (tx) =>
        tx.query("update task set current_start = date '2026-09-22' where id = $1", [
          fixture.paintTaskId,
        ]),
      ),
    ).resolves.toBeDefined();

    await withAdminTx(async (tx) =>
      tx.query('update project set baseline_locked_at = null where id = $1', [fixture.projectId]),
    );
  });
});

describe('(5) Abhängigkeiten dürfen keinen Zyklus schließen', () => {
  it('verweigert die Rückkante', async () => {
    // fliesen → maler besteht bereits; maler → fliesen schlösse den Kreis.
    await expect(
      asOwner(async (tx) =>
        tx.query(
          'insert into dependency (project_id, predecessor_id, successor_id) values ($1, $2, $3)',
          [fixture.projectId, fixture.paintTaskId, fixture.tileTaskId],
        ),
      ),
    ).rejects.toThrow(/Zyklus/i);
  });

  it('verweigert den Selbstbezug', async () => {
    await expect(
      asOwner(async (tx) =>
        tx.query(
          'insert into dependency (project_id, predecessor_id, successor_id) values ($1, $2, $2)',
          [fixture.projectId, fixture.tileTaskId],
        ),
      ),
    ).rejects.toThrow();
  });

  it('verweigert einen Zyklus über drei Ecken', async () => {
    const thirdId = await withAdminTx(async (tx) =>
      (
        await tx.query<{ id: string }>(
          `insert into task (project_id, name, phase_key, duration_days)
           values ($1, 'Bodenbeläge', 'endausbau', 5) returning id`,
          [fixture.projectId],
        )
      ).rows[0]!.id,
    );

    await asOwner(async (tx) =>
      tx.query(
        'insert into dependency (project_id, predecessor_id, successor_id) values ($1, $2, $3)',
        [fixture.projectId, fixture.paintTaskId, thirdId],
      ),
    );

    await expect(
      asOwner(async (tx) =>
        tx.query(
          'insert into dependency (project_id, predecessor_id, successor_id) values ($1, $2, $3)',
          [fixture.projectId, thirdId, fixture.tileTaskId],
        ),
      ),
    ).rejects.toThrow(/Zyklus/i);
  });
});

describe('Prüfregeln des Schemas', () => {
  it('erzwingt bei Meilensteinen die Dauer 0', async () => {
    await expect(
      withAdminTx(async (tx) =>
        tx.query(
          `insert into task (project_id, name, phase_key, is_milestone, duration_days)
           values ($1, 'Falscher Meilenstein', 'abnahme', true, 3)`,
          [fixture.projectId],
        ),
      ),
    ).rejects.toThrow();
  });

  it('erzwingt bei Wartezeiten Kalendertage', async () => {
    await expect(
      withAdminTx(async (tx) =>
        tx.query(
          `insert into task (project_id, name, phase_key, is_wait, duration_unit, duration_days)
           values ($1, 'Falsche Wartezeit', 'ausbau', true, 'werktage', 35)`,
          [fixture.projectId],
        ),
      ),
    ).rejects.toThrow();
  });

  it('erzwingt bei Einzelgewerken die Zuordnung eines Gewerks', async () => {
    await expect(
      withAdminTx(async (tx) =>
        tx.query(
          `insert into project_member (project_id, role, display_name) values ($1, 'trade', 'Ohne Gewerk')`,
          [fixture.projectId],
        ),
      ),
    ).rejects.toThrow();
  });

  it('lässt eine Mandantenzuordnung nur bei der Rolle expert zu', async () => {
    const orgId = await withAdminTx(async (tx) =>
      (
        await tx.query<{ id: string }>('select id from expert_org limit 1')
      ).rows[0]!.id,
    );
    await expect(
      withAdminTx(async (tx) =>
        tx.query(
          `insert into project_member (project_id, role, display_name, expert_org_id)
           values ($1, 'viewer', 'Falsche Rolle', $2)`,
          [fixture.projectId, orgId],
        ),
      ),
    ).rejects.toThrow();
  });
});

async function countChanges(): Promise<number> {
  return withAdminTx(
    async (tx) =>
      Number(
        (await tx.query<{ count: string }>('select count(*)::text as count from schedule_change'))
          .rows[0]!.count,
      ),
  );
}
