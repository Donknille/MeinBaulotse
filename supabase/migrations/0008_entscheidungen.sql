-- ---------------------------------------------------------------------------
-- MeinBaulotse — Entscheidungsvorlagen (erzeugt, nicht von Hand bearbeiten)
--
-- Erzeugt von packages/db/scripts/generate-decisions.ts aus:
--   packages/schedule/src/templates/entscheidungen.ts
--
-- Neu erzeugen: pnpm --filter @meinbaulotse/db decisions:generate
--
-- Abschnitt 7.3 der Spezifikation. Die Vorlaufzeiten sind das Ergebnis der
-- Frage „wie lange vorher muss das feststehen, damit der Vorgang nicht
-- wartet" — nicht die Frage, wie lange jemand zum Überlegen braucht.
-- ---------------------------------------------------------------------------

insert into decision_template
  (key, title, description, help_text, blocks_task_code, lead_time_days, lead_time_unit, sort_order)
values
  ('versicherungen', 'Bauherrenhaftpflicht und Bauleistungsversicherung', 'Beides muss stehen, bevor die erste Maschine auf das Grundstück fährt. Danach ist es zu spät.',
   'Die Bauherrenhaftpflicht deckt Schäden, die von deiner Baustelle ausgehen — ein Passant stürzt in die offene Baugrube, ein Ziegel trifft ein Auto. Als Bauherr haftest du dafür, auch wenn ein Unternehmen gearbeitet hat. Die Bauleistungsversicherung deckt Schäden am Bau selbst, etwa durch Sturm, Vandalismus oder Diebstahl fest eingebauter Teile. Was du später bereust: einen Schaden in den ersten Wochen, weil die Policen erst zum Richtfest abgeschlossen wurden.',
   't03', 10, 'werktage', 10),
  ('bauhelfer-bg-bau', 'Bauhelfer bei der BG Bau anmelden', 'Wer auf deiner Baustelle unentgeltlich mithilft, ist gesetzlich unfallversichert — und muss gemeldet sein.',
   'Sobald Freunde oder Verwandte mit anpacken, bist du Unternehmer im Sinne der gesetzlichen Unfallversicherung. Die Anmeldung bei der Berufsgenossenschaft der Bauwirtschaft ist Pflicht und kostet wenig; ein nicht gemeldeter Helfer, dem etwas passiert, kostet sehr viel. Gemeldet wird vor dem ersten Einsatz, nicht danach. Auch reine Eigenleistung ohne Helfer wird angezeigt.',
   't03', 5, 'werktage', 20),
  ('dachziegel', 'Dachziegel: Modell und Farbe', 'Die Eindeckung wird bestellt, sobald der Dachstuhl steht.',
   'Form und Material bestimmen, welche Dachneigung zulässig ist und wie viel Gewicht der Dachstuhl trägt — beides ist mit der Statik verknüpft und keine reine Geschmacksfrage. Bei der Farbe entscheidet vor allem der Ort: Manche Bebauungspläne schreiben Farbtöne vor. Was du später bereust: eine Sonderfarbe mit langer Lieferzeit, die den ganzen Ausbau schiebt, weil das Haus bis dahin nicht dicht ist.',
   't17', 20, 'werktage', 30),
  ('fassade', 'Fassade: Putz oder Klinker, Farbton', 'Die Wahl bestimmt, wie lange das Gerüst steht — und was es kostet.',
   'Putz ist günstiger und in jeder Farbe zu haben, muss aber alle paar Jahrzehnte erneuert werden. Klinker kostet deutlich mehr, hält dafür ohne Pflege. Beides beeinflusst die Gerüststandzeit, und Gerüst wird nach Zeit berechnet. Prüf den Bebauungsplan, bevor du dich festlegst: Farbton und Material sind dort häufig vorgegeben. Was du später bereust: einen sehr dunklen Ton auf gedämmter Fassade — er heizt sich auf und arbeitet stärker.',
   't17', 25, 'werktage', 40),
  ('fenster', 'Fenster: Farbe, Verglasung, Rollladen, Griffe', 'Fenster werden für dein Haus gefertigt. Zwischen Bestellung und Einbau liegen Wochen.',
   'Drei Dinge entscheidest du hier gleichzeitig. Erstens die Verglasung: Zweifach oder Dreifach bestimmt den Wärmeschutz und muss zum Wärmeschutznachweis passen. Zweitens den Sonnenschutz: Rollladen, Raffstore oder nichts — nachträglich ist jeder Rollladenkasten ein Eingriff in die Wand. Drittens die Bedienung: abschließbare Griffe im Erdgeschoss, Fenstertüren mit oder ohne Schwelle. Was du später bereust: eine Sonderfarbe außen, die drei Wochen extra Lieferzeit kostet, und fehlende Verschattung nach Süden — die erste Hitzewelle beantwortet die Frage von selbst.',
   't18', 60, 'werktage', 50),
  ('elektroplanung', 'Elektroplanung: Steckdosen, Schalter, Netzwerk', 'Nach dem Schlitzen der Wände ist jede zusätzliche Dose ein Nachtrag mit Staub.',
   'Geh vor dem Termin mit dem Elektriker gedanklich durch jeden Raum und stell die Möbel auf: Wo steht das Bett, wo der Fernseher, wo der Schreibtisch. Eine Steckdose hinter dem Schrank ist verloren, eine fehlende neben dem Bett ärgert zehn Jahre lang. Denk an das, was du noch nicht hast: Leerrohre für Wallbox, Photovoltaik, Außenbeleuchtung und Netzwerk kosten jetzt fast nichts. Was du später bereust: nach Mindestausstattung geplant zu haben — sie ist ein Minimum, kein Vorschlag.',
   't20', 15, 'werktage', 60),
  ('kueche', 'Küchenplanung mit Anschlusspunkten', 'Starkstrom, Wasser und Abluft müssen liegen, bevor die Wände geschlossen werden.',
   'Die Küche wird zwar zuletzt geliefert, aber ihre Anschlüsse entstehen jetzt. Du brauchst dafür keine fertige Küche, sondern einen Plan mit Positionen: Herd, Spüle, Geschirrspüler, Kühlschrank, Dunstabzug. Kläre früh, ob abgesaugt oder umgeluftet wird — eine Außenwanddurchführung ist nachträglich eine Kernbohrung. Was du später bereust: eine Kücheninsel ohne Anschluss darunter, weil sie erst nach dem Estrich beschlossen wurde.',
   't20', 20, 'werktage', 70),
  ('heizsystem', 'Heizsystem und Wärmepumpe final', 'Lieferzeit und Förderantrag brauchen beide Vorlauf, und zwar nacheinander.',
   'Die Wahl des Wärmeerzeugers hängt am Wärmeschutznachweis und an der Heizlast, nicht am Geschmack. Wichtig ist die Reihenfolge: Ein Förderantrag wird vor dem Auftrag gestellt, sonst entfällt die Förderung — nachträglich lässt sich das nicht heilen. Klär außerdem den Aufstellort und die Abstände zum Nachbargrundstück, denn Wärmepumpen erzeugen Geräusche und dafür gelten Grenzwerte. Was du später bereust: die Anlage bestellt zu haben, bevor der Antrag durch war.',
   't21', 40, 'werktage', 80),
  ('sanitaerobjekte', 'Sanitärobjekte und Vorwandpositionen', 'Wo die Objekte hängen, entscheidet sich beim Stellen der Vorwand.',
   'Es geht nicht um Armaturen und Farben, sondern um Maße: Wandhängendes WC oder bodenstehend, Dusche bodengleich oder mit Wanne, Waschtisch als Möbel oder als Becken. Jede Variante hat andere Anschlusshöhen. Steh einmal im Rohbau im Bad und stell dir die Objekte vor — auf dem Plan wirkt jedes Bad größer als es ist. Was du später bereust: eine bodengleiche Dusche, die erst nach dem Estrich gewünscht wurde; die Bodenplatte gibt die Höhe dann nicht mehr her.',
   't21', 20, 'werktage', 90),
  ('bodenbelag', 'Bodenbelag und Aufbauhöhe', 'Die Aufbauhöhe bestimmt den Estrich — und der kommt zuerst.',
   'Fliesen, Parkett und Vinyl bauen unterschiedlich hoch auf. Diese Höhe geht in die Estrichdicke ein, und die wiederum in die Höhe der Türen und der Übergänge zwischen den Räumen. Deshalb wird der Belag ausgewählt, bevor der Estrich eingebracht wird, auch wenn er erst Monate später verlegt wird. Was du später bereust: unterschiedliche Beläge in angrenzenden Räumen ohne geplanten Höhenausgleich — die Stufe im Türrahmen bleibt.',
   't26', 15, 'werktage', 100),
  ('fliesen', 'Fliesen: Auswahl und Verlegemuster', 'Der häufigste Grund für Verzug im Innenausbau. Fliesen sind Lagerware oder eben nicht.',
   'Entscheide früher, als es sich anfühlt: Zwischen Aussuchen und Verlegen liegen Bemusterung, Bestellung und Lieferung, und bei Sonderformaten sind das schnell zwei Monate. Neben der Fliese selbst gehören zwei Dinge dazu: das Verlegemuster, das bestimmt, wo die Schnitte landen, und die Fugenfarbe, die das Bild stärker verändert als die meisten erwarten. Was du später bereust: eine schmale Restreihe in der Sichtachse, weil kein Verlegeplan gemacht wurde.',
   't28', 40, 'werktage', 110),
  ('innentueren', 'Innentüren: Modell, Zargen, Beschläge', 'Lange Lieferzeiten, und die Zargen brauchen das Maß aus dem Rohbau.',
   'Türblatt, Zarge und Beschlag werden zusammen bestellt und zusammen geliefert. Die Zargenbreite hängt an der fertigen Wandstärke, also an Putz und Estrichaufbau — deshalb wird nach dem Rohbau aufgemessen. Denk an die Details, die man erst im Alltag merkt: Türen, die in den Raum oder aus ihm heraus aufgehen, Lichtausschnitte in dunklen Fluren, Schwellen bei bodengleichen Übergängen. Was du später bereust: eine Standardhöhe, die nicht zur Deckenhöhe passt, oder fehlende Lüftungsspalte bei kontrollierter Wohnraumlüftung.',
   't29', 50, 'werktage', 120),
  ('treppe', 'Treppe: Material und Geländer', 'Aufgemessen wird am Rohbau, gefertigt wird danach — beides braucht Zeit.',
   'Die Treppe ist ein Möbelstück und wird für deinen Rohbau gebaut. Material und Bauart bestimmen den Preis stärker als die Größe: Beton mit Belag, Holz eingestemmt oder eine freitragende Konstruktion sind drei verschiedene Welten. Beim Geländer gelten Vorschriften zu Höhe und Abstand, die nicht verhandelbar sind. Was du später bereust: eine offene Treppe ohne Setzstufen im Haus mit kleinen Kindern, und eine Wahl, die den Schallschutz nicht berücksichtigt — eine Holztreppe überträgt jeden Schritt.',
   't32', 50, 'werktage', 130),
  ('aussenanlagen', 'Außenanlagen: Zufahrt, Terrasse, Zaun', 'Das Letzte am Bau, und regelmäßig das, wofür das Geld nicht mehr reicht.',
   'Plan die Außenanlagen früh, auch wenn sie zuletzt gebaut werden: Zufahrt, Stellplätze, Terrasse, Wege und Einfriedung summieren sich zu einem fünfstelligen Betrag, der in vielen Baubeschreibungen gar nicht enthalten ist. Kläre nebenbei zwei Dinge, die Vorlauf brauchen: die Entwässerung des Niederschlagswassers, für die es kommunale Vorgaben gibt, und Leerrohre für Außensteckdosen und Licht, solange der Graben noch offen ist. Was du später bereust: gepflastert zu haben, bevor die letzten schweren Fahrzeuge auf dem Grundstück waren.',
   't35', 25, 'werktage', 140)
on conflict (key) do nothing;
