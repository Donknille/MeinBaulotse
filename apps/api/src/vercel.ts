/**
 * Quelle der Vercel-Function.
 *
 * Diese Datei wird nicht direkt deployt. `pnpm build:function` bündelt sie
 * samt aller Abhängigkeiten zu `api/index.js`, und **diese** Datei liegt im
 * Repository und läuft im Betrieb.
 *
 * Warum der Umweg über ein Bündel? Weil vier Anläufe daran gescheitert sind,
 * dass die Function zur Laufzeit etwas auflösen musste:
 *
 * | Versuch | Symptom |
 * |---|---|
 * | `api/[[...route]].ts`, benannte Exporte | Anmeldemaske auf `/api/health` |
 * | `hono/vercel` als Adapter | FUNCTION_INVOCATION_FAILED |
 * | dynamischer Import auf `../apps/api/src/app` | `Cannot find module` |
 * | statischer Import auf `@meinbaulotse/api` | Absturz beim Laden |
 *
 * Ein fertiges Bündel kennt diese Fragen nicht mehr. Es importiert nur noch
 * Node-Bausteine, und was lokal läuft, läuft dort genauso.
 *
 * Zwei Dinge bleiben trotzdem Vercel-Konventionen, an die sich das Bündel
 * halten muss, und der Generator prüft beide:
 *
 * 1. Ein **Default-Export**, aufgerufen mit `(req, res)` aus `node:http`.
 *    Deshalb `@hono/node-server/vercel` und nicht `hono/vercel`.
 * 2. Die Zieldatei heißt `api/index.js` und bedient `/api`. Alles Tiefere
 *    reicht die Umschreibung in `vercel.json` an dieselbe Funktion weiter,
 *    mit vollständigem Pfad.
 *
 * Die Anwendung wird beim ersten Aufruf gebaut, innerhalb von `try/catch`.
 * Scheitert das, antwortet die Funktion mit JSON und nennt den Grund. Genau
 * diese Diagnose hat den vorletzten Fehler sichtbar gemacht, statt ihn hinter
 * einer Plattformmeldung zu verstecken.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { handle } from '@hono/node-server/vercel';
import { createApp } from './app.js';

type NodeHandler = (request: IncomingMessage, response: ServerResponse) => void | Promise<void>;

let handler: NodeHandler | undefined;

/**
 * Zugangsdaten dürfen nicht in einer Fehlermeldung landen. Postgres-Adressen
 * tragen das Passwort im Klartext zwischen `//` und `@`.
 */
function withoutSecrets(text: string): string {
  return text.replace(/:\/\/[^@\s]*@/g, '://***@');
}

export default async function vercelHandler(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  try {
    handler ??= handle(createApp()) as NodeHandler;
    await handler(request, response);
  } catch (error) {
    console.error('Die API konnte nicht starten:', error);
    if (response.headersSent) {
      response.end();
      return;
    }
    response.statusCode = 500;
    response.setHeader('content-type', 'application/json; charset=utf-8');
    response.end(
      JSON.stringify({
        error: 'Die API konnte nicht starten.',
        detail: withoutSecrets(error instanceof Error ? error.message : String(error)),
      }),
    );
  }
}
