/**
 * Lädt die `.env` aus dem Projektstamm, sofern es sie gibt.
 *
 * Ohne das steht `.env` zwar in der Anleitung, wirkt aber nirgends: Weder
 * `tsx` noch Node lesen sie von sich aus, und der lokale Server startet dann
 * ohne `SUPABASE_JWT_SECRET` und ohne `DATABASE_URL`.
 *
 * Bewusst nur für die lokalen Einstiegspunkte — Entwicklungsserver und
 * Demo-Seed. Auf Vercel kommen die Werte aus der Umgebung, und
 * `api/[[...route]].ts` importiert diese Datei nicht.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

try {
  process.loadEnvFile(join(root, '.env'));
} catch {
  // Keine .env vorhanden — dann gilt, was ohnehin in der Umgebung steht.
}
