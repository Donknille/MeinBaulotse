/**
 * Die Leitplanken aus Abschnitt 3.7 — deterministisch, nicht erbeten.
 *
 * Die Spezifikation nennt sie „zwingend":
 *
 *   - Keine Rechtsberatung. Fragen mit rechtlichem Kern werden mit
 *     Gesetzesstelle plus Verweis auf anwaltliche Beratung beantwortet.
 *   - Keine bautechnische Mängelbeurteilung aus Fotos. Bei entsprechenden
 *     Fragen: Hinweis auf Bausachverständigen, mit Weiterleitung.
 *   - Keine Kostenschätzungen, die als verbindlich missverstanden werden
 *     können.
 *
 * Ein Systemprompt allein kann das nicht halten. Er bittet ein Modell um
 * Wohlverhalten, und ein Modell, das in neunundneunzig von hundert Fällen
 * folgt, hat im hundertsten trotzdem Rechtsberatung erteilt — an einen
 * Menschen, der gerade nicht weiß, ob er zwanzigtausend Euro zahlen muss.
 *
 * Deshalb steht hier eine zweite Schicht, die nichts erbittet: Sie erkennt
 * den Themenkern an der Frage, nicht an der Antwort, und hängt einen festen
 * Hinweis an, den kein Modell formuliert hat. Das Modell wird zusätzlich
 * angewiesen — beides zusammen, nicht eines statt des anderen.
 *
 * Die Hinweise sind Struktur, kein angehängter Text: Die Oberfläche setzt sie
 * abgesetzt, damit erkennbar bleibt, was das Produkt sagt und was das Modell.
 */

/** Welche Leitplanke gegriffen hat. Wird am Beitrag mitgeschrieben. */
export type Leitplanke = 'recht' | 'mangel' | 'kosten';

export interface Hinweis {
  readonly art: Leitplanke;
  readonly titel: string;
  readonly text: string;
  /** Nur bei `recht`: die Stelle, auf die der Hinweis zeigt. */
  readonly stelle?: string;
}

interface Rechtsthema {
  readonly schluessel: string;
  readonly woerter: readonly string[];
  readonly stelle: string;
  readonly inhalt: string;
}

/**
 * Rechtliche Themen mit ihrer Stelle.
 *
 * Bewusst eine Tabelle und kein Modellwissen: Was hier steht, ist nachlesbar
 * und ändert sich nur, wenn jemand es ändert. Eine Gesetzesstelle, die ein
 * Modell aus dem Gedächtnis nennt, ist im Zweifel eine, die es nicht gibt —
 * und die Erfindung fällt genau dem nicht auf, der sie braucht.
 *
 * Die Reihenfolge ist die Trefferreihenfolge: Das erste passende Thema
 * gewinnt, spezielle vor allgemeinen.
 */
export const RECHTSTHEMEN: readonly Rechtsthema[] = [
  {
    schluessel: 'abschlag',
    woerter: ['abschlag', 'abschläge', 'zahlungsplan', 'ratenplan', 'vorauszahlung', 'anzahlung'],
    stelle: '§ 650m Abs. 1 BGB',
    inhalt:
      'Beim Verbraucherbauvertrag dürfen Abschlagszahlungen zusammen 90 % der '
      + 'Gesamtvergütung einschließlich Nachträgen nicht übersteigen.',
  },
  {
    schluessel: 'sicherheit',
    woerter: ['sicherheit', 'bürgschaft', 'buergschaft', 'einbehalt', 'sicherheitsleistung'],
    stelle: '§ 650m Abs. 2 BGB',
    inhalt:
      'Bei der ersten Abschlagszahlung ist dem Verbraucher eine Sicherheit von 5 % der '
      + 'Gesamtvergütung für die rechtzeitige Herstellung ohne wesentliche Mängel zu leisten.',
  },
  {
    schluessel: 'abnahme',
    woerter: ['abnahme', 'abnehmen', 'abgenommen', 'abnahmeprotokoll'],
    stelle: '§ 640 BGB',
    inhalt:
      'Der Besteller ist zur Abnahme verpflichtet, sobald das Werk vertragsgemäß ist; wegen '
      + 'unwesentlicher Mängel darf er sie nicht verweigern. Nach fruchtlosem Ablauf einer '
      + 'gesetzten Frist gilt das Werk als abgenommen.',
  },
  {
    schluessel: 'maengelrechte',
    woerter: [
      'nacherfüllung', 'nacherfuellung', 'gewährleistung', 'gewaehrleistung', 'mängelrecht',
      'maengelrecht', 'verjährung', 'verjaehrung', 'minderung', 'selbstvornahme', 'nachbessern',
    ],
    stelle: '§ 634 BGB, § 634a Abs. 1 Nr. 2 BGB',
    inhalt:
      'Bei einem Mangel kann der Besteller Nacherfüllung verlangen, selbst nachbessern lassen, '
      + 'zurücktreten, mindern oder Schadensersatz verlangen. Bei Bauwerken verjähren diese '
      + 'Rechte in fünf Jahren ab Abnahme.',
  },
  {
    schluessel: 'verzug',
    woerter: ['verzug', 'vertragsstrafe', 'verspätung', 'verspaetung', 'zu spät fertig', 'termin überschritten'],
    stelle: '§ 286 BGB, § 280 Abs. 2 BGB',
    inhalt:
      'Verzug tritt nach Mahnung ein, bei einem kalendermäßig bestimmten Termin auch ohne sie. '
      + 'Der dadurch entstandene Schaden ist zu ersetzen.',
  },
  {
    schluessel: 'kuendigung',
    woerter: ['kündigen', 'kuendigen', 'kündigung', 'kuendigung', 'vertrag beenden', 'aussteigen'],
    stelle: '§ 648 BGB, § 648a BGB',
    inhalt:
      'Der Besteller kann jederzeit kündigen; dem Unternehmer steht dann die vereinbarte '
      + 'Vergütung abzüglich ersparter Aufwendungen zu. Daneben steht beiden Seiten die '
      + 'Kündigung aus wichtigem Grund offen.',
  },
  {
    schluessel: 'widerruf',
    woerter: ['widerruf', 'widerrufen', 'widerrufsrecht'],
    stelle: '§ 650l BGB',
    inhalt:
      'Beim Verbraucherbauvertrag steht dem Verbraucher ein Widerrufsrecht zu, sofern der '
      + 'Vertrag nicht notariell beurkundet wurde.',
  },
  {
    schluessel: 'baubeschreibung',
    woerter: ['baubeschreibung', 'leistungsbeschreibung', 'bau-soll', 'geschuldet ist', 'bauzeit'],
    stelle: '§ 650k BGB, Art. 249 EGBGB',
    inhalt:
      'Der Unternehmer muss eine Baubeschreibung mit den in Art. 249 EGBGB genannten Angaben '
      + 'zur Verfügung stellen; der Vertrag muss verbindliche Angaben zur Fertigstellung oder '
      + 'zur Bauzeitdauer enthalten. Unklarheiten gehen zulasten des Unternehmers.',
  },
];

/**
 * Fragen, deren Kern rechtlich ist, ohne ein eigenes Thema zu treffen.
 *
 * „Darf der das?" ist keine Bauberatung, auch wenn kein Paragraf darin
 * vorkommt.
 */
const RECHTLICH_ALLGEMEIN: readonly string[] = [
  'darf der', 'darf er', 'darf ich', 'muss ich zahlen', 'muss ich das',
  'rechtlich', 'anspruch', 'ansprüche', 'anspruechen', 'haftung', 'haftet',
  'schadensersatz', 'anwalt', 'klage', 'klagen', 'gericht', 'vertraglich',
  'bin ich verpflichtet', 'was sagt das gesetz', 'gesetzlich',
];

/** Anzeichen, die eine bautechnische Beurteilung verlangen. */
const MANGELSYMPTOME: readonly string[] = [
  'riss', 'risse', 'feucht', 'nass', 'schimmel', 'fleck', 'flecken', 'verfärb', 'verfaerb',
  'ausblüh', 'ausblueh', 'hohlstelle', 'hohl klingt', 'abplatz', 'abgeplatzt', 'uneben',
  'schief', 'wellig', 'undicht', 'zugluft', 'kältebrücke', 'kaeltebruecke', 'pfusch',
  'mangel', 'mängel', 'maengel', 'schaden am', 'sieht komisch aus', 'ist das normal',
];

/** Anzeichen, dass nach Geld gefragt wird. */
const KOSTENWOERTER: readonly string[] = [
  'kostet', 'kosten', 'preis', 'preise', 'teuer', 'günstig', 'guenstig', 'euro', '€',
  'angebot', 'budget', 'was zahle ich', 'wie viel', 'wieviel',
];

function normalisiert(frage: string): string {
  return frage.toLowerCase();
}

function enthaelt(text: string, woerter: readonly string[]): boolean {
  return woerter.some((wort) => text.includes(wort));
}

/** Das rechtliche Thema der Frage, wenn sie eines hat. */
export function rechtsthema(frage: string): Rechtsthema | null {
  const text = normalisiert(frage);
  const treffer = RECHTSTHEMEN.find((thema) => enthaelt(text, thema.woerter));
  if (treffer !== undefined) return treffer;
  if (!enthaelt(text, RECHTLICH_ALLGEMEIN)) return null;
  return {
    schluessel: 'werkvertrag',
    woerter: [],
    stelle: '§§ 631 ff. BGB',
    inhalt:
      'Ein Bauvertrag ist ein Werkvertrag: Geschuldet ist der Erfolg, nicht die Mühe. Was das '
      + 'im Einzelfall bedeutet, steht in eurem Vertrag und in den §§ 631 ff. BGB.',
  };
}

/**
 * Die Hinweise, die an diese Frage gehören.
 *
 * Leer, wenn keine Leitplanke greift — und das ist der Normalfall. Ein
 * Hinweis, der unter jeder Antwort steht, wird nach dem dritten Mal
 * überlesen, und dann ist er beim vierten Mal nicht mehr da, wenn er zählt.
 */
export function hinweiseFuer(frage: string): Hinweis[] {
  const text = normalisiert(frage);
  const hinweise: Hinweis[] = [];

  const thema = rechtsthema(frage);
  if (thema !== null) {
    hinweise.push({
      art: 'recht',
      titel: 'Hinweis auf eine Gesetzesstelle, keine Rechtsberatung.',
      stelle: thema.stelle,
      text:
        `${thema.stelle} — ${thema.inhalt}\n\n`
        + 'Das ist der Gesetzestext, nicht seine Anwendung auf euren Vertrag. Die macht ein '
        + 'Fachanwalt für Bau- und Architektenrecht. Eine Erstberatung liegt meist zwischen '
        + '150 und 250 Euro; wenn es um Fristen oder um fünfstellige Beträge geht, ist das '
        + 'der günstigste Teil der Sache.',
    });
  }

  if (enthaelt(text, MANGELSYMPTOME)) {
    hinweise.push({
      art: 'mangel',
      titel: 'Ob das ein Mangel ist, lässt sich hier nicht beurteilen.',
      text:
        'Aus der Ferne — und aus einem Foto erst recht — ist das nicht zu entscheiden. Es hängt '
        + 'an Ausführung, Norm und Vertrag und oft an dem, was unter der Oberfläche liegt.\n\n'
        + 'Das beurteilt ein Bausachverständiger. Ein Ortstermin mit Bericht kostet '
        + 'überschlägig 400 bis 900 Euro und ist die Grundlage, auf die du dich gegenüber dem '
        + 'Unternehmen berufen kannst.\n\n'
        + 'Bis dahin sind drei Dinge sinnvoll: fotografieren mit Maßstab im Bild, den Fund '
        + 'mit Datum ins Bautagebuch schreiben und ihn dem Unternehmen schriftlich anzeigen. '
        + 'Das kostet nichts und hält die Lage fest.',
    });
  }

  if (enthaelt(text, KOSTENWOERTER)) {
    hinweise.push({
      art: 'kosten',
      titel: 'Zahlen sind hier Größenordnungen.',
      text:
        'Was etwas tatsächlich kostet, sagt ein Angebot — abhängig von Region, Ausführung und '
        + 'Auslastung. Was hier steht, hilft bei der Frage, ob ein Angebot im Rahmen liegt. '
        + 'Es ist kein Preis, auf den du dich berufen kannst.',
    });
  }

  return hinweise;
}

export function leitplanken(frage: string): Leitplanke[] {
  return hinweiseFuer(frage).map((hinweis) => hinweis.art);
}

/**
 * Karten, die die Antwort trägt.
 *
 * Das Modell markiert sie als `[[karte:schluessel]]`. Herausgezogen und
 * geprüft wird hier: Was nicht in der Liste der mitgegebenen Karten steht,
 * fliegt heraus. Ein erfundener Verweis wäre schlimmer als keiner — er sieht
 * aus wie eine Quelle.
 */
export function karten(antwort: string, erlaubt: readonly string[]): {
  text: string;
  keys: string[];
} {
  const gefunden: string[] = [];
  const text = antwort.replace(/\[\[karte:([a-z0-9_-]+)\]\]/gi, (_treffer, key: string) => {
    const schluessel = key.toLowerCase();
    if (!erlaubt.includes(schluessel)) return '';
    if (!gefunden.includes(schluessel)) gefunden.push(schluessel);
    return '';
  });
  return { text: text.replace(/[ \t]+([.,;:!?])/g, '$1').replace(/[ \t]{2,}/g, ' ').trim(), keys: gefunden };
}
