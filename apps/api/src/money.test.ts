/**
 * Integrationstest der Abnahme von AP 8:
 *
 * „Eine Zahlung mit offenem wesentlichen Mangel lässt sich nicht freigeben und
 *  die Oberfläche nennt die Voraussetzung. Ein Zahlungsplan mit 95 % erzeugt
 *  den Hinweis auf § 650m Abs. 1 BGB."
 *
 * Beide Sätze stehen unten. Der erste wird zweimal geprüft — einmal über die
 * API und einmal am Trigger vorbei, mit den Rechten des Eigentümers: Eine
 * Zahlungssperre, die nur der Anwendungscode kennt, ist keine.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { closePool, withAdminTx } from '@meinbaulotse/db';
import { contractMirror, type ContractMirror } from '@meinbaulotse/shared';
import { runContractChecks } from './contract-rules.js';
import { createApp } from './app.js';

const SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long';
process.env['SUPABASE_JWT_SECRET'] = SECRET;
process.env['WEATHER_API_URL'] = '';

const app = createApp();

let bauherrToken: string;
let guToken: string;
let projectId: string;

async function tokenFor(userId: string): Promise<string> {
  return new SignJWT({ sub: userId, role: 'authenticated', email: `${userId}@example.test` })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(SECRET));
}

function request(path: string, init: RequestInit & { token?: string } = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  if (init.token !== undefined) headers.set('authorization', `Bearer ${init.token}`);
  return app.request(`http://localhost${path}`, { ...init, headers });
}

async function spiegel(token = bauherrToken): Promise<ContractMirror> {
  const response = await request(`/api/v1/projects/${projectId}/contract`, { token });
  expect(response.status).toBe(200);
  return contractMirror.parse(await response.json());
}

async function vertrag(change: unknown): Promise<ContractMirror> {
  const response = await request(`/api/v1/projects/${projectId}/contract`, {
    method: 'PATCH',
    token: bauherrToken,
    body: JSON.stringify(change),
  });
  expect(response.status).toBe(200);
  return contractMirror.parse(await response.json());
}

/** Setzt alle Vorgänge einer Rate auf fertig — ohne sie ist jede Freigabe blockiert. */
async function vorgaengeFertig(rateName: string): Promise<void> {
  await withAdminTx(async (tx) => {
    await tx.query(
      `update task set status = 'fertig'
        where id in (select unnest(requires_task_ids) from payment_milestone
                      where project_id = $1 and name = $2)`,
      [projectId, rateName],
    );
  });
}

function rate(mirror: ContractMirror, name: string): ContractMirror['payments'][number] {
  const gefunden = mirror.payments.find((eintrag) => eintrag.name === name);
  if (gefunden === undefined) throw new Error(`Rate „${name}" gibt es nicht.`);
  return gefunden;
}

beforeAll(async () => {
  await withAdminTx(async (tx) => {
    await tx.query(
      `truncate contract_check, loan_drawdown, financing, payment_milestone, change_order,
                defect, assistant_message, assistant_thread, media, diary_entry, guest_token,
                schedule_change, audit_log, checklist_item, guide_card_read, decision,
                dependency, task, project_member, project, expert_org_member, expert_org
                restart identity cascade`,
    );
    await tx.query('delete from auth.users');
  });

  const [bauherr, gu] = await withAdminTx(async (tx) => {
    const result = await tx.query<{ id: string }>(
      `insert into auth.users (email)
       values ('geld@example.test'), ('geld-gu@example.test') returning id`,
    );
    return [result.rows[0]!.id, result.rows[1]!.id];
  });
  bauherrToken = await tokenFor(bauherr!);
  guToken = await tokenFor(gu!);

  const created = await request('/api/v1/projects/onboarding', {
    method: 'POST',
    token: bauherrToken,
    body: JSON.stringify({
      name: 'Musterweg 4',
      buildType: 'efh_massiv',
      hasBasement: true,
      plannedStart: '2026-04-01',
      federalState: 'BY',
      contractType: 'verbraucherbauvertrag',
      contractualCompletion: '2026-11-30',
    }),
  });
  expect(created.status).toBe(201);
  projectId = ((await created.json()) as { projectId: string }).projectId;

  await withAdminTx(async (tx) => {
    await tx.query(
      `insert into project_member (project_id, user_id, role, display_name, accepted_at)
       values ($1, $2, 'contractor', 'Bau GmbH', now())`,
      [projectId, gu],
    );
  });
});

afterAll(async () => {
  await closePool();
});

// ---------------------------------------------------------------------------

describe('Die Prüfregeln, ohne Datenbank', () => {
  const basis = {
    contractType: 'verbraucherbauvertrag',
    contractualCompletion: '2026-11-30',
    buildDurationDays: null,
    contractSumCents: 40_000_000,
    securityPct: 5,
    buildingDescriptionComplete: true,
    paymentPlanPct: 90,
    changeOrderSumCents: 0,
  } as const;

  it('schweigen, wenn alles in Ordnung ist', () => {
    // Eine Regel, die „alles in Ordnung" meldet, ist eine Regel zu viel.
    expect(runContractChecks({ ...basis })).toEqual([]);
  });

  it('nennen bei 95 % die Stelle aus § 650m Abs. 1 BGB', () => {
    const befunde = runContractChecks({ ...basis, paymentPlanPct: 95 });
    expect(befunde).toHaveLength(1);
    expect(befunde[0]!.ruleKey).toBe('abschlaege_ueber_90');
    expect(befunde[0]!.legalReference).toBe('§ 650m Abs. 1 BGB');
    expect(befunde[0]!.message).toContain('95 %');
    expect(befunde[0]!.message).toContain('90 %');
    // Hinweis, keine Bewertung (Abschnitt 3.9).
    expect(befunde[0]!.message).toContain('keine Rechtsberatung');
    expect(befunde[0]!.message).not.toContain('unwirksam');
  });

  it('schweigen bei Einzelgewerken — dort gibt es diese Grenze nicht', () => {
    const befunde = runContractChecks({
      ...basis,
      contractType: 'einzelgewerke',
      paymentPlanPct: 95,
    });
    expect(befunde.map((befund) => befund.ruleKey)).not.toContain('abschlaege_ueber_90');
  });

  it('nennen die fehlende Sicherheit mit dem Betrag, um den es geht', () => {
    const befunde = runContractChecks({ ...basis, securityPct: null });
    expect(befunde[0]!.legalReference).toBe('§ 650m Abs. 2 BGB');
    // 5 % von 400.000 € = 20.000 €.
    expect(befunde[0]!.message).toContain('20.000 €');
  });

  it('melden Nachträge über zehn Prozent', () => {
    const befunde = runContractChecks({ ...basis, changeOrderSumCents: 4_500_000 });
    expect(befunde[0]!.ruleKey).toBe('nachtraege_ueber_10');
    expect(befunde[0]!.legalReference).toBe('§ 650m Abs. 2 S. 2 BGB');
  });

  it('melden einen Vertrag ohne Termin und ohne Dauer', () => {
    const befunde = runContractChecks({
      ...basis,
      contractualCompletion: null,
      buildDurationDays: null,
    });
    expect(befunde[0]!.ruleKey).toBe('kein_fertigstellungstermin');
    expect(befunde[0]!.legalReference).toBe('§ 650k Abs. 3 BGB');
  });

  it('schweigen, wenn statt des Termins eine Bauzeit vereinbart ist', () => {
    const befunde = runContractChecks({
      ...basis,
      contractualCompletion: null,
      buildDurationDays: 300,
    });
    expect(befunde).toEqual([]);
  });

  it('melden eine unvollständige Baubeschreibung nach Art. 249 EGBGB', () => {
    const befunde = runContractChecks({ ...basis, buildingDescriptionComplete: false });
    expect(befunde[0]!.legalReference).toBe('Art. 249 § 2 EGBGB');
  });
});

describe('Der Vertragsspiegel', () => {
  it('legt den Zahlungsplan an, sobald eine Vertragssumme feststeht', async () => {
    expect((await spiegel()).payments).toHaveLength(0);

    const nachher = await vertrag({ contractSumCents: 40_000_000, securityPct: 5 });
    expect(nachher.payments).toHaveLength(9);
    // 8 Raten zu zusammen 95 % plus 5 % Einbehalt — Abschnitt 7.5.
    expect(nachher.paymentPlanPct).toBe(95);
    expect(rate(nachher, '1. Rate').amountCents).toBe(4_000_000);
    expect(rate(nachher, 'Einbehalt Sicherheit').isRetention).toBe(true);
  });

  it('erzeugt bei 95 % den Hinweis auf § 650m Abs. 1 BGB', async () => {
    // Der zweite Satz der Abnahme, über die ganze Kette: Vorlage aus 7.5,
    // Summe aus der Datenbank, Regel, gespeicherter Befund, Antwort der API.
    const mirror = await spiegel();
    const befund = mirror.findings.find((eintrag) => eintrag.ruleKey === 'abschlaege_ueber_90');
    expect(befund).toBeDefined();
    expect(befund!.legalReference).toBe('§ 650m Abs. 1 BGB');
    expect(befund!.message).toContain('95 %');
  });

  it('zieht die Beträge nach, wenn sich die Summe ändert', async () => {
    const nachher = await vertrag({ contractSumCents: 50_000_000 });
    expect(rate(nachher, '1. Rate').amountCents).toBe(5_000_000);
    expect(rate(nachher, '3. Rate').amountCents).toBe(10_000_000);
  });

  it('räumt einen Hinweis ab, sobald er nicht mehr zutrifft', async () => {
    const vorher = await spiegel();
    expect(vorher.findings.map((eintrag) => eintrag.ruleKey)).not.toContain('sicherheit_fehlt');

    const ohne = await vertrag({ securityPct: 0 });
    expect(ohne.findings.map((eintrag) => eintrag.ruleKey)).toContain('sicherheit_fehlt');

    const wieder = await vertrag({ securityPct: 5 });
    expect(wieder.findings.map((eintrag) => eintrag.ruleKey)).not.toContain('sicherheit_fehlt');
  });

  it('bleibt für das ausführende Unternehmen lesbar, aber unveränderbar', async () => {
    expect((await spiegel(guToken)).payments.length).toBeGreaterThan(0);
    const versuch = await request(`/api/v1/projects/${projectId}/contract`, {
      method: 'PATCH',
      token: guToken,
      body: JSON.stringify({ contractSumCents: 1 }),
    });
    expect([403, 404]).toContain(versuch.status);
  });
});

describe('Die Zahlungssperre', () => {
  it('nennt vorher, was der Freigabe im Weg steht', async () => {
    const erste = rate(await spiegel(), '1. Rate');
    expect(erste.blockers.length).toBeGreaterThan(0);
    expect(erste.blockers[0]!.kind).toBe('task');
    // Die Oberfläche soll sagen können, *was* fehlt — nicht nur, dass etwas
    // fehlt (Abschnitt 3.10).
    expect(erste.blockers[0]!.label.length).toBeGreaterThan(3);
  });

  it('lässt freigeben, sobald die Vorgänge fertig sind', async () => {
    await vorgaengeFertig('1. Rate');
    const erste = rate(await spiegel(), '1. Rate');
    expect(erste.blockers).toHaveLength(0);

    const response = await request(
      `/api/v1/projects/${projectId}/payments/${erste.id}`,
      {
        method: 'PATCH',
        token: bauherrToken,
        body: JSON.stringify({ status: 'freigegeben' }),
      },
    );
    expect(response.status).toBe(200);
    expect(rate(await spiegel(), '1. Rate').status).toBe('freigegeben');
    expect(rate(await spiegel(), '1. Rate').releasedBy).not.toBeNull();
  });

  it('sperrt sie wieder, sobald ein wesentlicher Mangel offen ist', async () => {
    await vorgaengeFertig('2. Rate');
    const zweite = rate(await spiegel(), '2. Rate');
    expect(zweite.blockers).toHaveLength(0);

    const taskId = zweite.requiresTaskIds[0]!;
    const gemeldet = await request(`/api/v1/projects/${projectId}/defects`, {
      method: 'POST',
      token: bauherrToken,
      body: JSON.stringify({
        title: 'Kellerwand feucht an der Nordseite',
        severity: 'wesentlich',
        taskId,
        deadline: '2026-07-01',
      }),
    });
    expect(gemeldet.status).toBe(201);

    const mitMangel = rate(await spiegel(), '2. Rate');
    expect(mitMangel.blockers.some((hindernis) => hindernis.kind === 'defect')).toBe(true);

    const versuch = await request(`/api/v1/projects/${projectId}/payments/${zweite.id}`, {
      method: 'PATCH',
      token: bauherrToken,
      body: JSON.stringify({ status: 'freigegeben' }),
    });
    expect(versuch.status).toBe(409);
    const antwort = (await versuch.json()) as { error: string };
    // Die Fehlermeldung nennt den Mangel und den Ausweg — nicht bloß „geht nicht".
    expect(antwort.error).toContain('Kellerwand feucht');
    expect(antwort.error).toContain('einbehalten');
  });

  it('lässt sich auch mit den Rechten des Eigentümers nicht umgehen', async () => {
    // Zweite Sperre: Der Trigger greift unabhängig von den vergebenen Rechten.
    // Eine Zahlungssperre, die nur der Anwendungscode kennt, ist keine.
    const zweite = rate(await spiegel(), '2. Rate');
    await expect(
      withAdminTx(async (tx) =>
        tx.query("update payment_milestone set status = 'freigegeben' where id = $1", [zweite.id]),
      ),
    ).rejects.toThrow(/lässt sich noch nicht freigeben/);
  });

  it('lässt die Teilfreigabe unter Vorbehalt zu — mit Betrag und Grund', async () => {
    const zweite = rate(await spiegel(), '2. Rate');
    const response = await request(`/api/v1/projects/${projectId}/payments/${zweite.id}`, {
      method: 'PATCH',
      token: bauherrToken,
      body: JSON.stringify({
        status: 'teilfreigabe',
        withheldCents: 500_000,
        withheldReason: 'Einbehalt wegen feuchter Kellerwand, bis behoben.',
      }),
    });
    expect(response.status).toBe(200);

    const danach = rate(await spiegel(), '2. Rate');
    expect(danach.status).toBe('teilfreigabe');
    expect(danach.withheldCents).toBe(500_000);
  });

  it('weist eine Teilfreigabe ohne Grund ab', async () => {
    await vorgaengeFertig('3. Rate');
    const dritte = rate(await spiegel(), '3. Rate');
    const response = await request(`/api/v1/projects/${projectId}/payments/${dritte.id}`, {
      method: 'PATCH',
      token: bauherrToken,
      body: JSON.stringify({ status: 'teilfreigabe', withheldCents: 100 }),
    });
    expect(response.status).toBe(422);
  });

  it('lässt das ausführende Unternehmen nichts freigeben', async () => {
    const dritte = rate(await spiegel(), '3. Rate');
    const response = await request(`/api/v1/projects/${projectId}/payments/${dritte.id}`, {
      method: 'PATCH',
      token: guToken,
      body: JSON.stringify({ status: 'freigegeben' }),
    });
    expect([403, 404]).toContain(response.status);
  });
});

describe('Mängel', () => {
  it('lassen sich vom ausführenden Unternehmen als behoben melden, nicht abhaken', async () => {
    const liste = await request(`/api/v1/projects/${projectId}/defects`, { token: guToken });
    const mangel = ((await liste.json()) as { defects: { id: string }[] }).defects[0]!;

    const gemeldet = await request(`/api/v1/projects/${projectId}/defects/${mangel.id}`, {
      method: 'PATCH',
      token: guToken,
      body: JSON.stringify({ status: 'behoben_gemeldet' }),
    });
    expect(gemeldet.status).toBe(200);

    const abgehakt = await request(`/api/v1/projects/${projectId}/defects/${mangel.id}`, {
      method: 'PATCH',
      token: guToken,
      body: JSON.stringify({ status: 'behoben' }),
    });
    expect(abgehakt.status).toBe(403);
    expect(((await abgehakt.json()) as { error: string }).error).toContain('entscheidet der Bauherr');
  });

  it('halten die Zahlung gesperrt, solange nur „behoben gemeldet" dasteht', async () => {
    // Sonst könnte das Unternehmen die Sperre selbst aufheben, indem es
    // „erledigt" sagt — und genau davor schützt sie.
    const zweite = rate(await spiegel(), '2. Rate');
    expect(zweite.blockers.some((hindernis) => hindernis.kind === 'defect')).toBe(true);
  });

  it('geben die Sperre frei, sobald der Bauherr nachgesehen hat', async () => {
    const liste = await request(`/api/v1/projects/${projectId}/defects`, { token: bauherrToken });
    const mangel = ((await liste.json()) as { defects: { id: string }[] }).defects[0]!;

    const response = await request(`/api/v1/projects/${projectId}/defects/${mangel.id}`, {
      method: 'PATCH',
      token: bauherrToken,
      body: JSON.stringify({ status: 'behoben' }),
    });
    expect(response.status).toBe(200);

    const zweite = rate(await spiegel(), '2. Rate');
    expect(zweite.blockers).toHaveLength(0);
  });

  it('schlagen aus der Frist vor, was jetzt dran wäre', async () => {
    const response = await request(
      `/api/v1/projects/${projectId}/defects?on=2026-08-01`,
      { token: bauherrToken },
    );
    const defects = (await response.json()) as {
      defects: { escalationLevel: number; suggestedEscalation: number; status: string }[];
    };
    const behoben = defects.defects.find((eintrag) => eintrag.status === 'behoben');
    // Ein behobener Mangel eskaliert nicht mehr, auch wenn die Frist verstrich.
    expect(behoben?.suggestedEscalation).toBe(0);
  });
});

describe('Bereitstellungszinsen', () => {
  it('bleiben leer, solange die Finanzierung nicht erfasst ist', async () => {
    expect((await spiegel()).interest).toBeNull();
  });

  it('rechnen, sobald Darlehen, Zusage und Satz dastehen', async () => {
    const gespeichert = await request(`/api/v1/projects/${projectId}/financing`, {
      method: 'PUT',
      token: bauherrToken,
      body: JSON.stringify({
        loanAmountCents: 40_000_000,
        ownFundsCents: 10_000_000,
        commitmentRateBp: 300,
        commitmentFreeMonths: 6,
        loanGrantedOn: '2026-03-01',
        bankName: 'Sparkasse Musterstadt',
      }),
    });
    expect(gespeichert.status).toBe(200);

    const mirror = await spiegel();
    expect(mirror.interest).not.toBeNull();
    // 400.000 € × 3 % ÷ 12 = 1.000 € je Monat, solange nichts abgerufen ist.
    expect(mirror.interest!.costPerFurtherMonthCents).toBe(100_000);
    expect(mirror.interest!.chargeableFrom).toBe('2026-09-01');
    expect(mirror.interest!.totalCents).toBeGreaterThan(0);
  });

  it('bleiben dem ausführenden Unternehmen verborgen', async () => {
    // Die Finanzierung ist die private Seite des Bauens.
    const seiner = await spiegel(guToken);
    expect(seiner.financing).toBeNull();
    expect(seiner.interest).toBeNull();
  });
});
