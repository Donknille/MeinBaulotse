/**
 * Die Verbindung zum Sprachmodell.
 *
 * Sie steht hinter einer Schnittstelle mit genau einer Methode, und das aus
 * zwei Gründen. Der praktische: Die Gegenproben zu den Leitplanken sollen ohne
 * Netz laufen — ein Test, der ein fremdes Rechenzentrum anruft, prüft dessen
 * Verfügbarkeit und nicht unseren Code. Der fachliche: Was der Assistent darf
 * und was er sagen muss, steht in `assistant-guardrails.ts` und gilt
 * unabhängig davon, welches Modell antwortet.
 *
 * Ohne `ANTHROPIC_API_KEY` gibt es den Assistenten nicht. Die Oberfläche sagt
 * das offen, statt eine Frage entgegenzunehmen und nie zu beantworten.
 */

import Anthropic from '@anthropic-ai/sdk';

export interface ModelRequest {
  system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
}

export interface ModelAnswer {
  text: string;
  inputTokens: number;
  outputTokens: number;
  /** Das Modell hat die Antwort verweigert. Kommt als Zustand, nicht als Fehler. */
  refused: boolean;
}

export interface ModelClient {
  complete(request: ModelRequest): Promise<ModelAnswer>;
}

/**
 * Der Preis je Million Token, in Zehntel-Cent.
 *
 * Steht hier und nicht in der Datenbank: Er gehört zum Modell, nicht zum
 * Bauvorhaben. Wer das Modell wechselt, ändert beides in einer Datei.
 *
 * Claude Opus 5: 5 $ Eingabe, 25 $ Ausgabe je Million Token. Umgerechnet mit
 * einem festen, absichtlich großzügigen Kurs — der Deckel soll eher zu früh
 * greifen als zu spät.
 */
const MILLICENT_PER_INPUT_MTOK = 5 * 100 * 10;
const MILLICENT_PER_OUTPUT_MTOK = 25 * 100 * 10;

export function costInMillicents(inputTokens: number, outputTokens: number): number {
  return Math.ceil(
    (inputTokens * MILLICENT_PER_INPUT_MTOK) / 1_000_000 +
      (outputTokens * MILLICENT_PER_OUTPUT_MTOK) / 1_000_000,
  );
}

export function assistantConfigured(): boolean {
  const key = process.env['ANTHROPIC_API_KEY'];
  return key !== undefined && key.trim() !== '';
}

/**
 * Die eigentliche Anfrage.
 *
 * Vier Entscheidungen, jede mit einem Grund:
 *
 * - **`max_tokens: 4000`**, nicht die üblichen 16000. Der harte Grund ist der
 *   Kostendeckel aus Abschnitt 3.7: Eine Antwort, die ein Bauherr auf dem Handy
 *   liest, ist keine zwölf Bildschirmseiten lang, und jede Ausgabezeile kostet
 *   das Fünffache einer Eingabezeile.
 * - **`effort: 'medium'`.** Die Antwort steht auf mitgeliefertem
 *   Redaktionsinhalt; es ist Einordnung, keine Herleitung. `high` wäre für
 *   diese Aufgabe bezahltes Nachdenken über etwas, das schon dasteht.
 * - **`fallbacks: 'default'`.** Lehnt das Modell ab, beantwortet ein anderes
 *   dieselbe Frage im selben Aufruf. Auf einer Baustelle ist eine Frage nach
 *   Rissen im Beton keine Grenzüberschreitung, sondern der Alltag — sie darf
 *   nicht an einem Klassifikator scheitern.
 * - **Kein `stream`.** Vercel-Functions und eine Antwort von zwei Absätzen
 *   vertragen sich; ein Datenstrom durch eine serverlose Funktion wäre Aufwand
 *   ohne spürbaren Gewinn.
 */
export function anthropicClient(): ModelClient {
  const client = new Anthropic();

  return {
    async complete(request) {
      const response = await client.beta.messages.create({
        model: 'claude-opus-5',
        max_tokens: 4000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium' },
        system: request.system,
        messages: request.messages,
      });

      const text = response.content
        .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('\n')
        .trim();

      return {
        text,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        refused: response.stop_reason === 'refusal',
      };
    },
  };
}
