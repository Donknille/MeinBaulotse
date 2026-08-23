-- ---------------------------------------------------------------------------
-- MeinBaulotse — die Ablage für Fotos (Arbeitspaket 5)
--
-- Abschnitt 6.1: „Dateien: S3-kompatibel, signierte Upload-URLs — Fotos gehen
-- nie durch den Anwendungsserver." Genommen wird die Ablage des
-- Supabase-Projekts, in dem auch die Datenbank liegt. Der Browser lädt mit
-- der Sitzung des Nutzers hoch; wer worauf zugreifen darf, entscheiden
-- dieselben Hilfsfunktionen wie in der Datenbank.
--
-- Der Pfad ist die Rechteprüfung: `<projektkennung>/<prüfsumme>.jpg`. Aus dem
-- ersten Abschnitt ergibt sich das Bauvorhaben, und `mbl.is_member` sagt, ob
-- der Fragende dazugehört. Ein flacher Namensraum ohne diese Struktur ließe
-- sich nicht absichern, ohne für jede Datei eine Tabellenzeile zu lesen.
--
-- **Der ganze Abschnitt läuft nur dort, wo es das Schema `storage` gibt.**
-- Lokal steht ein nacktes Postgres, das keine Ablage kennt; die Migration
-- darf dort trotzdem nicht scheitern, sonst weicht die lokale Einrichtung von
-- der im Betrieb ab — und genau das kostet später einen Abend.
-- ---------------------------------------------------------------------------

/**
 * Zu welchem Bauvorhaben gehört diese Datei?
 *
 * Steht hier und nicht in der Policy, damit ein unsinniger Pfad nicht die
 * ganze Abfrage abbricht: Was nicht wie eine Kennung aussieht, ist `null`,
 * und `null` gehört zu keinem Bauvorhaben.
 */
create or replace function mbl.storage_project(p_name text)
returns uuid
language sql
immutable
as $$
  select case
    when split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(p_name, '/', 1)::uuid
  end
$$;

do $$
begin
  if not exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    raise notice 'Kein Schema storage — die Ablage wird übersprungen (lokale Entwicklung).';
    return;
  end if;

  -- Der Eimer. Nicht öffentlich: Jede Ansicht läuft über eine signierte,
  -- befristete Adresse (Abschnitt 6.4).
  execute $sql$
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('bauakte', 'bauakte', false, 26214400,
            array['image/jpeg','image/png','image/heic','image/webp'])
    on conflict (id) do nothing
  $sql$;

  -- Lesen darf jedes Mitglied des Bauvorhabens.
  if not exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects' and policyname = 'bauakte_read'
  ) then
    execute $sql$
      create policy bauakte_read on storage.objects for select to authenticated
        using (bucket_id = 'bauakte' and mbl.is_member(mbl.storage_project(name)))
    $sql$;
  end if;

  -- Hochladen darf, wer auch ins Tagebuch schreibt (Rechtematrix 2.2).
  if not exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects' and policyname = 'bauakte_write'
  ) then
    execute $sql$
      create policy bauakte_write on storage.objects for insert to authenticated
        with check (
          bucket_id = 'bauakte'
          and mbl.has_perm(mbl.storage_project(name), 'diary.write')
        )
    $sql$;
  end if;

  -- Überschreiben nur denselben Pfad — und derselbe Pfad ist dieselbe
  -- Prüfsumme, also dasselbe Bild. Das ist das Ende eines abgebrochenen
  -- Uploads, kein Austausch.
  if not exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects' and policyname = 'bauakte_update'
  ) then
    execute $sql$
      create policy bauakte_update on storage.objects for update to authenticated
        using (
          bucket_id = 'bauakte'
          and mbl.has_perm(mbl.storage_project(name), 'diary.write')
        )
    $sql$;
  end if;

  -- Es gibt bewusst **keine** DELETE-Policy. Ein Foto aus der Bauakte zu
  -- löschen, hieße eine Lücke zu hinterlassen, die niemand mehr erklären
  -- kann. Wer ein Bild nicht mehr sehen will, zieht den Eintrag zurück.
end
$$;

grant execute on all functions in schema mbl to anon, authenticated;
