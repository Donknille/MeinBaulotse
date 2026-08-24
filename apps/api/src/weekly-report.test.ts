/**
 * Integrationstest der Abnahme von AP 4, zweiter Teil:
 *
 * „Die Montagsmail enthält alle sechs Blöcke aus 3.11."
 *
 * Geprüft wird an einem Bauvorhaben, das seit acht Wochen läuft — an einem
 * frisch angelegten wären fünf der sechs Blöcke leer, und ein leerer Bericht
 * beweist nichts.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { closePool, withAdminTx } from '@meinbaulotse/db';
import { addDays, workdayOffset, type Calendar } from '@meinbaulotse/schedule';
import {
  renderWeeklyReportAsText,
  weeklyReport,
  type ProjectSchedule,
  type WeeklyReport,
} from '@meinbaulotse/shared';
import { createApp } from './app.js';
import { firstSentence } from './weekly-report.js';

const SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long';
process.env['SUPABASE_JWT_SECRET'] = SECRET;

const app = createApp();
const calendar: Calendar = { federalState: 'BY', catholicMunicipality: false };

/** Ein fester Stichtag. Ein Bericht, dessen Inhalt vom Testtag abhängt, ist keine Gegenprobe. */
const START = '2026-04-01';
const STICHTAG = '2026-07-06';

let bauherrToken: string;
let fremderToken: string;
let projectId: string;
let bericht: WeeklyReport;

async function tokenFor(userId: string): Promise<string> {
  return new SignJWT({ sub: userId, role: 'authenticated', email: `${userId}@example.test` })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(SECRET));
}

async function createUser(email: string): Promise<string> {
  return withAdminTx(async (tx) => {
    const result = await tx.query<{ id: string }>(
      'insert into auth.users (email) values ($1) returning id',
      [email],
    );
    return result.rows[0]!.id;
  });
}

function request(path: string, init: RequestInit & { token?: string } = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  if (init.token !== undefined) headers.set('authorization', `Bearer ${init.token}`);
  return app.request(`http://localhost${path}`, { ...init, headers });
}

async function reportFor(on: string, token = bauherrToken): Promise<Response> {
  return request(`/api/v1/projects/${projectId}/weekly-report?on=${on}`, { token });
}

beforeAll(async () => {
  await withAdminTx(async (tx) => {
    await tx.query(
      `truncate schedule_change, audit_log, checklist_item, guide_card_read, decision,
                dependency, task, project_member, project, expert_org_member, expert_org
                restart identity cascade`,
    );
    await tx.query('delete from auth.users');
  });

  bauherrToken = await tokenFor(await createUser('bericht-bauherr@example.test'));
  fremderToken = await tokenFor(await createUser('bericht-fremder@example.test'));

  const created = await request('/api/v1/projects/onboarding', {
    method: 'POST',
    token: bauherrToken,
    body: JSON.stringify({
      name: 'Musterweg 4',
      buildType: 'efh_massiv',
      hasBasement: true,
      plannedStart: START,
      federalState: 'BY',
      contractType: 'verbraucherbauvertrag',
      contractualCompletion: '2026-10-01',
    }),
  });
  projectId = ((await created.json()) as { projectId: string }).projectId;

  // Eine Verschiebung, damit Block drei etwas zu erzählen hat.
  const plan = (await (
    await request(`/api/v1/projects/${projectId}/schedule`, { token: bauherrToken })
  ).json()) as ProjectSchedule;
  const putz = plan.tasks.find((task) => task.name.startsWith('Innenputz'))!;
  await request(`/api/v1/projects/${projectId}/tasks/${putz.id}`, {
    method: 'PATCH',
    token: bauherrToken,
    body: JSON.stringify({
      earliestStart: workdayOffset(putz.currentStart!, 5, calendar),
      reason: 'lieferzeit',
      reasonText: 'Putzmaschine erst nächste Woche frei',
    }),
  });

  const response = await reportFor(STICHTAG);
  expect(response.status).toBe(200);
  bericht = weeklyReport.parse(await response.json());
});

afterAll(async () => {
  await closePool();
});

describe('Block 1 — Diese Woche auf der Baustelle', () => {
  it('nennt die Vorgänge mit Beginn oder Ende in den nächsten sieben Tagen', () => {
    expect(bericht.thisWeek.length).toBeGreaterThan(0);
    const bis = addDays(STICHTAG, 7);
    for (const eintrag of bericht.thisWeek) {
      const trifft =
        (eintrag.start >= STICHTAG && eintrag.start <= bis) ||
        (eintrag.end >= STICHTAG && eintrag.end <= bis);
      expect(trifft, eintrag.name).toBe(true);
      expect(eintrag.starts || eintrag.ends).toBe(true);
    }
  });

  it('legt die Kurzfassung der Lotsenkarte dazu, wo es eine gibt', () => {
    const mitKarte = bericht.thisWeek.filter((eintrag) => eintrag.guideCard !== null);
    expect(mitKarte.length).toBeGreaterThan(0);
    for (const eintrag of mitKarte) {
      // Ein Satz, nicht der ganze Redaktionstext. Wer mehr will, öffnet die
      // Karte — dort steht sie vollständig, mit Quellen.
      expect(eintrag.guideCard!.summary.length).toBeGreaterThan(20);
      expect(eintrag.guideCard!.summary.split('. ')).toHaveLength(1);
    }
  });

  it('kürzt auf den ersten Satz, ohne mitten im Wort abzuschneiden', () => {
    expect(firstSentence('Erster Satz. Zweiter Satz.')).toBe('Erster Satz.');
    expect(firstSentence('Ohne Punkt am Ende')).toBe('Ohne Punkt am Ende');
    expect(firstSentence('  Mit Rand.  Und mehr. ')).toBe('Mit Rand.');
  });
});

describe('Block 2 — Was du entscheiden musst', () => {
  it('nennt die offenen Fristen, die dringendste zuerst', () => {
    expect(bericht.decisions.length).toBeGreaterThan(0);
    const fristen = bericht.decisions.map((eintrag) => eintrag.dueDate);
    expect([...fristen].sort()).toEqual(fristen);
  });

  it('rechnet die Restlaufzeit in Werktagen und markiert verstrichene', () => {
    for (const eintrag of bericht.decisions) {
      expect(eintrag.isOverdue).toBe(eintrag.dueDate < STICHTAG);
      if (eintrag.isOverdue) expect(eintrag.remainingWorkdays).toBeLessThan(0);
      else expect(eintrag.remainingWorkdays).toBeGreaterThanOrEqual(0);
    }
  });

  it('sagt, welchen Vorgang eine Entscheidung blockiert', () => {
    expect(bericht.decisions.every((eintrag) => eintrag.blocksTaskName !== null)).toBe(true);
  });
});

describe('Block 3 — Was sich verschoben hat', () => {
  it('fasst eine Verschiebung zu einer Zeile zusammen, nicht zu einer je Vorgang', () => {
    // Eine Verschiebung des Innenputzes bewegt ein gutes Dutzend Vorgänge.
    // Im Bericht steht eine Handlung, nicht vierzehn Protokollzeilen.
    expect(bericht.shifted).toHaveLength(1);
    expect(bericht.shifted[0]!.taskNames.length).toBeGreaterThan(1);
    expect(bericht.shifted[0]!.taskNames).toContain('Innenputz');
  });

  it('nennt Grund, Verursacher und die Auswirkung auf den Endtermin', () => {
    const eintrag = bericht.shifted[0]!;
    expect(eintrag.reasonCode).toBe('lieferzeit');
    expect(eintrag.reasonText).toBe('Putzmaschine erst nächste Woche frei');
    expect(eintrag.actorRole).toBe('owner');

    // Fünf Werktage verschoben, drei Werktage später fertig: Der Innenputz
    // läuft parallel zum zwei Werktage längeren Trockenbau und hat genau
    // diesen Puffer. Er schluckt die ersten zwei Tage.
    //
    // Genau deshalb steht die Zahl im Bericht und nicht die Verschiebung
    // selbst — „fünf Tage später angefangen" ist die Handlung, „drei Werktage
    // später fertig" ist die Folge, und nur die zweite interessiert.
    expect(eintrag.effectWorkdays).toBe(3);
  });

  it('lässt die Planinitialisierung weg', () => {
    // Beim Anlegen bekommt jeder der 38 Vorgänge einen Eintrag. Die sind
    // Buchhaltung, keine Nachricht.
    expect(bericht.shifted.every((eintrag) => eintrag.reasonCode !== 'planinitialisierung')).toBe(
      true,
    );
  });
});

describe('Block 4 — Prognose', () => {
  it('stellt geschuldet und errechnet nebeneinander', () => {
    expect(bericht.forecast.contractualEnd).toBe('2026-10-01');
    expect(bericht.forecast.computedEnd).not.toBeNull();
    expect(bericht.forecast.deviationWorkdays).not.toBeNull();
  });
});

describe('Block 5 — Fotos, die jetzt fällig sind', () => {
  it('nennt die Fotoaufträge der laufenden Vorgänge', () => {
    expect(bericht.photoPrompts.length).toBeGreaterThan(0);
    for (const eintrag of bericht.photoPrompts) {
      expect(eintrag.what.length).toBeGreaterThan(10);
      expect(eintrag.taskName.length).toBeGreaterThan(0);
    }
  });
});

describe('Block 6 — Geld', () => {
  it('sagt offen, dass er noch fehlt', () => {
    // Ein weggelassener Block sieht aus wie „nichts zu zahlen". Das wäre die
    // gefährlichere Auskunft.
    expect(bericht.money.available).toBe(false);
    expect(bericht.money.note.length).toBeGreaterThan(20);
  });
});

describe('Der Bericht als Text', () => {
  it('trägt alle sechs Überschriften', () => {
    const text = renderWeeklyReportAsText(bericht);
    for (const ueberschrift of [
      'Diese Woche auf der Baustelle',
      'Was du entscheiden musst',
      'Was sich verschoben hat',
      'Prognose',
      'Fotos, die jetzt fällig sind',
      'Geld',
    ]) {
      expect(text, ueberschrift).toContain(ueberschrift);
    }
  });

  it('nennt das Bauvorhaben und den Stichtag', () => {
    const text = renderWeeklyReportAsText(bericht);
    expect(text).toContain('Musterweg 4');
    expect(text).toContain(STICHTAG);
  });

  it('bleibt auch bei einem leeren Block lesbar', () => {
    const leer: WeeklyReport = {
      ...bericht,
      thisWeek: [],
      decisions: [],
      shifted: [],
      photoPrompts: [],
    };
    const text = renderWeeklyReportAsText(leer);
    expect(text).toContain('Diese Woche steht nichts an.');
    expect(text).toContain('Seit der letzten Woche hat sich nichts verschoben.');
  });
});

describe('Zugang', () => {
  it('verbirgt den Bericht vor Fremden', async () => {
    const response = await reportFor(STICHTAG, fremderToken);
    expect(response.status).toBe(404);
  });

  it('weist einen unsinnigen Stichtag ab', async () => {
    const response = await request(`/api/v1/projects/${projectId}/weekly-report?on=irgendwann`, {
      token: bauherrToken,
    });
    expect(response.status).toBe(400);
  });
});
