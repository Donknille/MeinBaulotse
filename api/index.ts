/**
 * Einstiegspunkt der API auf Vercel.
 *
 * Ein Vercel-Projekt, eine Herkunft: Das Vite-Bundle wird statisch
 * ausgeliefert, diese Funktion bedient alles unter `/api`. Deshalb gibt es
 * weder eine CORS-Schicht noch eine Basis-URL, die zwischen den Umgebungen
 * abweichen könnte.
 *
 * Fünf Dinge sind hier nicht frei wählbar. Jedes davon hat den Betrieb schon
 * einmal lahmgelegt, und jedes meldet sich mit einem anderen Symptom:
 *
 * 1. **Der Dateiname.** Ohne Framework erkennt Vercel im Ordner `api/` nur
 *    eine Datei mit einem echten Pfad als Namen. `[[...route]].ts` ist eine
 *    Next.js-Konvention; damit entsteht gar keine Funktion, und `/api/health`
 *    liefert die Anmeldemaske aus dem SPA-Fallback.
 * 2. **Der Default-Export.** Benannte Exporte je Methode (`export const GET =
 *    …`) sind ebenfalls Next.js. Hier zählt ausschließlich `export default`.
 * 3. **Der Adapter.** Vercels Node-Runtime ruft die Funktion mit `(req, res)`
 *    aus `node:http` auf. Deshalb `@hono/node-server/vercel` und nicht
 *    `hono/vercel`: Letzterer erwartet ein Web-`Request`-Objekt und stirbt
 *    mit FUNCTION_INVOCATION_FAILED.
 * 4. **Der Import geht auf `@meinbaulotse/api`, nicht auf `../apps/api/src`.**
 *    Vercel bündelt diese Datei nicht, sondern übersetzt sie und legt die
 *    Abhängigkeiten daneben. Ein relativer Pfad in den TypeScript-Quelltext
 *    eines anderen Pakets ist zur Laufzeit nicht auflösbar:
 *    `Cannot find module '/var/task/apps/api/src/app'`. Über den Paketnamen
 *    landet der Import im gebauten `dist`, deshalb baut `vercel.json` auch
 *    `@meinbaulotse/api`.
 * 5. **`api/package.json` mit `"type": "commonjs"`.** Der Projektstamm ist
 *    ESM. Sollte Vercel diese Datei doch einmal bündeln, wandert `pg` mit
 *    hinein, das CommonJS ist und intern `require` benutzt. In einem
 *    ESM-Bündel gibt es kein `require`, und der Kaltstart bricht ab mit
 *    `Dynamic require of "events" is not supported`.
 *
 * Die Anwendung wird beim ersten Aufruf gebaut, innerhalb von `try/catch`.
 * Scheitert das, antwortet die Funktion mit JSON und nennt den Grund, statt
 * dass Vercel eine nackte Plattformmeldung zeigt. Diese Diagnose hat genau
 * den Fehler unter Punkt 4 sichtbar gemacht.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { handle } from '@hono/node-server/vercel';
import { createApp } from '@meinbaulotse/api';

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
