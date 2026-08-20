-- ---------------------------------------------------------------------------
-- MeinBaulotse — Rechte und Invarianten
--
-- Grundsatz aus Abschnitt 6.4 der Spezifikation: Rechte gehören in die
-- Datenbank. Der Anwendungscode benutzt niemals eine privilegierte Rolle; er
-- öffnet je Transaktion eine Verbindung als `authenticated` und setzt den
-- JWT-Claim. Was die Policies hier nicht erlauben, ist nicht erreichbar —
-- unabhängig davon, was der Anwendungscode tut oder unterlässt.
--
-- Jede Policy geht über die Hilfsfunktionen in `mbl`. Der Gast-Zugang aus
-- AP 6 wird deshalb später ausschließlich `mbl.current_user_id()` und
-- `mbl.current_member_id()` erweitern; keine einzige Policy muss dafür
-- angefasst werden.
-- ---------------------------------------------------------------------------

-- Hilfsfunktionen -----------------------------------------------------------
--
-- WICHTIG: Alle Hilfsfunktionen sind `security definer` und laufen damit unter
-- dem Eigentümer der Tabellen. Genau deshalb darf auf `project_member` KEIN
-- `force row level security` gesetzt werden: Die Policy von `project_member`
-- ruft diese Funktionen auf, und die Funktionen lesen `project_member`. Mit
-- erzwungener RLS würde sich das gegenseitig aufrufen, bis Postgres abbricht.
-- Das ist die Stelle, an der solche Schemata üblicherweise scheitern.

create or replace function mbl.current_user_id()
returns uuid
language sql
stable
security definer
set search_path = mbl, public, auth
as $$
  select auth.uid()
$$;
comment on function mbl.current_user_id() is
  'Aktuelle Nutzerkennung. Ab AP 6 löst diese Funktion zusätzlich Gast-Token auf.';

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
    )
  -- Direkte Mitgliedschaft schlägt die Mitgliedschaft über eine Organisation.
  order by (m.user_id = auth.uid()) desc
  limit 1
$$;

create or replace function mbl.member_role(p_project uuid)
returns mbl.member_role
language sql
stable
security definer
set search_path = mbl, public, auth
as $$
  select m.role from project_member m where m.id = mbl.current_member_id(p_project)
$$;

create or replace function mbl.member_trade(p_project uuid)
returns uuid
language sql
stable
security definer
set search_path = mbl, public, auth
as $$
  select m.trade_id from project_member m where m.id = mbl.current_member_id(p_project)
$$;

create or replace function mbl.is_member(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = mbl, public, auth
as $$
  select mbl.current_member_id(p_project) is not null
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
  )
$$;
comment on function mbl.has_perm(uuid, text) is
  'Prüft die Rechtematrix aus Abschnitt 2.2 gegen die Tabelle role_permission.';

-- Zeilenschärfe für Einzelgewerke: ein `trade` sieht und ändert nur Vorgänge
-- seines eigenen Gewerks.
create or replace function mbl.trade_scope_ok(p_project uuid, p_trade uuid)
returns boolean
language sql
stable
security definer
set search_path = mbl, public, auth
as $$
  select case
    when mbl.member_role(p_project) = 'trade' then p_trade is not distinct from mbl.member_trade(p_project)
    else true
  end
$$;

create or replace function mbl.is_org_admin(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = mbl, public, auth
as $$
  select exists (
    select 1 from expert_org_member om
    where om.org_id = p_org and om.user_id = auth.uid() and om.is_admin
  )
$$;

create or replace function mbl.is_org_member(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = mbl, public, auth
as $$
  select exists (
    select 1 from expert_org_member om
    where om.org_id = p_org and om.user_id = auth.uid()
  )
$$;

create or replace function mbl.actor_channel()
returns mbl.actor_channel
language sql
stable
as $$
  select coalesce(nullif(current_setting('app.actor_channel', true), ''), 'app')::mbl.actor_channel
$$;

-- Grundrechte ---------------------------------------------------------------

grant usage on schema mbl to anon, authenticated;
grant execute on all functions in schema mbl to anon, authenticated;
grant usage on schema public to anon, authenticated;

revoke all on all tables in schema public from public;

-- Nachschlagetabellen: lesen genügt.
grant select on phase, plan_template, plan_template_task, plan_template_dependency,
  role_permission to authenticated;

grant select, insert, update, delete on trade, project, project_member, task, dependency,
  expert_org, expert_org_member to authenticated;

-- Append-only: kein UPDATE, kein DELETE. Das ist die erste von zwei Sperren.
grant select, insert on schedule_change, audit_log to authenticated;

-- RLS einschalten -----------------------------------------------------------

alter table phase                    enable row level security;
alter table plan_template            enable row level security;
alter table plan_template_task       enable row level security;
alter table plan_template_dependency enable row level security;
alter table role_permission          enable row level security;
alter table trade                    enable row level security;
alter table expert_org               enable row level security;
alter table expert_org_member        enable row level security;
alter table project                  enable row level security;
alter table project_member           enable row level security;
alter table task                     enable row level security;
alter table dependency               enable row level security;
alter table schedule_change          enable row level security;
alter table audit_log                enable row level security;

-- Nachschlagetabellen -------------------------------------------------------

create policy phase_read on phase for select to authenticated using (true);
create policy plan_template_read on plan_template for select to authenticated using (true);
create policy plan_template_task_read on plan_template_task for select to authenticated using (true);
create policy plan_template_dependency_read on plan_template_dependency for select to authenticated using (true);
create policy role_permission_read on role_permission for select to authenticated using (true);

-- Gewerke -------------------------------------------------------------------

create policy trade_read on trade for select to authenticated
  using (project_id is null or mbl.is_member(project_id));

create policy trade_write on trade for insert to authenticated
  with check (project_id is not null and mbl.has_perm(project_id, 'task.write'));

create policy trade_update on trade for update to authenticated
  using (project_id is not null and mbl.has_perm(project_id, 'task.write'))
  with check (project_id is not null and mbl.has_perm(project_id, 'task.write'));

create policy trade_delete on trade for delete to authenticated
  using (project_id is not null and mbl.has_perm(project_id, 'task.write'));

-- Mandanten -----------------------------------------------------------------

create policy expert_org_read on expert_org for select to authenticated
  using (mbl.is_org_member(id));

create policy expert_org_create on expert_org for insert to authenticated
  with check (created_by = mbl.current_user_id());

create policy expert_org_update on expert_org for update to authenticated
  using (mbl.is_org_admin(id)) with check (mbl.is_org_admin(id));

create policy expert_org_member_read on expert_org_member for select to authenticated
  using (mbl.is_org_member(org_id));

-- Beim Anlegen einer Organisation gibt es noch kein Mitglied, das Admin sein
-- könnte. Deshalb darf sich der Gründer selbst eintragen, solange die
-- Organisation leer ist.
create policy expert_org_member_write on expert_org_member for insert to authenticated
  with check (
    mbl.is_org_admin(org_id)
    or (
      user_id = mbl.current_user_id()
      and not exists (select 1 from expert_org_member existing where existing.org_id = org_id)
    )
  );

create policy expert_org_member_update on expert_org_member for update to authenticated
  using (mbl.is_org_admin(org_id)) with check (mbl.is_org_admin(org_id));

create policy expert_org_member_delete on expert_org_member for delete to authenticated
  using (mbl.is_org_admin(org_id));

-- Projekt -------------------------------------------------------------------

-- Der zweite Zweig hat zwei Gründe.
--
-- Fachlich: Wer ein Projekt angelegt hat, verliert nie den Zugang dazu. Ein
-- Bauherr, den ein zweiter Bauherr versehentlich aus seinem eigenen Projekt
-- entfernt, stünde sonst vor verschlossener Tür.
--
-- Technisch: `insert … returning` verlangt zusätzlich zur WITH-CHECK- auch die
-- USING-Bedingung. Im Moment des Anlegens gibt es noch keine Mitgliedszeile,
-- die `mbl.is_member` finden könnte. Ohne diesen Zweig ließe sich kein Projekt
-- anlegen — und der Fehler läse sich irreführend als Verstoß gegen die
-- Einfügeregel.
--
-- `created_by` ist deshalb unveränderlich, siehe Trigger weiter unten.
create policy project_read on project for select to authenticated
  using (mbl.is_member(id) or created_by = mbl.current_user_id());

create policy project_create on project for insert to authenticated
  with check (created_by = mbl.current_user_id());

create policy project_update on project for update to authenticated
  using (mbl.has_perm(id, 'contract.write'))
  with check (mbl.has_perm(id, 'contract.write'));

create policy project_delete on project for delete to authenticated
  using (mbl.has_perm(id, 'project.delete'));

-- Mitglieder ----------------------------------------------------------------

create policy project_member_read on project_member for select to authenticated
  using (mbl.is_member(project_id));

-- Zweiter Zweig: Wer das Projekt angelegt hat, trägt sich selbst als owner ein.
-- Ohne diese Ausnahme käme niemand je in sein eigenes Projekt hinein.
create policy project_member_invite on project_member for insert to authenticated
  with check (
    mbl.has_perm(project_id, 'member.invite')
    or (
      role = 'owner'
      and user_id = mbl.current_user_id()
      and exists (
        select 1 from project p
        where p.id = project_id and p.created_by = mbl.current_user_id()
      )
    )
  );

create policy project_member_update on project_member for update to authenticated
  using (mbl.has_perm(project_id, 'member.invite'))
  with check (mbl.has_perm(project_id, 'member.invite'));

create policy project_member_delete on project_member for delete to authenticated
  using (mbl.has_perm(project_id, 'member.invite'));

-- Vorgänge ------------------------------------------------------------------

create policy task_read on task for select to authenticated
  using (mbl.is_member(project_id) and mbl.trade_scope_ok(project_id, trade_id));

create policy task_create on task for insert to authenticated
  with check (mbl.has_perm(project_id, 'task.write'));

-- Termine ändern und Ist-Stände melden dürfen auch Einzelgewerke, aber nur am
-- eigenen Vorgang.
create policy task_update on task for update to authenticated
  using (mbl.has_perm(project_id, 'task.schedule') and mbl.trade_scope_ok(project_id, trade_id))
  with check (mbl.has_perm(project_id, 'task.schedule') and mbl.trade_scope_ok(project_id, trade_id));

create policy task_delete on task for delete to authenticated
  using (mbl.has_perm(project_id, 'task.write'));

-- Abhängigkeiten ------------------------------------------------------------

create policy dependency_read on dependency for select to authenticated
  using (mbl.is_member(project_id));

create policy dependency_create on dependency for insert to authenticated
  with check (mbl.has_perm(project_id, 'task.write'));

create policy dependency_update on dependency for update to authenticated
  using (mbl.has_perm(project_id, 'task.write'))
  with check (mbl.has_perm(project_id, 'task.write'));

create policy dependency_delete on dependency for delete to authenticated
  using (mbl.has_perm(project_id, 'task.write'));

-- Historie ------------------------------------------------------------------
-- Bewusst nur SELECT und INSERT. Es gibt keine UPDATE- und keine DELETE-Policy;
-- zusammen mit dem entzogenen Recht und dem Trigger weiter unten sind das drei
-- unabhängige Sperren.

create policy schedule_change_read on schedule_change for select to authenticated
  using (mbl.is_member(project_id));

create policy schedule_change_append on schedule_change for insert to authenticated
  with check (mbl.is_member(project_id));

create policy audit_log_read on audit_log for select to authenticated
  using (project_id is not null and mbl.is_member(project_id));

create policy audit_log_append on audit_log for insert to authenticated
  with check (project_id is null or mbl.is_member(project_id));

-- ---------------------------------------------------------------------------
-- Invarianten aus Abschnitt 4.1 der Spezifikation
-- ---------------------------------------------------------------------------

-- (1) schedule_change ist append-only.
create or replace function mbl.forbid_history_change()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'schedule_change ist append-only: % ist nicht zulässig.', tg_op
    using errcode = 'raise_exception',
          hint = 'Änderungen werden als neuer Eintrag geschrieben, nie durch Überschreiben.';
end
$$;

create trigger schedule_change_append_only
  before update or delete on schedule_change
  for each row execute function mbl.forbid_history_change();

-- (3) Baseline-Termine sind nach dem Sperren unveränderlich.
create or replace function mbl.guard_baseline()
returns trigger
language plpgsql
security definer
set search_path = mbl, public
as $$
declare
  locked_at timestamptz;
begin
  if new.baseline_start is not distinct from old.baseline_start
     and new.baseline_end is not distinct from old.baseline_end then
    return new;
  end if;

  select p.baseline_locked_at into locked_at from project p where p.id = old.project_id;
  if locked_at is not null then
    raise exception
      'Die Baseline dieses Projekts ist seit % gesperrt und kann nicht geändert werden.', locked_at
      using errcode = 'raise_exception';
  end if;
  return new;
end
$$;

create trigger task_guard_baseline
  before update on task
  for each row execute function mbl.guard_baseline();

-- (4) Jede Terminänderung erzeugt zwingend einen Eintrag in der Historie.
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
begin
  actor_member := mbl.current_member_id(coalesce(new.project_id, old.project_id));
  actor := mbl.member_role(coalesce(new.project_id, old.project_id));
  channel := mbl.actor_channel();
  reason := nullif(current_setting('app.change_reason', true), '')::mbl.schedule_change_reason;
  reason_note := nullif(current_setting('app.change_reason_text', true), '');

  if tg_op = 'INSERT' then
    insert into schedule_change (
      project_id, task_id, field, old_value, new_value,
      actor_member_id, actor_role, actor_channel, reason_code, reason_text
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
      actor_member, actor, channel, coalesce(reason, 'planinitialisierung'), reason_note
    );
    return new;
  end if;

  if new.current_start is distinct from old.current_start then
    insert into schedule_change (project_id, task_id, field, old_value, new_value,
      actor_member_id, actor_role, actor_channel, reason_code, reason_text)
    values (new.project_id, new.id, 'current_start', to_jsonb(old.current_start),
      to_jsonb(new.current_start), actor_member, actor, channel, reason, reason_note);
  end if;

  if new.current_end is distinct from old.current_end then
    insert into schedule_change (project_id, task_id, field, old_value, new_value,
      actor_member_id, actor_role, actor_channel, reason_code, reason_text)
    values (new.project_id, new.id, 'current_end', to_jsonb(old.current_end),
      to_jsonb(new.current_end), actor_member, actor, channel, reason, reason_note);
  end if;

  if new.duration_days is distinct from old.duration_days then
    insert into schedule_change (project_id, task_id, field, old_value, new_value,
      actor_member_id, actor_role, actor_channel, reason_code, reason_text)
    values (new.project_id, new.id, 'duration_days', to_jsonb(old.duration_days),
      to_jsonb(new.duration_days), actor_member, actor, channel, reason, reason_note);
  end if;

  if new.status is distinct from old.status then
    insert into schedule_change (project_id, task_id, field, old_value, new_value,
      actor_member_id, actor_role, actor_channel, reason_code, reason_text)
    values (new.project_id, new.id, 'status', to_jsonb(old.status),
      to_jsonb(new.status), actor_member, actor, channel, reason, reason_note);
  end if;

  return new;
end
$$;

create trigger task_log_change
  after insert or update on task
  for each row execute function mbl.log_task_change();

-- `created_by` ist unveränderlich. Sonst ließe sich der Lesezugriff aus
-- project_read verschieben oder entziehen.
create or replace function mbl.guard_created_by()
returns trigger
language plpgsql
as $$
begin
  if new.created_by is distinct from old.created_by then
    raise exception 'Der Ersteller eines Projekts kann nicht geändert werden.'
      using errcode = 'raise_exception';
  end if;
  return new;
end
$$;

create trigger project_guard_created_by
  before update on project
  for each row execute function mbl.guard_created_by();

-- (5) Abhängigkeiten dürfen keinen Zyklus schließen.
create or replace function mbl.guard_dependency_cycle()
returns trigger
language plpgsql
security definer
set search_path = mbl, public
as $$
declare
  cycle_path uuid[];
begin
  if new.predecessor_id = new.successor_id then
    raise exception 'Ein Vorgang kann nicht sein eigener Vorgänger sein.'
      using errcode = 'raise_exception';
  end if;

  -- Erreicht der Nachfolger den Vorgänger, schließt die neue Kante einen Kreis.
  with recursive reachable (task_id, path) as (
    select new.successor_id, array[new.successor_id]
    union all
    select d.successor_id, r.path || d.successor_id
    from dependency d
    join reachable r on d.predecessor_id = r.task_id
    where not d.successor_id = any (r.path)
      and d.id is distinct from new.id
  )
  select path into cycle_path
  from reachable
  where task_id = new.predecessor_id
  limit 1;

  if cycle_path is not null then
    raise exception
      'Diese Abhängigkeit würde einen Zyklus schließen: %', cycle_path
      using errcode = 'raise_exception',
            hint = 'Ein Bauablauf darf sich nicht im Kreis drehen.';
  end if;

  return new;
end
$$;

create trigger dependency_guard_cycle
  before insert or update on dependency
  for each row execute function mbl.guard_dependency_cycle();

-- Nachfassen: Rechte auf später angelegte Objekte in mbl.
grant execute on all functions in schema mbl to anon, authenticated;
