/**
 * Die Abnahme von AP 7:
 *
 *   „Eine Rechtsfrage wird mit Gesetzesstelle und Verweis auf anwaltliche
 *    Beratung beantwortet, nicht mit einer Bewertung. Eine Frage zu einem
 *    Fotomangel führt zum Hinweis auf einen Sachverständigen. Der Kontext
 *    enthält nachweislich keine Daten fremder Projekte."
 *
 * Das Modell ist hier absichtlich ein schlechtes: Es erteilt Rechtsberatung,
 * beurteilt Mängel und erfindet Kartenverweise. Ein Test gegen ein
 * wohlerzogenes Modell prüfte das Modell; dieser prüft das Produkt.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { closePool, withAdminTx } from '@meinbaulotse/db';
import type { LotseAnswer } from '@meinbaulotse/shared';
import { createApp } from './app.js';
import type { LotseAnfrage, LotseModel } from './lotse-model.js';

const SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long';
process.env['SUPABASE_JWT_SECRET'] = SECRET;

/**
 * Ein Modell, das alles falsch macht, was die Leitplanken verhindern sollen.
 *
 * Es merkt sich außerdem, was es zu sehen bekommen hat — das ist die einzige
 * Stelle, an der sich der Kontext prüfen lässt, den ein echtes Modell bekäme.
 */
function boesesModell(antwortText: string): LotseModel & { letzte: LotseAnfrage | null } {
  const modell = {
    name: 'test-modell',
    preis: { ein: 30, aus: 150 },
    letzte: null as LotseAnfrage | null,
    async antworte(anfrage: LotseAnfrage) {
      modell.letzte = anfrage;
      return { text: antwortText, inputTokens: 1000, outputTokens: 400 };
    },
  };
  return modell;
}

const RECHTSBERATUNG =
  'Du musst das nicht zahlen. Der GU ist eindeutig im Unrecht und du hast einen klaren '
  + 'Anspruch. Ich würde die Zahlung einfach einbehalten.';

const MANGELBEURTEILUNG =
  'Das ist ein klarer Baumangel. Auf dem Foto sieht man deutlich einen Schwindriss, der '
  + 'unbedenklich ist. Da musst du nichts machen.';

let modell = boesesModell(RECHTSBERATUNG);
let app = createApp({ lotseModel: modell });

let bauherrToken: string;
let fremderToken: string;
let projektA: string;
let projektB: string;

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

function fragen(projekt: string, question: string, token = bauherrToken): Promise<Response> {
  return request(`/api/v1/projects/${projekt}/lotse`, {
    method: 'POST',
    token,
    body: JSON.stringify({ question }),
  });
}

/** Das Zeitfenster der Ratenbegrenzung vorstellen, statt es abzuwarten. */
async function fensterZuruecksetzen(projekt: string): Promise<void> {
  await withAdminTx(async (tx) =>
    tx.query(
      "update assistant_budget set window_started_at = now() - interval '2 minutes', window_count = 0 where project_id = $1",
      [projekt],
    ),
  );
}

beforeAll(async () => {
  await withAdminTx(async (tx) => {
    await tx.query(
      `truncate assistant_message, assistant_conversation, assistant_budget, task_confirmation,
                guest_token, media, diary_entry, schedule_change, audit_log, dependency, task,
                project_member, project, expert_org_member, expert_org restart identity cascade`,
    );
    await tx.query('delete from auth.users');
  });

  const [bauherr, fremder] = await withAdminTx(async (tx) => {
    const a = await tx.query<{ id: string }>(
      'insert into auth.users (email) values ($1) returning id',
      ['lotse-bauherr@example.test'],
    );
    const b = await tx.query<{ id: string }>(
      'insert into auth.users (email) values ($1) returning id',
      ['lotse-fremder@example.test'],
    );
    return [a.rows[0]!.id, b.rows[0]!.id];
  });
  bauherrToken = await tokenFor(bauherr);
  fremderToken = await tokenFor(fremder);

  // Zwei Bauvorhaben desselben Bauherrn. Genau das ist der harte Fall: Die
  // RLS erlaubt ihm beide, der Kontext darf trotzdem nur eines enthalten.
  const anlegen = async (name: string, state: string): Promise<string> => {
    const antwort = await request('/api/v1/projects/onboarding', {
      method: 'POST',
      token: bauherrToken,
      body: JSON.stringify({
        name,
        buildType: 'efh_massiv',
        hasBasement: true,
        plannedStart: '2026-04-01',
        federalState: state,
        contractType: 'verbraucherbauvertrag',
      }),
    });
    return ((await antwort.json()) as { projectId: string }).projectId;
  };
  projektA = await anlegen('Lotsenweg 1', 'BY');
  projektB = await anlegen('Nachbarsweg 99', 'NI');

  // Ein Tagebucheintrag je Projekt, mit unverwechselbarem Text.
  await withAdminTx(async (tx) => {
    const heute = new Date().toISOString().slice(0, 10);
    for (const [projekt, text] of [
      [projektA, 'Kennsatz-Alpha: Bewehrung abgenommen.'],
      [projektB, 'Kennsatz-Beta: Kran steht falsch.'],
    ] as const) {
      const mitglied = await tx.query<{ id: string }>(
        'select id from project_member where project_id = $1 limit 1',
        [projekt],
      );
      await tx.query(
        `insert into diary_entry (project_id, author_member_id, entry_date, body, author_role)
         values ($1, $2, $3, $4, 'owner')`,
        [projekt, mitglied.rows[0]!.id, heute, text],
      );
    }
  });
});

afterAll(async () => {
  await closePool();
});

describe('Die Leitplanken greifen an der Frage, nicht an der Antwort', () => {
  it('beantwortet eine Rechtsfrage mit Gesetzesstelle und Verweis auf einen Anwalt', async () => {
    modell = boesesModell(RECHTSBERATUNG);
    app = createApp({ lotseModel: modell });

    const antwort = (await (
      await fragen(projektA, 'Der GU verlangt 95 % als Abschlag. Muss ich das zahlen?')
    ).json()) as LotseAnswer;

    const recht = antwort.message.hints.find((hinweis) => hinweis.kind === 'recht');
    expect(recht).toBeDefined();
    expect(recht?.reference).toBe('§ 650m Abs. 1 BGB');
    expect(recht?.title).toBe('Hinweis auf eine Gesetzesstelle, keine Rechtsberatung.');
    expect(recht?.text).toContain('Fachanwalt für Bau- und Architektenrecht');

    // Das Modell hat trotzdem geurteilt — das ist die Prüfung: Der Hinweis
    // steht daneben, unabhängig davon, was das Modell geschrieben hat.
    expect(antwort.message.text).toContain('im Unrecht');
    expect(antwort.message.hints.map((hinweis) => hinweis.kind)).toContain('recht');
  });

  it('verweist bei einer Mangelfrage auf einen Sachverständigen', async () => {
    modell = boesesModell(MANGELBEURTEILUNG);
    app = createApp({ lotseModel: modell });
    await fensterZuruecksetzen(projektA);

    const antwort = (await (
      await fragen(projektA, 'Im Keller sind Risse in der Wand, siehe Foto. Ist das schlimm?')
    ).json()) as LotseAnswer;

    const mangel = antwort.message.hints.find((hinweis) => hinweis.kind === 'mangel');
    expect(mangel).toBeDefined();
    expect(mangel?.text).toContain('Bausachverständiger');
    expect(antwort.message.hints.map((hinweis) => hinweis.kind)).toContain('mangel');
  });

  it('hängt an eine reine Bau-Frage keinen Hinweis', async () => {
    modell = boesesModell('Der Estrich braucht etwa vier Wochen bis zur Belegreife.');
    app = createApp({ lotseModel: modell });
    await fensterZuruecksetzen(projektA);

    const antwort = (await (
      await fragen(projektA, 'Wie lange muss der Estrich trocknen?')
    ).json()) as LotseAnswer;
    expect(antwort.message.hints).toEqual([]);
  });
});

describe('Der Kontext', () => {
  it('enthält nachweislich keine Daten fremder Projekte', async () => {
    modell = boesesModell('Alles gut.');
    app = createApp({ lotseModel: modell });
    await fensterZuruecksetzen(projektA);

    await fragen(projektA, 'Wie steht es um den Bau?');
    const system = modell.letzte!.system;

    expect(system).toContain('Lotsenweg 1');
    expect(system).toContain('Kennsatz-Alpha');
    // Beide Bauvorhaben gehören demselben Bauherrn — die RLS ließe ihn beide
    // lesen. Dass hier trotzdem nur eines steht, ist die Aussage des Tests.
    expect(system).not.toContain('Nachbarsweg 99');
    expect(system).not.toContain('Kennsatz-Beta');
    expect(system).not.toContain(projektB);
  });

  it('lässt einen Fremden gar nicht erst fragen', async () => {
    modell = boesesModell('Alles gut.');
    app = createApp({ lotseModel: modell });

    const antwort = await fragen(projektA, 'Wie steht es um den Bau?', fremderToken);
    expect(antwort.status).toBe(404);
    // Und vor allem: Das Modell wurde nie gefragt.
    expect(modell.letzte).toBeNull();
  });

  it('nennt offen, was in der Datenlage fehlt', async () => {
    modell = boesesModell('Alles gut.');
    app = createApp({ lotseModel: modell });
    await fensterZuruecksetzen(projektA);

    await fragen(projektA, 'Liegen wir im Zeitplan?');
    expect(modell.letzte!.system).toContain('Lücken in der Datenlage');
    expect(modell.letzte!.system).toContain('keine Gesamtvergütung erfasst');
  });
});

describe('Verweise auf Lotsenkarten', () => {
  it('behält, was mitgegeben wurde, und wirft weg, was erfunden ist', async () => {
    // Welche Karten im Kontext stehen, hängt am heutigen Datum. Der Test
    // fragt deshalb erst, was mitgegeben wurde, statt einen Schlüssel zu
    // raten — sonst prüfte er an dem Tag nichts mehr, an dem die Baustelle
    // in einer Phase ohne Karte steht.
    modell = boesesModell('Erst einmal nichts.');
    app = createApp({ lotseModel: modell });
    await fensterZuruecksetzen(projektA);
    await fragen(projektA, 'Was passiert gerade auf der Baustelle?');

    const kontextTeil = modell.letzte!.system.split('--- Kontext zu diesem Bauvorhaben ---')[1]!;
    const echte = [...kontextTeil.matchAll(/\[\[karte:([a-z0-9_-]+)\]\]/g)].map(
      (treffer) => treffer[1]!,
    );
    expect(echte.length).toBeGreaterThan(0);

    modell = boesesModell(
      `Steht so in der Karte. [[karte:${echte[0]!}]] Und hier: [[karte:gibtesnicht]]`,
    );
    app = createApp({ lotseModel: modell });
    await fensterZuruecksetzen(projektA);

    const antwort = (await (
      await fragen(projektA, 'Und worauf soll ich achten?')
    ).json()) as LotseAnswer;

    expect(antwort.message.text).not.toContain('[[karte:');
    expect(antwort.message.cards.map((karte) => karte.key)).toEqual([echte[0]!]);
    // Der erfundene Verweis sieht aus wie eine Quelle. Er darf nicht durch.
    expect(antwort.message.cards[0]!.title.length).toBeGreaterThan(0);
  });
});

describe('Das Gespräch', () => {
  it('bleibt beim Fragenden und wird fortgesetzt', async () => {
    modell = boesesModell('Erste Antwort.');
    app = createApp({ lotseModel: modell });
    await fensterZuruecksetzen(projektA);

    const erste = (await (
      await fragen(projektA, 'Was ist eine Belegreife?')
    ).json()) as LotseAnswer;

    await fensterZuruecksetzen(projektA);
    modell = boesesModell('Zweite Antwort.');
    app = createApp({ lotseModel: modell });

    const zweite = (await (
      await request(`/api/v1/projects/${projektA}/lotse`, {
        method: 'POST',
        token: bauherrToken,
        body: JSON.stringify({
          question: 'Und wie misst man die?',
          conversationId: erste.conversationId,
        }),
      })
    ).json()) as LotseAnswer;

    expect(zweite.conversationId).toBe(erste.conversationId);
    // Der Verlauf geht mit: Ohne ihn wäre „die" in der zweiten Frage sinnlos.
    expect(modell.letzte!.verlauf.map((beitrag) => beitrag.content)).toContain(
      'Was ist eine Belegreife?',
    );
    expect(modell.letzte!.verlauf.map((beitrag) => beitrag.content)).toContain('Erste Antwort.');

    const gelesen = (await (
      await request(`/api/v1/projects/${projektA}/lotse/${erste.conversationId}`, {
        token: bauherrToken,
      })
    ).json()) as { messages: { role: string; text: string }[] };
    expect(gelesen.messages).toHaveLength(4);
    expect(gelesen.messages[0]!.role).toBe('frage');
  });

  it('trägt den Rechtshinweis auch beim nächsten Öffnen', async () => {
    // CI 11.3: Der Zusatz wird nie verkürzt, nie ausgeblendet, nie hinter
    // einen Aufklapper gelegt. Ein Hinweis, der nur bis zum Neuladen steht,
    // ist genau das: ausgeblendet.
    modell = boesesModell(RECHTSBERATUNG);
    app = createApp({ lotseModel: modell });
    await fensterZuruecksetzen(projektA);

    const frisch = (await (
      await fragen(projektA, 'Fehlt da nicht eine Sicherheit von 5 Prozent?')
    ).json()) as LotseAnswer;
    expect(frisch.message.hints[0]?.reference).toBe('§ 650m Abs. 2 BGB');

    const spaeter = (await (
      await request(`/api/v1/projects/${projektA}/lotse/${frisch.conversationId}`, {
        token: bauherrToken,
      })
    ).json()) as { messages: { id: string; hints: { reference?: string; title: string }[] }[] };

    const derselbe = spaeter.messages.find((beitrag) => beitrag.id === frisch.message.id);
    expect(derselbe?.hints[0]?.reference).toBe('§ 650m Abs. 2 BGB');
    expect(derselbe?.hints[0]?.title).toBe('Hinweis auf eine Gesetzesstelle, keine Rechtsberatung.');
  });

  it('lässt einen Beitrag nicht nachträglich ändern', async () => {
    await expect(
      withAdminTx(async (tx) =>
        tx.query("update assistant_message set text = 'anders' where role = 'antwort'"),
      ),
    ).rejects.toThrow(/append-only/i);
  });
});

describe('Ratenbegrenzung und Kostendeckel', () => {
  it('bremst, wer zu schnell hintereinander fragt', async () => {
    modell = boesesModell('Alles gut.');
    app = createApp({ lotseModel: modell });
    await fensterZuruecksetzen(projektA);

    let letzter = 0;
    for (let i = 0; i < 9; i += 1) {
      letzter = (await fragen(projektA, `Frage Nummer ${i}?`)).status;
      if (letzter === 429) break;
    }
    expect(letzter).toBe(429);

    await fensterZuruecksetzen(projektA);
    expect((await fragen(projektA, 'Und jetzt wieder?')).status).toBe(201);
  });

  it('macht dicht, wenn der Monatsdeckel erreicht ist — mit einem nächsten Schritt', async () => {
    modell = boesesModell('Alles gut.');
    app = createApp({ lotseModel: modell });
    await fensterZuruecksetzen(projektA);
    await withAdminTx(async (tx) =>
      tx.query('update assistant_budget set spent_cents = 99999 where project_id = $1', [projektA]),
    );

    const antwort = await fragen(projektA, 'Geht noch was?');
    expect(antwort.status).toBe(429);
    const text = ((await antwort.json()) as { error: string }).error;
    expect(text).toContain('Monat');
    // Auch eine Absage bekommt einen nächsten Schritt (CI 11.4).
    expect(text).toContain('Lotsenkarten');
  });

  it('schreibt die Kosten mit, ohne dass jemand daran denken muss', async () => {
    await withAdminTx(async (tx) =>
      tx.query('update assistant_budget set spent_cents = 0 where project_id = $1', [projektA]),
    );
    await fensterZuruecksetzen(projektA);
    modell = boesesModell('Alles gut.');
    app = createApp({ lotseModel: modell });

    await fragen(projektA, 'Was kostet das hier eigentlich?');
    const stand = await withAdminTx(async (tx) =>
      (
        await tx.query<{ spent_cents: number }>(
          'select spent_cents from assistant_budget where project_id = $1',
          [projektA],
        )
      ).rows[0]!.spent_cents,
    );
    expect(stand).toBeGreaterThan(0);
  });
});

describe('Ohne Schlüssel', () => {
  it('sagt offen, dass der Lotse nicht eingerichtet ist', async () => {
    const ohne = createApp({ lotseModel: null });
    const antwort = await ohne.request(`http://localhost/api/v1/projects/${projektA}/lotse`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${bauherrToken}` },
      body: JSON.stringify({ question: 'Bist du da?' }),
    });
    expect(antwort.status).toBe(501);
    expect(((await antwort.json()) as { error: string }).error).toContain('nicht eingerichtet');
  });
});
