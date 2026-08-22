-- ---------------------------------------------------------------------------
-- MeinBaulotse — Wissensschicht (Arbeitspaket 2)
--
-- Die Lotsenkarte aus Abschnitt 3.1 der Spezifikation: zu jedem Vorgang, der
-- in den Blick rückt, steht da, was gerade passiert, worauf der Bauherr selbst
-- achten kann, was er den GU fragen sollte und was hier typischerweise
-- schiefgeht.
--
-- Drei Entscheidungen, die den Aufbau erklären:
--
-- 1. **Karten sind global, nicht projekteigen.** Redaktionsinhalt gilt für
--    jeden Bau gleich. Projektbezogen ist nur, was der Nutzer damit tut —
--    gelesen (`guide_card_read`) und abgehakt (`checklist_item`).
--
-- 2. **Veröffentlicht heißt unveränderlich** (Invariante 4.1.6). Eine Karte,
--    die sich nachträglich ändern lässt, macht die Frage „welchen Rat hat der
--    Bauherr damals bekommen" unbeantwortbar — und genau diese Frage stellt
--    sich, wenn es später Streit gibt. Änderungen erzeugen eine neue Version;
--    die alte zeigt über `superseded_by` auf sie.
--
-- 3. **Die Zuordnung läuft über den Vorlagencode**, nicht über eine feste
--    Fremdschlüsselspalte am Vorgang. `task.guide_card_id` würde die Version
--    einfrieren, die beim Anlegen des Projekts galt: Eine überarbeitete Karte
--    erreichte dann niemanden, der schon baut. Über `template_task_codes`
--    findet jeder Vorgang die jeweils **neueste veröffentlichte** Karte.
--    Die Spalte bleibt trotzdem — als ausdrückliche Zuweisung von Hand.
-- ---------------------------------------------------------------------------

create table guide_card (
  id                       uuid primary key default gen_random_uuid(),
  key                      text not null,
  version                  int  not null default 1,
  phase_key                text not null references phase (key),
  trade_code               text,
  build_types              mbl.build_type[] not null
                             default '{efh_massiv,efh_fertighaus,sanierung,sonstiges}',
  template_task_codes      text[] not null default '{}',
  title                    text not null,
  whats_happening          text not null,
  watch_for                jsonb not null default '[]'::jsonb,
  questions_for_contractor jsonb not null default '[]'::jsonb,
  common_problems          jsonb not null default '[]'::jsonb,
  photo_prompts            jsonb not null default '[]'::jsonb,
  expert_recommended       boolean not null default false,
  expert_reason            text,
  sources                  jsonb not null default '[]'::jsonb,
  published_at             timestamptz,
  superseded_by            uuid references guide_card (id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (key, version),
  -- Eine Empfehlung ohne Begründung ist Angstmache. Wer eine Fachprüfung
  -- vorschlägt, sagt auch, wofür sie gut ist.
  constraint guide_card_expert_reason
    check (not expert_recommended or expert_reason is not null),
  constraint guide_card_version_positive check (version > 0),
  constraint guide_card_not_self check (superseded_by is distinct from id)
);
comment on table guide_card is
  'Lotsenkarte nach Abschnitt 3.1. Redaktionsinhalt als Daten, nicht als '
  'Konstanten im Code — pflegbar ohne Deployment. Nach published_at '
  'unveränderlich, siehe Trigger guide_card_immutable.';
comment on column guide_card.template_task_codes is
  'Vorgänge der Ablaufvorlage, für die diese Karte gilt (t01 … t38).';
comment on column guide_card.sources is
  'Herkunft jeder Aussage. Ohne Quelle keine Behauptung — daran hängt die '
  'Glaubwürdigkeit des ganzen Produkts (Abschnitt 6.3).';

create index guide_card_key_idx on guide_card (key, version desc);
create index guide_card_template_idx on guide_card using gin (template_task_codes);
create index guide_card_published_idx on guide_card (published_at) where published_at is not null;

-- Der Vorgang darf eine Karte ausdrücklich zugewiesen bekommen. Der
-- Fremdschlüssel stand in 0001 noch nicht, weil es die Tabelle nicht gab.
alter table task
  add constraint task_guide_card_fk
  foreign key (guide_card_id) references guide_card (id) on delete set null;

-- Was der Nutzer gesehen hat, und ob es ihm geholfen hat -------------------
--
-- „War das hilfreich?" ist laut Abschnitt 5.2 die einzige Metrik, die für die
-- Redaktion zählt. Deshalb steht sie hier und nicht in einem Analysewerkzeug.

create table guide_card_read (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references project (id) on delete cascade,
  guide_card_id uuid not null references guide_card (id) on delete cascade,
  task_id       uuid references task (id) on delete set null,
  member_id     uuid not null references project_member (id) on delete cascade,
  read_at       timestamptz not null default now(),
  helpful       boolean,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (project_id, guide_card_id, member_id)
);
comment on column guide_card_read.helpful is
  'NULL heißt: gelesen, nicht bewertet. Das ist der Normalfall und kein Mangel.';

create index guide_card_read_project_idx on guide_card_read (project_id, member_id);

-- Checkliste zum Vorgang ---------------------------------------------------
--
-- Entsteht aus `watch_for` der Karte, gehört aber dem Projekt: Der Haken ist
-- die Aussage „ich habe nachgesehen", und die überdauert die Kartenversion.

create table checklist_item (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references project (id) on delete cascade,
  task_id       uuid not null references task (id) on delete cascade,
  guide_card_id uuid references guide_card (id) on delete set null,
  text          text not null,
  why           text,
  sort_order    int  not null default 0,
  is_done       boolean not null default false,
  done_at       timestamptz,
  done_by       uuid references project_member (id) on delete set null,
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (task_id, guide_card_id, sort_order)
);
create index checklist_item_project_idx on checklist_item (project_id);
create index checklist_item_task_idx on checklist_item (task_id);

-- updated_at ---------------------------------------------------------------

do $$
declare
  target text;
begin
  foreach target in array array['guide_card','guide_card_read','checklist_item']
  loop
    execute format(
      'create trigger %I before update on %I for each row execute function mbl.touch_updated_at()',
      target || '_touch_updated_at', target
    );
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- Invariante 4.1.6: veröffentlichte Karten sind unveränderlich
--
-- Der Trigger vergleicht die ganze Zeile, nicht einzelne Spalten. Eine Liste
-- von Spaltennamen wäre spätestens bei der nächsten Erweiterung unvollständig,
-- und zwar still — die neue Spalte wäre dann ausgerechnet die änderbare.
--
-- Ausgenommen sind genau zwei Felder: `superseded_by`, denn die Verkettung zur
-- Nachfolgeversion entsteht zwangsläufig **nach** der Veröffentlichung, und
-- `updated_at`, das der Trigger daneben ohnehin setzt.
-- ---------------------------------------------------------------------------

create or replace function mbl.guard_guide_card()
returns trigger
language plpgsql
as $$
declare
  vorher jsonb;
  nachher jsonb;
begin
  if tg_op = 'DELETE' then
    if old.published_at is not null then
      raise exception 'Eine veröffentlichte Lotsenkarte wird nicht gelöscht: % (Fassung %)',
        old.key, old.version
        using errcode = 'raise_exception',
              hint = 'Veröffentliche eine neue Fassung und verkette sie über superseded_by.';
    end if;
    return old;
  end if;

  -- Solange sie unveröffentlicht ist, darf sich alles ändern.
  if old.published_at is null then
    return new;
  end if;

  vorher  := to_jsonb(old) - 'superseded_by' - 'updated_at';
  nachher := to_jsonb(new) - 'superseded_by' - 'updated_at';

  if vorher is distinct from nachher then
    raise exception 'Eine veröffentlichte Lotsenkarte ändert sich nicht: % (Fassung %)',
      old.key, old.version
      using errcode = 'raise_exception',
            hint = 'Sonst lässt sich später nicht mehr sagen, welchen Rat der Bauherr bekommen hat.';
  end if;

  return new;
end
$$;

create trigger guide_card_immutable
  before update or delete on guide_card
  for each row execute function mbl.guard_guide_card();

-- ---------------------------------------------------------------------------
-- Sichtbarkeit eines Vorgangs, für Tabellen, die an einem Vorgang hängen.
--
-- Ein Einzelgewerk sieht seinen eigenen Ausschnitt (Abschnitt 2.2, Zeile
-- „Lesen"). Ohne diese Prüfung sähe es über die Checkliste Vorgänge, die ihm
-- die Policy auf `task` gerade verwehrt.
-- ---------------------------------------------------------------------------

create or replace function mbl.task_visible(p_task uuid)
returns boolean
language sql
stable
security definer
set search_path = mbl, public, auth
as $$
  select exists (
    select 1 from task t
    where t.id = p_task
      and mbl.is_member(t.project_id)
      and mbl.trade_scope_ok(t.project_id, t.trade_id)
  )
$$;

-- Rechte und RLS -----------------------------------------------------------

-- Nur lesen. Redaktionsinhalt kommt über Migrationen herein, nicht über die
-- Anwendung — das ist die zweite Sperre neben dem Trigger.
grant select on guide_card to authenticated;
grant select, insert, update on guide_card_read to authenticated;
grant select, insert, update, delete on checklist_item to authenticated;

alter table guide_card      enable row level security;
alter table guide_card_read enable row level security;
alter table checklist_item  enable row level security;

-- Unveröffentlichte Entwürfe sieht niemand. Es gibt bewusst keine INSERT-,
-- UPDATE- oder DELETE-Policy auf guide_card.
create policy guide_card_read_published on guide_card for select to authenticated
  using (published_at is not null);

create policy guide_card_read_own on guide_card_read for select to authenticated
  using (mbl.is_member(project_id));

create policy guide_card_read_write on guide_card_read for insert to authenticated
  with check (
    mbl.is_member(project_id)
    and member_id = mbl.current_member_id(project_id)
  );

-- Die eigene Rückmeldung darf man ändern; eine fremde nicht.
create policy guide_card_read_update on guide_card_read for update to authenticated
  using (member_id = mbl.current_member_id(project_id))
  with check (member_id = mbl.current_member_id(project_id));

create policy checklist_item_read on checklist_item for select to authenticated
  using (mbl.is_member(project_id) and mbl.task_visible(task_id));

-- Wer abhaken darf, ist derselbe Kreis, der auch ins Tagebuch schreibt: Der
-- Haken ist eine Beobachtung, keine Terminänderung. Einzelgewerke und stille
-- Mitleser gehören nicht dazu.
create policy checklist_item_write on checklist_item for insert to authenticated
  with check (mbl.has_perm(project_id, 'diary.write') and mbl.task_visible(task_id));

create policy checklist_item_update on checklist_item for update to authenticated
  using (mbl.has_perm(project_id, 'diary.write') and mbl.task_visible(task_id))
  with check (mbl.has_perm(project_id, 'diary.write') and mbl.task_visible(task_id));

create policy checklist_item_delete on checklist_item for delete to authenticated
  using (mbl.has_perm(project_id, 'diary.write') and mbl.task_visible(task_id));

-- Nachfassen: Rechte auf die eben angelegten Funktionen in mbl.
grant execute on all functions in schema mbl to anon, authenticated;
