/**
 * Einstiegspunkt der API auf Vercel.
 *
 * Ein Vercel-Projekt, eine Herkunft: Das Vite-Bundle wird statisch
 * ausgeliefert, diese Funktion bedient alles unter `/api`. Deshalb gibt es
 * weder eine CORS-Schicht noch eine Basis-URL, die zwischen den Umgebungen
 * abweichen könnte.
 *
 * **Dateiname und Export sind nicht frei wählbar.** Ohne Framework erkennt
 * Vercel im Ordner `api/` genau zwei Dinge: eine Datei mit einem echten Pfad
 * als Namen, und einen **Default-Export**. Die Schreibweise `[[...route]].ts`
 * und benannte Exporte je Methode (`export const GET = …`) sind Konventionen
 * des Next.js-App-Routers. Hier führen sie dazu, dass gar keine Funktion
 * entsteht, die auf `/api/...` antwortet, und jede Anfrage im SPA-Fallback
 * landet — also mit der Anmeldemaske als Antwort auf `/api/health`.
 *
 * Deshalb: `api/index.ts` bedient `/api`, und die Umschreibung in
 * `vercel.json` (`/api/(.*)` → `/api`) reicht alles Tiefere an dieselbe
 * Funktion weiter. Der Pfad bleibt dabei vollständig erhalten, `/api/v1/…`
 * kommt als `/api/v1/…` an. Genau deshalb hängt die App in
 * `apps/api/src/app.ts` unter `/api`, und genau deshalb schneidet der
 * Vite-Proxy lokal nichts ab: derselbe Pfad hier wie dort.
 *
 * Der Import bewusst ohne `.js`-Endung. Für `tsc` wäre sie richtig, aber
 * esbuild in Vercels Node-Builder löst sie nicht zuverlässig auf die
 * `.ts`-Datei auf.
 *
 * **`api/package.json` mit `"type": "commonjs"` gehört dazu.** Der
 * Projektstamm ist ESM, und Vercel bündelt diese Funktion entsprechend als
 * ESM. Dabei wandert `pg` mit hinein, das CommonJS ist und intern `require`
 * benutzt. In einem ESM-Bündel gibt es kein `require`, und die Funktion
 * stirbt beim Kaltstart mit `Dynamic require of "events" is not supported`,
 * also mit FUNCTION_INVOCATION_FAILED auf jeder Route. Die eine Zeile in
 * `api/package.json` dreht das Bündelformat für diesen Ordner auf CommonJS.
 * Am übrigen Repository ändert sie nichts.
 */

import { handle } from 'hono/vercel';
import { createApp } from '../apps/api/src/app';

const app = createApp();

export default handle(app);
