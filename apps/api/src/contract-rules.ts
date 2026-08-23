/**
 * Der Vertragsspiegel (Abschnitt 3.9).
 *
 * „Automatische **Hinweise**, nie Bewertungen." Der Unterschied ist nicht
 * kosmetisch. Ein Hinweis sagt, was der Fall ist und welche Stelle dazu
 * gehört; eine Bewertung sagt, wer im Recht ist. Das Zweite darf dieses
 * Produkt nicht, und es ist auch nicht das, was hilft: Wer weiß, dass § 650m
 * Abs. 1 BGB Abschläge auf 90 % begrenzt und dass sein Plan bei 95 % liegt,
 * kann damit zu seinem Unternehmer gehen. Wer liest „Ihr Vertrag ist
 * unwirksam", kann gar nichts.
 *
 * Deshalb ist diese Datei reine Rechnung: Zahlen hinein, Befunde heraus. Kein
 * Datenbankzugriff, kein Netz, keine Uhrzeit — und damit prüfbar bis in jeden
 * Zweig. Was daraus in der Datenbank landet, entscheidet der Aufrufer.
 *
 * Der feste Zusatz nach CI 11.3 steht nicht in den Texten, sondern wird von
 * der Oberfläche an jeden Befund gesetzt. So kann er nicht bei einem
 * vergessen werden.
 */

/** Wie dringend ein Befund ist. Beides sind Hinweise, keine Bewertungen. */
export type CheckSeverity = 'hinweis' | 'wichtig';

export interface ContractFacts {
  /** Nur beim Verbraucherbauvertrag greifen die §§ 650i ff. BGB. */
  contractType: string;
  contractSumCents: number | null;
  contractualCompletion: string | null;
  /** Vereinbarte Sicherheit in Prozent der Gesamtvergütung. */
  securityPct: number | null;
  /** Die Anteile des Zahlungsplans, in Prozent. */
  milestonePcts: number[];
  /** Die Summe der vereinbarten Nachträge. */
  agreedChangeOrderCents: number;
  /** Wie viele Punkte der Baubeschreibung durchgesehen sind, und welche fehlen. */
  descriptionReviewed: number;
  descriptionMissing: string[];
}

export interface ContractFinding {
  ruleKey: string;
  severity: CheckSeverity;
  message: string;
  legalReference: string | null;
}

/**
 * Die Punkte, die eine Baubeschreibung nach Art. 249 § 2 EGBGB enthalten muss.
 *
 * Sie stehen hier als Liste und nicht als Freitext, weil der Vertragsspiegel
 * sagen können muss, **welcher** fehlt. „Die Baubeschreibung ist
 * unvollständig" ist keine Hilfe; „es fehlt die Angabe zur Bauzeit" ist eine.
 *
 * Die Anwendung kann den Vertrag nicht lesen. Sie kann nur fragen — deshalb
 * hakt der Bauherr ab, und solange nichts abgehakt ist, sagt der Spiegel
 * „noch nicht durchgesehen" statt „alles fehlt".
 */
export const DESCRIPTION_ITEMS: readonly { key: string; label: string }[] = [
  { key: 'allgemeine_beschreibung', label: 'Allgemeine Beschreibung des Gebäudes und Art der Ausführung' },
  { key: 'art_umfang', label: 'Art und Umfang der angebotenen Leistungen' },
  { key: 'grundriss', label: 'Grundrisse, Schnitte und Ansichten' },
  { key: 'baukonstruktion', label: 'Baukonstruktionen aller wesentlichen Gewerke' },
  { key: 'qualitaet', label: 'Beschreibung der Innenwände, Decken und der Ausstattung' },
  { key: 'gebaeudetechnik', label: 'Gebäudetechnik: Heizung, Lüftung, Sanitär, Elektro' },
  { key: 'energie', label: 'Angaben zum Energie-, Schallschutz- und Wärmedämmstandard' },
  { key: 'sanitaer_elektro', label: 'Beschreibung der Sanitärobjekte und Elektroanlagen' },
  { key: 'aussenanlagen', label: 'Angaben zu Außenanlagen und Erschließung' },
  { key: 'qualitaetsstandards', label: 'Qualitätsmerkmale, denen das Gebäude genügen soll' },
  { key: 'bauzeit', label: 'Verbindliche Angabe zum Zeitpunkt der Fertigstellung oder zur Bauzeitdauer' },
];

const cent = (value: number): string =>
  `${(value / 100).toLocaleString('de-DE', { maximumFractionDigits: 0 })} Euro`;

const prozent = (value: number): string =>
  value.toLocaleString('de-DE', { maximumFractionDigits: 1 });

/**
 * Die Prüfung.
 *
 * Reihenfolge ist Absicht: erst was zu viel ist, dann was fehlt, dann was
 * unvollständig ist. Ein Bauherr liest das von oben.
 */
export function checkContract(facts: ContractFacts): ContractFinding[] {
  const befunde: ContractFinding[] = [];
  const verbraucher = facts.contractType === 'verbraucherbauvertrag';

  // 1. Summe der Abschläge über 90 % --------------------------------------
  const summe = facts.milestonePcts.reduce((a, b) => a + b, 0);
  if (verbraucher && facts.milestonePcts.length > 0 && summe > 90) {
    befunde.push({
      ruleKey: 'abschlaege_ueber_90',
      severity: 'wichtig',
      message:
        `Der Zahlungsplan summiert sich auf ${prozent(summe)} %. § 650m Abs. 1 BGB begrenzt `
        + 'Abschlagszahlungen bei Verbraucherbauverträgen auf 90 % der Gesamtvergütung '
        + 'einschließlich Nachträgen.',
      legalReference: '§ 650m Abs. 1 BGB',
    });
  }

  // 2. Sicherheit für die rechtzeitige Herstellung -------------------------
  if (verbraucher && (facts.securityPct === null || facts.securityPct <= 0)) {
    befunde.push({
      ruleKey: 'sicherheit_fehlt',
      severity: 'wichtig',
      message:
        'Eine Sicherheit für die rechtzeitige Herstellung ohne wesentliche Mängel ist nicht '
        + 'erfasst. § 650m Abs. 2 BGB sieht 5 % der Gesamtvergütung bei der ersten '
        + 'Abschlagszahlung vor, auf Verlangen des Unternehmers als Einbehalt.',
      legalReference: '§ 650m Abs. 2 BGB',
    });
  }

  // 3. Nachträge über 10 % der ursprünglichen Vergütung --------------------
  if (
    verbraucher
    && facts.contractSumCents !== null
    && facts.contractSumCents > 0
    && facts.agreedChangeOrderCents > facts.contractSumCents * 0.1
  ) {
    const anteil = (facts.agreedChangeOrderCents / facts.contractSumCents) * 100;
    befunde.push({
      ruleKey: 'nachtraege_ueber_10',
      severity: 'hinweis',
      message:
        `Die vereinbarten Nachträge liegen bei ${cent(facts.agreedChangeOrderCents)}, also `
        + `${prozent(anteil)} % der ursprünglichen Vergütung. § 650m Abs. 2 S. 2 BGB sieht dann `
        + 'eine weitere Sicherheit von 5 % des zusätzlichen Vergütungsanspruchs vor.',
      legalReference: '§ 650m Abs. 2 S. 2 BGB',
    });
  }

  // 4. Kein Fertigstellungstermin ------------------------------------------
  if (facts.contractualCompletion === null) {
    befunde.push({
      ruleKey: 'kein_fertigstellungstermin',
      severity: 'wichtig',
      message:
        'Es ist weder ein Fertigstellungstermin noch eine Bauzeitdauer erfasst. § 650k Abs. 3 '
        + 'BGB verlangt hierzu verbindliche Angaben im Vertrag. Steht im Vertrag einer, trag '
        + 'ihn ein — dann rechnet der Plan gegen ihn.',
      legalReference: '§ 650k Abs. 3 BGB',
    });
  }

  // 5. Baubeschreibung ------------------------------------------------------
  if (facts.descriptionReviewed === 0) {
    befunde.push({
      ruleKey: 'baubeschreibung_ungeprueft',
      severity: 'hinweis',
      message:
        `Die Baubeschreibung ist noch nicht durchgesehen. Art. 249 EGBGB zählt ${DESCRIPTION_ITEMS.length} `
        + 'Punkte auf, die sie enthalten muss. Geh sie einmal durch und hak ab, was drinsteht — '
        + 'was fehlt, steht danach hier.',
      legalReference: 'Art. 249 § 2 EGBGB',
    });
  } else if (facts.descriptionMissing.length > 0) {
    befunde.push({
      ruleKey: 'baubeschreibung_unvollstaendig',
      severity: 'wichtig',
      message:
        `In der Baubeschreibung fehlen ${facts.descriptionMissing.length} von `
        + `${DESCRIPTION_ITEMS.length} Punkten nach Art. 249 § 2 EGBGB: `
        + `${facts.descriptionMissing.join('; ')}. Unklarheiten in der Baubeschreibung gehen `
        + 'nach § 650k Abs. 2 BGB zulasten des Unternehmers.',
      legalReference: 'Art. 249 § 2 EGBGB, § 650k Abs. 2 BGB',
    });
  }

  return befunde;
}

/**
 * Bereitstellungszinsen (Abschnitt 3.10).
 *
 * Die Bank verlangt sie für zugesagtes, aber nicht abgerufenes Geld — nach
 * einer bereitstellungsfreien Zeit, meist drei bis zwölf Monate. Die Rechnung
 * ist einfach und wird trotzdem selten gemacht: Sie kostet bei einem
 * verzögerten Bau schnell einen vierstelligen Betrag, und dann steht sie
 * plötzlich auf einer Abrechnung.
 *
 * Gerechnet wird taggenau nach der deutschen Bankmethode 30/360: dreißig Tage
 * je Monat, dreihundertsechzig Tage im Jahr. Das ist nicht die genaueste
 * Methode, aber die, nach der die Bank abrechnet — und die Zahl soll zur
 * Abrechnung passen und nicht zum Kalender.
 */
export function commitmentInterest(options: {
  /** Die gesamte Darlehenssumme. */
  totalCents: number;
  /** Jahreszins in Prozent, z. B. 3 für 3 % p. a. */
  pctPerYear: number;
  /** Bereitstellungsfreie Monate ab Zusage. */
  freeMonths: number;
  /** Tag der Zusage, `YYYY-MM-DD`. */
  from: string;
  /** Stichtag, bis zu dem gerechnet wird. */
  until: string;
  /** Die Abrufe: Betrag und Tag. */
  drawdowns: { amountCents: number; date: string }[];
}): { cents: number; days: number } {
  const start = tage(options.from) + Math.round(options.freeMonths * 30);
  const ende = tage(options.until);
  if (ende <= start || options.pctPerYear <= 0) return { cents: 0, days: 0 };

  // Die Abrufe der Reihe nach: Zwischen zwei Abrufen bleibt der offene
  // Betrag gleich, und für diese Strecke wird gerechnet.
  const punkte = [...options.drawdowns]
    .map((abruf) => ({ tag: tage(abruf.date), betrag: abruf.amountCents }))
    .sort((a, b) => a.tag - b.tag);

  let offen = options.totalCents;
  let zinsen = 0;
  let tageGesamt = 0;
  let cursor = start;

  for (const punkt of [...punkte, { tag: ende, betrag: 0 }]) {
    const bis = Math.min(punkt.tag, ende);
    if (bis > cursor && offen > 0) {
      const strecke = bis - cursor;
      zinsen += (offen * (options.pctPerYear / 100) * strecke) / 360;
      tageGesamt += strecke;
    }
    if (punkt.tag <= ende) offen = Math.max(0, offen - punkt.betrag);
    cursor = Math.max(cursor, bis);
    if (cursor >= ende) break;
  }

  return { cents: Math.round(zinsen), days: tageGesamt };
}

/** Tage nach 30/360, gerechnet ab einem festen Nullpunkt. */
function tage(iso: string): number {
  const [jahr, monat, tag] = iso.split('-').map(Number);
  return jahr! * 360 + (monat! - 1) * 30 + Math.min(tag!, 30);
}
