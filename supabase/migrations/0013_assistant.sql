-- ---------------------------------------------------------------------------
-- MeinBaulotse — Frag den Lotsen (Arbeitspaket 7)
--
-- Abschnitt 3.7. Der Assistent steht bewusst **hinter** der Redaktion und nicht
-- davor (Abschnitt 9, Punkt 4): „Er ist ein starkes Verkaufsargument, aber ohne
-- die Wissensschicht darunter halluziniert er."
--
-- Deshalb ist dieses Arbeitspaket vor allem eines: eine Datenschicht für
-- Nachvollziehbarkeit. Drei Spalten tragen sie:
--
--   context_snapshot     — was dem Modell tatsächlich mitgegeben wurde
--   cited_guide_card_ids — auf welchen redaktionellen Karten die Antwort steht
--   guardrails           — welche Leitplanken für diese Frage gegriffen haben
--
-- Ohne die erste lässt sich hinterher nicht sagen, ob eine falsche Antwort auf
-- falschen Daten beruhte oder auf einem falschen Modell. Ohne die zweite ist
-- „laut Lotsenkarte" eine Behauptung. Ohne die dritte weiß niemand, ob der
-- Rechtshinweis stand, weil die Regel griff, oder weil das Modell zufällig
-- höflich war.
--
-- Und eine vierte Spalte, die kein Produktmerkmal ist, sondern eine
-- Betriebsnotwendigkeit: `cost_cents`. Ein Assistent ohne Kostendeckel ist
-- keine Funktion, sondern eine offene Rechnung.
-- ---------------------------------------------------------------------------

create type mbl.assistant_role as enum ('user', 'assistant');

create table assistant_thread (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references project (id) on delete cascade,
  member_id  uuid references project_member (id) on delete set null,
  title      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index assistant_thread_project_idx on assistant_thread (project_id, created_at desc);

create table assistant_message (
  id         uuid primary key default gen_random_uuid(),
  thread_id  uuid not null references assistant_thread (id) on delete cascade,
  -- Redundant zur Unterhaltung, und mit Absicht: Jede Policy und jede
  -- Kostenabfrage will das Bauvorhaben, nicht den Umweg über zwei Verbünde.
  project_id uuid not null references project (id) on delete cascade,
  role       mbl.assistant_role not null,
  content    text not null,

  -- Was dem Modell mitgegeben wurde. Nur bei der Antwort gefüllt.
  context_snapshot     jsonb,
  cited_guide_card_ids uuid[] not null default '{}',
  -- Welche Leitplanken aus Abschnitt 3.7 für diese Frage gegriffen haben.
  guardrails           text[] not null default '{}',

  input_tokens  int,
  output_tokens int,
  -- In Zehntel-Cent, nicht in Cent: Eine einzelne Frage kostet weniger als
  -- einen Cent, und eine Spalte, die auf null rundet, summiert sich zu null.
  cost_millicents int not null default 0,

  created_at timestamptz not null default now()
);
create index assistant_message_thread_idx on assistant_message (thread_id, created_at);
create index assistant_message_cost_idx on assistant_message (project_id, created_at);

create trigger assistant_thread_touch_updated_at
  before update on assistant_thread
  for each row execute function mbl.touch_updated_at();

comment on column assistant_message.context_snapshot is
  'Was dem Modell mitgegeben wurde — der Nachweis für Abschnitt 3.7: „Der '
  'Kontext enthält ausschließlich Daten des eigenen Projekts."';

-- ---------------------------------------------------------------------------
-- Der Kostendeckel
--
-- Je Bauvorhaben und Kalendermonat. Nicht je Nutzer: Ein Bauvorhaben hat einen
-- Bauherrn, und der zahlt — ein Deckel je Beteiligtem wäre ein Deckel, den
-- man durch Einladen umgeht.
-- ---------------------------------------------------------------------------

create or replace function mbl.assistant_spent_millicents(p_project uuid)
returns bigint
language sql
stable
security definer
set search_path = mbl, public
as $$
  select coalesce(sum(cost_millicents), 0)::bigint
    from assistant_message
   where project_id = p_project
     and created_at >= date_trunc('month', now())
$$;

/** Wie viele Fragen dieses Mitglied in der letzten Stunde gestellt hat. */
create or replace function mbl.assistant_asked_last_hour(p_project uuid)
returns int
language sql
stable
security definer
set search_path = mbl, public
as $$
  select count(*)::int
    from assistant_message m
    join assistant_thread t on t.id = m.thread_id
   where m.project_id = p_project
     and m.role = 'user'
     and t.member_id = mbl.current_member_id(p_project)
     and m.created_at >= now() - interval '1 hour'
$$;

-- ---------------------------------------------------------------------------
-- Rechte
--
-- Der Assistent gehört dem, der fragt. Kein Beteiligter liest die Fragen eines
-- anderen — auch der Bauherr nicht die des Baubegleiters. Eine Frage ist oft
-- die ehrlichste Form von „ich weiß gerade nicht weiter", und wer sie mitlesen
-- kann, stellt sie nicht mehr.
-- ---------------------------------------------------------------------------

grant select, insert on assistant_thread   to authenticated;
grant select, insert on assistant_message  to authenticated;
grant update on assistant_thread to authenticated;

alter table assistant_thread  enable row level security;
alter table assistant_message enable row level security;

create policy assistant_thread_read on assistant_thread for select to authenticated
  using (member_id = mbl.current_member_id(project_id));

create policy assistant_thread_create on assistant_thread for insert to authenticated
  with check (
    mbl.is_member(project_id)
    and member_id = mbl.current_member_id(project_id)
  );

create policy assistant_thread_update on assistant_thread for update to authenticated
  using (member_id = mbl.current_member_id(project_id))
  with check (member_id = mbl.current_member_id(project_id));

create policy assistant_message_read on assistant_message for select to authenticated
  using (
    exists (
      select 1 from assistant_thread t
       where t.id = thread_id and t.member_id = mbl.current_member_id(t.project_id)
    )
  );

create policy assistant_message_create on assistant_message for insert to authenticated
  with check (
    exists (
      select 1 from assistant_thread t
       where t.id = thread_id
         and t.project_id = assistant_message.project_id
         and t.member_id = mbl.current_member_id(t.project_id)
    )
  );

-- Kein `update`, kein `delete`. Eine Unterhaltung mit einem Assistenten, die
-- sich nachträglich glätten lässt, taugt als Nachweis nichts — und genau als
-- Nachweis steht sie später in der Bauakte.
