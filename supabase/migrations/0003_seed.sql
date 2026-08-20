-- ---------------------------------------------------------------------------
-- MeinBaulotse — Stammdaten (erzeugt, nicht von Hand bearbeiten)
--
-- Erzeugt von packages/db/scripts/generate-seed.ts aus:
--   - packages/schedule/src/templates/efh-massiv-unterkellert.ts
--   - packages/db/src/permissions.ts
--
-- Enthält die neun Bauphasen aus Abschnitt 7.1, die Gewerke, die
-- Rechtematrix aus Abschnitt 2.2 und die Ablaufvorlage aus Abschnitt 7.2.
-- ---------------------------------------------------------------------------

-- Bauphasen -----------------------------------------------------------------

insert into phase (key, name, ordinal) values
  ('vorbereitung', 'Vorbereitung und Vertrag', 1),
  ('gruendung', 'Gründung und Keller', 2),
  ('rohbau', 'Rohbau', 3),
  ('dach_huelle', 'Dach und Gebäudehülle', 4),
  ('rohinstallation', 'Rohinstallationen', 5),
  ('ausbau', 'Innenausbau', 6),
  ('endausbau', 'Endausbau', 7),
  ('aussenanlagen', 'Außenanlagen', 8),
  ('abnahme', 'Abnahme und Übergabe', 9)
on conflict (key) do nothing;

-- Gewerke -------------------------------------------------------------------

insert into trade (project_id, code, name, sort_order) values
  (null, 'gutachter', 'Gutachter', 10),
  (null, 'vermesser', 'Vermesser', 20),
  (null, 'gu', 'Generalunternehmer', 30),
  (null, 'erdbau', 'Erdbau', 40),
  (null, 'rohbau', 'Rohbau', 50),
  (null, 'zimmerer', 'Zimmerer', 60),
  (null, 'dachdecker', 'Dachdecker', 70),
  (null, 'fensterbau', 'Fensterbau', 80),
  (null, 'elektro', 'Elektro', 90),
  (null, 'shk', 'Sanitär, Heizung, Klima', 100),
  (null, 'pruefer', 'Prüfer', 110),
  (null, 'putzer', 'Putzer', 120),
  (null, 'trockenbau', 'Trockenbau', 130),
  (null, 'estrich', 'Estrich', 140),
  (null, 'fliesen', 'Fliesenleger', 150),
  (null, 'tischler', 'Tischler', 160),
  (null, 'maler', 'Maler', 170),
  (null, 'bodenleger', 'Bodenleger', 180),
  (null, 'treppenbau', 'Treppenbau', 190),
  (null, 'galabau', 'Garten- und Landschaftsbau', 200),
  (null, 'reinigung', 'Reinigung', 210)
on conflict do nothing;

-- Rechtematrix (Abschnitt 2.2) ----------------------------------------------

insert into role_permission (role, permission) values
  ('owner', 'project.read'),  -- Lesen
  ('co_owner', 'project.read'),  -- Lesen
  ('contractor', 'project.read'),  -- Lesen
  ('trade', 'project.read'),  -- Lesen
  ('expert', 'project.read'),  -- Lesen
  ('viewer', 'project.read'),  -- Lesen
  ('owner', 'project.delete'),  -- Projekt anlegen/löschen
  ('owner', 'member.invite'),  -- Mitglieder einladen
  ('co_owner', 'member.invite'),  -- Mitglieder einladen
  ('owner', 'task.write'),  -- Vorgänge anlegen/löschen
  ('co_owner', 'task.write'),  -- Vorgänge anlegen/löschen
  ('contractor', 'task.write'),  -- Vorgänge anlegen/löschen
  ('owner', 'task.schedule'),  -- Termin ändern
  ('co_owner', 'task.schedule'),  -- Termin ändern
  ('contractor', 'task.schedule'),  -- Termin ändern
  ('trade', 'task.schedule'),  -- Termin ändern
  ('owner', 'task.confirm'),  -- Termin bestätigen
  ('co_owner', 'task.confirm'),  -- Termin bestätigen
  ('contractor', 'task.confirm'),  -- Termin bestätigen
  ('trade', 'task.confirm'),  -- Termin bestätigen
  ('owner', 'task.progress'),  -- Ist-Beginn/Ist-Ende melden
  ('co_owner', 'task.progress'),  -- Ist-Beginn/Ist-Ende melden
  ('contractor', 'task.progress'),  -- Ist-Beginn/Ist-Ende melden
  ('trade', 'task.progress'),  -- Ist-Beginn/Ist-Ende melden
  ('owner', 'decision.write'),  -- Entscheidung pflegen
  ('co_owner', 'decision.write'),  -- Entscheidung pflegen
  ('expert', 'decision.propose'),  -- Entscheidung pflegen (Vorschlag)
  ('owner', 'diary.write'),  -- Tagebucheintrag erstellen
  ('co_owner', 'diary.write'),  -- Tagebucheintrag erstellen
  ('contractor', 'diary.write'),  -- Tagebucheintrag erstellen
  ('expert', 'diary.write'),  -- Tagebucheintrag erstellen
  ('owner', 'defect.write'),  -- Mangel erfassen
  ('co_owner', 'defect.write'),  -- Mangel erfassen
  ('expert', 'defect.write'),  -- Mangel erfassen
  ('owner', 'defect.resolve'),  -- Mangel auf behoben setzen
  ('co_owner', 'defect.resolve'),  -- Mangel auf behoben setzen
  ('contractor', 'defect.resolve.propose'),  -- Mangel auf behoben setzen (Vorschlag)
  ('trade', 'defect.resolve.propose'),  -- Mangel auf behoben setzen (Vorschlag)
  ('expert', 'defect.resolve.propose'),  -- Mangel auf behoben setzen (Vorschlag)
  ('owner', 'payment.release'),  -- Zahlungsfreigabe
  ('co_owner', 'payment.release'),  -- Zahlungsfreigabe
  ('owner', 'contract.write'),  -- Vertragsdaten pflegen
  ('co_owner', 'contract.write'),  -- Vertragsdaten pflegen
  ('expert', 'contract.write'),  -- Vertragsdaten pflegen
  ('owner', 'export.run'),  -- Akte exportieren
  ('co_owner', 'export.run'),  -- Akte exportieren
  ('expert', 'export.run')  -- Akte exportieren
on conflict do nothing;

-- Ablaufvorlage (Abschnitt 7.2) ---------------------------------------------

insert into plan_template (key, name, build_types, version) values
  ('efh_massiv_unterkellert', 'Einfamilienhaus massiv, unterkellert', '{efh_massiv,efh_fertighaus,sanierung,sonstiges}', 1)
on conflict (key) do nothing;

insert into plan_template_task
  (template_key, code, name, trade_code, phase_key, duration_days, duration_unit,
   is_milestone, is_wait, include_when, sort_order)
values
  ('efh_massiv_unterkellert', 't01', 'Baugrundgutachten', 'gutachter', 'vorbereitung', 10, 'werktage', false, false, 'always', 10),
  ('efh_massiv_unterkellert', 't02', 'Vermessung, Absteckung, Schnurgerüst', 'vermesser', 'vorbereitung', 1, 'werktage', false, false, 'always', 20),
  ('efh_massiv_unterkellert', 't03', 'Baustelleneinrichtung, Bauwasser, Baustrom', 'gu', 'vorbereitung', 2, 'werktage', false, false, 'always', 30),
  ('efh_massiv_unterkellert', 't04', 'Erdarbeiten, Baugrube', 'erdbau', 'gruendung', 3, 'werktage', false, false, 'always', 40),
  ('efh_massiv_unterkellert', 't05', 'Sauberkeitsschicht, Fundamenterder', 'rohbau', 'gruendung', 2, 'werktage', false, false, 'always', 50),
  ('efh_massiv_unterkellert', 't06', 'Bodenplatte', 'rohbau', 'gruendung', 4, 'werktage', false, false, 'always', 60),
  ('efh_massiv_unterkellert', 't07', 'Aushärtung Bodenplatte', null, 'gruendung', 3, 'kalendertage', false, true, 'always', 70),
  ('efh_massiv_unterkellert', 't08', 'Kellerwände', 'rohbau', 'gruendung', 8, 'werktage', false, false, 'with_basement', 80),
  ('efh_massiv_unterkellert', 't09', 'Kellerdecke', 'rohbau', 'gruendung', 4, 'werktage', false, false, 'with_basement', 90),
  ('efh_massiv_unterkellert', 't10', 'Abdichtung, Perimeterdämmung, Drainage', 'rohbau', 'gruendung', 3, 'werktage', false, false, 'with_basement', 100),
  ('efh_massiv_unterkellert', 't11', 'Verfüllung Arbeitsraum', 'erdbau', 'gruendung', 2, 'werktage', false, false, 'with_basement', 110),
  ('efh_massiv_unterkellert', 't12', 'Erdgeschoss-Mauerwerk', 'rohbau', 'rohbau', 8, 'werktage', false, false, 'always', 120),
  ('efh_massiv_unterkellert', 't13', 'Geschossdecke EG', 'rohbau', 'rohbau', 4, 'werktage', false, false, 'always', 130),
  ('efh_massiv_unterkellert', 't14', 'Obergeschoss, Drempel, Ringanker', 'rohbau', 'rohbau', 7, 'werktage', false, false, 'always', 140),
  ('efh_massiv_unterkellert', 't15', 'Rohbau fertig, Richtfest', null, 'rohbau', 0, 'werktage', true, false, 'always', 150),
  ('efh_massiv_unterkellert', 't16', 'Dachstuhl', 'zimmerer', 'dach_huelle', 4, 'werktage', false, false, 'always', 160),
  ('efh_massiv_unterkellert', 't17', 'Dacheindeckung, Klempnerarbeiten', 'dachdecker', 'dach_huelle', 6, 'werktage', false, false, 'always', 170),
  ('efh_massiv_unterkellert', 't18', 'Fenster und Haustür', 'fensterbau', 'dach_huelle', 3, 'werktage', false, false, 'always', 180),
  ('efh_massiv_unterkellert', 't19', 'Gebäude dicht', null, 'dach_huelle', 0, 'werktage', true, false, 'always', 190),
  ('efh_massiv_unterkellert', 't20', 'Rohinstallation Elektro', 'elektro', 'rohinstallation', 8, 'werktage', false, false, 'always', 200),
  ('efh_massiv_unterkellert', 't21', 'Rohinstallation Sanitär und Heizung', 'shk', 'rohinstallation', 8, 'werktage', false, false, 'always', 210),
  ('efh_massiv_unterkellert', 't22', 'Lüftungsanlage', 'shk', 'rohinstallation', 4, 'werktage', false, false, 'always', 220),
  ('efh_massiv_unterkellert', 't23', 'Blower-Door-Vorabtest', 'pruefer', 'rohinstallation', 1, 'werktage', false, false, 'always', 230),
  ('efh_massiv_unterkellert', 't24', 'Innenputz', 'putzer', 'ausbau', 8, 'werktage', false, false, 'always', 240),
  ('efh_massiv_unterkellert', 't25', 'Trockenbau, Dachgeschossausbau', 'trockenbau', 'ausbau', 10, 'werktage', false, false, 'always', 250),
  ('efh_massiv_unterkellert', 't26', 'Estrich', 'estrich', 'ausbau', 3, 'werktage', false, false, 'always', 260),
  ('efh_massiv_unterkellert', 't27', 'Trocknung bis Belegreife', null, 'ausbau', 35, 'kalendertage', false, true, 'always', 270),
  ('efh_massiv_unterkellert', 't28', 'Fliesenarbeiten', 'fliesen', 'endausbau', 8, 'werktage', false, false, 'always', 280),
  ('efh_massiv_unterkellert', 't29', 'Innentüren', 'tischler', 'endausbau', 3, 'werktage', false, false, 'always', 290),
  ('efh_massiv_unterkellert', 't30', 'Malerarbeiten', 'maler', 'endausbau', 8, 'werktage', false, false, 'always', 300),
  ('efh_massiv_unterkellert', 't31', 'Bodenbeläge', 'bodenleger', 'endausbau', 5, 'werktage', false, false, 'always', 310),
  ('efh_massiv_unterkellert', 't32', 'Treppe', 'treppenbau', 'endausbau', 2, 'werktage', false, false, 'always', 320),
  ('efh_massiv_unterkellert', 't33', 'Endmontage Elektro', 'elektro', 'endausbau', 4, 'werktage', false, false, 'always', 330),
  ('efh_massiv_unterkellert', 't34', 'Endmontage Sanitär', 'shk', 'endausbau', 4, 'werktage', false, false, 'always', 340),
  ('efh_massiv_unterkellert', 't35', 'Außenanlagen, Zufahrt, Pflaster', 'galabau', 'aussenanlagen', 10, 'werktage', false, false, 'always', 350),
  ('efh_massiv_unterkellert', 't36', 'Baureinigung', 'reinigung', 'abnahme', 2, 'werktage', false, false, 'always', 360),
  ('efh_massiv_unterkellert', 't37', 'Abnahme und Übergabe', null, 'abnahme', 0, 'werktage', true, false, 'always', 370),
  ('efh_massiv_unterkellert', 't38', 'Schlussrechnung, Restzahlung', null, 'abnahme', 0, 'werktage', true, false, 'always', 380)
on conflict (template_key, code) do nothing;

insert into plan_template_dependency
  (template_key, predecessor_code, successor_code, type, lag_days, lag_unit)
values
  ('efh_massiv_unterkellert', 't02', 't03', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't03', 't04', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't04', 't05', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't05', 't06', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't06', 't07', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't07', 't08', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't08', 't09', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't09', 't10', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't10', 't11', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't09', 't12', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't12', 't13', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't13', 't14', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't14', 't15', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't15', 't16', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't16', 't17', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't16', 't18', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't17', 't19', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't18', 't19', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't19', 't20', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't19', 't21', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't21', 't22', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't20', 't23', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't21', 't23', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't22', 't23', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't23', 't24', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't23', 't25', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't24', 't26', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't25', 't26', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't26', 't27', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't27', 't28', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't24', 't29', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't28', 't30', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't29', 't30', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't30', 't31', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't30', 't32', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't31', 't33', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't28', 't34', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't31', 't34', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't19', 't35', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't33', 't36', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't34', 't36', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't36', 't37', 'FS', 0, 'werktage'),
  ('efh_massiv_unterkellert', 't37', 't38', 'FS', 0, 'werktage')
on conflict do nothing;
