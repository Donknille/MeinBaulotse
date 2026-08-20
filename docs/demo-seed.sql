-- MeinBaulotse — Demolage für den Testzugang
--
-- Erzeugt von apps/api/scripts/demo-sql.ts. Nicht von Hand bearbeiten;
-- für einen neuen Baustart `pnpm demo:sql` erneut aufrufen.
--
-- Einzufügen im Supabase-Dashboard unter SQL Editor → New query → Run.
-- Voraussetzung: Die Migrationen aus supabase/migrations sind eingespielt.
--
-- Das Skript ist wiederholbar. Es legt an, was fehlt, und lässt stehen, was da
-- ist. Gelöscht wird nichts — `schedule_change` ist append-only.
--
-- Baustart 2026-09-21, geschuldet 2027-03-20, 38 Vorgänge.

-- ---------------------------------------------------------------------------
-- 1. Die beiden Demo-Nutzer.
--
-- Bewusst nur Kennung und Adresse: Diese Nutzer melden sich nie über Supabase
-- Auth an, sondern über den Testzugang der Anwendung (/demo). Die Zeilen
-- existieren, weil project_member.user_id auf auth.users verweist.
-- ---------------------------------------------------------------------------

insert into auth.users (id, email)
values
  ('11111111-1111-4111-8111-111111111111', 'bauherr@demo.meinbaulotse.de'),
  ('22222222-2222-4222-8222-222222222222', 'gu@demo.meinbaulotse.de')
on conflict do nothing;

-- Auf Supabase hat auth.users mehr Spalten als die lokale Nachbildung. Wo es
-- sie gibt, werden sie gefüllt, damit die Zeilen im Dashboard sauber aussehen.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'auth' and table_name = 'users' and column_name = 'aud'
  ) then
    update auth.users
       set aud = 'authenticated',
           role = 'authenticated',
           email_confirmed_at = coalesce(email_confirmed_at, now())
     where id in ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Ab hier schreibt der Bauherr, nicht der Datenbankeigentümer.
--
-- Damit greifen dieselben Policies wie im Betrieb, und die Historie in
-- schedule_change nennt ihn als Verursacher.
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","email":"bauherr@demo.meinbaulotse.de"}', false);
select set_config('role', 'authenticated', false);
select set_config('app.actor_channel', 'import', false);

-- ---------------------------------------------------------------------------
-- 3. Das Bauvorhaben.
-- ---------------------------------------------------------------------------

insert into public.project (
  id, name, federal_state, catholic_municipality, build_type, contract_type,
  has_basement, plan_template_key, planned_start, contractual_completion, created_by
)
values (
  'aaaaaaaa-0000-4000-8000-000000000001', 'Musterhaus Sonnenweg', 'BY'::mbl.federal_state, true,
  'efh_massiv'::mbl.build_type, 'verbraucherbauvertrag'::mbl.contract_type, true,
  'efh_massiv_unterkellert', '2026-09-21', '2027-03-20',
  '11111111-1111-4111-8111-111111111111'
)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 4. Die Beteiligten.
--
-- Der Bauherr zuerst: Erst mit seiner Zeile greift sein Schreibrecht, und erst
-- dadurch darf er den Generalunternehmer eintragen.
-- ---------------------------------------------------------------------------

insert into public.project_member (
  id, project_id, user_id, role, display_name, company, email, accepted_at
)
values (
  'bbbbbbbb-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
  'owner'::mbl.member_role, 'Familie Sonnenweg', null,
  'bauherr@demo.meinbaulotse.de', now()
)
on conflict do nothing;

insert into public.project_member (
  id, project_id, user_id, role, display_name, company, email, accepted_at
)
values (
  'bbbbbbbb-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222',
  'contractor'::mbl.member_role, 'Jörg Baumeister', 'Baumeister Bau GmbH',
  'gu@demo.meinbaulotse.de', now()
)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 5. Die Vorgänge, fertig gerechnet.
--
-- Termine und Puffer kommen aus packages/schedule — hier steht nur das
-- Ergebnis. Der Trigger task_log_change schreibt zu jeder Zeile einen Eintrag
-- in schedule_change.
-- ---------------------------------------------------------------------------

insert into public.task (
  id, project_id, trade_id, name, phase_key, template_task_code, sort_order,
  is_milestone, is_wait, duration_days, duration_unit,
  baseline_start, baseline_end, current_start, current_end,
  status, confirmation, total_float_days, is_critical
)
values
  ('cccccccc-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', (select id from public.trade where code = 'gutachter' and project_id is null), 'Baugrundgutachten', 'vorbereitung', 't01', 10, false, false, 10, 'werktage'::mbl.duration_unit, '2026-09-21', '2026-10-02', '2026-09-21', '2026-10-02', 'terminiert'::mbl.task_status, 'self_stated'::mbl.confirmation, 128, false),
  ('cccccccc-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001', (select id from public.trade where code = 'vermesser' and project_id is null), 'Vermessung, Absteckung, Schnurgerüst', 'vorbereitung', 't02', 20, false, false, 1, 'werktage'::mbl.duration_unit, '2026-09-21', '2026-09-21', '2026-09-21', '2026-09-21', 'terminiert'::mbl.task_status, 'self_stated'::mbl.confirmation, 2, false),
  ('cccccccc-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000001', (select id from public.trade where code = 'gu' and project_id is null), 'Baustelleneinrichtung, Bauwasser, Baustrom', 'vorbereitung', 't03', 30, false, false, 2, 'werktage'::mbl.duration_unit, '2026-09-22', '2026-09-23', '2026-09-22', '2026-09-23', 'terminiert'::mbl.task_status, 'self_stated'::mbl.confirmation, 2, false),
  ('cccccccc-0000-4000-8000-000000000004', 'aaaaaaaa-0000-4000-8000-000000000001', (select id from public.trade where code = 'erdbau' and project_id is null), 'Erdarbeiten, Baugrube', 'gruendung', 't04', 40, false, false, 3, 'werktage'::mbl.duration_unit, '2026-09-24', '2026-09-28', '2026-09-24', '2026-09-28', 'terminiert'::mbl.task_status, 'self_stated'::mbl.confirmation, 2, false),
  ('cccccccc-0000-4000-8000-000000000005', 'aaaaaaaa-0000-4000-8000-000000000001', (select id from public.trade where code = 'rohbau' and project_id is null), 'Sauberkeitsschicht, Fundamenterder', 'gruendung', 't05', 50, false, false, 2, 'werktage'::mbl.duration_unit, '2026-09-29', '2026-09-30', '2026-09-29', '2026-09-30', 'terminiert'::mbl.task_status, 'self_stated'::mbl.confirmation, 2, false),
  ('cccccccc-0000-4000-8000-000000000006', 'aaaaaaaa-0000-4000-8000-000000000001', (select id from public.trade where code = 'rohbau' and project_id is null), 'Bodenplatte', 'gruendung', 't06', 60, false, false, 4, 'werktage'::mbl.duration_unit, '2026-10-01', '2026-10-06', '2026-10-01', '2026-10-06', 'terminiert'::mbl.task_status, 'self_stated'::mbl.confirmation, 2, false),
  ('cccccccc-0000-4000-8000-000000000007', 'aaaaaaaa-0000-4000-8000-000000000001', null, 'Aushärtung Bodenplatte', 'gruendung', 't07', 70, false, true, 3, 'kalendertage'::mbl.duration_unit, '2026-10-07', '2026-10-09', '2026-10-07', '2026-10-09', 'terminiert'::mbl.task_status, 'self_stated'::mbl.confirmation, 0, true),
  ('cccccccc-0000-4000-8000-000000000008', 'aaaaaaaa-0000-4000-8000-000000000001', (select id from public.trade where code = 'rohbau' and project_id is null), 'Kellerwände', 'gruendung', 't08', 80, false, false, 8, 'werktage'::mbl.duration_unit, '2026-10-12', '2026-10-21', '2026-10-12', '2026-10-21', 'terminiert'::mbl.task_status, 'self_stated'::mbl.confirmation, 0, true),
  ('cccccccc-0000-4000-8000-000000000009', 'aaaaaaaa-0000-4000-8000-000000000001', (select id from public.trade where code = 'rohbau' and project_id is null), 'Kellerdecke', 'gruendung', 't09', 90, false, false, 4, 'werktage'::mbl.duration_unit, '2026-10-22', '2026-10-27', '2026-10-22', '2026-10-27', 'terminiert'::mbl.task_status, 'self_stated'::mbl.confirmation, 0, true),
  ('cccccccc-0000-4000-8000-000000000010', 'aaaaaaaa-0000-4000-8000-000000000001', (select id from public.trade where code = 'rohbau' and project_id is null), 'Abdichtung, Perimeterdämmung, Drainage', 'gruendung', 't10', 100, false, false, 3, 'werktage'::mbl.duration_unit, '2026-10-28', '2026-10-30', '2026-10-28', '2026-10-30', 'terminiert'::mbl.task_status, 'self_stated'::mbl.confirmation, 106, false),
  ('cccccccc-0000-4000-8000-000000000011', 'aaaaaaaa-0000-4000-8000-000000000001', (select id from public.trade where code = 'erdbau' and project_id is null), 'Verfüllung Arbeitsraum', 'gruendung', 't11', 110, false, false, 2, 'werktage'::mbl.duration_unit, '2026-11-02', '2026-11-03', '2026-11-02', '2026-11-03', 'terminiert'::mbl.task_status, 'self_stated'::mbl.confirmation, 106, false),
  ('cccccccc-0000-4000-8000-000000000012', 'aaaaaaaa-0000-4000-8000-000000000001', (select id from public.trade where code = 'rohbau' and project_id is null), 'Erdgeschoss-Mauerwerk', 'rohbau', 't12', 120, false, false, 8, 'werktage'::mbl.duration_unit, '2026-10-28', '2026-11-06', '2026-10-28', '2026-11-06', 'terminiert'::mbl.task_status, 'self_stated'::mbl.confirmation, 0, true),
  ('cccccccc-0000-4000-8000-000000000013', 'aaaaaaaa-0000-4000-8000-000000000001', (select id from public.trade where code = 'rohbau' and project_id is null), 'Geschossdecke EG', 'rohbau', 't13', 130, false, false, 4, 'werktage'::mbl.duration_unit, '2026-11-09', '2026-11-12', '2026-11-09', '2026-11-12', 'terminiert'::mbl.task_status, 'self_stated'::mbl.confirmation, 0, true),
  ('cccccccc-0000-4000-8000-000000000014', 'aaaaaaaa-0000-4000-8000-000000000001', (select id from public.trade where code = 'rohbau' and project_id is null), 'Obergeschoss, Drempel, Ringanker', 'rohbau', 't14', 140, false, false, 7, 'werktage'::mbl.duration_unit, '2026-11-13', '2026-11-23', '2026-11-13', '2026-11-23', 'terminiert'::mbl.task_status, 'self_stated'::mbl.confirmation, 0, true),
  ('cccccccc-0000-4000-8000-000000000015', 'aaaaaaaa-0000-4000-8000-000000000001', null, 'Rohbau fertig, Richtfest', 'rohbau', 't15', 150, true, false, 0, 'werktage'::mbl.duration_unit, '2026-11-24', '2026-11-24', '2026-11-24', '2026-11-24', 'terminiert'::mbl.task_status, 'self_stated'::mbl.confirmation, 0, true),
  ('cccccccc-0000-4000-8000-000000000016', 'aaaaaaaa-0000-4000-8000-000000000001', (select id from public.trade where code = 'zimmerer' and project_id is null), 'Dachstuhl', 'dach_huelle', 't16', 160, false, false, 4, 'werktage'::mbl.duration_unit, '2026-11-25', '2026-11-30', '2026-11-25', '2026-11-30', 'terminiert'::mbl.task_status, 'self_stated'::mbl.confirmation, 0, true),
  ('cccccccc-0000-4000-8000-000000000017', 'aaaaaaaa-0000-4000-8000-000000000001', (select id from public.trade where code = 'dachdecker' and project_id is null), 'Dacheindeckung, Klempnerarbeiten', 'dach_huelle', 't17', 170, false, false, 6, 'werktage'::mbl.duration_unit, '2026-12-01', '2026-12-08', '2026-12-01', '2026-12-08', 'terminiert'::mbl.task_status, 'self_stated'::mbl.confirmation, 0, true),
  ('cccccccc-0000-4000-8000-000000000018', 'aaaaaaaa-0000-4000-8000-000000000001', (select id from public.trade where code = 'fensterbau' and project_id is null), 'Fenster und Haustür', 'dach_huelle', 't18', 180, false, false, 3, 'werktage'::mbl.duration_unit, '2026-12-01', '2026-12-03', '2026-12-01', '2026-12-03', 'terminiert'::mbl.task_status, 'self_stated'::mbl.confirmation, 3, false),
  ('cccccccc-0000-4000-8000-000000000019', 'aaaaaaaa-0000-4000-8000-000000000001', null, 'Gebäude dicht', 'dach_huelle', 't19', 190, true, false, 0, 'werktage'::mbl.duration_unit, '2026-12-09', '2026-12-09', '2026-12-09', '2026-12-09', 'terminiert'::mbl.task_status, 'self_stated'::mbl.confirmation, 0, true),
  ('cccccccc-0000-4000-8000-000000000020', 'aaaaaaaa-0000-4000-8000-000000000001', (select id from public.trade where code = 'elektro' and project_id is null), 'Rohinstallation Elektro', 'rohinstallation', 't20', 200, false, false, 8, 'werktage'::mbl.duration_unit, '2026-12-10', '2026-12-21', '2026-12-10', '2026-12-21', 'terminiert'::mbl.task_status, 'self_stated'::mbl.confirmation, 4, false),
  ('cccccccc-0000-4000-8000-000000000021', 'aaaaaaaa-0000-4000-8000-000000000001', (select id from public.trade where code = 'shk' and project_id is null), 'Rohinstallation Sanitär und Heizung', 'rohinstallation', 't21', 210, false, false, 8, 'werktage'::mbl.duration_unit, '2026-12-10', '2026-12-21', '2026-12-10', '2026-12-21', 'terminiert'::mbl.task_status, 'self_stated'::mbl.confirmation, 0, true),
  ('cccccccc-0000-4000-8000-000000000022', 'aaaaaaaa-0000-4000-8000-000000000001', (select id from public.trade where code = 'shk' and project_id is null), 'Lüftungsanlage', 'rohinstallation', 't22', 220, false, false, 4, 'werktage'::mbl.duration_unit, '2026-12-22', '2026-12-28', '2026-12-22', '2026-12-28', 'terminiert'::mbl.task_status, 'self_stated'::mbl.confirmation, 0, true),
  ('cccccccc-0000-4000-8000-000000000023', 'aaaaaaaa-0000-4000-8000-000000000001', (select id from public.trade where code = 'pruefer' and project_id is null), 'Blower-Door-Vorabtest', 'rohinstallation', 't23', 230, false, false, 1, 'werktage'::mbl.duration_unit, '2026-12-29', '2026-12-29', '2026-12-29', '2026-12-29', 'terminiert'::mbl.task_status, 'self_stated'::mbl.confirmation, 0, true),
  ('cccccccc-0000-4000-8000-000000000024', 'aaaaaaaa-0000-4000-8000-000000000001', (select id from public.trade where code = 'putzer' and project_id is null), 'Innenputz', 'ausbau', 't24', 240, false, false, 8, 'werktage'::mbl.duration_unit, '2026-12-30', '2027-01-12', '2026-12-30', '2027-01-12', 'terminiert'::mbl.task_status, 'self_stated'::mbl.confirmation, 2, false),
  ('cccccccc-0000-4000-8000-000000000025', 'aaaaaaaa-0000-4000-8000-000000000001', (select id from public.trade where code = 'trockenbau' and project_id is null), 'Trockenbau, Dachgeschossausbau', 'ausbau', 't25', 250, false, false, 10, 'werktage'::mbl.duration_unit, '2026-12-30', '2027-01-14', '2026-12-30', '2027-01-14', 'terminiert'::mbl.task_status, 'self_stated'::mbl.confirmation, 0, true),
  ('cccccccc-0000-4000-8000-000000000026', 'aaaaaaaa-0000-4000-8000-000000000001', (select id from public.trade where code = 'estrich' and project_id is null), 'Estrich', 'ausbau', 't26', 260, false, false, 3, 'werktage'::mbl.duration_unit, '2027-01-15', '2027-01-19', '2027-01-15', '2027-01-19', 'terminiert'::mbl.task_status, 'self_stated'::mbl.confirmation, 0, true),
  ('cccccccc-0000-4000-8000-000000000027', 'aaaaaaaa-0000-4000-8000-000000000001', null, 'Trocknung bis Belegreife', 'ausbau', 't27', 270, false, true, 35, 'kalendertage'::mbl.duration_unit, '2027-01-20', '2027-02-23', '2027-01-20', '2027-02-23', 'terminiert'::mbl.task_status, 'self_stated'::mbl.confirmation, 0, true),
  ('cccccccc-0000-4000-8000-000000000028', 'aaaaaaaa-0000-4000-8000-000000000001', (select id from public.trade where code = 'fliesen' and project_id is null), 'Fliesenarbeiten', 'endausbau', 't28', 280, false, false, 8, 'werktage'::mbl.duration_unit, '2027-02-24', '2027-03-05', '2027-02-24', '2027-03-05', 'terminiert'::mbl.task_status, 'self_stated'::mbl.confirmation, 0, true),
  ('cccccccc-0000-4000-8000-000000000029', 'aaaaaaaa-0000-4000-8000-000000000001', (select id from public.trade where code = 'tischler' and project_id is null), 'Innentüren', 'endausbau', 't29', 290, false, false, 3, 'werktage'::mbl.duration_unit, '2027-01-13', '2027-01-15', '2027-01-13', '2027-01-15', 'terminiert'::mbl.task_status, 'self_stated'::mbl.confirmation, 35, false),
  ('cccccccc-0000-4000-8000-000000000030', 'aaaaaaaa-0000-4000-8000-000000000001', (select id from public.trade where code = 'maler' and project_id is null), 'Malerarbeiten', 'endausbau', 't30', 300, false, false, 8, 'werktage'::mbl.duration_unit, '2027-03-08', '2027-03-17', '2027-03-08', '2027-03-17', 'terminiert'::mbl.task_status, 'self_stated'::mbl.confirmation, 0, true),
  ('cccccccc-0000-4000-8000-000000000031', 'aaaaaaaa-0000-4000-8000-000000000001', (select id from public.trade where code = 'bodenleger' and project_id is null), 'Bodenbeläge', 'endausbau', 't31', 310, false, false, 5, 'werktage'::mbl.duration_unit, '2027-03-18', '2027-03-24', '2027-03-18', '2027-03-24', 'terminiert'::mbl.task_status, 'self_stated'::mbl.confirmation, 0, true),
  ('cccccccc-0000-4000-8000-000000000032', 'aaaaaaaa-0000-4000-8000-000000000001', (select id from public.trade where code = 'treppenbau' and project_id is null), 'Treppe', 'endausbau', 't32', 320, false, false, 2, 'werktage'::mbl.duration_unit, '2027-03-18', '2027-03-19', '2027-03-18', '2027-03-19', 'terminiert'::mbl.task_status, 'self_stated'::mbl.confirmation, 11, false),
  ('cccccccc-0000-4000-8000-000000000033', 'aaaaaaaa-0000-4000-8000-000000000001', (select id from public.trade where code = 'elektro' and project_id is null), 'Endmontage Elektro', 'endausbau', 't33', 330, false, false, 4, 'werktage'::mbl.duration_unit, '2027-03-25', '2027-04-01', '2027-03-25', '2027-04-01', 'terminiert'::mbl.task_status, 'self_stated'::mbl.confirmation, 0, true),
  ('cccccccc-0000-4000-8000-000000000034', 'aaaaaaaa-0000-4000-8000-000000000001', (select id from public.trade where code = 'shk' and project_id is null), 'Endmontage Sanitär', 'endausbau', 't34', 340, false, false, 4, 'werktage'::mbl.duration_unit, '2027-03-25', '2027-04-01', '2027-03-25', '2027-04-01', 'terminiert'::mbl.task_status, 'self_stated'::mbl.confirmation, 0, true),
  ('cccccccc-0000-4000-8000-000000000035', 'aaaaaaaa-0000-4000-8000-000000000001', (select id from public.trade where code = 'galabau' and project_id is null), 'Außenanlagen, Zufahrt, Pflaster', 'aussenanlagen', 't35', 350, false, false, 10, 'werktage'::mbl.duration_unit, '2026-12-10', '2026-12-23', '2026-12-10', '2026-12-23', 'terminiert'::mbl.task_status, 'self_stated'::mbl.confirmation, 70, false),
  ('cccccccc-0000-4000-8000-000000000036', 'aaaaaaaa-0000-4000-8000-000000000001', (select id from public.trade where code = 'reinigung' and project_id is null), 'Baureinigung', 'abnahme', 't36', 360, false, false, 2, 'werktage'::mbl.duration_unit, '2027-04-02', '2027-04-05', '2027-04-02', '2027-04-05', 'terminiert'::mbl.task_status, 'self_stated'::mbl.confirmation, 0, true),
  ('cccccccc-0000-4000-8000-000000000037', 'aaaaaaaa-0000-4000-8000-000000000001', null, 'Abnahme und Übergabe', 'abnahme', 't37', 370, true, false, 0, 'werktage'::mbl.duration_unit, '2027-04-06', '2027-04-06', '2027-04-06', '2027-04-06', 'terminiert'::mbl.task_status, 'self_stated'::mbl.confirmation, 0, true),
  ('cccccccc-0000-4000-8000-000000000038', 'aaaaaaaa-0000-4000-8000-000000000001', null, 'Schlussrechnung, Restzahlung', 'abnahme', 't38', 380, true, false, 0, 'werktage'::mbl.duration_unit, '2027-04-07', '2027-04-07', '2027-04-07', '2027-04-07', 'terminiert'::mbl.task_status, 'self_stated'::mbl.confirmation, 0, true)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 6. Die Abhängigkeiten zwischen den Vorgängen.
-- ---------------------------------------------------------------------------

insert into public.dependency (
  id, project_id, predecessor_id, successor_id, type, lag_days, lag_unit
)
values
  ('dddddddd-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000002', 'cccccccc-0000-4000-8000-000000000003', 'FS'::mbl.dependency_type, 0, 'werktage'::mbl.duration_unit),
  ('dddddddd-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000003', 'cccccccc-0000-4000-8000-000000000004', 'FS'::mbl.dependency_type, 0, 'werktage'::mbl.duration_unit),
  ('dddddddd-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000004', 'cccccccc-0000-4000-8000-000000000005', 'FS'::mbl.dependency_type, 0, 'werktage'::mbl.duration_unit),
  ('dddddddd-0000-4000-8000-000000000004', 'aaaaaaaa-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000005', 'cccccccc-0000-4000-8000-000000000006', 'FS'::mbl.dependency_type, 0, 'werktage'::mbl.duration_unit),
  ('dddddddd-0000-4000-8000-000000000005', 'aaaaaaaa-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000006', 'cccccccc-0000-4000-8000-000000000007', 'FS'::mbl.dependency_type, 0, 'werktage'::mbl.duration_unit),
  ('dddddddd-0000-4000-8000-000000000006', 'aaaaaaaa-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000007', 'cccccccc-0000-4000-8000-000000000008', 'FS'::mbl.dependency_type, 0, 'werktage'::mbl.duration_unit),
  ('dddddddd-0000-4000-8000-000000000007', 'aaaaaaaa-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000008', 'cccccccc-0000-4000-8000-000000000009', 'FS'::mbl.dependency_type, 0, 'werktage'::mbl.duration_unit),
  ('dddddddd-0000-4000-8000-000000000008', 'aaaaaaaa-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000009', 'cccccccc-0000-4000-8000-000000000010', 'FS'::mbl.dependency_type, 0, 'werktage'::mbl.duration_unit),
  ('dddddddd-0000-4000-8000-000000000009', 'aaaaaaaa-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000010', 'cccccccc-0000-4000-8000-000000000011', 'FS'::mbl.dependency_type, 0, 'werktage'::mbl.duration_unit),
  ('dddddddd-0000-4000-8000-000000000010', 'aaaaaaaa-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000009', 'cccccccc-0000-4000-8000-000000000012', 'FS'::mbl.dependency_type, 0, 'werktage'::mbl.duration_unit),
  ('dddddddd-0000-4000-8000-000000000011', 'aaaaaaaa-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000012', 'cccccccc-0000-4000-8000-000000000013', 'FS'::mbl.dependency_type, 0, 'werktage'::mbl.duration_unit),
  ('dddddddd-0000-4000-8000-000000000012', 'aaaaaaaa-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000013', 'cccccccc-0000-4000-8000-000000000014', 'FS'::mbl.dependency_type, 0, 'werktage'::mbl.duration_unit),
  ('dddddddd-0000-4000-8000-000000000013', 'aaaaaaaa-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000014', 'cccccccc-0000-4000-8000-000000000015', 'FS'::mbl.dependency_type, 0, 'werktage'::mbl.duration_unit),
  ('dddddddd-0000-4000-8000-000000000014', 'aaaaaaaa-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000015', 'cccccccc-0000-4000-8000-000000000016', 'FS'::mbl.dependency_type, 0, 'werktage'::mbl.duration_unit),
  ('dddddddd-0000-4000-8000-000000000015', 'aaaaaaaa-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000016', 'cccccccc-0000-4000-8000-000000000017', 'FS'::mbl.dependency_type, 0, 'werktage'::mbl.duration_unit),
  ('dddddddd-0000-4000-8000-000000000016', 'aaaaaaaa-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000016', 'cccccccc-0000-4000-8000-000000000018', 'FS'::mbl.dependency_type, 0, 'werktage'::mbl.duration_unit),
  ('dddddddd-0000-4000-8000-000000000017', 'aaaaaaaa-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000017', 'cccccccc-0000-4000-8000-000000000019', 'FS'::mbl.dependency_type, 0, 'werktage'::mbl.duration_unit),
  ('dddddddd-0000-4000-8000-000000000018', 'aaaaaaaa-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000018', 'cccccccc-0000-4000-8000-000000000019', 'FS'::mbl.dependency_type, 0, 'werktage'::mbl.duration_unit),
  ('dddddddd-0000-4000-8000-000000000019', 'aaaaaaaa-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000019', 'cccccccc-0000-4000-8000-000000000020', 'FS'::mbl.dependency_type, 0, 'werktage'::mbl.duration_unit),
  ('dddddddd-0000-4000-8000-000000000020', 'aaaaaaaa-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000019', 'cccccccc-0000-4000-8000-000000000021', 'FS'::mbl.dependency_type, 0, 'werktage'::mbl.duration_unit),
  ('dddddddd-0000-4000-8000-000000000021', 'aaaaaaaa-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000021', 'cccccccc-0000-4000-8000-000000000022', 'FS'::mbl.dependency_type, 0, 'werktage'::mbl.duration_unit),
  ('dddddddd-0000-4000-8000-000000000022', 'aaaaaaaa-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000020', 'cccccccc-0000-4000-8000-000000000023', 'FS'::mbl.dependency_type, 0, 'werktage'::mbl.duration_unit),
  ('dddddddd-0000-4000-8000-000000000023', 'aaaaaaaa-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000021', 'cccccccc-0000-4000-8000-000000000023', 'FS'::mbl.dependency_type, 0, 'werktage'::mbl.duration_unit),
  ('dddddddd-0000-4000-8000-000000000024', 'aaaaaaaa-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000022', 'cccccccc-0000-4000-8000-000000000023', 'FS'::mbl.dependency_type, 0, 'werktage'::mbl.duration_unit),
  ('dddddddd-0000-4000-8000-000000000025', 'aaaaaaaa-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000023', 'cccccccc-0000-4000-8000-000000000024', 'FS'::mbl.dependency_type, 0, 'werktage'::mbl.duration_unit),
  ('dddddddd-0000-4000-8000-000000000026', 'aaaaaaaa-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000023', 'cccccccc-0000-4000-8000-000000000025', 'FS'::mbl.dependency_type, 0, 'werktage'::mbl.duration_unit),
  ('dddddddd-0000-4000-8000-000000000027', 'aaaaaaaa-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000024', 'cccccccc-0000-4000-8000-000000000026', 'FS'::mbl.dependency_type, 0, 'werktage'::mbl.duration_unit),
  ('dddddddd-0000-4000-8000-000000000028', 'aaaaaaaa-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000025', 'cccccccc-0000-4000-8000-000000000026', 'FS'::mbl.dependency_type, 0, 'werktage'::mbl.duration_unit),
  ('dddddddd-0000-4000-8000-000000000029', 'aaaaaaaa-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000026', 'cccccccc-0000-4000-8000-000000000027', 'FS'::mbl.dependency_type, 0, 'werktage'::mbl.duration_unit),
  ('dddddddd-0000-4000-8000-000000000030', 'aaaaaaaa-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000027', 'cccccccc-0000-4000-8000-000000000028', 'FS'::mbl.dependency_type, 0, 'werktage'::mbl.duration_unit),
  ('dddddddd-0000-4000-8000-000000000031', 'aaaaaaaa-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000024', 'cccccccc-0000-4000-8000-000000000029', 'FS'::mbl.dependency_type, 0, 'werktage'::mbl.duration_unit),
  ('dddddddd-0000-4000-8000-000000000032', 'aaaaaaaa-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000028', 'cccccccc-0000-4000-8000-000000000030', 'FS'::mbl.dependency_type, 0, 'werktage'::mbl.duration_unit),
  ('dddddddd-0000-4000-8000-000000000033', 'aaaaaaaa-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000029', 'cccccccc-0000-4000-8000-000000000030', 'FS'::mbl.dependency_type, 0, 'werktage'::mbl.duration_unit),
  ('dddddddd-0000-4000-8000-000000000034', 'aaaaaaaa-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000030', 'cccccccc-0000-4000-8000-000000000031', 'FS'::mbl.dependency_type, 0, 'werktage'::mbl.duration_unit),
  ('dddddddd-0000-4000-8000-000000000035', 'aaaaaaaa-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000030', 'cccccccc-0000-4000-8000-000000000032', 'FS'::mbl.dependency_type, 0, 'werktage'::mbl.duration_unit),
  ('dddddddd-0000-4000-8000-000000000036', 'aaaaaaaa-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000031', 'cccccccc-0000-4000-8000-000000000033', 'FS'::mbl.dependency_type, 0, 'werktage'::mbl.duration_unit),
  ('dddddddd-0000-4000-8000-000000000037', 'aaaaaaaa-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000028', 'cccccccc-0000-4000-8000-000000000034', 'FS'::mbl.dependency_type, 0, 'werktage'::mbl.duration_unit),
  ('dddddddd-0000-4000-8000-000000000038', 'aaaaaaaa-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000031', 'cccccccc-0000-4000-8000-000000000034', 'FS'::mbl.dependency_type, 0, 'werktage'::mbl.duration_unit),
  ('dddddddd-0000-4000-8000-000000000039', 'aaaaaaaa-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000019', 'cccccccc-0000-4000-8000-000000000035', 'FS'::mbl.dependency_type, 0, 'werktage'::mbl.duration_unit),
  ('dddddddd-0000-4000-8000-000000000040', 'aaaaaaaa-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000033', 'cccccccc-0000-4000-8000-000000000036', 'FS'::mbl.dependency_type, 0, 'werktage'::mbl.duration_unit),
  ('dddddddd-0000-4000-8000-000000000041', 'aaaaaaaa-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000034', 'cccccccc-0000-4000-8000-000000000036', 'FS'::mbl.dependency_type, 0, 'werktage'::mbl.duration_unit),
  ('dddddddd-0000-4000-8000-000000000042', 'aaaaaaaa-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000036', 'cccccccc-0000-4000-8000-000000000037', 'FS'::mbl.dependency_type, 0, 'werktage'::mbl.duration_unit),
  ('dddddddd-0000-4000-8000-000000000043', 'aaaaaaaa-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000037', 'cccccccc-0000-4000-8000-000000000038', 'FS'::mbl.dependency_type, 0, 'werktage'::mbl.duration_unit)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 7. Der Protokolleintrag zum Projektstart, wie ihn das Onboarding schreibt.
-- ---------------------------------------------------------------------------

insert into public.audit_log (project_id, actor_channel, action, entity_type, entity_id, meta)
select 'aaaaaaaa-0000-4000-8000-000000000001', 'import'::mbl.actor_channel, 'project.created', 'project',
       'aaaaaaaa-0000-4000-8000-000000000001', '{"template":"efh_massiv_unterkellert","hasBasement":true,"taskCount":38}'::jsonb
where not exists (
  select 1 from public.audit_log
  where project_id = 'aaaaaaaa-0000-4000-8000-000000000001' and action = 'project.created'
);

-- ---------------------------------------------------------------------------
-- 8. Gegenprobe.
-- ---------------------------------------------------------------------------

select
  (select name from public.project where id = 'aaaaaaaa-0000-4000-8000-000000000001')                       as bauvorhaben,
  (select count(*) from public.project_member where project_id = 'aaaaaaaa-0000-4000-8000-000000000001')    as beteiligte,
  (select count(*) from public.task where project_id = 'aaaaaaaa-0000-4000-8000-000000000001')              as vorgaenge,
  (select count(*) from public.dependency where project_id = 'aaaaaaaa-0000-4000-8000-000000000001')        as abhaengigkeiten,
  (select max(current_end) from public.task where project_id = 'aaaaaaaa-0000-4000-8000-000000000001')      as errechnetes_ende;

reset role;
