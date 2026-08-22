-- ---------------------------------------------------------------------------
-- MeinBaulotse — Wissensschicht (Arbeitspaket 2)
--
-- Die Lotsenkarte aus Abschnitt 3.1 der Spezifikation. Sie ist der Grund,
-- warum es dieses Produkt gibt: Ein Bauherr scheitert selten daran, dass er
-- nicht weiß, wann der Fliesenleger kommt. Er scheitert daran, dass er nicht
-- weiß, was er nicht weiß.
--
-- Drei Tabellen, drei verschiedene Sorten Daten, und die Trennung ist der Kern
-- des Entwurfs:
--
--   guide_card       Redaktionsinhalt. Gehört niemandem, gilt für alle,
--                    unveränderlich nach der Veröffentlichung.
--   guide_card_read  Was ein einzelner Mensch gesehen und wie er es bewertet
--                    hat. Gehört seinem Projekt.
--   checklist_item   Sein Haken an einer Zeile der Karte. Ebenfalls seins.
--
-- Der Redaktionsinhalt liegt als Daten in der Datenbank, nicht als Konstante
-- im Code (Regel 5) — sonst braucht jede Korrektur an einem Satz eine
-- Auslieferung, und dann wird sie nicht gemacht.
-- ---------------------------------------------------------------------------

-- Redaktionsinhalt ----------------------------------------------------------

create table guide_card (
  id                       uuid primary key default gen_random_uuid(),
  key                      text not null,
  version                  int  not null default 1,
  phase_key                text not null references phase (key),
  trade_code               text,
  build_types              mbl.build_type[] not null default '{}',
  -- An welche Vorgänge der Ablaufvorlage die Karte gehört. Über diese Codes
  -- findet ein Projekt seine Karten, ohne dass die Redaktion Projekte kennen
  -- müsste.
  task_codes               text[] not null default '{}',
  title                    text not null,
  whats_happening          text not null,
  watch_for                jsonb not null default '[]',  -- [{text, why}]
  questions_for_contractor jsonb not null default '[]',  -- [{question, why_it_matters}]
  common_problems          jsonb not null default '[]',  -- [{problem, how_to_spot}]
  photo_prompts            jsonb not null default '[]',  -- [{key, what, why, before_task_code}]
  expert_recommended       boolean not null default false,
  expert_reason            text,
  -- Trägt die Karte eine Gesetzesstelle, erscheint der feste Zusatz aus
  -- CI 11.3: „Hinweis auf eine Gesetzesstelle, keine Rechtsberatung."
  legal_note               boolean not null default false,
  sources                  jsonb not null default '[]',  -- [{title, reference}]
  published_at             timestamptz,
  superseded_by            uuid references guide_card (id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (key, version),
  -- Eine Empfehlung ohne Begründung ist eine Behauptung. Abschnitt 1.4 der
  -- Spezifikation verlangt, dass die Grenze des Produkts offen benannt wird —
  -- dann auch mit Grund.
  constraint guide_card_expert_reason
    check (not expert_recommended or expert_reason is not null),
  constraint guide_card_version_positive check (version >= 1),
  constraint guide_card_not_self_superseded check (superseded_by is distinct from id)
);
comment on table guide_card is
  'Lotsenkarte nach Abschnitt 3.1. Nach published_at unveränderlich; eine '
  'Korrektur ist eine neue Version, die alte wird über superseded_by verkettet.';
comment on column guide_card.task_codes is
  'Codes aus plan_template_task. Die Zuordnung zu einem konkreten Vorgang '
  'passiert einmalig beim Anlegen des Projekts und friert damit die Fassung '
  'ein, die der Bauherr tatsächlich gesehen hat.';
comment on column guide_card.sources is
  'Herkunft jeder Aussage. Ohne Quelle keine Aussage — an dieser Stelle steht '
  'die Glaubwürdigkeit des gesamten Produkts (Abschnitt 6.3).';

create index guide_card_task_codes_idx on guide_card using gin (task_codes);
create index guide_card_phase_idx on guide_card (phase_key);
-- Je Schlüssel gibt es höchstens eine gültige Fassung: die, die niemand
-- abgelöst hat.
create unique index guide_card_current_key on guide_card (key)
  where superseded_by is null and published_at is not null;

-- Erst jetzt kann die Verknüpfung aus 0001 auch eine echte Beziehung sein.
alter table task
  add constraint task_guide_card_fk
  foreign key (guide_card_id) references guide_card (id) on delete set null;

-- Was der Nutzer gesehen hat -------------------------------------------------

create table guide_card_read (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references project (id) on delete cascade,
  guide_card_id uuid not null references guide_card (id) on delete cascade,
  member_id     uuid not null references project_member (id) on delete cascade,
  read_at       timestamptz not null default now(),
  -- Die einzige Metrik, die für die Redaktion zählt (Abschnitt 5.2).
  -- `null` heißt: gelesen, aber nicht bewertet.
  helpful       boolean,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (project_id, guide_card_id, member_id)
);
comment on table guide_card_read is
  'Gelesen-Stand und Rückmeldung je Mensch und Projekt. Grundlage für die '
  'Wiedervorlage und für die Frage, ob eine Karte ihren Zweck erfüllt.';

create index guide_card_read_project_idx on guide_card_read (project_id);
create index guide_card_read_card_idx on guide_card_read (guide_card_id);

-- Checklisten ----------------------------------------------------------------

create table checklist_item (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references project (id) on delete cascade,
  task_id       uuid not null references task (id) on delete cascade,
  guide_card_id uuid references guide_card (id) on delete set null,
  -- Verweis auf die Zeile der Karte, aus der der Haken stammt. Bleibt gültig,
  -- wenn die Karte eine neue Fassung bekommt: Der Haken hängt an der Aussage,
  -- nicht an ihrer Formulierung.
  source_key    text not null,
  text          text not null,
  is_done       boolean not null default false,
  done_at       timestamptz,
  done_by       uuid references project_member (id) on delete set null,
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (project_id, task_id, source_key)
);
comment on table checklist_item is
  'Der Haken des Bauherrn an einer Zeile aus watch_for. Entsteht erst beim '
  'ersten Antippen — eine Checkliste, die schon vor dem ersten Blick in der '
  'Datenbank steht, ist eine Liste offener Aufgaben, und das schreckt ab.';

create index checklist_item_task_idx on checklist_item (task_id);
create index checklist_item_project_idx on checklist_item (project_id);

-- updated_at -----------------------------------------------------------------

create trigger guide_card_touch_updated_at
  before update on guide_card
  for each row execute function mbl.touch_updated_at();

create trigger guide_card_read_touch_updated_at
  before update on guide_card_read
  for each row execute function mbl.touch_updated_at();

create trigger checklist_item_touch_updated_at
  before update on checklist_item
  for each row execute function mbl.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Invariante 6 aus Abschnitt 4.1: veröffentlichte Karten sind unveränderlich.
--
-- Der Grund ist nicht Ordnungsliebe. Wenn ein Bauherr im Mai gelesen hat, die
-- Aufbauhöhe müsse vor dem Estrich feststehen, und im September steht dort
-- etwas anderes, dann lässt sich hinterher nicht mehr sagen, welchen Rat er
-- damals bekommen hat. Genau diese Frage ist die einzige, die im Streitfall
-- zählt.
--
-- Die Sperre sitzt im Trigger und nicht in einer Policy, weil sie auch dann
-- gelten muss, wenn jemand mit vollen Rechten im SQL-Editor sitzt. Das ist die
-- Abnahmebedingung von AP 2: „Eine veröffentlichte Karte lässt sich per SQL
-- nicht ändern."
--
-- Ausgenommen ist genau ein Feld: `superseded_by`. Es ist der einzige Weg,
-- eine Karte abzulösen — und es lässt sich nur einmal setzen.
-- ---------------------------------------------------------------------------

create or replace function mbl.guard_guide_card_published()
returns trigger
language plpgsql
as $$
declare
  vorher jsonb;
  nachher jsonb;
begin
  if tg_op = 'DELETE' then
    if old.published_at is not null then
      raise exception
        'Die Lotsenkarte %/% ist veröffentlicht und kann nicht gelöscht werden.',
        old.key, old.version
        using errcode = 'raise_exception',
              hint = 'Eine überholte Karte wird abgelöst, nicht entfernt: superseded_by setzen.';
    end if;
    return old;
  end if;

  if old.published_at is null then
    return new;
  end if;

  -- `updated_at` gehört nicht zur Aussage, `superseded_by` ist die erlaubte
  -- Ausnahme. Alles andere wird verglichen — auch Spalten, die es heute noch
  -- nicht gibt.
  vorher  := to_jsonb(old) - 'superseded_by' - 'updated_at';
  nachher := to_jsonb(new) - 'superseded_by' - 'updated_at';

  if nachher is distinct from vorher then
    raise exception
      'Die Lotsenkarte %/% ist seit % veröffentlicht und unveränderlich.',
      old.key, old.version, old.published_at
      using errcode = 'raise_exception',
            hint = 'Änderungen entstehen als neue Version; die alte wird über superseded_by verkettet.';
  end if;

  if old.superseded_by is not null and new.superseded_by is distinct from old.superseded_by then
    raise exception
      'Die Lotsenkarte %/% ist bereits abgelöst. Die Verkettung bleibt, wie sie ist.',
      old.key, old.version
      using errcode = 'raise_exception';
  end if;

  return new;
end
$$;

create trigger guide_card_guard_published
  before update or delete on guide_card
  for each row execute function mbl.guard_guide_card_published();

-- ---------------------------------------------------------------------------
-- Rechte
-- ---------------------------------------------------------------------------

-- Redaktionsinhalt ist eine Nachschlagetabelle: lesen genügt. Geschrieben wird
-- er über Migrationen und den SQL-Editor, nicht aus der Anwendung heraus —
-- deshalb bekommt die Anwendungsrolle hier kein INSERT.
grant select on guide_card to authenticated;

grant select, insert, update on guide_card_read to authenticated;
grant select, insert, update, delete on checklist_item to authenticated;

alter table guide_card      enable row level security;
alter table guide_card_read enable row level security;
alter table checklist_item  enable row level security;

create policy guide_card_read_all on guide_card for select to authenticated
  using (true);

-- Gelesen-Stand und Rückmeldung gehören dem Menschen, der sie abgegeben hat.
-- Sichtbar sind sie im Projekt — sonst wüsste ein zweiter Bauherr nicht, dass
-- der erste die Karte schon kennt.
create policy guide_card_read_select on guide_card_read for select to authenticated
  using (mbl.is_member(project_id));

create policy guide_card_read_insert on guide_card_read for insert to authenticated
  with check (
    mbl.is_member(project_id)
    and member_id = mbl.current_member_id(project_id)
  );

create policy guide_card_read_update on guide_card_read for update to authenticated
  using (member_id = mbl.current_member_id(project_id))
  with check (member_id = mbl.current_member_id(project_id));

-- Die Checkliste ist das Werkzeug der Bauherrenseite und des Baubegleiters.
--
-- Sie steht bewusst **nicht** in der Rechtematrix aus Abschnitt 2.2: Die
-- Matrix beschreibt die Handlungen am Bauvorhaben, und ein Haken an einer
-- Merkzeile ist keine. Deshalb wird hier über die Rolle entschieden und nicht
-- über `mbl.has_perm` — eine erfundene Matrixzeile wäre die schlechtere
-- Auskunft.
--
-- `viewer` liest nur (Abschnitt 2.1), `contractor` und `trade` führen aus; die
-- Merkliste des Bauherrn ist nicht ihre.
create policy checklist_item_select on checklist_item for select to authenticated
  using (mbl.is_member(project_id));

create policy checklist_item_insert on checklist_item for insert to authenticated
  with check (
    mbl.is_member(project_id)
    and mbl.member_role(project_id) in ('owner', 'co_owner', 'expert')
  );

create policy checklist_item_update on checklist_item for update to authenticated
  using (
    mbl.is_member(project_id)
    and mbl.member_role(project_id) in ('owner', 'co_owner', 'expert')
  )
  with check (
    mbl.is_member(project_id)
    and mbl.member_role(project_id) in ('owner', 'co_owner', 'expert')
  );

create policy checklist_item_delete on checklist_item for delete to authenticated
  using (
    mbl.is_member(project_id)
    and mbl.member_role(project_id) in ('owner', 'co_owner', 'expert')
  );
