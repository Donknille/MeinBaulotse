/**
 * Setzt die lokale Entwicklungsdatenbank zurück und spielt alles neu ein.
 *
 * Reihenfolge: Schema leeren → lokaler Auth-Shim → Migrationen → Seed.
 *
 * Der Shim wird **nur lokal** angewandt. Gegen ein Supabase-Projekt fährst du
 * ausschließlich die Dateien aus `supabase/migrations` (siehe docs/SETUP.md).
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');

const connectionString =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@localhost:54329/meinbaulotse';

if (connectionString.includes('supabase.co')) {
  console.error(
    'Abbruch: reset.ts löscht das gesamte Schema und ist ausschließlich für die\n' +
      'lokale Entwicklungsdatenbank gedacht. Für dein Supabase-Projekt siehe docs/SETUP.md.',
  );
  process.exit(1);
}

const client = new pg.Client({ connectionString });

async function run(label: string, sql: string): Promise<void> {
  process.stdout.write(`  ${label} … `);
  await client.query(sql);
  process.stdout.write('ok\n');
}

async function main(): Promise<void> {
  await client.connect();
  console.log(`Zurücksetzen von ${connectionString.replace(/:[^:@]*@/, ':***@')}`);

  await run(
    'Schema leeren',
    `
      drop schema if exists public cascade;
      drop schema if exists mbl cascade;
      drop schema if exists auth cascade;
      create schema public;
      grant all on schema public to current_user;
    `,
  );

  await run('Auth-Shim (nur lokal)', readFileSync(join(root, 'supabase/local/0000_auth_shim.sql'), 'utf8'));

  const migrationDir = join(root, 'supabase/migrations');
  for (const file of readdirSync(migrationDir).sort()) {
    if (!file.endsWith('.sql')) continue;
    await run(`Migration ${file}`, readFileSync(join(migrationDir, file), 'utf8'));
  }

  const counts = await client.query<{
    phasen: string;
    gewerke: string;
    rechte: string;
    vorgaenge: string;
    entscheidungen: string;
  }>(
    `select
       (select count(*) from phase)                     as phasen,
       (select count(*) from trade)                     as gewerke,
       (select count(*) from role_permission)           as rechte,
       (select count(*) from plan_template_task)        as vorgaenge,
       (select count(*) from decision_template)         as entscheidungen`,
  );
  const row = counts.rows[0]!;
  console.log(
    `Fertig: ${row.phasen} Phasen, ${row.gewerke} Gewerke, ${row.rechte} Rechteeinträge, ` +
      `${row.vorgaenge} Vorlagenvorgänge, ${row.entscheidungen} Entscheidungsvorlagen.`,
  );

  await client.end();
}

main().catch(async (error: unknown) => {
  console.error('\nFehlgeschlagen:', error instanceof Error ? error.message : error);
  await client.end().catch(() => undefined);
  process.exit(1);
});
