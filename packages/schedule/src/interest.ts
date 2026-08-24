/**
 * Bereitstellungszinsen — Abschnitt 3.10, letzter Halbsatz.
 *
 *     „Dazu Darlehensabrufe mit Bereitstellungszinsrechner."
 *
 * Ein Halbsatz, und für den Bauherren eine der teureren Zahlen des ganzen
 * Bauvorhabens. Die Bank stellt das Darlehen bereit; abgerufen wird es in
 * Raten, wie der Bau fortschreitet. Für alles, was bereitsteht und noch nicht
 * abgerufen ist, verlangt sie nach einer bereitstellungsfreien Zeit Zinsen —
 * üblich sind 3 % im Jahr, und bei 400.000 € nicht abgerufenem Darlehen sind
 * das 1.000 € im Monat.
 *
 * Genau hier trifft der Terminplan auf das Konto: **Jeder Monat Bauverzug
 * kostet Bereitstellungszinsen**, und zwar unabhängig davon, wer ihn zu
 * vertreten hat. Das ist die Zahl, die eine Verschiebung von einer Zeile im
 * Kalender in etwas verwandelt, das man spürt.
 *
 * Diese Datei steht im Berechnungskern und hält sich an dessen Regel: keine
 * Datenbank, kein Netz, keine Uhr, keine Abhängigkeiten. Alles kommt als
 * Parameter herein, gerechnet wird auf Epochentagen und ganzen Cent.
 *
 * **Zur Zinsmethode.** Gerechnet wird nach 30E/360, der deutschen
 * Zinsmethode: jeder Monat dreißig Tage, jedes Jahr dreihundertsechzig. Das
 * ist, was deutsche Banken üblicherweise anwenden. Sie tun es aber nicht alle
 * und nicht immer gleich — manche rechnen taggenau, manche stellen erst zum
 * Monatsende. Das Ergebnis hier ist deshalb eine belastbare Schätzung und
 * keine Abrechnung, und die Oberfläche sagt das auch.
 */

import {
  addDays,
  compareDates,
  daysInMonth,
  makeIsoDate,
  parseIsoDate,
  type IsoDate,
} from './civil-date.js';

export interface Drawdown {
  /** Der Tag, an dem das Geld floss. Ein angeforderter, nicht ausgezahlter
   *  Abruf senkt die Bereitstellungszinsen nicht. */
  date: IsoDate;
  amountCents: number;
}

export interface CommitmentInterestInput {
  /** Die zugesagte Darlehenssumme. */
  loanAmountCents: number;
  /** Ab wann die bereitstellungsfreie Zeit läuft — meist die Zusage. */
  grantedOn: IsoDate;
  /** Bereitstellungsfreie Monate. Zwölf sind üblich, sechs kommen vor. */
  freeMonths: number;
  /** Zins in Basispunkten je Jahr. 300 = 3,00 % p. a. */
  ratePerYearBp: number;
  drawdowns: readonly Drawdown[];
  /** Stichtag der Rechnung. */
  until: IsoDate;
}

export interface CommitmentInterestSegment {
  from: IsoDate;
  to: IsoDate;
  /** Was in diesem Abschnitt bereitstand, aber nicht abgerufen war. */
  undrawnCents: number;
  days: number;
  interestCents: number;
}

export interface CommitmentInterestResult {
  totalCents: number;
  /** Ab wann überhaupt Zinsen anfallen. `null`, wenn die freie Zeit noch läuft. */
  chargeableFrom: IsoDate | null;
  /** Was am Stichtag noch nicht abgerufen war. */
  undrawnAtEndCents: number;
  segments: readonly CommitmentInterestSegment[];
  /** Was ein weiterer Monat Verzug kosten würde. Die eigentliche Auskunft. */
  costPerFurtherMonthCents: number;
}

/**
 * Tage nach 30E/360.
 *
 * Die deutsche Zinsmethode: Jeder Monat hat dreißig Tage. Der 31. eines Monats
 * wird auf den 30. gezogen — deshalb `Math.min(tag, 30)` auf beiden Seiten.
 * Das ist keine Ungenauigkeit, sondern die Konvention, nach der abgerechnet
 * wird.
 */
export function days30E360(from: IsoDate, to: IsoDate): number {
  const a = parseIsoDate(from);
  const b = parseIsoDate(to);
  return (
    360 * (b.year - a.year) +
    30 * (b.month - a.month) +
    (Math.min(b.day, 30) - Math.min(a.day, 30))
  );
}

/** Denselben Tag im Monat, `months` Monate später. Der 31. rutscht auf den Letzten. */
export function addMonths(date: IsoDate, months: number): IsoDate {
  const { year, month, day } = parseIsoDate(date);
  const gesamt = year * 12 + (month - 1) + months;
  const zieljahr = Math.floor(gesamt / 12);
  const zielmonat = (gesamt % 12) + 1;
  // Kein `Date`-Objekt, auch nicht für den Monatsletzten: Regel 2 dieses
  // Repositories gilt hier genauso wie in der Terminrechnung, und ein
  // `new Date(...)` in einer reinen Funktion ist der Anfang jedes
  // Zeitzonenfehlers.
  const zieltag = Math.min(day, daysInMonth(zieljahr, zielmonat));
  return makeIsoDate(zieljahr, zielmonat, zieltag);
}

/**
 * Was das bereitstehende Darlehen bis zum Stichtag gekostet hat.
 *
 * Gerechnet wird abschnittsweise: Zwischen zwei Abrufen ändert sich der nicht
 * abgerufene Betrag nicht, also genügt ein Abschnitt je Abruf. Das ist exakt
 * und nicht bloß eine Näherung über Monatsmittel — und es erlaubt der
 * Oberfläche, die Rechnung Zeile für Zeile zu zeigen, statt eine Summe zu
 * behaupten.
 */
export function commitmentInterest(input: CommitmentInterestInput): CommitmentInterestResult {
  const zinsbeginn = addMonths(input.grantedOn, Math.max(0, input.freeMonths));
  const abgerufenBis = (tag: IsoDate): number =>
    input.drawdowns
      .filter((abruf) => compareDates(abruf.date, tag) <= 0)
      .reduce((summe, abruf) => summe + abruf.amountCents, 0);

  const offenAmEnde = Math.max(0, input.loanAmountCents - abgerufenBis(input.until));
  const monatlich = Math.round((offenAmEnde * input.ratePerYearBp) / 10_000 / 12);

  if (
    input.loanAmountCents <= 0 ||
    input.ratePerYearBp <= 0 ||
    compareDates(zinsbeginn, input.until) >= 0
  ) {
    return {
      totalCents: 0,
      chargeableFrom: compareDates(zinsbeginn, input.until) >= 0 ? null : zinsbeginn,
      undrawnAtEndCents: offenAmEnde,
      segments: [],
      costPerFurtherMonthCents: monatlich,
    };
  }

  // Die Grenzen der Abschnitte: Zinsbeginn, jeder Abruf danach, der Stichtag.
  const grenzen = [
    zinsbeginn,
    ...input.drawdowns
      .map((abruf) => abruf.date)
      .filter(
        (tag) => compareDates(tag, zinsbeginn) > 0 && compareDates(tag, input.until) < 0,
      ),
    input.until,
  ]
    .slice()
    .sort(compareDates)
    .filter((tag, index, alle) => index === 0 || alle[index - 1] !== tag);

  const segments: CommitmentInterestSegment[] = [];
  let summe = 0;

  for (let index = 0; index < grenzen.length - 1; index += 1) {
    const von = grenzen[index]!;
    const bis = grenzen[index + 1]!;
    // Am Tag des Abrufs ist das Geld weg — der Abschnitt davor endet an diesem
    // Tag, der danach beginnt mit dem niedrigeren Betrag.
    const offen = Math.max(0, input.loanAmountCents - abgerufenBis(von));
    const tage = days30E360(von, bis);
    if (tage <= 0 || offen <= 0) continue;

    const zins = Math.round((offen * input.ratePerYearBp * tage) / 10_000 / 360);
    summe += zins;
    segments.push({ from: von, to: bis, undrawnCents: offen, days: tage, interestCents: zins });
  }

  return {
    totalCents: summe,
    chargeableFrom: zinsbeginn,
    undrawnAtEndCents: offenAmEnde,
    segments,
    costPerFurtherMonthCents: monatlich,
  };
}

/**
 * Was ein Verzug bis zu einem späteren Endtermin zusätzlich kostet.
 *
 * Die Zahl, die eine Verschiebung greifbar macht: „14 Werktage später" ist ein
 * Kalendereintrag, „14 Werktage später, das sind rund 700 € Bereitstellungszinsen"
 * ist eine Entscheidungsgrundlage.
 */
export function delayCostInCommitmentInterest(
  input: CommitmentInterestInput,
  newEnd: IsoDate,
): number {
  if (compareDates(newEnd, input.until) <= 0) return 0;
  const bisher = commitmentInterest(input);
  const danach = commitmentInterest({ ...input, until: newEnd });
  return danach.totalCents - bisher.totalCents;
}

/** Der letzte Tag, an dem noch keine Bereitstellungszinsen anfallen. */
export function lastFreeDay(grantedOn: IsoDate, freeMonths: number): IsoDate {
  return addDays(addMonths(grantedOn, Math.max(0, freeMonths)), -1);
}
