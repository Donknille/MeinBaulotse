/**
 * Einstiegspunkt der API auf Vercel.
 *
 * Ein Vercel-Projekt, eine Herkunft: Das Vite-Bundle wird statisch
 * ausgeliefert, diese Funktion bedient alles unter `/api`. Deshalb gibt es
 * weder eine CORS-Schicht noch eine Basis-URL, die zwischen den Umgebungen
 * abweichen könnte.
 *
 * Der Dateiname ist Vercels Konvention für Sammelrouten: `/api/v1/projects/…`
 * erreicht diese Funktion mit **vollständigem** Pfad. Der Hono-Adapter reicht
 * die Anfrage unverändert weiter — er entfernt kein Präfix. Genau deshalb hängt
 * die App in `apps/api/src/app.ts` unter `/api`, und genau deshalb schneidet
 * der Vite-Proxy lokal nichts ab: derselbe Pfad hier wie dort.
 *
 * Der Import bewusst ohne `.js`-Endung. Für `tsc` wäre sie richtig, aber
 * esbuild in Vercels Node-Builder löst sie nicht zuverlässig auf die
 * `.ts`-Datei auf.
 */

import { handle } from 'hono/vercel';
import { createApp } from '../apps/api/src/app';

const app = createApp();

export const GET = handle(app);
export const POST = handle(app);
export const PATCH = handle(app);
export const PUT = handle(app);
export const DELETE = handle(app);
export const OPTIONS = handle(app);
