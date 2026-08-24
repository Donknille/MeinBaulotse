-- ---------------------------------------------------------------------------
-- MeinBaulotse — Der Bildspeicher (Arbeitspaket 5)
--
-- Abschnitt 6.1, Zeile „Dateien": *S3-kompatibel, signierte Upload-URLs,
-- Fotos gehen nie durch den Anwendungsserver.* Auf Supabase heißt das:
-- Supabase Storage, und der Browser lädt mit **seiner eigenen** Sitzung hoch.
--
-- Damit bleibt Regel 1 unangetastet. Es gibt keinen Weg, auf dem ein Foto mit
-- erhöhten Rechten in den Speicher käme — die Rechteprüfung ist dieselbe
-- `mbl.is_member`, die auch über den Tabellen steht, nur an einer anderen
-- Tabelle. Der Nebeneffekt ist der eigentliche Gewinn: Ein 12-MB-Foto belegt
-- nie eine Vercel-Function, und die 4,5-MB-Grenze für Anfragekörper spielt
-- keine Rolle.
--
-- Der Ablageweg ist Teil der Rechteprüfung, nicht nur Ordnung:
--
--     <bauvorhaben-uuid>/<medien-uuid>.<endung>
--
-- Der erste Ordner **ist** das Bauvorhaben. Deshalb kann die Policy allein aus
-- dem Pfad entscheiden, ohne die Datei zu kennen.
--
-- Die ganze Datei läuft nur, wenn es das Schema `storage` gibt. Lokal gibt es
-- das nicht — dort läuft nacktes Postgres, und `pnpm db:reset` soll dadurch
-- nicht scheitern. Die Anwendung sagt dann beim Hochladen offen, dass der
-- Bildspeicher fehlt, statt so zu tun, als sei das Foto angekommen.
-- ---------------------------------------------------------------------------

-- Ein Ordnername, der keine Kennung ist, ist kein Fehler, sondern eine Datei,
-- die uns nichts angeht. Ohne diese Umleitung bräche ein einziger falsch
-- benannter Ordner jede Leseanfrage auf den ganzen Eimer.
create or replace function mbl.as_uuid(p_text text)
returns uuid
language plpgsql
immutable
as $$
begin
  return p_text::uuid;
exception when others then
  return null;
end
$$;

do $$
begin
  if not exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    raise notice 'Kein Schema "storage" — Bildspeicher übersprungen. Das ist lokal normal.';
    return;
  end if;

  -- 25 MB je Datei. Ein Handyfoto liegt bei 3 bis 8 MB; wer ein Video hochlädt,
  -- soll es merken, bevor er auf der Baustelle sein Datenvolumen verbraucht.
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'baustellenfotos', 'baustellenfotos', false, 26214400,
    array['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf']
  )
  on conflict (id) do update
     set public             = excluded.public,
         file_size_limit    = excluded.file_size_limit,
         allowed_mime_types = excluded.allowed_mime_types;

  execute $p$drop policy if exists baustellenfotos_read on storage.objects$p$;
  execute $p$drop policy if exists baustellenfotos_write on storage.objects$p$;
  execute $p$drop policy if exists baustellenfotos_replace on storage.objects$p$;
  execute $p$drop policy if exists baustellenfotos_remove on storage.objects$p$;

  -- Lesen darf jedes Mitglied. Die Zeilenschärfe für Einzelgewerke sitzt eine
  -- Ebene höher, an `media`: Ohne die Zeile dort ist ein Pfad nur eine
  -- Zeichenkette, die niemand kennt.
  execute $p$
    create policy baustellenfotos_read on storage.objects for select to authenticated
      using (
        bucket_id = 'baustellenfotos'
        and mbl.is_member(mbl.as_uuid((storage.foldername(name))[1]))
      )$p$;

  execute $p$
    create policy baustellenfotos_write on storage.objects for insert to authenticated
      with check (
        bucket_id = 'baustellenfotos'
        and (
          mbl.has_perm(mbl.as_uuid((storage.foldername(name))[1]), 'diary.write')
          or mbl.has_perm(mbl.as_uuid((storage.foldername(name))[1]), 'defect.write')
        )
      )$p$;

  -- Überschreiben ist die stille Form des Austauschens: derselbe Pfad, ein
  -- anderes Bild, und die Prüfsumme in `media` zeigt ins Leere. Deshalb gibt
  -- es dafür kein Recht. Ein neues Foto bekommt einen neuen Pfad.
  execute $p$
    create policy baustellenfotos_remove on storage.objects for delete to authenticated
      using (
        bucket_id = 'baustellenfotos'
        and mbl.has_perm(mbl.as_uuid((storage.foldername(name))[1]), 'diary.write')
      )$p$;
end
$$;
