-- ---------------------------------------------------------------------------
-- MeinBaulotse — Frag den Lotsen (Arbeitspaket 7)
--
-- Abschnitt 3.7: „Ein Chat mit Kontext auf das eigene Projekt." Der Nachsatz
-- in 6.4 ist der eigentliche Auftrag:
--
--   „Der Assistent bekommt ausschließlich Daten des eigenen Projekts in den
--    Kontext; der Kontextaufbau ist serverseitig und nicht vom Client
--    steuerbar."
--
-- Die zweite Hälfte erledigt der Anwendungscode. Die erste erledigt diese
-- Datei — genauer: sie erledigt sie **nicht** und muss es auch nicht. Der
-- Kontext wird über `withUserTx` gelesen, also unter denselben Policies wie
-- jede andere Abfrage. Es gibt keinen Pfad, auf dem der Assistent mehr sähe
-- als der Fragende. Das ist der Grund, warum hier so wenig steht.
-- ---------------------------------------------------------------------------

create table assistant_conversation (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references project (id) on delete cascade,
  -- Wer gefragt hat. Ein Gespräch gehört einem Menschen, nicht einem Projekt:
  -- Der Bauherr soll nicht sehen müssen, was der GU den Lotsen fragt.
  member_id   uuid not null references project_member (id) on delete cascade,
  title       text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index assistant_conversation_idx
  on assistant_conversation (project_id, member_id, updated_at desc);

create trigger assistant_conversation_touch_updated_at
  before update on assistant_conversation
  for each row execute function mbl.touch_updated_at();

create type mbl.assistant_role as enum ('frage', 'antwort');

create table assistant_message (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references assistant_conversation (id) on delete cascade,
  project_id      uuid not null references project (id) on delete cascade,
  role            mbl.assistant_role not null,
  text            text not null,
  /** Welche Lotsenkarten die Antwort trägt (Abschnitt 3.7). */
  guide_card_keys text[] not null default '{}',
  /** Welche Leitplanken gegriffen haben — 'recht', 'mangel', 'kosten'. */
  guardrails      text[] not null default '{}',
  /**
   * Die Hinweise im Wortlaut, nicht nur ihre Art.
   *
   * Sie ließen sich aus `guardrails` neu erzeugen — aber nur ungefähr: Die
   * Gesetzesstelle hängt an der Frage, und die Texte ändern sich. Ein
   * Bauherr, der im nächsten Jahr nachliest, worauf er sich verlassen hat,
   * soll den Hinweis von damals sehen und nicht den von heute. Aus demselben
   * Grund ist der ganze Beitrag append-only.
   */
  hints           jsonb not null default '[]',
  input_tokens    int not null default 0,
  output_tokens   int not null default 0,
  cost_cents      int not null default 0,
  created_at      timestamptz not null default now()
);
create index assistant_message_idx on assistant_message (conversation_id, created_at);

comment on table assistant_message is
  'Append-only. Was der Lotse einmal geraten hat, bleibt nachlesbar — sonst '
  'liesse sich bei Streit nicht sagen, worauf der Bauherr sich verlassen hat.';

create or replace function mbl.forbid_assistant_change()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Ein Gesprächsbeitrag ist append-only.'
    using errcode = 'raise_exception',
          hint = 'Frag neu; die alte Antwort bleibt stehen.';
end
$$;

create trigger assistant_message_append_only
  before update or delete on assistant_message
  for each row execute function mbl.forbid_assistant_change();

-- ---------------------------------------------------------------------------
-- Kostendeckel und Ratenbegrenzung (Abschnitt 6.4)
--
-- Beides gehört in die Datenbank, aus demselben Grund wie beim Gast-Token:
-- Ein Zähler im Serverprozess zählt nach dem nächsten Kaltstart wieder von
-- vorn, und auf Vercel ist der nächste Kaltstart immer gleich.
--
-- Der Deckel ist ein Monatsdeckel je Bauvorhaben. Er schützt nicht vor
-- Missbrauch — dagegen hilft die Ratenbegrenzung — sondern vor der
-- Überraschung: Ein Produkt, dessen laufende Kosten ein Nutzer beliebig
-- hochtreiben kann, ist kein Produkt, sondern eine offene Rechnung.
-- ---------------------------------------------------------------------------

create table assistant_budget (
  project_id        uuid primary key references project (id) on delete cascade,
  /** Der Monat, für den gezählt wird, als 'YYYY-MM'. */
  month             text not null,
  spent_cents       int not null default 0,
  window_started_at timestamptz,
  window_count      int not null default 0,
  updated_at        timestamptz not null default now()
);

create trigger assistant_budget_touch_updated_at
  before update on assistant_budget
  for each row execute function mbl.touch_updated_at();

/**
 * Einen Zug beim Lotsen anfordern.
 *
 * Gibt zurück, ob er stattfinden darf — und wenn nicht, woran es liegt. Die
 * Unterscheidung ist der Punkt: „zu schnell" ist eine Bitte um Geduld,
 * „Deckel erreicht" ist eine Aussage über den Monat. Ein einziger Fehlertext
 * für beides wäre für den Bauherrn nicht zu unterscheiden.
 *
 * `security definer`, damit der Zähler nicht dem gehört, der gezählt wird.
 * Die Mitgliedschaft prüft die Funktion selbst — sie ist damit kein Weg an
 * der RLS vorbei, sondern eine Abfrage mit derselben Bedingung.
 */
create or replace function mbl.claim_assistant_turn(
  p_project uuid, p_limit int default 6, p_cap_cents int default 500
)
returns table (zu_oft boolean, deckel_voll boolean, spent_cents int, cap_cents int)
language plpgsql
security definer
set search_path = mbl, public, auth
as $$
declare
  b assistant_budget;
  jetzt_monat text := to_char(now(), 'YYYY-MM');
  fenster_neu boolean;
begin
  if not mbl.is_member(p_project) then
    return;
  end if;

  insert into assistant_budget (project_id, month)
  values (p_project, jetzt_monat)
  on conflict (project_id) do nothing;

  select * into b from assistant_budget a where a.project_id = p_project for update;

  -- Monatswechsel: Der Deckel füllt sich von selbst wieder auf.
  if b.month <> jetzt_monat then
    update assistant_budget a
       set month = jetzt_monat, spent_cents = 0
     where a.project_id = p_project
     returning * into b;
  end if;

  fenster_neu := b.window_started_at is null
                 or b.window_started_at < now() - interval '1 minute';

  update assistant_budget a
     set window_started_at = case when fenster_neu then now() else a.window_started_at end,
         window_count = case when fenster_neu then 1 else a.window_count + 1 end
   where a.project_id = p_project
   returning * into b;

  zu_oft := b.window_count > p_limit;
  deckel_voll := b.spent_cents >= p_cap_cents;
  spent_cents := b.spent_cents;
  cap_cents := p_cap_cents;
  return next;
end
$$;

/**
 * Was ein Zug gekostet hat, schreibt der Zug selbst fort.
 *
 * Als Trigger und nicht als zweiter Aufruf: Ein Aufruf, den der
 * Anwendungscode vergessen kann, ist ein Kostendeckel, den er vergessen kann.
 */
create or replace function mbl.book_assistant_cost()
returns trigger
language plpgsql
security definer
set search_path = mbl, public, auth
as $$
begin
  if new.cost_cents > 0 then
    update assistant_budget
       set spent_cents = spent_cents + new.cost_cents
     where project_id = new.project_id;
  end if;
  return new;
end
$$;

create trigger assistant_message_book_cost
  after insert on assistant_message
  for each row execute function mbl.book_assistant_cost();

-- Rechte und RLS -----------------------------------------------------------

grant select, insert, update, delete on assistant_conversation to authenticated;
grant select, insert on assistant_message to authenticated;
grant select on assistant_budget to authenticated;

alter table assistant_conversation enable row level security;
alter table assistant_message      enable row level security;
alter table assistant_budget       enable row level security;

-- Ein Gespräch gehört dem, der es geführt hat. Auch der Bauherr liest es
-- nicht mit: Wer wissen will, was jemand nicht versteht, fragt ihn.
create policy assistant_conversation_own on assistant_conversation
  for all to authenticated
  using (member_id = mbl.current_member_id(project_id))
  with check (member_id = mbl.current_member_id(project_id));

create policy assistant_message_own on assistant_message
  for select to authenticated
  using (exists (
    select 1 from assistant_conversation c
    where c.id = conversation_id
      and c.member_id = mbl.current_member_id(c.project_id)
  ));

create policy assistant_message_write on assistant_message
  for insert to authenticated
  with check (exists (
    select 1 from assistant_conversation c
    where c.id = conversation_id
      and c.project_id = assistant_message.project_id
      and c.member_id = mbl.current_member_id(c.project_id)
  ));

-- Den Verbrauch darf sehen, wer im Projekt ist: Der Deckel gilt dem
-- Bauvorhaben, also geht er alle an, die daran arbeiten.
create policy assistant_budget_read on assistant_budget for select to authenticated
  using (mbl.is_member(project_id));

grant execute on all functions in schema mbl to anon, authenticated;
