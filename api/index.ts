/**
 * Einstiegspunkt der API auf Vercel.
 *
 * Ein Vercel-Projekt, eine Herkunft: Das Vite-Bundle wird statisch
 * ausgeliefert, diese Datei bedient alles unter `/api`. Deshalb gibt es weder
 * eine CORS-Schicht noch eine Basis-URL, die zwischen den Umgebungen abweichen
 * könnte.
 *
 * Lokal läuft dieselbe App über `apps/api/src/server.ts` als Node-Server; der
 * Vite-Proxy bildet den Pfad `/api` nach.
 */

import { handle } from 'hono/vercel';
import { createApp } from '../apps/api/src/app.js';

export const config = { runtime: 'nodejs' };

const app = createApp();

export const GET = handle(app);
export const POST = handle(app);
export const PATCH = handle(app);
export const PUT = handle(app);
export const DELETE = handle(app);
export const OPTIONS = handle(app);
