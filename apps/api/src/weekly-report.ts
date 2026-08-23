/**
 * Der Wochenbericht (Abschnitt 3.11).
 *
 * „Dieser Bericht ist der Retention-Anker und gehört ins MVP." Das ist der
 * Satz aus der Spezifikation, und er beschreibt genau, warum es ihn gibt: Eine
 * Anwendung, die man aufsuchen muss, wird nicht aufgesucht. Ein Bauherr öffnet
 * seinen Terminplan nicht jeden Montag von selbst — aber er liest eine Mail,
 * in der steht, was diese Woche passiert und was er dafür tun muss.
 *
 * Die sechs Blöcke stehen in der Reihenfolge aus 3.11, und die ist dieselbe
 * wie im Cockpit: erst wo ihr steht, dann was kommt, dann was **du** tun
 * musst, dann erst, was schiefgeht.
 *
 * Gebaut wird der Bericht **unter den Rechten des Lesenden** — dieselbe
 * Transaktion, dieselben Policies wie jede andere Abfrage. Ein Bericht, der
 * mehr sieht als der Empfänger, wäre ein Leck mit Zustellung.
 */

import {
  workdayDifference,
  type Calendar,
  type IsoDate,
} from '@meinbaulotse/schedule';
import { HTTPException } from 'hono/http-exception';
import type { Transaction } from '@meinbaulotse/db';
import type {
  WeeklyReport,
  WeeklyReportChange,
  WeeklyReportDecision,
  WeeklyReportPhoto,
  WeeklyReportTask,
} from '@meinbaulotse/shared';

type Tx = Pick<Transaction, 'query'>;

/** Kalendertage, die der Bericht nach vorn schaut. */
const VORSCHAU_TAGE = 7;

/** Kalendertage, die er zurückblickt — seit dem letzten Bericht. */
const RUECKBLICK_TAGE = 7;

function plusDays(date: IsoDate, days: number): IsoDate {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/**
 * Der erste Satz der Karte, als Kurzfassung.
 *
 * Nicht die ganze Karte: Der Bericht soll neugierig machen und nicht ersetzen,
 * was in der Anwendung steht. Abgeschnitten wird am Satzende, nicht nach
 * Zeichenzahl — ein mitten im Wort endender Text sieht kaputt aus.
 */
export function ersterSatz(text: string): string {
  const bereinigt = text.replace(/\s+/g, ' ').trim();
  const punkt = bereinigt.search(/[.!?](\s|$)/);
  return punkt === -1 ? bereinigt : bereinigt.slice(0, punkt + 1);
}

export async function buildWeeklyReport(
  tx: Tx,
  projectId: string,
  today: IsoDate,
): Promise<WeeklyReport> {
  const project = await tx.query<{
    id: string;
    name: string;
    federal_state: Calendar['federalState'];
    catholic_municipality: boolean;
    contractual_completion: string | null;
  }>(
    `select id, name, federal_state, catholic_municipality, contractual_completion
       from project where id = $1`,
    [projectId],
  );
  const head = project.rows[0];
  if (head === undefined) {
    throw new HTTPException(404, { message: 'Dieses Bauvorhaben gibt es nicht.' });
  }

  const calendar: Calendar = {
    federalState: head.federal_state,
    catholicMunicipality: head.catholic_municipality,
  };
  const weekEnd = plusDays(today, VORSCHAU_TAGE);
  const seit = plusDays(today, -RUECKBLICK_TAGE);

  // 1. Diese Woche auf der Baustelle -----------------------------------------
  //
  // „Start oder Ende in den nächsten 7 Tagen" plus alles, was gerade läuft:
  // Ein Vorgang, der letzte Woche begann und nächste Woche endet, gehört
  // hierher — sonst fehlt in der Woche ausgerechnet das, was gerade passiert.
  const tasks = await tx.query<{
    id: string;
    name: string;
    trade_name: string | null;
    current_start: string | null;
    current_end: string | null;
    is_wait: boolean;
    is_milestone: boolean;
    guide_title: string | null;
    guide_summary: string | null;
  }>(
    `select t.id, t.name, tr.name as trade_name, t.current_start, t.current_end,
            t.is_wait, t.is_milestone,
            guide.title as guide_title, guide.whats_happening as guide_summary
       from task t
       left join trade tr on tr.id = t.trade_id
       left join lateral (
         select gc.title, gc.whats_happening
           from guide_card gc
          where gc.published_at is not null
            and gc.superseded_by is null
            and t.template_task_code is not null
            and t.template_task_code = any (gc.template_task_codes)
          order by gc.version desc
          limit 1
       ) guide on true
      where t.project_id = $1
        and t.status <> 'entfallen'
        and t.current_start is not null
        and (
              (t.current_start between $2 and $3)
           or (t.current_end   between $2 and $3)
           or (t.current_start <= $2 and t.current_end >= $3)
        )
      order by t.current_start, t.sort_order`,
    [projectId, today, weekEnd],
  );

  const thisWeek: WeeklyReportTask[] = tasks.rows.map((row) => ({
    id: row.id,
    name: row.name,
    tradeName: row.trade_name,
    start: row.current_start,
    end: row.current_end,
    isWait: row.is_wait,
    isMilestone: row.is_milestone,
    guideCardTitle: row.guide_title,
    guideCardSummary: row.guide_summary === null ? null : ersterSatz(row.guide_summary),
  }));

  // 2. Was du entscheiden musst ----------------------------------------------
  const decisions = await tx.query<{
    id: string;
    title: string;
    due_date: string | null;
    blocks_task_name: string | null;
  }>(
    `select d.id, d.title, d.due_date, t.name as blocks_task_name
       from decision d
       left join task t on t.id = d.blocks_task_id
      where d.project_id = $1
        and d.status in ('offen','in_bemusterung')
      order by d.due_date nulls last
      limit 8`,
    [projectId],
  );

  const offeneEntscheidungen: WeeklyReportDecision[] = decisions.rows.map((row) => ({
    id: row.id,
    title: row.title,
    dueDate: row.due_date,
    remainingWorkdays:
      row.due_date === null ? null : workdayDifference(today, row.due_date, calendar),
    blocksTaskName: row.blocks_task_name,
  }));

  // 3. Was sich verschoben hat ------------------------------------------------
  //
  // Nur Termine, nicht jedes Feld: Ein Statuswechsel von „terminiert" auf
  // „läuft" ist keine Verschiebung, und die Liste soll kurz bleiben.
  const changes = await tx.query<{
    task_name: string | null;
    field: string;
    old_value: string | null;
    new_value: string | null;
    reason_code: string | null;
    reason_text: string | null;
    actor_role: WeeklyReportChange['actorRole'];
    created_at: string;
  }>(
    `select t.name as task_name, c.field,
            c.old_value #>> '{}' as old_value, c.new_value #>> '{}' as new_value,
            c.reason_code, c.reason_text, c.actor_role, c.created_at
       from schedule_change c
       left join task t on t.id = c.task_id
      where c.project_id = $1
        and c.field in ('current_start','current_end')
        and c.created_at >= $2::date
        and c.old_value is not null
      order by c.created_at desc
      limit 20`,
    [projectId, seit],
  );

  const verschiebungen: WeeklyReportChange[] = changes.rows.map((row) => ({
    taskName: row.task_name,
    field: row.field,
    from: row.old_value,
    to: row.new_value,
    reason: row.reason_code,
    reasonText: row.reason_text,
    actorRole: row.actor_role,
    changedAt: new Date(row.created_at).toISOString(),
  }));

  // 4. Prognose ---------------------------------------------------------------
  const ende = await tx.query<{ computed_end: string | null }>(
    `select max(current_end)::text as computed_end from task
      where project_id = $1 and status <> 'entfallen'`,
    [projectId],
  );
  const computedEnd = ende.rows[0]?.computed_end ?? null;
  const contractualEnd = head.contractual_completion;
  const deviationWorkdays =
    computedEnd === null || contractualEnd === null
      ? null
      : workdayDifference(contractualEnd, computedEnd, calendar);

  // 5. Fotos, die jetzt fällig sind -------------------------------------------
  //
  // Aus den Fotoaufträgen der Karten zu den Vorgängen dieser Woche. Das ist
  // der stille Held aus Abschnitt 3.1: Wer beim Rohbau nicht fotografiert, wo
  // die Leitungen liegen, bohrt sechs Jahre später hinein.
  const photos = await tx.query<{ task_name: string; prompt: { what: string; why: string } }>(
    `select t.name as task_name, prompt
       from task t
       join lateral (
         select gc.photo_prompts
           from guide_card gc
          where gc.published_at is not null
            and gc.superseded_by is null
            and t.template_task_code is not null
            and t.template_task_code = any (gc.template_task_codes)
          order by gc.version desc
          limit 1
       ) guide on true
       cross join lateral jsonb_array_elements(guide.photo_prompts) as prompt
      where t.project_id = $1
        and t.status <> 'entfallen'
        and t.current_start is not null
        and t.current_start <= $3
        and (t.current_end is null or t.current_end >= $2)
      order by t.current_start
      limit 6`,
    [projectId, today, weekEnd],
  );

  const fotos: WeeklyReportPhoto[] = photos.rows.map((row) => ({
    taskName: row.task_name,
    what: row.prompt.what,
    why: row.prompt.why,
  }));

  // Wo ihr steht: die Phase, in der das heutige Datum liegt.
  const phase = await tx.query<{ name: string; ordinal: number; total: string }>(
    `with grenzen as (
       select ph.key, ph.name, ph.ordinal,
              min(t.current_start) as beginn, max(t.current_end) as ende
         from task t join phase ph on ph.key = t.phase_key
        where t.project_id = $1 and t.status <> 'entfallen'
        group by ph.key, ph.name, ph.ordinal
     )
     select name, ordinal, (select count(*)::text from grenzen) as total
       from grenzen
      where $2::date between beginn and ende
      order by ordinal
      limit 1`,
    [projectId, today],
  );
  const phaseRow = phase.rows[0];

  return {
    project: { id: head.id, name: head.name },
    weekStart: today,
    weekEnd,
    phase:
      phaseRow === undefined
        ? null
        : { name: phaseRow.name, ordinal: phaseRow.ordinal, total: Number(phaseRow.total) },
    thisWeek,
    decisions: offeneEntscheidungen,
    changes: verschiebungen,
    forecast: { computedEnd, contractualEnd, deviationWorkdays },
    photos: fotos,
    // Block 6 kommt mit den Zahlungsmeilensteinen aus AP 8.
    money: null,
  };
}
