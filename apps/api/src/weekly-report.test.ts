/**
 * Der Wochenbericht — Abnahme von AP 4:
 *
 * „Die Montagsmail enthält alle sechs Blöcke aus 3.11."
 *
 * Geprüft wird beides: dass die Blöcke stimmen und dass sie das Richtige
 * sagen. Ein Bericht mit sechs korrekt beschrifteten leeren Kästen wäre
 * formal vollständig und trotzdem wertlos.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { closePool, withAdminTx } from '@meinbaulotse/db';
import { workdayOffset, type Calendar } from '@meinbaulotse/schedule';
import { weeklyReport, type ProjectSchedule, type WeeklyReport } from '@meinbaulotse/shared';
import { createApp } from './app.js';
import { alsHtml, alsText, betreff, prognoseSatz } from './weekly-report-render.js';
import { ersterSatz } from './weekly-report.js';

const SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long';
process.env['SUPABASE_JWT_SECRET'] = SECRET;

const app = createApp();
const KALENDER: Calendar = { federalState: 'BY', catholicMunicipality: false };

/** Der Bau läuft seit acht Wochen — sonst wäre „diese Woche" immer leer. */
const HEUTE = '2026-06-01';
const BAUSTART = '2026-04-01';

let token: string;
let projektId: string;
let bericht: WeeklyReport;

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

async function hole(today = HEUTE): Promise<WeeklyReport> {
  const response = await request(`/api/v1/projects/${projektId}/weekly-report?today=${today}`, {
    token,
  });
  expect(response.status).toBe(200);
  return (await response.json()) as WeeklyReport;
}

beforeAll(async () => {
  await withAdminTx(async (tx) => {
    await tx.query(
      `truncate payment_milestone, schedule_change, audit_log, dependency, task, project_member, project,
                expert_org_member, expert_org restart identity cascade`,
    );
    await tx.query('delete from auth.users');
  });

  const bauherr = await withAdminTx(async (tx) => {
    const result = await tx.query<{ id: string }>(
      'insert into auth.users (email) values ($1) returning id',
      ['bericht@example.test'],
    );
    return result.rows[0]!.id;
  });
  token = await tokenFor(bauherr);

  const angelegt = await request('/api/v1/projects/onboarding', {
    method: 'POST',
    token,
    body: JSON.stringify({
      name: 'Berichtsweg 8',
      buildType: 'efh_massiv',
      hasBasement: true,
      plannedStart: BAUSTART,
      federalState: 'BY',
      contractType: 'verbraucherbauvertrag',
      contractualCompletion: '2026-11-30',
    }),
  });
  projektId = ((await angelegt.json()) as { projectId: string }).projectId;

  // Eine Verschiebung, damit Block 3 nicht leer ist.
  const plan = (await (
    await request(`/api/v1/projects/${projektId}/schedule`, { token })
  ).json()) as ProjectSchedule;
  const innenputz = plan.tasks.find((task) => task.name.includes('Innenputz'))!;
  await request(`/api/v1/projects/${projektId}/tasks/${innenputz.id}`, {
    method: 'PATCH',
    token,
    body: JSON.stringify({
      earliestStart: workdayOffset(innenputz.currentStart!, 8, KALENDER),
      reason: 'lieferzeit',
      reasonText: 'Der Putz kommt eine Woche später.',
    }),
  });

  bericht = await hole();
});

afterAll(async () => {
  await closePool();
});

describe('Die sechs Blöcke aus 3.11', () => {
  it('genügt dem geteilten Vertrag', () => {
    const parsed = weeklyReport.safeParse(bericht);
    expect(parsed.success, JSON.stringify(parsed.error?.flatten())).toBe(true);
  });

  it('1. nennt, was diese Woche auf der Baustelle passiert', () => {
    expect(bericht.thisWeek.length).toBeGreaterThan(0);
    for (const task of bericht.thisWeek) {
      // Jeder Vorgang berührt den Zeitraum der Woche.
      expect(task.start).not.toBeNull();
      expect(task.start! <= bericht.weekEnd).toBe(true);
      expect(task.end === null || task.end >= bericht.weekStart).toBe(true);
    }
  });

  it('1. legt zu jedem Vorgang die Kurzfassung der Lotsenkarte dazu, wenn es eine gibt', () => {
    const mitKarte = bericht.thisWeek.filter((task) => task.guideCardTitle !== null);
    expect(mitKarte.length).toBeGreaterThan(0);
    for (const task of mitKarte) {
      expect(task.guideCardSummary).not.toBeNull();
      // Ein Satz, nicht die halbe Karte.
      expect(task.guideCardSummary!.length).toBeLessThan(400);
      expect(task.guideCardSummary!.endsWith('.')).toBe(true);
    }
  });

  it('2. nennt die offenen Entscheidungen mit Restlaufzeit in Werktagen', () => {
    expect(bericht.decisions.length).toBeGreaterThan(0);
    const sortiert = bericht.decisions
      .map((entry) => entry.dueDate)
      .filter((date): date is string => date !== null);
    expect([...sortiert].sort()).toEqual(sortiert);

    for (const decision of bericht.decisions) {
      expect(typeof decision.remainingWorkdays).toBe('number');
    }
  });

  it('3. nennt, was sich seit dem letzten Bericht verschoben hat — mit Grund', () => {
    expect(bericht.changes.length).toBeGreaterThan(0);
    const putz = bericht.changes.find((change) => change.taskName?.includes('Innenputz') === true);
    expect(putz).toBeDefined();
    expect(putz!.reason).toBe('lieferzeit');
    expect(putz!.reasonText).toContain('eine Woche später');
    expect(putz!.from).not.toBe(putz!.to);
  });

  it('3. bleibt bei einer ruhigen Woche leer, statt Altes zu wiederholen', async () => {
    // Der Rückblick misst an `created_at`, also am tatsächlichen Zeitpunkt der
    // Änderung — nicht an einem gedachten Kalendertag. `?today=` verschiebt
    // deshalb das Fenster, es spielt keine Vergangenheit nach. Für diesen Fall
    // braucht es ein Fenster, das nach dem echten Jetzt beginnt.
    const uebermorgen = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    const spaeter = await hole(uebermorgen);
    expect(spaeter.changes).toHaveLength(0);
  });

  it('4. stellt geschuldeten und errechneten Endtermin gegenüber', () => {
    expect(bericht.forecast.contractualEnd).toBe('2026-11-30');
    expect(bericht.forecast.computedEnd).not.toBeNull();
    expect(typeof bericht.forecast.deviationWorkdays).toBe('number');
  });

  it('5. nennt die Fotos, die jetzt fällig sind', () => {
    expect(bericht.photos.length).toBeGreaterThan(0);
    for (const photo of bericht.photos) {
      expect(photo.what.length).toBeGreaterThan(5);
      expect(photo.why.length).toBeGreaterThan(5);
    }
  });

  it('6. lässt den Geldblock weg, solange es keinen Zahlungsplan gibt', () => {
    // Ein leerer Kasten mit Überschrift wäre ein Versprechen, das der Bericht
    // nicht hält.
    expect(bericht.money).toBeNull();
  });

  it('6. nennt die nächste Zahlung und wovon sie abhängt', async () => {
    const vorgang = await withAdminTx(async (tx) =>
      (
        await tx.query<{ id: string; name: string }>(
          `select id, name from task where project_id = $1 and status <> 'fertig'
            order by current_start limit 1`,
          [projektId],
        )
      ).rows[0]!,
    );

    await withAdminTx(async (tx) =>
      tx.query(
        `insert into payment_milestone (project_id, name, amount_cents, requires_task_ids, due_date)
         values ($1, 'Nach dem Rohbau', 9000000, array[$2::uuid], '2026-12-01')`,
        [projektId, vorgang.id],
      ),
    );

    const mit = await hole();

    expect(mit.money?.name).toBe('Nach dem Rohbau');
    expect(mit.money?.releasable).toBe(false);
    // „Offen: …" statt „gesperrt": Der Bericht sagt, was fehlt, nicht, was
    // nicht geht.
    expect(mit.money?.requirement).toContain(vorgang.name);
  });

  /**
   * Abschnitt 6.5: „Aufbewahrung bis 5 Jahre nach Abnahme wegen
   * Gewährleistung, danach **Erinnerung statt stiller Löschung**."
   *
   * Das letzte Wort ist das entscheidende. Wer nach fünf Jahren feststellt,
   * dass seine Akte weg ist, hat sie genau dann verloren, als er sie
   * vielleicht gebraucht hätte.
   */
  describe('Die Aufbewahrungserinnerung', () => {
    it('schweigt, solange die Gewährleistung läuft', async () => {
      const abnahme = await withAdminTx(async (tx) =>
        (
          await tx.query<{ id: string }>(
            "select id from task where project_id = $1 and template_task_code = 't37'",
            [projektId],
          )
        ).rows[0]!.id,
      );

      await withAdminTx(async (tx) =>
        tx.query('update task set actual_end = $2 where id = $1', [abnahme, '2024-06-01']),
      );
      expect((await hole()).retention).toBeNull();
    });

    it('erinnert nach fünf Jahren — und sagt, dass nichts gelöscht wird', async () => {
      const abnahme = await withAdminTx(async (tx) =>
        (
          await tx.query<{ id: string }>(
            "select id from task where project_id = $1 and template_task_code = 't37'",
            [projektId],
          )
        ).rows[0]!.id,
      );
      await withAdminTx(async (tx) =>
        tx.query('update task set actual_end = $2 where id = $1', [abnahme, '2019-06-01']),
      );

      const bericht = await hole();
      expect(bericht.retention).not.toBeNull();
      expect(bericht.retention!.acceptedOn).toBe('2019-06-01');
      expect(bericht.retention!.years).toBeGreaterThanOrEqual(5);

      // Und der Text sagt das Entscheidende: Es wird nichts gelöscht.
      expect(alsText(bericht)).toContain('Gelöscht wird trotzdem nichts');
      expect(alsHtml(bericht)).toContain('Gelöscht wird trotzdem nichts');
    });
  });

  it('sagt, wo das Bauvorhaben gerade steht', () => {
    expect(bericht.phase).not.toBeNull();
    expect(bericht.phase!.ordinal).toBeGreaterThan(0);
    expect(bericht.phase!.total).toBeGreaterThan(bericht.phase!.ordinal - 1);
  });
});

describe('Der Bericht als Mail', () => {
  it('trägt alle Überschriften im Text', () => {
    const text = alsText(bericht);
    for (const ueberschrift of [
      'DIESE WOCHE AUF DER BAUSTELLE',
      'WAS DU ENTSCHEIDEN MUSST',
      'WAS SICH VERSCHOBEN HAT',
      'PROGNOSE',
      'FOTOS, DIE JETZT FÄLLIG SIND',
    ]) {
      expect(text, ueberschrift).toContain(ueberschrift);
    }
  });

  it('nennt im Betreff, was ansteht', () => {
    expect(betreff(bericht)).toContain('Berichtsweg 8');
  });

  it('erzeugt HTML ohne offene Fremdverweise', () => {
    const html = alsHtml(bericht);
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('Berichtsweg 8');
    // Keine externen Schriften, keine Bilder, kein Skript: Mailprogramme
    // können wenig, und was sie können, unterscheidet sich.
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('https://fonts.');
  });

  it('maskiert, was aus der Datenbank kommt', () => {
    const gefaehrlich: WeeklyReport = {
      ...bericht,
      project: { ...bericht.project, name: '<script>alert(1)</script>' },
    };
    const html = alsHtml(gefaehrlich);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('sagt die Prognose in einem Satz, nicht als Zahl', () => {
    const satz = prognoseSatz(bericht);
    expect(satz).toContain('Geschuldet');
    expect(satz).toMatch(/Werktage? (später|früher)|genau im Plan/);
  });

  it('kürzt die Karte am Satzende, nicht mitten im Wort', () => {
    expect(ersterSatz('Erster Satz. Zweiter Satz.')).toBe('Erster Satz.');
    expect(ersterSatz('Ohne Punkt')).toBe('Ohne Punkt');
    expect(ersterSatz('Mit\nUmbruch. Und mehr.')).toBe('Mit Umbruch.');
  });
});

describe('Wer den Bericht bekommt', () => {
  it('niemand ohne Anmeldung', async () => {
    const response = await request(`/api/v1/projects/${projektId}/weekly-report`);
    expect(response.status).toBe(401);
  });

  it('kein Unbeteiligter', async () => {
    const fremd = await withAdminTx(async (tx) => {
      const result = await tx.query<{ id: string }>(
        'insert into auth.users (email) values ($1) returning id',
        ['bericht-fremd@example.test'],
      );
      return result.rows[0]!.id;
    });

    const response = await request(`/api/v1/projects/${projektId}/weekly-report`, {
      token: await tokenFor(fremd),
    });
    expect(response.status).toBe(404);
  });
});
