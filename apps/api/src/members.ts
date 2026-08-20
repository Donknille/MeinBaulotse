/**
 * Beteiligte eines Projekts.
 *
 * Wer wen einladen und wessen Rolle ändern darf, steht in `role_permission`
 * und wird von den Policies auf `project_member` durchgesetzt. Hier stehen nur
 * die zwei Regeln, die keine Policy sinnvoll ausdrücken kann:
 *
 *   1. Der Bauherr ist genau einer, und seine Zeile entsteht beim Anlegen des
 *      Projekts. Eine zweite `owner`-Zeile wäre keine Einladung, sondern eine
 *      Übergabe — dafür gibt es `co_owner`.
 *   2. Die eigene Zeile lässt sich nicht entziehen. Wer das täte, sperrte sich
 *      aus seinem eigenen Projekt aus, und niemand könnte ihn zurückholen.
 */

import { HTTPException } from 'hono/http-exception';
import type { Transaction } from '@meinbaulotse/db';
import type {
  MemberInviteRequest,
  MemberUpdateRequest,
  ProjectMemberDto,
} from '@meinbaulotse/shared';

interface MemberRow {
  id: string;
  role: ProjectMemberDto['role'];
  display_name: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  trade_id: string | null;
  trade_code: string | null;
  trade_name: string | null;
  user_id: string | null;
  invited_at: Date;
  accepted_at: Date | null;
  revoked_at: Date | null;
}

function toDto(row: MemberRow, selfUserId: string): ProjectMemberDto {
  return {
    id: row.id,
    role: row.role,
    displayName: row.display_name,
    company: row.company,
    email: row.email,
    phone: row.phone,
    tradeId: row.trade_id,
    tradeCode: row.trade_code,
    tradeName: row.trade_name,
    invitedAt: row.invited_at.toISOString(),
    acceptedAt: row.accepted_at?.toISOString() ?? null,
    revokedAt: row.revoked_at?.toISOString() ?? null,
    isSelf: row.user_id === selfUserId,
    hasAccount: row.user_id !== null,
  };
}

const SELECT_MEMBERS = `
  select m.id, m.role, m.display_name, m.company, m.email, m.phone,
         m.trade_id, tr.code as trade_code, tr.name as trade_name,
         m.user_id, m.invited_at, m.accepted_at, m.revoked_at
  from project_member m
  left join trade tr on tr.id = m.trade_id
  where m.project_id = $1
  order by
    case m.role
      when 'owner' then 1 when 'co_owner' then 2 when 'contractor' then 3
      when 'expert' then 4 when 'trade' then 5 else 6 end,
    coalesce(m.display_name, m.email, '')`;

export async function listMembers(
  tx: Transaction,
  projectId: string,
  selfUserId: string,
): Promise<ProjectMemberDto[]> {
  const result = await tx.query<MemberRow>(SELECT_MEMBERS, [projectId]);
  return result.rows.map((row) => toDto(row, selfUserId));
}

async function loadOne(
  tx: Transaction,
  projectId: string,
  memberId: string,
  selfUserId: string,
): Promise<ProjectMemberDto> {
  const result = await tx.query<MemberRow>(
    `${SELECT_MEMBERS.replace('where m.project_id = $1', 'where m.project_id = $1 and m.id = $2')}`,
    [projectId, memberId],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new HTTPException(404, { message: 'Diesen Beteiligten gibt es in diesem Projekt nicht.' });
  }
  return toDto(row, selfUserId);
}

export async function inviteMember(
  tx: Transaction,
  projectId: string,
  selfUserId: string,
  input: MemberInviteRequest,
): Promise<ProjectMemberDto> {
  if (input.role === 'trade') {
    await assertTradeExists(tx, input.tradeId!);
  }

  const inserted = await tx.query<{ id: string }>(
    `insert into project_member
       (project_id, role, display_name, company, email, phone, trade_id)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning id`,
    [
      projectId,
      input.role,
      input.displayName,
      input.company ?? null,
      input.email ?? null,
      input.phone ?? null,
      input.tradeId ?? null,
    ],
  );

  await tx.query(
    `insert into audit_log (project_id, actor_channel, action, entity_type, entity_id, meta)
     values ($1, 'app', 'member.invited', 'project_member', $2, $3)`,
    [projectId, inserted.rows[0]!.id, JSON.stringify({ role: input.role })],
  );

  return loadOne(tx, projectId, inserted.rows[0]!.id, selfUserId);
}

export async function updateMember(
  tx: Transaction,
  projectId: string,
  memberId: string,
  selfUserId: string,
  input: MemberUpdateRequest,
): Promise<ProjectMemberDto> {
  const current = await loadOne(tx, projectId, memberId, selfUserId);

  if (current.role === 'owner') {
    throw new HTTPException(409, {
      message: 'Die Rolle des Bauherrn steht fest.',
      cause: {
        hint: 'Wer das Projekt übergeben will, lädt einen zweiten Bauherrn ein.',
      },
    });
  }

  const nextRole = input.role ?? current.role;
  const nextTradeId = input.tradeId === undefined ? current.tradeId : input.tradeId;

  if (nextRole === 'trade' && nextTradeId === null) {
    throw new HTTPException(422, {
      message: 'Ein Einzelgewerk braucht ein Gewerk.',
      cause: { hint: 'Ohne Gewerk wüssten wir nicht, welchen Ausschnitt diese Person sehen darf.' },
    });
  }
  if (nextTradeId !== null && nextTradeId !== current.tradeId) {
    await assertTradeExists(tx, nextTradeId);
  }

  await tx.query(
    `update project_member
        set role         = $3,
            display_name = coalesce($4, display_name),
            company      = case when $5::boolean then $6 else company end,
            email        = case when $7::boolean then $8 else email end,
            phone        = case when $9::boolean then $10 else phone end,
            trade_id     = $11
      where project_id = $1 and id = $2`,
    [
      projectId,
      memberId,
      nextRole,
      input.displayName ?? null,
      input.company !== undefined,
      input.company ?? null,
      input.email !== undefined,
      input.email ?? null,
      input.phone !== undefined,
      input.phone ?? null,
      // Ein Gewerk trägt nur, wer auch Einzelgewerk ist. Sonst bliebe nach
      // einem Rollenwechsel eine Einschränkung stehen, die niemand mehr sieht.
      nextRole === 'trade' ? nextTradeId : null,
    ],
  );

  if (input.role !== undefined && input.role !== current.role) {
    await tx.query(
      `insert into audit_log (project_id, actor_channel, action, entity_type, entity_id, meta)
       values ($1, 'app', 'member.role_changed', 'project_member', $2, $3)`,
      [projectId, memberId, JSON.stringify({ from: current.role, to: input.role })],
    );
  }

  return loadOne(tx, projectId, memberId, selfUserId);
}

export async function revokeMember(
  tx: Transaction,
  projectId: string,
  memberId: string,
  selfUserId: string,
): Promise<ProjectMemberDto> {
  const current = await loadOne(tx, projectId, memberId, selfUserId);

  if (current.isSelf) {
    throw new HTTPException(409, {
      message: 'Dich selbst kannst du nicht entfernen.',
      cause: { hint: 'Sonst käme niemand mehr in dieses Projekt hinein.' },
    });
  }
  if (current.role === 'owner') {
    throw new HTTPException(409, { message: 'Der Bauherr bleibt.' });
  }

  await tx.query(
    `update project_member set revoked_at = now()
      where project_id = $1 and id = $2 and revoked_at is null`,
    [projectId, memberId],
  );
  await tx.query(
    `insert into audit_log (project_id, actor_channel, action, entity_type, entity_id, meta)
     values ($1, 'app', 'member.revoked', 'project_member', $2, $3)`,
    [projectId, memberId, JSON.stringify({ role: current.role })],
  );

  return loadOne(tx, projectId, memberId, selfUserId);
}

async function assertTradeExists(tx: Transaction, tradeId: string): Promise<void> {
  const result = await tx.query('select 1 from trade where id = $1', [tradeId]);
  if (result.rowCount === 0) {
    throw new HTTPException(422, { message: 'Dieses Gewerk kennen wir nicht.' });
  }
}
