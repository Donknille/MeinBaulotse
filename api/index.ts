/**
 * Einstiegspunkt der API auf Vercel.
 *
 * Ein Vercel-Projekt, eine Herkunft: Das Vite-Bundle wird statisch
 * ausgeliefert, diese Funktion bedient alles unter `/api`. Deshalb gibt es
 * weder eine CORS-Schicht noch eine Basis-URL, die zwischen den Umgebungen
 * abweichen könnte.
 *
 * Vier Dinge sind hier nicht frei wählbar, und jedes hat schon einmal einen
 * ganzen Betrieb lahmgelegt:
 *
 * 1. **Der Dateiname.** Ohne Framework erkennt Vercel im Ordner `api/` nur
 *    eine Datei mit einem echten Pfad als Namen. `[[...route]].ts` ist eine
 *    Next.js-Konvention; damit entsteht gar keine Funktion, und `/api/health`
 *    liefert die Anmeldemaske aus dem SPA-Fallback.
 * 2. **Der Default-Export.** Benannte Exporte je Methode (`export const GET =
 *    …`) sind ebenfalls Next.js. Hier zählt ausschließlich `export default`.
 * 3. **Der Adapter.** Vercels Node-Runtime ruft die Funktion mit `(req, res)`
 *    aus `node:http` auf. Deshalb `@hono/node-server/vercel` und nicht
 *    `hono/vercel`: Letzterer gibt einen Handler zurück, der ein
 *    Web-`Request`-Objekt erwartet.
 * 4. **`api/package.json` mit `"type": "commonjs"`.** Der Projektstamm ist
 *    ESM, also bündelt Vercel auch diese Funktion als ESM. Dabei wandert `pg`
 *    mit hinein, das CommonJS ist und intern `require` benutzt. In einem
 *    ESM-Bündel gibt es kein `require`, und der Kaltstart bricht ab mit
 *    `Dynamic require of "events" is not supported`.
 *
 * Die Anwendung wird bewusst **im Handler** geladen, nicht im Modulkopf. Ein
 * Fehler beim Laden würde sonst die ganze Funktion töten, und Vercel
 * antwortete mit `FUNCTION_INVOCATION_FAILED` ohne einen Hinweis darauf, was
 * eigentlich fehlt. So steht der Grund als JSON in der Antwort, lesbar ohne
 * Zugriff auf die Logs.
 *
 * Der Import bewusst ohne `.js`-Endung. Für `tsc` wäre sie richtig, aber
 * esbuild in Vercels Node-Builder löst sie nicht zuverlässig auf die
 * `.ts`-Datei auf.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { handle } from '@hono/node-server/vercel';

type NodeHandler = (request: IncomingMessage, response: ServerResponse) => void | Promise<void>;

let handler: NodeHandler | undefined;

async function load(): Promise<NodeHandler> {
  if (handler !== undefined) return handler;
  const { createApp } = await import('../apps/api/src/app');
  handler = handle(createApp()) as NodeHandler;
  return handler;
}

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
    await (await load())(request, response);
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
