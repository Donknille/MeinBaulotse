/**
 * Entscheidungsvorlagen aus Abschnitt 7.3 der Spezifikation.
 *
 * Reine Daten, keine Logik. Sie wandern per Seed-Migration in
 * `decision_template` und sind ab dort ohne Deployment pflegbar; diese Datei
 * ist die Erstbefüllung, nicht die Autorität.
 *
 * `blocksTaskCode` verweist auf die Nummern der Ablaufvorlage in 7.2 — `t18`
 * ist Vorgang 18. Die Vorlaufzeit ist der Abstand zum **Beginn** dieses
 * Vorgangs; verschiebt sich der Vorgang, verschiebt sich die Frist mit.
 *
 * Der Hilfetext sagt, was die Optionen unterscheidet und was man später
 * bereut. Er nennt keine Hersteller und keine Produkte — die Neutralität ist
 * das, was das ganze Produkt trägt (Abschnitt 3.2).
 */

export interface DecisionTemplateSeed {
  key: string;
  title: string;
  description: string;
  helpText: string;
  blocksTaskCode: string;
  leadTimeDays: number;
  leadTimeUnit: 'werktage' | 'kalendertage';
  sortOrder: number;
}

export const DECISION_TEMPLATES: readonly DecisionTemplateSeed[] = [
  {
    key: 'versicherung',
    title: 'Bauherrenhaftpflicht und Bauleistungsversicherung',
    description: 'Beides muss stehen, bevor die erste Maschine anrückt.',
    helpText:
      'Die Bauherrenhaftpflicht deckt Schäden, die Dritten auf oder an deiner ' +
      'Baustelle entstehen. Die Bauleistungsversicherung deckt Schäden am Bau ' +
      'selbst, etwa durch Sturm, Diebstahl von fest eingebautem Material oder ' +
      'Vandalismus. Wer beides erst nach Baubeginn abschließt, hat für die Zeit ' +
      'davor keinen Schutz — und genau in dieser Zeit steht die Baugrube offen.',
    blocksTaskCode: 't03',
    leadTimeDays: 10,
    leadTimeUnit: 'werktage',
    sortOrder: 10,
  },
  {
    key: 'bg_bau',
    title: 'Bauhelfer bei der BG Bau anmelden',
    description: 'Pflicht, sobald jemand unentgeltlich mitarbeitet.',
    helpText:
      'Wer Verwandte oder Freunde auf der Baustelle mithelfen lässt, muss sie bei ' +
      'der Berufsgenossenschaft der Bauwirtschaft anmelden. Das gilt auch für ' +
      'Eigenleistung im kleinen Umfang und unabhängig davon, ob Geld fließt. Die ' +
      'Anmeldung ist kostenlos aufwendig, die Nichtanmeldung teuer: Bei einem ' +
      'Unfall haftest du sonst persönlich.',
    blocksTaskCode: 't03',
    leadTimeDays: 5,
    leadTimeUnit: 'werktage',
    sortOrder: 20,
  },
  {
    key: 'dachziegel',
    title: 'Dachziegel: Modell und Farbe',
    description: 'Bestimmt Optik, Gewicht und Lieferzeit der Eindeckung.',
    helpText:
      'Der Ziegel entscheidet über mehr als die Farbe: Gewicht und Format gehen in ' +
      'die Statik des Dachstuhls ein, und manche Gemeinden schreiben in der ' +
      'Gestaltungssatzung Farbtöne vor. Prüf das, bevor du dich verliebst. ' +
      'Sonderfarben und glasierte Oberflächen haben deutlich längere Lieferzeiten ' +
      'als das Standardsortiment.',
    blocksTaskCode: 't17',
    leadTimeDays: 20,
    leadTimeUnit: 'werktage',
    sortOrder: 30,
  },
  {
    key: 'fassade',
    title: 'Fassade: Putz oder Klinker, Farbton',
    description: 'Hängt am Gerüst — und das Gerüst kostet pro Woche.',
    helpText:
      'Putz ist günstiger und schneller, Klinker langlebiger und wartungsärmer. ' +
      'Die Entscheidung fällt früher, als man denkt: Klinker braucht ein anderes ' +
      'Fundamentmaß und eine andere Fensterlaibung. Was danach kommt, ist eine ' +
      'Änderung am Rohbau, nicht an der Fassade. Der Farbton lässt sich später ' +
      'noch verschieben, das Material nicht.',
    blocksTaskCode: 't17',
    leadTimeDays: 25,
    leadTimeUnit: 'werktage',
    sortOrder: 40,
  },
  {
    key: 'fenster',
    title: 'Fenster: Farbe, Verglasung, Rollladen, Griffe',
    description: 'Die Entscheidung mit der längsten Vorlaufzeit im ganzen Bau.',
    helpText:
      'Fenster werden auf Maß gefertigt; zwischen Freigabe und Lieferung liegen ' +
      'in der Regel mehrere Monate. Zu klären sind Rahmenfarbe innen und außen ' +
      '(zwei Farben kosten Aufpreis), Verglasung (zwei- oder dreifach, ' +
      'Schallschutz an der Straßenseite), Rollladen oder Raffstore samt ' +
      'Antrieb und Elektroanschluss, sowie abschließbare Griffe im Erdgeschoss. ' +
      'Der Rollladenantrieb ist der häufigste Nachtrag: Wer ihn zu spät bestellt, ' +
      'hat den Kabelweg schon zugeputzt.',
    blocksTaskCode: 't18',
    leadTimeDays: 60,
    leadTimeUnit: 'werktage',
    sortOrder: 50,
  },
  {
    key: 'elektroplanung',
    title: 'Elektroplanung: Steckdosen, Schalter, Netzwerk',
    description: 'Danach ist jede Änderung ein Nachtrag und eine Stemmarbeit.',
    helpText:
      'Geh mit dem Elektriker Raum für Raum durch und markier jede Dose an der ' +
      'Wand. Denk an Netzwerkdosen statt reinem WLAN, an Außensteckdosen, an die ' +
      'Wallbox-Zuleitung in der Garage und an den Anschluss für Rollladen und ' +
      'Markise. Eine Dose zu viel kostet wenige Euro, eine Dose zu wenig kostet ' +
      'nach dem Innenputz einen Schlitz in der frisch verputzten Wand.',
    blocksTaskCode: 't20',
    leadTimeDays: 15,
    leadTimeUnit: 'werktage',
    sortOrder: 60,
  },
  {
    key: 'kueche',
    title: 'Küchenplanung mit Anschlusspunkten',
    description: 'Starkstrom, Wasser und Abluft müssen vor dem Innenputz stehen.',
    helpText:
      'Für die Rohinstallation zählt nicht die Küchenfront, sondern wo Herd, ' +
      'Spüle, Geschirrspüler, Kühlschrank und Dunstabzug stehen. Dafür brauchst ' +
      'du keinen unterschriebenen Küchenvertrag, aber einen maßstäblichen Plan. ' +
      'Kläre früh, ob die Dunstabzugshaube nach außen führt — der Mauerdurchbruch ' +
      'gehört in den Rohbau, nicht in die fertige Fassade.',
    blocksTaskCode: 't20',
    leadTimeDays: 20,
    leadTimeUnit: 'werktage',
    sortOrder: 70,
  },
  {
    key: 'heizsystem',
    title: 'Heizsystem und Wärmepumpe final',
    description: 'Lieferzeit und Förderantrag laufen parallel und beide brauchen Vorlauf.',
    helpText:
      'Die Wahl des Wärmeerzeugers bestimmt die Rohinstallation: Eine ' +
      'Wärmepumpe braucht Platz für Außen- und Innenteil, Kondensatablauf und ' +
      'einen eigenen Zählerplatz. Förderanträge sind in der Regel **vor** ' +
      'Auftragsvergabe zu stellen; wer zuerst beauftragt und dann beantragt, ' +
      'verliert den Anspruch. Prüf die aktuellen Bedingungen beim Fördergeber, ' +
      'sie ändern sich häufiger als der Rest deines Bauvorhabens.',
    blocksTaskCode: 't21',
    leadTimeDays: 40,
    leadTimeUnit: 'werktage',
    sortOrder: 80,
  },
  {
    key: 'sanitaer',
    title: 'Sanitärobjekte und Vorwandpositionen',
    description: 'Die Position bestimmt die Rohinstallation, nicht die Optik.',
    helpText:
      'Der Installateur braucht früh nicht das Waschbecken, sondern seine Höhe ' +
      'und seine Achse. Wandhängendes WC, bodengleiche Dusche und freistehende ' +
      'Wanne haben unterschiedliche Vorwandtiefen und Abläufe. Entscheide das ' +
      'gemeinsam mit dem Fliesenplan: Wer zuerst die Fliese wählt und dann die ' +
      'Ablaufposition, landet bei einer angeschnittenen Reihe vor der Dusche.',
    blocksTaskCode: 't21',
    leadTimeDays: 20,
    leadTimeUnit: 'werktage',
    sortOrder: 90,
  },
  {
    key: 'bodenbelag',
    title: 'Bodenbelag und Aufbauhöhe',
    description: 'Die Aufbauhöhe bestimmt den Estrich — und der kommt vorher.',
    helpText:
      'Parkett, Vinyl und Fliese bauen unterschiedlich hoch auf. Die Differenz ' +
      'muss im Estrich ausgeglichen werden, und der wird eingebaut, bevor der ' +
      'Belag geliefert ist. Steht die Entscheidung zu spät, passen später die ' +
      'Türblätter nicht mehr oder es entsteht eine Schwelle zwischen zwei ' +
      'Räumen. Leg dich mindestens auf die Aufbauhöhe fest, auch wenn das Dekor ' +
      'noch offen ist.',
    blocksTaskCode: 't26',
    leadTimeDays: 15,
    leadTimeUnit: 'werktage',
    sortOrder: 100,
  },
  {
    key: 'fliesen',
    title: 'Fliesen: Auswahl und Verlegemuster',
    description: 'Der häufigste Verzugsgrund im Innenausbau.',
    helpText:
      'Fliesen sind kein Lagerartikel, sobald das Format aus der Reihe fällt: ' +
      'Großformate, Feinsteinzeug in Sonderfarben und alles aus dem Ausland ' +
      'haben lange Lieferzeiten. Zur Auswahl gehört das Verlegemuster — es ' +
      'entscheidet über die Menge und damit über den Verschnitt. Bestell fünf ' +
      'bis zehn Prozent Reserve aus derselben Charge und heb sie auf; ' +
      'Nachbestellungen weichen im Farbton ab.',
    blocksTaskCode: 't28',
    leadTimeDays: 40,
    leadTimeUnit: 'werktage',
    sortOrder: 110,
  },
  {
    key: 'innentueren',
    title: 'Innentüren: Modell, Zargen, Beschläge',
    description: 'Lange Lieferzeiten, und das Maß hängt am Bodenaufbau.',
    helpText:
      'Türblatt, Zarge und Beschlag werden zusammen bestellt und auf die ' +
      'fertige Wandstärke und den fertigen Fußboden gefertigt. Deshalb muss der ' +
      'Bodenaufbau vorher feststehen. Klär auch, welche Türen stumpf einschlagend ' +
      'sein sollen und wo eine Schiebetür sinnvoller ist — eine Schiebetür ' +
      'verlangt eine Tasche in der Wand und gehört damit in den Trockenbau.',
    blocksTaskCode: 't29',
    leadTimeDays: 50,
    leadTimeUnit: 'werktage',
    sortOrder: 120,
  },
  {
    key: 'treppe',
    title: 'Treppe: Material und Geländer',
    description: 'Aufmaß erst nach dem Rohbau, danach beginnt die Fertigung.',
    helpText:
      'Die Treppe wird nach Aufmaß gefertigt, und aufgemessen wird erst am ' +
      'fertigen Rohbau. Zwischen Aufmaß und Einbau liegen mehrere Wochen. ' +
      'Entscheide vorher über Material, Stufenstärke und Geländerart — beim ' +
      'Geländer schreibt die Landesbauordnung Mindesthöhen und maximale ' +
      'Öffnungsweiten vor, gerade mit kleinen Kindern lohnt der frühe Blick in ' +
      'die für dich geltende Fassung.',
    blocksTaskCode: 't32',
    leadTimeDays: 50,
    leadTimeUnit: 'werktage',
    sortOrder: 130,
  },
  {
    key: 'aussenanlagen',
    title: 'Außenanlagen: Zufahrt, Terrasse, Zaun',
    description: 'Was hier fehlt, bleibt oft jahrelang eine Baustelle.',
    helpText:
      'Die Außenanlagen sind der Posten, an dem am Ende das Geld fehlt. Plan ' +
      'zumindest die Zufahrt und den Hauseingang von Anfang an mit, denn beide ' +
      'brauchen einen tragfähigen Unterbau, der vor der Pflasterung eingebaut ' +
      'wird. Leerrohre für Gartenstrom, Bewässerung und Torantrieb kosten jetzt ' +
      'fast nichts und später einen aufgerissenen Vorgarten.',
    blocksTaskCode: 't35',
    leadTimeDays: 25,
    leadTimeUnit: 'werktage',
    sortOrder: 140,
  },
];
