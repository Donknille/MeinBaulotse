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
 *
 * **Der Anfragekörper wird hier besorgt, nicht dem Adapter überlassen.** Der
 * baut ihn sonst aus dem rohen Node-Stream (`Readable.toWeb`), und der liefert
 * auf Vercel nichts: `await c.req.json()` wartete ewig, die Funktion gab keine
 * Antwort, die Plattform brach mit 504 ab. GET ging, POST hing. Derselbe
 * Adapter nimmt einen fertigen Puffer an `incoming.rawBody` entgegen und rührt
 * den Stream dann nicht an.
 *
 * Dazu eine Frist. Kommt der Körper nicht binnen zwei Sekunden, antwortet die
 * Funktion mit 400 statt zu warten. Aus einer Zeitüberschreitung ohne Antwort
 * wird so eine Antwort in Millisekunden, die den Grund nennt.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { handle } from '@hono/node-server/vercel';
import { createApp, withoutSecrets } from './app.js';

type NodeHandler = (request: IncomingMessage, response: ServerResponse) => void | Promise<void>;

/** Was Vercel und der Hono-Adapter zusätzlich an die Anfrage hängen. */
type VercelRequest = IncomingMessage & { rawBody?: Buffer; body?: unknown };

let handler: NodeHandler | undefined;

/** Lange genug für jede Anfrage dieser Anwendung, kurz genug für einen Menschen. */
const BODY_DEADLINE_MS = 2000;

function asBuffer(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (typeof value === 'string') return Buffer.from(value, 'utf8');
  return Buffer.from(JSON.stringify(value), 'utf8');
}

/**
 * Legt den Anfragekörper als Puffer an die Anfrage, damit der Adapter ihn
 * nimmt. Gibt `false` zurück, wenn er nicht rechtzeitig kam.
 */
async function collectBody(request: VercelRequest): Promise<boolean> {
  const method = (request.method ?? 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD') return true;
  if (Buffer.isBuffer(request.rawBody)) return true;

  // Manche Plattformen lesen den Körper selbst und legen ihn geparst ab.
  if (request.body !== undefined && request.body !== null && request.body !== '') {
    request.rawBody = asBuffer(request.body);
    return true;
  }

  return await new Promise<boolean>((resolve) => {
    const chunks: Buffer[] = [];
    const done = (ok: boolean): void => {
      clearTimeout(timer);
      request.off('data', onData);
      request.off('end', onEnd);
      request.off('error', onError);
      resolve(ok);
    };
    const onData = (chunk: Buffer | string): void => {
      chunks.push(Buffer.from(chunk));
    };
    const onEnd = (): void => {
      request.rawBody = Buffer.concat(chunks);
      done(true);
    };
    const onError = (): void => done(false);
    const timer = setTimeout(() => done(false), BODY_DEADLINE_MS);

    request.on('data', onData);
    request.on('end', onEnd);
    request.on('error', onError);
  });
}

function respondJson(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
}

export default async function vercelHandler(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  try {
    if (!(await collectBody(request as VercelRequest))) {
      respondJson(response, 400, {
        error: 'Die Anfrage kam unvollständig an.',
        detail: 'Der Anfragekörper wurde nicht innerhalb der Frist geliefert.',
      });
      return;
    }

    handler ??= handle(createApp()) as NodeHandler;
    await handler(request, response);
  } catch (error) {
    console.error('Die API konnte nicht starten:', error);
    if (response.headersSent) {
      response.end();
      return;
    }
    respondJson(response, 500, {
      error: 'Die API konnte nicht starten.',
      detail: withoutSecrets(error instanceof Error ? error.message : String(error)),
    });
  }
}
