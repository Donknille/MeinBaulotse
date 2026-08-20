-- ---------------------------------------------------------------------------
-- MeinBaulotse — Entscheidungsvorlagen (erzeugt, nicht von Hand bearbeiten)
--
-- Erzeugt von packages/db/scripts/generate-seed.ts aus:
--   - packages/schedule/src/templates/decisions.ts
--
-- Abschnitt 7.3 der Spezifikation. `blocks_task_code` verweist auf die
-- Nummern der Ablaufvorlage aus 7.2.
-- ---------------------------------------------------------------------------

insert into decision_template
  (key, title, description, help_text, blocks_task_code, lead_time_days,
   lead_time_unit, sort_order)
values
  ('versicherung', 'Bauherrenhaftpflicht und Bauleistungsversicherung', 'Beides muss stehen, bevor die erste Maschine anrückt.',
   'Die Bauherrenhaftpflicht deckt Schäden, die Dritten auf oder an deiner Baustelle entstehen. Die Bauleistungsversicherung deckt Schäden am Bau selbst, etwa durch Sturm, Diebstahl von fest eingebautem Material oder Vandalismus. Wer beides erst nach Baubeginn abschließt, hat für die Zeit davor keinen Schutz — und genau in dieser Zeit steht die Baugrube offen.',
   't03', 10, 'werktage', 10),
  ('bg_bau', 'Bauhelfer bei der BG Bau anmelden', 'Pflicht, sobald jemand unentgeltlich mitarbeitet.',
   'Wer Verwandte oder Freunde auf der Baustelle mithelfen lässt, muss sie bei der Berufsgenossenschaft der Bauwirtschaft anmelden. Das gilt auch für Eigenleistung im kleinen Umfang und unabhängig davon, ob Geld fließt. Die Anmeldung ist kostenlos aufwendig, die Nichtanmeldung teuer: Bei einem Unfall haftest du sonst persönlich.',
   't03', 5, 'werktage', 20),
  ('dachziegel', 'Dachziegel: Modell und Farbe', 'Bestimmt Optik, Gewicht und Lieferzeit der Eindeckung.',
   'Der Ziegel entscheidet über mehr als die Farbe: Gewicht und Format gehen in die Statik des Dachstuhls ein, und manche Gemeinden schreiben in der Gestaltungssatzung Farbtöne vor. Prüf das, bevor du dich verliebst. Sonderfarben und glasierte Oberflächen haben deutlich längere Lieferzeiten als das Standardsortiment.',
   't17', 20, 'werktage', 30),
  ('fassade', 'Fassade: Putz oder Klinker, Farbton', 'Hängt am Gerüst — und das Gerüst kostet pro Woche.',
   'Putz ist günstiger und schneller, Klinker langlebiger und wartungsärmer. Die Entscheidung fällt früher, als man denkt: Klinker braucht ein anderes Fundamentmaß und eine andere Fensterlaibung. Was danach kommt, ist eine Änderung am Rohbau, nicht an der Fassade. Der Farbton lässt sich später noch verschieben, das Material nicht.',
   't17', 25, 'werktage', 40),
  ('fenster', 'Fenster: Farbe, Verglasung, Rollladen, Griffe', 'Die Entscheidung mit der längsten Vorlaufzeit im ganzen Bau.',
   'Fenster werden auf Maß gefertigt; zwischen Freigabe und Lieferung liegen in der Regel mehrere Monate. Zu klären sind Rahmenfarbe innen und außen (zwei Farben kosten Aufpreis), Verglasung (zwei- oder dreifach, Schallschutz an der Straßenseite), Rollladen oder Raffstore samt Antrieb und Elektroanschluss, sowie abschließbare Griffe im Erdgeschoss. Der Rollladenantrieb ist der häufigste Nachtrag: Wer ihn zu spät bestellt, hat den Kabelweg schon zugeputzt.',
   't18', 60, 'werktage', 50),
  ('elektroplanung', 'Elektroplanung: Steckdosen, Schalter, Netzwerk', 'Danach ist jede Änderung ein Nachtrag und eine Stemmarbeit.',
   'Geh mit dem Elektriker Raum für Raum durch und markier jede Dose an der Wand. Denk an Netzwerkdosen statt reinem WLAN, an Außensteckdosen, an die Wallbox-Zuleitung in der Garage und an den Anschluss für Rollladen und Markise. Eine Dose zu viel kostet wenige Euro, eine Dose zu wenig kostet nach dem Innenputz einen Schlitz in der frisch verputzten Wand.',
   't20', 15, 'werktage', 60),
  ('kueche', 'Küchenplanung mit Anschlusspunkten', 'Starkstrom, Wasser und Abluft müssen vor dem Innenputz stehen.',
   'Für die Rohinstallation zählt nicht die Küchenfront, sondern wo Herd, Spüle, Geschirrspüler, Kühlschrank und Dunstabzug stehen. Dafür brauchst du keinen unterschriebenen Küchenvertrag, aber einen maßstäblichen Plan. Kläre früh, ob die Dunstabzugshaube nach außen führt — der Mauerdurchbruch gehört in den Rohbau, nicht in die fertige Fassade.',
   't20', 20, 'werktage', 70),
  ('heizsystem', 'Heizsystem und Wärmepumpe final', 'Lieferzeit und Förderantrag laufen parallel und beide brauchen Vorlauf.',
   'Die Wahl des Wärmeerzeugers bestimmt die Rohinstallation: Eine Wärmepumpe braucht Platz für Außen- und Innenteil, Kondensatablauf und einen eigenen Zählerplatz. Förderanträge sind in der Regel **vor** Auftragsvergabe zu stellen; wer zuerst beauftragt und dann beantragt, verliert den Anspruch. Prüf die aktuellen Bedingungen beim Fördergeber, sie ändern sich häufiger als der Rest deines Bauvorhabens.',
   't21', 40, 'werktage', 80),
  ('sanitaer', 'Sanitärobjekte und Vorwandpositionen', 'Die Position bestimmt die Rohinstallation, nicht die Optik.',
   'Der Installateur braucht früh nicht das Waschbecken, sondern seine Höhe und seine Achse. Wandhängendes WC, bodengleiche Dusche und freistehende Wanne haben unterschiedliche Vorwandtiefen und Abläufe. Entscheide das gemeinsam mit dem Fliesenplan: Wer zuerst die Fliese wählt und dann die Ablaufposition, landet bei einer angeschnittenen Reihe vor der Dusche.',
   't21', 20, 'werktage', 90),
  ('bodenbelag', 'Bodenbelag und Aufbauhöhe', 'Die Aufbauhöhe bestimmt den Estrich — und der kommt vorher.',
   'Parkett, Vinyl und Fliese bauen unterschiedlich hoch auf. Die Differenz muss im Estrich ausgeglichen werden, und der wird eingebaut, bevor der Belag geliefert ist. Steht die Entscheidung zu spät, passen später die Türblätter nicht mehr oder es entsteht eine Schwelle zwischen zwei Räumen. Leg dich mindestens auf die Aufbauhöhe fest, auch wenn das Dekor noch offen ist.',
   't26', 15, 'werktage', 100),
  ('fliesen', 'Fliesen: Auswahl und Verlegemuster', 'Der häufigste Verzugsgrund im Innenausbau.',
   'Fliesen sind kein Lagerartikel, sobald das Format aus der Reihe fällt: Großformate, Feinsteinzeug in Sonderfarben und alles aus dem Ausland haben lange Lieferzeiten. Zur Auswahl gehört das Verlegemuster — es entscheidet über die Menge und damit über den Verschnitt. Bestell fünf bis zehn Prozent Reserve aus derselben Charge und heb sie auf; Nachbestellungen weichen im Farbton ab.',
   't28', 40, 'werktage', 110),
  ('innentueren', 'Innentüren: Modell, Zargen, Beschläge', 'Lange Lieferzeiten, und das Maß hängt am Bodenaufbau.',
   'Türblatt, Zarge und Beschlag werden zusammen bestellt und auf die fertige Wandstärke und den fertigen Fußboden gefertigt. Deshalb muss der Bodenaufbau vorher feststehen. Klär auch, welche Türen stumpf einschlagend sein sollen und wo eine Schiebetür sinnvoller ist — eine Schiebetür verlangt eine Tasche in der Wand und gehört damit in den Trockenbau.',
   't29', 50, 'werktage', 120),
  ('treppe', 'Treppe: Material und Geländer', 'Aufmaß erst nach dem Rohbau, danach beginnt die Fertigung.',
   'Die Treppe wird nach Aufmaß gefertigt, und aufgemessen wird erst am fertigen Rohbau. Zwischen Aufmaß und Einbau liegen mehrere Wochen. Entscheide vorher über Material, Stufenstärke und Geländerart — beim Geländer schreibt die Landesbauordnung Mindesthöhen und maximale Öffnungsweiten vor, gerade mit kleinen Kindern lohnt der frühe Blick in die für dich geltende Fassung.',
   't32', 50, 'werktage', 130),
  ('aussenanlagen', 'Außenanlagen: Zufahrt, Terrasse, Zaun', 'Was hier fehlt, bleibt oft jahrelang eine Baustelle.',
   'Die Außenanlagen sind der Posten, an dem am Ende das Geld fehlt. Plan zumindest die Zufahrt und den Hauseingang von Anfang an mit, denn beide brauchen einen tragfähigen Unterbau, der vor der Pflasterung eingebaut wird. Leerrohre für Gartenstrom, Bewässerung und Torantrieb kosten jetzt fast nichts und später einen aufgerissenen Vorgarten.',
   't35', 25, 'werktage', 140)
on conflict (key) do nothing;
