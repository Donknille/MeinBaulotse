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
--      (select count(*) from plan_template_task) as vorlagenvorgaenge,  -- 38
--      (select count(*) from guide_card)         as lotsenkarten,       -- 12
--      (select count(*) from decision_template)  as entscheidungen,     -- 14
--      (select count(*) from payment_template)   as zahlungsvorlage,    -- 9
--      (select count(*) from scope_permission)   as gastrechte;         -- 7
--
--    select count(*) filter (where rowsecurity) as mit_rls,
--           count(*)                            as tabellen
--    from pg_tables where schemaname = 'public';                -- 32 von 32
--
--    select id, public from storage.buckets
--     where id = 'baustellenfotos';                             -- f
--
--  Die zweite Abfrage ist die wichtigere: Die Zählung oben stimmt auch
--  dann, wenn die Rechte nur zur Hälfte angekommen sind. Die dritte gehört
--  dazu, weil ohne den Eimer jedes Foto beim Hochladen scheitert — und
--  zwar erst auf der Baustelle.
--
-- ${'='.repeat(75)}


-- ---------------------------------------------------------------------------
-- Diese Datei ist für eine leere Datenbank. Ein zweiter Lauf endete bisher in
-- ERROR: 42710: type "federal_state" already exists — in Zeile 74 von 4000,
-- und wer das liest, weiß nicht, ob der erste Lauf zur Hälfte oder ganz
-- durchgekommen ist.
--
-- Deshalb steht die Frage jetzt vorn und mit der Antwort daneben.
-- ---------------------------------------------------------------------------
do $mbl_bereits$
begin
  if to_regclass('public.project') is not null
     or exists (select 1 from information_schema.schemata where schema_name = 'mbl') then
    raise exception
      E'Diese Datenbank ist schon eingerichtet — hier wurde nichts geändert.\\n\\n'
      'Wie weit der erste Lauf kam, sagt dir das hier:\\n'
      '    select count(*) filter (where rowsecurity) as mit_rls, count(*) as tabellen\\n'
      '      from pg_tables where schemaname = ''public'';\\n\\n'
      'Steht dort 32 von 32, ist alles drin und du bist fertig.\\n\\n'
      'Steht dort weniger, setz zurück und lauf einmal sauber durch — aber nur '
      'auf einem Projekt, in dem sonst nichts liegt:\\n'
      '    drop schema if exists mbl cascade;\\n'
      '    drop schema if exists public cascade;\\n'
      '    create schema public;\\n'
      '    grant usage on schema public to postgres, anon, authenticated, service_role;\\n'
      '    grant all on schema public to postgres, service_role;'
      using errcode = 'object_not_in_prerequisite_state';
  end if;
end
$mbl_bereits$;

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
