-- ---------------------------------------------------------------------------
-- MeinBaulotse — Gast-Zugang und Terminabstimmung (Arbeitspaket 6)
--
-- Abschnitt 2.3: „Signierter Token im Link, projekt- und rollen-scoped. Kein
-- Passwort, keine Registrierung." Der Grund steht in Leitsatz 1.6.2: Keine
-- Funktion darf die Mitwirkung des GU voraussetzen — und nichts setzt sie so
-- sicher voraus wie ein Anmeldeverfahren. Ein Bauleiter, der ein Konto
-- anlegen soll, um einen Termin zu bestätigen, bestätigt keinen Termin.
--
-- In 0002 steht der Satz, an dem sich diese Migration messen lassen muss:
--
--   „Der Gast-Zugang aus AP 6 wird ausschließlich `mbl.current_user_id()` und
--    `mbl.current_member_id()` erweitern; keine einzige Policy muss dafür
--    angefasst werden."
--
-- Genau das passiert hier. Alle Policies der Anwendung bleiben unberührt: Ein
-- Gast ist für die Datenbank ein Mitglied wie jedes andere, nur eben eines,
-- das sich mit einem Token ausweist statt mit einem Konto.
-- ---------------------------------------------------------------------------

create table guest_token (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references project (id) on delete cascade,
  member_id         uuid not null references project_member (id) on delete cascade,
  -- Nur der Hash. Wer die Datenbank liest, kann damit keinen Link bauen
  -- (Abschnitt 6.4).
  token_hash        text not null unique,
  scopes            text[] not null default '{}',
  locale            text not null default 'de',
  -- An wen der Link ging. Wird der Token von woanders benutzt, steht das im
  -- Protokoll — gesperrt wird deswegen nicht, denn Bauleiter leiten Links
  -- weiter, und das ist meistens richtig so.
  sent_to           text,
  expires_at        timestamptz not null default now() + interval '180 days',
  last_used_at      timestamptz,
  use_count         int not null default 0,
  -- Ratenbegrenzung: ein Zeitfenster und ein Zähler darin.
  window_started_at timestamptz,
  window_count      int not null default 0,
  revoked_at        timestamptz,
  created_by        uuid references project_member (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint guest_token_locale check (locale in ('de','en','pl','ro','tr'))
);
create index guest_token_member_idx on guest_token (member_id) where revoked_at is null;
create index guest_token_project_idx on guest_token (project_id);

comment on table guest_token is
  'Zugang ohne Konto nach Abschnitt 2.3. Der Token steht nur im Link; hier '
  'liegt sein Hash.';

create trigger guest_token_touch_updated_at
  before update on guest_token
  for each row execute function mbl.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Die Erweiterung, die 0002 angekündigt hat
--
-- `mbl.current_member_id` kennt jetzt zwei Wege zur Mitgliedschaft: ein Konto
-- (`auth.uid()`) oder einen gültigen Gast-Token. Die Gültigkeit prüft die
-- Datenbank selbst — ein abgelaufener oder gesperrter Token ist damit auch
-- dann wertlos, wenn der Anwendungscode ihn durchwinkt.
-- ---------------------------------------------------------------------------

-- Der Wert kommt aus einem JWT-Claim und ist damit alles, was jemand
-- hineinschreiben kann. Deshalb wird er geprüft statt gecastet: Was nicht wie
-- eine Kennung aussieht, ist `null` — und `null` gehört zu keinem Token.
create or replace function mbl.current_guest_token()
returns uuid
language sql
stable
as $$
  select case
    when coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'mbl_token', '')
         ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'mbl_token')::uuid
  end
$$;

create or replace function mbl.current_member_id(p_project uuid)
returns uuid
language sql
stable
security definer
set search_path = mbl, public, auth
as $$
  select m.id
  from project_member m
  where m.project_id = p_project
    and m.revoked_at is null
    and (
      m.user_id = auth.uid()
      or (
        m.expert_org_id is not null
        and exists (
          select 1 from expert_org_member om
          where om.org_id = m.expert_org_id and om.user_id = auth.uid()
        )
      )
      -- Neu: der Weg über einen gültigen Gast-Token.
      or exists (
        select 1 from guest_token g
        where g.member_id = m.id
          and g.id = mbl.current_guest_token()
          and g.revoked_at is null
          and g.expires_at > now()
      )
    )
  -- Direkte Mitgliedschaft schlägt die Mitgliedschaft über eine Organisation.
  order by (m.user_id = auth.uid()) desc
  limit 1
$$;

-- ---------------------------------------------------------------------------
-- Bestätigungsgrad (Abschnitt 3.4)
--
-- Vier Zustände, und der Übergang zwischen ihnen ist eine Aussage über die
-- Datenlage, nicht über Schuld:
--
--   self_stated          nur eine Seite hat den Termin erfasst
--   counterparty_stated  vom GU genannt, nicht gegenbestätigt
--   mutual               beide Seiten haben bestätigt
--   disputed             die Gegenseite hat einen anderen Termin genannt
--
-- Die Wortwahl in der Oberfläche ist Absicht: „abgestimmt" statt „quittiert",
-- „zwei Angaben" statt „strittig". Dieselbe Datenlage, ein anderer Ton.
-- ---------------------------------------------------------------------------

create type mbl.confirmation_action as enum ('bestaetigt', 'gegenvorschlag');

/**
 * Ein Gegenvorschlag ist **keine** Terminänderung.
 *
 * Er wird festgehalten, nicht ausgeführt: Der Plan gehört dem Bauherrn. Wer
 * widerspricht, erzeugt zwei Angaben — und die Entscheidung darüber trifft
 * ein Mensch, nicht der Kalender.
 */
create table task_confirmation (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references project (id) on delete cascade,
  task_id        uuid not null references task (id) on delete cascade,
  member_id      uuid not null references project_member (id) on delete cascade,
  action         mbl.confirmation_action not null,
  /** Der Termin, auf den sich die Aussage bezieht. */
  stated_start   date,
  stated_end     date,
  /** Beim Gegenvorschlag: der Termin, den die Gegenseite nennt. */
  proposed_start date,
  proposed_end   date,
  note           text,
  actor_channel  mbl.actor_channel not null default 'app',
  created_at     timestamptz not null default now(),
  constraint task_confirmation_proposal
    check (action <> 'gegenvorschlag' or proposed_start is not null)
);
create index task_confirmation_task_idx on task_confirmation (task_id, created_at desc);

comment on table task_confirmation is
  'Append-only wie die Historie: Wer einmal zugestimmt hat, hat zugestimmt. '
  'Eine Meinungsänderung ist ein neuer Eintrag.';

-- Append-only, aus demselben Grund wie schedule_change.
create or replace function mbl.forbid_confirmation_change()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Eine Rückmeldung zum Termin ist append-only.'
    using errcode = 'raise_exception',
          hint = 'Gib eine neue Rückmeldung ab; die alte bleibt stehen.';
end
$$;

create trigger task_confirmation_append_only
  before update or delete on task_confirmation
  for each row execute function mbl.forbid_confirmation_change();

-- ---------------------------------------------------------------------------
-- Einen Token einlösen
--
-- Der einzige Zugriff im ganzen Produkt, der ohne Mitgliedschaft auskommen
-- muss — sonst käme man nie hinein. Deshalb steht er als `security definer`
-- in der Datenbank und nicht als privilegierte Abfrage im Anwendungscode:
-- Die Funktion gibt **nur zu einem gültigen Hash** etwas heraus und ist damit
-- kein Schlüssel, sondern ein Schloss.
--
-- Sie zählt die Nutzung gleich mit. Die Ratenbegrenzung aus Abschnitt 2.3
-- läuft über ein Zeitfenster von einer Minute; wer darüber liegt, bekommt den
-- Kontext trotzdem, aber mit `zu_oft = true`. Die Unterscheidung ist wichtig:
-- Ein überlastender Aufrufer soll abgewiesen werden, ein Bauleiter mit
-- hektischem Daumen soll wissen, warum.
-- ---------------------------------------------------------------------------

create or replace function mbl.use_guest_token(p_hash text, p_limit int default 30)
returns table (
  token_id uuid, project_id uuid, member_id uuid, role text,
  display_name text, scopes text[], locale text, zu_oft boolean
)
language plpgsql
security definer
set search_path = mbl, public, auth
as $$
declare
  g guest_token;
  m project_member;
  fenster_neu boolean;
begin
  select * into g from guest_token
   where guest_token.token_hash = p_hash
     and guest_token.revoked_at is null
     and guest_token.expires_at > now();
  if not found then
    return;
  end if;

  select * into m from project_member where project_member.id = g.member_id;
  if not found or m.revoked_at is not null then
    return;
  end if;

  fenster_neu := g.window_started_at is null or g.window_started_at < now() - interval '1 minute';

  update guest_token
     set last_used_at = now(),
         use_count = guest_token.use_count + 1,
         window_started_at = case when fenster_neu then now() else guest_token.window_started_at end,
         window_count = case when fenster_neu then 1 else guest_token.window_count + 1 end
   where guest_token.id = g.id
   returning * into g;

  token_id := g.id;
  project_id := g.project_id;
  member_id := g.member_id;
  role := m.role::text;
  display_name := m.display_name;
  scopes := g.scopes;
  locale := g.locale;
  zu_oft := g.window_count > p_limit;
  return next;
end
$$;

-- Rechte und RLS -----------------------------------------------------------

grant select, insert, update on guest_token to authenticated;
grant select, insert on task_confirmation to authenticated;

alter table guest_token       enable row level security;
alter table task_confirmation enable row level security;

-- Einladen darf, wer auch Mitglieder einlädt — ein Gast-Link ist nichts
-- anderes als eine Einladung ohne Konto (Rechtematrix 2.2).
create policy guest_token_read on guest_token for select to authenticated
  using (mbl.has_perm(project_id, 'member.invite'));

create policy guest_token_create on guest_token for insert to authenticated
  with check (mbl.has_perm(project_id, 'member.invite'));

-- Ändern heißt hier: sperren, und die Nutzung mitzählen. Deshalb darf es auch
-- der Gast selbst — sonst könnte er seinen eigenen Zugriff nicht protokollieren.
create policy guest_token_update on guest_token for update to authenticated
  using (mbl.has_perm(project_id, 'member.invite') or id = mbl.current_guest_token())
  with check (mbl.has_perm(project_id, 'member.invite') or id = mbl.current_guest_token());

create policy task_confirmation_read on task_confirmation for select to authenticated
  using (mbl.is_member(project_id));

-- Bestätigen darf, wer laut Rechtematrix Termine bestätigt — und ein
-- Einzelgewerk nur am eigenen Vorgang.
create policy task_confirmation_write on task_confirmation for insert to authenticated
  with check (
    mbl.has_perm(project_id, 'task.confirm')
    and mbl.task_visible(task_id)
    and member_id = mbl.current_member_id(project_id)
  );

grant execute on all functions in schema mbl to anon, authenticated;
