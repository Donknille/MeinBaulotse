/**
 * Fügt die Migrationen zu einer Datei zusammen, die sich in einem Rutsch in
 * den SQL-Editor eines Supabase-Projekts einfügen lässt.
 *
 * Aufruf: `pnpm --filter @meinbaulotse/db build:db-setup`
 *
 * Warum erzeugt und nicht von Hand zusammenkopiert: Eine handgepflegte
 * Sammeldatei ist spätestens bei der ersten Änderung an einer Migration still
 * veraltet — und still veraltetes Schema-SQL ist die unangenehmste Sorte
 * Fehler. Die Pipeline prüft zusätzlich, dass die Datei zu ihren Quellen passt.
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const migrationDir = join(root, 'supabase', 'migrations');
const target = join(root, 'docs', 'db-setup.sql');

const files = readdirSync(migrationDir)
  .filter((name) => name.endsWith('.sql'))
  .sort();

if (files.length === 0) {
  throw new Error(`Keine Migrationen in ${migrationDir} gefunden.`);
}

const rule = '-- '.padEnd(2) + '='.repeat(75);

const header = `-- ${'='.repeat(75)}
--
--  MeinBaulotse — vollständige Einrichtung der Datenbank
--
--  ERZEUGT. Nicht von Hand bearbeiten.
--  Quelle: supabase/migrations/*.sql
--  Neu erzeugen: pnpm --filter @meinbaulotse/db build:db-setup
--
--  ---------------------------------------------------------------------
--
--  So spielst du das ein:
--
--    Supabase-Dashboard → SQL Editor → New query → diese Datei vollständig
--    einfügen → Run. Einmal, für ein frisches Projekt.
--
--  Die Reihenfolge der Abschnitte ist bindend; sie bauen aufeinander auf.
--  Läuft ein Abschnitt auf einen Fehler, brich ab und behebe ihn, statt
--  weiterzumachen.
--
--  NICHT enthalten ist supabase/local/0000_auth_shim.sql, und das gehört
--  auch nicht hierher. Diese Datei bildet nur in einem nackten Postgres
--  nach, was ein Supabase-Projekt von Haus aus mitbringt: das Schema auth
--  mit auth.uid() sowie die Rollen anon, authenticated und service_role.
--
--  ---------------------------------------------------------------------
--
--  Danach zur Kontrolle:
--
--    select
--      (select count(*) from phase)              as phasen,             -- 9
--      (select count(*) from trade)              as gewerke,            -- 21
--      (select count(*) from role_permission)    as rechte,             -- 47
--      (select count(*) from plan_template_task) as vorlagenvorgaenge;  -- 38
--
--    select count(*) filter (where rowsecurity) as mit_rls,
--           count(*)                            as tabellen
--    from pg_tables where schemaname = 'public';                -- 14 von 14
--
--  Die zweite Abfrage ist die wichtigere: Die Zählung oben stimmt auch
--  dann, wenn die Rechte nur zur Hälfte angekommen sind.
--
-- ${'='.repeat(75)}

`;

const parts = files.map((name) => {
  const body = readFileSync(join(migrationDir, name), 'utf8').trimEnd();
  return `${rule}\n--  Abschnitt: ${name}\n${rule}\n\n${body}\n`;
});

writeFileSync(target, `${header}${parts.join('\n\n')}\n`, 'utf8');

const lines = readFileSync(target, 'utf8').split('\n').length;
console.log(
  `Sammeldatei geschrieben: ${target}\n` +
    `  ${files.length} Migrationen (${files.join(', ')}), ${lines} Zeilen.`,
);
