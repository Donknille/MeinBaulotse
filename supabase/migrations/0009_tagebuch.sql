-- ---------------------------------------------------------------------------
-- MeinBaulotse — Tagebuch, Fotos und Wetter (Arbeitspaket 5)
--
-- Abschnitt 3.8: „Der Nutzer erlebt davon nichts. Er sieht ein Fotoalbum
-- seiner Baustelle. Die Beweisqualität ist ein Nebenprodukt."
--
-- Genau deshalb steht die Beweisqualität hier unten in der Datenbank und
-- nicht in der Oberfläche. Sie besteht aus drei Dingen:
--
-- 1. **24 Stunden Bearbeitungszeit, dann versiegelt.** Wer am Abend etwas
--    nachträgt, korrigiert sich; wer nach drei Wochen etwas ändert, schreibt
--    Geschichte um. Die Grenze dazwischen muss die Datenbank ziehen.
-- 2. **Eine Hash-Kette.** Jeder versiegelte Eintrag trägt die Prüfsumme des
--    vorherigen in seiner eigenen. Ein geänderter Eintrag bricht damit alle
--    folgenden — und das ist der Unterschied zwischen „unveränderlich, weil
--    wir es versprechen" und „nachweisbar unverändert".
-- 3. **Getrennte Zeitangaben beim Foto.** Was die Kamera sagt (`exif_taken_at`)
--    und was der Nutzer sagt (`stated_date`) stehen nebeneinander. Weichen sie
--    ab, wird das angezeigt und nicht versteckt.
--
-- Gelöscht wird nichts. Ein zurückgezogener Eintrag bleibt sichtbar und trägt
-- den Vermerk — eine Akte mit Lücken ist keine Akte.
-- ---------------------------------------------------------------------------

create type mbl.weather_source as enum ('dwd', 'manuell', 'keine');

create table diary_entry (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references project (id) on delete cascade,
  entry_date        date not null,
  body              text not null,
  author_member_id  uuid references project_member (id) on delete set null,
  author_role       mbl.member_role,
  weather           jsonb,
  weather_source    mbl.weather_source not null default 'keine',
  task_ids          uuid[] not null default '{}',
  -- Versiegelung
  locked_at         timestamptz,
  content_hash      text,
  prev_hash         text,
  -- Rückzug statt Löschung
  retracted_at      timestamptz,
  retraction_reason text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint diary_body_not_empty check (length(btrim(body)) > 0),
  constraint diary_sealed_has_hash check (locked_at is null or content_hash is not null),
  constraint diary_retraction_has_reason
    check (retracted_at is null or length(btrim(coalesce(retraction_reason, ''))) > 0)
);
create index diary_entry_project_idx on diary_entry (project_id, entry_date desc);
create index diary_entry_chain_idx on diary_entry (project_id, locked_at)
  where locked_at is not null;

comment on table diary_entry is
  'Bautagebuch nach Abschnitt 3.8. Nach locked_at unveränderlich, verkettet '
  'über content_hash und prev_hash.';
comment on column diary_entry.weather is
  'Zum Zeitpunkt des Eintrags eingefroren. Wetter von gestern lässt sich '
  'später nicht mehr abrufen, und ein nachgeholter Wert wäre keine Aussage '
  'über den Tag, sondern über den Abruf.';

create table media (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references project (id) on delete cascade,
  diary_entry_id   uuid references diary_entry (id) on delete set null,
  task_id          uuid references task (id) on delete set null,
  storage_path     text not null,
  mime             text not null,
  bytes            bigint not null,
  sha256           text not null,
  -- Was die Kamera sagt …
  exif_taken_at    timestamptz,
  exif_lat         numeric(9,6),
  exif_lon         numeric(9,6),
  -- … und was der Mensch sagt. Beides nebeneinander, nie ineinander.
  stated_date      date,
  caption          text,
  /** Erfüllt einen Fotoauftrag der Lotsenkarte: `<kartenschlüssel>#<index>`. */
  photo_prompt_key text,
  uploaded_by      uuid references project_member (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint media_bytes_positive check (bytes > 0),
  constraint media_sha256_form check (sha256 ~ '^[0-9a-f]{64}$'),
  unique (project_id, sha256)
);
create index media_project_idx on media (project_id, created_at desc);
create index media_entry_idx on media (diary_entry_id) where diary_entry_id is not null;
create index media_task_idx on media (task_id) where task_id is not null;
create index media_prompt_idx on media (project_id, photo_prompt_key)
  where photo_prompt_key is not null;

comment on column media.sha256 is
  'Prüfsumme des Originals, im Browser gerechnet. Sie ist zugleich der '
  'Schutz gegen Doppelablage: dasselbe Foto zweimal hochgeladen ist ein '
  'Eintrag, kein zweiter.';

do $$
declare
  target text;
begin
  foreach target in array array['diary_entry','media']
  loop
    execute format(
      'create trigger %I before update on %I for each row execute function mbl.touch_updated_at()',
      target || '_touch_updated_at', target
    );
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- Invariante 3.8: versiegelt heißt unveränderlich
--
-- Nach `locked_at` sind nur noch `retracted_at` und `retraction_reason`
-- änderbar. Der Trigger vergleicht die ganze Zeile statt einer Spaltenliste —
-- eine Liste wäre bei der nächsten Erweiterung still unvollständig, und die
-- neue Spalte wäre dann ausgerechnet die änderbare.
-- ---------------------------------------------------------------------------

create or replace function mbl.guard_diary_entry()
returns trigger
language plpgsql
as $$
declare
  vorher jsonb;
  nachher jsonb;
begin
  if tg_op = 'DELETE' then
    raise exception 'Ein Tagebucheintrag wird nicht gelöscht.'
      using errcode = 'raise_exception',
            hint = 'Zieh ihn zurück; er bleibt dann sichtbar und trägt den Vermerk.';
  end if;

  if old.locked_at is null then
    return new;
  end if;

  vorher  := to_jsonb(old) - 'retracted_at' - 'retraction_reason' - 'updated_at';
  nachher := to_jsonb(new) - 'retracted_at' - 'retraction_reason' - 'updated_at';

  if vorher is distinct from nachher then
    raise exception 'Dieser Eintrag ist seit % versiegelt und ändert sich nicht mehr.', old.locked_at
      using errcode = 'raise_exception',
            hint = 'Schreib einen neuen Eintrag, der den alten richtigstellt.';
  end if;

  -- Ein Rückzug lässt sich nicht zurücknehmen: Sonst wäre er ein Schalter
  -- und keine Aussage.
  if old.retracted_at is not null and new.retracted_at is null then
    raise exception 'Ein zurückgezogener Eintrag bleibt zurückgezogen.'
      using errcode = 'raise_exception';
  end if;

  return new;
end
$$;

create trigger diary_entry_sealed
  before update or delete on diary_entry
  for each row execute function mbl.guard_diary_entry();

-- ---------------------------------------------------------------------------
-- Die Hash-Kette
--
-- `content_hash = sha256(prev_hash || kanonischer_inhalt)`.
--
-- Kanonisch ist hier `jsonb`: Postgres speichert es mit sortierten Schlüsseln
-- und ohne Leerraum, die Textfassung ist damit für gleiche Werte identisch.
-- Ausgenommen sind die Felder, die zur Kette selbst gehören oder sich danach
-- noch ändern dürfen — sonst hinge die Prüfsumme an ihrem eigenen Ergebnis.
-- ---------------------------------------------------------------------------

create or replace function mbl.diary_canonical(entry diary_entry)
returns text
language sql
immutable
as $$
  select (
    to_jsonb(entry)
      - 'content_hash' - 'prev_hash' - 'locked_at' - 'updated_at'
      - 'retracted_at' - 'retraction_reason'
  )::text
$$;

create or replace function mbl.seal_diary_entry(p_entry uuid)
returns diary_entry
language plpgsql
security definer
set search_path = mbl, public, auth
as $$
declare
  eintrag diary_entry;
  vorheriger text;
  neuer_hash text;
begin
  select * into eintrag from diary_entry where id = p_entry;
  if not found then
    raise exception 'Diesen Tagebucheintrag gibt es nicht.';
  end if;
  if eintrag.locked_at is not null then
    return eintrag;
  end if;

  -- Der letzte versiegelte Eintrag desselben Bauvorhabens.
  select diary_entry.content_hash into vorheriger
    from diary_entry
   where diary_entry.project_id = eintrag.project_id and diary_entry.locked_at is not null
   order by diary_entry.locked_at desc, diary_entry.id desc
   limit 1;

  neuer_hash := encode(
    digest(coalesce(vorheriger, '') || mbl.diary_canonical(eintrag), 'sha256'),
    'hex'
  );

  update diary_entry
     set locked_at = now(), prev_hash = vorheriger, content_hash = neuer_hash
   where id = p_entry
   returning * into eintrag;

  return eintrag;
end
$$;

/**
 * Versiegelt, was älter als 24 Stunden ist.
 *
 * Wird beim Lesen und beim Schreiben des Tagebuchs aufgerufen. Ein eigener
 * Zeitgeber wäre eine weitere Stelle, die laufen muss, damit die Akte
 * stimmt — und die dann irgendwann nicht läuft.
 */
create or replace function mbl.seal_due_diary_entries(p_project uuid)
returns int
language plpgsql
security definer
set search_path = mbl, public, auth
as $$
declare
  faellig uuid;
  anzahl int := 0;
begin
  for faellig in
    select id from diary_entry
     where project_id = p_project
       and locked_at is null
       and created_at < now() - interval '24 hours'
     order by created_at, id
  loop
    perform mbl.seal_diary_entry(faellig);
    anzahl := anzahl + 1;
  end loop;
  return anzahl;
end
$$;

/**
 * Prüft die Kette und nennt den ersten Bruch.
 *
 * Gibt eine Zeile je versiegeltem Eintrag zurück, in der Reihenfolge der
 * Versiegelung. `ok = false` heißt: Der gespeicherte Hash passt nicht zum
 * Inhalt, oder die Verkettung stimmt nicht.
 */
-- Die Ausgabespalten tragen ein `out_`-Präfix. Ohne das verdeckt der
-- Parameter `locked_at` die gleichnamige Tabellenspalte, und Postgres bricht
-- die Abfrage als mehrdeutig ab — ein Fehler, den erst der erste Aufruf zeigt.
create or replace function mbl.verify_diary_chain(p_project uuid)
returns table (out_entry_id uuid, out_entry_date date, out_locked_at timestamptz,
               out_ok boolean, out_grund text)
language plpgsql
security definer
set search_path = mbl, public, auth
as $$
declare
  eintrag diary_entry;
  erwartet text;
  vorheriger text := null;
begin
  for eintrag in
    select * from diary_entry
     where project_id = p_project and diary_entry.locked_at is not null
     order by diary_entry.locked_at, diary_entry.id
  loop
    erwartet := encode(
      digest(coalesce(vorheriger, '') || mbl.diary_canonical(eintrag), 'sha256'),
      'hex'
    );

    out_entry_id := eintrag.id;
    out_entry_date := eintrag.entry_date;
    out_locked_at := eintrag.locked_at;

    if eintrag.prev_hash is distinct from vorheriger then
      out_ok := false;
      out_grund := 'Die Verkettung zum vorherigen Eintrag stimmt nicht.';
    elsif eintrag.content_hash is distinct from erwartet then
      out_ok := false;
      out_grund := 'Der Inhalt passt nicht zur gespeicherten Prüfsumme.';
    else
      out_ok := true;
      out_grund := null;
    end if;

    return next;
    vorheriger := eintrag.content_hash;
  end loop;
end
$$;

-- Rechte und RLS -----------------------------------------------------------

grant select, insert, update on diary_entry to authenticated;
grant select, insert, update on media to authenticated;

alter table diary_entry enable row level security;
alter table media       enable row level security;

create policy diary_entry_read on diary_entry for select to authenticated
  using (mbl.is_member(project_id));

-- Tagebuch schreiben dürfen owner, co_owner, contractor und expert
-- (Rechtematrix 2.2). Der Verfasser trägt sich selbst ein, niemand sonst:
-- Ein Eintrag im Namen eines anderen wäre in einer Akte wertlos.
create policy diary_entry_write on diary_entry for insert to authenticated
  with check (
    mbl.has_perm(project_id, 'diary.write')
    and author_member_id = mbl.current_member_id(project_id)
  );

-- Ändern darf nur der Verfasser, und nur solange nichts versiegelt ist. Was
-- die Policy erlaubt, begrenzt der Trigger zusätzlich — „fremden Eintrag
-- ändern" steht in der Rechtematrix bei **keiner** Rolle.
create policy diary_entry_update on diary_entry for update to authenticated
  using (
    mbl.has_perm(project_id, 'diary.write')
    and author_member_id = mbl.current_member_id(project_id)
  )
  with check (author_member_id = mbl.current_member_id(project_id));

create policy media_read on media for select to authenticated
  using (mbl.is_member(project_id));

create policy media_write on media for insert to authenticated
  with check (mbl.has_perm(project_id, 'diary.write'));

-- Die Bildunterschrift darf man nachtragen, das Foto selbst nicht ersetzen:
-- Pfad und Prüfsumme bleiben, wie sie sind (siehe Trigger).
create policy media_update on media for update to authenticated
  using (mbl.has_perm(project_id, 'diary.write'))
  with check (mbl.has_perm(project_id, 'diary.write'));

create or replace function mbl.guard_media()
returns trigger
language plpgsql
as $$
begin
  if new.storage_path is distinct from old.storage_path
     or new.sha256 is distinct from old.sha256
     or new.bytes is distinct from old.bytes
     or new.exif_taken_at is distinct from old.exif_taken_at then
    raise exception 'Ein hochgeladenes Foto wird nicht ausgetauscht.'
      using errcode = 'raise_exception',
            hint = 'Lade das andere Foto als neues hoch.';
  end if;
  return new;
end
$$;

create trigger media_immutable_original
  before update on media
  for each row execute function mbl.guard_media();

grant execute on all functions in schema mbl to anon, authenticated;
