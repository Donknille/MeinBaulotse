-- ---------------------------------------------------------------------------
-- MeinBaulotse — Lotsenkarten (erzeugt, nicht von Hand bearbeiten)
--
-- Erzeugt von packages/db/scripts/generate-guide-cards.ts aus:
--   content/lotsenkarten/*.md
--
-- Neu erzeugen: pnpm --filter @meinbaulotse/db guide-cards:generate
--
-- Eine veröffentlichte Karte ist unveränderlich (Invariante 4.1.6). Wer
-- Inhalt ändert, erhöht „fassung" in der Markdown-Datei; dieser Import legt
-- dann eine neue Fassung an und verkettet die alte über superseded_by.
-- Bereits eingespielte Zeilen bleiben unberührt: Jedes insert endet auf
-- „on conflict do nothing", und die Kennungen sind aus Schlüssel und
-- Fassung abgeleitet, nicht gewürfelt.
-- ---------------------------------------------------------------------------

-- Abnahme und Übergabe (abnahme, Fassung 1)
insert into guide_card (
  id, key, version, phase_key, trade_code, template_task_codes, title,
  whats_happening, watch_for, questions_for_contractor, common_problems,
  photo_prompts, expert_recommended, expert_reason, sources, published_at
) values (
  '49121e84-e9a9-5208-b35c-f9f5150134ca', 'abnahme', 1, 'abnahme',
  null, array['t37']::text[], 'Abnahme und Übergabe',
  'Bei der Abnahme erklärst du, dass du das Bauwerk als im Wesentlichen vertragsgemäß entgegennimmst. Ihr geht gemeinsam durch das Haus, alles Auffällige kommt in ein Protokoll, und beide Seiten unterschreiben.

Die Abnahme ist der wichtigste Termin des ganzen Baus, denn an ihm hängen drei Dinge gleichzeitig: die Fälligkeit der Schlusszahlung, der Beginn der Verjährungsfrist für Mängel und die Frage, wer künftig beweisen muss, dass ein Mangel vorliegt. Vor der Abnahme muss der Unternehmer beweisen, dass alles in Ordnung ist; danach musst du beweisen, dass es das nicht ist.

Das sind Hinweise auf Gesetzesstellen, keine Rechtsberatung.',
  '[{"text":"Nimm dir Zeit und geh nicht unter Termindruck durch das Haus","why":"eine Abnahme lässt sich nicht zurücknehmen"},{"text":"Jeder festgestellte Mangel kommt ins Protokoll, auch der kleine","why":"was nicht im Protokoll steht, musst du später selbst beweisen"},{"text":"Vorbehalt für Vertragsstrafe ausdrücklich erklären, falls eine vereinbart ist und der Termin überschritten wurde","why":"ohne Vorbehalt bei der Abnahme entfällt sie"},{"text":"Lass dir alle Unterlagen übergeben: Protokolle, Bedienungsanleitungen, Wartungshinweise, Bestandspläne, Nachweise zu Erdung, Dichtheit und Estrich","why":"sie sind später kaum noch zu beschaffen"},{"text":"Zähler ablesen und im Protokoll festhalten","why":"Strom, Wasser und Gas wechseln an diesem Tag den Verantwortlichen"}]'::jsonb,
  '[{"question":"Welche Unterlagen bekomme ich bei der Übergabe, und wann?","whyItMatters":"die Sammlung gehört zur Leistung und ist der Grundstock deiner Bauakte"},{"question":"Wie und bis wann werden die protokollierten Mängel beseitigt?","whyItMatters":"mit Datum im Protokoll, nicht als Absichtserklärung"},{"question":"Welche Restarbeiten sind noch offen, und was davon ist ein Mangel?","whyItMatters":"beides wird gern vermischt und hat verschiedene Folgen"},{"question":"Welche Wartungsarbeiten sind in welchem Rhythmus nötig, damit Gewährleistungsansprüche bestehen bleiben?","whyItMatters":"bei Heizung und Lüftung ist das regelmäßig eine Bedingung"}]'::jsonb,
  '[{"problem":"Die Abnahme wird zwischen Tür und Angel gemacht","howToSpot":"Mängel fallen erst beim Einzug auf und stehen dann in keinem Protokoll"},{"problem":"Es wird abgenommen, obwohl wesentliche Mängel offen sind","howToSpot":"die Beweislast dreht sich um, und die Schlusszahlung wird fällig"},{"problem":"Der Vorbehalt für die Vertragsstrafe fehlt","howToSpot":"der Anspruch ist weg, obwohl der Verzug unstrittig war"},{"problem":"Unterlagen werden nachgereicht und kommen nie","howToSpot":"ohne sie fehlen dir bei jedem späteren Schaden die Nachweise"}]'::jsonb,
  '[{"what":"Jeden Raum im Zustand der Abnahme, vollständig und mit Datum","why":"der Zustand ist danach nicht mehr rekonstruierbar"},{"what":"Jeden einzelnen im Protokoll genannten Mangel","why":"das Foto neben der Protokollzeile erspart später jede Diskussion darüber, was gemeint war"},{"what":"Alle Zählerstände","why":"sie sind der Stichtag für die Abrechnung"}]'::jsonb,
  true, 'Dies ist der Termin, an dem sich die Beweislast umkehrt und die Schlusszahlung fällig wird. Ein Sachverständiger sieht in zwei Stunden Dinge, die ein Laie nicht sehen kann, und ein Mangel, der ins Abnahmeprotokoll kommt, kostet dich nichts — derselbe Mangel drei Jahre später kostet ein Gutachten und Nerven. Baubegleiter setzen hier ihren letzten und wichtigsten Termin.',
  '[{"reference":"§ 640 BGB","note":"Abnahme, mit den Folgen der Abnahme und der Verweigerung wegen wesentlicher Mängel"},{"reference":"§ 650g BGB","note":"Zustandsfeststellung bei verweigerter Abnahme sowie Anforderungen an die Schlussrechnung"},{"reference":"§ 634a Absatz 1 Nummer 2 BGB","note":"Verjährung der Mängelansprüche bei Bauwerken in fünf Jahren ab Abnahme"},{"reference":"§ 650m BGB","note":"Abschlagszahlungen und Sicherheit beim Verbraucherbauvertrag"}]'::jsonb,
  now()
)
on conflict (id) do nothing;

-- Blower-Door-Vorabtest (blower-door, Fassung 1)
insert into guide_card (
  id, key, version, phase_key, trade_code, template_task_codes, title,
  whats_happening, watch_for, questions_for_contractor, common_problems,
  photo_prompts, expert_recommended, expert_reason, sources, published_at
) values (
  '8c03d351-7f47-5b8e-9c51-0cead040e2c0', 'blower-door', 1, 'rohinstallation',
  'pruefer', array['t23']::text[], 'Blower-Door-Vorabtest',
  'Ein Ventilator wird luftdicht in die Haustür eingebaut und erzeugt im Haus Unter- und Überdruck. Aus der Luftmenge, die dabei nachströmt, ergibt sich, wie dicht die Gebäudehülle ist.

Entscheidend ist das Wort Vorabtest: Er findet statt, solange die undichten Stellen noch zugänglich sind. Der Test am fertigen Haus liefert nur noch eine Zahl, keine Möglichkeit zur Nachbesserung mehr.',
  '[{"text":"Der Test findet vor Innenputz und Trockenbeplankung statt","why":"danach ist eine Leckage eine Baustelle und keine Nacharbeit"},{"text":"Geh während des Unterdrucks selbst durchs Haus und halte die Hand an Fensterlaibungen, Steckdosen, Rollladenkästen und Dachanschlüsse","why":"undichte Stellen spürst du deutlich"},{"text":"Der Prüfer erstellt eine Leckageliste, nicht nur einen Messwert","why":"die Liste ist der eigentliche Nutzen dieses Termins"},{"text":"Die gefundenen Stellen werden nachgearbeitet und danach erneut geprüft","why":"ohne Nachprüfung bleibt offen, ob es genutzt hat"},{"text":"Der Messwert wird zusammen mit dem gemessenen Gebäudevolumen dokumentiert","why":"die Zahl allein ist ohne Bezugsgröße nicht nachvollziehbar"}]'::jsonb,
  '[{"question":"Ist der Vorabtest im Vertrag enthalten, oder nur der Nachweis am fertigen Haus?","whyItMatters":"beides sind verschiedene Leistungen mit verschiedenem Zweck"},{"question":"Welchen Wert schulden wir nach dem Wärmeschutznachweis?","whyItMatters":"bei Lüftungsanlagen und Förderprogrammen gelten strengere Werte als der Regelfall"},{"question":"Wer arbeitet die Leckagen nach, und wann wird nachgemessen?","whyItMatters":"sonst bleibt die Liste ein Papier"},{"question":"Bekomme ich das Messprotokoll mit Leckageliste und Fotos?","whyItMatters":"das Protokoll gehört in die Bauakte und wird bei Förderungen verlangt"}]'::jsonb,
  '[{"problem":"Der Test wird erst am fertigen Haus gemacht","howToSpot":"der Wert stimmt vielleicht, aber gefundene Leckagen lassen sich nicht mehr wirtschaftlich beheben"},{"problem":"Typische Fundstellen bleiben unbearbeitet: Fensteranschlüsse, Rollladenkästen, Leitungsdurchführungen zum Dach, Übergang Mauerwerk zu Dachanschluss","howToSpot":"sie tauchen in jeder zweiten Leckageliste auf"},{"problem":"Der Test wird bei offenen Innentüren oder unverschlossenen Lüftungsöffnungen gefahren","howToSpot":"dann misst er etwas anderes als die Hülle"},{"problem":"Es gibt keine Nachmessung","howToSpot":"niemand kann sagen, ob die Nacharbeit gewirkt hat"}]'::jsonb,
  '[{"what":"Die Anzeige des Messgeräts mit dem Ergebnis","why":"sie gehört zusammen mit dem Protokoll in die Bauakte"},{"what":"Jede gefundene Leckagestelle vor der Nacharbeit","why":"danach sieht man ihr nichts mehr an"},{"what":"Dieselben Stellen nach der Nacharbeit","why":"das ist der Beleg, dass etwas passiert ist"}]'::jsonb,
  true, 'Der Test selbst wird von einem Prüfer durchgeführt — das ist bereits die Fachprüfung, und sie ist genau dann etwas wert, wenn sie früh stattfindet. Undichtheiten in der Hülle kosten dauerhaft Heizenergie und führen an kalten Stellen zu Feuchte im Bauteil. Beides ist am fertigen Haus nicht mehr korrigierbar.',
  '[{"reference":"DIN EN ISO 9972","note":"Bestimmung der Luftdurchlässigkeit von Gebäuden, Differenzdruckverfahren"},{"reference":"§ 26 Gebäudeenergiegesetz zusammen mit Anlage 4","note":"Anforderungen an die Dichtheit der Gebäudehülle"},{"reference":"DIN 4108-7","note":"Luftdichtheit von Gebäuden, mit den typischen Anschlussdetails"}]'::jsonb,
  now()
)
on conflict (id) do nothing;

-- Bodenplatte und Fundamenterder (bodenplatte, Fassung 1)
insert into guide_card (
  id, key, version, phase_key, trade_code, template_task_codes, title,
  whats_happening, watch_for, questions_for_contractor, common_problems,
  photo_prompts, expert_recommended, expert_reason, sources, published_at
) values (
  '0c31ed14-fc50-5070-b2d5-67b1de769b96', 'bodenplatte', 1, 'gruendung',
  'rohbau', array['t05', 't06']::text[], 'Bodenplatte und Fundamenterder',
  'Auf die Baugrubensohle kommt eine dünne Schicht Magerbeton, die Sauberkeitsschicht. Darauf werden der Fundamenterder — ein Ring aus Bandstahl, der später das ganze Haus erdet — sowie Bewehrung und Leerrohre verlegt. Dann wird die Bodenplatte betoniert.

Dieser Tag ist besonders: Alles, was hier eingebaut wird, liegt danach unter Beton. Korrigieren heißt ab dem nächsten Morgen aufstemmen.',
  '[{"text":"Die Anschlussfahnen des Fundamenterders stehen sichtbar heraus","why":"an den Ring im Beton kommt später niemand mehr heran"},{"text":"Die Bewehrung liegt auf Abstandhaltern, nicht auf der Sauberkeitsschicht","why":"liegt sie unten auf, fehlt ihr die Betondeckung und sie rostet von innen"},{"text":"Leerrohre und Durchführungen für Wasser, Abwasser und Strom stehen dort, wo sie im Plan stehen","why":"jede spätere Durchführung ist eine Kernbohrung durch ein fertiges Bauteil"},{"text":"Der Beton wird verdichtet und nicht nur eingefüllt","why":"unverdichteter Beton bildet Hohlstellen, die man erst beim Freilegen des Randes sieht"},{"text":"Bei Sonne, Wind oder Frost wird der frische Beton abgedeckt oder feucht gehalten","why":"Beton, der zu schnell austrocknet, reißt an der Oberfläche"}]'::jsonb,
  '[{"question":"Wo genau liegen die Anschlussfahnen des Fundamenterders?","whyItMatters":"ihre Lage bestimmt, wo Elektriker und später ein Blitzschutz anschließen können"},{"question":"Bekomme ich das Protokoll zum Fundamenterder nach DIN 18014?","whyItMatters":"die Dokumentation ist vorgeschrieben, und der Netzbetreiber fragt beim Hausanschluss danach"},{"question":"Welche Betongüte und welche Expositionsklasse verlangt die Statik, und was steht auf dem Lieferschein?","whyItMatters":"beides muss zusammenpassen, und der Lieferschein ist der einzige Beleg"},{"question":"Wie lange bleibt die Platte geschützt, bevor darauf gemauert wird?","whyItMatters":"die Aushärtung steht als eigener Vorgang in deinem Plan und ist keine Pufferzeit"}]'::jsonb,
  '[{"problem":"Der Fundamenterder fehlt oder ist nur teilweise verlegt","howToSpot":"es fehlen die Anschlussfahnen, und es fällt erst auf, wenn der Elektriker den Hausanschluss anmeldet"},{"problem":"Zu geringe Betondeckung der Bewehrung","howToSpot":"an der Untersicht zeigen sich später Rostfahnen, oft erst nach Jahren"},{"problem":"Durchführungen sitzen an der falschen Stelle","howToSpot":"es wird nachgebohrt, und jede Bohrung ist eine neue Schwachstelle in der Abdichtung"},{"problem":"Die Platte ist unebener als zulässig","howToSpot":"das fällt erst beim Estrich auf, und dann zahlt jemand den Ausgleich"}]'::jsonb,
  '[{"what":"Der fertig verlegte Fundamenterder mit allen Anschlussfahnen, vor dem Betonieren","why":"danach liegt der Ring für immer im Beton"},{"what":"Die Bewehrung auf ihren Abstandhaltern","why":"das ist der einzige Moment, in dem sich die Lage überhaupt belegen lässt"},{"what":"Alle Leerrohre und Durchführungen, mit einem Zollstock im Bild","why":"die Maße brauchst du beim Ausbau wieder"}]'::jsonb,
  true, 'Was hier falsch liegt, lässt sich nach dem Betonieren nicht mehr korrigieren, sondern nur noch reparieren. Erdung, Bewehrungslage und Durchführungen sind an genau einem Tag prüfbar, und dieser Tag liegt vor dem Betonieren. Baubegleiter setzen ihren ersten Termin üblicherweise genau hier.',
  '[{"reference":"DIN 18014","note":"Fundamenterder: Planung, Ausführung und Dokumentation"},{"reference":"DIN EN 13670 zusammen mit DIN 1045-3","note":"Ausführung von Tragwerken aus Beton, darunter Betondeckung, Verdichtung und Nachbehandlung"},{"reference":"DIN 18202","note":"Toleranzen im Hochbau, Ebenheit von Rohdecken"},{"reference":"VOB/C ATV DIN 18331","note":"Betonarbeiten, sofern die VOB/B vereinbart ist"}]'::jsonb,
  now()
)
on conflict (id) do nothing;

-- Dachstuhl, Eindeckung und Klempnerarbeiten (dachstuhl, Fassung 1)
insert into guide_card (
  id, key, version, phase_key, trade_code, template_task_codes, title,
  whats_happening, watch_for, questions_for_contractor, common_problems,
  photo_prompts, expert_recommended, expert_reason, sources, published_at
) values (
  'bb659d72-a79d-5b4f-bd25-c5ff50e1f8cf', 'dachstuhl', 1, 'dach_huelle',
  'zimmerer', array['t16', 't17']::text[], 'Dachstuhl, Eindeckung und Klempnerarbeiten',
  'Der Zimmerer stellt den Dachstuhl auf, danach deckt der Dachdecker das Dach ein und der Klempner baut Rinnen, Fallrohre und die Anschlüsse an Kamin und Durchdringungen ein. Zwischen beiden Schritten liegt die Unterdeckung — die wasserführende Schicht unter den Ziegeln.

Mit dem letzten Ziegel ist das Haus von oben dicht. Bis dahin ist alles darunter wetterabhängig.',
  '[{"text":"Das Holz ist trocken und trägt eine Kennzeichnung","why":"feucht eingebautes Bauholz arbeitet nach und reißt"},{"text":"Die Unterdeckbahn ist an allen Stößen und an den Rändern verklebt","why":"sie ist die zweite wasserführende Ebene und nicht nur eine Folie"},{"text":"Die Anschlüsse an Kamin, Dachfenster und Lüftungsrohre sind sauber ausgeführt","why":"dort tritt Wasser zuerst ein"},{"text":"Die Lüftungsquerschnitte an Traufe und First sind offen","why":"ein Dach ohne Hinterlüftung trocknet nicht ab"},{"text":"Rinnen und Fallrohre haben Gefälle und enden in einem Anschluss, der abgenommen ist","why":"Wasser, das am Haus versickert, landet an der Kellerwand"}]'::jsonb,
  '[{"question":"Welche Dachneigung hat das Dach, und liegt sie über der Regeldachneigung der eingebauten Deckung?","whyItMatters":"liegt sie darunter, sind Zusatzmaßnahmen zwingend"},{"question":"Welche Unterdeckung wird eingebaut, und in welcher Ausführungsklasse?","whyItMatters":"davon hängt ab, wie lange das Dach ohne Ziegel dicht ist"},{"question":"Wie sind die Sparren am Ringanker verankert?","whyItMatters":"die Verankerung nimmt die Windsogkräfte auf"},{"question":"Wann kommt der Blitzschutz, falls einer vorgesehen ist?","whyItMatters":"er wird an den Fundamenterder angeschlossen, und der liegt seit der Bodenplatte"}]'::jsonb,
  '[{"problem":"Die Unterdeckung ist nur lose verlegt statt verklebt","howToSpot":"bei Schlagregen mit Wind läuft Wasser über die Stöße hinein"},{"problem":"Anschlüsse an Durchdringungen sind mit Dichtmasse statt handwerklich ausgeführt","howToSpot":"die Masse reißt nach ein bis zwei Jahren"},{"problem":"Die Lüftungsquerschnitte sind mit Dämmung zugestopft","howToSpot":"die Folge zeigt sich Jahre später als Feuchteschaden am Sparren"},{"problem":"Fallrohre enden im Kiesbett statt in einer Leitung","howToSpot":"das Wasser läuft genau dort ins Erdreich, wo der Keller steht"}]'::jsonb,
  '[{"what":"Der offene Dachstuhl mit allen Verbindungen und Verankerungen, vor der Eindeckung","why":"danach ist die Konstruktion verdeckt"},{"what":"Die fertige Unterdeckung mit allen verklebten Stößen","why":"sie verschwindet unter der Lattung"},{"what":"Die Anschlüsse an Kamin und Dachfenster aus der Nähe","why":"es sind die Stellen mit dem höchsten Schadensrisiko"}]'::jsonb,
  false, null,
  '[{"reference":"Fachregeln des Deutschen Dachdeckerhandwerks (ZVDH)","note":"Regeldachneigung, Unterdeckung und Anschlüsse"},{"reference":"DIN 68800","note":"Holzschutz, mit den Anforderungen an Holzfeuchte und baulichen Holzschutz"},{"reference":"DIN 4108-3","note":"Klimabedingter Feuchteschutz, Anforderungen an belüftete Dachkonstruktionen"},{"reference":"VOB/C ATV DIN 18334 und DIN 18338","note":"Zimmer- und Holzbauarbeiten sowie Dachdeckungsarbeiten, sofern die VOB/B vereinbart ist"}]'::jsonb,
  now()
)
on conflict (id) do nothing;

-- Estrich und Belegreife (estrich, Fassung 1)
insert into guide_card (
  id, key, version, phase_key, trade_code, template_task_codes, title,
  whats_happening, watch_for, questions_for_contractor, common_problems,
  photo_prompts, expert_recommended, expert_reason, sources, published_at
) values (
  '7200363d-8e6e-5729-948f-80ddb5954449', 'estrich', 1, 'ausbau',
  'estrich', array['t26', 't27']::text[], 'Estrich und Belegreife',
  'Auf die Rohdecke kommen Dämmung, Folie und darauf der Estrich — die Schicht, die später den Bodenbelag trägt. Danach folgt die Trocknung bis zur Belegreife: dem Zustand, in dem der Estrich trocken genug ist, dass ein Belag darauf verlegt werden darf.

Diese Trocknung ist Wartezeit, keine Pufferzeit. Sie steht als eigener Vorgang in deinem Plan und lässt sich nicht verkürzen, indem jemand schneller arbeitet.',
  '[{"text":"Ringsum an allen Wänden steht ein Randdämmstreifen, auch an Türzargen und Rohren","why":"ohne ihn überträgt der Estrich Trittschall in die Wände"},{"text":"Die Aufbauhöhe passt zum Belag, den du ausgesucht hast","why":"Fliesen und Parkett bauen unterschiedlich hoch, und die Türen sind schon bestellt"},{"text":"Die Bewegungsfugen liegen nach Plan, insbesondere in Türdurchgängen","why":"ein Estrich ohne Fugenplan reißt an der ungünstigsten Stelle von selbst"},{"text":"Bei Fußbodenheizung wird das vorgeschriebene Aufheizprogramm gefahren und protokolliert","why":"ohne dieses Protokoll verweigert mancher Bodenleger die Verlegung"},{"text":"Die Belegreife wird gemessen und nicht geschätzt","why":"die Messung ist eine Zahl auf einem Protokoll, kein Blick auf den Boden"}]'::jsonb,
  '[{"question":"Welcher Estrich wird eingebaut, und welche Aufbauhöhe hat er?","whyItMatters":"Zement- und Calciumsulfatestrich trocknen unterschiedlich lang und vertragen unterschiedlich viel Feuchte"},{"question":"Wann wird die Belegreife gemessen, mit welchem Verfahren und wer bekommt das Protokoll?","whyItMatters":"üblich ist die CM-Messung, und der Grenzwert hängt von Estrichart und Fußbodenheizung ab"},{"question":"Gibt es einen Fugenplan, und wo liegen die Fugen?","whyItMatters":"die Lage der Fugen bestimmt später das Verlegebild"},{"question":"Wie wird während der Trocknung gelüftet und geheizt?","whyItMatters":"falsches Lüften in den ersten Tagen führt zu Rissen"}]'::jsonb,
  '[{"problem":"Zu früh belegt, weil der Termin drängte","howToSpot":"der Belag wirft Wellen oder löst sich, und die Ursache ist erst nach dem Herausreißen sichtbar"},{"problem":"Der Randdämmstreifen wird zu früh abgeschnitten oder fehlt hinter Zargen","howToSpot":"es entstehen Schallbrücken, die man hört und nicht mehr beheben kann"},{"problem":"Die Aufbauhöhe passt nicht zum Belag","howToSpot":"Türen schleifen oder es entsteht eine Stufe zum Nachbarraum"},{"problem":"Das Aufheizprotokoll fehlt","howToSpot":"der Bodenleger legt nicht los, und der Termin verschiebt sich um Wochen"}]'::jsonb,
  '[{"what":"Die verlegte Dämmung mit allen Leitungen darin, vor dem Estrich","why":"danach weiß niemand mehr, wo etwas liegt"},{"what":"Die Heizkreise der Fußbodenheizung, raumweise","why":"beim späteren Bohren in den Boden ist das der einzige Anhaltspunkt"},{"what":"Der Randdämmstreifen an den Wänden","why":"er verschwindet unter Sockelleiste und Belag"}]'::jsonb,
  false, null,
  '[{"reference":"DIN 18560-1 und -2","note":"Estriche im Bauwesen, unter anderem Estriche auf Dämmschichten"},{"reference":"Schnittstellenkoordination der Verbände von Estrich-, Fliesen- und Parkettgewerk","note":"Belegreife und CM-Messung"},{"reference":"DIN 18202","note":"Toleranzen im Hochbau, Ebenheit von Bodenflächen"},{"reference":"VOB/C ATV DIN 18353","note":"Estricharbeiten, sofern die VOB/B vereinbart ist"}]'::jsonb,
  now()
)
on conflict (id) do nothing;

-- Fenstereinbau und Anschlussdichtung (fenster, Fassung 1)
insert into guide_card (
  id, key, version, phase_key, trade_code, template_task_codes, title,
  whats_happening, watch_for, questions_for_contractor, common_problems,
  photo_prompts, expert_recommended, expert_reason, sources, published_at
) values (
  'e33fb3d7-774e-55e4-a791-5f3d9f46b02d', 'fenster', 1, 'dach_huelle',
  'fensterbau', array['t18']::text[], 'Fenstereinbau und Anschlussdichtung',
  'Fenster und Haustür werden eingebaut, ausgerichtet, befestigt und ringsum an das Mauerwerk angeschlossen. Der Anschluss besteht aus drei Schichten: innen luftdicht, in der Mitte gedämmt, außen schlagregendicht und dampfdurchlässig.

Der Grundsatz dahinter lautet innen dichter als außen. So kann Feuchte, die doch in die Fuge gelangt, nach außen wieder heraus.',
  '[{"text":"Die Fenster sind mechanisch befestigt, nicht nur eingeschäumt","why":"Bauschaum ist Dämmung und kein Befestigungsmittel"},{"text":"Innen läuft ein durchgehendes dichtes Band um jedes Fenster","why":"dieses Band entscheidet später über das Ergebnis des Luftdichtheitstests"},{"text":"Außen ist die Fuge abgedeckt oder mit einem dafür vorgesehenen Band geschlossen","why":"offener Schaum zerfällt unter Sonnenlicht innerhalb weniger Jahre"},{"text":"Die Fensterbänke haben Gefälle nach außen und seitliche Abschlüsse","why":"ohne sie läuft Wasser in die Laibung"},{"text":"Alle Flügel schließen gleichmäßig, und ein Blatt Papier klemmt ringsum gleich stark","why":"das ist die einfachste Prüfung der Anpressung, die du selbst machen kannst"}]'::jsonb,
  '[{"question":"Wird nach dem RAL-Leitfaden montiert, und wer stellt das sicher?","whyItMatters":"er ist der anerkannte Stand für Montage und Anschluss"},{"question":"Welche Werte haben Glas und Rahmen, und stimmen sie mit dem Wärmeschutznachweis überein?","whyItMatters":"die Werte stehen im Lieferschein und im Nachweis, beide müssen zusammenpassen"},{"question":"Wie wird der Anschluss an die spätere Luftdichtheitsebene hergestellt?","whyItMatters":"der Putz oder die Folie muss an das Fensterband anschließen, sonst hängt das Band im Nichts"},{"question":"Wann kommt der Blower-Door-Vorabtest?","whyItMatters":"er sollte stattfinden, solange die Anschlüsse noch zugänglich sind"}]'::jsonb,
  '[{"problem":"Fenster nur eingeschäumt","howToSpot":"sie setzen sich, und die Flügel schleifen nach einigen Monaten"},{"problem":"Das innere Dichtband fehlt oder ist unterbrochen","howToSpot":"im Luftdichtheitstest zieht es spürbar an den Laibungen"},{"problem":"Die Fensterbank ist ohne seitlichen Abschluss eingebaut","howToSpot":"an der Laibung darunter zeigen sich nach dem ersten Winter Wasserspuren"},{"problem":"Die Schutzfolie bleibt wochenlang in der Sonne kleben","howToSpot":"sie lässt sich danach nur mit Aufwand und Kratzern entfernen"}]'::jsonb,
  '[{"what":"Jede Fensterfuge innen mit dem umlaufenden Dichtband, vor dem Innenputz","why":"danach ist sie unter Putz"},{"what":"Die Befestigungspunkte in der Laibung","why":"sie belegen, dass mechanisch befestigt wurde"},{"what":"Die Anschlüsse der Fensterbänke außen, seitlich und unten","why":"dort entstehen die typischen Wasserschäden"}]'::jsonb,
  false, null,
  '[{"reference":"Leitfaden zur Montage der RAL-Gütegemeinschaft Fenster, Fassaden und Haustüren","note":"anerkannter Stand für Befestigung und Anschluss"},{"reference":"DIN 4108-7","note":"Luftdichtheit von Gebäuden, Planungs- und Ausführungsempfehlungen"},{"reference":"DIN 18202","note":"Toleranzen im Hochbau, maßgeblich für Öffnungs- und Einbaumaße"}]'::jsonb,
  now()
)
on conflict (id) do nothing;

-- Fliesenarbeiten und Abdichtung im Bad (fliesen, Fassung 1)
insert into guide_card (
  id, key, version, phase_key, trade_code, template_task_codes, title,
  whats_happening, watch_for, questions_for_contractor, common_problems,
  photo_prompts, expert_recommended, expert_reason, sources, published_at
) values (
  '077346f7-fd56-5df0-801b-ae9b61d89000', 'fliesen', 1, 'endausbau',
  'fliesen', array['t28']::text[], 'Fliesenarbeiten und Abdichtung im Bad',
  'Vor der ersten Fliese kommt im Bad die Abdichtung im Verbund — eine flüssig aufgetragene Schicht unter den Fliesen, die verhindert, dass Wasser in Wand und Boden zieht. Erst danach wird geklebt, verfugt und versiegelt.

Fliesen sind der häufigste Grund für Terminverschiebungen im Innenausbau, weil ihre Lieferzeit regelmäßig unterschätzt wird.',
  '[{"text":"Im Duschbereich und um die Wanne ist eine Verbundabdichtung aufgebracht, meist farbig erkennbar","why":"Fliesen und Fugen allein sind nicht wasserdicht"},{"text":"An Ecken, Übergängen und Durchführungen liegen Dichtbänder und Manschetten ein","why":"dort versagt eine Abdichtung zuerst"},{"text":"Die Fliesen liegen im vollen Kleberbett, besonders am Boden","why":"hohl liegende Fliesen klingen beim Klopfen dumpf und brechen unter Belastung"},{"text":"Bewegungsfugen des Estrichs werden in der Fliesenebene übernommen","why":"sonst reißt die Fliese über der Fuge"},{"text":"In Ecken und an Anschlüssen sitzt elastisches Material statt Mörtelfuge","why":"starre Fugen in bewegten Ecken reißen im ersten Jahr"}]'::jsonb,
  '[{"question":"Nach welcher Wassereinwirkungsklasse wird das Bad abgedichtet?","whyItMatters":"DIN 18534 unterscheidet die Beanspruchung, und eine bodengleiche Dusche liegt höher als ein Spritzbereich am Waschtisch"},{"question":"Wann muss ich die Fliesen spätestens ausgesucht und bestellt haben?","whyItMatters":"die Lieferzeit ist der häufigste Verzugsgrund in dieser Bauphase"},{"question":"Wie sieht der Verlegeplan aus, und wo landen die Schnitte?","whyItMatters":"der Plan bestimmt, ob am Ende ein Streifen von zwei Zentimetern in der Sichtachse liegt"},{"question":"Wird die Abdichtung vor dem Fliesen abgenommen oder dokumentiert?","whyItMatters":"danach ist sie unsichtbar"}]'::jsonb,
  '[{"problem":"Die Abdichtung fehlt oder ist unvollständig, besonders an Rohrdurchführungen","howToSpot":"der Schaden zeigt sich Jahre später an der Wand des Nebenraums"},{"problem":"Hohlliegende Fliesen","howToSpot":"sie klingen beim Abklopfen dumpf, und einzelne brechen bei Belastung"},{"problem":"Bewegungsfugen werden überfliest","howToSpot":"es entsteht ein Riss quer durch die Fläche"},{"problem":"Die Fliesen kommen zu spät, weil zu spät ausgesucht wurde","howToSpot":"der ganze Endausbau schiebt sich nach hinten"}]'::jsonb,
  '[{"what":"Die fertige Abdichtung im ganzen Nassbereich, vor der ersten Fliese","why":"sie ist danach dauerhaft verdeckt"},{"what":"Die Dichtbänder in Ecken und an allen Durchführungen","why":"genau diese Stellen sind später strittig"},{"what":"Die Wand mit den Anschlüssen und Maßen, bevor sie verfliest wird","why":"für spätere Bohrungen"}]'::jsonb,
  false, null,
  '[{"reference":"DIN 18534","note":"Abdichtung von Innenräumen, mit den Wassereinwirkungsklassen W0-I bis W3-I"},{"reference":"DIN 18157","note":"Ausführung keramischer Bekleidungen im Dünnbettverfahren"},{"reference":"DIN 18202","note":"Toleranzen im Hochbau, Ebenheit der Untergründe"},{"reference":"VOB/C ATV DIN 18352","note":"Fliesen- und Plattenarbeiten, sofern die VOB/B vereinbart ist"}]'::jsonb,
  now()
)
on conflict (id) do nothing;

-- Innenputz (innenputz, Fassung 1)
insert into guide_card (
  id, key, version, phase_key, trade_code, template_task_codes, title,
  whats_happening, watch_for, questions_for_contractor, common_problems,
  photo_prompts, expert_recommended, expert_reason, sources, published_at
) values (
  '08ae080d-36a5-521c-9a5d-2c0c87cfae8a', 'innenputz', 1, 'ausbau',
  'putzer', array['t24']::text[], 'Innenputz',
  'Die Wände bekommen ihren Putz. Er gleicht das Mauerwerk aus, bildet den Untergrund für Farbe und Fliesen und ist zugleich ein Teil der Luftdichtheitsebene: Auf Mauerwerk ist es der Putz, der die Wand dicht macht, nicht der Stein.

Mit dem Putz kommt viel Wasser ins Haus. Das muss wieder heraus, bevor der Estrich folgt.',
  '[{"text":"Der Putz läuft hinter Steckdosen und an Anschlüssen durch, wo die Luftdichtheit es verlangt","why":"an dieser Stelle entscheidet sich der spätere Messwert"},{"text":"An Übergängen zwischen verschiedenen Untergründen liegt Gewebe ein","why":"sonst reißt der Putz genau auf dieser Linie"},{"text":"Es wird gelüftet und bei Bedarf beheizt","why":"nasser Putz in einem geschlossenen Haus führt zu Schimmel an den kältesten Stellen"},{"text":"Kanten und Laibungen sind gerade und mit Profilen ausgeführt","why":"krumme Laibungen sieht man später bei Streiflicht in jedem Raum"},{"text":"Die vereinbarte Oberflächenqualität ist vorher festgelegt","why":"für glatte Farbanstriche und Streiflicht braucht es eine höhere Stufe als für Raufaser"}]'::jsonb,
  '[{"question":"Welche Oberflächenqualität ist vereinbart?","whyItMatters":"die Stufen Q1 bis Q4 unterscheiden sich deutlich in Aufwand und Ergebnis"},{"question":"Wie wird die Luftdichtheit an Steckdosen, Durchführungen und Anschlüssen sichergestellt?","whyItMatters":"der Putz ist hier das dichtende Bauteil"},{"question":"Wie lange muss der Putz trocknen, bevor der Estrich kommt?","whyItMatters":"beide bringen Wasser ein, und die Trocknungszeiten addieren sich"},{"question":"Wer sorgt fürs Lüften und Heizen in der Trocknungsphase?","whyItMatters":"ohne klare Zuständigkeit macht es niemand"}]'::jsonb,
  '[{"problem":"Zu schnelles Trocknen durch Heizlüfter direkt an der Wand","howToSpot":"der Putz reißt netzartig auf"},{"problem":"Zu langsames Trocknen ohne Lüften","howToSpot":"an Fensterlaibungen und Außenecken bildet sich Schimmel"},{"problem":"Fehlendes Gewebe an Materialübergängen","howToSpot":"nach einigen Monaten zeigt sich ein durchgehender Riss auf der Trennlinie"},{"problem":"Die Oberflächenqualität wurde nie vereinbart","howToSpot":"beim Streichen fällt auf, dass beide Seiten etwas anderes gemeint haben"}]'::jsonb,
  '[{"what":"Die Wände unmittelbar vor dem Putz, mit allen Leitungen und Dosen","why":"das ist die letzte Gelegenheit"},{"what":"Die Anschlüsse an Fenster und Decken nach dem Putzen","why":"sie zeigen, wie die Luftdichtheitsebene geschlossen wurde"},{"what":"Feuchte Stellen oder Verfärbungen während der Trocknung","why":"falls es später um Schimmel geht, ist der Verlauf belegt"}]'::jsonb,
  false, null,
  '[{"reference":"DIN 18550-1 und -2","note":"Planung, Zubereitung und Ausführung von Außen- und Innenputzen"},{"reference":"DIN 18202","note":"Toleranzen im Hochbau, Ebenheit von Wandflächen"},{"reference":"Merkblätter der deutschen Gipsindustrie zu Oberflächenqualitäten","note":"die Stufen Q1 bis Q4"},{"reference":"VOB/C ATV DIN 18350","note":"Putz- und Stuckarbeiten, sofern die VOB/B vereinbart ist"}]'::jsonb,
  now()
)
on conflict (id) do nothing;

-- Kellerabdichtung, Perimeterdämmung und Drainage (kellerabdichtung, Fassung 1)
insert into guide_card (
  id, key, version, phase_key, trade_code, template_task_codes, title,
  whats_happening, watch_for, questions_for_contractor, common_problems,
  photo_prompts, expert_recommended, expert_reason, sources, published_at
) values (
  'd72e2f6e-3f84-5d59-80e8-c95458077ee3', 'kellerabdichtung', 1, 'gruendung',
  'rohbau', array['t10']::text[], 'Kellerabdichtung, Perimeterdämmung und Drainage',
  'Die Kelleraußenwände bekommen ihre Abdichtung gegen Wasser aus dem Erdreich, darauf die Perimeterdämmung — die Dämmschicht, die außen auf der Wand liegt und im Erdreich bleibt. Wo es die Bodenverhältnisse verlangen, kommt eine Drainage dazu, die Sickerwasser vom Haus wegführt.

Welche Abdichtung richtig ist, hängt davon ab, wie das Wasser am Haus ansteht. Das steht im Baugrundgutachten, nicht im Ermessen des Ausführenden.',
  '[{"text":"Der Untergrund ist trocken, staubfrei und ohne Grate, bevor abgedichtet wird","why":"auf einer nicht vorbereiteten Wand hält keine Abdichtung"},{"text":"Die Kehle zwischen Bodenplatte und Wand ist ausgerundet und mit abgedichtet","why":"genau dort steht Wasser am längsten"},{"text":"Jede Durchführung für Wasser, Strom oder Kabel ist einzeln abgedichtet","why":"Rohre sind der häufigste Weg, auf dem Wasser doch hineinkommt"},{"text":"Die Abdichtung reicht bis über die spätere Geländehöhe hinauf","why":"wo sie zu früh endet, läuft Wasser dahinter"},{"text":"Die Drainage liegt mit Gefälle, im Filterkies und mit Spülschächten an den Ecken","why":"eine Drainage, die man nicht spülen kann, ist nach wenigen Jahren zu"}]'::jsonb,
  '[{"question":"Welche Wassereinwirkungsklasse nach DIN 18533 liegt dem Aufbau zugrunde?","whyItMatters":"sie entscheidet über die gesamte Bauart, und sie ergibt sich aus dem Baugrundgutachten"},{"question":"Welches Abdichtungssystem wird eingebaut, und in wie vielen Lagen?","whyItMatters":"die Anzahl der Lagen und die Trockenschichtdicke sind Teil des Systems und nicht verhandelbar"},{"question":"Wann wird verfüllt, und womit?","whyItMatters":"zu frühes Verfüllen und scharfkantiges Material beschädigen die frische Abdichtung"},{"question":"Braucht dieses Grundstück überhaupt eine Drainage?","whyItMatters":"eine Drainage ist bei drückendem Wasser kein Ersatz für die richtige Abdichtung"}]'::jsonb,
  '[{"problem":"Die Abdichtung wird zu dünn aufgetragen","howToSpot":"sichtbar wird es nur an der Verbrauchsmenge und an Messstellen in der frischen Schicht"},{"problem":"Zu früh verfüllt","howToSpot":"die Dämmplatten verrutschen, und an den Stößen entstehen Wege für Wasser"},{"problem":"Verfüllt wird mit dem Aushub statt mit Material, das Wasser durchlässt","howToSpot":"dann steht das Wasser im Arbeitsraum wie in einer Wanne"},{"problem":"Die Drainage wird ohne Gefälle oder ohne Filterschicht verlegt","howToSpot":"sie schlämmt zu und wirkt genau dann nicht mehr, wenn es lange regnet"}]'::jsonb,
  '[{"what":"Die fertige Abdichtung an der ganzen Wand, vor der Dämmung","why":"danach ist sie dauerhaft verdeckt"},{"what":"Jede einzelne Durchführung im abgedichteten Zustand","why":"das sind die Stellen, an denen später gestritten wird"},{"what":"Die verlegte Drainage mit Kiesbett und Schächten, vor dem Verfüllen","why":"später sieht man nur noch die Deckel"}]'::jsonb,
  true, 'Ein feuchter Keller ist der teuerste Mangel am ganzen Haus, weil er sich nur von außen beheben lässt — und dazu muss das Erdreich wieder weg. Ob die Abdichtung zur Wassereinwirkungsklasse passt und ob sie vollständig ist, lässt sich an genau einem Tag beurteilen: vor dem Verfüllen des Arbeitsraums.',
  '[{"reference":"DIN 18533","note":"Abdichtung von erdberührten Bauteilen, mit den Wassereinwirkungsklassen W1-E bis W4-E"},{"reference":"DIN 4095","note":"Dränung zum Schutz baulicher Anlagen"},{"reference":"DIN 4020","note":"Geotechnische Untersuchungen für bautechnische Zwecke, Grundlage des Baugrundgutachtens"},{"reference":"VOB/C ATV DIN 18336","note":"Abdichtungsarbeiten, sofern die VOB/B vereinbart ist"}]'::jsonb,
  now()
)
on conflict (id) do nothing;

-- Mauerwerk, Decken und Ringanker (rohbau-mauerwerk, Fassung 1)
insert into guide_card (
  id, key, version, phase_key, trade_code, template_task_codes, title,
  whats_happening, watch_for, questions_for_contractor, common_problems,
  photo_prompts, expert_recommended, expert_reason, sources, published_at
) values (
  'f1667c91-9cf0-53e5-a626-fce644c3ddfc', 'rohbau-mauerwerk', 1, 'rohbau',
  'rohbau', array['t12', 't14']::text[], 'Mauerwerk, Decken und Ringanker',
  'Die Außen- und Innenwände werden gemauert, die Geschossdecken eingebaut und der Ringanker hergestellt — ein umlaufendes Band aus Stahlbeton, das die Wände zusammenhält. Fenster- und Türöffnungen entstehen jetzt in genau der Größe, die später bestellt wird.

Ab hier wird das Haus zum ersten Mal begehbar, und die Räume bekommen ihre wirklichen Maße.',
  '[{"text":"Die Öffnungen für Fenster und Türen stimmen mit dem Plan überein","why":"nach dem Aufmaß werden die Fenster gefertigt, und eine falsche Öffnung merkt man erst bei der Montage"},{"text":"Die Steine werden mit vollen Fugen versetzt","why":"offene Stoßfugen sind Wege für Luft und damit für Wärmeverlust"},{"text":"Bei Regen werden angefangene Wände abgedeckt","why":"durchnässtes Mauerwerk trocknet monatelang und bringt die Feuchte in den Innenputz mit"},{"text":"Stürze über Öffnungen liegen mit dem vorgeschriebenen Auflager auf","why":"zu kurze Auflager reißen die Wand über der Öffnung"},{"text":"Die Wände stehen lotrecht und die Räume haben die Maße aus dem Plan","why":"Abweichungen summieren sich bis in die Küchenplanung"}]'::jsonb,
  '[{"question":"Wann wird das Aufmaß für die Fenster genommen, und wer macht es?","whyItMatters":"ab diesem Termin lassen sich Öffnungsmaße nicht mehr ändern"},{"question":"Welcher Stein mit welchem Wärmedurchgangswert ist eingebaut worden?","whyItMatters":"der Wert steht im Wärmeschutznachweis und bestimmt die Heizlast"},{"question":"Wie werden die Wärmebrücken an Ringanker, Rollladenkästen und Decken behandelt?","whyItMatters":"das sind die Stellen, an denen später Schimmel entsteht"},{"question":"Bleibt der Rohbau vor Regen geschützt, solange er offen ist?","whyItMatters":"Baufeuchte verzögert alles Folgende, vom Putz bis zum Estrich"}]'::jsonb,
  '[{"problem":"Öffnungsmaße weichen vom Plan ab","howToSpot":"es fällt bei der Fenstermontage auf, und dann ist Nacharbeit am Mauerwerk nötig"},{"problem":"Nicht vermörtelte Stoßfugen","howToSpot":"im späteren Luftdichtheitstest zeigt sich ein deutlich zu hoher Wert, ohne dass eine einzelne Stelle sichtbar wäre"},{"problem":"Der Rohbau steht über Wochen offen im Regen","howToSpot":"feuchte Wände, verzögerte Trocknungszeiten und im schlimmsten Fall Schimmel unter dem Putz"},{"problem":"Leitungsschlitze werden nachträglich zu tief gefräst","howToSpot":"die tragende Wand verliert Querschnitt, was in der Statik nicht vorgesehen war"}]'::jsonb,
  '[{"what":"Jede Wand mit ihren Öffnungen, raumweise und mit Maßband","why":"das ist die Grundlage jeder späteren Diskussion über Raumgrößen"},{"what":"Die Auflager der Decken und Stürze, bevor sie verputzt werden","why":"sie sind später vollständig verdeckt"},{"what":"Die Wände nach einem Regentag","why":"falls es später um Baufeuchte geht, ist der Zustand belegt"}]'::jsonb,
  false, null,
  '[{"reference":"DIN EN 1996 mit nationalem Anhang, Eurocode 6","note":"Bemessung und Ausführung von Mauerwerksbauten"},{"reference":"DIN 18202","note":"Toleranzen im Hochbau, unter anderem Winkel- und Ebenheitstoleranzen von Wänden"},{"reference":"DIN 4108","note":"Wärmeschutz im Hochbau, mit den Anforderungen an Wärmebrücken"},{"reference":"VOB/C ATV DIN 18330","note":"Mauerarbeiten, sofern die VOB/B vereinbart ist"}]'::jsonb,
  now()
)
on conflict (id) do nothing;

-- Rohinstallation Elektro (rohinstallation-elektro, Fassung 1)
insert into guide_card (
  id, key, version, phase_key, trade_code, template_task_codes, title,
  whats_happening, watch_for, questions_for_contractor, common_problems,
  photo_prompts, expert_recommended, expert_reason, sources, published_at
) values (
  '6e1e4465-dbc5-5316-84ee-3b335596ce40', 'rohinstallation-elektro', 1, 'rohinstallation',
  'elektro', array['t20']::text[], 'Rohinstallation Elektro',
  'Der Elektriker schlitzt die Wände, setzt Dosen und zieht alle Leitungen bis zum Verteiler. Verkabelt und angeschlossen wird später; jetzt entsteht die Struktur, an der zehn Jahre lang nichts mehr geändert wird.

Das ist der Vorgang, bei dem deine Entscheidungen unmittelbar sichtbar werden: Jede Steckdose, die jetzt fehlt, fehlt dauerhaft oder wird zum Nachtrag.',
  '[{"text":"Geh vor dem Schlitzen mit dem Elektriker durch jeden Raum und stell dir die Möbel vor","why":"hinter dem Schrank ist eine Steckdose wertlos"},{"text":"Die Leitungen laufen in den vorgesehenen Installationszonen","why":"nur dort kann später jemand gefahrlos in die Wand bohren"},{"text":"In Bad und Dusche werden die Schutzbereiche eingehalten","why":"sie sind vorgeschrieben und keine Frage des Geschmacks"},{"text":"Leerrohre für Netzwerk, Außenbeleuchtung, Ladepunkt und Beschattung sind gelegt, auch wenn du sie noch nicht brauchst","why":"ein Leerrohr kostet jetzt fast nichts und später eine Wandsanierung"},{"text":"Der Verteiler hat Platz für Reserve","why":"mit jeder späteren Erweiterung wird ein zu kleiner Verteiler zum eigenen Umbau"}]'::jsonb,
  '[{"question":"Wann ist der Termin, an dem wir gemeinsam die Positionen festlegen?","whyItMatters":"nach diesem Termin ist jede Änderung ein Nachtrag"},{"question":"Nach welcher Mindestausstattung wird geplant?","whyItMatters":"DIN 18015-2 nennt Mindestzahlen je Raum, und viele Angebote liegen darunter"},{"question":"In welchen Zonen werden die Leitungen geführt, und bekomme ich einen Bestandsplan?","whyItMatters":"ohne Plan bohrst du später auf gut Glück"},{"question":"Sind Rauchwarnmelder, Netzwerkdosen und Anschlüsse für Wallbox und Photovoltaik berücksichtigt?","whyItMatters":"nachträglich sind das alles Stemmarbeiten"}]'::jsonb,
  '[{"problem":"Zu wenige Steckdosen, weil nach Mindestausstattung kalkuliert wurde","howToSpot":"es fällt beim Einzug auf, wenn Mehrfachsteckdosen die Lösung sind"},{"problem":"Leitungen laufen quer durch die Wand statt in den Zonen","howToSpot":"der erste Bohrer im Bild an der Wand trifft sie"},{"problem":"Der Bestandsplan fehlt oder wird nie übergeben","howToSpot":"später weiß niemand, wo etwas liegt"},{"problem":"Dosen sitzen auf unterschiedlichen Höhen","howToSpot":"sichtbar wird es erst nach dem Streichen, korrigierbar ist es dann nicht mehr"}]'::jsonb,
  '[{"what":"Jede Wand mit allen Schlitzen und Dosen, raumweise, mit Zollstock im Bild","why":"nach dem Putz ist die Leitungsführung unsichtbar"},{"what":"Die Decken mit den Auslässen für Leuchten und Meldern","why":"auch sie verschwinden unter Putz"},{"what":"Der offene Verteilerplatz mit den ankommenden Leitungen","why":"das ist die Grundlage jeder späteren Erweiterung"}]'::jsonb,
  false, null,
  '[{"reference":"DIN 18015-1 bis -3","note":"Elektrische Anlagen in Wohngebäuden: Planungsgrundlagen, Mindestausstattung und Installationszonen"},{"reference":"DIN VDE 0100-410","note":"Schutzmaßnahmen gegen elektrischen Schlag"},{"reference":"DIN VDE 0100-701","note":"Räume mit Badewanne oder Dusche, mit den Schutzbereichen"},{"reference":"VOB/C ATV DIN 18382","note":"Elektrische Kabel- und Leitungsanlagen, sofern die VOB/B vereinbart ist"}]'::jsonb,
  now()
)
on conflict (id) do nothing;

-- Rohinstallation Sanitär und Heizung (rohinstallation-shk, Fassung 1)
insert into guide_card (
  id, key, version, phase_key, trade_code, template_task_codes, title,
  whats_happening, watch_for, questions_for_contractor, common_problems,
  photo_prompts, expert_recommended, expert_reason, sources, published_at
) values (
  '5fe1935a-3ba6-576c-ad47-8b3d9d650757', 'rohinstallation-shk', 1, 'rohinstallation',
  'shk', array['t21']::text[], 'Rohinstallation Sanitär und Heizung',
  'Alle Leitungen für Trinkwasser, Abwasser und Heizung werden verlegt, Vorwandinstallationen gestellt und die Anschlusspunkte für Wanne, Dusche, Waschtisch und Küche festgelegt. Danach wird die Anlage auf Dichtheit geprüft und protokolliert.

Wo die Anschlüsse sitzen, entscheidet über die Möblierung des Bades. Verschieben lässt sich das nur, solange die Wand offen ist.',
  '[{"text":"Die Positionen von Wanne, Dusche, WC und Waschtisch sind angezeichnet und du hast sie im Raum gesehen","why":"auf dem Plan wirkt jedes Bad größer"},{"text":"Rohre sind gedämmt, und zwar Warmwasser gegen Wärmeverlust und Kaltwasser gegen Schwitzwasser","why":"ungedämmte Kaltwasserleitungen tropfen im Estrich"},{"text":"Leitungen sind körperschallentkoppelt befestigt","why":"starr befestigte Abwasserrohre hört man im ganzen Haus"},{"text":"Das Abwasser hat durchgehend Gefälle","why":"zu geringes Gefälle führt zu Ablagerungen und regelmäßigen Verstopfungen"},{"text":"Die Dichtheitsprüfung wird durchgeführt und protokolliert, bevor irgendetwas verschlossen wird","why":"das Protokoll ist dein Beleg"}]'::jsonb,
  '[{"question":"Wann findet die Dichtheitsprüfung statt, und bekomme ich das Protokoll?","whyItMatters":"nach dem Verschließen der Wände ist eine Leckage eine Bauteilöffnung"},{"question":"Wie wird die Trinkwasserinstallation bis zur Inbetriebnahme behandelt?","whyItMatters":"stehendes Wasser in einer neuen Leitung ist ein Hygienethema, deshalb wird sie entweder gespült oder trocken belassen"},{"question":"Wie ist der Schallschutz der Abwasserleitungen an Wänden zu Schlaf- und Wohnräumen gelöst?","whyItMatters":"Schallschutz ist nachträglich kaum zu verbessern"},{"question":"Passt die Vorwand zu den Objekten, die ich ausgesucht habe?","whyItMatters":"Vorwandhöhe und Anschlussmaße hängen am konkreten Modell"}]'::jsonb,
  '[{"problem":"Anschlüsse sitzen so, dass die gewünschten Objekte nicht passen","howToSpot":"es fällt bei der Endmontage auf, wenn die Fliesen längst liegen"},{"problem":"Kaltwasserleitungen ungedämmt im Estrich","howToSpot":"an der Decke darunter zeigen sich Feuchtestellen, ohne dass ein Rohr undicht wäre"},{"problem":"Starr befestigte Fallleitungen","howToSpot":"im Schlafzimmer nebenan ist jede Spülung zu hören"},{"problem":"Die Dichtheitsprüfung wird mündlich bestätigt, aber nie protokolliert","howToSpot":"im Schadensfall gibt es nichts vorzulegen"}]'::jsonb,
  '[{"what":"Jede Wand mit allen Leitungen und Anschlusspunkten, mit Zollstock im Bild","why":"hier bohrst du später für Spiegel und Handtuchhalter"},{"what":"Die Vorwandinstallationen mit den Befestigungen","why":"sie sind nach dem Beplanken vollständig verdeckt"},{"what":"Das Manometer bei der Dichtheitsprüfung mit dem angezeigten Druck","why":"ein Foto ist kein Ersatz für das Protokoll, aber es ergänzt es"}]'::jsonb,
  true, 'Dies ist der Termin, den Baubegleiter als Rohinstallationsprüfung vor der Verkleidung setzen — er umfasst Elektro und Sanitär zugleich. Sobald Putz, Trockenbau und Estrich darüber sind, kostet jede Korrektur ein Vielfaches, und Fehler an wasserführenden Leitungen in Wand und Boden zeigen sich oft erst nach Jahren.',
  '[{"reference":"DIN EN 806 und DIN 1988-200","note":"Trinkwasser-Installationen, Planung und Ausführung"},{"reference":"VDI/DVGW 6023","note":"Hygiene in Trinkwasser-Installationen"},{"reference":"DIN 1986-100","note":"Entwässerungsanlagen für Gebäude und Grundstücke"},{"reference":"DIN 4109","note":"Schallschutz im Hochbau, mit den Anforderungen an haustechnische Anlagen"}]'::jsonb,
  now()
)
on conflict (id) do nothing;
