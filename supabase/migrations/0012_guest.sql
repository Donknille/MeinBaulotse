-- ---------------------------------------------------------------------------
-- MeinBaulotse — Abstimmung ohne Konto (Arbeitspaket 6)
--
-- Abschnitt 5.5 zeigt die ganze Ansicht in fünf Zeilen:
--
--     Für den Innenputz ist der 12.–21.05. eingetragen. Passt das?
--     [ Passt ]   [ Anderer Termin ]   [ Antworten ]
--
-- Wer sie benutzt, ist ein Polier auf einer Baustelle mit dem Handy in der
-- Hand. Er wird sich nicht registrieren, kein Passwort setzen und keine App
-- installieren. Tut er es doch nicht, bleibt jeder Termin im Plan eine
-- einseitige Behauptung — und genau darum geht es bei diesem Arbeitspaket.
--
-- Die schwierige Frage ist nicht die Ansicht, sondern die Rechteprüfung: Ein
-- Gast hat keine Kennung in `auth.users`, und trotzdem muss dieselbe RLS
-- gelten. Die Antwort steht schon seit 0002 als Kommentar über
-- `mbl.current_user_id` — „Ab AP 6 löst diese Funktion zusätzlich Gast-Token
-- auf". Hier wird sie eingelöst:
--
--   1. Der Anwendungsserver setzt `app.guest_token_hash` transaktionslokal.
--   2. `mbl.current_member_id` löst daraus die Mitgliedschaft auf.
--   3. Ab da gilt jede Policy unverändert weiter.
--
-- Kein zweiter Rechteweg, keine Sonderpolicy, keine privilegierte Rolle. Ein
-- Gast **ist** ein `project_member` — er hat nur einen anderen Türschlüssel.
--
-- Dazu kommt eine Verengung, die ein angemeldeter Nutzer nicht hat: Der Token
-- trägt Scopes (Abschnitt 2.3), und die schneiden die Rechte seiner Rolle
-- zusätzlich zu. Ein Bestätigungslink kann bestätigen — mehr nicht, auch wenn
-- die Rolle mehr dürfte.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Was ein Scope erlaubt — als Daten, nicht als Bedingung im Code
--
-- Dieselbe Bauweise wie `role_permission` (Regel 5): Die Rechtematrix steht in
-- einer Tabelle, und `mbl.has_perm` fragt sie ab. Ein Scope, der irgendwo als
-- `if` im Anwendungscode stünde, wäre die zweite Wahrheit neben der ersten.
-- ---------------------------------------------------------------------------

create table scope_permission (
  scope      text not null,
  permission text not null,
  primary key (scope, permission)
);
comment on table scope_permission is
  'Die vier Scopes aus Abschnitt 2.3 und die Rechte, die sie freigeben. Der '
  'Gast bekommt den Schnitt aus seiner Rolle und seinen Scopes.';

insert into scope_permission (scope, permission) values
  -- Ohne Lesen ist jeder Link eine leere Seite. Deshalb trägt jeder Scope es
  -- mit: Ein Bestätigungslink, der den Termin nicht anzeigen darf, den er
  -- bestätigen soll, wäre eine Zumutung.
  ('view:project',    'project.read'),
  ('view:trade',      'project.read'),
  ('confirm:task',    'project.read'),
  ('report:progress', 'project.read'),
  -- Bestätigen heißt auch: einen anderen Termin nennen dürfen. Ein „Passt
  -- nicht" ohne Gegenvorschlag ist für den Plan wertlos.
  ('confirm:task',    'task.confirm'),
  ('confirm:task',    'task.schedule'),
  ('report:progress', 'task.progress');

-- ---------------------------------------------------------------------------
-- Der Token
--
-- Gespeichert wird nur der Hash (Abschnitt 6.4). Wer die Datenbank liest, kann
-- damit keinen Link bauen — auch nicht der Eigentümer im SQL-Editor.
-- ---------------------------------------------------------------------------

create table guest_token (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references project (id) on delete cascade,
  member_id         uuid not null references project_member (id) on delete cascade,
  token_hash        text not null unique,
  scopes            text[] not null default '{}',
  -- de, pl, ro, tr, en. „Mehrsprachig ausliefern erhöht die Rücklaufquote auf
  -- der Baustelle spürbar und kostet fast nichts" (Abschnitt 2.3).
  locale            text not null default 'de',

  -- Bindung an eine Erreichbarkeit. Der Token wird darüber zugestellt; eine
  -- abweichende Nutzung ist kein Fehler, aber sie gehört ins Protokoll.
  bound_email       text,
  bound_phone       text,

  -- „Erste Nutzung erfasst optional Name und Firma."
  claimed_name      text,
  claimed_company   text,
  claimed_at        timestamptz,

  expires_at        timestamptz not null default now() + interval '180 days',
  last_used_at      timestamptz,
  use_count         int not null default 0,

  -- Ratenbegrenzung als gleitendes Fenster, in der Zeile statt in einem
  -- Zwischenspeicher: Eine Serverless-Funktion hat keinen gemeinsamen
  -- Speicher, und ein zweiter Dienst nur für diesen Zähler wäre mehr Betrieb
  -- als Nutzen.
  window_started_at timestamptz,
  window_count      int not null default 0,

  revoked_at        timestamptz,
  created_by        uuid references project_member (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint guest_token_locale check (locale in ('de','pl','ro','tr','en')),
  constraint guest_token_hash_shape check (token_hash ~ '^[0-9a-f]{64}$')
);
comment on column guest_token.token_hash is
  'sha256 des Links. Der Klartext verlässt den Server genau einmal — beim '
  'Anlegen. Danach ist er nicht mehr rekonstruierbar, auch nicht für uns.';

create index guest_token_project_idx on guest_token (project_id) where revoked_at is null;
create index guest_token_member_idx on guest_token (member_id);

create trigger guest_token_touch_updated_at
  before update on guest_token
  for each row execute function mbl.touch_updated_at();

-- Jeder Scope muss einer sein, den es gibt. Ein Tippfehler in `scopes` wäre
-- sonst ein Link, der nichts darf, und niemand fände heraus warum.
create or replace function mbl.guard_guest_scopes()
returns trigger
language plpgsql
security definer
set search_path = mbl, public
as $$
declare
  unbekannt text;
begin
  select s into unbekannt
    from unnest(new.scopes) as s
   where not exists (select 1 from scope_permission sp where sp.scope = s)
   limit 1;
  if unbekannt is not null then
    raise exception 'Den Scope „%" gibt es nicht.', unbekannt using errcode = 'check_violation';
  end if;
  return new;
end
$$;

create trigger guest_token_guard_scopes
  before insert or update on guest_token
  for each row execute function mbl.guard_guest_scopes();

-- ---------------------------------------------------------------------------
-- Auflösung
-- ---------------------------------------------------------------------------

create or replace function mbl.guest_token_id()
returns uuid
language sql
stable
security definer
set search_path = mbl, public
as $$
  select t.id
    from guest_token t
   where t.token_hash = nullif(current_setting('app.guest_token_hash', true), '')
     and t.revoked_at is null
     and t.expires_at > now()
$$;
comment on function mbl.guest_token_id() is
  'Der gültige Token dieser Transaktion, falls einer gesetzt ist. Abgelaufene '
  'und zurückgezogene lösen bewusst zu null auf — dann ist der Gast schlicht '
  'kein Mitglied mehr, und jede Policy greift von selbst.';

-- Die Erweiterung, auf die der Kommentar in 0002 verweist. Der Gast hat
-- Vorrang: Wer über einen Link hereinkommt, hat sich für diese Identität
-- entschieden, auch wenn zufällig eine Sitzung im selben Browser liegt.
create or replace function mbl.current_member_id(p_project uuid)
returns uuid
language sql
stable
security definer
set search_path = mbl, public, auth
as $$
  select coalesce(
    (
      select m.id
        from guest_token t
        join project_member m on m.id = t.member_id
       where t.id = mbl.guest_token_id()
         and m.project_id = p_project
         and m.revoked_at is null
    ),
    (
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
        )
      order by (m.user_id = auth.uid()) desc
      limit 1
    )
  )
$$;

-- ---------------------------------------------------------------------------
-- Der Schnitt aus Rolle und Scope
-- ---------------------------------------------------------------------------

create or replace function mbl.scope_allows(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = mbl, public
as $$
  select case
    -- Kein Token: ein angemeldeter Nutzer, für den es keine Scopes gibt.
    when mbl.guest_token_id() is null then true
    else exists (
      select 1
        from guest_token t
        join scope_permission sp on sp.scope = any (t.scopes)
       where t.id = mbl.guest_token_id()
         and sp.permission = p_permission
    )
  end
$$;

create or replace function mbl.has_perm(p_project uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = mbl, public, auth
as $$
  select exists (
    select 1
    from role_permission rp
    where rp.permission = p_permission
      and rp.role = mbl.member_role(p_project)
  ) and mbl.scope_allows(p_permission)
$$;
comment on function mbl.has_perm(uuid, text) is
  'Rechtematrix aus Abschnitt 2.2, für Gäste zusätzlich verengt auf die Scopes '
  'ihres Links (Abschnitt 2.3). Der Schnitt, nie die Vereinigung.';

-- Ein Token ohne Lesescope ist kein Mitglied. Damit greift die Verengung auch
-- dort, wo eine Policy nur `is_member` fragt — und das sind die meisten.
create or replace function mbl.is_member(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = mbl, public, auth
as $$
  select mbl.current_member_id(p_project) is not null
     and mbl.scope_allows('project.read')
$$;

-- ---------------------------------------------------------------------------
-- Benutzung festhalten und begrenzen
--
-- Eine Funktion statt zweier, weil beides in denselben Schreibvorgang gehört:
-- Wer zählt, ohne zu begrenzen, hat eine Statistik; wer begrenzt, ohne zu
-- zählen, hat eine Vermutung.
-- ---------------------------------------------------------------------------

create or replace function mbl.use_guest_token(
  p_ip_hash         text default null,
  p_user_agent_hash text default null,
  p_limit           int  default 60,
  p_window          interval default interval '1 minute'
)
returns table (allowed boolean, project_id uuid, member_id uuid, locale text, scopes text[])
language plpgsql
security definer
set search_path = mbl, public
as $$
declare
  zeile guest_token%rowtype;
begin
  select * into zeile from guest_token where id = mbl.guest_token_id() for update;
  if not found then
    return;
  end if;

  if zeile.window_started_at is null or zeile.window_started_at < now() - p_window then
    zeile.window_started_at := now();
    zeile.window_count := 0;
  end if;
  zeile.window_count := zeile.window_count + 1;

  update guest_token
     set window_started_at = zeile.window_started_at,
         window_count      = zeile.window_count,
         use_count         = use_count + 1,
         last_used_at      = now()
   where id = zeile.id;

  insert into audit_log (project_id, actor_member_id, actor_channel, action,
                         entity_type, entity_id, ip_hash, user_agent_hash, meta)
  values (zeile.project_id, zeile.member_id, 'guest_link', 'guest.open',
          'guest_token', zeile.id, p_ip_hash, p_user_agent_hash,
          jsonb_build_object('use_count', zeile.use_count + 1,
                             'rate_limited', zeile.window_count > p_limit));

  allowed    := zeile.window_count <= p_limit;
  project_id := zeile.project_id;
  member_id  := zeile.member_id;
  locale     := zeile.locale;
  scopes     := zeile.scopes;
  return next;
end
$$;

-- „Erste Nutzung erfasst optional Name und Firma." Danach nicht mehr: Wer
-- einmal gesagt hat, wer er ist, soll es nicht überschreiben können — sonst
-- steht in der Bauakte am Ende ein anderer Name über derselben Bestätigung.
create or replace function mbl.claim_guest_token(p_name text, p_company text)
returns void
language plpgsql
security definer
set search_path = mbl, public
as $$
declare
  zeile guest_token%rowtype;
begin
  select * into zeile from guest_token where id = mbl.guest_token_id();
  if not found or zeile.claimed_at is not null then
    return;
  end if;

  update guest_token
     set claimed_name = nullif(trim(p_name), ''),
         claimed_company = nullif(trim(p_company), ''),
         claimed_at = now()
   where id = zeile.id;

  -- Der Name wandert auch in die Mitgliedschaft: In jeder Ansicht steht
  -- danach „Bestätigt von Jörg Baumeister" statt „Bestätigt vom Gast".
  update project_member
     set display_name = coalesce(nullif(trim(p_name), ''), display_name),
         company      = coalesce(nullif(trim(p_company), ''), company),
         accepted_at  = coalesce(accepted_at, now())
   where id = zeile.member_id;
end
$$;

-- ---------------------------------------------------------------------------
-- Bestätigungsgrad (Abschnitt 3.4)
--
-- Vier Werte, und die Wortwahl im Produkt ist Absicht: *abgestimmt* statt
-- quittiert, *zwei Angaben* statt strittig. Dieselbe Datenlage, ein anderer
-- Ton.
--
-- Der Gegenvorschlag bekommt eigene Spalten, statt den Termin zu überschreiben.
-- Das ist der ganze Unterschied zwischen „zwei Angaben" und „der GU hat den
-- Termin geändert": Solange beide dastehen, entscheidet der Bauherr, welcher
-- gilt. Überschreibt der GU, hat er entschieden.
-- ---------------------------------------------------------------------------

alter table task
  add column counter_start date,
  add column counter_end   date,
  add column counter_by    uuid references project_member (id) on delete set null,
  add column counter_at    timestamptz,
  add column counter_note  text;

comment on column task.counter_start is
  'Der abweichende Termin der Gegenseite. Steht neben dem eingetragenen, nicht '
  'an seiner Stelle — „zwei Angaben" ist eine Datenlage, kein Zwischenzustand.';

-- Wer den Termin nennt, bestimmt den Bestätigungsgrad. Das ist keine Frage der
-- Höflichkeit, sondern die Definition aus Abschnitt 3.4 — und sie gehört in
-- einen Trigger, weil eine Anwendung sie an genau einer Stelle vergessen wird.
create or replace function mbl.stamp_confirmation()
returns trigger
language plpgsql
security definer
set search_path = mbl, public
as $$
declare
  rolle mbl.member_role;
begin
  if new.current_start is not distinct from old.current_start
     and new.current_end is not distinct from old.current_end then
    return new;
  end if;

  -- Die eine Ausnahme: Wer einen Gegenvorschlag übernimmt, trägt einen
  -- **fremden** Termin ein. Der Grad folgt dann dem Urheber und nicht dem, der
  -- gerade tippt — sonst stünde am Ende „von dir eingetragen" über einem
  -- Termin, den das Unternehmen genannt hat, und die anschließende Bestätigung
  -- des Bauherrn wäre eine Bestätigung seiner selbst.
  --
  -- Derselbe Weg wie bei `app.change_reason`: ein transaktionslokaler Wert,
  -- den die Anwendung setzt und der Trigger liest.
  if nullif(current_setting('app.confirmation_from', true), '') = 'counterparty' then
    new.confirmation  := 'counterparty_stated';
    new.confirmed_by  := null;
    new.confirmed_at  := null;
    new.counter_start := null;
    new.counter_end   := null;
    new.counter_by    := null;
    new.counter_at    := null;
    new.counter_note  := null;
    return new;
  end if;

  rolle := mbl.member_role(new.project_id);

  if rolle in ('owner','co_owner') then
    new.confirmation := 'self_stated';
  elsif rolle in ('contractor','trade') then
    new.confirmation := 'counterparty_stated';
  else
    -- Baubegleiter, Mitleser oder die Neuberechnung ohne Mitgliedschaft:
    -- Der Grad bleibt, wie er war. Wer nicht terminieren darf, ändert auch
    -- nicht, wessen Angabe das ist.
    return new;
  end if;

  -- Ein bewegter Termin ist nicht mehr derselbe Termin. Eine Abstimmung, die
  -- ihn überlebt, wäre eine Behauptung über etwas, worüber nie gesprochen
  -- wurde.
  new.confirmed_by  := null;
  new.confirmed_at  := null;
  new.counter_start := null;
  new.counter_end   := null;
  new.counter_by    := null;
  new.counter_at    := null;
  new.counter_note  := null;
  return new;
end
$$;

create trigger task_stamp_confirmation
  before update on task
  for each row execute function mbl.stamp_confirmation();

-- „Abgestimmt" heißt: beide Seiten. Nicht: derselbe zweimal.
create or replace function mbl.guard_confirmation()
returns trigger
language plpgsql
security definer
set search_path = mbl, public
as $$
declare
  rolle mbl.member_role;
begin
  if new.confirmation is not distinct from old.confirmation then
    return new;
  end if;
  rolle := mbl.member_role(new.project_id);

  if new.confirmation = 'mutual' then
    if new.confirmed_by is distinct from mbl.current_member_id(new.project_id) then
      raise exception 'Bestätigen kann nur, wer gerade da ist.'
        using errcode = 'insufficient_privilege';
    end if;
    if old.confirmation = 'self_stated' and rolle not in ('contractor','trade') then
      raise exception 'Diesen Termin hat die Bauherrenseite eingetragen. Bestätigen muss ihn das ausführende Unternehmen.'
        using errcode = 'insufficient_privilege';
    end if;
    if old.confirmation = 'counterparty_stated' and rolle not in ('owner','co_owner') then
      raise exception 'Diesen Termin hat das ausführende Unternehmen genannt. Bestätigen muss ihn die Bauherrenseite.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  if new.confirmation = 'disputed'
     and new.counter_start is null and new.counter_end is null then
    raise exception 'Zwei Angaben braucht eine zweite Angabe.'
      using errcode = 'check_violation';
  end if;

  return new;
end
$$;

create trigger task_guard_confirmation
  before update on task
  for each row execute function mbl.guard_confirmation();

-- ---------------------------------------------------------------------------
-- Der Gegenvorschlag in der Historie
--
-- Abnahme von AP 6, zweiter Satz: „Ein Gegenvorschlag erzeugt `disputed` und
-- einen Änderungseintrag mit Kanal `guest_link`." Der Kanal stand schon; der
-- Eintrag fehlte, denn `current_start` bewegt sich dabei gerade **nicht**.
--
-- Diese Fassung ersetzt die aus 0009 und ergänzt sie um die beiden
-- Gegenvorschlagsfelder. Alles andere ist unverändert.
-- ---------------------------------------------------------------------------

create or replace function mbl.log_task_change()
returns trigger
language plpgsql
security definer
set search_path = mbl, public
as $$
declare
  actor_member uuid;
  actor        mbl.member_role;
  reason       mbl.schedule_change_reason;
  reason_note  text;
  channel      mbl.actor_channel;
  effect       int;
begin
  actor_member := mbl.current_member_id(coalesce(new.project_id, old.project_id));
  actor := mbl.member_role(coalesce(new.project_id, old.project_id));
  channel := mbl.actor_channel();
  reason := nullif(current_setting('app.change_reason', true), '')::mbl.schedule_change_reason;
  reason_note := nullif(current_setting('app.change_reason_text', true), '');
  effect := nullif(current_setting('app.change_effect_days', true), '')::int;

  if tg_op = 'INSERT' then
    insert into schedule_change (
      project_id, task_id, field, old_value, new_value,
      actor_member_id, actor_role, actor_channel, reason_code, reason_text,
      effect_days_on_completion
    )
    values (
      new.project_id, new.id, 'task_created', null,
      jsonb_build_object(
        'name', new.name,
        'current_start', new.current_start,
        'current_end', new.current_end,
        'duration_days', new.duration_days,
        'status', new.status
      ),
      actor_member, actor, channel, coalesce(reason, 'planinitialisierung'), reason_note,
      effect
    );
    return new;
  end if;

  if new.current_start is distinct from old.current_start then
    insert into schedule_change (project_id, task_id, field, old_value, new_value,
      actor_member_id, actor_role, actor_channel, reason_code, reason_text,
      effect_days_on_completion)
    values (new.project_id, new.id, 'current_start', to_jsonb(old.current_start),
      to_jsonb(new.current_start), actor_member, actor, channel, reason, reason_note, effect);
  end if;

  if new.current_end is distinct from old.current_end then
    insert into schedule_change (project_id, task_id, field, old_value, new_value,
      actor_member_id, actor_role, actor_channel, reason_code, reason_text,
      effect_days_on_completion)
    values (new.project_id, new.id, 'current_end', to_jsonb(old.current_end),
      to_jsonb(new.current_end), actor_member, actor, channel, reason, reason_note, effect);
  end if;

  if new.duration_days is distinct from old.duration_days then
    insert into schedule_change (project_id, task_id, field, old_value, new_value,
      actor_member_id, actor_role, actor_channel, reason_code, reason_text,
      effect_days_on_completion)
    values (new.project_id, new.id, 'duration_days', to_jsonb(old.duration_days),
      to_jsonb(new.duration_days), actor_member, actor, channel, reason, reason_note, effect);
  end if;

  if new.status is distinct from old.status then
    insert into schedule_change (project_id, task_id, field, old_value, new_value,
      actor_member_id, actor_role, actor_channel, reason_code, reason_text,
      effect_days_on_completion)
    values (new.project_id, new.id, 'status', to_jsonb(old.status),
      to_jsonb(new.status), actor_member, actor, channel, reason, reason_note, effect);
  end if;

  -- Neu in 0012: Der Gegenvorschlag. Er bewegt keinen Termin und wäre sonst
  -- die einzige Aussage über einen Termin, die nirgends steht.
  if new.counter_start is distinct from old.counter_start
     or new.counter_end is distinct from old.counter_end then
    insert into schedule_change (project_id, task_id, field, old_value, new_value,
      actor_member_id, actor_role, actor_channel, reason_code, reason_text,
      effect_days_on_completion)
    values (new.project_id, new.id, 'counter_proposal',
      jsonb_build_object('start', old.counter_start, 'end', old.counter_end),
      jsonb_build_object('start', new.counter_start, 'end', new.counter_end,
                         'note', new.counter_note),
      actor_member, actor, channel, reason, reason_note, effect);
  end if;

  if new.confirmation is distinct from old.confirmation
     and new.confirmation = 'mutual' then
    insert into schedule_change (project_id, task_id, field, old_value, new_value,
      actor_member_id, actor_role, actor_channel, reason_code, reason_text,
      effect_days_on_completion)
    values (new.project_id, new.id, 'confirmation', to_jsonb(old.confirmation),
      to_jsonb(new.confirmation), actor_member, actor, channel, reason, reason_note, effect);
  end if;

  return new;
end
$$;

-- ---------------------------------------------------------------------------
-- Rechte
-- ---------------------------------------------------------------------------

grant select, insert, update on guest_token to authenticated;
grant select on scope_permission to authenticated;

alter table guest_token      enable row level security;
alter table scope_permission enable row level security;

create policy scope_permission_read on scope_permission for select to authenticated
  using (true);

-- Ein Gast sieht seine Links nicht — er hat ja einen. Sichtbar sind sie für
-- den, der einladen darf, und der Hash steht dabei bewusst nicht im Weg: Aus
-- ihm lässt sich kein Link bauen.
create policy guest_token_read on guest_token for select to authenticated
  using (mbl.has_perm(project_id, 'member.invite'));

-- Seinen eigenen Link sieht der Gast schon. Ohne diese Zeile bliebe ihm die
-- eigene Ablauffrist verborgen — und die Abstimmungsseite könnte nicht sagen,
-- bis wann der Link gilt und ob sie beim ersten Mal nach dem Namen fragen
-- muss. Der Hash steht darin, aber den Klartext hat er ohnehin in der Hand.
create policy guest_token_own on guest_token for select to authenticated
  using (id = mbl.guest_token_id());

create policy guest_token_create on guest_token for insert to authenticated
  with check (mbl.has_perm(project_id, 'member.invite'));

-- Zurückziehen ist eine Änderung, kein Löschen: Ein Link, der einmal gültig
-- war, hat womöglich etwas bestätigt. Wer ihn entfernt, entfernt die Spur.
create policy guest_token_revoke on guest_token for update to authenticated
  using (mbl.has_perm(project_id, 'member.invite'))
  with check (mbl.has_perm(project_id, 'member.invite'));
