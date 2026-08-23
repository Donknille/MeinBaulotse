/**
 * Die Abnahme von AP 8:
 *
 *   „Eine Zahlung mit offenem wesentlichen Mangel lässt sich nicht freigeben
 *    und die Oberfläche nennt die Voraussetzung. Ein Zahlungsplan mit 95 %
 *    erzeugt den Hinweis auf § 650m Abs. 1 BGB."
 *
 * Der zweite Satz ist in `contract-rules.test.ts` als reine Rechnung geprüft.
 * Hier steht der Weg durch die ganze Anwendung — samt der Frage, ob die
 * Sperre auch dann hält, wenn jemand an der Oberfläche vorbeigeht.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { closePool, withAdminTx } from '@meinbaulotse/db';
import type {
  ContractMirror,
  DefectDto,
  MoneyView,
  ProjectSchedule,
} from '@meinbaulotse/shared';
import { createApp } from './app.js';

const SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long';
process.env['SUPABASE_JWT_SECRET'] = SECRET;

const app = createApp({ lotseModel: null });

let bauherrToken: string;
let guToken: string;
let projektId: string;
let fundamentTaskId: string;
let zahlungId: string;

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

const money = async (): Promise<MoneyView> =>
  (await (await request(`/api/v1/projects/${projektId}/money`, { token: bauherrToken })).json()) as MoneyView;

beforeAll(async () => {
  await withAdminTx(async (tx) => {
    await tx.query(
      `truncate contract_check, contract_description_item, loan_drawdown, change_order,
                payment_milestone, defect_event, defect, assistant_message,
                assistant_conversation, assistant_budget, task_confirmation, guest_token,
                media, diary_entry, schedule_change, audit_log, dependency, task,
                project_member, project, expert_org_member, expert_org restart identity cascade`,
    );
    await tx.query('delete from auth.users');
  });

  const [bauherr, gu] = await withAdminTx(async (tx) => {
    const a = await tx.query<{ id: string }>(
      'insert into auth.users (email) values ($1) returning id',
      ['geld-bauherr@example.test'],
    );
    const b = await tx.query<{ id: string }>(
      'insert into auth.users (email) values ($1) returning id',
      ['geld-gu@example.test'],
    );
    return [a.rows[0]!.id, b.rows[0]!.id];
  });
  bauherrToken = await tokenFor(bauherr);
  guToken = await tokenFor(gu);

  const angelegt = await request('/api/v1/projects/onboarding', {
    method: 'POST',
    token: bauherrToken,
    body: JSON.stringify({
      name: 'Geldweg 7',
      buildType: 'efh_massiv',
      hasBasement: true,
      plannedStart: '2026-04-01',
      federalState: 'BY',
      contractType: 'verbraucherbauvertrag',
    }),
  });
  projektId = ((await angelegt.json()) as { projectId: string }).projectId;

  await withAdminTx(async (tx) =>
    tx.query(
      `insert into project_member (project_id, user_id, role, display_name)
       values ($1, $2, 'contractor', 'Jörg Baumeister')`,
      [projektId, gu],
    ),
  );

  const plan = (await (
    await request(`/api/v1/projects/${projektId}/schedule`, { token: bauherrToken })
  ).json()) as ProjectSchedule;
  fundamentTaskId = plan.tasks.find((task) => task.name.includes('Bodenplatte'))!.id;

  const erste = (await (
    await request(`/api/v1/projects/${projektId}/payments`, {
      method: 'POST',
      token: bauherrToken,
      body: JSON.stringify({
        name: 'Nach Fertigstellung der Bodenplatte',
        pct: 20,
        amountCents: 9_000_000,
        requiresTaskIds: [fundamentTaskId],
      }),
    })
  ).json()) as MoneyView;
  zahlungId = erste.payments[0]!.id;
});

afterAll(async () => {
  await closePool();
});

describe('Eine Zahlung hängt am Baufortschritt', () => {
  it('nennt den Vorgang, der noch nicht fertig ist', async () => {
    const stand = await money();
    expect(stand.payments[0]!.blockers.map((h) => h.kind)).toContain('vorgang');
    expect(stand.payments[0]!.blockers[0]!.label).toContain('Bodenplatte');
  });

  it('lässt sich nicht freigeben, solange der Vorgang läuft', async () => {
    const antwort = await request(
      `/api/v1/projects/${projektId}/payments/${zahlungId}/release`,
      { method: 'POST', token: bauherrToken, body: JSON.stringify({}) },
    );
    expect(antwort.status).toBe(409);
    const fehler = (await antwort.json()) as { error: string; details?: { hint?: string } };
    // Die Oberfläche nennt die Voraussetzung — das ist die Abnahme.
    expect(fehler.error).toContain('Bodenplatte');
    expect(fehler.details?.hint).toContain('Vorbehalt');
  });

  it('lässt sie frei, wenn der Vorgang fertig ist', async () => {
    await request(`/api/v1/projects/${projektId}/tasks/${fundamentTaskId}`, {
      method: 'PATCH',
      token: bauherrToken,
      body: JSON.stringify({ status: 'fertig' }),
    });

    const antwort = await request(
      `/api/v1/projects/${projektId}/payments/${zahlungId}/release`,
      { method: 'POST', token: bauherrToken, body: JSON.stringify({}) },
    );
    expect(antwort.status).toBe(200);
    expect(((await antwort.json()) as { status: string }).status).toBe('freigegeben');
  });
});

describe('Ein wesentlicher Mangel sperrt die Zahlung', () => {
  let mangelId: string;
  let zweiteZahlung: string;

  beforeAll(async () => {
    const stand = (await (
      await request(`/api/v1/projects/${projektId}/payments`, {
        method: 'POST',
        token: bauherrToken,
        body: JSON.stringify({
          name: 'Nach Mängelfreiheit der Bodenplatte',
          pct: 10,
          amountCents: 4_500_000,
          requiresTaskIds: [fundamentTaskId],
          sortOrder: 2,
        }),
      })
    ).json()) as MoneyView;
    zweiteZahlung = stand.payments.find((zahlung) => zahlung.name.includes('Mängelfreiheit'))!.id;

    const mangel = (await (
      await request(`/api/v1/projects/${projektId}/defects`, {
        method: 'POST',
        token: bauherrToken,
        body: JSON.stringify({
          title: 'Bodenplatte weist Risse auf',
          severity: 'wesentlich',
          taskId: fundamentTaskId,
          locationText: 'Südwestecke',
        }),
      })
    ).json()) as DefectDto;
    mangelId = mangel.id;
  });

  it('nennt den Mangel als Voraussetzung', async () => {
    const stand = await money();
    const zahlung = stand.payments.find((eintrag) => eintrag.id === zweiteZahlung)!;
    expect(zahlung.blockers.map((h) => h.kind)).toContain('mangel');
    expect(zahlung.blockers.find((h) => h.kind === 'mangel')!.label).toContain('Risse');
  });

  it('verweigert die Freigabe — die Abnahme von AP 8', async () => {
    const antwort = await request(
      `/api/v1/projects/${projektId}/payments/${zweiteZahlung}/release`,
      { method: 'POST', token: bauherrToken, body: JSON.stringify({}) },
    );
    expect(antwort.status).toBe(409);
    expect(((await antwort.json()) as { error: string }).error).toContain('Risse');
  });

  it('hält die Sperre auch dann, wenn jemand an der Anwendung vorbeigeht', async () => {
    // Eine Sperre, die nur die Ansicht kennt, ist keine. Hier schreibt der
    // Datenbankeigentümer direkt — und wird trotzdem abgewiesen.
    await expect(
      withAdminTx(async (tx) =>
        tx.query("update payment_milestone set status = 'freigegeben' where id = $1", [
          zweiteZahlung,
        ]),
      ),
    ).rejects.toThrow(/noch nicht freizugeben/);
  });

  it('lässt eine Teilfreigabe unter Vorbehalt zu', async () => {
    // Abschnitt 3.10 verlangt sie ausdrücklich: Der Bau soll nicht daran
    // stehen bleiben, dass eine Ecke gerissen ist.
    const antwort = await request(
      `/api/v1/projects/${projektId}/payments/${zweiteZahlung}/release`,
      {
        method: 'POST',
        token: bauherrToken,
        body: JSON.stringify({
          withheldCents: 1_500_000,
          withheldReason: 'Risse in der Bodenplatte, Beseitigung offen',
        }),
      },
    );
    expect(antwort.status).toBe(200);
    const zahlung = (await antwort.json()) as { status: string; withheldCents: number };
    expect(zahlung.status).toBe('teilfreigabe');
    expect(zahlung.withheldCents).toBe(1_500_000);
  });

  it('verlangt für einen Einbehalt einen Grund', async () => {
    const antwort = await request(
      `/api/v1/projects/${projektId}/payments/${zahlungId}/release`,
      {
        method: 'POST',
        token: bauherrToken,
        body: JSON.stringify({ withheldCents: 100_000 }),
      },
    );
    expect(antwort.status).toBe(422);
    expect(((await antwort.json()) as { error: string }).error).toContain('wofür');
  });

  it('gibt den Weg frei, sobald der Mangel behoben ist', async () => {
    await request(`/api/v1/projects/${projektId}/defects/${mangelId}`, {
      method: 'PATCH',
      token: bauherrToken,
      body: JSON.stringify({ status: 'behoben' }),
    });
    const stand = await money();
    const zahlung = stand.payments.find((eintrag) => eintrag.id === zweiteZahlung)!;
    expect(zahlung.blockers).toEqual([]);
  });
});

describe('Die Mängelleiter', () => {
  let mangelId: string;

  beforeAll(async () => {
    const mangel = (await (
      await request(`/api/v1/projects/${projektId}/defects`, {
        method: 'POST',
        token: bauherrToken,
        body: JSON.stringify({ title: 'Fensterbank sitzt schief', severity: 'geringfuegig' }),
      })
    ).json()) as DefectDto;
    mangelId = mangel.id;
  });

  it('beginnt bei „festgehalten" und sagt, was als Nächstes dran ist', async () => {
    const alle = (await (
      await request(`/api/v1/projects/${projektId}/defects`, { token: bauherrToken })
    ).json()) as { defects: DefectDto[] };
    const mangel = alle.defects.find((eintrag) => eintrag.id === mangelId)!;

    expect(mangel.escalationLevel).toBe(0);
    expect(mangel.step.next).toContain('schriftlich');
  });

  it('steigt auf „angezeigt", ohne dass jemand eine Zahl wählt', async () => {
    const mangel = (await (
      await request(`/api/v1/projects/${projektId}/defects/${mangelId}`, {
        method: 'PATCH',
        token: bauherrToken,
        body: JSON.stringify({ reportedToContractor: true }),
      })
    ).json()) as DefectDto;

    expect(mangel.escalationLevel).toBe(1);
    // Der eigentliche Nutzen: Ohne Frist wird aus dem Mangel kein Recht.
    expect(mangel.step.next).toContain('Frist');
    expect(mangel.step.reference).toContain('§ 637 BGB');
  });

  it('erkennt eine abgelaufene Frist von selbst', async () => {
    const mangel = (await (
      await request(`/api/v1/projects/${projektId}/defects/${mangelId}?today=2026-06-01`, {
        method: 'PATCH',
        token: bauherrToken,
        body: JSON.stringify({ deadline: '2026-05-01' }),
      })
    ).json()) as DefectDto;

    expect(mangel.escalationLevel).toBe(3);
    expect(mangel.step.detail).toContain('§ 641 Abs. 3 BGB');
    expect(mangel.step.detail).toContain('Fachanwalt');
  });

  it('schreibt jeden Schritt mit, ohne dass der Anwendungscode daran denkt', async () => {
    const verlauf = (await (
      await request(`/api/v1/projects/${projektId}/defects/${mangelId}/events`, {
        token: bauherrToken,
      })
    ).json()) as { events: { action: string; note: string | null }[] };

    expect(verlauf.events[0]!.action).toBe('erfasst');
    expect(verlauf.events.map((eintrag) => eintrag.action)).toContain('frist');
    expect(verlauf.events.map((eintrag) => eintrag.action)).toContain('stufe');
  });

  it('lässt den Verlauf nicht nachträglich ändern', async () => {
    await expect(
      withAdminTx(async (tx) =>
        tx.query("update defect_event set note = 'anders' where defect_id = $1", [mangelId]),
      ),
    ).rejects.toThrow(/append-only/i);
  });

  it('lässt den GU keinen Mangel erfassen', async () => {
    // Rechtematrix 2.2: „Mangel erfassen" hat der contractor nicht. Er darf
    // die Behebung vorschlagen, nicht den Mangel definieren.
    const antwort = await request(`/api/v1/projects/${projektId}/defects`, {
      method: 'POST',
      token: guToken,
      body: JSON.stringify({ title: 'Alles bestens hier' }),
    });
    expect(antwort.status).toBe(403);
  });
});

describe('Der Vertragsspiegel', () => {
  it('meldet den Zahlungsplan über 90 Prozent — die zweite Abnahme von AP 8', async () => {
    await request(`/api/v1/projects/${projektId}/payments`, {
      method: 'POST',
      token: bauherrToken,
      body: JSON.stringify({ name: 'Schlusszahlung', pct: 70, sortOrder: 9 }),
    });

    const spiegel = (await (
      await request(`/api/v1/projects/${projektId}/contract`, { token: bauherrToken })
    ).json()) as ContractMirror;

    const treffer = spiegel.findings.find((befund) => befund.ruleKey === 'abschlaege_ueber_90');
    expect(treffer).toBeDefined();
    expect(treffer?.legalReference).toBe('§ 650m Abs. 1 BGB');
    expect(treffer?.message).toContain('100 %');
  });

  it('nimmt einen Befund zurück, sobald er nicht mehr zutrifft', async () => {
    await request(`/api/v1/projects/${projektId}/contract`, {
      method: 'PATCH',
      token: bauherrToken,
      body: JSON.stringify({ securityPct: 5 }),
    });
    const spiegel = (await (
      await request(`/api/v1/projects/${projektId}/contract`, { token: bauherrToken })
    ).json()) as ContractMirror;
    expect(spiegel.findings.map((befund) => befund.ruleKey)).not.toContain('sicherheit_fehlt');
  });

  it('behält einen beiseitegelegten Befund beiseite', async () => {
    const vorher = (await (
      await request(`/api/v1/projects/${projektId}/contract`, { token: bauherrToken })
    ).json()) as ContractMirror;
    const befund = vorher.findings.find((eintrag) => eintrag.ruleKey === 'abschlaege_ueber_90')!;

    await request(
      `/api/v1/projects/${projektId}/contract/findings/${befund.id}/dismiss`,
      {
        method: 'POST',
        token: bauherrToken,
        body: JSON.stringify({ reason: 'Mit dem GU besprochen, Plan wird angepasst' }),
      },
    );

    // Neu prüfen — der Befund trifft weiter zu, bleibt aber beiseitegelegt.
    const nachher = (await (
      await request(`/api/v1/projects/${projektId}/contract`, { token: bauherrToken })
    ).json()) as ContractMirror;
    const derselbe = nachher.findings.find((eintrag) => eintrag.ruleKey === 'abschlaege_ueber_90');
    expect(derselbe?.dismissedAt).not.toBeNull();
    expect(derselbe?.dismissedReason).toContain('besprochen');
  });

  it('lässt den GU nicht an die Vertragsdaten', async () => {
    const antwort = await request(`/api/v1/projects/${projektId}/contract`, {
      method: 'PATCH',
      token: guToken,
      body: JSON.stringify({ contractSumCents: 1 }),
    });
    expect([403, 404]).toContain(antwort.status);
  });
});

describe('Bereitstellungszinsen', () => {
  it('rechnet auf das, was noch nicht abgerufen ist', async () => {
    await request(`/api/v1/projects/${projektId}/contract`, {
      method: 'PATCH',
      token: bauherrToken,
      body: JSON.stringify({
        loanTotalCents: 40_000_000,
        commitmentInterestPct: 3,
        commitmentFreeMonths: 0,
      }),
    });
    await withAdminTx(async (tx) =>
      tx.query(
        `insert into loan_drawdown (project_id, label, amount_cents, requested_at)
         values ($1, 'Erster Abruf', 20000000, '2026-07-01')`,
        [projektId],
      ),
    );

    const stand = (await (
      await request(`/api/v1/projects/${projektId}/money?today=2027-04-01`, {
        token: bauherrToken,
      })
    ).json()) as MoneyView;

    expect(stand.loan?.drawnCents).toBe(20_000_000);
    expect(stand.loan?.commitmentInterestCents).toBeGreaterThan(0);
  });
});
