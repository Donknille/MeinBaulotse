-- ---------------------------------------------------------------------------
-- MeinBaulotse — Lotsenkarten (erzeugt, nicht von Hand bearbeiten)
--
-- Erzeugt von packages/db/scripts/generate-guide-cards.ts aus
-- content/lotsenkarten/*.md. Neu erzeugen:
--   pnpm --filter @meinbaulotse/db cards:generate
--
-- 12 Karten aus Abschnitt 7.4 der Spezifikation. Sie decken die Phasen ab,
-- in denen am meisten schiefgeht.
--
-- Die Karten werden mit gesetztem published_at eingespielt und sind damit ab
-- diesem Moment unveränderlich. Eine Korrektur ist eine neue Fassung.
-- ---------------------------------------------------------------------------

-- Bodenplatte und Fundamenterder (01-bodenplatte.md)
insert into guide_card (
  key, version, phase_key, trade_code, build_types, task_codes, title, whats_happening,
  watch_for, questions_for_contractor, common_problems, photo_prompts,
  expert_recommended, expert_reason, legal_note, sources, published_at
) values (
  'bodenplatte', 1, 'gruendung', 'rohbau',
  '{}'::mbl.build_type[], array['t05', 't06']::text[],
  'Bodenplatte und Fundamenterder',
  'Auf dem verdichteten Baugrund entsteht zuerst eine dünne Sauberkeitsschicht, darauf kommen Dämmung, Bewehrung und die Bodenplatte aus Beton. In dieselbe Platte werden zwei Dinge eingebaut, die später niemand mehr erreicht: der Fundamenterder — ein Metallband, das dein Haus elektrisch mit dem Erdreich verbindet — und die Leerrohre, durch die Wasser, Strom und Internet ins Haus kommen.

Das ist der Tag, an dem am wenigsten sichtbar ist und am meisten festgelegt wird.',
  '[{"key":"w1","text":"Der Fundamenterder liegt vor dem Betonieren sichtbar in der Bewehrung, mit Anschlussfahnen, die aus dem Beton herausschauen","why":"nachträglich lässt sich ein Erder nur noch als Ringerder im Erdreich ergänzen, und das kostet ein Vielfaches"},{"key":"w2","text":"Die Anschlussfahnen sind aus nichtrostendem Stahl, nicht aus verzinktem Bandstahl","why":"verzinkter Stahl korrodiert genau an der Stelle, an der er den Beton verlässt"},{"key":"w3","text":"Alle Leerrohre für Hausanschlüsse liegen, bevor Beton kommt: Wasser, Strom, Telekommunikation, bei Bedarf Fernwärme oder Erdwärme","why":"eine Kernbohrung durch die fertige Bodenplatte ist möglich, aber sie durchtrennt die Abdichtung"},{"key":"w4","text":"Die Bewehrung liegt auf Abstandhaltern und nicht auf der Dämmung auf","why":"nur so bekommt der Stahl ringsum genug Beton und rostet nicht"},{"key":"w5","text":"Nach dem Betonieren wird die Platte feucht gehalten oder abgedeckt","why":"Beton, der zu schnell austrocknet, bekommt Risse und erreicht seine Festigkeit nicht"}]'::jsonb,
  '[{"key":"q1","question":"Welche Betonfestigkeits- und Expositionsklasse ist für die Bodenplatte vorgesehen, und woher stammt die Vorgabe?","whyItMatters":"die Klassen kommen aus der Statik und dem Bodengutachten, nicht aus Gewohnheit"},{"key":"q2","question":"Wie viele Anschlussfahnen des Fundamenterders gibt es, und wo genau kommen sie heraus?","whyItMatters":"du brauchst mindestens eine am Hausanschlussraum, weitere bei Blitzschutz oder Photovoltaik"},{"key":"q3","question":"Bekomme ich das Aufmaß der Leerrohre und ein Foto der Lage, bevor betoniert wird?","whyItMatters":"das ist die einzige Dokumentation, die es je geben wird"},{"key":"q4","question":"Wie wird die Bodenplatte nachbehandelt, und über wie viele Tage?","whyItMatters":"die Nachbehandlung ist eine geschuldete Leistung, keine Freundlichkeit"},{"key":"q5","question":"Ab welcher Außentemperatur wird nicht betoniert, und was passiert dann mit dem Termin?","whyItMatters":"dann weißt du vorher, dass Frost den Plan verschiebt, und nicht erst hinterher"}]'::jsonb,
  '[{"key":"c1","problem":"Der Fundamenterder fehlt ganz oder hat zu wenige Anschlussfahnen","howToSpot":"vor dem Betonieren schaut kein Metallband aus der Bewehrung heraus"},{"key":"c2","problem":"Verzinkter Bandstahl wurde durch den Beton ins Erdreich geführt","howToSpot":"silbrig glänzendes Band statt mattem Edelstahl an der Austrittsstelle"},{"key":"c3","problem":"Ein Leerrohr wurde vergessen","howToSpot":"fällt meistens erst auf, wenn der Anschluss gelegt werden soll"},{"key":"c4","problem":"Die Platte wurde bei Frost oder starker Hitze ohne Schutzmaßnahmen betoniert","howToSpot":"netzartige Risse an der Oberfläche in den ersten Tagen"},{"key":"c5","problem":"Die Höhenlage stimmt nicht mit der Planung überein","howToSpot":"die Oberkante der Platte passt nicht zum eingemessenen Höhenbezug des Vermessers"}]'::jsonb,
  '[{"key":"p1","what":"Die gesamte Bewehrungslage mit dem eingebauten Fundamenterder, aus mehreren Blickwinkeln","why":"danach ist der Aufbau im Beton und für immer unsichtbar","beforeTaskCode":"t06"},{"key":"p2","what":"Jede Anschlussfahne einzeln, mit einem Zollstock oder Meterstab als Maßstab daneben","why":"die Position brauchst du beim Elektroanschluss und beim Potentialausgleich","beforeTaskCode":"t06"},{"key":"p3","what":"Alle Leerrohre mit Abstand zu zwei festen Bezugspunkten, etwa den Achsen des Schnurgerüsts","why":"ohne Maßbezug ist ein Foto später nicht auswertbar","beforeTaskCode":"t06"}]'::jsonb,
  true, 'Alles, was hier eingebaut wird, verschwindet im Beton. Später ist es nicht mehr prüfbar und nur mit erheblichem Aufwand zu korrigieren.', false,
  '[{"title":"DIN 18014, Fundamenterder","note":"Ausführung, Werkstoffe und Anschlussfahnen"},{"title":"DIN EN 206 und DIN 1045-2, Beton","note":"Festigkeits- und Expositionsklassen"},{"title":"DIN 1045-3, Ausführung von Tragwerken aus Beton","note":"Betondeckung und Nachbehandlung"},{"title":"Verband Privater Bauherren, Ratgeber zur Baubegleitung","note":"Prüftermine, die Sachverständige üblicherweise setzen"}]'::jsonb,
  now()
)
on conflict (key, version) do nothing;

-- Kellerabdichtung, Dämmung und Drainage (02-kellerabdichtung.md)
insert into guide_card (
  key, version, phase_key, trade_code, build_types, task_codes, title, whats_happening,
  watch_for, questions_for_contractor, common_problems, photo_prompts,
  expert_recommended, expert_reason, legal_note, sources, published_at
) values (
  'kellerabdichtung', 1, 'gruendung', 'rohbau',
  '{}'::mbl.build_type[], array['t10', 't11']::text[],
  'Kellerabdichtung, Dämmung und Drainage',
  'Die Kelleraußenwände bekommen von außen eine Abdichtung gegen Wasser, darauf eine Dämmung, die im Erdreich liegen darf, und häufig eine Noppenbahn als Schutz. Wenn der Baugrund es verlangt, kommt zusätzlich eine Drainage: ein Rohr, das Wasser vom Haus wegführt. Danach wird der Arbeitsraum zwischen Wand und Erdreich wieder verfüllt.

Welche Abdichtung nötig ist, entscheidet nicht der Geschmack, sondern das Wasser im Boden. Diese Auskunft steht in deinem Baugrundgutachten.',
  '[{"key":"w1","text":"Im Baugrundgutachten steht eine Wassereinwirkungsklasse, und die Ausführung passt dazu","why":"eine Abdichtung gegen Bodenfeuchte hält drückendem Wasser nicht stand, und der Unterschied ist von außen nicht zu sehen"},{"key":"w2","text":"Am Übergang von der Bodenplatte zur Wand ist eine Hohlkehle ausgebildet","why":"die innere Ecke ist die Stelle, an der eine Abdichtung zuerst reißt"},{"key":"w3","text":"Jede Durchdringung durch die Wand hat einen eigenen dichten Anschluss","why":"Rohre für Wasser und Strom sind die häufigsten Leckstellen"},{"key":"w4","text":"Die Abdichtung ist durchgetrocknet, bevor Dämmung und Noppenbahn davorkommen","why":"eingeschlossene Feuchtigkeit bleibt für immer eingeschlossen"},{"key":"w5","text":"Die Noppenbahn endet oben mit einer Abschlussschiene und nicht offen","why":"offen wird sie zur Rinne, die Wasser genau dorthin leitet, wo es nicht hin soll"},{"key":"w6","text":"Verfüllt wird lagenweise mit geeignetem Material, nicht mit dem Aushub samt Steinen und Bauschutt","why":"scharfkantiges Material beschädigt die Abdichtung beim Verdichten"}]'::jsonb,
  '[{"key":"q1","question":"Welche Wassereinwirkungsklasse nach DIN 18533 liegt der Ausführung zugrunde, und auf welche Seite des Gutachtens stützt sie sich?","whyItMatters":"die Antwort verweist auf ein Dokument und nicht auf eine Meinung"},{"key":"q2","question":"Welches Abdichtungssystem wird eingesetzt, und in welcher Schichtdicke?","whyItMatters":"bei Bitumendickbeschichtungen ist die Trockenschichtdicke die entscheidende Größe"},{"key":"q3","question":"Wird eine Drainage eingebaut, und wohin wird das Wasser abgeführt?","whyItMatters":"eine Drainage ohne freien Ablauf staut das Wasser am Haus, statt es wegzuführen"},{"key":"q4","question":"Wann genau ist die Abdichtung fertig und noch offen sichtbar?","whyItMatters":"das ist das Zeitfenster für eine Fachprüfung und für deine Fotos"},{"key":"q5","question":"Womit wird der Arbeitsraum verfüllt, und in welchen Lagen wird verdichtet?","whyItMatters":"das Verfüllen ist der Moment, in dem eine fertige Abdichtung wieder kaputtgehen kann"}]'::jsonb,
  '[{"key":"c1","problem":"Die Abdichtung passt nicht zur tatsächlichen Wasserbelastung","howToSpot":"das Gutachten nennt zeitweise aufstauendes Sickerwasser, ausgeführt ist eine einfache Bitumenbeschichtung"},{"key":"c2","problem":"Die Hohlkehle fehlt oder ist zu klein","howToSpot":"der Übergang von Platte zu Wand ist ein scharfer rechter Winkel"},{"key":"c3","problem":"Die Beschichtung ist zu dünn aufgetragen","howToSpot":"der Untergrund schimmert stellenweise durch, die Fläche wirkt fleckig"},{"key":"c4","problem":"Die Noppenbahn wird für die Abdichtung gehalten","howToSpot":"hinter der Bahn liegt blankes Mauerwerk statt einer geschlossenen Beschichtung"},{"key":"c5","problem":"Die Drainage liegt zu hoch oder ohne Gefälle","howToSpot":"das Rohr liegt oberhalb der Unterkante der Bodenplatte oder ohne Spülschächte an den Ecken"},{"key":"c6","problem":"Verfüllt wurde mit dem groben Aushub","howToSpot":"Steine und Bauschutt liegen direkt an der Wand"}]'::jsonb,
  '[{"key":"p1","what":"Die fertige, noch offene Abdichtung über die ganze Wandhöhe, Wand für Wand","why":"nach dem Verfüllen ist keine einzige Stelle mehr erreichbar","beforeTaskCode":"t11"},{"key":"p2","what":"Die Hohlkehle und jeden Rohrdurchgang aus der Nähe","why":"das sind die Stellen, an denen später gesucht wird","beforeTaskCode":"t11"},{"key":"p3","what":"Das verlegte Drainagerohr mit Kiesbett und den Spülschächten","why":"nur so ist später nachvollziehbar, wo gespült werden kann","beforeTaskCode":"t11"}]'::jsonb,
  true, 'Ein feuchter Keller ist der teuerste Baumangel überhaupt, weil er sich nur von außen beheben lässt: Das Erdreich muss wieder weg.', false,
  '[{"title":"DIN 18533, Abdichtung von erdberührten Bauteilen","note":"Wassereinwirkungsklassen und zulässige Abdichtungsarten"},{"title":"DIN 4095, Dränung zum Schutz baulicher Anlagen","note":"wann eine Drainage sinnvoll ist und wie sie auszuführen ist"},{"title":"DIN 4108-10, Wärmedämmstoffe, Anwendungstypen","note":"welche Dämmung im Erdreich verwendet werden darf"},{"title":"Bauherren-Schutzbund, Hinweise zur Bauüberwachung","note":"empfohlene Kontrollzeitpunkte am Keller"}]'::jsonb,
  now()
)
on conflict (key, version) do nothing;

-- Mauerwerk und Geschossdecken (03-mauerwerk.md)
insert into guide_card (
  key, version, phase_key, trade_code, build_types, task_codes, title, whats_happening,
  watch_for, questions_for_contractor, common_problems, photo_prompts,
  expert_recommended, expert_reason, legal_note, sources, published_at
) values (
  'mauerwerk', 1, 'rohbau', 'rohbau',
  '{}'::mbl.build_type[], array['t12', 't13', 't14']::text[],
  'Mauerwerk und Geschossdecken',
  'Die Außen- und Innenwände werden gemauert, dazwischen entstehen die Geschossdecken. Aus einer Bodenplatte wird in wenigen Wochen ein Haus mit Räumen, und zum ersten Mal lässt sich begehen, was bisher nur ein Grundriss war.

Genau deshalb ist es der richtige Moment, um Maße zu prüfen: Was jetzt an falscher Stelle steht, steht dort für die nächsten achtzig Jahre.',
  '[{"key":"w1","text":"Geh mit dem Grundriss durch die Räume und prüfe die Öffnungen für Fenster und Türen","why":"eine falsch gesetzte Öffnung ist im Rohbau eine Tagesarbeit und nach dem Innenputz eine Baustelle"},{"key":"w2","text":"Die Steine sind trocken gelagert und abgedeckt","why":"nasse Steine bringen Feuchtigkeit ins Haus, die später über Monate wieder heraus muss"},{"key":"w3","text":"Angefangene Wände werden über Nacht und übers Wochenende abgedeckt","why":"Regen läuft in die Hohlkammern der Steine und steht dort"},{"key":"w4","text":"Die Stoßfugen sind so ausgeführt, wie der Steinhersteller es vorschreibt","why":"bei manchen Steinen sind offene Stoßfugen zulässig, bei anderen sind sie eine Undichtigkeit im Schall- und Wärmeschutz"},{"key":"w5","text":"Schlitze und Aussparungen sind eingeplant und nicht nachträglich gestemmt","why":"nachträgliche Schlitze können die Tragfähigkeit einer Wand verringern"},{"key":"w6","text":"Über jeder Öffnung sitzt ein Sturz mit ausreichender Auflagerlänge","why":"die Auflagerlänge steht in der Statik und wird auf der Baustelle gern gekürzt"}]'::jsonb,
  '[{"key":"q1","question":"Wann kann ich mit dem Grundriss durch den Rohbau gehen, bevor die Decke darüber kommt?","whyItMatters":"danach sind Änderungen an Öffnungen deutlich teurer"},{"key":"q2","question":"Wie werden die Wandkronen bei Regen und über das Wochenende geschützt?","whyItMatters":"die Antwort sagt dir, wie viel Baufeuchte du später wieder heraustrocknen musst"},{"key":"q3","question":"Welche Maßtoleranzen gelten für Wände und Decken, und nach welcher Norm?","whyItMatters":"dann redet ihr später über dieselbe Zahl und nicht über Empfinden"},{"key":"q4","question":"Sind alle Aussparungen für Lüftung, Abgas und Hausanschlüsse eingeplant?","whyItMatters":"jede vergessene Aussparung wird zum Kernbohrer im fertigen Mauerwerk"},{"key":"q5","question":"Wie hoch ist die Oberkante der Rohdecke bezogen auf die spätere Oberkante des fertigen Fußbodens?","whyItMatters":"aus dieser Differenz ergibt sich, wie viel Platz der Fußbodenaufbau tatsächlich hat"}]'::jsonb,
  '[{"key":"c1","problem":"Eine Öffnung sitzt an der falschen Stelle oder hat das falsche Maß","howToSpot":"Nachmessen mit dem Grundriss, bevor die nächste Decke liegt"},{"key":"c2","problem":"Der Rohbau steht über Wochen offen im Regen","howToSpot":"stehendes Wasser auf den Decken, dunkle Ränder an den Wänden"},{"key":"c3","problem":"Wände sind nicht lotrecht oder Räume nicht rechtwinklig","howToSpot":"an den Ecken mit einem langen Richtscheit oder über die Diagonalen des Raums"},{"key":"c4","problem":"Der Ringanker wurde unterbrochen","howToSpot":"an den Stoßstellen zwischen zwei Wandabschnitten unter der Decke"},{"key":"c5","problem":"Nachträglich gestemmte waagerechte Schlitze in tragenden Wänden","howToSpot":"frische Fräsungen quer durch die Wand, oft für Leitungen"}]'::jsonb,
  '[{"key":"p1","what":"Jede Wand mit ihren Öffnungen, bevor die nächste Geschossdecke liegt","why":"der Rohbau ist die einzige Fassung des Hauses, die man vollständig sehen kann","beforeTaskCode":"t14"},{"key":"p2","what":"Alle Aussparungen und Durchbrüche mit Maßbezug zu einer Raumecke","why":"später liegen Leitungen darin und niemand weiß mehr, wie groß der Durchbruch war","beforeTaskCode":"t14"},{"key":"p3","what":"Auflager und Stürze über den größeren Öffnungen","why":"die Auflagerlänge ist nach dem Innenputz nicht mehr nachweisbar","beforeTaskCode":"t24"}]'::jsonb,
  false, null, false,
  '[{"title":"DIN EN 1996 mit Nationalem Anhang, Eurocode 6, Mauerwerksbau","note":"Ausführung, Schlitze und Aussparungen"},{"title":"DIN 18202, Toleranzen im Hochbau","note":"zulässige Abweichungen für Ebenheit, Flucht und Winkligkeit"},{"title":"Verarbeitungsrichtlinie des Steinherstellers","note":"Mörtelart, Stoßfugenausbildung und Witterungsschutz"},{"title":"DIN 4108-7, Luftdichtheit von Gebäuden","note":"warum Fugen im Mauerwerk mehr sind als eine Frage der Optik"}]'::jsonb,
  now()
)
on conflict (key, version) do nothing;

-- Dachstuhl und Eindeckung (04-dach.md)
insert into guide_card (
  key, version, phase_key, trade_code, build_types, task_codes, title, whats_happening,
  watch_for, questions_for_contractor, common_problems, photo_prompts,
  expert_recommended, expert_reason, legal_note, sources, published_at
) values (
  'dach', 1, 'dach_huelle', 'dachdecker',
  '{}'::mbl.build_type[], array['t16', 't17']::text[],
  'Dachstuhl und Eindeckung',
  'Der Zimmerer stellt den Dachstuhl, danach kommt die Eindeckung: erst eine Unterdeckbahn, darauf Konterlattung und Traglattung, dann die Ziegel oder Steine. Der Klempner setzt Rinnen, Fallrohre und die Anschlussbleche an Schornstein, Kehlen und Gauben.

Das Dach ist die einzige Bauteilgruppe, bei der zwei Schichten Wasser abhalten: die Eindeckung, die man sieht, und die Unterdeckung darunter, die man nie wieder sieht.',
  '[{"key":"w1","text":"Das verbaute Holz ist trocken und trägt eine Kennzeichnung","why":"zu feucht eingebautes Holz schwindet, dann arbeiten die Verbindungen und es knackt jahrelang"},{"key":"w2","text":"Auf der Unterdeckbahn liegt eine Konterlattung, bevor die Traglattung kommt","why":"erst der Zwischenraum lüftet die Dachfläche, ohne ihn bleibt Feuchtigkeit im Aufbau stehen"},{"key":"w3","text":"Die Bahnen überlappen nach unten und sind an den Stößen verklebt oder verklemmt","why":"die Unterdeckung ist deine zweite Wasserebene, wenn ein Ziegel bei Sturm verrutscht"},{"key":"w4","text":"Die Kehlen, Anschlüsse und Durchdringungen sind sauber eingebunden","why":"an diesen Stellen läuft im Ernstfall das meiste Wasser zusammen"},{"key":"w5","text":"Die Dachneigung passt zu dem, was der Ziegelhersteller als Mindestneigung angibt","why":"darunter braucht es zusätzliche Maßnahmen, und die müssen vereinbart sein"}]'::jsonb,
  '[{"key":"q1","question":"Welche Regeldachneigung gilt für die vorgesehene Deckung, und wird sie eingehalten?","whyItMatters":"wird sie unterschritten, sind Zusatzmaßnahmen geschuldet und keine Kulanz"},{"key":"q2","question":"Welche Klasse hat die Unterdeckung, und ist sie regensicher ausgeführt?","whyItMatters":"bei geringer Neigung oder ausgebautem Dachgeschoss ist das die entscheidende Angabe"},{"key":"q3","question":"Wann ist das Dach so weit, dass das Haus als dicht gilt?","whyItMatters":"dieser Termin ist der Auslöser für die nächste Abschlagszahlung und für die Innenarbeiten"},{"key":"q4","question":"Wie werden Gerüst und Dachfläche gegen Sturm gesichert, solange noch nicht eingedeckt ist?","whyItMatters":"eine offene Dachfläche ist bei Wind die verletzlichste Phase des ganzen Baus"},{"key":"q5","question":"Wer stellt die Rinnen und Fallrohre her, und wo werden sie angeschlossen?","whyItMatters":"die Ableitung des Regenwassers gehört zur Erschließung und wird oft übersehen"}]'::jsonb,
  '[{"key":"c1","problem":"Die Konterlattung fehlt","howToSpot":"die Traglattung liegt direkt auf der Unterdeckbahn"},{"key":"c2","problem":"Die Unterdeckbahn ist beim Verlegen beschädigt worden","howToSpot":"Risse und Löcher, meist an den Tritten der Lattung, sichtbar nur vor dem Eindecken"},{"key":"c3","problem":"Die Anschlüsse an Schornstein oder Gaube sind nur verputzt statt eingeblecht","howToSpot":"kein sichtbares Blech, das unter die Deckung geführt wird"},{"key":"c4","problem":"Zu feuchtes Holz","howToSpot":"frische Schnittflächen wirken dunkel und fühlen sich kühl an, später Risse im Balken"},{"key":"c5","problem":"Dachfenster ohne Anschlussmanschette","howToSpot":"der Übergang zwischen Fensterrahmen und Unterdeckbahn ist offen"}]'::jsonb,
  '[{"key":"p1","what":"Die vollständige Unterdeckbahn mit Konterlattung, bevor eingedeckt wird","why":"danach liegt die zweite Wasserebene für Jahrzehnte unter den Ziegeln","beforeTaskCode":"t17"},{"key":"p2","what":"Alle Kehlen, Anschlüsse und Durchdringungen einzeln","why":"an diesen Stellen wird bei einer undichten Stelle zuerst gesucht","beforeTaskCode":"t17"},{"key":"p3","what":"Den Dachstuhl im Ganzen, mit Blick auf Verbindungen und Auflager","why":"nach dem Ausbau des Dachgeschosses ist die Konstruktion verkleidet","beforeTaskCode":"t25"}]'::jsonb,
  false, null, false,
  '[{"title":"Fachregeln des Deutschen Dachdeckerhandwerks, ZVDH","note":"Regeldachneigung, Unterdeckungsklassen und Anschlüsse"},{"title":"DIN 68800, Holzschutz","note":"Anforderungen an Holzfeuchte und konstruktiven Holzschutz"},{"title":"Statik und Prüfstatik des Bauvorhabens","note":"Querschnitte, Verbindungsmittel und Auflager"},{"title":"Klempnerfachregeln, ZVSHK und ZVDH","note":"Rinnen, Fallrohre und Anschlussbleche"}]'::jsonb,
  now()
)
on conflict (key, version) do nothing;

-- Fenstereinbau und Anschlussdichtung (05-fenster.md)
insert into guide_card (
  key, version, phase_key, trade_code, build_types, task_codes, title, whats_happening,
  watch_for, questions_for_contractor, common_problems, photo_prompts,
  expert_recommended, expert_reason, legal_note, sources, published_at
) values (
  'fenster', 1, 'dach_huelle', 'fensterbau',
  '{}'::mbl.build_type[], array['t18']::text[],
  'Fenstereinbau und Anschlussdichtung',
  'Die Fenster und die Haustür werden gesetzt, ausgerichtet, befestigt und ringsum an das Mauerwerk angeschlossen. Der Anschluss ist die eigentliche Leistung: Ein gutes Fenster in einer schlechten Fuge ist ein schlechtes Fenster.

Die Regel dahinter heißt „innen dichter als außen". Innen muss die Fuge luftdicht sein, damit keine feuchte Raumluft hineinzieht. Außen muss sie Schlagregen abhalten, aber Feuchtigkeit wieder heraustrocknen lassen.',
  '[{"key":"w1","text":"Der Anschluss besteht aus mehr als Bauschaum","why":"Schaum dämmt, aber er dichtet nicht, und ohne dichte Ebenen wandert Feuchtigkeit in die Fuge"},{"key":"w2","text":"Innen ist eine durchgehende dichte Ebene erkennbar, meist ein Folienband oder ein Dichtstoff","why":"das ist die Ebene, die im Blower-Door-Test gemessen wird"},{"key":"w3","text":"Das Fenster steht auf Tragklötzen und ist nicht nur eingeschäumt","why":"das Gewicht muss ins Mauerwerk geleitet werden, sonst verzieht sich der Rahmen"},{"key":"w4","text":"Die Fensterbank ist seitlich in die Laibung eingebunden und hat Gefälle nach außen","why":"die seitlichen Anschlüsse der Fensterbank sind eine der häufigsten Undichtigkeiten"},{"key":"w5","text":"Die Beschläge lassen sich leicht bedienen, die Flügel schließen ringsum gleichmäßig","why":"ungleichmäßiger Anpressdruck ist der erste Hinweis auf einen verzogenen Einbau"}]'::jsonb,
  '[{"key":"q1","question":"Nach welchem Verfahren werden die Fenster angeschlossen, und welche Ebenen sind vorgesehen?","whyItMatters":"die Antwort sollte drei Ebenen benennen und nicht ein Produkt"},{"key":"q2","question":"Welchen Uw-Wert haben die eingebauten Fenster, und stimmt er mit dem Energienachweis überein?","whyItMatters":"der Nachweis rechnet mit einem Wert, den das eingebaute Fenster erreichen muss"},{"key":"q3","question":"Welche Widerstandsklasse gegen Einbruch haben Fenster und Haustür?","whyItMatters":"die Nachrüstung kostet ein Vielfaches der Mehrkosten beim Einbau"},{"key":"q4","question":"Ist bei den bodentiefen Fenstern eine Absturzsicherung vorgesehen, und wie wird sie ausgeführt?","whyItMatters":"das ist keine Ausstattungsfrage, sondern eine Anforderung an das Glas oder ein Geländer"},{"key":"q5","question":"Wann werden die Fenster gesetzt, und wie lange bleiben die Anschlüsse offen sichtbar?","whyItMatters":"nur in diesem Zeitfenster lässt sich der Anschluss überhaupt prüfen"}]'::jsonb,
  '[{"key":"c1","problem":"Der Anschluss besteht ausschließlich aus Montageschaum","howToSpot":"rundum quillt gelber Schaum aus der Fuge, kein Band, kein Dichtstoff"},{"key":"c2","problem":"Die innere Dichtebene ist unterbrochen","howToSpot":"das Folienband endet an den Ecken oder ist an der Fensterbank nicht angeschlossen"},{"key":"c3","problem":"Es fehlen Trag- und Distanzklötze","howToSpot":"unter dem Rahmen ist nur Schaum zu sehen"},{"key":"c4","problem":"Der seitliche Anschluss der Fensterbank fehlt","howToSpot":"die Fensterbank läuft ohne Bördel oder Endstück in die Laibung"},{"key":"c5","problem":"Die Fenster werden zu früh gesetzt und auf der Baustelle beschädigt","howToSpot":"Kratzer im Glas oder im Rahmen, die niemandem mehr zuzuordnen sind"}]'::jsonb,
  '[{"key":"p1","what":"Die Anschlussfuge ringsum an jedem Fenster, bevor Innenputz oder Laibungsverkleidung kommt","why":"nach dem Putz ist die Fuge verdeckt und nur noch mit Aufwand zu beurteilen","beforeTaskCode":"t24"},{"key":"p2","what":"Die innere Dichtebene an mindestens einer Ecke jedes Fensters aus der Nähe","why":"die Ecken sind die Stellen, an denen die Ebene unterbrochen wird","beforeTaskCode":"t24"},{"key":"p3","what":"Fenster und Rahmen im Anlieferungszustand, bevor der Bau weiterläuft","why":"eine Beschädigung lässt sich später nur zuordnen, wenn der Ausgangszustand belegt ist","beforeTaskCode":"t24"}]'::jsonb,
  false, null, false,
  '[{"title":"Leitfaden zur Montage, ift Rosenheim und RAL Gütegemeinschaft Fenster und Haustüren","note":"die drei Anschlussebenen und ihre Ausführung"},{"title":"DIN 4108-7, Luftdichtheit von Gebäuden","note":"Anforderungen an die innere Dichtebene"},{"title":"DIN EN 1627, Einbruchhemmung","note":"die Widerstandsklassen RC1 bis RC6"},{"title":"DIN 18008, Glas im Bauwesen","note":"absturzsichernde Verglasung"},{"title":"Gebäudeenergiegesetz","note":"Anforderungen an den Wärmeschutz der Fenster"}]'::jsonb,
  now()
)
on conflict (key, version) do nothing;

-- Rohinstallation Elektro (06-rohinstallation-elektro.md)
insert into guide_card (
  key, version, phase_key, trade_code, build_types, task_codes, title, whats_happening,
  watch_for, questions_for_contractor, common_problems, photo_prompts,
  expert_recommended, expert_reason, legal_note, sources, published_at
) values (
  'rohinstallation_elektro', 1, 'rohinstallation', 'elektro',
  '{}'::mbl.build_type[], array['t20']::text[],
  'Rohinstallation Elektro',
  'Der Elektriker schlitzt die Wände, setzt die Dosen und zieht die Leitungen bis zum Zählerschrank. Nichts davon funktioniert schon, und nichts davon ist später noch zu sehen.

Das ist der Moment, an dem sich entscheidet, wo in zehn Jahren eine Steckdose sein wird und wo nicht. Nach dem Innenputz ist jede Änderung ein Nachtrag mit Staub.',
  '[{"key":"w1","text":"Geh mit einem Zettel durch jeden Raum und stell dir die Möbel vor, bevor die Dosen gesetzt werden","why":"die übliche Ausstattung ist ein Mindestmaß, kein Vorschlag für dein Leben"},{"key":"w2","text":"Die Leitungen verlaufen in den vorgesehenen Installationszonen","why":"nur dann weißt du später, wo du bohren darfst, ohne eine Leitung zu treffen"},{"key":"w3","text":"Für alles, was du vielleicht später willst, liegt ein Leerrohr: Netzwerk, Photovoltaik, Wallbox, Außensteckdose, Markise","why":"ein Leerrohr kostet jetzt wenige Euro und später eine aufgestemmte Wand"},{"key":"w4","text":"Der Zählerschrank hat freie Plätze","why":"jede Nachrüstung braucht Platz, und ein voller Schrank wird zum zweiten Schrank"},{"key":"w5","text":"Rauchwarnmelder sind eingeplant, in den Räumen, die deine Landesbauordnung verlangt","why":"das ist eine gesetzliche Pflicht und keine Ausstattung"}]'::jsonb,
  '[{"key":"q1","question":"Bekomme ich vor dem Schlitzen einen Plan mit allen Schaltern, Dosen und Auslässen je Raum?","whyItMatters":"auf Papier ist eine Änderung kostenlos, in der Wand nicht"},{"key":"q2","question":"Werden die Installationszonen nach DIN 18015-3 eingehalten?","whyItMatters":"die Antwort entscheidet darüber, ob du später gefahrlos ein Regal aufhängen kannst"},{"key":"q3","question":"Welche Stromkreise sind über einen Fehlerstromschutzschalter abgesichert?","whyItMatters":"für Steckdosenstromkreise in Wohnungen ist das eine Anforderung, keine Zusatzausstattung"},{"key":"q4","question":"Welche Leerrohre sind vorgesehen, und wohin führen sie?","whyItMatters":"ein Leerrohr ohne Zugdraht und ohne bekanntes Ziel ist nur ein Loch"},{"key":"q5","question":"Wann sind die Leitungen fertig und der Innenputz noch nicht begonnen?","whyItMatters":"genau dieses Zeitfenster brauchst du für Fotos und für eine Fachprüfung"}]'::jsonb,
  '[{"key":"c1","problem":"Zu wenige Steckdosen, vor allem in Küche, Arbeitszimmer und neben dem Bett","howToSpot":"beim Durchgehen mit dem Plan und den geplanten Möbeln"},{"key":"c2","problem":"Leitungen verlaufen quer durch die Wandfläche außerhalb der Zonen","howToSpot":"schräge oder diagonale Schlitze in der Wand"},{"key":"c3","problem":"Es fehlen Leerrohre für spätere Technik","howToSpot":"im Plan taucht kein einziges Leerrohr auf"},{"key":"c4","problem":"Dosen sitzen zu tief oder schief in der Wand","howToSpot":"der Dosenrand liegt nicht bündig mit der späteren Putzoberfläche"},{"key":"c5","problem":"Die Netzwerkverkabelung endet an einer Stelle ohne Strom und ohne Platz","howToSpot":"der geplante Verteilerpunkt liegt in einer Abstellkammer ohne Steckdose"}]'::jsonb,
  '[{"key":"p1","what":"Jede Wand vollständig mit allen Schlitzen und Leitungen, Raum für Raum","why":"das ist die einzige Bohrhilfe, die du in den nächsten Jahrzehnten haben wirst","beforeTaskCode":"t24"},{"key":"p2","what":"Jede Wand mit einem Maßstab im Bild, etwa einem Zollstock an der Türzarge","why":"ohne Maßbezug lässt sich aus einem Foto keine Bohrtiefe und keine Höhe ableiten","beforeTaskCode":"t24"},{"key":"p3","what":"Den offenen Zählerschrank mit Beschriftung der Stromkreise","why":"die Beschriftung geht erfahrungsgemäß als Erstes verloren","beforeTaskCode":"t33"}]'::jsonb,
  true, 'Solange die Leitungen offen in der Wand liegen, ist alles prüfbar. Ein Prüftermin deckt Elektro und Sanitär zusammen ab, wenn beide Gewerke fertig sind und noch nichts verputzt ist.', false,
  '[{"title":"DIN 18015-1 bis -3, Elektrische Anlagen in Wohngebäuden","note":"Planung, Mindestausstattung und Installationszonen"},{"title":"DIN VDE 0100, Errichten von Niederspannungsanlagen","note":"Schutzmaßnahmen und Fehlerstromschutz"},{"title":"Landesbauordnung des jeweiligen Bundeslandes","note":"Pflicht zu Rauchwarnmeldern und betroffene Räume"},{"title":"Verband Privater Bauherren, Prüftermine der Baubegleitung","note":"warum die Rohinstallation ein üblicher Kontrolltermin ist"}]'::jsonb,
  now()
)
on conflict (key, version) do nothing;

-- Rohinstallation Sanitär und Heizung (07-rohinstallation-shk.md)
insert into guide_card (
  key, version, phase_key, trade_code, build_types, task_codes, title, whats_happening,
  watch_for, questions_for_contractor, common_problems, photo_prompts,
  expert_recommended, expert_reason, legal_note, sources, published_at
) values (
  'rohinstallation_shk', 1, 'rohinstallation', 'shk',
  '{}'::mbl.build_type[], array['t21', 't22']::text[],
  'Rohinstallation Sanitär und Heizung',
  'Der Installateur verlegt die Leitungen für Trinkwasser, Abwasser und Heizung, stellt die Vorwände für die Bäder und setzt die Anschlusspunkte. Wo heute eine Rohrschelle sitzt, hängt später dein Waschbecken.

Am Ende dieser Phase steht eine Dichtheitsprüfung. Sie ist der einzige Nachweis, dass die Leitungen dicht waren, bevor sie zugeputzt wurden.',
  '[{"key":"w1","text":"Steh vor der fertigen Vorwand und prüfe die Höhen: WC, Waschbecken, Duscharmatur, Handtuchhalter","why":"die Positionen bestimmen zehn Jahre Nutzung und sind jetzt noch mit einem Bleistiftstrich zu ändern"},{"key":"w2","text":"Die Abwasserrohre sind mit Schellen befestigt, die eine Gummieinlage haben","why":"starr befestigte Rohre übertragen jedes Geräusch in die Nachbarräume"},{"key":"w3","text":"Die Leitungen sind gedämmt, auch die kalten","why":"warme Leitungen verlieren sonst Wärme, kalte schwitzen und durchfeuchten den Aufbau"},{"key":"w4","text":"Der Heizkreisverteiler sitzt an einer Stelle, die dauerhaft zugänglich bleibt","why":"er muss gewartet und eingestellt werden, nicht einmal, sondern immer wieder"},{"key":"w5","text":"Es gibt ein unterschriebenes Protokoll der Dichtheitsprüfung","why":"ohne Protokoll gibt es später nur zwei Meinungen und keinen Nachweis"}]'::jsonb,
  '[{"key":"q1","question":"Bekomme ich den Verlegeplan der Fußbodenheizung mit den Heizkreisen?","whyItMatters":"du brauchst ihn, bevor jemand in den Estrich bohrt, und für den hydraulischen Abgleich"},{"key":"q2","question":"Wie und wann wird die Dichtheitsprüfung durchgeführt, und bekomme ich das Protokoll?","whyItMatters":"die Prüfung gehört zur Leistung, das Protokoll gehört dir"},{"key":"q3","question":"Auf welcher Heizlastberechnung beruht die Auslegung der Wärmepumpe?","whyItMatters":"eine Anlage, die nach Faustformel ausgelegt wurde, läuft entweder zu kurz oder dauernd"},{"key":"q4","question":"Wird der hydraulische Abgleich durchgeführt und dokumentiert?","whyItMatters":"ohne ihn arbeiten Wärmepumpe und Fußbodenheizung dauerhaft ineffizient"},{"key":"q5","question":"Welche Anforderungen an den Schallschutz sind vereinbart, und wie werden sie an den Abwasserleitungen umgesetzt?","whyItMatters":"das Mindestmaß der Norm ist in einem Einfamilienhaus oft nicht das, was man hören möchte"}]'::jsonb,
  '[{"key":"c1","problem":"Die Dichtheitsprüfung wird gemacht, aber nicht protokolliert","howToSpot":"es gibt kein unterschriebenes Blatt mit Datum, Druck und Prüfdauer"},{"key":"c2","problem":"Abwasserrohre sind schallhart befestigt oder liegen direkt an einer Wand zum Schlafzimmer","howToSpot":"Metallschelle ohne Gummieinlage, Rohr berührt das Mauerwerk"},{"key":"c3","problem":"Leitungen sind ungedämmt oder nur teilweise gedämmt","howToSpot":"blanke Rohre in Durchbrüchen und hinter Vorwänden"},{"key":"c4","problem":"Die Vorwandhöhen passen nicht zur späteren Fliesenaufteilung","howToSpot":"der Fliesenspiegel endet mitten in einer Armatur"},{"key":"c5","problem":"Der Heizkreisverteiler wird später zugebaut","howToSpot":"er sitzt hinter einer Stelle, an der ein Schrank oder eine Vorwand geplant ist"}]'::jsonb,
  '[{"key":"p1","what":"Jede Wand und jeden Boden mit den verlegten Leitungen, Raum für Raum","why":"unter dem Estrich liegen Rohre, die niemand mehr sieht und jeder trifft","beforeTaskCode":"t26"},{"key":"p2","what":"Die Fußbodenheizung im verlegten Zustand, vor dem Estrich, mit Maßbezug zu den Raumkanten","why":"eine Bohrung in ein Heizrohr ist ein Wasserschaden im ganzen Geschoss","beforeTaskCode":"t26"},{"key":"p3","what":"Die Vorwände mit allen Anschlusspunkten, bevor sie geschlossen werden","why":"Position und Höhe der Anschlüsse sind später nur noch aufzustemmen","beforeTaskCode":"t24"}]'::jsonb,
  true, 'Wasserführende Leitungen verschwinden hinter Putz und Estrich. Ein Prüftermin deckt Elektro und Sanitär zusammen ab, solange beides offen liegt.', false,
  '[{"title":"DIN 1988 und DIN EN 806, Trinkwasserinstallationen","note":"Planung, Ausführung und Prüfung"},{"title":"DIN 1986-100, Entwässerungsanlagen für Gebäude und Grundstücke","note":"Abwasserleitungen, Gefälle und Belüftung"},{"title":"DIN EN 12831, Heizlastberechnung","note":"Grundlage für die Auslegung der Wärmeerzeugung"},{"title":"DIN 4109, Schallschutz im Hochbau","note":"Anforderungen an Geräusche aus haustechnischen Anlagen"},{"title":"Merkblatt Dichtheitsprüfung, ZVSHK","note":"Verfahren und Inhalt des Prüfprotokolls"},{"title":"Gebäudeenergiegesetz","note":"Dämmung von Leitungen und hydraulischer Abgleich"}]'::jsonb,
  now()
)
on conflict (key, version) do nothing;

-- Blower-Door-Vorabtest (08-blower-door.md)
insert into guide_card (
  key, version, phase_key, trade_code, build_types, task_codes, title, whats_happening,
  watch_for, questions_for_contractor, common_problems, photo_prompts,
  expert_recommended, expert_reason, legal_note, sources, published_at
) values (
  'blower_door', 1, 'rohinstallation', 'pruefer',
  '{}'::mbl.build_type[], array['t23']::text[],
  'Blower-Door-Vorabtest',
  'Ein Prüfer baut ein Gebläse in die Haustür ein und erzeugt im Haus Unterdruck und Überdruck. Aus der Luftmenge, die dabei nachströmt, ergibt sich, wie dicht die Gebäudehülle ist. Der Messwert heißt n50 und beschreibt, wie oft die Raumluft in einer Stunde rechnerisch ausgetauscht würde.

Der Vorabtest hat aber einen zweiten, wichtigeren Zweck: Bei Unterdruck lassen sich undichte Stellen aufspüren und beheben, solange sie noch erreichbar sind.',
  '[{"key":"w1","text":"Der Test findet statt, wenn die luftdichte Ebene fertig, aber noch zugänglich ist","why":"danach ist jede gefundene Leckage nur noch mit Abriss zu erreichen"},{"key":"w2","text":"Du weißt, was in deinem Haus die luftdichte Ebene überhaupt ist","why":"im Massivbau ist es meistens der Innenputz, im ausgebauten Dach die Dampfbremse, und beide müssen fertig sein"},{"key":"w3","text":"Der Prüfer sucht Leckagen und übergibt nicht nur eine Zahl","why":"der Messwert allein sagt dir nicht, wo nachgearbeitet werden muss"},{"key":"w4","text":"Du gehst beim Unterdruck selbst durchs Haus und hältst die Hand an Fensteranschlüsse, Steckdosen und Dachanschlüsse","why":"starken Zug spürt man ohne jedes Gerät"},{"key":"w5","text":"Es gibt ein Messprotokoll mit Datum, Messwerten und Randbedingungen","why":"der Nachweis wird beim Förderantrag und bei der Abnahme verlangt"}]'::jsonb,
  '[{"key":"q1","question":"Was genau ist beim Vorabtest schon fertig, und welche Ebene wird gemessen?","whyItMatters":"ein Test vor dem Innenputz misst in einem Massivhaus nicht die spätere luftdichte Ebene"},{"key":"q2","question":"Wird beim Vorabtest eine Leckageortung durchgeführt, und bin ich dabei?","whyItMatters":"mitgehen ist der Unterschied zwischen einer Zahl und einer Mängelliste"},{"key":"q3","question":"Welcher Grenzwert gilt für dieses Haus, und woraus ergibt er sich?","whyItMatters":"mit Lüftungsanlage gilt ein strengerer Wert als ohne"},{"key":"q4","question":"Wer beseitigt gefundene Undichtigkeiten, und wann wird nachgemessen?","whyItMatters":"ein Vorabtest ohne Nacharbeit ist nur eine Information"},{"key":"q5","question":"Wann findet der abschließende Test statt, und bekomme ich das Protokoll?","whyItMatters":"die Bestätigung gehört zu den Unterlagen, die du bei der Abnahme brauchst"}]'::jsonb,
  '[{"key":"c1","problem":"Der Test kommt zu spät","howToSpot":"Trockenbau und Verkleidungen sind schon geschlossen, die Anschlüsse nicht mehr erreichbar"},{"key":"c2","problem":"Es wird nur gemessen, nicht gesucht","howToSpot":"das Ergebnis ist eine Zahl auf einem Blatt, ohne eine Liste von Fundstellen"},{"key":"c3","problem":"Das Haus ist für die Messung nicht vorbereitet","howToSpot":"Lüftungsöffnungen und Abflüsse sind nicht verschlossen, Fenster stehen offen, der Wert wird unbrauchbar"},{"key":"c4","problem":"Die klassischen Fundstellen bleiben unbearbeitet","howToSpot":"Fensteranschlüsse, Rollladenkästen, Durchführungen von Leitungen und der Anschluss der Dampfbremse an den Giebel"},{"key":"c5","problem":"Der Grenzwert wird knapp gehalten und nach dem Ausbau nicht mehr geprüft","howToSpot":"es gibt nur ein Protokoll, und das trägt das Datum des Vorabtests"}]'::jsonb,
  '[{"key":"p1","what":"Jede beim Unterdruck gefundene undichte Stelle, mit Ortsangabe","why":"nur so ist später nachvollziehbar, was nachgearbeitet wurde","beforeTaskCode":"t24"},{"key":"p2","what":"Den Anschluss der Dampfbremse im Dachgeschoss ringsum, vor der Beplankung","why":"das ist die Stelle, an der die meisten Leckagen sitzen","beforeTaskCode":"t25"}]'::jsonb,
  true, 'Der Vorabtest ist selbst die Fachprüfung. Sein Wert hängt vollständig davon ab, dass er zum richtigen Zeitpunkt stattfindet und dass Leckagen gesucht und nicht nur gezählt werden.', false,
  '[{"title":"DIN EN ISO 9972, Bestimmung der Luftdurchlässigkeit von Gebäuden","note":"das Messverfahren und die Randbedingungen"},{"title":"DIN 4108-7, Luftdichtheit von Gebäuden","note":"Planung und Ausführung der luftdichten Ebene"},{"title":"Gebäudeenergiegesetz, Anforderungen an die Dichtheit","note":"die zulässigen Luftwechselraten mit und ohne Lüftungsanlage"},{"title":"Fachverband Luftdichtheit im Bauwesen, FLiB","note":"empfohlener Zeitpunkt und Ablauf eines Vorabtests"}]'::jsonb,
  now()
)
on conflict (key, version) do nothing;

-- Innenputz (09-innenputz.md)
insert into guide_card (
  key, version, phase_key, trade_code, build_types, task_codes, title, whats_happening,
  watch_for, questions_for_contractor, common_problems, photo_prompts,
  expert_recommended, expert_reason, legal_note, sources, published_at
) values (
  'innenputz', 1, 'ausbau', 'putzer',
  '{}'::mbl.build_type[], array['t24']::text[],
  'Innenputz',
  'Die Wände bekommen ihren Putz. Was danach aussieht wie eine Wand, ist im Massivbau zugleich die luftdichte Ebene des Hauses: Der Putz schließt die Fugen im Mauerwerk, durch die sonst Luft wandert.

Deshalb muss er an Stellen weitergeführt werden, an denen ihn niemand je sieht: hinter Vorwandinstallationen, bis hinauf zur Rohdecke, um jede Durchdringung herum.',
  '[{"key":"w1","text":"Hinter Vorwänden und abgehängten Bereichen wird durchgeputzt","why":"eine ungeputzte Fläche hinter einer Verkleidung ist ein Loch in der luftdichten Ebene"},{"key":"w2","text":"Der Putz läuft bis zur Rohdecke und endet nicht an der späteren Deckenkante","why":"der Streifen dazwischen ist im Blower-Door-Test messbar"},{"key":"w3","text":"An Übergängen zwischen zwei Baustoffen liegt ein Gewebe im Putz","why":"unterschiedliche Materialien arbeiten unterschiedlich, und genau dort reißt der Putz"},{"key":"w4","text":"Es wird gelüftet, aber nicht mit Heizgeräten trockengeblasen","why":"zu schnelles Trocknen erzeugt Risse und eine mürbe Oberfläche"},{"key":"w5","text":"Die Ecken sind winkelig und die Flächen eben, geprüft mit einem langen Richtscheit","why":"was hier schief ist, siehst du später an jedem Möbelstück, das an der Wand steht"}]'::jsonb,
  '[{"key":"q1","question":"Wird hinter allen Vorwänden und bis zur Rohdecke durchgeputzt?","whyItMatters":"das ist die häufigste Ursache für ein schlechtes Ergebnis beim Blower-Door-Test"},{"key":"q2","question":"Welche Oberflächenqualität ist geschuldet, und steht sie im Vertrag?","whyItMatters":"für Spachtel- und Trockenbauflächen sind die Stufen Q1 bis Q4 üblich, und der Unterschied ist erheblich"},{"key":"q3","question":"Wie viel Feuchtigkeit bringt der Putz ins Haus, und wie wird sie herausgelüftet?","whyItMatters":"Baufeuchte, die im Haus bleibt, wird zum Schimmelproblem"},{"key":"q4","question":"Welche Toleranzen gelten für Ebenheit und Winkligkeit?","whyItMatters":"dann gibt es später eine Zahl statt einer Einschätzung"},{"key":"q5","question":"Wann ist der Putz so trocken, dass der Estrich eingebracht werden kann?","whyItMatters":"die Reihenfolge und die Wartezeit bestimmen den weiteren Ablauf"}]'::jsonb,
  '[{"key":"c1","problem":"Hinter der Vorwand im Bad ist nicht geputzt","howToSpot":"vor dem Schließen der Vorwand hineinsehen, danach nicht mehr"},{"key":"c2","problem":"Der Putz endet an der abgehängten Decke","howToSpot":"oberhalb der späteren Deckenkante ist blankes Mauerwerk zu sehen"},{"key":"c3","problem":"Risse an Materialübergängen","howToSpot":"feine Linien genau dort, wo Beton auf Mauerwerk trifft, oft erst nach dem Trocknen"},{"key":"c4","problem":"Zu schnell getrocknet","howToSpot":"netzartige Haarrisse in der Fläche, Putz staubt beim Darüberstreichen"},{"key":"c5","problem":"Die Baufeuchte bleibt im Haus","howToSpot":"beschlagene Fenster, muffiger Geruch, feuchte Ecken"}]'::jsonb,
  '[{"key":"p1","what":"Die Flächen hinter jeder Vorwand, bevor sie geschlossen wird","why":"danach lässt sich nicht mehr belegen, ob dort geputzt wurde","beforeTaskCode":"t25"},{"key":"p2","what":"Den Anschluss des Putzes an die Rohdecke in jedem Raum mit abgehängter Decke","why":"dieser Streifen entscheidet über die Luftdichtheit und ist danach verdeckt","beforeTaskCode":"t25"}]'::jsonb,
  false, null, false,
  '[{"title":"DIN 18550 und DIN EN 13914-2, Planung und Ausführung von Innenputz","note":"Putzsysteme, Putzgrund und Ausführung"},{"title":"DIN 4108-7, Luftdichtheit von Gebäuden","note":"warum der Innenputz die luftdichte Ebene ist"},{"title":"DIN 18202, Toleranzen im Hochbau","note":"zulässige Abweichungen bei Ebenheit und Winkligkeit"},{"title":"Merkblatt zu Oberflächenqualitäten, Bundesverband Ausbau und Fassade","note":"was hinter den Stufen Q1 bis Q4 steht"}]'::jsonb,
  now()
)
on conflict (key, version) do nothing;

-- Estrich und Belegreife (10-estrich.md)
insert into guide_card (
  key, version, phase_key, trade_code, build_types, task_codes, title, whats_happening,
  watch_for, questions_for_contractor, common_problems, photo_prompts,
  expert_recommended, expert_reason, legal_note, sources, published_at
) values (
  'estrich', 1, 'ausbau', 'estrich',
  '{}'::mbl.build_type[], array['t26', 't27']::text[],
  'Estrich und Belegreife',
  'Auf die Rohdecke kommen Dämmung, Folie und darauf der Estrich: die Schicht, die den fertigen Fußboden trägt. Er wird an keiner Stelle mit den Wänden verbunden, sondern schwimmt auf der Dämmung, damit kein Schall in die Wände läuft.

Danach kommt die längste Wartezeit des ganzen Baus. Der Estrich muss trocknen, bis er belegreif ist, und das dauert Wochen. Diese Zeit lässt sich nicht verkürzen, nur durch Messen ehrlich bestimmen.',
  '[{"key":"w1","text":"Die Aufbauhöhe steht fest, bevor der Estrich kommt","why":"sie ergibt sich aus deinem Bodenbelag, und ein zu hoher Estrich lässt die Türen nicht mehr aufgehen"},{"key":"w2","text":"Der Randdämmstreifen läuft ringsum an jeder Wand und an jeder Säule hoch","why":"eine einzige Stelle, an der Estrich die Wand berührt, überträgt Trittschall ins ganze Haus"},{"key":"w3","text":"Der Randdämmstreifen wird erst nach den Bodenbelagsarbeiten abgeschnitten","why":"zu früh abgeschnitten, füllt sich die Fuge mit Fliesenkleber, und die Schallbrücke ist wieder da"},{"key":"w4","text":"Die Bewegungsfugen liegen dort, wo sie im Fugenplan stehen","why":"sie müssen später im Bodenbelag übernommen werden, sonst reißt der Belag"},{"key":"w5","text":"Vor dem Belegen wird die Restfeuchte gemessen und protokolliert","why":"der Kalender sagt nichts über die Feuchte, die Messung schon"}]'::jsonb,
  '[{"key":"q1","question":"Welche Aufbauhöhe ist eingeplant, und für welchen Bodenbelag?","whyItMatters":"Fliese, Parkett und Vinyl brauchen unterschiedlich viel Platz, und die Entscheidung muss vor dem Estrich fallen"},{"key":"q2","question":"Welche Estrichart wird eingebaut?","whyItMatters":"Zementestrich und Calciumsulfatestrich trocknen unterschiedlich lange und haben verschiedene Grenzwerte"},{"key":"q3","question":"Wird ein Funktionsheizen der Fußbodenheizung durchgeführt und protokolliert?","whyItMatters":"es gehört zur Leistung und ist die Voraussetzung dafür, dass der Belag verlegt werden darf"},{"key":"q4","question":"Wer misst die Belegreife, mit welchem Verfahren, und bekomme ich das Protokoll?","whyItMatters":"die CM-Messung ist das übliche Verfahren, und das Protokoll ist dein Nachweis"},{"key":"q5","question":"Bekomme ich den Fugenplan?","whyItMatters":"die Fliesen- und Bodenleger brauchen ihn, und du brauchst ihn, bevor jemand bohrt"}]'::jsonb,
  '[{"key":"c1","problem":"Der Bodenbelag steht bei der Ausführung noch nicht fest","howToSpot":"die Aufbauhöhe wird geschätzt, und die Türblätter passen später nicht"},{"key":"c2","problem":"Zu früh belegt","howToSpot":"der Belag wölbt sich Wochen später, oder es riecht muffig"},{"key":"c3","problem":"Der Randdämmstreifen fehlt an einer Stelle oder wurde zu früh abgeschnitten","howToSpot":"an der Fuge zwischen Estrich und Wand, bevor der Belag kommt"},{"key":"c4","problem":"Der Estrich ist über den Heizrohren zu dünn","howToSpot":"Risse, die genau dem Verlauf der Heizschleifen folgen"},{"key":"c5","problem":"Es wird ohne Messung belegt","howToSpot":"es gibt kein Protokoll mit Datum, Messwert und Messstelle"}]'::jsonb,
  '[{"key":"p1","what":"Die verlegte Fußbodenheizung mit Maßbezug zu den Raumkanten, bevor der Estrich kommt","why":"eine Bohrung in ein Heizrohr ist ein Wasserschaden, den niemand kommen sieht","beforeTaskCode":"t26"},{"key":"p2","what":"Den Randdämmstreifen ringsum in jedem Raum","why":"nach dem Bodenbelag ist nicht mehr nachweisbar, ob er durchgehend war","beforeTaskCode":"t31"},{"key":"p3","what":"Die Lage aller Bewegungsfugen","why":"sie müssen im Belag übernommen werden, und der Fugenplan geht gern verloren","beforeTaskCode":"t28"}]'::jsonb,
  false, null, false,
  '[{"title":"DIN 18560, Estriche im Bauwesen","note":"Aufbau, Dicken und Ausführung schwimmender Estriche"},{"title":"DIN EN 1264-4, Fußbodenheizung, Installation","note":"Funktionsheizen vor dem Belegen"},{"title":"Hinweise des Bundesverbands Estrich und Belag zur Belegreife","note":"CM-Messung und die üblichen Grenzwerte je Estrichart"},{"title":"Merkblatt zur Schnittstellenkoordination, ZDB","note":"wer was wann übergibt zwischen Estrich, Heizung und Belag"}]'::jsonb,
  now()
)
on conflict (key, version) do nothing;

-- Fliesenarbeiten (11-fliesen.md)
insert into guide_card (
  key, version, phase_key, trade_code, build_types, task_codes, title, whats_happening,
  watch_for, questions_for_contractor, common_problems, photo_prompts,
  expert_recommended, expert_reason, legal_note, sources, published_at
) values (
  'fliesen', 1, 'endausbau', 'fliesen',
  '{}'::mbl.build_type[], array['t28']::text[],
  'Fliesenarbeiten',
  'Bäder, Küche und häufig der Hauswirtschaftsraum werden gefliest. Vorher kommt in den Bereichen, die nass werden, eine Abdichtung direkt unter die Fliesen: eine dünne, meist blaue oder graue Schicht, die man nach dem Fliesen nie wieder sieht.

Fliesen sind nicht wasserdicht, und Fugen erst recht nicht. Dicht ist immer die Schicht darunter.',
  '[{"key":"w1","text":"In der Dusche und ringsum um die Wanne ist eine Abdichtung aufgebracht, bevor gefliest wird","why":"ohne sie läuft Wasser durch die Fugen in den Aufbau, und das merkt man erst nach Jahren"},{"key":"w2","text":"Die Abdichtung ist an Rohrdurchführungen und in den Ecken mit Manschetten und Dichtbändern verstärkt","why":"die Ecken und die Durchführungen sind die einzigen Stellen, an denen sie tatsächlich versagt"},{"key":"w3","text":"Die bodengleiche Dusche hat Gefälle zum Ablauf, gleichmäßig aus allen Richtungen","why":"eine Pfütze in der Dusche verschwindet nicht von selbst und lässt sich nicht nachbessern"},{"key":"w4","text":"Die Bewegungsfugen des Estrichs sind in den Fliesen übernommen","why":"wird darübergefliest, reißt der Belag genau dort"},{"key":"w5","text":"Beim Abklopfen mit dem Knöchel klingt keine Fliese hohl","why":"Hohlstellen brechen unter Belastung, und die Fliese ist dann nicht die einzige Baustelle"},{"key":"w6","text":"Randfugen und Innenecken sind elastisch ausgeführt, nicht starr verfugt","why":"dort bewegen sich zwei Bauteile gegeneinander"}]'::jsonb,
  '[{"key":"q1","question":"Welche Wassereinwirkungsklasse nach DIN 18534 wird in Dusche, Bad und Hauswirtschaftsraum angesetzt?","whyItMatters":"davon hängt ab, ob und wie abgedichtet wird"},{"key":"q2","question":"Bekomme ich Fotos der fertigen Abdichtung, bevor gefliest wird?","whyItMatters":"nach dem Fliesen ist sie für immer verdeckt"},{"key":"q3","question":"Wie ist das Verlegemuster geplant, und wo liegen die Schnitte?","whyItMatters":"an Türen, Ecken und über der Wanne entscheidet das über das Ergebnis"},{"key":"q4","question":"Wann muss die Fliesenauswahl spätestens stehen?","whyItMatters":"Lieferzeiten bei Fliesen sind der häufigste Grund für Verzug im Innenausbau"},{"key":"q5","question":"Sind die Silikonfugen Wartungsfugen?","whyItMatters":"sie altern und werden erneuert, das ist normal und kein Mangel"}]'::jsonb,
  '[{"key":"c1","problem":"In der Dusche fehlt die Abdichtung","howToSpot":"nur vor dem Fliesen zu sehen, danach nur noch am Feuchteschaden im Nachbarraum"},{"key":"c2","problem":"Die Abdichtung ist an den Ecken nur gestrichen und nicht mit Band verstärkt","howToSpot":"in der Innenecke ist kein eingelegtes Band zu erkennen"},{"key":"c3","problem":"Kein oder ungleichmäßiges Gefälle in der bodengleichen Dusche","howToSpot":"eine Wasserprobe steht nach dem Duschen an derselben Stelle"},{"key":"c4","problem":"Bewegungsfugen sind überfliest","howToSpot":"an der Stelle, an der im Estrich eine Fuge lag, verläuft die Fliese durch"},{"key":"c5","problem":"Hohllagen unter den Fliesen","howToSpot":"dumpfer, hohler Klang beim Abklopfen, meist an den Rändern"},{"key":"c6","problem":"Die Fliesenauswahl fällt zu spät","howToSpot":"der Liefertermin liegt hinter dem geplanten Beginn des Fliesenlegers"}]'::jsonb,
  '[{"key":"p1","what":"Die fertige Abdichtung in jedem Nassbereich, vollflächig und in den Ecken aus der Nähe","why":"nach dem Fliesen gibt es keinen Nachweis mehr, dass sie überhaupt da war","beforeTaskCode":"t28"},{"key":"p2","what":"Alle Rohrdurchführungen mit ihren Dichtmanschetten","why":"das sind die Stellen, an denen später gesucht wird","beforeTaskCode":"t28"},{"key":"p3","what":"Die gefliesten Wände vor dem Einbau der Sanitärobjekte, mit Maßbezug","why":"dahinter liegen Leitungen, und irgendwann bohrt jemand","beforeTaskCode":"t34"}]'::jsonb,
  false, null, false,
  '[{"title":"DIN 18534, Abdichtung von Innenräumen","note":"Wassereinwirkungsklassen und zulässige Abdichtungen im Verbund"},{"title":"Merkblätter des Zentralverbands des Deutschen Baugewerbes zu Verbundabdichtungen","note":"Ausführung an Ecken und Durchdringungen"},{"title":"Merkblatt zu Wartungsfugen, Industrieverband Dichtstoffe","note":"warum Silikonfugen erneuert werden und kein Mangel sind"},{"title":"DIN 18202, Toleranzen im Hochbau","note":"Ebenheit der gefliesten Flächen"}]'::jsonb,
  now()
)
on conflict (key, version) do nothing;

-- Abnahme und Übergabe (12-abnahme.md)
insert into guide_card (
  key, version, phase_key, trade_code, build_types, task_codes, title, whats_happening,
  watch_for, questions_for_contractor, common_problems, photo_prompts,
  expert_recommended, expert_reason, legal_note, sources, published_at
) values (
  'abnahme', 1, 'abnahme', null,
  '{}'::mbl.build_type[], array['t37', 't38']::text[],
  'Abnahme und Übergabe',
  'Bei der Abnahme erklärst du, dass du das Bauwerk als im Wesentlichen vertragsgemäß annimmst. Das ist kein Termin zum Schlüsselholen, sondern der Zeitpunkt, an dem sich die Rechtslage dreht.

Ab der Abnahme beginnt die Verjährungsfrist für Mängelansprüche, die Schlussrechnung wird fällig, und die Beweislast wechselt: Bis dahin muss der Unternehmer zeigen, dass seine Leistung mangelfrei ist. Danach musst du zeigen, dass sie es nicht ist.',
  '[{"key":"w1","text":"Nimm dir Zeit und lass dich nicht drängen","why":"die Abnahme ist der einzige Termin des ganzen Baus, den man nicht nachholen kann"},{"key":"w2","text":"Geh mit einer vorbereiteten Liste durch das Haus, Raum für Raum","why":"unter Zeitdruck fällt niemandem etwas ein, hinterher jedem"},{"key":"w3","text":"Jeder bekannte Mangel steht im Protokoll, auch der kleine","why":"was nicht im Protokoll steht, gilt als abgenommen"},{"key":"w4","text":"Zu jedem Mangel steht eine Frist im Protokoll","why":"ohne Frist gibt es keinen Zeitpunkt, ab dem etwas passiert"},{"key":"w5","text":"Du nimmst ein unterschriebenes Exemplar des Protokolls mit","why":"ein Protokoll, das nur der andere hat, ist kein Protokoll"},{"key":"w6","text":"Die Unterlagen sind vollständig übergeben","why":"Nachweise nachträglich einzusammeln ist mühsam, solange sie noch jemanden interessieren"}]'::jsonb,
  '[{"key":"q1","question":"Welche Unterlagen bekomme ich bei der Übergabe?","whyItMatters":"Messprotokolle, Bestandspläne, Bedienungsanleitungen und der Energieausweis gehören dazu"},{"key":"q2","question":"Liegen die Nachweise zu Luftdichtheit, Dichtheitsprüfung und hydraulischem Abgleich vor?","whyItMatters":"das sind genau die Nachweise, die später beim Verkauf oder bei einem Schaden verlangt werden"},{"key":"q3","question":"Welche Restleistungen stehen noch aus, und bis wann sind sie erledigt?","whyItMatters":"Restleistungen und Mängel sind zwei verschiedene Dinge und gehören getrennt ins Protokoll"},{"key":"q4","question":"Wie ist der Zahlungsplan mit der Abnahme verknüpft?","whyItMatters":"die letzte Rate ist dein einziges verbliebenes Druckmittel"},{"key":"q5","question":"Wer ist bei der Abnahme dabei, und darf ich einen Sachverständigen mitbringen?","whyItMatters":"das ist üblich und muss vorher niemand genehmigen"}]'::jsonb,
  '[{"key":"c1","problem":"Die Abnahme wird nebenbei erledigt","howToSpot":"der Termin ist auf eine Stunde angesetzt, das Protokoll ist schon vorausgefüllt"},{"key":"c2","problem":"Bekannte Mängel werden mündlich zugesagt und nicht protokolliert","howToSpot":"im Protokoll steht nichts, im Gedächtnis aller Beteiligten etwas anderes"},{"key":"c3","problem":"Es fehlt ein Vorbehalt","howToSpot":"das Protokoll enthält keine Erklärung zu bekannten Mängeln oder zu einer vereinbarten Vertragsstrafe"},{"key":"c4","problem":"Die Schlussrate wird vor Beseitigung der Mängel gezahlt","howToSpot":"der Zahlungsbeleg trägt ein Datum vor der Nachbesserung"},{"key":"c5","problem":"Unterlagen fehlen","howToSpot":"es gibt keinen Ordner, sondern das Versprechen, ihn nachzureichen"}]'::jsonb,
  '[{"key":"p1","what":"Jeden im Protokoll aufgeführten Mangel einzeln, mit Raumangabe","why":"eine Beschreibung im Protokoll ist selten so eindeutig wie ein Bild","beforeTaskCode":"t38"},{"key":"p2","what":"Das unterschriebene Abnahmeprotokoll selbst, alle Seiten","why":"es ist das wichtigste Dokument deines Bauvorhabens","beforeTaskCode":"t38"},{"key":"p3","what":"Alle Zählerstände am Übergabetag","why":"sie sind die Trennlinie zwischen Baustrom und deinem Verbrauch","beforeTaskCode":"t38"}]'::jsonb,
  true, 'Die Abnahme verschiebt die Beweislast auf dich. Was an diesem Tag nicht im Protokoll steht, musst du danach selbst nachweisen.', true,
  '[{"title":"§ 640 BGB, Abnahme","note":"Wirkung der Abnahme und die Folgen einer Fristsetzung"},{"title":"§ 650g BGB, Zustandsfeststellung","note":"was gilt, wenn die Abnahme verweigert wird"},{"title":"§ 634a BGB, Verjährung der Mängelansprüche","note":"die Frist bei Bauwerken beträgt fünf Jahre"},{"title":"§ 650m BGB, Abschlagszahlungen und Sicherheit beim Verbraucherbauvertrag","note":"Begrenzung der Abschläge und Sicherheitsleistung"},{"title":"§ 80 Gebäudeenergiegesetz, Energieausweis","note":"welcher Nachweis bei Fertigstellung auszustellen ist"},{"title":"Verband Privater Bauherren und Bauherren-Schutzbund, Hinweise zur Abnahme","note":"Ablauf und Vorbereitung des Termins"}]'::jsonb,
  now()
)
on conflict (key, version) do nothing;

-- ---------------------------------------------------------------------------
-- Zuordnung zu bestehenden Bauvorhaben
--
-- Neue Projekte bekommen ihre Karten beim Anlegen (apps/api/src/onboarding.ts).
-- Projekte, die es vor dieser Migration schon gab, hier — sonst stünde die
-- Wissensschicht ausgerechnet den Bauherren nicht zur Verfügung, die schon
-- bauen.
--
-- Die Zuordnung friert die Fassung ein, die der Bauherr tatsächlich zu sehen
-- bekommt. Eine spätere Fassung ändert nichts an einem laufenden Bauvorhaben,
-- solange die Zuordnung nicht ausdrücklich nachgezogen wird.
-- ---------------------------------------------------------------------------

update task t
   set guide_card_id = c.id
  from guide_card c
 where c.published_at is not null
   and c.superseded_by is null
   and t.template_task_code = any (c.task_codes)
   and t.guide_card_id is distinct from c.id;
