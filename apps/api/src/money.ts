/**
 * Geld (Abschnitt 3.10) und Vertragsspiegel (3.9).
 *
 * Der Kern ist eine einzige Aussage: **Eine Zahlung ist keine Frage des
 * Vertrauens, sondern eine Frage des Baufortschritts.** Freigegeben wird
 * erst, wenn die dahinterliegenden Vorgänge fertig sind und kein wesentlicher
 * Mangel daran hängt. Und wenn nicht, sagt die Oberfläche nicht „geht nicht",
 * sondern was fehlt.
 *
 * Die Sperre selbst steht in der Datenbank (`mbl.guard_payment_release`), aus
 * demselben Grund wie alles andere: Eine Sperre, die nur die Ansicht kennt,
 * ist keine. Hier steht, was die Ansicht braucht, um sie zu erklären.
 */

import { HTTPException } from 'hono/http-exception';
import type { Transaction } from '@meinbaulotse/db';
import type { IsoDate } from '@meinbaulotse/schedule';
import type {
  ContractMirror,
  LoanDrawdownDto,
  MoneyView,
  PaymentMilestoneDto,
  ChangeOrderDto,
} from '@meinbaulotse/shared';
import {
  checkContract,
  commitmentInterest,
  DESCRIPTION_ITEMS,
  type ContractFacts,
} from './contract-rules.js';

type Tx = Pick<Transaction, 'query'>;

export async function loadPayments(
  tx: Tx,
  projectId: string,
): Promise<PaymentMilestoneDto[]> {
  const result = await tx.query<{
    id: string;
    name: string;
    pct: string | null;
    amount_cents: string | null;
    requires_task_ids: string[];
    invoice_number: string | null;
    invoice_date: string | null;
    due_date: string | null;
    status: PaymentMilestoneDto['status'];
    released_at: string | null;
    paid_at: string | null;
    withheld_cents: string | null;
    withheld_reason: string | null;
    sort_order: number;
    blockers: { kind: string; label: string }[] | null;
  }>(
    `select p.id, p.name, p.pct, p.amount_cents, p.requires_task_ids, p.invoice_number,
            p.invoice_date, p.due_date, p.status::text as status, p.released_at, p.paid_at,
            p.withheld_cents, p.withheld_reason, p.sort_order,
            (select coalesce(json_agg(json_build_object('kind', b.kind, 'label', b.label)), '[]')
               from mbl.payment_blockers(p.id) b) as blockers
       from payment_milestone p
      where p.project_id = $1
      order by p.sort_order, p.due_date nulls last`,
    [projectId],
  );

  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    pct: row.pct === null ? null : Number(row.pct),
    amountCents: row.amount_cents === null ? null : Number(row.amount_cents),
    requiresTaskIds: row.requires_task_ids,
    invoiceNumber: row.invoice_number,
    invoiceDate: row.invoice_date,
    dueDate: row.due_date,
    status: row.status,
    releasedAt: row.released_at === null ? null : new Date(row.released_at).toISOString(),
    paidAt: row.paid_at === null ? null : new Date(row.paid_at).toISOString(),
    withheldCents: row.withheld_cents === null ? null : Number(row.withheld_cents),
    withheldReason: row.withheld_reason,
    blockers: row.blockers ?? [],
  }));
}

export async function loadChangeOrders(tx: Tx, projectId: string): Promise<ChangeOrderDto[]> {
  const result = await tx.query<{
    id: string;
    title: string;
    trigger_text: string | null;
    bgb_basis: string | null;
    amount_cents: string | null;
    days_impact: number | null;
    status: ChangeOrderDto['status'];
    requested_at: string;
    agreed_at: string | null;
  }>(
    `select id, title, trigger_text, bgb_basis, amount_cents, days_impact,
            status::text as status, requested_at, agreed_at
       from change_order where project_id = $1 order by requested_at desc`,
    [projectId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    title: row.title,
    triggerText: row.trigger_text,
    bgbBasis: row.bgb_basis,
    amountCents: row.amount_cents === null ? null : Number(row.amount_cents),
    daysImpact: row.days_impact,
    status: row.status,
    requestedAt: new Date(row.requested_at).toISOString(),
    agreedAt: row.agreed_at === null ? null : new Date(row.agreed_at).toISOString(),
  }));
}

/**
 * Die Zahlung freigeben.
 *
 * Der Anwendungscode prüft **nicht** noch einmal, was die Datenbank prüft. Er
 * fängt nur den Fehler ab und formuliert ihn: Zwei Stellen mit derselben
 * Regel laufen früher oder später auseinander, und dann gilt die schwächere.
 */
export async function releasePayment(
  tx: Tx,
  projectId: string,
  paymentId: string,
  body: { withheldCents?: number; withheldReason?: string },
): Promise<PaymentMilestoneDto> {
  const teilweise = body.withheldCents !== undefined && body.withheldCents > 0;

  try {
    const result = await tx.query(
      `update payment_milestone
          set status = $3::mbl.payment_status,
              released_by = mbl.current_member_id($2),
              released_at = now(),
              withheld_cents = $4,
              withheld_reason = $5
        where id = $1 and project_id = $2`,
      [
        paymentId,
        projectId,
        teilweise ? 'teilfreigabe' : 'freigegeben',
        teilweise ? body.withheldCents! : null,
        teilweise ? (body.withheldReason ?? null) : null,
      ],
    );
    if (result.rowCount === 0) {
      throw new HTTPException(404, { message: 'Diese Zahlung gibt es nicht.' });
    }
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    const meldung = error instanceof Error ? error.message : '';
    if (meldung.includes('noch nicht freizugeben')) {
      throw new HTTPException(409, {
        message: meldung.replace(/^.*?:\s*/, 'Diese Zahlung ist noch nicht freizugeben: '),
        cause: {
          hint: 'Du kannst einen Teil unter Vorbehalt freigeben und den Rest einbehalten.',
        },
      });
    }
    throw error;
  }

  const alle = await loadPayments(tx, projectId);
  const eine = alle.find((zahlung) => zahlung.id === paymentId);
  if (eine === undefined) throw new HTTPException(404, { message: 'Diese Zahlung gibt es nicht.' });
  return eine;
}

async function loadLoans(tx: Tx, projectId: string): Promise<LoanDrawdownDto[]> {
  const result = await tx.query<{
    id: string;
    label: string | null;
    amount_cents: string;
    requested_at: string;
    paid_at: string | null;
  }>(
    `select id, label, amount_cents, requested_at, paid_at
       from loan_drawdown where project_id = $1 order by requested_at`,
    [projectId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    label: row.label,
    amountCents: Number(row.amount_cents),
    requestedAt: row.requested_at,
    paidAt: row.paid_at,
  }));
}

/**
 * Der Vertragsspiegel: Regeln anwenden, Befunde fortschreiben.
 *
 * Fortschreiben und nicht neu schreiben: Ein Befund, den jemand mit
 * Begründung beiseitegelegt hat, bleibt beiseitegelegt. Sonst wäre der
 * „Erledigt"-Knopf eine Lüge, die bis zum nächsten Laden hält.
 */
export async function refreshContractChecks(
  tx: Tx,
  projectId: string,
): Promise<ContractMirror> {
  const kopf = await tx.query<{
    contract_type: string;
    contract_sum_cents: string | null;
    contractual_completion: string | null;
    security_pct: string | null;
  }>(
    `select contract_type::text as contract_type, contract_sum_cents,
            contractual_completion, security_pct
       from project where id = $1`,
    [projectId],
  );
  const p = kopf.rows[0];
  if (p === undefined) {
    throw new HTTPException(404, { message: 'Dieses Bauvorhaben gibt es nicht.' });
  }

  const anteile = await tx.query<{ pct: string | null }>(
    'select pct from payment_milestone where project_id = $1',
    [projectId],
  );
  const nachtraege = await tx.query<{ summe: string | null }>(
    `select sum(amount_cents)::text as summe from change_order
      where project_id = $1 and status = 'vereinbart'`,
    [projectId],
  );
  const punkte = await tx.query<{ item_key: string; present: boolean }>(
    'select item_key, present from contract_description_item where project_id = $1',
    [projectId],
  );

  const gesehen = new Map(punkte.rows.map((row) => [row.item_key, row.present]));
  const fehlend = DESCRIPTION_ITEMS.filter((punkt) => gesehen.get(punkt.key) !== true).map(
    (punkt) => punkt.label,
  );

  const facts: ContractFacts = {
    contractType: p.contract_type,
    contractSumCents: p.contract_sum_cents === null ? null : Number(p.contract_sum_cents),
    contractualCompletion: p.contractual_completion,
    securityPct: p.security_pct === null ? null : Number(p.security_pct),
    milestonePcts: anteile.rows
      .map((row) => (row.pct === null ? null : Number(row.pct)))
      .filter((wert): wert is number => wert !== null),
    agreedChangeOrderCents: Number(nachtraege.rows[0]?.summe ?? 0),
    descriptionReviewed: punkte.rowCount ?? 0,
    descriptionMissing: fehlend,
  };

  const befunde = checkContract(facts);

  for (const befund of befunde) {
    await tx.query(
      `insert into contract_check (project_id, rule_key, severity, message, legal_reference)
       values ($1, $2, $3, $4, $5)
       on conflict (project_id, rule_key) do update
          set severity = excluded.severity,
              message = excluded.message,
              legal_reference = excluded.legal_reference`,
      [projectId, befund.ruleKey, befund.severity, befund.message, befund.legalReference],
    );
  }

  // Was nicht mehr zutrifft, verschwindet. Ein Befund ist eine Aussage über
  // heute, kein Eintrag in einer Sündenliste.
  await tx.query(
    `delete from contract_check
      where project_id = $1 and not (rule_key = any ($2::text[]))`,
    [projectId, befunde.map((befund) => befund.ruleKey)],
  );

  return loadContractMirror(tx, projectId);
}

export async function loadContractMirror(tx: Tx, projectId: string): Promise<ContractMirror> {
  const kopf = await tx.query<{
    contract_type: string;
    contract_sum_cents: string | null;
    contractual_completion: string | null;
    security_pct: string | null;
  }>(
    `select contract_type::text as contract_type, contract_sum_cents,
            contractual_completion, security_pct
       from project where id = $1`,
    [projectId],
  );
  const p = kopf.rows[0];
  if (p === undefined) {
    throw new HTTPException(404, { message: 'Dieses Bauvorhaben gibt es nicht.' });
  }

  const befunde = await tx.query<{
    id: string;
    rule_key: string;
    severity: string;
    message: string;
    legal_reference: string | null;
    dismissed_at: string | null;
    dismissed_reason: string | null;
  }>(
    `select id, rule_key, severity, message, legal_reference, dismissed_at, dismissed_reason
       from contract_check where project_id = $1 order by severity, rule_key`,
    [projectId],
  );

  const punkte = await tx.query<{ item_key: string; present: boolean; note: string | null }>(
    'select item_key, present, note from contract_description_item where project_id = $1',
    [projectId],
  );
  const gesehen = new Map(punkte.rows.map((row) => [row.item_key, row]));

  return {
    contractType: p.contract_type,
    contractSumCents: p.contract_sum_cents === null ? null : Number(p.contract_sum_cents),
    contractualCompletion: p.contractual_completion,
    securityPct: p.security_pct === null ? null : Number(p.security_pct),
    findings: befunde.rows.map((row) => ({
      id: row.id,
      ruleKey: row.rule_key,
      severity: row.severity,
      message: row.message,
      legalReference: row.legal_reference,
      dismissedAt: row.dismissed_at === null ? null : new Date(row.dismissed_at).toISOString(),
      dismissedReason: row.dismissed_reason,
    })),
    descriptionItems: DESCRIPTION_ITEMS.map((punkt) => ({
      key: punkt.key,
      label: punkt.label,
      present: gesehen.get(punkt.key)?.present ?? false,
      note: gesehen.get(punkt.key)?.note ?? null,
      reviewed: gesehen.has(punkt.key),
    })),
  };
}

/** Alles, was die Geldansicht braucht — in einem Zug. */
export async function loadMoneyView(
  tx: Tx,
  projectId: string,
  today: IsoDate,
): Promise<MoneyView> {
  const kopf = await tx.query<{
    contract_sum_cents: string | null;
    loan_total_cents: string | null;
    commitment_interest_pct: string | null;
    commitment_free_months: number | null;
    planned_start: string;
  }>(
    `select contract_sum_cents, loan_total_cents, commitment_interest_pct,
            commitment_free_months, planned_start
       from project where id = $1`,
    [projectId],
  );
  const p = kopf.rows[0];
  if (p === undefined) {
    throw new HTTPException(404, { message: 'Dieses Bauvorhaben gibt es nicht.' });
  }

  // Nacheinander, nicht mit Promise.all: Alle drei Abfragen laufen auf
  // derselben Verbindung, und ein pg-Client führt keine zwei Abfragen
  // gleichzeitig aus. Nebenläufig sieht es schneller aus und ist es nicht —
  // es ist nur ein Fehler, der noch nicht aufgefallen ist.
  const payments = await loadPayments(tx, projectId);
  const changeOrders = await loadChangeOrders(tx, projectId);
  const drawdowns = await loadLoans(tx, projectId);

  const zinsen =
    p.loan_total_cents === null || p.commitment_interest_pct === null
      ? null
      : commitmentInterest({
          totalCents: Number(p.loan_total_cents),
          pctPerYear: Number(p.commitment_interest_pct),
          freeMonths: p.commitment_free_months ?? 0,
          from: p.planned_start,
          until: today,
          drawdowns: drawdowns.map((abruf) => ({
            amountCents: abruf.amountCents,
            date: abruf.requestedAt,
          })),
        });

  const freigegeben = payments
    .filter((zahlung) => zahlung.status === 'freigegeben' || zahlung.status === 'teilfreigabe' || zahlung.status === 'bezahlt')
    .reduce((summe, zahlung) => summe + (zahlung.amountCents ?? 0) - (zahlung.withheldCents ?? 0), 0);

  return {
    contractSumCents: p.contract_sum_cents === null ? null : Number(p.contract_sum_cents),
    releasedCents: freigegeben,
    payments,
    changeOrders,
    drawdowns,
    loan:
      p.loan_total_cents === null
        ? null
        : {
            totalCents: Number(p.loan_total_cents),
            drawnCents: drawdowns.reduce((summe, abruf) => summe + abruf.amountCents, 0),
            interestPct: p.commitment_interest_pct === null ? null : Number(p.commitment_interest_pct),
            freeMonths: p.commitment_free_months,
            commitmentInterestCents: zinsen?.cents ?? null,
            commitmentDays: zinsen?.days ?? null,
          },
  };
}
