/**
 * Entscheidungsvorlagen aus Abschnitt 7.3 der Spezifikation.
 *
 * Wie die Ablaufvorlage ist diese Datei die **Erstbefüllung**, nicht die
 * Laufzeitquelle: `packages/db` erzeugt daraus eine Migration, und ab dann ist
 * die Datenbank die Autorität (Regel 5).
 *
 * Warum hier und nicht als Markdown in `content/`, wie die Lotsenkarten: Eine
 * Lotsenkarte ist Fließtext mit Quellenarbeit, eine Entscheidungsvorlage ist
 * ein Datensatz mit vier kurzen Feldern. Vierzehn winzige Markdown-Dateien
 * wären schlechter zu überblicken als eine Tabelle, und einen zweiten Parser
 * bräuchte es auch noch.
 *
 * Die Entscheidungshilfe hat drei feste Teile statt eines Fließtextes. Die
 * Spezifikation nennt in Abschnitt 3.2 genau drei Fragen — worum es geht, was
 * die Optionen unterscheidet, was man später bereut —, und ein einzelnes
 * Textfeld verleitet dazu, keine davon zu beantworten.
 *
 * **Keine Produktempfehlungen, keine Marken, keine Affiliate-Links.** Das
 * würde die Neutralität zerstören, die das ganze Produkt trägt.
 */

import type { DurationUnit } from '../types.js';

export interface DecisionHelp {
  /** Worum es überhaupt geht, in einem Satz für Laien. */
  whatItIsAbout: string;
  /** Was die Möglichkeiten voneinander unterscheidet. */
  whatDistinguishes: string;
  /** Was Bauherren an dieser Stelle später bereuen. */
  whatPeopleRegret: string;
}

export interface DecisionTemplate {
  key: string;
  title: string;
  /** Vorgang aus der Ablaufvorlage, der ohne diese Entscheidung nicht beginnen kann. */
  blocksTaskCode: string;
  /** Vorlaufzeit vor dem Beginn des blockierten Vorgangs. */
  leadTimeDays: number;
  leadTimeUnit: DurationUnit;
  /** Warum die Vorlaufzeit so lang ist. Steht in der Spalte „Grund" von 7.3. */
  reason: string;
  description: string;
  help: DecisionHelp;
  sortOrder: number;
}

const ROWS: readonly Omit<DecisionTemplate, 'sortOrder' | 'leadTimeUnit'>[] = [
  {
    key: 'versicherungen',
    title: 'Bauherrenhaftpflicht und Bauleistungsversicherung',
    blocksTaskCode: 't03',
    leadTimeDays: 10,
    reason: 'Beides muss stehen, bevor die erste Maschine anrückt.',
    description:
      'Zwei Versicherungen für die Bauzeit: eine für Schäden, die von deiner Baustelle ausgehen, und eine für Schäden am Bau selbst.',
    help: {
      whatItIsAbout:
        'Als Bauherr haftest du für das, was auf deinem Grundstück passiert, auch ohne eigenes Verschulden. Die Bauleistungsversicherung deckt dagegen Schäden am entstehenden Gebäude, etwa durch Sturm, Diebstahl oder Vandalismus.',
      whatDistinguishes:
        'Der Umfang und die Ausschlüsse. Prüfe, ob Eigenleistung, Helfer, Erdarbeiten und die Bauzeitverlängerung mitversichert sind. Manche Verträge des Generalunternehmers enthalten die Bauleistungsversicherung bereits.',
      whatPeopleRegret:
        'Zu spät abgeschlossen. Ein Sturmschaden am offenen Rohbau kostet fünfstellig, und der Vertrag muss vor dem Ereignis bestanden haben.',
    },
  },
  {
    key: 'bauhelfer_bg_bau',
    title: 'Bauhelfer bei der BG Bau anmelden',
    blocksTaskCode: 't03',
    leadTimeDays: 5,
    reason: 'Gesetzliche Pflicht, sobald jemand unentgeltlich mithilft.',
    description:
      'Wer beim Bau mithilft, ist gesetzlich unfallversichert. Die Anmeldung bei der Berufsgenossenschaft ist deine Aufgabe, nicht die der Helfer.',
    help: {
      whatItIsAbout:
        'Jede helfende Hand auf deiner Baustelle ist über die BG Bau unfallversichert, auch Freunde und Verwandte. Du musst das Bauvorhaben und die geleisteten Stunden melden.',
      whatDistinguishes:
        'Nichts, das ist keine Wahl. Die Frage ist nur, ob du Eigenleistung planst und wie viele Stunden es werden.',
      whatPeopleRegret:
        'Gar nicht angemeldet. Passiert etwas, steht ein Bußgeld im Raum, und der Versicherungsschutz für den Verletzten ist die kleinere Sorge.',
    },
  },
  {
    key: 'dachziegel',
    title: 'Dachziegel: Modell und Farbe',
    blocksTaskCode: 't17',
    leadTimeDays: 20,
    reason: 'Lieferzeit; einzelne Modelle und Farben sind saisonal knapp.',
    description:
      'Material, Form und Farbe der Dacheindeckung. Die Wahl bindet sich an die Dachneigung und häufig an Vorgaben aus dem Bebauungsplan.',
    help: {
      whatItIsAbout:
        'Die Eindeckung ist die sichtbarste Fläche deines Hauses und die, an die vierzig Jahre lang niemand mehr herankommt.',
      whatDistinguishes:
        'Material und Oberfläche. Tonziegel, Betonstein und Schiefer unterscheiden sich in Gewicht, Preis und Mindestneigung. Engobierte und glasierte Oberflächen bleiben länger sauber als unbehandelte.',
      whatPeopleRegret:
        'Die Farbe nach einem Musterstück in der Hand ausgesucht statt an einer bezogenen Fläche im Freien. Auf dem Dach wirkt sie anders.',
    },
  },
  {
    key: 'fassade',
    title: 'Fassade: Putz oder Klinker, Farbton',
    blocksTaskCode: 't17',
    leadTimeDays: 25,
    reason: 'Bestimmt die Gerüststandzeit und damit den Ablauf am Bau.',
    description:
      'Wie die Außenwand aussieht und aus was sie besteht. Die Entscheidung wirkt auf Kosten, Pflegeaufwand und den Bauablauf.',
    help: {
      whatItIsAbout:
        'Die äußere Schicht der Außenwand. Sie schützt die Dämmung und bestimmt, wie oft du in zwanzig Jahren ein Gerüst brauchst.',
      whatDistinguishes:
        'Putz ist günstiger und in jedem Farbton möglich, muss aber irgendwann gestrichen werden. Klinker kostet deutlich mehr, hält dafür ohne Anstrich und braucht mehr Wandstärke.',
      whatPeopleRegret:
        'Einen sehr hellen oder sehr dunklen Farbton gewählt. Hell zeigt jeden Ablauf unter der Fensterbank, dunkel heizt sich auf und bleicht aus.',
    },
  },
  {
    key: 'fenster',
    title: 'Fenster: Farbe, Verglasung, Rollladen, Griffe',
    blocksTaskCode: 't18',
    leadTimeDays: 60,
    reason: 'Fenster werden auf Maß gefertigt; die Lieferzeit ist die längste im Bau.',
    description:
      'Rahmenmaterial, Farbe innen und außen, Glasaufbau, Beschläge, Rollläden und Einbruchhemmung. Die längste Vorlaufzeit im ganzen Ablauf.',
    help: {
      whatItIsAbout:
        'Fenster sind Maßanfertigungen. Ab der Bestellung vergehen Wochen bis Monate, und in dieser Zeit ändert sich nichts mehr daran.',
      whatDistinguishes:
        'Rahmenmaterial und Glasaufbau. Kunststoff, Holz und Aluminium unterscheiden sich in Pflege, Preis und Lebensdauer. Beim Glas entscheidet der Aufbau über Wärmeschutz, Schallschutz und Sonnenschutz. Bei der Einbruchhemmung ist RC2 der übliche Standard für Wohnhäuser.',
      whatPeopleRegret:
        'Am Sonnenschutz gespart und an der Einbruchhemmung. Beides lässt sich nachrüsten, kostet dann aber ein Vielfaches der Mehrkosten beim Einbau.',
    },
  },
  {
    key: 'elektroplanung',
    title: 'Elektroplanung: Steckdosen, Schalter, Netzwerk',
    blocksTaskCode: 't20',
    leadTimeDays: 15,
    reason: 'Nach dem Schlitzen ist jede Änderung ein Nachtrag.',
    description:
      'Wo Steckdosen, Schalter, Leuchtenauslässe und Netzwerkdosen sitzen, und welche Leerrohre für später eingezogen werden.',
    help: {
      whatItIsAbout:
        'Der Plan, nach dem der Elektriker die Wände schlitzt. Was darin nicht steht, sitzt später nicht in der Wand.',
      whatDistinguishes:
        'Vor allem die Anzahl. Die übliche Ausstattung ist ein Mindestmaß, kein Vorschlag für dein Leben. Geh mit den geplanten Möbeln durch jeden Raum.',
      whatPeopleRegret:
        'Zu wenige Steckdosen neben dem Bett, in der Küche und am Arbeitsplatz. Und fehlende Leerrohre für Photovoltaik, Wallbox und Außensteckdose.',
    },
  },
  {
    key: 'kuechenplanung',
    title: 'Küchenplanung mit Anschlusspunkten',
    blocksTaskCode: 't20',
    leadTimeDays: 20,
    reason: 'Starkstrom, Wasser und Abluft müssen vor der Rohinstallation feststehen.',
    description:
      'Der Küchengrundriss mit allen Anschlüssen: Strom, Starkstrom, Wasser, Abwasser, Abluft oder Umluft.',
    help: {
      whatItIsAbout:
        'Nicht die Fronten und nicht die Arbeitsplatte, sondern wo Geräte und Spüle stehen. Danach richten sich die Leitungen.',
      whatDistinguishes:
        'Vor allem Kochfeld und Dunstabzug. Ein Induktionsfeld braucht Starkstrom, eine Abluftanlage einen Mauerdurchbruch nach außen, eine Umluftanlage nicht.',
      whatPeopleRegret:
        'Die Küche erst nach der Rohinstallation geplant. Dann liegt der Wasseranschluss zwei Meter neben der Spüle, und die Steckdose für den Backofen an der falschen Wand.',
    },
  },
  {
    key: 'heizsystem',
    title: 'Heizsystem und Wärmepumpe final',
    blocksTaskCode: 't21',
    leadTimeDays: 40,
    reason: 'Lieferzeit der Geräte und Fristen im Förderantrag.',
    description:
      'Welcher Wärmeerzeuger eingebaut wird, wie er ausgelegt ist und ob eine Förderung beantragt wird.',
    help: {
      whatItIsAbout:
        'Die Anlage, die dein Haus die nächsten zwanzig Jahre heizt, und die Grundlage für den Förderantrag.',
      whatDistinguishes:
        'Die Wärmequelle und die Auslegung. Luft und Erdreich unterscheiden sich in Erschließungskosten und Jahresarbeitszahl. Wichtiger als das Fabrikat ist, dass die Auslegung auf einer Heizlastberechnung beruht und nicht auf einer Faustformel.',
      whatPeopleRegret:
        'Eine zu groß ausgelegte Anlage. Sie taktet, verschleißt schneller und verbraucht mehr als eine passend gerechnete.',
    },
  },
  {
    key: 'sanitaerobjekte',
    title: 'Sanitärobjekte und Vorwandpositionen',
    blocksTaskCode: 't21',
    leadTimeDays: 20,
    reason: 'Die Position der Objekte bestimmt die Rohinstallation.',
    description:
      'Welche Objekte in Bad und Gäste-WC kommen und wo genau sie hängen. Die Höhen entscheiden über zehn Jahre Nutzung.',
    help: {
      whatItIsAbout:
        'Nicht die Armaturen, sondern die Positionen. Wo das WC hängt, wo die Dusche anfängt, auf welcher Höhe das Waschbecken sitzt.',
      whatDistinguishes:
        'Bodengleiche Dusche oder Wanne, Wandhängend oder stehend, Unterputz- oder Aufputzarmatur. Unterputz sieht ruhiger aus und ist im Wartungsfall aufwendiger.',
      whatPeopleRegret:
        'Standardhöhen übernommen, ohne sich davorzustellen. Ein Waschbecken auf 85 cm ist für 1,60 m und 1,95 m nicht dasselbe.',
    },
  },
  {
    key: 'bodenbelag',
    title: 'Bodenbelag und Aufbauhöhe',
    blocksTaskCode: 't26',
    leadTimeDays: 15,
    reason: 'Die Aufbauhöhe bestimmt die Dicke des Estrichs.',
    description:
      'Welcher Belag in welchen Raum kommt. Aus der Aufbauhöhe ergibt sich, wie dick der Estrich eingebracht wird.',
    help: {
      whatItIsAbout:
        'Jeder Belag braucht unterschiedlich viel Platz. Der Estrich wird darauf abgestimmt und ist danach nicht mehr zu ändern.',
      whatDistinguishes:
        'Aufbauhöhe, Wärmeleitfähigkeit und Pflege. Fliesen leiten die Fußbodenheizung am besten, Parkett fühlt sich wärmer an, Vinyl ist unempfindlich und dünn.',
      whatPeopleRegret:
        'Die Entscheidung dem Estrichleger überlassen. Passt die Aufbauhöhe nicht, schleifen später die Türen oder es entsteht eine Schwelle.',
    },
  },
  {
    key: 'fliesen',
    title: 'Fliesen: Auswahl und Verlegemuster',
    blocksTaskCode: 't28',
    leadTimeDays: 40,
    reason: 'Lieferzeit. Der häufigste Grund für Verzug im Innenausbau.',
    description:
      'Format, Farbe, Oberfläche und Verlegemuster für Bad, Gäste-WC und gegebenenfalls weitere Räume.',
    help: {
      whatItIsAbout:
        'Die Fliesen und die Art, wie sie liegen. Beides muss vor dem Beginn der Fliesenarbeiten geliefert und geprüft sein.',
      whatDistinguishes:
        'Format und Oberfläche. Große Formate wirken ruhiger und brauchen einen ebeneren Untergrund. Bei der Rutschhemmung gilt: In der bodengleichen Dusche ist eine matte Oberfläche kein Nachteil.',
      whatPeopleRegret:
        'Zu spät ausgesucht. Bei Fliesen sind acht Wochen Lieferzeit nichts Ungewöhnliches, und eine Nachbestellung aus einer anderen Charge weicht im Farbton ab.',
    },
  },
  {
    key: 'innentueren',
    title: 'Innentüren: Modell, Zargen, Beschläge',
    blocksTaskCode: 't29',
    leadTimeDays: 50,
    reason: 'Lange Lieferzeiten, besonders bei abweichenden Maßen.',
    description:
      'Türblätter, Zargen, Bänder und Drücker. Bei Sondermaßen und Sonderfarben verlängert sich die Lieferzeit deutlich.',
    help: {
      whatItIsAbout:
        'Alle Innentüren zusammen. Sie werden als Satz bestellt und auf die fertige Wandstärke abgestimmt.',
      whatDistinguishes:
        'Oberfläche und Aufbau. Röhrenspan ist leicht und günstig, Vollspan schwerer und leiser. Für Bad und Hauswirtschaftsraum lohnt der Blick auf die Feuchtebeständigkeit.',
      whatPeopleRegret:
        'Die Türhöhe nicht mitgedacht. Durchgehende Türen bis zur Decke wirken großzügig, sind aber ein Sondermaß mit eigener Lieferzeit.',
    },
  },
  {
    key: 'treppe',
    title: 'Treppe: Material und Geländer',
    blocksTaskCode: 't32',
    leadTimeDays: 50,
    reason: 'Aufmaß erst nach dem Rohbau möglich, danach Fertigung.',
    description:
      'Material, Bauart und Geländer der Innentreppe. Das Aufmaß erfolgt am fertigen Rohbau, die Fertigung dauert Wochen.',
    help: {
      whatItIsAbout:
        'Die Treppe wird für dein Haus gebaut, nicht gekauft. Zwischen Aufmaß und Einbau liegen mehrere Wochen.',
      whatDistinguishes:
        'Bauart und Material. Eine aufgesattelte Holztreppe, eine Betontreppe mit Belag und eine Faltwerktreppe unterscheiden sich in Preis, Schallübertragung und Platzbedarf.',
      whatPeopleRegret:
        'Den Schallschutz übersehen. Eine Treppe, die im Schlafzimmer darunter zu hören ist, lässt sich nachträglich kaum entkoppeln.',
    },
  },
  {
    key: 'aussenanlagen',
    title: 'Außenanlagen: Zufahrt, Terrasse, Zaun',
    blocksTaskCode: 't35',
    leadTimeDays: 25,
    reason: 'Materialbestellung und Abstimmung mit der Entwässerung.',
    description: 'Zufahrt, Wege, Terrasse, Einfriedung und wohin das Regenwasser läuft.',
    help: {
      whatItIsAbout:
        'Alles außerhalb des Hauses. Häufig der Posten, der im Budget zuletzt drankommt und dann fehlt.',
      whatDistinguishes:
        'Versickerungsfähig oder versiegelt. Manche Gemeinden koppeln die Niederschlagswassergebühr an die versiegelte Fläche, und der Bebauungsplan kann Vorgaben machen.',
      whatPeopleRegret:
        'Leerrohre für Außenbeleuchtung, Tor und Gartensteckdose nicht mit eingegraben. Danach ist die Zufahrt gepflastert.',
    },
  },
];

export const DECISION_TEMPLATES: readonly DecisionTemplate[] = ROWS.map((row, index) => ({
  ...row,
  leadTimeUnit: 'werktage' as const,
  sortOrder: (index + 1) * 10,
}));
