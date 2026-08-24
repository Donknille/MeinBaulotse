/**
 * Integrationstest der Abnahme von AP 7:
 *
 * „Eine Rechtsfrage wird mit Gesetzesstelle und Verweis auf anwaltliche
 *  Beratung beantwortet, nicht mit einer Bewertung. Eine Frage zu einem
 *  Fotomangel führt zum Hinweis auf einen Sachverständigen. Der Kontext enthält
 *  nachweislich keine Daten fremder Projekte."
 *
 * Das Sprachmodell ist dabei ein Doppelgänger, und das ist keine Abkürzung,
 * sondern der Punkt: Ob unter einer Rechtsfrage ein Anwaltshinweis steht, darf
 * nicht davon abhängen, wie ein Modell an diesem Tag gelaunt ist. Der
 * Doppelgänger antwortet deshalb absichtlich **ohne** jeden Hinweis — und die
 * Prüfung besteht darauf, dass er trotzdem dasteht.
 *
 * Der dritte Satz ist der wichtigste und der einzige, den man wirklich
 * beweisen kann. Er wird mit zwei Bauvorhaben geprüft, in denen dieselbe Person
 * Bauherr ist: Wenn die RLS hier nicht trägt, trägt sie nirgends.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { closePool, withAdminTx, withUserTx } from '@meinbaulotse/db';
import { assistantThreadDto, type AssistantThreadDto } from '@meinbaulotse/shared';
import { ask, assistantStatusFor, buildContext, systemPrompt } from './assistant.js';
import { classifyQuestion, withGuardrailNotes } from './assistant-guardrails.js';
import type { ModelClient, ModelRequest } from './anthropic.js';
import { createApp } from './app.js';

const SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long';
process.env['SUPABASE_JWT_SECRET'] = SECRET;
process.env['WEATHER_API_URL'] = '';
// Ohne Schlüssel gäbe es den Assistenten nicht. Der Wert ist nie in Gebrauch —
// gefragt wird der Doppelgänger unten.
process.env['ANTHROPIC_API_KEY'] = 'nicht-in-benutzung-doppelgaenger-antwortet';

const app = createApp();

let bauherrUserId: string;
let bauherrToken: string;
let projectId: string;
let fremdesProjekt: string;

/** Antwortet immer dasselbe und merkt sich, was ihm mitgegeben wurde. */
function doppelgaenger(antwort: string): ModelClient & { gesehen: ModelRequest[] } {
  const gesehen: ModelRequest[] = [];
  return {
    gesehen,
    complete(request) {
      gesehen.push(request);
      return Promise.resolve({
        text: antwort,
        inputTokens: 1200,
        outputTokens: 180,
        refused: false,
      });
    },
  };
}

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

async function projektAnlegen(name: string): Promise<string> {
  const created = await request('/api/v1/projects/onboarding', {
    method: 'POST',
    token: bauherrToken,
    body: JSON.stringify({
      name,
      buildType: 'efh_massiv',
      hasBasement: true,
      plannedStart: '2026-04-01',
      federalState: 'BY',
      contractType: 'verbraucherbauvertrag',
    }),
  });
  expect(created.status).toBe(201);
  return ((await created.json()) as { projectId: string }).projectId;
}

/** Fragt am HTTP vorbei, damit der Doppelgänger einsetzbar ist. */
async function fragen(
  frage: string,
  model: ModelClient,
  threadId: string | null = null,
): Promise<AssistantThreadDto> {
  const faden = await withUserTx({ sub: bauherrUserId }, (tx) =>
    ask(tx, projectId, model, { threadId, question: frage }, '2026-06-15'),
  );
  return assistantThreadDto.parse(faden);
}

function letzteAntwort(faden: AssistantThreadDto): string {
  const antworten = faden.messages.filter((eintrag) => eintrag.role === 'assistant');
  return antworten[antworten.length - 1]!.content;
}

beforeAll(async () => {
  await withAdminTx(async (tx) => {
    await tx.query(
      `truncate assistant_message, assistant_thread, media, diary_entry, guest_token,
                schedule_change, audit_log, checklist_item, guide_card_read, decision,
                dependency, task, project_member, project, expert_org_member, expert_org
                restart identity cascade`,
    );
    await tx.query('delete from auth.users');
  });

  bauherrUserId = await withAdminTx(async (tx) => {
    const result = await tx.query<{ id: string }>(
      "insert into auth.users (email) values ('lotse@example.test') returning id",
    );
    return result.rows[0]!.id;
  });
  bauherrToken = await tokenFor(bauherrUserId);

  projectId = await projektAnlegen('Musterweg 4');
  // Zweites Bauvorhaben desselben Bauherrn — der Prüfstein für den Kontext.
  fremdesProjekt = await projektAnlegen('Ganz woanders 99');

  // Eine Spur in jedem der beiden, die sich eindeutig zuordnen lässt.
  await withUserTx({ sub: bauherrUserId }, async (tx) => {
    const mitglied = await tx.query<{ id: string }>(
      'select id from project_member where project_id = $1 limit 1',
      [fremdesProjekt],
    );
    await tx.query(
      `insert into diary_entry (project_id, entry_date, body, author_member_id, author_role)
       values ($1, date '2026-06-10', 'GEHEIMNIS-AUS-DEM-ANDEREN-BAUVORHABEN', $2, 'owner')`,
      [fremdesProjekt, mitglied.rows[0]!.id],
    );
  });
});

afterAll(async () => {
  await closePool();
});

// ---------------------------------------------------------------------------

describe('Der Kontext', () => {
  it('enthält nachweislich keine Daten fremder Projekte', async () => {
    const context = await withUserTx({ sub: bauherrUserId }, (tx) =>
      buildContext(tx, projectId, '2026-06-15'),
    );

    const alsText = JSON.stringify(context);
    expect(context.project.name).toBe('Musterweg 4');
    expect(alsText).not.toContain('GEHEIMNIS-AUS-DEM-ANDEREN-BAUVORHABEN');
    expect(alsText).not.toContain('Ganz woanders 99');
  });

  it('trägt die Karten der Vorgänge, die gerade in den Blick rücken', async () => {
    const context = await withUserTx({ sub: bauherrUserId }, (tx) =>
      buildContext(tx, projectId, '2026-06-15'),
    );
    expect(context.cards.length).toBeGreaterThan(0);
    for (const karte of context.cards) {
      expect(karte.whatsHappening.length).toBeGreaterThan(20);
    }
  });

  it('nennt keine Namen und keine Kontaktdaten der Beteiligten', async () => {
    // Das Modell soll über den Bau reden, nicht über die Menschen.
    const context = await withUserTx({ sub: bauherrUserId }, (tx) =>
      buildContext(tx, projectId, '2026-06-15'),
    );
    const alsText = JSON.stringify(context);
    expect(alsText).not.toContain('@example.test');
    expect(Object.keys(context)).not.toContain('members');
  });

  it('landet unverändert im Systemprompt', async () => {
    const context = await withUserTx({ sub: bauherrUserId }, (tx) =>
      buildContext(tx, projectId, '2026-06-15'),
    );
    const prompt = systemPrompt(context, []);
    // Zeichen für Zeichen dasselbe, was gespeichert wird. Eine schöner
    // formulierte Fassung wäre eine zweite Wahrheit.
    expect(prompt).toContain(JSON.stringify(context, null, 1));
    expect(prompt).toContain('Keine Rechtsberatung');
  });

  it('wird mit der Antwort gespeichert, damit man sie später einordnen kann', async () => {
    const model = doppelgaenger('Der Estrich braucht Zeit zum Trocknen.');
    const faden = await fragen('Wann kann ich auf den Estrich?', model);

    const gespeichert = await withAdminTx(async (tx) => {
      const result = await tx.query<{ context_snapshot: { project: { name: string } } | null }>(
        `select context_snapshot from assistant_message
          where thread_id = $1 and role = 'assistant' order by created_at desc limit 1`,
        [faden.id],
      );
      return result.rows[0]!.context_snapshot;
    });

    expect(gespeichert?.project.name).toBe('Musterweg 4');
  });
});

describe('Die Leitplanken erkennen', () => {
  it('eine Rechtsfrage an ihren Wörtern, nicht am Gefühl', () => {
    expect(classifyQuestion('Muss ich nach § 650m BGB 90 Prozent zahlen?')).toContain('recht');
    expect(classifyQuestion('Wann verjährt die Gewährleistung?')).toContain('recht');
    expect(classifyQuestion('Kann ich den Vertrag kündigen?')).toContain('recht');
  });

  it('und schlägt bei einer gewöhnlichen Terminfrage nicht an', () => {
    // „Verzug" allein reicht bewusst nicht. Ein Anwaltshinweis unter „warum ist
    // der Estrich in Verzug" wäre die Sorte Warnung, die man nach dreimal
    // überliest — und dann auch die eine übersieht, die zählt.
    expect(classifyQuestion('Warum ist der Estrich im Verzug?')).not.toContain('recht');
    expect(classifyQuestion('Wann kommt der Putzer?')).toEqual([]);
  });

  it('eine Mängelbeurteilung nur, wenn nach einer Bewertung gefragt wird', () => {
    expect(classifyQuestion('Hier ist ein Riss in der Bodenplatte — ist das schlimm?')).toContain(
      'mangel',
    );
    expect(classifyQuestion('Auf dem Foto sieht man Feuchtigkeit. Was sagst du dazu?')).toContain(
      'mangel',
    );
    // Ein Befund ohne Frage nach seiner Bewertung ist keine Mängelbeurteilung.
    expect(classifyQuestion('Wann wird der Riss verpresst?')).not.toContain('mangel');
  });

  it('eine Geldfrage', () => {
    expect(classifyQuestion('Was kostet ein Blower-Door-Test ungefähr?')).toContain('kosten');
  });
});

describe('Die Leitplanken greifen', () => {
  it('hängt den Anwaltshinweis an, auch wenn das Modell ihn vergisst', async () => {
    // Der Doppelgänger antwortet absichtlich ohne jeden Hinweis.
    const model = doppelgaenger(
      'Abschlagszahlungen sind bei Verbraucherbauverträgen auf 90 Prozent begrenzt.',
    );
    const faden = await fragen('Darf der GU nach § 650m BGB 95 Prozent verlangen?', model);
    const antwort = letzteAntwort(faden);

    expect(antwort).toContain('keine Rechtsberatung');
    expect(antwort).toContain('Anwalt');
    // Die Antwort selbst bleibt stehen — der Hinweis ersetzt sie nicht.
    expect(antwort).toContain('90 Prozent');
  });

  it('sagt dem Modell vorher, wie es mit der Rechtsfrage umzugehen hat', async () => {
    const model = doppelgaenger('Kurz und knapp.');
    await fragen('Wann verjährt die Gewährleistung?', model);

    const prompt = model.gesehen[0]!.system;
    expect(prompt).toContain('Gesetzesstelle');
    expect(prompt).toContain('Anwalt');
    expect(prompt).toContain('Bewerte nicht, wer im Recht ist');
  });

  it('verweist bei einem Fotomangel auf den Sachverständigen', async () => {
    const model = doppelgaenger('Risse in einer Bodenplatte haben viele Ursachen.');
    const faden = await fragen(
      'Auf dem Foto ist ein Riss in der Bodenplatte zu sehen. Ist das schlimm?',
      model,
    );
    const antwort = letzteAntwort(faden);

    expect(antwort).toContain('Bausachverständiger');
    // Und ein nächster Schritt, nicht nur eine Absage (Regel 6).
    expect(antwort).toContain('fotografieren');
  });

  it('macht aus einer Kostenfrage eine Größenordnung mit Hinweis', async () => {
    const model = doppelgaenger('Ein Blower-Door-Test liegt oft bei ein paar hundert Euro.');
    const antwort = letzteAntwort(await fragen('Was kostet ein Blower-Door-Test?', model));
    expect(antwort).toContain('keine Kostenschätzung');
    expect(antwort).toContain('Angebot');
  });

  it('doppelt einen Hinweis nicht, den das Modell schon gegeben hat', () => {
    const hinweis =
      'Hinweis auf eine Gesetzesstelle, keine Rechtsberatung. Ob sie in deinem Fall ' +
      'greift, sagt dir ein Anwalt für Bau- und Architektenrecht — für die erste ' +
      'Einschätzung genügt oft ein Beratungsgespräch.';
    const mitHinweis = `§ 650m BGB begrenzt Abschläge.\n\n${hinweis}`;
    expect(withGuardrailNotes(mitHinweis, ['recht'])).toBe(mitHinweis);
  });

  it('bleibt bei einer Ablehnung des Modells höflich und nennt den Weg', async () => {
    const model: ModelClient = {
      complete: () =>
        Promise.resolve({ text: '', inputTokens: 900, outputTokens: 0, refused: true }),
    };
    const antwort = letzteAntwort(await fragen('Eine Frage, die abgelehnt wird.', model));
    expect(antwort).toContain('kann ich nicht beantworten');
    expect(antwort).toContain('Fachmann');
  });
});

describe('Die Unterhaltung', () => {
  it('merkt sich den Verlauf, damit Nachhaken funktioniert', async () => {
    const model = doppelgaenger('Erste Antwort.');
    const faden = await fragen('Erste Frage?', model);
    const zweiter = doppelgaenger('Zweite Antwort.');
    const weiter = await fragen('Und was heißt das?', zweiter, faden.id);

    expect(weiter.messages).toHaveLength(4);
    // Der zweite Aufruf hat den ganzen Verlauf gesehen, nicht nur die neue Frage.
    expect(zweiter.gesehen[0]!.messages.map((eintrag) => eintrag.content)).toEqual([
      'Erste Frage?',
      'Erste Antwort.',
      'Und was heißt das?',
    ]);
  });

  it('nennt die Lotsenkarten, auf denen die Antwort steht', async () => {
    const context = await withUserTx({ sub: bauherrUserId }, (tx) =>
      buildContext(tx, projectId, '2026-06-15'),
    );
    const karte = context.cards[0]!;
    const model = doppelgaenger(`Dazu steht in „${karte.title}" das Wesentliche.`);
    const faden = await fragen('Was kommt als Nächstes?', model);

    const letzte = faden.messages[faden.messages.length - 1]!;
    expect(letzte.citedCards.map((eintrag) => eintrag.id)).toContain(karte.id);
  });

  it('gehört dem, der fragt — ein anderer Beteiligter sieht sie nicht', async () => {
    const model = doppelgaenger('Nur für den Bauherrn.');
    await fragen('Etwas Privates?', model);

    const gu = await withAdminTx(async (tx) => {
      const nutzer = await tx.query<{ id: string }>(
        "insert into auth.users (email) values ('lotse-gu@example.test') returning id",
      );
      await tx.query(
        `insert into project_member (project_id, user_id, role, display_name, accepted_at)
         values ($1, $2, 'contractor', 'Bau GmbH', now())`,
        [projectId, nutzer.rows[0]!.id],
      );
      return nutzer.rows[0]!.id;
    });

    const seine = await withUserTx({ sub: gu }, async (tx) => {
      const result = await tx.query<{ anzahl: string }>(
        'select count(*)::text as anzahl from assistant_thread where project_id = $1',
        [projectId],
      );
      return Number(result.rows[0]!.anzahl);
    });
    expect(seine).toBe(0);
  });
});

describe('Deckel und Rate', () => {
  it('zählt, was jede Frage gekostet hat', async () => {
    const vorher = await withUserTx({ sub: bauherrUserId }, (tx) =>
      assistantStatusFor(tx, projectId),
    );
    await fragen('Noch eine Frage.', doppelgaenger('Noch eine Antwort.'));
    const nachher = await withUserTx({ sub: bauherrUserId }, (tx) =>
      assistantStatusFor(tx, projectId),
    );

    expect(nachher.questionsLeftThisHour).toBe(vorher.questionsLeftThisHour - 1);
    expect(nachher.budgetUsedPercent).toBeGreaterThanOrEqual(vorher.budgetUsedPercent);
  });

  it('macht bei erschöpftem Monatsbudget zu — mit einem Weg nach vorn', async () => {
    await withAdminTx(async (tx) => {
      await tx.query(
        `update assistant_message set cost_millicents = 100000
          where project_id = $1 and role = 'assistant'`,
        [projectId],
      );
    });

    const zustand = await withUserTx({ sub: bauherrUserId }, (tx) =>
      assistantStatusFor(tx, projectId),
    );
    expect(zustand.available).toBe(false);
    expect(zustand.reason).toContain('Lotsenkarten');

    await expect(fragen('Geht noch was?', doppelgaenger('…'))).rejects.toThrow();
  });
});
