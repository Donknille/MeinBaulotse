/**
 * Der Zugang zum Modell — hinter einer Schnittstelle.
 *
 * Nicht aus Prinzip, sondern damit die Leitplanken prüfbar bleiben. Ein Test,
 * der ein echtes Modell fragt, prüft ein Modell; ein Test, der ein Modell
 * einsetzt, das absichtlich Rechtsberatung erteilt, prüft die Leitplanke. Nur
 * das Zweite sagt etwas über dieses Produkt aus.
 *
 * Ohne Schlüssel gibt es den Lotsen nicht — und er sagt das, statt ins Leere
 * zu laufen. Dieselbe Haltung wie bei den Fotos: Was nicht eingerichtet ist,
 * wird benannt, nicht verschwiegen.
 */

export interface LotseAnfrage {
  system: string;
  /** Der bisherige Verlauf, älteste zuerst. */
  verlauf: { role: 'user' | 'assistant'; content: string }[];
}

export interface LotseAntwort {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export interface LotseModel {
  readonly name: string;
  /** Was tausend Ein- und Ausgabetoken kosten, in Zehntelcent. */
  readonly preis: { ein: number; aus: number };
  antworte(anfrage: LotseAnfrage): Promise<LotseAntwort>;
}

/**
 * Wie viel eine Antwort gekostet hat, in Cent.
 *
 * Aufgerundet, und mindestens ein Cent für jeden Zug: Ein Kostendeckel, den
 * viele kleine Fragen unterlaufen, weil jede einzelne auf null Cent
 * abgerundet wird, ist keiner.
 */
export function kostenInCent(model: LotseModel, antwort: LotseAntwort): number {
  const zehntelcent =
    (antwort.inputTokens / 1000) * model.preis.ein + (antwort.outputTokens / 1000) * model.preis.aus;
  return Math.max(1, Math.ceil(zehntelcent / 10));
}

const ENDPUNKT = 'https://api.anthropic.com/v1/messages';

/**
 * Das Modell bei Anthropic.
 *
 * Die Preise stehen als Zahl hier und nicht in einer Abfrage: Sie ändern sich
 * selten, und ein Kostendeckel, der von einem zweiten Netzaufruf abhängt, ist
 * genau dann blind, wenn das Netz klemmt.
 */
export function anthropicModel(options: {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  fetchImpl?: typeof fetch;
}): LotseModel {
  const name = options.model ?? 'claude-sonnet-5';
  const holen = options.fetchImpl ?? fetch;
  return {
    name,
    preis: { ein: 30, aus: 150 },
    async antworte(anfrage) {
      const antwort = await holen(ENDPUNKT, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': options.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: name,
          max_tokens: options.maxTokens ?? 1200,
          system: anfrage.system,
          messages: anfrage.verlauf,
        }),
      });

      if (!antwort.ok) {
        throw new Error(`Das Modell hat mit ${antwort.status} geantwortet.`);
      }

      const daten = (await antwort.json()) as {
        content?: { type: string; text?: string }[];
        usage?: { input_tokens?: number; output_tokens?: number };
      };

      return {
        text: (daten.content ?? [])
          .filter((teil) => teil.type === 'text')
          .map((teil) => teil.text ?? '')
          .join('\n')
          .trim(),
        inputTokens: daten.usage?.input_tokens ?? 0,
        outputTokens: daten.usage?.output_tokens ?? 0,
      };
    },
  };
}

/** Das Modell aus der Umgebung, oder `null`, wenn keines eingerichtet ist. */
export function modelAusUmgebung(env: NodeJS.ProcessEnv = process.env): LotseModel | null {
  const apiKey = env['ANTHROPIC_API_KEY'];
  if (apiKey === undefined || apiKey.trim() === '') return null;
  const model = env['ANTHROPIC_MODEL'];
  return anthropicModel({
    apiKey,
    ...(model === undefined || model.trim() === '' ? {} : { model: model.trim() }),
  });
}
