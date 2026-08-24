/**
 * Vertragsspiegel, Zahlungen und Finanzierung — Abschnitte 3.9 und 3.10.
 *
 * Der Vertragsspiegel ist die eine Ansicht, in der Termin, Geld und Mängel
 * zusammenkommen. Er beantwortet drei Fragen, die ein Bauherr sonst an drei
 * Stellen suchen müsste: Was habe ich vereinbart? Was ist fällig? Und was
 * spricht dagegen, es zu zahlen?
 *
 * Die dritte ist die teuerste. Die Sperre selbst steht als Trigger in der
 * Datenbank (`mbl.guard_payment_release`); hier steht, wie die Oberfläche
 * **vorher** sagen kann, was fehlt — denn eine Sperre, die erst beim Klicken
 * zuschlägt, ist eine Falle und keine Hilfe.
 */

import { HTTPException } from 'hono/http-exception';
import type { Transaction } from '@meinbaulotse/db';
import { commitmentInterest, delayCostInCommitmentInterest } from '@meinbaulotse/schedule';
import type {
  CommitmentInterestDto,
  ContractFinding,
  ContractMirror,
  ContractUpdateRequest,
  FinancingDto,
  LoanDrawdownDto,
  PaymentMilestoneDto,
  PaymentUpdateRequest,
} from '@meinbaulotse/shared';
import { CONTRACT_RULE_KEYS, runContractChecks, type ContractFacts } from './contract-rules.js';

type Tx = Pick<Transaction, 'query'>;

/**
 * Der Grund, mit dem die Anwendung selbst einen Hinweis abräumt.
 *
 * Er unterscheidet ihn von einem, den der Bauherr weggeklickt hat — und genau
 * daran hängt, ob der Hinweis wiederkommt, wenn er wieder zutrifft.
 */
const AUTOMATISCH_ABGERAEUMT = 'trifft nicht mehr zu';

// ---------------------------------------------------------------------------
// Der Zahlungsplan
// ---------------------------------------------------------------------------

/**
 * Legt den Zahlungsplan aus der Vorlage an — einmal, sobald eine Vertragssumme
 * feststeht.
 *
 * Warum nicht beim Anlegen des Bauvorhabens: Das Onboarding stellt fünf Fragen,
 * und keine davon ist „was kostet es". Ein Zahlungsplan aus lauter Nullen wäre
 * eine Ansicht, die man wegklickt, statt sie zu füllen.
 *
 * Warum nicht bei jeder Änderung neu: Sobald eine Rate freigegeben ist, ist der
 * Plan Geschichte und keine Vorlage mehr. Wer die Summe später korrigiert,
 * korrigiert die Beträge — nicht den Plan.
 */
export async function ensurePaymentPlan(tx: Tx, projectId: string): Promise<void> {
  const vorhanden = await tx.query<{ anzahl: string }>(
    'select count(*)::text as anzahl from payment_milestone where project_id = $1',
    [projectId],
  );
  if (Number(vorhanden.rows[0]!.anzahl) > 0) return;

  const summe = await tx.query<{ contract_sum_cents: number | null }>(
    'select contract_sum_cents from project where id = $1',
    [projectId],
  );
  const gesamt = summe.rows[0]?.contract_sum_cents ?? null;
  if (gesamt === null || gesamt <= 0) return;

  await tx.query(
    `insert into payment_milestone
       (project_id, name, trigger_text, pct, amount_cents, is_retention, sort_order,
        requires_task_ids)
     select $1, v.name, v.trigger_text, v.pct,
            round($2::numeric * v.pct / 100)::bigint, v.is_retention, v.sort_order,
            coalesce((
              select array_agg(t.id)
                from task t
               where t.project_id = $1 and t.template_task_code = v.task_code
            ), '{}')
       from payment_template v
      order by v.sort_order`,
    [projectId, gesamt],
  );
}

/** Beträge nachziehen, wenn sich die Vertragssumme ändert — Prozente bleiben. */
async function repriceOpenPayments(tx: Tx, projectId: string, gesamt: number): Promise<void> {
  await tx.query(
    `update payment_milestone
        set amount_cents = round($2::numeric * pct / 100)::bigint
      where project_id = $1
        and pct is not null
        -- Was freigegeben oder bezahlt ist, bleibt stehen. Eine nachträglich
        -- geänderte Vertragssumme darf keine Rechnung umschreiben, die schon
        -- beglichen ist.
        and status in ('offen', 'faellig')`,
    [projectId, gesamt],
  );
}

interface PaymentRow {
  id: string;
  name: string;
  trigger_text: string | null;
  pct: string | null;
  amount_cents: number;
  requires_task_ids: string[];
  requires_task_names: string[] | null;
  is_retention: boolean;
  invoice_number: string | null;
  invoice_date: string | null;
  due_date: string | null;
  status: PaymentMilestoneDto['status'];
  released_at: Date | null;
  released_by: string | null;
  paid_at: string | null;
  withheld_cents: number;
  withheld_reason: string | null;
  blockers: { kind: 'task' | 'defect'; label: string }[] | null;
}

export async function loadPayments(tx: Tx, projectId: string): Promise<PaymentMilestoneDto[]> {
  const result = await tx.query<PaymentRow>(
    `select p.*,
            -- Der Name, sonst die Mailadresse. Eine Anmeldung per Magic Link
            -- bringt keinen Namen mit, und „freigegeben von —" ist in einer
            -- Bauakte die eine Zeile, die man später bräuchte.
            coalesce(rb.display_name, rb.email) as released_by,
            coalesce((select array_agg(t.name order by t.sort_order)
                        from task t where t.id = any(p.requires_task_ids)), '{}')
              as requires_task_names,
            -- Was der Freigabe im Weg steht, kommt aus derselben Funktion, die
            -- auch der Trigger benutzt. Zwei Fassungen derselben Prüfung wären
            -- die eine Stelle, an der die Oberfläche „geht" sagt und die
            -- Datenbank „geht nicht".
            (select coalesce(jsonb_agg(jsonb_build_object('kind', b.kind, 'label', b.label)), '[]')
               from mbl.payment_blockers(p.id) b) as blockers
       from payment_milestone p
       left join project_member rb on rb.id = p.released_by
      where p.project_id = $1
      order by p.sort_order`,
    [projectId],
  );

  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    triggerText: row.trigger_text,
    pct: row.pct === null ? null : Number(row.pct),
    amountCents: row.amount_cents,
    requiresTaskIds: row.requires_task_ids,
    requiresTaskNames: row.requires_task_names ?? [],
    isRetention: row.is_retention,
    invoiceNumber: row.invoice_number,
    invoiceDate: row.invoice_date,
    dueDate: row.due_date,
    status: row.status,
    releasedAt: row.released_at === null ? null : row.released_at.toISOString(),
    releasedBy: row.released_by,
    paidAt: row.paid_at,
    withheldCents: row.withheld_cents,
    withheldReason: row.withheld_reason,
    blockers: row.blockers ?? [],
  }));
}

export async function updatePayment(
  tx: Tx,
  projectId: string,
  paymentId: string,
  change: PaymentUpdateRequest,
): Promise<PaymentMilestoneDto[]> {
  const felder: string[] = [];
  const werte: unknown[] = [paymentId, projectId];
  const setze = (spalte: string, wert: unknown, cast = ''): void => {
    werte.push(wert);
    felder.push(`${spalte} = $${werte.length}${cast}`);
  };

  if (change.status !== undefined) setze('status', change.status, '::mbl.payment_status');
  if (change.invoiceNumber !== undefined) setze('invoice_number', change.invoiceNumber);
  if (change.invoiceDate !== undefined) setze('invoice_date', change.invoiceDate, '::date');
  if (change.dueDate !== undefined) setze('due_date', change.dueDate, '::date');
  if (change.paidAt !== undefined) setze('paid_at', change.paidAt, '::date');
  if (change.withheldCents !== undefined) setze('withheld_cents', change.withheldCents);
  if (change.withheldReason !== undefined) setze('withheld_reason', change.withheldReason);
  if (felder.length === 0) return loadPayments(tx, projectId);

  const result = await tx
    .query(
      `update payment_milestone set ${felder.join(', ')} where id = $1 and project_id = $2`,
      werte,
    )
    .catch((cause: unknown) => {
      const fehler = cause as { code?: string; message?: string } | null;
      // Der Trigger spricht in ganzen Sätzen und nennt sowohl das Hindernis als
      // auch den Ausweg. Der Satz ist für den Bauherren geschrieben und wird
      // deshalb durchgereicht, statt hinter „Das hat nicht geklappt" zu
      // verschwinden.
      if (fehler?.code === '42501') {
        throw new HTTPException(409, {
          message: fehler.message ?? 'Diese Rate lässt sich noch nicht freigeben.',
        });
      }
      if (fehler?.code === '23514') {
        throw new HTTPException(422, {
          message:
            'Eine Teilfreigabe braucht einen Betrag und einen Grund. Ohne beides ist sie in ' +
            'einem halben Jahr nicht mehr erklärbar.',
        });
      }
      throw cause;
    });

  if (result.rowCount === 0) {
    throw new HTTPException(404, { message: 'Diese Rate gibt es hier nicht.' });
  }
  return loadPayments(tx, projectId);
}

// ---------------------------------------------------------------------------
// Finanzierung
// ---------------------------------------------------------------------------

export async function loadFinancing(tx: Tx, projectId: string): Promise<FinancingDto | null> {
  const result = await tx.query<{
    loan_amount_cents: number | null;
    own_funds_cents: number | null;
    commitment_rate_bp: number | null;
    commitment_free_months: number | null;
    loan_granted_on: string | null;
    bank_name: string | null;
  }>('select * from financing where project_id = $1', [projectId]);

  const zeile = result.rows[0];
  if (zeile === undefined) return null;
  return {
    loanAmountCents: zeile.loan_amount_cents,
    ownFundsCents: zeile.own_funds_cents,
    commitmentRateBp: zeile.commitment_rate_bp,
    commitmentFreeMonths: zeile.commitment_free_months,
    loanGrantedOn: zeile.loan_granted_on,
    bankName: zeile.bank_name,
  };
}

export async function saveFinancing(
  tx: Tx,
  projectId: string,
  daten: FinancingDto,
): Promise<FinancingDto | null> {
  await tx.query(
    `insert into financing (project_id, loan_amount_cents, own_funds_cents,
                            commitment_rate_bp, commitment_free_months, loan_granted_on, bank_name)
     values ($1, $2, $3, $4, $5, $6::date, $7)
     on conflict (project_id) do update
       set loan_amount_cents      = excluded.loan_amount_cents,
           own_funds_cents        = excluded.own_funds_cents,
           commitment_rate_bp     = excluded.commitment_rate_bp,
           commitment_free_months = excluded.commitment_free_months,
           loan_granted_on        = excluded.loan_granted_on,
           bank_name              = excluded.bank_name`,
    [
      projectId,
      daten.loanAmountCents,
      daten.ownFundsCents,
      daten.commitmentRateBp,
      daten.commitmentFreeMonths,
      daten.loanGrantedOn,
      daten.bankName,
    ],
  );
  return loadFinancing(tx, projectId);
}

export async function loadDrawdowns(tx: Tx, projectId: string): Promise<LoanDrawdownDto[]> {
  const result = await tx.query<{
    id: string;
    amount_cents: number;
    requested_at: string;
    paid_at: string | null;
    note: string | null;
  }>(
    `select id, amount_cents, requested_at, paid_at, note
       from loan_drawdown where project_id = $1 order by requested_at`,
    [projectId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    amountCents: row.amount_cents,
    requestedAt: row.requested_at,
    paidAt: row.paid_at,
    note: row.note,
  }));
}

/**
 * Was das bereitstehende Darlehen gekostet hat — und was ein Monat mehr kostet.
 *
 * Gerechnet wird im Kern (`packages/schedule/src/interest.ts`), hier werden nur
 * die Zahlen zusammengetragen. Der Stichtag ist der errechnete Endtermin und
 * nicht heute: Interessant ist nicht, was bis jetzt aufgelaufen ist, sondern
 * was bis zur Fertigstellung auflaufen wird.
 */
export function interestFor(
  financing: FinancingDto | null,
  drawdowns: readonly LoanDrawdownDto[],
  computedEnd: string | null,
  contractualEnd: string | null,
): CommitmentInterestDto | null {
  if (
    financing === null ||
    financing.loanAmountCents === null ||
    financing.loanGrantedOn === null ||
    financing.commitmentRateBp === null
  ) {
    return null;
  }

  const eingabe = {
    loanAmountCents: financing.loanAmountCents,
    grantedOn: financing.loanGrantedOn,
    freeMonths: financing.commitmentFreeMonths ?? 0,
    ratePerYearBp: financing.commitmentRateBp,
    // Nur ausgezahlte Abrufe senken die Bereitstellungszinsen. Ein
    // angeforderter, aber nicht geflossener Abruf kostet weiter.
    drawdowns: drawdowns
      .filter((abruf) => abruf.paidAt !== null)
      .map((abruf) => ({ date: abruf.paidAt!, amountCents: abruf.amountCents })),
    until: contractualEnd ?? computedEnd ?? financing.loanGrantedOn,
  };

  const ergebnis = commitmentInterest(eingabe);
  const verzugskosten =
    contractualEnd !== null && computedEnd !== null
      ? delayCostInCommitmentInterest(eingabe, computedEnd)
      : null;

  return {
    totalCents: ergebnis.totalCents,
    chargeableFrom: ergebnis.chargeableFrom,
    undrawnAtEndCents: ergebnis.undrawnAtEndCents,
    costPerFurtherMonthCents: ergebnis.costPerFurtherMonthCents,
    delayCostCents: verzugskosten,
    segments: ergebnis.segments.map((abschnitt) => ({ ...abschnitt })),
  };
}

// ---------------------------------------------------------------------------
// Der Vertragsspiegel
// ---------------------------------------------------------------------------

async function loadFacts(tx: Tx, projectId: string): Promise<ContractFacts & { signedOn: string | null }> {
  const projekt = await tx.query<{
    contract_type: ContractFacts['contractType'];
    contractual_completion: string | null;
    build_duration_days: number | null;
    contract_sum_cents: number | null;
    security_pct: string | null;
    contract_signed_on: string | null;
    building_description_complete: boolean | null;
  }>(
    `select contract_type, contractual_completion, build_duration_days, contract_sum_cents,
            security_pct, contract_signed_on, building_description_complete
       from project where id = $1`,
    [projectId],
  );
  if (projekt.rows.length === 0) {
    throw new HTTPException(404, { message: 'Dieses Bauvorhaben gibt es nicht.' });
  }
  const zeile = projekt.rows[0]!;

  const zahlen = await tx.query<{ plan_pct: string | null; nachtraege: string }>(
    `select (select sum(pct) from payment_milestone
              where project_id = $1 and not is_retention)::text as plan_pct,
            coalesce((select sum(amount_cents) from change_order
                       where project_id = $1 and status in ('vereinbart','abgerechnet')), 0)::text
              as nachtraege`,
    [projectId],
  );

  return {
    contractType: zeile.contract_type,
    contractualCompletion: zeile.contractual_completion,
    buildDurationDays: zeile.build_duration_days,
    contractSumCents: zeile.contract_sum_cents,
    securityPct: zeile.security_pct === null ? null : Number(zeile.security_pct),
    buildingDescriptionComplete: zeile.building_description_complete,
    paymentPlanPct: Number(zahlen.rows[0]?.plan_pct ?? 0),
    changeOrderSumCents: Number(zahlen.rows[0]?.nachtraege ?? 0),
    signedOn: zeile.contract_signed_on,
  };
}

/**
 * Prüft den Vertrag und schreibt die Befunde fort.
 *
 * Gespeichert wird, nicht nur gerechnet: Der Vertragsspiegel gehört später in
 * die Bauakte, und dort zählt, was **damals** auffiel — nicht, was eine
 * spätere Fassung der Prüfregeln gefunden hätte.
 *
 * Ein einmal weggeklickter Hinweis bleibt weggeklickt, solange er zutrifft.
 * Trifft er nicht mehr zu, verschwindet er; kommt er wieder, kommt er mit
 * seiner alten Wegklick-Marke zurück — sonst wäre jede Vertragsänderung ein
 * Grund, dieselben fünf Hinweise noch einmal einzeln zu bestätigen.
 */
export async function refreshContractChecks(
  tx: Tx,
  projectId: string,
): Promise<ContractFinding[]> {
  // Fortschreiben darf nur, wer den Vertrag pflegt. Für alle anderen ist der
  // Vertragsspiegel eine Auskunft, keine Prüfung: Sie sehen, was gefunden
  // wurde, lösen aber keinen Lauf aus. Ohne diese Zeile scheitert das Lesen
  // für den Generalunternehmer an der Policy — und zwar an einer Stelle, an
  // der er gar nichts schreiben wollte.
  const darf = await tx.query<{ darf: boolean }>(
    "select mbl.has_perm($1, 'contract.write') as darf",
    [projectId],
  );
  if (darf.rows[0]?.darf !== true) return loadFindings(tx, projectId);

  const facts = await loadFacts(tx, projectId);
  const befunde = runContractChecks(facts);
  const gefunden = new Set(befunde.map((befund) => befund.ruleKey));

  for (const befund of befunde) {
    await tx.query(
      `insert into contract_check (project_id, rule_key, severity, message, legal_reference)
       values ($1, $2, $3, $4, $5)
       on conflict (project_id, rule_key) do update
         set severity = excluded.severity,
             message = excluded.message,
             legal_reference = excluded.legal_reference,
             -- Zwei Arten von „weggeklickt", und sie dürfen nicht dasselbe
             -- bedeuten: Was die Anwendung abgeräumt hat, weil es nicht mehr
             -- zutraf, kommt zurück, sobald es wieder zutrifft. Was der
             -- Bauherr selbst weggeklickt hat, bleibt weg — sonst wäre jede
             -- Vertragsänderung ein Grund, dieselben Hinweise noch einmal
             -- einzeln zu bestätigen.
             dismissed_at = case when contract_check.dismissed_reason = $6
                                 then null else contract_check.dismissed_at end,
             dismissed_reason = case when contract_check.dismissed_reason = $6
                                     then null else contract_check.dismissed_reason end`,
      [
        projectId,
        befund.ruleKey,
        befund.severity,
        befund.message,
        befund.legalReference,
        AUTOMATISCH_ABGERAEUMT,
      ],
    );
  }

  // Was nicht mehr zutrifft, verschwindet. Ein Hinweis, der stehen bleibt,
  // nachdem der Bauherr ihn abgestellt hat, erzieht zum Wegsehen.
  const ueberholt = CONTRACT_RULE_KEYS.filter((key) => !gefunden.has(key));
  if (ueberholt.length > 0) {
    await tx.query(
      `update contract_check set dismissed_at = now(), dismissed_reason = $3
        where project_id = $1 and rule_key = any($2::text[]) and dismissed_at is null`,
      [projectId, ueberholt, AUTOMATISCH_ABGERAEUMT],
    );
  }

  return loadFindings(tx, projectId);
}

async function loadFindings(tx: Tx, projectId: string): Promise<ContractFinding[]> {
  const result = await tx.query<{
    rule_key: string;
    severity: ContractFinding['severity'];
    message: string;
    legal_reference: string | null;
    dismissed_at: Date | null;
  }>(
    `select rule_key, severity, message, legal_reference, dismissed_at
       from contract_check
      where project_id = $1 and dismissed_at is null
      order by severity desc, rule_key`,
    [projectId],
  );
  return result.rows.map((row) => ({
    ruleKey: row.rule_key,
    severity: row.severity,
    message: row.message,
    legalReference: row.legal_reference,
    dismissedAt: row.dismissed_at === null ? null : row.dismissed_at.toISOString(),
  }));
}

export async function updateContract(
  tx: Tx,
  projectId: string,
  change: ContractUpdateRequest,
): Promise<void> {
  const felder: string[] = [];
  const werte: unknown[] = [projectId];
  const setze = (spalte: string, wert: unknown, cast = ''): void => {
    werte.push(wert);
    felder.push(`${spalte} = $${werte.length}${cast}`);
  };

  if (change.contractType !== undefined) {
    setze('contract_type', change.contractType, '::mbl.contract_type');
  }
  if (change.contractualCompletion !== undefined) {
    setze('contractual_completion', change.contractualCompletion, '::date');
  }
  if (change.buildDurationDays !== undefined) {
    setze('build_duration_days', change.buildDurationDays);
  }
  if (change.contractSumCents !== undefined) setze('contract_sum_cents', change.contractSumCents);
  if (change.securityPct !== undefined) setze('security_pct', change.securityPct);
  if (change.contractSignedOn !== undefined) {
    setze('contract_signed_on', change.contractSignedOn, '::date');
  }
  if (change.buildingDescriptionComplete !== undefined) {
    setze('building_description_complete', change.buildingDescriptionComplete);
  }
  if (felder.length === 0) return;

  const result = await tx
    .query(`update project set ${felder.join(', ')} where id = $1`, werte)
    .catch((cause: unknown) => {
      if ((cause as { code?: string } | null)?.code === '42501') {
        throw new HTTPException(403, {
          message: 'Vertragsdaten pflegt der Bauherr. Sprich ihn bitte an.',
        });
      }
      throw cause;
    });
  if (result.rowCount === 0) {
    throw new HTTPException(404, { message: 'Dieses Bauvorhaben gibt es nicht.' });
  }

  // Der Zahlungsplan entsteht, sobald eine Summe feststeht — und wird
  // nachgezogen, wenn sie sich ändert.
  if (change.contractSumCents !== undefined && change.contractSumCents !== null) {
    await ensurePaymentPlan(tx, projectId);
    await repriceOpenPayments(tx, projectId, change.contractSumCents);
  }
}

export async function loadContractMirror(
  tx: Tx,
  projectId: string,
  computedEnd: string | null,
): Promise<ContractMirror> {
  const facts = await loadFacts(tx, projectId);
  const financing = await loadFinancing(tx, projectId);
  const drawdowns = await loadDrawdowns(tx, projectId);

  return {
    contractType: facts.contractType,
    contractualCompletion: facts.contractualCompletion,
    buildDurationDays: facts.buildDurationDays,
    contractSumCents: facts.contractSumCents,
    securityPct: facts.securityPct,
    contractSignedOn: facts.signedOn,
    buildingDescriptionComplete: facts.buildingDescriptionComplete,
    paymentPlanPct: facts.paymentPlanPct,
    changeOrderSumCents: facts.changeOrderSumCents,
    findings: await loadFindings(tx, projectId),
    payments: await loadPayments(tx, projectId),
    financing,
    drawdowns,
    interest: interestFor(financing, drawdowns, computedEnd, facts.contractualCompletion),
  };
}
