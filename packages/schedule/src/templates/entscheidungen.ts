/**
 * Entscheidungsvorlagen aus Abschnitt 7.3 der Spezifikation.
 *
 * Wie die Ablaufvorlage ist das hier die **Erstbefüllung**, nicht die
 * Laufzeitquelle: Zur Laufzeit liest die Anwendung `decision_template` aus der
 * Datenbank. Aus dieser Datei erzeugt `packages/db` die Migration.
 *
 * Jede Vorlage trägt drei Texte, und die Unterscheidung ist wichtig:
 *
 * - `title` — worum es geht, in drei Wörtern
 * - `description` — warum diese Entscheidung an diesem Vorgang hängt
 * - `helpText` — die Entscheidungshilfe: was die Optionen unterscheidet und
 *   was man später bereut. Ohne sie ist eine Frist nur eine Mahnung.
 *
 * Keine Produktempfehlungen, keine Marken, keine Bezugsquellen. Das würde die
 * Neutralität zerstören, die das ganze Produkt trägt (Abschnitt 3.2).
 */

import type { DurationUnit } from '../types.js';

export interface DecisionTemplate {
  key: string;
  title: string;
  description: string;
  helpText: string;
  /** Vorgang der Ablaufvorlage, der ohne diese Entscheidung nicht laufen kann. */
  blocksTaskCode: string;
  leadTimeDays: number;
  leadTimeUnit: DurationUnit;
  sortOrder: number;
}

/**
 * Die vierzehn Entscheidungen aus 7.3, in der Reihenfolge, in der sie im Bau
 * anstehen — nicht in der Reihenfolge ihrer Vorlaufzeit. Wer die Liste liest,
 * soll seinen Bau darin wiedererkennen.
 */
export const DECISION_TEMPLATES: readonly DecisionTemplate[] = [
  {
    key: 'versicherungen',
    title: 'Bauherrenhaftpflicht und Bauleistungsversicherung',
    description:
      'Beides muss stehen, bevor die erste Maschine auf das Grundstück fährt. Danach ist es zu spät.',
    helpText:
      'Die Bauherrenhaftpflicht deckt Schäden, die von deiner Baustelle ausgehen — ein Passant stürzt in die offene Baugrube, ein Ziegel trifft ein Auto. Als Bauherr haftest du dafür, auch wenn ein Unternehmen gearbeitet hat. Die Bauleistungsversicherung deckt Schäden am Bau selbst, etwa durch Sturm, Vandalismus oder Diebstahl fest eingebauter Teile. Was du später bereust: einen Schaden in den ersten Wochen, weil die Policen erst zum Richtfest abgeschlossen wurden.',
    blocksTaskCode: 't03',
    leadTimeDays: 10,
    leadTimeUnit: 'werktage',
    sortOrder: 10,
  },
  {
    key: 'bauhelfer-bg-bau',
    title: 'Bauhelfer bei der BG Bau anmelden',
    description:
      'Wer auf deiner Baustelle unentgeltlich mithilft, ist gesetzlich unfallversichert — und muss gemeldet sein.',
    helpText:
      'Sobald Freunde oder Verwandte mit anpacken, bist du Unternehmer im Sinne der gesetzlichen Unfallversicherung. Die Anmeldung bei der Berufsgenossenschaft der Bauwirtschaft ist Pflicht und kostet wenig; ein nicht gemeldeter Helfer, dem etwas passiert, kostet sehr viel. Gemeldet wird vor dem ersten Einsatz, nicht danach. Auch reine Eigenleistung ohne Helfer wird angezeigt.',
    blocksTaskCode: 't03',
    leadTimeDays: 5,
    leadTimeUnit: 'werktage',
    sortOrder: 20,
  },
  {
    key: 'dachziegel',
    title: 'Dachziegel: Modell und Farbe',
    description: 'Die Eindeckung wird bestellt, sobald der Dachstuhl steht.',
    helpText:
      'Form und Material bestimmen, welche Dachneigung zulässig ist und wie viel Gewicht der Dachstuhl trägt — beides ist mit der Statik verknüpft und keine reine Geschmacksfrage. Bei der Farbe entscheidet vor allem der Ort: Manche Bebauungspläne schreiben Farbtöne vor. Was du später bereust: eine Sonderfarbe mit langer Lieferzeit, die den ganzen Ausbau schiebt, weil das Haus bis dahin nicht dicht ist.',
    blocksTaskCode: 't17',
    leadTimeDays: 20,
    leadTimeUnit: 'werktage',
    sortOrder: 30,
  },
  {
    key: 'fassade',
    title: 'Fassade: Putz oder Klinker, Farbton',
    description: 'Die Wahl bestimmt, wie lange das Gerüst steht — und was es kostet.',
    helpText:
      'Putz ist günstiger und in jeder Farbe zu haben, muss aber alle paar Jahrzehnte erneuert werden. Klinker kostet deutlich mehr, hält dafür ohne Pflege. Beides beeinflusst die Gerüststandzeit, und Gerüst wird nach Zeit berechnet. Prüf den Bebauungsplan, bevor du dich festlegst: Farbton und Material sind dort häufig vorgegeben. Was du später bereust: einen sehr dunklen Ton auf gedämmter Fassade — er heizt sich auf und arbeitet stärker.',
    blocksTaskCode: 't17',
    leadTimeDays: 25,
    leadTimeUnit: 'werktage',
    sortOrder: 40,
  },
  {
    key: 'fenster',
    title: 'Fenster: Farbe, Verglasung, Rollladen, Griffe',
    description:
      'Fenster werden für dein Haus gefertigt. Zwischen Bestellung und Einbau liegen Wochen.',
    helpText:
      'Drei Dinge entscheidest du hier gleichzeitig. Erstens die Verglasung: Zweifach oder Dreifach bestimmt den Wärmeschutz und muss zum Wärmeschutznachweis passen. Zweitens den Sonnenschutz: Rollladen, Raffstore oder nichts — nachträglich ist jeder Rollladenkasten ein Eingriff in die Wand. Drittens die Bedienung: abschließbare Griffe im Erdgeschoss, Fenstertüren mit oder ohne Schwelle. Was du später bereust: eine Sonderfarbe außen, die drei Wochen extra Lieferzeit kostet, und fehlende Verschattung nach Süden — die erste Hitzewelle beantwortet die Frage von selbst.',
    blocksTaskCode: 't18',
    leadTimeDays: 60,
    leadTimeUnit: 'werktage',
    sortOrder: 50,
  },
  {
    key: 'elektroplanung',
    title: 'Elektroplanung: Steckdosen, Schalter, Netzwerk',
    description:
      'Nach dem Schlitzen der Wände ist jede zusätzliche Dose ein Nachtrag mit Staub.',
    helpText:
      'Geh vor dem Termin mit dem Elektriker gedanklich durch jeden Raum und stell die Möbel auf: Wo steht das Bett, wo der Fernseher, wo der Schreibtisch. Eine Steckdose hinter dem Schrank ist verloren, eine fehlende neben dem Bett ärgert zehn Jahre lang. Denk an das, was du noch nicht hast: Leerrohre für Wallbox, Photovoltaik, Außenbeleuchtung und Netzwerk kosten jetzt fast nichts. Was du später bereust: nach Mindestausstattung geplant zu haben — sie ist ein Minimum, kein Vorschlag.',
    blocksTaskCode: 't20',
    leadTimeDays: 15,
    leadTimeUnit: 'werktage',
    sortOrder: 60,
  },
  {
    key: 'kueche',
    title: 'Küchenplanung mit Anschlusspunkten',
    description:
      'Starkstrom, Wasser und Abluft müssen liegen, bevor die Wände geschlossen werden.',
    helpText:
      'Die Küche wird zwar zuletzt geliefert, aber ihre Anschlüsse entstehen jetzt. Du brauchst dafür keine fertige Küche, sondern einen Plan mit Positionen: Herd, Spüle, Geschirrspüler, Kühlschrank, Dunstabzug. Kläre früh, ob abgesaugt oder umgeluftet wird — eine Außenwanddurchführung ist nachträglich eine Kernbohrung. Was du später bereust: eine Kücheninsel ohne Anschluss darunter, weil sie erst nach dem Estrich beschlossen wurde.',
    blocksTaskCode: 't20',
    leadTimeDays: 20,
    leadTimeUnit: 'werktage',
    sortOrder: 70,
  },
  {
    key: 'heizsystem',
    title: 'Heizsystem und Wärmepumpe final',
    description: 'Lieferzeit und Förderantrag brauchen beide Vorlauf, und zwar nacheinander.',
    helpText:
      'Die Wahl des Wärmeerzeugers hängt am Wärmeschutznachweis und an der Heizlast, nicht am Geschmack. Wichtig ist die Reihenfolge: Ein Förderantrag wird vor dem Auftrag gestellt, sonst entfällt die Förderung — nachträglich lässt sich das nicht heilen. Klär außerdem den Aufstellort und die Abstände zum Nachbargrundstück, denn Wärmepumpen erzeugen Geräusche und dafür gelten Grenzwerte. Was du später bereust: die Anlage bestellt zu haben, bevor der Antrag durch war.',
    blocksTaskCode: 't21',
    leadTimeDays: 40,
    leadTimeUnit: 'werktage',
    sortOrder: 80,
  },
  {
    key: 'sanitaerobjekte',
    title: 'Sanitärobjekte und Vorwandpositionen',
    description: 'Wo die Objekte hängen, entscheidet sich beim Stellen der Vorwand.',
    helpText:
      'Es geht nicht um Armaturen und Farben, sondern um Maße: Wandhängendes WC oder bodenstehend, Dusche bodengleich oder mit Wanne, Waschtisch als Möbel oder als Becken. Jede Variante hat andere Anschlusshöhen. Steh einmal im Rohbau im Bad und stell dir die Objekte vor — auf dem Plan wirkt jedes Bad größer als es ist. Was du später bereust: eine bodengleiche Dusche, die erst nach dem Estrich gewünscht wurde; die Bodenplatte gibt die Höhe dann nicht mehr her.',
    blocksTaskCode: 't21',
    leadTimeDays: 20,
    leadTimeUnit: 'werktage',
    sortOrder: 90,
  },
  {
    key: 'bodenbelag',
    title: 'Bodenbelag und Aufbauhöhe',
    description: 'Die Aufbauhöhe bestimmt den Estrich — und der kommt zuerst.',
    helpText:
      'Fliesen, Parkett und Vinyl bauen unterschiedlich hoch auf. Diese Höhe geht in die Estrichdicke ein, und die wiederum in die Höhe der Türen und der Übergänge zwischen den Räumen. Deshalb wird der Belag ausgewählt, bevor der Estrich eingebracht wird, auch wenn er erst Monate später verlegt wird. Was du später bereust: unterschiedliche Beläge in angrenzenden Räumen ohne geplanten Höhenausgleich — die Stufe im Türrahmen bleibt.',
    blocksTaskCode: 't26',
    leadTimeDays: 15,
    leadTimeUnit: 'werktage',
    sortOrder: 100,
  },
  {
    key: 'fliesen',
    title: 'Fliesen: Auswahl und Verlegemuster',
    description:
      'Der häufigste Grund für Verzug im Innenausbau. Fliesen sind Lagerware oder eben nicht.',
    helpText:
      'Entscheide früher, als es sich anfühlt: Zwischen Aussuchen und Verlegen liegen Bemusterung, Bestellung und Lieferung, und bei Sonderformaten sind das schnell zwei Monate. Neben der Fliese selbst gehören zwei Dinge dazu: das Verlegemuster, das bestimmt, wo die Schnitte landen, und die Fugenfarbe, die das Bild stärker verändert als die meisten erwarten. Was du später bereust: eine schmale Restreihe in der Sichtachse, weil kein Verlegeplan gemacht wurde.',
    blocksTaskCode: 't28',
    leadTimeDays: 40,
    leadTimeUnit: 'werktage',
    sortOrder: 110,
  },
  {
    key: 'innentueren',
    title: 'Innentüren: Modell, Zargen, Beschläge',
    description: 'Lange Lieferzeiten, und die Zargen brauchen das Maß aus dem Rohbau.',
    helpText:
      'Türblatt, Zarge und Beschlag werden zusammen bestellt und zusammen geliefert. Die Zargenbreite hängt an der fertigen Wandstärke, also an Putz und Estrichaufbau — deshalb wird nach dem Rohbau aufgemessen. Denk an die Details, die man erst im Alltag merkt: Türen, die in den Raum oder aus ihm heraus aufgehen, Lichtausschnitte in dunklen Fluren, Schwellen bei bodengleichen Übergängen. Was du später bereust: eine Standardhöhe, die nicht zur Deckenhöhe passt, oder fehlende Lüftungsspalte bei kontrollierter Wohnraumlüftung.',
    blocksTaskCode: 't29',
    leadTimeDays: 50,
    leadTimeUnit: 'werktage',
    sortOrder: 120,
  },
  {
    key: 'treppe',
    title: 'Treppe: Material und Geländer',
    description: 'Aufgemessen wird am Rohbau, gefertigt wird danach — beides braucht Zeit.',
    helpText:
      'Die Treppe ist ein Möbelstück und wird für deinen Rohbau gebaut. Material und Bauart bestimmen den Preis stärker als die Größe: Beton mit Belag, Holz eingestemmt oder eine freitragende Konstruktion sind drei verschiedene Welten. Beim Geländer gelten Vorschriften zu Höhe und Abstand, die nicht verhandelbar sind. Was du später bereust: eine offene Treppe ohne Setzstufen im Haus mit kleinen Kindern, und eine Wahl, die den Schallschutz nicht berücksichtigt — eine Holztreppe überträgt jeden Schritt.',
    blocksTaskCode: 't32',
    leadTimeDays: 50,
    leadTimeUnit: 'werktage',
    sortOrder: 130,
  },
  {
    key: 'aussenanlagen',
    title: 'Außenanlagen: Zufahrt, Terrasse, Zaun',
    description: 'Das Letzte am Bau, und regelmäßig das, wofür das Geld nicht mehr reicht.',
    helpText:
      'Plan die Außenanlagen früh, auch wenn sie zuletzt gebaut werden: Zufahrt, Stellplätze, Terrasse, Wege und Einfriedung summieren sich zu einem fünfstelligen Betrag, der in vielen Baubeschreibungen gar nicht enthalten ist. Kläre nebenbei zwei Dinge, die Vorlauf brauchen: die Entwässerung des Niederschlagswassers, für die es kommunale Vorgaben gibt, und Leerrohre für Außensteckdosen und Licht, solange der Graben noch offen ist. Was du später bereust: gepflastert zu haben, bevor die letzten schweren Fahrzeuge auf dem Grundstück waren.',
    blocksTaskCode: 't35',
    leadTimeDays: 25,
    leadTimeUnit: 'werktage',
    sortOrder: 140,
  },
];
