/**
 * Der Wochenbericht — Abschnitt 3.11 der Spezifikation.
 *
 * Montag früh, sechs Blöcke, in dieser Reihenfolge: was diese Woche auf der
 * Baustelle passiert, was du entscheiden musst, was sich verschoben hat, wie
 * die Prognose steht, was jetzt fotografiert gehört, und was als Nächstes zu
 * zahlen ist.
 *
 * Die Reihenfolge ist dieselbe wie im Cockpit und aus demselben Grund: erst wo
 * wir stehen, dann was **du** tun musst, dann erst, was schiefgeht. Ein
 * Bericht, der mit der Verzugsliste anfängt, wird nach dem dritten Montag
 * ungelesen weggeklickt.
 *
 * ## Was hier zusammenkommt
 *
 * Der Bericht erfindet nichts. Er ist die Zusammenfassung dessen, was die
 * Anwendung ohnehin weiß — Termine aus AP 1, Lotsenkarten aus AP 2,
 * Entscheidungsfristen aus AP 3, Verschiebungen aus der Historie. Genau
 * deshalb steht er hier und nicht früher: Vor AP 3 hätte er aus zwei Blöcken
 * bestanden.
 *
 * ## Warum eine Gruppierung nach Handlung
 *
 * Eine einzige Verschiebung erzeugt einen Historieneintrag je bewegtem
 * Vorgang — bei sieben Folgevorgängen sind das vierzehn Zeilen mit demselben
 * Grund. Im Bericht steht stattdessen eine Zeile je **Handlung**: „Fliesen und
 * sechs weitere, Lieferzeit, zehn Werktage später". Die Einzelheiten stehen im
 * Plan; der Bericht ist eine Nachricht, kein Protokollauszug.
 */

import {
  addDays,
  compareDates,
  workdayDifference,
  type Calendar,
  type IsoDate,
} from '@meinbaulotse/schedule';
import { HTTPException } from 'hono/http-exception';
import type { Transaction } from '@meinbaulotse/db';
import type { WeeklyReport } from '@meinbaulotse/shared';

type Tx = Pick<Transaction, 'query'>;

/** Der Bericht blickt sieben Tage voraus und sieben Tage zurück. */
export const REPORT_WINDOW_DAYS = 7;

/**
 * Die Kurzfassung einer Lotsenkarte: der erste Satz.
 *
 * Im Bericht steht kein ganzer Redaktionstext. Wer mehr wissen will, öffnet
 * die Karte — dort steht sie vollständig, mit Quellen.
 */
export function firstSentence(text: string): string {
  const treffer = /^[\s\S]*?[.!?](?=\s|$)/.exec(text.trim());
  return (treffer === null ? text.trim() : treffer[0]).trim();
}

export async function buildWeeklyReport(
  tx: Tx,
  projectId: string,
  on: IsoDate,
): Promise<WeeklyReport> {
  const project = await tx.query<{
    id: string;
    name: string;
    federal_state: Calendar['federalState'];
    catholic_municipality: boolean;
    contractual_completion: string | null;
  }>(
    `select p.id, p.name, p.federal_state, p.catholic_municipality, p.contractual_completion
       from project p
       join project_member m on m.project_id = p.id
         and m.user_id = mbl.current_user_id()
         and m.revoked_at is null
      where p.id = $1`,
    [projectId],
  );
  const kopf = project.rows[0];
  if (kopf === undefined) {
    throw new HTTPException(404, { message: 'Dieses Bauvorhaben gibt es nicht.' });
  }

  const calendar: Calendar = {
    federalState: kopf.federal_state,
    catholicMunicipality: kopf.catholic_municipality,
  };
  const bis = addDays(on, REPORT_WINDOW_DAYS);
  const seit = addDays(on, -REPORT_WINDOW_DAYS);

  return {
    projectId: kopf.id,
    projectName: kopf.name,
    generatedFor: on,
    thisWeek: await loadThisWeek(tx, projectId, on, bis),
    decisions: await loadDecisions(tx, projectId, on, calendar),
    shifted: await loadShifts(tx, projectId, seit),
    forecast: await loadForecast(tx, projectId, kopf.contractual_completion, calendar),
    photoPrompts: await loadPhotoPrompts(tx, projectId, on, bis),
    // Block sechs aus Abschnitt 3.11. Zahlungsmeilensteine kommen mit AP 8;
    // bis dahin steht hier offen, dass er fehlt, statt ihn wegzulassen — ein
    // stillschweigend fehlender Block sieht aus wie „nichts zu zahlen".
    money: {
      available: false,
      note: 'Zahlungen und Abrufe kommen mit dem Vertragsspiegel. Bis dahin behältst du sie selbst im Blick.',
    },
  };
}

/** Block 1: Vorgänge mit Beginn oder Ende in den nächsten sieben Tagen. */
async function loadThisWeek(
  tx: Tx,
  projectId: string,
  on: IsoDate,
  bis: IsoDate,
): Promise<WeeklyReport['thisWeek']> {
  const result = await tx.query<{
    id: string;
    name: string;
    trade_name: string | null;
    current_start: string;
    current_end: string;
    starts: boolean;
    ends: boolean;
    guide_card_id: string | null;
    guide_card_title: string | null;
    whats_happening: string | null;
  }>(
    `select t.id, t.name, tr.name as trade_name, t.current_start, t.current_end,
            (t.current_start between $2 and $3) as starts,
            (t.current_end   between $2 and $3) as ends,
            c.id as guide_card_id, c.title as guide_card_title, c.whats_happening
       from task t
       left join trade tr on tr.id = t.trade_id
       left join guide_card c on c.id = t.guide_card_id
      where t.project_id = $1
        and t.status <> 'entfallen'
        and (t.current_start between $2 and $3 or t.current_end between $2 and $3)
      order by t.current_start, t.sort_order`,
    [projectId, on, bis],
  );

  return result.rows.map((row) => ({
    taskId: row.id,
    name: row.name,
    tradeName: row.trade_name,
    start: row.current_start,
    end: row.current_end,
    starts: row.starts,
    ends: row.ends,
    guideCard:
      row.guide_card_id === null || row.whats_happening === null
        ? null
        : {
            id: row.guide_card_id,
            title: row.guide_card_title ?? '',
            summary: firstSentence(row.whats_happening),
          },
  }));
}

/** Block 2: offene Entscheidungen nach Frist, mit Restlaufzeit in Werktagen. */
async function loadDecisions(
  tx: Tx,
  projectId: string,
  on: IsoDate,
  calendar: Calendar,
): Promise<WeeklyReport['decisions']> {
  const result = await tx.query<{
    id: string;
    title: string;
    due_date: string;
    task_name: string | null;
  }>(
    `select d.id, d.title, d.due_date, t.name as task_name
       from decision d
       left join task t on t.id = d.blocks_task_id
      where d.project_id = $1
        and d.status in ('offen','in_bemusterung')
        and d.due_date is not null
      order by d.due_date`,
    [projectId],
  );

  return result.rows.map((row) => ({
    id: row.id,
    title: row.title,
    blocksTaskName: row.task_name,
    dueDate: row.due_date,
    remainingWorkdays: workdayDifference(on, row.due_date, calendar),
    isOverdue: compareDates(row.due_date, on) < 0,
  }));
}

/**
 * Block 3: was sich seit der letzten Woche verschoben hat — eine Zeile je
 * Handlung, nicht je bewegtem Vorgang.
 *
 * Gruppiert wird über `created_at`: Alle Einträge einer Transaktion tragen
 * denselben Zeitstempel, weil `now()` in Postgres die Transaktionszeit ist.
 * Damit fällt die Fortpflanzung einer Verschiebung ohne Zusatzspalte zu einer
 * Zeile zusammen.
 */
async function loadShifts(
  tx: Tx,
  projectId: string,
  seit: IsoDate,
): Promise<WeeklyReport['shifted']> {
  const result = await tx.query<{
    at: string;
    reason_code: string | null;
    reason_text: string | null;
    actor_role: string | null;
    effect_days: number | null;
    task_names: string[];
  }>(
    `select sc.created_at as at, sc.reason_code, sc.reason_text, sc.actor_role,
            max(sc.effect_days_on_completion) as effect_days,
            array_agg(distinct t.name) as task_names
       from schedule_change sc
       join task t on t.id = sc.task_id
      where sc.project_id = $1
        and sc.created_at >= $2::date
        and sc.field = 'current_start'
        and sc.reason_code is distinct from 'planinitialisierung'
      group by sc.created_at, sc.reason_code, sc.reason_text, sc.actor_role
      order by sc.created_at desc
      limit 10`,
    [projectId, seit],
  );

  return result.rows.map((row) => ({
    at: row.at,
    reasonCode: row.reason_code,
    reasonText: row.reason_text,
    actorRole: row.actor_role,
    effectWorkdays: row.effect_days,
    taskNames: row.task_names,
  }));
}

/** Block 4: geschuldet gegen errechnet. */
async function loadForecast(
  tx: Tx,
  projectId: string,
  contractualEnd: string | null,
  calendar: Calendar,
): Promise<WeeklyReport['forecast']> {
  const result = await tx.query<{ computed_end: string | null }>(
    'select max(current_end)::text as computed_end from task where project_id = $1',
    [projectId],
  );
  const computedEnd = result.rows[0]?.computed_end ?? null;

  return {
    contractualEnd,
    computedEnd,
    deviationWorkdays:
      contractualEnd === null || computedEnd === null
        ? null
        : workdayDifference(contractualEnd, computedEnd, calendar),
  };
}

/**
 * Block 5: Fotoaufträge der Vorgänge, die jetzt laufen oder anstehen.
 *
 * Der stille Held aus Abschnitt 3.1: Wer beim Rohbau nicht fotografiert, wo
 * die Leitungen liegen, bohrt sechs Jahre später hinein. Im Bericht steht der
 * Auftrag, die Erfassung kommt mit AP 5.
 */
async function loadPhotoPrompts(
  tx: Tx,
  projectId: string,
  on: IsoDate,
  bis: IsoDate,
): Promise<WeeklyReport['photoPrompts']> {
  const result = await tx.query<{
    task_id: string;
    task_name: string;
    photo_prompts: { key: string; what: string; why: string | null }[];
  }>(
    `select t.id as task_id, t.name as task_name, c.photo_prompts
       from task t
       join guide_card c on c.id = t.guide_card_id
      where t.project_id = $1
        and t.status <> 'entfallen'
        and jsonb_array_length(c.photo_prompts) > 0
        and t.current_start <= $3
        and t.current_end >= $2
      order by t.current_start, t.sort_order`,
    [projectId, on, bis],
  );

  return result.rows.flatMap((row) =>
    row.photo_prompts.map((prompt) => ({
      taskId: row.task_id,
      taskName: row.task_name,
      key: prompt.key,
      what: prompt.what,
      why: prompt.why,
    })),
  );
}
