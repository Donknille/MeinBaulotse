-- ---------------------------------------------------------------------------
-- MeinBaulotse — Mängel, Geld, Vertragsspiegel (Arbeitspaket 8)
--
-- Drei Themen in einer Migration, weil sie ein einziges sind: Der Satz aus
-- Abschnitt 3.10 verbindet sie.
--
--     „Freigabe erst möglich, wenn alle referenzierten Vorgänge fertig oder
--      abgenommen sind und kein offener Mangel mit Schwere wesentlich daran
--      hängt."
--
-- Das ist die teuerste Zeile der ganzen Spezifikation. Wer eine Rate freigibt,
-- während ein wesentlicher Mangel offen ist, gibt sein stärkstes Druckmittel
-- aus der Hand — und merkt es in dem Moment, in dem er es bräuchte. Genau
-- deshalb steht die Sperre als Trigger in der Datenbank und nicht als
-- Bestätigungsdialog in der Oberfläche.
--
-- Die drei Teile:
--
--   `defect`            — was nicht in Ordnung ist, mit Frist und Eskalation
--   `payment_milestone` — was zu zahlen ist, und woran es hängt
--   `contract_check`    — was am Vertrag auffällt, mit Gesetzesstelle
--
-- Und ein Grundsatz über allen dreien, aus Abschnitt 3.9: **Hinweise, nie
-- Bewertungen.** Die Anwendung sagt, was im Gesetz steht und was im Vertrag
-- steht. Ob das eine gegen das andere spricht, sagt ein Anwalt.
-- ---------------------------------------------------------------------------

create type mbl.defect_severity as enum ('geringfuegig', 'wesentlich');

-- Der Weg eines Mangels. `behoben_gemeldet` ist die Stufe, die man beim
-- Entwerfen vergisst und im Betrieb schmerzlich vermisst: Das Unternehmen sagt
-- „erledigt", der Bauherr hat es noch nicht gesehen. Ohne diesen Zustand steht
-- ein Mangel entweder offen (und das Unternehmen ärgert sich) oder behoben
-- (und niemand hat nachgesehen).
create type mbl.defect_status as enum (
  'offen', 'in_bearbeitung', 'behoben_gemeldet', 'behoben', 'abgelehnt'
);

create type mbl.payment_status as enum (
  'offen', 'faellig', 'freigegeben', 'teilfreigabe', 'bezahlt'
);

create type mbl.change_order_status as enum (
  'angefragt', 'vereinbart', 'abgelehnt', 'abgerechnet'
);

-- ---------------------------------------------------------------------------
-- Mängel
-- ---------------------------------------------------------------------------

create table defect (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid not null references project (id) on delete cascade,
  task_id              uuid references task (id) on delete set null,
  trade_id             uuid references trade (id) on delete set null,
  title                text not null,
  description          text,
  location_text        text,
  -- Die Unterscheidung, an der alles hängt: Nur ein **wesentlicher** Mangel
  -- sperrt eine Zahlung. Bei einem Kratzer in der Fensterbank wäre das
  -- unverhältnismäßig, und eine Anwendung, die es trotzdem täte, würde
  -- umgangen statt benutzt.
  severity             mbl.defect_severity not null default 'geringfuegig',
  reported_at          timestamptz not null default now(),
  reported_by          uuid references project_member (id) on delete set null,
  -- Die Frist zur Beseitigung. Ein Mangel ohne Frist ist eine Beschwerde.
  deadline             date,
  status               mbl.defect_status not null default 'offen',
  -- Was tatsächlich getan wurde, nicht was fällig wäre: 0 gemeldet,
  -- 1 Nachfrist gesetzt, 2 Nachfrist verstrichen und angezeigt,
  -- 3 Einbehalt oder Rechtsrat. Die *vorgeschlagene* Stufe rechnet die
  -- Anwendung aus der Frist; hier steht, wo der Bauherr wirklich steht.
  escalation_level     int not null default 0,
  resolved_at          timestamptz,
  accepted_at          timestamptz,
  -- Bei der Abnahme vorbehalten (§ 640 Abs. 3 BGB). Ohne Vorbehalt verliert
  -- der Bauherr Rechte an einem Mangel, den er kannte.
  reserved_at_handover boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint defect_escalation_range check (escalation_level between 0 and 3),
  constraint defect_resolved_needs_time
    check (status <> 'behoben' or resolved_at is not null)
);

create index defect_project_idx on defect (project_id, status);
create index defect_task_idx on defect (task_id) where task_id is not null;
create index defect_open_idx on defect (project_id, severity)
  where status in ('offen', 'in_bearbeitung', 'behoben_gemeldet');

create trigger defect_touch_updated_at
  before update on defect
  for each row execute function mbl.touch_updated_at();

-- „Behoben" trägt seinen Zeitpunkt selbst — dieselbe Überlegung wie bei
-- `decision.decided_at`: Der Zeitpunkt ist die halbe Aussage. „Behoben"
-- beantwortet nicht, ob es innerhalb der Frist war.
create or replace function mbl.stamp_defect_resolved()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'behoben' and new.resolved_at is null then
    new.resolved_at := now();
  elsif tg_op = 'UPDATE' and old.status = 'behoben' and new.status <> 'behoben' then
    new.resolved_at := null;
  end if;
  return new;
end
$$;

create trigger defect_stamp_resolved
  before insert or update on defect
  for each row execute function mbl.stamp_defect_resolved();

/**
 * Ein Mangel gilt als offen, solange ihn nicht der Bauherr abgehakt hat.
 *
 * „Behoben gemeldet" zählt ausdrücklich als offen. Sonst könnte das
 * ausführende Unternehmen die Zahlungssperre selbst aufheben, indem es
 * „erledigt" sagt — und genau davor schützt sie.
 */
create or replace function mbl.defect_is_open(p_status mbl.defect_status)
returns boolean
language sql
immutable
as $$
  select p_status in ('offen', 'in_bearbeitung', 'behoben_gemeldet')
$$;

-- Ein Mangel ohne Foto ist eine Behauptung. Die Spalte stand schon im
-- Datenmodell aus Abschnitt 4, konnte in 0010 aber noch nicht angelegt werden —
-- da gab es die Tabelle `defect` nicht.
alter table media add column defect_id uuid references defect (id) on delete set null;
create index media_defect_idx on media (defect_id) where defect_id is not null;

-- ---------------------------------------------------------------------------
-- Nachträge
-- ---------------------------------------------------------------------------

create table change_order (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references project (id) on delete cascade,
  title            text not null,
  -- Wer ihn ausgelöst hat: bauherr | unternehmen | behoerde | baugrund | sonstiges
  trigger_source   text,
  -- Auf welcher Grundlage: § 650b BGB (Anordnungsrecht), § 650c (Vergütung),
  -- freie Vereinbarung. Als Text, nicht als Aufzählung — die Grundlagen sind
  -- vielfältiger, als eine Liste sie fassen kann.
  bgb_basis        text,
  amount_cents     bigint not null default 0,
  days_impact      int not null default 0,
  affected_task_ids uuid[] not null default '{}',
  status           mbl.change_order_status not null default 'angefragt',
  requested_at     date,
  agreed_at        date,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index change_order_project_idx on change_order (project_id, status);

create trigger change_order_touch_updated_at
  before update on change_order
  for each row execute function mbl.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Zahlungen
-- ---------------------------------------------------------------------------

create table payment_milestone (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references project (id) on delete cascade,
  name             text not null,
  trigger_text     text,
  pct              numeric(5,2),
  amount_cents     bigint not null default 0,
  -- Die Vorgänge, an denen diese Rate hängt. Ohne sie ist eine Rate ein
  -- Datum im Kalender; mit ihnen ist sie an den Bau gekoppelt.
  requires_task_ids uuid[] not null default '{}',
  -- Der Einbehalt am Ende ist keine Rate, sondern ihr Gegenteil: Er wird nicht
  -- gezahlt, sondern zurückgehalten (§ 650m Abs. 2 BGB).
  is_retention     boolean not null default false,
  sort_order       int not null default 0,

  invoice_number   text,
  invoice_date     date,
  due_date         date,
  status           mbl.payment_status not null default 'offen',
  released_by      uuid references project_member (id) on delete set null,
  released_at      timestamptz,
  paid_at          date,
  withheld_cents   bigint not null default 0,
  withheld_reason  text,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint payment_amount_nonneg check (amount_cents >= 0),
  constraint payment_withheld_nonneg check (withheld_cents >= 0),
  constraint payment_withheld_le_amount check (withheld_cents <= amount_cents),
  -- Eine Teilfreigabe ohne Einbehalt ist eine Freigabe, und eine ohne Grund
  -- ist in einem halben Jahr nicht mehr erklärbar.
  constraint payment_partial_needs_reason
    check (status <> 'teilfreigabe' or (withheld_cents > 0 and coalesce(withheld_reason,'') <> ''))
);

create index payment_project_idx on payment_milestone (project_id, sort_order);

create trigger payment_touch_updated_at
  before update on payment_milestone
  for each row execute function mbl.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Die Sperre
--
-- Die teuerste Zeile der Spezifikation, als Trigger. Sie steht hier und nicht
-- in der Oberfläche, weil eine Sperre, die man mit einem zweiten Klick
-- übergehen kann, keine ist — und weil dieselbe Prüfung sonst an drei Stellen
-- stünde und an einer davon veralten würde.
--
-- Was sie prüft, ist Abschnitt 3.10 Wort für Wort:
--   1. alle referenzierten Vorgänge `fertig` oder `abgenommen`
--   2. kein offener Mangel mit Schwere `wesentlich` daran
--
-- Was sie **nicht** verhindert, ist die Teilfreigabe unter Vorbehalt. Der
-- Bauherr soll zahlen können, was unstrittig ist — er will sein Haus fertig
-- haben, nicht recht behalten. Nur muss der Einbehalt dann beziffert und
-- begründet sein, sonst ist er in einem halben Jahr nicht mehr erklärbar.
-- ---------------------------------------------------------------------------

create or replace function mbl.payment_blockers(p_payment uuid)
returns table (kind text, label text)
language sql
stable
security definer
set search_path = mbl, public
as $$
  with rate as (select * from payment_milestone where id = p_payment)
  select 'task'::text, t.name
    from rate, task t
   where t.id = any(rate.requires_task_ids)
     and t.status not in ('fertig', 'abgenommen')
  union all
  select 'defect'::text, d.title
    from rate, defect d
   where d.project_id = rate.project_id
     and d.severity = 'wesentlich'
     and mbl.defect_is_open(d.status)
     and (d.task_id is null or d.task_id = any(rate.requires_task_ids))
$$;
comment on function mbl.payment_blockers(uuid) is
  'Was einer vollen Freigabe im Weg steht — als Liste, nicht als Ja/Nein. Die '
  'Oberfläche soll sagen können, *was* fehlt (Abschnitt 3.10).';

create or replace function mbl.guard_payment_release()
returns trigger
language plpgsql
security definer
set search_path = mbl, public
as $$
declare
  hindernis record;
begin
  if new.status is not distinct from old.status or new.status <> 'freigegeben' then
    return new;
  end if;

  select * into hindernis from mbl.payment_blockers(new.id) limit 1;
  if found then
    raise exception
      'Diese Rate lässt sich noch nicht freigeben: %. Was du stattdessen tun kannst: einen Teil freigeben und den Rest mit Begründung einbehalten.',
      hindernis.label
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;

create trigger payment_guard_release
  before update on payment_milestone
  for each row execute function mbl.guard_payment_release();

-- Freigeben stempelt sich selbst. Ein „freigegeben" ohne Zeitpunkt und ohne
-- Namen ist in einer Bauakte wertlos.
create or replace function mbl.stamp_payment_release()
returns trigger
language plpgsql
security definer
set search_path = mbl, public
as $$
begin
  if new.status in ('freigegeben', 'teilfreigabe')
     and (old.status is null or old.status not in ('freigegeben', 'teilfreigabe')) then
    new.released_at := coalesce(new.released_at, now());
    new.released_by := coalesce(new.released_by, mbl.current_member_id(new.project_id));
  elsif new.status not in ('freigegeben', 'teilfreigabe', 'bezahlt') then
    new.released_at := null;
    new.released_by := null;
  end if;
  return new;
end
$$;

create trigger payment_stamp_release
  before update on payment_milestone
  for each row execute function mbl.stamp_payment_release();

-- ---------------------------------------------------------------------------
-- Zahlungsplan-Vorlage (Abschnitt 7.5), als Daten statt als Konstanten
-- ---------------------------------------------------------------------------

create table payment_template (
  key               text primary key,
  name              text not null,
  trigger_text      text not null,
  /** Vorlagen-Vorgangscode aus 7.2, an den die Rate hängt. */
  task_code         text,
  pct               numeric(5,2) not null,
  is_retention      boolean not null default false,
  sort_order        int not null,
  created_at        timestamptz not null default now()
);
comment on table payment_template is
  'Die Zahlungsplan-Vorlage aus Abschnitt 7.5. Summiert bewusst auf 90 % '
  'Abschläge plus 5 % Einbehalt — genau die Grenze aus § 650m BGB.';

insert into payment_template (key, name, trigger_text, task_code, pct, is_retention, sort_order)
values
  ('rate1', '1. Rate',  'Vertragsschluss, Baufreigabe',    't03', 10.00, false, 10),
  ('rate2', '2. Rate',  'Kellergeschoss fertig',           't11', 15.00, false, 20),
  ('rate3', '3. Rate',  'Rohbau fertig',                   't15', 20.00, false, 30),
  ('rate4', '4. Rate',  'Gebäude dicht',                   't19', 15.00, false, 40),
  ('rate5', '5. Rate',  'Rohinstallationen fertig',        't23', 10.00, false, 50),
  ('rate6', '6. Rate',  'Innenputz und Estrich fertig',    't26', 10.00, false, 60),
  ('rate7', '7. Rate',  'Fliesen und Maler fertig',        't30', 10.00, false, 70),
  ('rate8', '8. Rate',  'Abnahme',                         't37',  5.00, false, 80),
  ('einbehalt', 'Einbehalt Sicherheit',
   'Sicherheit für rechtzeitige Herstellung ohne wesentliche Mängel', null, 5.00, true, 90);

-- ---------------------------------------------------------------------------
-- Finanzierung und Bereitstellungszinsen
-- ---------------------------------------------------------------------------

create table financing (
  project_id             uuid primary key references project (id) on delete cascade,
  loan_amount_cents      bigint,
  own_funds_cents        bigint,
  /** Bereitstellungszins in Basispunkten je Jahr. 300 = 3,00 % p. a. */
  commitment_rate_bp     int,
  /** Bereitstellungsfreie Zeit in Monaten ab Darlehenszusage. */
  commitment_free_months int,
  loan_granted_on        date,
  bank_name              text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint financing_rate_range check (commitment_rate_bp is null or commitment_rate_bp between 0 and 2000)
);

create trigger financing_touch_updated_at
  before update on financing
  for each row execute function mbl.touch_updated_at();

create table loan_drawdown (
  id                        uuid primary key default gen_random_uuid(),
  project_id                uuid not null references project (id) on delete cascade,
  amount_cents              bigint not null,
  requested_at              date not null,
  paid_at                   date,
  /** Errechnet, nicht eingegeben — siehe `packages/schedule/src/interest.ts`. */
  commitment_interest_cents bigint,
  note                      text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint loan_drawdown_amount_positive check (amount_cents > 0)
);
create index loan_drawdown_project_idx on loan_drawdown (project_id, requested_at);

create trigger loan_drawdown_touch_updated_at
  before update on loan_drawdown
  for each row execute function mbl.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Vertragsspiegel
--
-- Abschnitt 3.9: „Automatische **Hinweise**, nie Bewertungen." Der Unterschied
-- ist nicht sprachlich. „Der Zahlungsplan summiert sich auf 95 %, § 650m Abs. 1
-- BGB begrenzt auf 90 %" ist eine Auskunft. „Dein Vertrag ist unwirksam" wäre
-- eine Rechtsberatung, und die darf hier niemand geben.
--
-- Gespeichert werden die Befunde, nicht nur die Regeln: Der Vertragsspiegel
-- gehört später in die Bauakte, und dort zählt, was zum damaligen Zeitpunkt
-- auffiel — nicht, was eine spätere Fassung der Prüfregeln gefunden hätte.
-- ---------------------------------------------------------------------------

create table contract_check (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references project (id) on delete cascade,
  rule_key         text not null,
  severity         text not null default 'hinweis',
  message          text not null,
  legal_reference  text,
  dismissed_at     timestamptz,
  dismissed_reason text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint contract_check_severity_values check (severity in ('hinweis', 'warnung'))
);
create unique index contract_check_rule_key on contract_check (project_id, rule_key);

create trigger contract_check_touch_updated_at
  before update on contract_check
  for each row execute function mbl.touch_updated_at();

-- Vertragsdaten, die es bisher nicht gab. `contract_sum_cents` und
-- `security_pct` stehen seit 0001 auf `project`; alles Weitere kommt hier dazu.
alter table project
  add column contract_signed_on   date,
  add column build_duration_days  int,
  add column building_description_complete boolean;

comment on column project.build_duration_days is
  'Bauzeit in Kalendertagen, falls der Vertrag keine Frist, sondern eine Dauer '
  'nennt. § 650k Abs. 3 BGB verlangt eines von beidem.';
comment on column project.building_description_complete is
  'Ob die Baubeschreibung die Punkte aus Art. 249 EGBGB enthält. Vom Bauherrn '
  'bestätigt, nicht von uns geprüft — wir haben den Vertrag nicht.';

-- ---------------------------------------------------------------------------
-- Rechte
-- ---------------------------------------------------------------------------

grant select on payment_template to authenticated;
grant select, insert, update on defect            to authenticated;
grant select, insert, update, delete on change_order      to authenticated;
grant select, insert, update on payment_milestone to authenticated;
grant select, insert, update on financing         to authenticated;
grant select, insert, update, delete on loan_drawdown     to authenticated;
grant select, insert, update on contract_check    to authenticated;

alter table payment_template  enable row level security;
alter table defect            enable row level security;
alter table change_order      enable row level security;
alter table payment_milestone enable row level security;
alter table financing         enable row level security;
alter table loan_drawdown     enable row level security;
alter table contract_check    enable row level security;

create policy payment_template_read on payment_template for select to authenticated
  using (true);

-- Mängel: lesen darf jedes Mitglied (ein Gewerk nur seine eigenen), erfassen
-- Bauherr und Baubegleiter, auf „behoben" setzen nur der Bauherr. Das
-- ausführende Unternehmen meldet „behoben_gemeldet" — den Haken setzt der,
-- der es nachgesehen hat.
create policy defect_read on defect for select to authenticated
  using (mbl.is_member(project_id) and mbl.trade_scope_ok(project_id, trade_id));

create policy defect_create on defect for insert to authenticated
  with check (mbl.has_perm(project_id, 'defect.write'));

create policy defect_update on defect for update to authenticated
  using (
    mbl.has_perm(project_id, 'defect.resolve')
    or (mbl.has_perm(project_id, 'defect.resolve.propose')
        and mbl.trade_scope_ok(project_id, trade_id))
  )
  with check (
    mbl.has_perm(project_id, 'defect.resolve')
    or (mbl.has_perm(project_id, 'defect.resolve.propose')
        and mbl.trade_scope_ok(project_id, trade_id))
  );

-- Nur der Bauherr darf einen Mangel endgültig abhaken. Wer ihn beheben soll,
-- soll nicht selbst entscheiden, dass er behoben ist.
create or replace function mbl.guard_defect_resolution()
returns trigger
language plpgsql
security definer
set search_path = mbl, public
as $$
begin
  if new.status in ('behoben', 'abgelehnt')
     and old.status is distinct from new.status
     and not mbl.has_perm(new.project_id, 'defect.resolve') then
    raise exception
      'Ob ein Mangel behoben ist, entscheidet der Bauherr. Melde ihn als behoben — dann sieht er nach.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;

create trigger defect_guard_resolution
  before update on defect
  for each row execute function mbl.guard_defect_resolution();

create policy change_order_read on change_order for select to authenticated
  using (mbl.is_member(project_id));
create policy change_order_write on change_order for insert to authenticated
  with check (mbl.has_perm(project_id, 'contract.write'));
create policy change_order_update on change_order for update to authenticated
  using (mbl.has_perm(project_id, 'contract.write'))
  with check (mbl.has_perm(project_id, 'contract.write'));
create policy change_order_delete on change_order for delete to authenticated
  using (mbl.has_perm(project_id, 'contract.write'));

-- Geld liest, wer im Bauvorhaben ist — der Zahlungsplan steht ohnehin im
-- Vertrag. Freigeben darf nur der Bauherr (Rechtematrix 2.2).
create policy payment_read on payment_milestone for select to authenticated
  using (mbl.is_member(project_id));
create policy payment_write on payment_milestone for insert to authenticated
  with check (mbl.has_perm(project_id, 'contract.write'));
create policy payment_update on payment_milestone for update to authenticated
  using (mbl.has_perm(project_id, 'payment.release'))
  with check (mbl.has_perm(project_id, 'payment.release'));

-- Die Finanzierung ist die private Seite des Bauens. Sie liest, wer den
-- Vertrag pflegen darf — nicht das ausführende Unternehmen und kein Gewerk.
create policy financing_read on financing for select to authenticated
  using (mbl.has_perm(project_id, 'contract.write'));
create policy financing_write on financing for insert to authenticated
  with check (mbl.has_perm(project_id, 'contract.write'));
create policy financing_update on financing for update to authenticated
  using (mbl.has_perm(project_id, 'contract.write'))
  with check (mbl.has_perm(project_id, 'contract.write'));

create policy loan_read on loan_drawdown for select to authenticated
  using (mbl.has_perm(project_id, 'contract.write'));
create policy loan_write on loan_drawdown for insert to authenticated
  with check (mbl.has_perm(project_id, 'contract.write'));
create policy loan_update on loan_drawdown for update to authenticated
  using (mbl.has_perm(project_id, 'contract.write'))
  with check (mbl.has_perm(project_id, 'contract.write'));
create policy loan_delete on loan_drawdown for delete to authenticated
  using (mbl.has_perm(project_id, 'contract.write'));

create policy contract_check_read on contract_check for select to authenticated
  using (mbl.is_member(project_id));
create policy contract_check_write on contract_check for insert to authenticated
  with check (mbl.has_perm(project_id, 'contract.write'));
create policy contract_check_update on contract_check for update to authenticated
  using (mbl.has_perm(project_id, 'contract.write'))
  with check (mbl.has_perm(project_id, 'contract.write'));
