-- ---------------------------------------------------------------------------
-- MeinBaulotse — Entscheidungsvorlagen (erzeugt, nicht von Hand bearbeiten)
--
-- Erzeugt von packages/db/scripts/generate-decisions.ts aus
-- packages/schedule/src/templates/entscheidungen.ts. Neu erzeugen:
--   pnpm --filter @meinbaulotse/db decisions:generate
--
-- 14 Vorlagen aus Abschnitt 7.3 der Spezifikation.
-- ---------------------------------------------------------------------------

insert into decision_template
  (key, title, blocks_task_code, lead_time_days, lead_time_unit, reason,
   description, help, sort_order)
values
  ('versicherungen', 'Bauherrenhaftpflicht und Bauleistungsversicherung', 't03',
   10, 'werktage', 'Beides muss stehen, bevor die erste Maschine anrückt.',
   'Zwei Versicherungen für die Bauzeit: eine für Schäden, die von deiner Baustelle ausgehen, und eine für Schäden am Bau selbst.',
   '{"whatItIsAbout":"Als Bauherr haftest du für das, was auf deinem Grundstück passiert, auch ohne eigenes Verschulden. Die Bauleistungsversicherung deckt dagegen Schäden am entstehenden Gebäude, etwa durch Sturm, Diebstahl oder Vandalismus.","whatDistinguishes":"Der Umfang und die Ausschlüsse. Prüfe, ob Eigenleistung, Helfer, Erdarbeiten und die Bauzeitverlängerung mitversichert sind. Manche Verträge des Generalunternehmers enthalten die Bauleistungsversicherung bereits.","whatPeopleRegret":"Zu spät abgeschlossen. Ein Sturmschaden am offenen Rohbau kostet fünfstellig, und der Vertrag muss vor dem Ereignis bestanden haben."}'::jsonb, 10),
  ('bauhelfer_bg_bau', 'Bauhelfer bei der BG Bau anmelden', 't03',
   5, 'werktage', 'Gesetzliche Pflicht, sobald jemand unentgeltlich mithilft.',
   'Wer beim Bau mithilft, ist gesetzlich unfallversichert. Die Anmeldung bei der Berufsgenossenschaft ist deine Aufgabe, nicht die der Helfer.',
   '{"whatItIsAbout":"Jede helfende Hand auf deiner Baustelle ist über die BG Bau unfallversichert, auch Freunde und Verwandte. Du musst das Bauvorhaben und die geleisteten Stunden melden.","whatDistinguishes":"Nichts, das ist keine Wahl. Die Frage ist nur, ob du Eigenleistung planst und wie viele Stunden es werden.","whatPeopleRegret":"Gar nicht angemeldet. Passiert etwas, steht ein Bußgeld im Raum, und der Versicherungsschutz für den Verletzten ist die kleinere Sorge."}'::jsonb, 20),
  ('dachziegel', 'Dachziegel: Modell und Farbe', 't17',
   20, 'werktage', 'Lieferzeit; einzelne Modelle und Farben sind saisonal knapp.',
   'Material, Form und Farbe der Dacheindeckung. Die Wahl bindet sich an die Dachneigung und häufig an Vorgaben aus dem Bebauungsplan.',
   '{"whatItIsAbout":"Die Eindeckung ist die sichtbarste Fläche deines Hauses und die, an die vierzig Jahre lang niemand mehr herankommt.","whatDistinguishes":"Material und Oberfläche. Tonziegel, Betonstein und Schiefer unterscheiden sich in Gewicht, Preis und Mindestneigung. Engobierte und glasierte Oberflächen bleiben länger sauber als unbehandelte.","whatPeopleRegret":"Die Farbe nach einem Musterstück in der Hand ausgesucht statt an einer bezogenen Fläche im Freien. Auf dem Dach wirkt sie anders."}'::jsonb, 30),
  ('fassade', 'Fassade: Putz oder Klinker, Farbton', 't17',
   25, 'werktage', 'Bestimmt die Gerüststandzeit und damit den Ablauf am Bau.',
   'Wie die Außenwand aussieht und aus was sie besteht. Die Entscheidung wirkt auf Kosten, Pflegeaufwand und den Bauablauf.',
   '{"whatItIsAbout":"Die äußere Schicht der Außenwand. Sie schützt die Dämmung und bestimmt, wie oft du in zwanzig Jahren ein Gerüst brauchst.","whatDistinguishes":"Putz ist günstiger und in jedem Farbton möglich, muss aber irgendwann gestrichen werden. Klinker kostet deutlich mehr, hält dafür ohne Anstrich und braucht mehr Wandstärke.","whatPeopleRegret":"Einen sehr hellen oder sehr dunklen Farbton gewählt. Hell zeigt jeden Ablauf unter der Fensterbank, dunkel heizt sich auf und bleicht aus."}'::jsonb, 40),
  ('fenster', 'Fenster: Farbe, Verglasung, Rollladen, Griffe', 't18',
   60, 'werktage', 'Fenster werden auf Maß gefertigt; die Lieferzeit ist die längste im Bau.',
   'Rahmenmaterial, Farbe innen und außen, Glasaufbau, Beschläge, Rollläden und Einbruchhemmung. Die längste Vorlaufzeit im ganzen Ablauf.',
   '{"whatItIsAbout":"Fenster sind Maßanfertigungen. Ab der Bestellung vergehen Wochen bis Monate, und in dieser Zeit ändert sich nichts mehr daran.","whatDistinguishes":"Rahmenmaterial und Glasaufbau. Kunststoff, Holz und Aluminium unterscheiden sich in Pflege, Preis und Lebensdauer. Beim Glas entscheidet der Aufbau über Wärmeschutz, Schallschutz und Sonnenschutz. Bei der Einbruchhemmung ist RC2 der übliche Standard für Wohnhäuser.","whatPeopleRegret":"Am Sonnenschutz gespart und an der Einbruchhemmung. Beides lässt sich nachrüsten, kostet dann aber ein Vielfaches der Mehrkosten beim Einbau."}'::jsonb, 50),
  ('elektroplanung', 'Elektroplanung: Steckdosen, Schalter, Netzwerk', 't20',
   15, 'werktage', 'Nach dem Schlitzen ist jede Änderung ein Nachtrag.',
   'Wo Steckdosen, Schalter, Leuchtenauslässe und Netzwerkdosen sitzen, und welche Leerrohre für später eingezogen werden.',
   '{"whatItIsAbout":"Der Plan, nach dem der Elektriker die Wände schlitzt. Was darin nicht steht, sitzt später nicht in der Wand.","whatDistinguishes":"Vor allem die Anzahl. Die übliche Ausstattung ist ein Mindestmaß, kein Vorschlag für dein Leben. Geh mit den geplanten Möbeln durch jeden Raum.","whatPeopleRegret":"Zu wenige Steckdosen neben dem Bett, in der Küche und am Arbeitsplatz. Und fehlende Leerrohre für Photovoltaik, Wallbox und Außensteckdose."}'::jsonb, 60),
  ('kuechenplanung', 'Küchenplanung mit Anschlusspunkten', 't20',
   20, 'werktage', 'Starkstrom, Wasser und Abluft müssen vor der Rohinstallation feststehen.',
   'Der Küchengrundriss mit allen Anschlüssen: Strom, Starkstrom, Wasser, Abwasser, Abluft oder Umluft.',
   '{"whatItIsAbout":"Nicht die Fronten und nicht die Arbeitsplatte, sondern wo Geräte und Spüle stehen. Danach richten sich die Leitungen.","whatDistinguishes":"Vor allem Kochfeld und Dunstabzug. Ein Induktionsfeld braucht Starkstrom, eine Abluftanlage einen Mauerdurchbruch nach außen, eine Umluftanlage nicht.","whatPeopleRegret":"Die Küche erst nach der Rohinstallation geplant. Dann liegt der Wasseranschluss zwei Meter neben der Spüle, und die Steckdose für den Backofen an der falschen Wand."}'::jsonb, 70),
  ('heizsystem', 'Heizsystem und Wärmepumpe final', 't21',
   40, 'werktage', 'Lieferzeit der Geräte und Fristen im Förderantrag.',
   'Welcher Wärmeerzeuger eingebaut wird, wie er ausgelegt ist und ob eine Förderung beantragt wird.',
   '{"whatItIsAbout":"Die Anlage, die dein Haus die nächsten zwanzig Jahre heizt, und die Grundlage für den Förderantrag.","whatDistinguishes":"Die Wärmequelle und die Auslegung. Luft und Erdreich unterscheiden sich in Erschließungskosten und Jahresarbeitszahl. Wichtiger als das Fabrikat ist, dass die Auslegung auf einer Heizlastberechnung beruht und nicht auf einer Faustformel.","whatPeopleRegret":"Eine zu groß ausgelegte Anlage. Sie taktet, verschleißt schneller und verbraucht mehr als eine passend gerechnete."}'::jsonb, 80),
  ('sanitaerobjekte', 'Sanitärobjekte und Vorwandpositionen', 't21',
   20, 'werktage', 'Die Position der Objekte bestimmt die Rohinstallation.',
   'Welche Objekte in Bad und Gäste-WC kommen und wo genau sie hängen. Die Höhen entscheiden über zehn Jahre Nutzung.',
   '{"whatItIsAbout":"Nicht die Armaturen, sondern die Positionen. Wo das WC hängt, wo die Dusche anfängt, auf welcher Höhe das Waschbecken sitzt.","whatDistinguishes":"Bodengleiche Dusche oder Wanne, Wandhängend oder stehend, Unterputz- oder Aufputzarmatur. Unterputz sieht ruhiger aus und ist im Wartungsfall aufwendiger.","whatPeopleRegret":"Standardhöhen übernommen, ohne sich davorzustellen. Ein Waschbecken auf 85 cm ist für 1,60 m und 1,95 m nicht dasselbe."}'::jsonb, 90),
  ('bodenbelag', 'Bodenbelag und Aufbauhöhe', 't26',
   15, 'werktage', 'Die Aufbauhöhe bestimmt die Dicke des Estrichs.',
   'Welcher Belag in welchen Raum kommt. Aus der Aufbauhöhe ergibt sich, wie dick der Estrich eingebracht wird.',
   '{"whatItIsAbout":"Jeder Belag braucht unterschiedlich viel Platz. Der Estrich wird darauf abgestimmt und ist danach nicht mehr zu ändern.","whatDistinguishes":"Aufbauhöhe, Wärmeleitfähigkeit und Pflege. Fliesen leiten die Fußbodenheizung am besten, Parkett fühlt sich wärmer an, Vinyl ist unempfindlich und dünn.","whatPeopleRegret":"Die Entscheidung dem Estrichleger überlassen. Passt die Aufbauhöhe nicht, schleifen später die Türen oder es entsteht eine Schwelle."}'::jsonb, 100),
  ('fliesen', 'Fliesen: Auswahl und Verlegemuster', 't28',
   40, 'werktage', 'Lieferzeit. Der häufigste Grund für Verzug im Innenausbau.',
   'Format, Farbe, Oberfläche und Verlegemuster für Bad, Gäste-WC und gegebenenfalls weitere Räume.',
   '{"whatItIsAbout":"Die Fliesen und die Art, wie sie liegen. Beides muss vor dem Beginn der Fliesenarbeiten geliefert und geprüft sein.","whatDistinguishes":"Format und Oberfläche. Große Formate wirken ruhiger und brauchen einen ebeneren Untergrund. Bei der Rutschhemmung gilt: In der bodengleichen Dusche ist eine matte Oberfläche kein Nachteil.","whatPeopleRegret":"Zu spät ausgesucht. Bei Fliesen sind acht Wochen Lieferzeit nichts Ungewöhnliches, und eine Nachbestellung aus einer anderen Charge weicht im Farbton ab."}'::jsonb, 110),
  ('innentueren', 'Innentüren: Modell, Zargen, Beschläge', 't29',
   50, 'werktage', 'Lange Lieferzeiten, besonders bei abweichenden Maßen.',
   'Türblätter, Zargen, Bänder und Drücker. Bei Sondermaßen und Sonderfarben verlängert sich die Lieferzeit deutlich.',
   '{"whatItIsAbout":"Alle Innentüren zusammen. Sie werden als Satz bestellt und auf die fertige Wandstärke abgestimmt.","whatDistinguishes":"Oberfläche und Aufbau. Röhrenspan ist leicht und günstig, Vollspan schwerer und leiser. Für Bad und Hauswirtschaftsraum lohnt der Blick auf die Feuchtebeständigkeit.","whatPeopleRegret":"Die Türhöhe nicht mitgedacht. Durchgehende Türen bis zur Decke wirken großzügig, sind aber ein Sondermaß mit eigener Lieferzeit."}'::jsonb, 120),
  ('treppe', 'Treppe: Material und Geländer', 't32',
   50, 'werktage', 'Aufmaß erst nach dem Rohbau möglich, danach Fertigung.',
   'Material, Bauart und Geländer der Innentreppe. Das Aufmaß erfolgt am fertigen Rohbau, die Fertigung dauert Wochen.',
   '{"whatItIsAbout":"Die Treppe wird für dein Haus gebaut, nicht gekauft. Zwischen Aufmaß und Einbau liegen mehrere Wochen.","whatDistinguishes":"Bauart und Material. Eine aufgesattelte Holztreppe, eine Betontreppe mit Belag und eine Faltwerktreppe unterscheiden sich in Preis, Schallübertragung und Platzbedarf.","whatPeopleRegret":"Den Schallschutz übersehen. Eine Treppe, die im Schlafzimmer darunter zu hören ist, lässt sich nachträglich kaum entkoppeln."}'::jsonb, 130),
  ('aussenanlagen', 'Außenanlagen: Zufahrt, Terrasse, Zaun', 't35',
   25, 'werktage', 'Materialbestellung und Abstimmung mit der Entwässerung.',
   'Zufahrt, Wege, Terrasse, Einfriedung und wohin das Regenwasser läuft.',
   '{"whatItIsAbout":"Alles außerhalb des Hauses. Häufig der Posten, der im Budget zuletzt drankommt und dann fehlt.","whatDistinguishes":"Versickerungsfähig oder versiegelt. Manche Gemeinden koppeln die Niederschlagswassergebühr an die versiegelte Fläche, und der Bebauungsplan kann Vorgaben machen.","whatPeopleRegret":"Leerrohre für Außenbeleuchtung, Tor und Gartensteckdose nicht mit eingegraben. Danach ist die Zufahrt gepflastert."}'::jsonb, 140)
on conflict (key) do nothing;
