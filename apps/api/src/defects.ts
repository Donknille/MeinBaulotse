/**
 * Mängel (Abschnitt 3.10, Rechtematrix 2.2).
 *
 * Ein Mangel ist in diesem Produkt kein Vorwurf, sondern eine Beobachtung mit
 * Datum. Deshalb heißt das Feld `title` und nicht `Beanstandung`, deshalb hat
 * jeder Zustand einen nächsten Schritt, und deshalb gibt es `strittig`: Zwei
 * Seiten sehen es unterschiedlich, und das festzuhalten ist etwas anderes,
 * als zu entscheiden, wer recht hat.
 *
 * Die Eskalationsstufen sind der eigentliche Nutzen. Ein Bauherr weiß nicht,
 * dass eine Mängelbeseitigung eine **Frist** braucht, bevor irgendein Recht
 * daraus wird — und dass ohne diese Frist auch nach zwei Jahren Ärger nichts
 * durchsetzbar ist. Die Leiter sagt bei jedem Schritt, was jetzt dran ist und
 * welche Stelle dazu gehört. Sie berät nicht; sie zeigt den Weg und wo er
 * endet.
 */

import { HTTPException } from 'hono/http-exception';
import type { Transaction } from '@meinbaulotse/db';
import type { IsoDate } from '@meinbaulotse/schedule';
import type { DefectDto, DefectStep, DefectUpdateRequest } from '@meinbaulotse/shared';

type Tx = Pick<Transaction, 'query'>;

/**
 * Die Leiter.
 *
 * Fünf Stufen, und zwischen Stufe 1 und 2 liegt der Unterschied zwischen
 * „geärgert" und „durchsetzbar".
 */
export const DEFECT_STEPS: readonly DefectStep[] = [
  {
    level: 0,
    title: 'Festgehalten',
    next: 'Zeig den Mangel dem Unternehmen an — schriftlich, mit Foto und Datum.',
    detail:
      'Eine mündliche Bemerkung auf der Baustelle ist später nicht belegbar. Eine Mail mit '
      + 'Foto ist es. Beschreib, was du siehst, nicht was du vermutest.',
    reference: null,
  },
  {
    level: 1,
    title: 'Angezeigt',
    next: 'Setz eine Frist zur Beseitigung. Ohne Frist entsteht kein Recht.',
    detail:
      'Zwei bis drei Wochen sind bei den meisten Mängeln angemessen. Erst wenn diese Frist '
      + 'fruchtlos verstreicht, stehen dir die Rechte aus § 634 BGB offen: Selbstvornahme, '
      + 'Minderung, Rücktritt, Schadensersatz.',
    reference: '§ 634 BGB, § 637 BGB',
  },
  {
    level: 2,
    title: 'Frist läuft',
    next: 'Warte die Frist ab. Was in der Zeit passiert, gehört ins Bautagebuch.',
    detail:
      'Wenn das Unternehmen die Beseitigung ankündigt, halt den Termin fest. Wenn es die '
      + 'Beseitigung ablehnt, ist die Frist damit erledigt — dann geht es weiter, ohne '
      + 'sie abzuwarten.',
    reference: null,
  },
  {
    level: 3,
    title: 'Frist abgelaufen',
    next: 'Jetzt hast du die Wahl — und für jede Möglichkeit brauchst du Beratung.',
    detail:
      'Selbstvornahme auf Kosten des Unternehmens (§ 637 BGB), Minderung (§ 638 BGB) oder ein '
      + 'Einbehalt in Höhe des doppelten Beseitigungsaufwands (§ 641 Abs. 3 BGB). Welcher Weg '
      + 'richtig ist, hängt an Betrag, Vertrag und Beweislage. Das ist der Punkt, an dem sich '
      + 'ein Fachanwalt für Bau- und Architektenrecht rechnet.',
    reference: '§ 637 BGB, § 638 BGB, § 641 Abs. 3 BGB',
  },
  {
    level: 4,
    title: 'In fachlicher Klärung',
    next: 'Sachverständiger oder Anwalt ist eingeschaltet. Halt die Akte vollständig.',
    detail:
      'Ab hier arbeitet jemand anderes an der Sache, und das Wertvollste, was du beitragen '
      + 'kannst, ist eine lückenlose Dokumentation: Fotos mit Datum, Schriftverkehr, '
      + 'Fristsetzungen. Die Bauakte exportiert genau das.',
    reference: null,
  },
];

/** Wie viele Werktage eine Frist üblicherweise läuft, wenn keiner sie nennt. */
export const DEFAULT_DEADLINE_DAYS = 14;

function zeile(row: {
  id: string;
  task_id: string | null;
  task_name: string | null;
  trade_id: string | null;
  trade_name: string | null;
  title: string;
  description: string | null;
  location_text: string | null;
  severity: 'geringfuegig' | 'wesentlich';
  reported_at: string;
  deadline: string | null;
  status: DefectDto['status'];
  escalation_level: number;
  resolved_at: string | null;
  accepted_at: string | null;
  reserved_at_handover: boolean;
  reported_by_name: string | null;
  photo_count: string;
}): DefectDto {
  return {
    id: row.id,
    taskId: row.task_id,
    taskName: row.task_name,
    tradeId: row.trade_id,
    tradeName: row.trade_name,
    title: row.title,
    description: row.description,
    locationText: row.location_text,
    severity: row.severity,
    reportedAt: new Date(row.reported_at).toISOString(),
    deadline: row.deadline,
    status: row.status,
    escalationLevel: row.escalation_level,
    resolvedAt: row.resolved_at === null ? null : new Date(row.resolved_at).toISOString(),
    acceptedAt: row.accepted_at === null ? null : new Date(row.accepted_at).toISOString(),
    reservedAtHandover: row.reserved_at_handover,
    reportedByName: row.reported_by_name,
    photoCount: Number(row.photo_count),
    step: DEFECT_STEPS[Math.min(row.escalation_level, DEFECT_STEPS.length - 1)]!,
  };
}

const SELECT = `
  select d.id, d.task_id, t.name as task_name, d.trade_id, tr.name as trade_name,
         d.title, d.description, d.location_text, d.severity::text as severity,
         d.reported_at, d.deadline, d.status::text as status, d.escalation_level,
         d.resolved_at, d.accepted_at, d.reserved_at_handover,
         m.display_name as reported_by_name,
         (select count(*) from media md where md.defect_id = d.id) as photo_count
    from defect d
    left join task t on t.id = d.task_id
    left join trade tr on tr.id = d.trade_id
    left join project_member m on m.id = d.reported_by`;

export async function loadDefects(tx: Tx, projectId: string): Promise<DefectDto[]> {
  const result = await tx.query<Parameters<typeof zeile>[0]>(
    `${SELECT}
      where d.project_id = $1
      order by (d.status in ('behoben','zurueckgestellt')), d.severity desc,
               d.deadline nulls last, d.reported_at`,
    [projectId],
  );
  return result.rows.map(zeile);
}

async function einer(tx: Tx, projectId: string, defectId: string): Promise<DefectDto> {
  const result = await tx.query<Parameters<typeof zeile>[0]>(
    `${SELECT} where d.id = $1 and d.project_id = $2`,
    [defectId, projectId],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new HTTPException(404, { message: 'Diesen Mangel gibt es nicht.' });
  }
  return zeile(row);
}

export async function createDefect(
  tx: Tx,
  projectId: string,
  body: {
    title: string;
    description?: string;
    locationText?: string;
    severity?: 'geringfuegig' | 'wesentlich';
    taskId?: string;
    tradeId?: string;
    deadline?: string;
  },
): Promise<DefectDto> {
  const angelegt = await tx.query<{ id: string }>(
    `insert into defect (project_id, task_id, trade_id, title, description, location_text,
                         severity, deadline, reported_by)
     values ($1, $2, $3, $4, $5, $6, coalesce($7::mbl.defect_severity, 'geringfuegig'), $8,
             mbl.current_member_id($1))
     returning id`,
    [
      projectId,
      body.taskId ?? null,
      body.tradeId ?? null,
      body.title,
      body.description ?? null,
      body.locationText ?? null,
      body.severity ?? null,
      body.deadline ?? null,
    ],
  );
  if (angelegt.rowCount === 0) {
    throw new HTTPException(403, {
      message: 'Mängel erfasst der Bauherr — oder ein Sachverständiger.',
    });
  }
  return einer(tx, projectId, angelegt.rows[0]!.id);
}

/**
 * Den Stand ändern.
 *
 * Die Stufe folgt aus dem, was passiert, statt von Hand gesetzt zu werden:
 * Wer eine Frist einträgt, steht auf Stufe 2, und wenn sie verstrichen ist,
 * auf Stufe 3. Eine Stufe, die jemand selbst wählt, sagt nichts über den
 * Stand der Sache — nur darüber, wie jemand sich fühlt.
 */
export async function updateDefect(
  tx: Tx,
  projectId: string,
  defectId: string,
  change: DefectUpdateRequest,
  today: IsoDate,
): Promise<DefectDto> {
  const vorher = await einer(tx, projectId, defectId);

  const status = change.status ?? vorher.status;
  const deadline = change.deadline === undefined ? vorher.deadline : change.deadline;
  const angezeigt = change.reportedToContractor === true || vorher.escalationLevel >= 1;

  const stufe = ((): number => {
    if (status === 'behoben' || status === 'zurueckgestellt') return vorher.escalationLevel;
    if (change.escalationLevel !== undefined) return change.escalationLevel;
    if (status === 'strittig') return 3;
    if (deadline !== null && deadline < today) return 3;
    if (deadline !== null) return 2;
    if (angezeigt) return 1;
    return 0;
  })();

  await tx.query(
    `update defect
        set title = coalesce($3, title),
            description = coalesce($4, description),
            location_text = coalesce($5, location_text),
            severity = coalesce($6::mbl.defect_severity, severity),
            deadline = $7,
            status = $8::mbl.defect_status,
            escalation_level = $9,
            reserved_at_handover = coalesce($10, reserved_at_handover),
            resolved_at = case when $8 = 'behoben' and resolved_at is null then now()
                               when $8 <> 'behoben' then null else resolved_at end,
            accepted_at = case when $8 = 'anerkannt' and accepted_at is null then now()
                               else accepted_at end
      where id = $1 and project_id = $2`,
    [
      defectId,
      projectId,
      change.title ?? null,
      change.description ?? null,
      change.locationText ?? null,
      change.severity ?? null,
      deadline,
      status,
      stufe,
      change.reservedAtHandover ?? null,
    ],
  );

  if (change.note !== undefined && change.note.trim() !== '') {
    await tx.query(
      `insert into defect_event (defect_id, project_id, action, note, actor_member_id, actor_role)
       select $1, $2, 'notiz', $3, m.id, m.role
         from project_member m where m.id = mbl.current_member_id($2)`,
      [defectId, projectId, change.note.trim()],
    );
  }

  return einer(tx, projectId, defectId);
}

export interface DefectEventDto {
  id: string;
  action: string;
  note: string | null;
  oldStatus: string | null;
  newStatus: string | null;
  actorName: string | null;
  actorRole: string | null;
  createdAt: string;
}

export async function loadDefectEvents(
  tx: Tx,
  projectId: string,
  defectId: string,
): Promise<DefectEventDto[]> {
  const result = await tx.query<{
    id: string;
    action: string;
    note: string | null;
    old_status: string | null;
    new_status: string | null;
    actor_name: string | null;
    actor_role: string | null;
    created_at: string;
  }>(
    `select e.id, e.action, e.note, e.old_status::text as old_status,
            e.new_status::text as new_status, m.display_name as actor_name,
            e.actor_role::text as actor_role, e.created_at
       from defect_event e
       left join project_member m on m.id = e.actor_member_id
      where e.defect_id = $1 and e.project_id = $2
      order by e.created_at`,
    [defectId, projectId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    action: row.action,
    note: row.note,
    oldStatus: row.old_status,
    newStatus: row.new_status,
    actorName: row.actor_name,
    actorRole: row.actor_role,
    createdAt: new Date(row.created_at).toISOString(),
  }));
}
