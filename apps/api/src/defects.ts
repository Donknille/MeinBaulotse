/**
 * Mängel — Abschnitt 8 der Arbeitspakete, „Mängelverfolgung mit Fristen und
 * Eskalationsstufen".
 *
 * Ein Mangel ist im Kern eine einfache Zeile: was, wo, wie schlimm, bis wann.
 * Zwei Dinge machen ihn zu etwas, das man führen muss statt bloß zu notieren.
 *
 * **Die Frist.** Ein Mangel ohne Frist ist eine Beschwerde. Erst die Frist
 * macht daraus etwas, worauf sich der Bauherr berufen kann — und erst die
 * verstrichene Frist macht daraus etwas, das ihn zum Handeln zwingt. Deshalb
 * rechnet die Anwendung die *vorgeschlagene* Eskalationsstufe aus dem Kalender
 * und speichert daneben, wo der Bauherr tatsächlich steht. Die beiden
 * auseinanderzuhalten ist der Unterschied zwischen einer Erinnerung und einer
 * Behauptung.
 *
 * **Die Schwere.** Nur ein *wesentlicher* Mangel sperrt eine Zahlung
 * (Abschnitt 3.10). Bei einem Kratzer in der Fensterbank wäre das
 * unverhältnismäßig — und eine Anwendung, die es trotzdem täte, würde umgangen
 * statt benutzt.
 */

import { HTTPException } from 'hono/http-exception';
import type { Transaction } from '@meinbaulotse/db';
import {
  suggestedEscalation,
  type DefectCreateRequest,
  type DefectDto,
  type DefectUpdateRequest,
} from '@meinbaulotse/shared';

type Tx = Pick<Transaction, 'query'>;

interface DefectRow {
  id: string;
  title: string;
  description: string | null;
  location_text: string | null;
  severity: DefectDto['severity'];
  status: DefectDto['status'];
  task_id: string | null;
  task_name: string | null;
  trade_name: string | null;
  reported_at: Date;
  reported_by: string | null;
  deadline: string | null;
  escalation_level: number;
  resolved_at: Date | null;
  reserved_at_handover: boolean;
  media_count: string;
}

export async function listDefects(tx: Tx, projectId: string, today: string): Promise<DefectDto[]> {
  const result = await tx.query<DefectRow>(
    `select d.id, d.title, d.description, d.location_text, d.severity::text as severity,
            d.status::text as status, d.task_id, t.name as task_name, tr.name as trade_name,
            d.reported_at, rb.display_name as reported_by, d.deadline, d.escalation_level,
            d.resolved_at, d.reserved_at_handover,
            (select count(*)::text from media m where m.defect_id = d.id) as media_count
       from defect d
       left join task t on t.id = d.task_id
       left join trade tr on tr.id = d.trade_id
       left join project_member rb on rb.id = d.reported_by
      where d.project_id = $1
      -- Offene zuerst, darunter die wesentlichen, darunter die mit der
      -- ältesten Frist. Wer die Liste öffnet, sieht oben, was drängt.
      order by (d.status in ('behoben','abgelehnt')),
               (d.severity = 'geringfuegig'),
               d.deadline nulls last,
               d.reported_at`,
    [projectId],
  );

  return result.rows.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    locationText: row.location_text,
    severity: row.severity,
    status: row.status,
    taskId: row.task_id,
    taskName: row.task_name,
    tradeName: row.trade_name,
    reportedAt: row.reported_at.toISOString(),
    reportedBy: row.reported_by,
    deadline: row.deadline,
    escalationLevel: row.escalation_level,
    suggestedEscalation: suggestedEscalation(row.deadline, row.status, today),
    resolvedAt: row.resolved_at === null ? null : row.resolved_at.toISOString(),
    reservedAtHandover: row.reserved_at_handover,
    mediaCount: Number(row.media_count),
  }));
}

export async function createDefect(
  tx: Tx,
  projectId: string,
  request: DefectCreateRequest,
  today: string,
): Promise<DefectDto[]> {
  await tx
    .query(
      `insert into defect
         (project_id, task_id, trade_id, title, description, location_text, severity,
          deadline, reported_by)
       values ($1, $2, (select trade_id from task where id = $2), $3, $4, $5,
               $6::mbl.defect_severity, $7::date, mbl.current_member_id($1))`,
      [
        projectId,
        request.taskId ?? null,
        request.title,
        request.description ?? null,
        request.locationText ?? null,
        request.severity,
        request.deadline ?? null,
      ],
    )
    .catch(uebersetze('In deiner Rolle lässt sich hier kein Mangel erfassen.'));

  return listDefects(tx, projectId, today);
}

export async function updateDefect(
  tx: Tx,
  projectId: string,
  defectId: string,
  change: DefectUpdateRequest,
  today: string,
): Promise<DefectDto[]> {
  const felder: string[] = [];
  const werte: unknown[] = [defectId, projectId];
  const setze = (spalte: string, wert: unknown, cast = ''): void => {
    werte.push(wert);
    felder.push(`${spalte} = $${werte.length}${cast}`);
  };

  if (change.status !== undefined) setze('status', change.status, '::mbl.defect_status');
  if (change.severity !== undefined) setze('severity', change.severity, '::mbl.defect_severity');
  if (change.deadline !== undefined) setze('deadline', change.deadline, '::date');
  if (change.escalationLevel !== undefined) setze('escalation_level', change.escalationLevel);
  if (change.reservedAtHandover !== undefined) {
    setze('reserved_at_handover', change.reservedAtHandover);
  }
  if (felder.length === 0) return listDefects(tx, projectId, today);

  const result = await tx
    .query(`update defect set ${felder.join(', ')} where id = $1 and project_id = $2`, werte)
    .catch(uebersetze('Das darf deine Rolle an diesem Mangel nicht ändern.'));

  if (result.rowCount === 0) {
    throw new HTTPException(404, { message: 'Diesen Mangel gibt es hier nicht.' });
  }
  return listDefects(tx, projectId, today);
}

/**
 * Übersetzt die Ablehnung der Datenbank.
 *
 * Der Trigger `mbl.guard_defect_resolution` spricht in ganzen Sätzen — „Ob ein
 * Mangel behoben ist, entscheidet der Bauherr. Melde ihn als behoben, dann
 * sieht er nach." Dieser Satz ist für den Nutzer geschrieben und wird
 * durchgereicht; nur wo keiner dasteht, tritt der allgemeine an seine Stelle.
 */
function uebersetze(fallback: string): (cause: unknown) => never {
  return (cause: unknown): never => {
    const fehler = cause as { code?: string; message?: string } | null;
    if (fehler?.code === '42501') {
      throw new HTTPException(403, { message: fehler.message ?? fallback });
    }
    throw cause;
  };
}
