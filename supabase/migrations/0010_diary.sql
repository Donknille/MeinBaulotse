-- ---------------------------------------------------------------------------
-- MeinBaulotse — Erfassung und Tagebuch (Arbeitspaket 5)
--
-- Abschnitt 3.8 endet mit dem Satz, der den ganzen Entwurf trägt:
--
--     „Der Nutzer erlebt davon nichts. Er sieht ein Fotoalbum seiner
--      Baustelle. Die Beweisqualität ist ein Nebenprodukt."
--
-- Alles hier folgt daraus. Der Bauherr drückt auf einen Knopf, die Kamera geht
-- auf, er tippt einen Satz. Was die Datenbank daraus macht — Versiegelung,
-- Hash-Kette, eingefrorenes Wetter, drei getrennte Zeitangaben — bekommt er
-- nie zu sehen und braucht es genau einmal: wenn zwei Jahre später jemand
-- bestreitet, dass die Dämmung an dem Tag noch nicht drin war.
--
-- Drei Entscheidungen, die man später nicht mehr nachrüsten kann:
--
-- 1. **Die Kette hängt an einer Reihenfolge, nicht an der Uhr.** `chain_index`
--    wird beim Versiegeln vergeben und ist innerhalb eines Bauvorhabens
--    lückenlos. Eine Kette über `created_at` wäre bei zwei Einträgen in
--    derselben Millisekunde nicht mehr eindeutig, und genau das passiert, wenn
--    eine Offline-Warteschlange drei Fotos auf einmal abliefert.
--
-- 2. **Die kanonische Form wird ausgeschrieben, nicht abgeleitet.**
--    `mbl.diary_canonical` nennt jedes Feld einzeln. `to_jsonb(zeile)` wäre
--    kürzer und würde bei der nächsten neuen Spalte jede bestehende Kette
--    brechen — rückwirkend und unreparierbar, denn die alten Hashes lassen
--    sich nicht neu bilden.
--
-- 3. **Zeitpunkte werden zu Text, bevor sie in den Hash gehen.**
--    `to_jsonb(timestamptz)` schreibt in der Zeitzone der Sitzung. Zwei
--    Servern in verschiedenen Zeitzonen dieselbe Zeile zu geben ergäbe zwei
--    Hashes. Deshalb überall `to_char(… at time zone 'UTC', …)`.
--
-- Und eine, die weniger offensichtlich ist: **Die Fotos hängen mit im Hash.**
-- Ohne das ließe sich nach dem Versiegeln das Bild austauschen, während der
-- Eintrag unversehrt aussieht — die Kette prüfte dann nur noch den Text.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Tagebuch
-- ---------------------------------------------------------------------------

create table diary_entry (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references project (id) on delete cascade,
  -- Der Tag, über den der Eintrag spricht. Nicht der Tag, an dem er entstand:
  -- Wer abends im Auto sitzt und den Vormittag nachträgt, meint den Vormittag.
  entry_date        date not null,
  body              text not null default '',
  author_member_id  uuid references project_member (id) on delete set null,
  author_role       mbl.member_role,
  -- Wetter der nächstgelegenen DWD-Station, mit dem Eintrag eingefroren.
  -- Später nachzuschlagen wäre wertlos: Ein Wetterarchiv sagt, wie das Wetter
  -- war, nicht was der Bauherr an dem Tag gesehen und deshalb notiert hat.
  weather           jsonb,
  task_ids          uuid[] not null default '{}',

  -- Versiegelung -----------------------------------------------------------
  locked_at         timestamptz,
  chain_index       int,
  content_hash      text,
  prev_hash         text,

  -- Zurückziehen statt löschen ---------------------------------------------
  retracted_at      timestamptz,
  retraction_reason text,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint diary_entry_sealed_complete
    check (locked_at is null or (content_hash is not null and chain_index is not null)),
  constraint diary_entry_retraction_reason
    check (retracted_at is null or coalesce(retraction_reason, '') <> '')
);

comment on table diary_entry is
  'Bautagebuch. 24 Stunden bearbeitbar, danach versiegelt und über eine '
  'Hash-Kette mit dem vorherigen Eintrag desselben Bauvorhabens verbunden '
  '(Abschnitt 3.8).';
comment on column diary_entry.chain_index is
  'Platz in der Kette, beim Versiegeln vergeben. Lückenlos je Bauvorhaben — '
  'eine Lücke ist selbst schon der Befund.';
comment on column diary_entry.weather is
  'Beobachtung der nächstgelegenen DWD-Station, eingefroren. Enthält Station, '
  'Entfernung und Bezugstag, damit die Angabe nachprüfbar bleibt.';

create unique index diary_entry_chain_key on diary_entry (project_id, chain_index)
  where chain_index is not null;
create index diary_entry_project_idx on diary_entry (project_id, entry_date desc);
create index diary_entry_open_idx on diary_entry (project_id, created_at)
  where locked_at is null;

create trigger diary_entry_touch_updated_at
  before update on diary_entry
  for each row execute function mbl.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Medien
--
-- Drei Zeitangaben, und das ist Absicht. Sie beantworten drei verschiedene
-- Fragen, und genau ihre Abweichungen sind die interessante Auskunft
-- (Abschnitt 3.8: „Abweichungen werden angezeigt, nicht versteckt"):
--
--   exif_taken_at  — was die Kamera in die Datei geschrieben hat
--   captured_at    — wann die Anwendung den Auslöser gesehen hat
--   stated_date    — welchen Tag der Nutzer dem Bild zuordnet
--
-- Eine einzige Spalte müsste sich für eine davon entscheiden und die anderen
-- beiden erfinden. Beim Erfassen im Flugmodus fallen sie auseinander: Die
-- Datei kommt womöglich ohne EXIF aus dem Kamera-Aufsatz des Browsers,
-- hochgeladen wird sie zwei Tage später, gemeint ist der Dienstag.
-- ---------------------------------------------------------------------------

create table media (
  id                    uuid primary key default gen_random_uuid(),
  project_id            uuid not null references project (id) on delete cascade,
  diary_entry_id        uuid references diary_entry (id) on delete restrict,
  task_id               uuid references task (id) on delete set null,

  -- Der Ablageort im Objektspeicher. Die Datei selbst geht nie durch den
  -- Anwendungsserver (Abschnitt 6.1) — der Browser lädt sie direkt hoch und
  -- meldet hier nur, dass und wohin.
  storage_path          text not null,
  mime                  text not null,
  bytes                 bigint not null,
  -- Prüfsumme des Originals, im Browser gebildet. Sie ist der Grund, warum
  -- ein Foto in einer versiegelten Bauakte nicht mehr austauschbar ist.
  sha256                text not null,

  exif_taken_at         timestamptz,
  exif_lat              numeric(9,6),
  exif_lon              numeric(9,6),
  captured_at           timestamptz,
  stated_date           date,

  floorplan_x           numeric(6,4),
  floorplan_y           numeric(6,4),
  floor                 text,
  -- Erfüllt einen Fotoauftrag aus der Lotsenkarte (`photo_prompts[].key`).
  photo_prompt_key      text,
  caption               text,

  uploaded_by_member_id uuid references project_member (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint media_bytes_positive check (bytes > 0),
  constraint media_sha256_shape   check (sha256 ~ '^[0-9a-f]{64}$'),
  -- Ein Fotoauftrag hängt immer an einem Vorgang. Ohne ihn wäre „erfüllt"
  -- eine Aussage ohne Bezug.
  constraint media_prompt_needs_task
    check (photo_prompt_key is null or task_id is not null)
);

comment on table media is
  'Baustellenfotos und Anhänge. Die Datei liegt im Objektspeicher, hier steht '
  'nur, wo sie liegt und was sie belegt.';
comment on column media.sha256 is
  'Prüfsumme des Originals, im Browser gebildet. Geht in den Hash des '
  'Tagebucheintrags ein — ein versiegeltes Foto ist damit nicht mehr '
  'austauschbar, ohne dass die Kette bricht.';

create unique index media_project_sha_key on media (project_id, sha256);
create index media_project_idx on media (project_id, created_at desc);
create index media_entry_idx on media (diary_entry_id) where diary_entry_id is not null;
create index media_prompt_idx on media (task_id, photo_prompt_key)
  where photo_prompt_key is not null;

create trigger media_touch_updated_at
  before update on media
  for each row execute function mbl.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Die kanonische Form
--
-- Jedes Feld einzeln genannt, Zeitpunkte als UTC-Text, Fotos nach ihrer
-- Prüfsumme sortiert. Was hier nicht steht, ist bewusst nicht Teil der
-- Aussage: `updated_at` ändert sich beim Zurückziehen, `retracted_at`
-- ebenfalls — beides darf die Kette nicht brechen, sonst wäre Zurückziehen
-- gleichbedeutend mit Fälschen.
-- ---------------------------------------------------------------------------

create or replace function mbl.diary_canonical(p_entry uuid)
returns jsonb
language sql
stable
security definer
set search_path = mbl, public
as $$
  select jsonb_build_object(
    'id',               e.id,
    'project_id',       e.project_id,
    'entry_date',       to_char(e.entry_date, 'YYYY-MM-DD'),
    'body',             e.body,
    'author_member_id', e.author_member_id,
    'author_role',      e.author_role::text,
    'weather',          coalesce(e.weather, 'null'::jsonb),
    'task_ids',         (select coalesce(jsonb_agg(t order by t), '[]'::jsonb)
                           from unnest(e.task_ids) as t),
    'created_at',       to_char(e.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'media',            (select coalesce(jsonb_agg(
                                  jsonb_build_object(
                                    'sha256',        m.sha256,
                                    'storage_path',  m.storage_path,
                                    'bytes',         m.bytes,
                                    'caption',       m.caption,
                                    'exif_taken_at', case when m.exif_taken_at is null then null
                                                      else to_char(m.exif_taken_at at time zone 'UTC',
                                                                   'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end
                                  ) order by m.sha256), '[]'::jsonb)
                           from media m where m.diary_entry_id = e.id)
  )
  from diary_entry e
  where e.id = p_entry
$$;

create or replace function mbl.diary_hash(p_entry uuid, p_prev text)
returns text
language sql
stable
security definer
set search_path = mbl, public
as $$
  select encode(
    sha256(convert_to(mbl.diary_canonical(p_entry)::text || coalesce(p_prev, ''), 'UTF8')),
    'hex')
$$;
comment on function mbl.diary_hash(uuid, text) is
  'sha256(canonical_json(entry) + prev_hash), Abschnitt 3.8.';

-- ---------------------------------------------------------------------------
-- Versiegeln
--
-- Eine Uhr löst keinen Trigger aus. Die Versiegelung passiert deshalb faul:
-- Die Anwendung ruft diese Funktion beim Lesen und Schreiben des Tagebuchs
-- auf, und sie holt nach, was fällig ist. Das genügt — ein Eintrag, den nie
-- jemand ansieht, muss auch nicht versiegelt sein, und sobald jemand ihn
-- ansieht, ist er es.
--
-- `security definer`, weil die Kette dem Bauvorhaben gehört und nicht dem
-- Verfasser: Der Bauherr, der sein Tagebuch aufschlägt, versiegelt damit auch
-- den Eintrag des Generalunternehmers von vorgestern. Er ändert ihn nicht — er
-- friert ihn ein.
-- ---------------------------------------------------------------------------

create or replace function mbl.seal_due_diary_entries(
  p_project uuid,
  p_now     timestamptz default now()
)
returns int
language plpgsql
security definer
set search_path = mbl, public
as $$
declare
  faellig   record;
  vorher    text;
  neuer     text;
  platz     int;
  anzahl    int := 0;
begin
  if not mbl.is_member(p_project) then
    return 0;
  end if;

  select content_hash, chain_index into vorher, platz
    from diary_entry
   where project_id = p_project and locked_at is not null
   order by chain_index desc
   limit 1;
  platz := coalesce(platz, 0);

  for faellig in
    select id from diary_entry
     where project_id = p_project
       and locked_at is null
       and created_at <= p_now - interval '24 hours'
     order by created_at, id
     for update
  loop
    platz := platz + 1;
    neuer := mbl.diary_hash(faellig.id, vorher);
    update diary_entry
       set locked_at    = p_now,
           chain_index  = platz,
           prev_hash    = vorher,
           content_hash = neuer
     where id = faellig.id;
    vorher := neuer;
    anzahl := anzahl + 1;
  end loop;

  if anzahl > 0 then
    update project set diary_head_hash = vorher where id = p_project;
  end if;
  return anzahl;
end
$$;

-- ---------------------------------------------------------------------------
-- Prüfen
--
-- Gibt je versiegeltem Eintrag zurück, ob er noch zu seinem Hash passt und ob
-- er noch am richtigen Vorgänger hängt. Der erste `ok = false` ist die
-- Fundstelle; alles danach ist Folgeschaden.
--
-- Diese Funktion ist der Grund, warum die ganze Mechanik existiert. Sie
-- beantwortet die einzige Frage, die im Streitfall zählt: Ist das hier noch
-- das, was damals aufgeschrieben wurde?
-- ---------------------------------------------------------------------------

create or replace function mbl.verify_diary_chain(p_project uuid)
returns table (
  chain_index int,
  entry_id    uuid,
  entry_date  date,
  ok          boolean,
  reason      text
)
language plpgsql
stable
security definer
set search_path = mbl, public
as $$
declare
  eintrag  record;
  erwartet text;
  vorher   text := null;
  platz    int  := 0;
begin
  if not mbl.is_member(p_project) then
    return;
  end if;

  for eintrag in
    select e.id, e.chain_index, e.entry_date, e.content_hash, e.prev_hash
      from diary_entry e
     where e.project_id = p_project and e.locked_at is not null
     order by e.chain_index
  loop
    platz := platz + 1;
    erwartet := mbl.diary_hash(eintrag.id, vorher);

    chain_index := eintrag.chain_index;
    entry_id    := eintrag.id;
    entry_date  := eintrag.entry_date;

    if eintrag.chain_index <> platz then
      ok := false;
      reason := format('In der Kette fehlt Platz %s.', platz);
    elsif eintrag.prev_hash is distinct from vorher then
      ok := false;
      reason := 'Der Eintrag hängt nicht mehr am vorherigen.';
    elsif eintrag.content_hash is distinct from erwartet then
      ok := false;
      reason := 'Der Inhalt passt nicht mehr zu seiner Prüfsumme.';
    else
      ok := true;
      reason := null;
    end if;

    return next;
    -- Weitergerechnet wird mit dem **gespeicherten** Hash, nicht mit dem
    -- erwarteten. Sonst meldete eine einzelne Änderung die ganze restliche
    -- Kette als kaputt, und die Fundstelle ginge im Rauschen unter.
    vorher := eintrag.content_hash;
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- Was nach dem Versiegeln noch geht
-- ---------------------------------------------------------------------------

create or replace function mbl.guard_diary_locked()
returns trigger
language plpgsql
as $$
begin
  if old.locked_at is null then
    return new;
  end if;

  if (to_jsonb(new) - 'retracted_at' - 'retraction_reason' - 'updated_at')
     is distinct from (to_jsonb(old) - 'retracted_at' - 'retraction_reason' - 'updated_at') then
    raise exception
      'Dieser Eintrag ist versiegelt. Zurückziehen kannst du ihn — er bleibt dann sichtbar und trägt deinen Grund.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;

create trigger diary_entry_guard_locked
  before update on diary_entry
  for each row execute function mbl.guard_diary_locked();

-- Ein versiegelter Eintrag trägt die Prüfsummen seiner Fotos im Hash. Ein Foto
-- danach zu tauschen oder zu entfernen bräche die Kette — deshalb wird es hier
-- gar nicht erst zugelassen, mit einer Fehlermeldung statt mit einem Befund.
create or replace function mbl.guard_media_sealed()
returns trigger
language plpgsql
as $$
declare
  betroffen uuid;
begin
  betroffen := coalesce(new.diary_entry_id, old.diary_entry_id);
  if tg_op = 'UPDATE' and old.diary_entry_id is distinct from new.diary_entry_id then
    -- Beide Seiten prüfen: weg von einem versiegelten Eintrag ist genauso
    -- wenig erlaubt wie hin zu einem.
    if exists (select 1 from diary_entry
                where id in (old.diary_entry_id, new.diary_entry_id)
                  and locked_at is not null) then
      raise exception 'Dieses Foto gehört zu einem versiegelten Eintrag und bleibt dort.'
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  if betroffen is not null
     and exists (select 1 from diary_entry where id = betroffen and locked_at is not null) then
    raise exception 'Dieses Foto gehört zu einem versiegelten Eintrag und bleibt, wie es ist.'
      using errcode = 'insufficient_privilege';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end
$$;

create trigger media_guard_sealed
  before update or delete on media
  for each row execute function mbl.guard_media_sealed();

-- ---------------------------------------------------------------------------
-- Rechte
-- ---------------------------------------------------------------------------

-- Kein `delete` auf diary_entry — nicht als Policy, sondern als entzogenes
-- Recht. Dieselbe Bauweise wie bei `schedule_change`: Eine Policy, die nichts
-- durchlässt, ist eine Meinung; ein fehlendes Recht ist eine Tatsache.
grant select, insert, update on diary_entry to authenticated;
grant select, insert, update, delete on media to authenticated;

alter table diary_entry enable row level security;
alter table media       enable row level security;

-- Der eigene Ausschnitt für Einzelgewerke: Ein Fliesenleger liest die Einträge
-- zu seinen Vorgängen, nicht das Tagebuch des Bauherrn.
create or replace function mbl.diary_in_scope(p_project uuid, p_tasks uuid[])
returns boolean
language sql
stable
security definer
set search_path = mbl, public
as $$
  select case
    when mbl.member_role(p_project) <> 'trade' then true
    else exists (
      select 1 from task t
       where t.id = any(p_tasks)
         and t.trade_id is not distinct from mbl.member_trade(p_project)
    )
  end
$$;

create policy diary_read on diary_entry for select to authenticated
  using (mbl.is_member(project_id) and mbl.diary_in_scope(project_id, task_ids));

create policy diary_create on diary_entry for insert to authenticated
  with check (
    mbl.has_perm(project_id, 'diary.write')
    -- Kein Eintrag im fremden Namen. Die Rechtematrix kennt die Zeile
    -- „Fremden Eintrag ändern" für keine Rolle; sie fremd anzulegen wäre
    -- dasselbe in schneller.
    and author_member_id = mbl.current_member_id(project_id)
  );

create policy diary_update on diary_entry for update to authenticated
  using (
    mbl.has_perm(project_id, 'diary.write')
    and author_member_id = mbl.current_member_id(project_id)
  )
  with check (
    mbl.has_perm(project_id, 'diary.write')
    and author_member_id = mbl.current_member_id(project_id)
  );

create policy media_read on media for select to authenticated
  using (mbl.is_member(project_id) and mbl.trade_scope_ok(project_id, (
    select t.trade_id from task t where t.id = media.task_id
  )));

create policy media_create on media for insert to authenticated
  with check (
    (mbl.has_perm(project_id, 'diary.write') or mbl.has_perm(project_id, 'defect.write'))
    and uploaded_by_member_id = mbl.current_member_id(project_id)
  );

create policy media_update on media for update to authenticated
  using (uploaded_by_member_id = mbl.current_member_id(project_id))
  with check (uploaded_by_member_id = mbl.current_member_id(project_id));

create policy media_delete on media for delete to authenticated
  using (uploaded_by_member_id = mbl.current_member_id(project_id));
