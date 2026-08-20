/**
 * Aufbau einer Testlage für die RLS-Prüfungen.
 *
 * Zwei Projekte, in jedem ein Mitglied je Rolle. Damit lässt sich beides
 * prüfen: was eine Rolle im eigenen Projekt darf, und dass sie im fremden
 * Projekt nichts sieht.
 */

import { withAdminTx, type Transaction } from './client.js';
import type { MemberRole } from './permissions.js';

export interface Actor {
  userId: string;
  memberId: string;
  role: MemberRole;
}

export interface ProjectFixture {
  projectId: string;
  ownerUserId: string;
  actors: Record<MemberRole, Actor>;
  /** Vorgang des Gewerks „fliesen" — Prüfstein für die Zeilenschärfe. */
  tileTaskId: string;
  /** Vorgang des Gewerks „maler" — für dasselbe Gewerk nicht erreichbar. */
  paintTaskId: string;
  tileTradeId: string;
}

const ROLES: readonly MemberRole[] = [
  'owner',
  'co_owner',
  'contractor',
  'trade',
  'expert',
  'viewer',
];

async function createUser(tx: Transaction, email: string): Promise<string> {
  const result = await tx.query<{ id: string }>(
    'insert into auth.users (email) values ($1) returning id',
    [email],
  );
  return result.rows[0]!.id;
}

export async function createProjectFixture(prefix: string): Promise<ProjectFixture> {
  return withAdminTx(async (tx) => {
    const tradeIds = await tx.query<{ id: string; code: string }>(
      "select id, code from trade where project_id is null and code in ('fliesen','maler')",
    );
    const tileTradeId = tradeIds.rows.find((row) => row.code === 'fliesen')!.id;
    const paintTradeId = tradeIds.rows.find((row) => row.code === 'maler')!.id;

    const ownerUserId = await createUser(tx, `${prefix}-owner@example.test`);

    const project = await tx.query<{ id: string }>(
      `insert into project (name, federal_state, build_type, contract_type, planned_start, created_by)
       values ($1, 'BY', 'efh_massiv', 'verbraucherbauvertrag', date '2026-04-01', $2)
       returning id`,
      [`${prefix} Musterweg 4`, ownerUserId],
    );
    const projectId = project.rows[0]!.id;

    // Ein Mandantenbüro, über das der expert eingebunden wird.
    const org = await tx.query<{ id: string }>(
      'insert into expert_org (name, slug, created_by) values ($1, $2, $3) returning id',
      [`${prefix} Baubegleitung`, `${prefix}-baubegleitung`, ownerUserId],
    );
    const orgId = org.rows[0]!.id;

    const actors = {} as Record<MemberRole, Actor>;
    for (const role of ROLES) {
      const userId =
        role === 'owner' ? ownerUserId : await createUser(tx, `${prefix}-${role}@example.test`);

      if (role === 'expert') {
        await tx.query(
          'insert into expert_org_member (org_id, user_id, is_admin) values ($1, $2, true)',
          [orgId, userId],
        );
      }

      const member = await tx.query<{ id: string }>(
        `insert into project_member
           (project_id, user_id, role, display_name, trade_id, expert_org_id, accepted_at)
         values ($1, $2, $3, $4, $5, $6, now())
         returning id`,
        [
          projectId,
          userId,
          role,
          `${prefix} ${role}`,
          role === 'trade' ? tileTradeId : null,
          role === 'expert' ? orgId : null,
        ],
      );
      actors[role] = { userId, memberId: member.rows[0]!.id, role };
    }

    const tile = await tx.query<{ id: string }>(
      `insert into task (project_id, trade_id, name, phase_key, duration_days,
                         current_start, current_end, sort_order)
       values ($1, $2, 'Fliesenarbeiten', 'endausbau', 8, date '2026-09-09', date '2026-09-18', 10)
       returning id`,
      [projectId, tileTradeId],
    );
    const paint = await tx.query<{ id: string }>(
      `insert into task (project_id, trade_id, name, phase_key, duration_days,
                         current_start, current_end, sort_order)
       values ($1, $2, 'Malerarbeiten', 'endausbau', 8, date '2026-09-21', date '2026-09-30', 20)
       returning id`,
      [projectId, paintTradeId],
    );

    await tx.query(
      'insert into dependency (project_id, predecessor_id, successor_id) values ($1, $2, $3)',
      [projectId, tile.rows[0]!.id, paint.rows[0]!.id],
    );

    return {
      projectId,
      ownerUserId,
      actors,
      tileTaskId: tile.rows[0]!.id,
      paintTaskId: paint.rows[0]!.id,
      tileTradeId,
    };
  });
}

/** Löscht alle Testdaten, ohne das Schema anzufassen. */
export async function truncateAll(): Promise<void> {
  await withAdminTx(async (tx) => {
    await tx.query(`
      truncate schedule_change, audit_log, dependency, task, project_member, project,
               expert_org_member, expert_org restart identity cascade
    `);
    await tx.query('delete from trade where project_id is not null');
    await tx.query('delete from auth.users');
  });
}
